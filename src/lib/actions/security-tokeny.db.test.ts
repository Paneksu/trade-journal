import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, type Par, type Sql } from "@/lib/api-v2/test/db-pomocnik";

/*
 * B1 (Słowa użytkownika 15.10.2026: «Dopisać teraz»): „wyloguj pozostałe przeglądarki” i „wyłącz 2FA”
 * mają opcję unieważnienia wszystkich tokenów urządzeń: revoked_at, revoked_reason = 'logout_all'
 * i wpis token_revoked dla każdego tokenu. Bez opcji tokeny zostają.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.60", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/auth/guard", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/guard")>();
  return {
    ...real,
    requireSession: async () => {
      const { db } = await import("@/lib/db");
      const { settings } = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      return (await db.select().from(settings).where(eq(settings.id, 1)).limit(1))[0];
    },
  };
});
const sudo = vi.hoisted(() => ({ doKiedy: null as number | null }));
vi.mock("@/lib/auth/session", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/session")>();
  return { ...real, sudoValidUntil: async () => sudo.doKiedy };
});

describe.skipIf(!MOZNA_NA_BAZIE)("unieważnianie tokenów przy wylogowaniu i wyłączeniu 2FA (baza lokalna)", () => {
  let sql: Sql;
  const tokeny: number[] = [];
  let startPliku = 0;
  let odId = 0;

  beforeAll(async () => {
    sql = polacz();
    await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
    startPliku = (await sql`select coalesce(max(id), 0)::int as m from auth_events`)[0].m;
  });
  afterAll(async () => {
    await sql`update settings set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = 1`;
    await sql`delete from auth_events where id > ${startPliku} or token_id = any(${tokeny})`;
    await sprzatnijPoTokenach(sql, tokeny);
    await sql.end();
  });
  beforeEach(async () => {
    odId = (await sql`select coalesce(max(id), 0)::int as m from auth_events`)[0].m;
    sudo.doKiedy = null;
  });

  async function trzyTokeny(): Promise<{ a: Par; b: Par; stary: Par }> {
    // Test liczy WSZYSTKIE aktywne tokeny, więc zaczyna od czystej tablicy (baza testowa tj_*).
    await sql`update api_tokens set revoked_at = now(), revoked_reason = 'porzadki-testu' where revoked_at is null`;
    const a = await nowyToken(sql, ["read", "write"]);
    const b = await nowyToken(sql, ["read"]);
    const stary = await nowyToken(sql, ["read"], { revokedAt: new Date(Date.now() - 3600_000) });
    await sql`update api_tokens set revoked_reason = 'ui' where id = ${stary.id}`;
    tokeny.push(a.id, b.id, stary.id);
    return { a, b, stary };
  }
  const stan = (ids: number[]) => sql`select id, revoked_at, revoked_reason from api_tokens where id = any(${ids}) order by id`;
  const wpisy = () => sql`select token_id, detail from auth_events where kind = 'token_revoked' and id > ${odId} order by id`;

  it("logoutEverywhere(true) unieważnia wszystkie aktywne tokeny z powodem logout_all i wpisem token_revoked na każdy", async () => {
    const { a, b, stary } = await trzyTokeny();
    const { logoutEverywhere } = await import("./security");
    await logoutEverywhere(true);

    const w = await stan([a.id, b.id, stary.id]);
    expect(w[0].revoked_at).not.toBeNull();
    expect(w[0].revoked_reason).toBe("logout_all");
    expect(w[1].revoked_at).not.toBeNull();
    expect(w[1].revoked_reason).toBe("logout_all");
    // wcześniej unieważniony zostaje z pierwotnym powodem
    expect(w[2].revoked_reason).toBe("ui");

    const z = await wpisy();
    expect(z.map((x) => x.token_id).sort()).toEqual([a.id, b.id].sort());
    expect(z.every((x) => x.detail.powod === "logout_all")).toBe(true);
    const [{ ile }] = await sql`select count(*)::int as ile from api_tokens where revoked_at is null`;
    expect(ile).toBe(0);
  });

  it("logoutEverywhere() bez opcji wylogowuje przeglądarki (wersja sesji), ale NIE rusza tokenów", async () => {
    const { a, b } = await trzyTokeny();
    const [przed] = await sql`select session_version from settings where id = 1`;
    const { logoutEverywhere } = await import("./security");
    await logoutEverywhere();
    const [po] = await sql`select session_version from settings where id = 1`;
    expect(po.session_version).toBe(przed.session_version + 1);
    const w = await stan([a.id, b.id]);
    expect(w.every((x) => x.revoked_at === null)).toBe(true);
    expect(await wpisy()).toHaveLength(0);
  });

  it("disableTotp z polem uniewaznTokeny=on unieważnia tokeny; bez pola je zostawia", async () => {
    const { disableTotp } = await import("./security");
    const wlacz = () => sql`update settings set totp_secret_enc = 'v1.sekret', totp_enabled_at = now() where id = 1`;

    const { a, b } = await trzyTokeny();
    await wlacz();
    sudo.doKiedy = Date.now() + 60_000;
    const bez = await disableTotp({}, new FormData());
    expect(bez.ok, bez.error).toBe(true);
    expect((await stan([a.id, b.id])).every((x) => x.revoked_at === null)).toBe(true);

    await wlacz();
    const f = new FormData();
    f.append("uniewaznTokeny", "on");
    const z = await disableTotp({}, f);
    expect(z.ok, z.error).toBe(true);
    const w = await stan([a.id, b.id]);
    expect(w.every((x) => x.revoked_at !== null && x.revoked_reason === "logout_all")).toBe(true);
    expect((await wpisy()).map((x) => x.token_id).sort()).toEqual([a.id, b.id].sort());
    expect((await wpisy()).every((x) => x.detail.kontekst === "totp_disabled")).toBe(true);
  });

  it("disableTotp bez sudo nie unieważnia niczego", async () => {
    const { disableTotp } = await import("./security");
    const { a } = await trzyTokeny();
    await sql`update settings set totp_secret_enc = 'v1.sekret', totp_enabled_at = now() where id = 1`;
    const f = new FormData();
    f.append("uniewaznTokeny", "on");
    const w = await disableTotp({}, f);
    expect(w.error).toContain("sudo");
    expect((await stan([a.id]))[0].revoked_at).toBeNull();
  });

  it("etykieta przycisku mówi, że dotyczy sesji przeglądarek, i oferuje pole z tokenami", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const zrodlo = readFileSync(resolve(__dirname, "../../components/settings/security-forms.tsx"), "utf8");
    expect(zrodlo).toContain("Wyloguj pozostałe przeglądarki");
    expect(zrodlo).toContain("Przycisk dotyczy sesji przeglądarek");
    expect(zrodlo).toContain("Unieważnij też wszystkie tokeny urządzeń");
    expect(zrodlo).toContain('name="uniewaznTokeny"');
  });
});
