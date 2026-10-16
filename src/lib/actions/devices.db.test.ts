import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MOZNA_NA_BAZIE, polacz, sprzatnijPoTokenach, unikalnyIp, zadanie, type Sql } from "@/lib/api-v2/test/db-pomocnik";

/*
 * Domkniecie warunku scalenia z faza 1 (ADR-031): zatwierdzenie urzadzenia i utworzenie tokenu
 * importu wymagaja sudo (2FA wlaczone) albo hasla (2FA wylaczone), a kazda decyzja zostawia wpis
 * w auth_events. Akcje serwerowe wolane bezposrednio, z atrapami tylko dla ciasteczek i naglowkow Next.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.50", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
// requireSession czyta ciasteczko; w tescie zwraca biezacy wiersz ustawien z bazy.
vi.mock("@/lib/auth/guard", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/guard")>();
  return {
    ...real,
    requireSession: async () => {
      const { db } = await import("@/lib/db");
      const { settings } = await import("@/lib/db/schema");
      const { eq: rowne } = await import("drizzle-orm");
      return (await db.select().from(settings).where(rowne(settings.id, 1)).limit(1))[0];
    },
  };
});
// Stan sudo (ciasteczko) sterowany w tescie.
const sudo = vi.hoisted(() => ({ doKiedy: null as number | null }));
vi.mock("@/lib/auth/session", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/session")>();
  return { ...real, sudoValidUntil: async () => sudo.doKiedy };
});

describe.skipIf(!MOZNA_NA_BAZIE)("sudo/hasło przy nadawaniu dostępu urządzeniom + auth_events (baza lokalna)", () => {
  let sql: Sql;
  const HASLO = "Haslo-testowe-faza2-12345";
  let poprzedniHash: string | null = null;
  const tokeny: number[] = [];
  const znacznik = Date.now().toString(36);
  const nazwy: string[] = [];
  // Wpisy z poprzednich przebiegow nie moga udawac wpisow tego testu: liczymy tylko to, co powstalo po starcie testu.
  let odId = 0;
  let startPliku = 0;

  beforeAll(async () => {
    sql = polacz();
    startPliku = (await sql`select coalesce(max(id), 0)::int as m from auth_events`)[0].m;
    const { hashPassword } = await import("@/lib/auth/password");
    const [s] = await sql`select password_hash from settings where id = 1`;
    poprzedniHash = s?.password_hash ?? null;
    await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
    await sql`update settings set password_hash = ${await hashPassword(HASLO)}, totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = 1`;
  });
  afterAll(async () => {
    await sql`update settings set password_hash = ${poprzedniHash}, totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = 1`;
    await sql`delete from auth_events where id > ${startPliku} or token_id = any(${tokeny})`;
    await sql`delete from device_codes where client_name = any(${nazwy})`;
    await sprzatnijPoTokenach(sql, tokeny);
    await sql.end();
  });
  beforeEach(async () => {
    odId = (await sql`select coalesce(max(id), 0)::int as m from auth_events`)[0].m;
    sudo.doKiedy = null;
    const { wyczyscLimiter } = await import("@/lib/api-v2/limiter");
    wyczyscLimiter();
    const { clearAttempts } = await import("@/lib/auth/guard");
    clearAttempts("203.0.113.50");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const wlacz2fa = () =>
    sql`update settings set totp_secret_enc = 'v1.sekret', totp_enabled_at = now() where id = 1`;
  const wylacz2fa = () => sql`update settings set totp_secret_enc = null, totp_enabled_at = null where id = 1`;

  async function noweZadanie(nazwa: string) {
    const n = `${nazwa} ${znacznik}`;
    nazwy.push(n);
    const { POST } = await import("@/app/api/v2/device/start/route");
    // device/start jest zamkniete do wlaczenia 2FA (ADR-030, 17.10.2026): na czas zadania wlaczamy je,
    // potem przywracamy stan sprzed (testy zatwierdzania haslem potrzebuja wylaczonego 2FA).
    const [przed] = await sql`select totp_secret_enc, totp_enabled_at from settings where id = 1`;
    await wlacz2fa();
    let res: Response;
    try {
      res = await POST(zadanie("/device/start", { metoda: "POST", cialo: { clientName: n, scopes: ["read"] }, ip: unikalnyIp() }), undefined);
    } finally {
      await sql`update settings set totp_secret_enc = ${przed.totp_secret_enc}, totp_enabled_at = ${przed.totp_enabled_at} where id = 1`;
    }
    expect(res.status).toBe(200);
    const d = await res.json();
    const [w] = await sql`select id from device_codes where user_code = ${d.userCode}`;
    return { id: w.id as number, userCode: d.userCode as string, deviceCode: d.deviceCode as string };
  }
  const forma = (pola: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(pola)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
    return f;
  };
  const zdarzenia = (rodzaj: string) => sql`select kind, ip, user_agent, token_id, detail from auth_events where kind = ${rodzaj} and id > ${odId} order by id desc limit 5`;

  describe("zatwierdzenie urządzenia", () => {
    it("2FA wyłączone: zatwierdzenie jest ZABLOKOWANE nawet z poprawnym hasłem (ADR-030, 17.10.2026), nic się nie zmienia; odrzucenie działa", async () => {
      const { zatwierdzUrzadzenie } = await import("./devices");
      const z = await noweZadanie("hasło");

      for (const haslo of [undefined, "zle-haslo", HASLO]) {
        const pola: Record<string, string | string[]> = { id: String(z.id), scope: ["read"] };
        if (haslo) pola.haslo = haslo;
        const w = await zatwierdzUrzadzenie({}, forma(pola));
        expect(w.error).toBe("Włącz 2FA, żeby łączyć urządzenia");
        expect(w.potwierdzenie).toBe("haslo");
        expect(w.ok).toBeUndefined();
      }
      const [przed] = await sql`select approved_at, granted_scopes, denied_at from device_codes where id = ${z.id}`;
      expect(przed.approved_at).toBeNull();
      expect(przed.granted_scopes).toBeNull();
      expect(przed.denied_at).toBeNull();
      expect(await zdarzenia("device_approved")).toHaveLength(0);
      expect(await zdarzenia("login_fail")).toHaveLength(0); // hasło nie jest już sprawdzane, więc nie liczy błędów

      const odrzut = await zatwierdzUrzadzenie({}, forma({ id: String(z.id), decyzja: "odrzuc" }));
      expect(odrzut.ok, odrzut.error).toBe(true);
      const [po] = await sql`select approved_at, denied_at from device_codes where id = ${z.id}`;
      expect(po.approved_at).toBeNull();
      expect(po.denied_at).not.toBeNull();
    });

    it("2FA włączone bez aktywnego sudo: zatwierdzenie odrzucone z komunikatem o sudo, nic się nie zmienia", async () => {
      await wlacz2fa();
      try {
        const { zatwierdzUrzadzenie } = await import("./devices");
        const z = await noweZadanie("bez sudo");
        const w = await zatwierdzUrzadzenie({}, forma({ id: String(z.id), scope: ["read"] }));
        expect(w.error).toContain("sudo");
        expect(w.potwierdzenie).toBe("sudo");
        const [d] = await sql`select approved_at from device_codes where id = ${z.id}`;
        expect(d.approved_at).toBeNull(); // samo hasło przy włączonym 2FA nie wystarcza
      } finally {
        await wylacz2fa();
      }
    });

    it("2FA włączone i sudo aktywne: zatwierdza bez hasła", async () => {
      await wlacz2fa();
      try {
        sudo.doKiedy = Date.now() + 5 * 60_000;
        const { zatwierdzUrzadzenie } = await import("./devices");
        const z = await noweZadanie("z sudo");
        const w = await zatwierdzUrzadzenie({}, forma({ id: String(z.id), scope: ["read"] }));
        expect(w.ok, w.error).toBe(true);
        const [d] = await sql`select approved_at from device_codes where id = ${z.id}`;
        expect(d.approved_at).not.toBeNull();
      } finally {
        await wylacz2fa();
      }
    });

    it("odrzucenie nie wymaga sudo ani hasła i zostawia device_denied", async () => {
      await wlacz2fa();
      try {
        const { zatwierdzUrzadzenie } = await import("./devices");
        const z = await noweZadanie("odrzucenie");
        const w = await zatwierdzUrzadzenie({}, forma({ id: String(z.id), decyzja: "odrzuc" }));
        expect(w.ok, w.error).toBe(true);
        const [d] = await sql`select denied_at from device_codes where id = ${z.id}`;
        expect(d.denied_at).not.toBeNull();
        expect((await zdarzenia("device_denied"))[0].detail.zadanieId).toBe(z.id);
      } finally {
        await wylacz2fa();
      }
    });

    it("znajdzKod podpowiada, czego zażąda zatwierdzenie (hasło / sudo / nic)", async () => {
      const { znajdzKod } = await import("./devices");
      const z = await noweZadanie("podpowiedz");
      expect((await znajdzKod({}, forma({ kod: z.userCode }))).potwierdzenie).toBe("haslo");
      await wlacz2fa();
      try {
        expect((await znajdzKod({}, forma({ kod: z.userCode }))).potwierdzenie).toBe("sudo");
        sudo.doKiedy = Date.now() + 60_000;
        expect((await znajdzKod({}, forma({ kod: z.userCode }))).potwierdzenie).toBe("aktywne");
      } finally {
        await wylacz2fa();
      }
    });

    it("zbiorcze odrzucenie zostawia jeden wpis device_denied z liczbą", async () => {
      const { odrzucOczekujace } = await import("./devices");
      await noweZadanie("zbiorcze");
      const w = await odrzucOczekujace();
      expect(w.ok).toBe(true);
      expect((await zdarzenia("device_denied"))[0].detail.zbiorczo).toBe(true);
    });
  });

  describe("token importu", () => {
    it("2FA wyłączone: token importu jest ZABLOKOWANY nawet z poprawnym hasłem (ADR-030, 17.10.2026), nic nie powstaje", async () => {
      const { utworzTokenImportuAkcja } = await import("./devices");
      const [{ przed }] = await sql`select count(*)::int as przed from api_tokens where created_via = 'ui' and name like 'token importu%'`;
      for (let i = 0; i < 2; i++) {
        const w = await utworzTokenImportuAkcja();
        expect(w.error).toBe("Włącz 2FA, żeby łączyć urządzenia");
        expect(w.potwierdzenie).toBe("haslo");
        expect(w.token).toBeUndefined();
      }
      const [{ po }] = await sql`select count(*)::int as po from api_tokens where created_via = 'ui' and name like 'token importu%'`;
      expect(po).toBe(przed);
      expect(await zdarzenia("token_created")).toHaveLength(0);
    });

    it("2FA włączone bez sudo: token importu nie powstaje; z sudo powstaje", async () => {
      await wlacz2fa();
      try {
        const { utworzTokenImportuAkcja } = await import("./devices");
        const [{ przed }] = await sql`select count(*)::int as przed from api_tokens where name like 'token importu%'`;
        const bez = await utworzTokenImportuAkcja();
        expect(bez.error).toContain("sudo");
        expect(bez.token).toBeUndefined();
        const [{ po }] = await sql`select count(*)::int as po from api_tokens where name like 'token importu%'`;
        expect(po).toBe(przed);

        sudo.doKiedy = Date.now() + 60_000;
        const z = await utworzTokenImportuAkcja();
        expect(z.token).toMatch(/^tj_/);
        const [t] = await sql`select id from api_tokens where prefix = ${z.prefix as string}`;
        tokeny.push(t.id);

        const [wpis] = await zdarzenia("token_created");
        expect(wpis.token_id).toBe(t.id);
        expect(wpis.detail.tokenImportu).toBe(true);
        expect(wpis.detail.zakresy).toEqual(["read", "write", "propose", "import"]);
        expect(JSON.stringify(wpis)).not.toContain(z.token as string);
      } finally {
        await wylacz2fa();
      }
    });
  });

  describe("pozostałe wpisy w auth_events", () => {
    it("device/start zapisuje device_requested (kto, skąd, o co), device/token token_created z tokenId; w dzienniku nie ma kodów", async () => {
      const { zatwierdzUrzadzenie } = await import("./devices");
      const z = await noweZadanie("cykl");
      const [req] = await zdarzenia("device_requested");
      expect(req.detail.clientName).toBe(`cykl ${znacznik}`);
      expect(req.detail.zakresy).toEqual(["read"]);

      await wlacz2fa(); // zatwierdzenie wymaga 2FA i sudo (ADR-030, 17.10.2026)
      sudo.doKiedy = Date.now() + 60_000;
      await zatwierdzUrzadzenie({}, forma({ id: String(z.id), scope: ["read"] }));
      await wylacz2fa();
      await sql`update device_codes set last_polled_at = now() - interval '10 seconds' where id = ${z.id}`;
      const { POST } = await import("@/app/api/v2/device/token/route");
      const res = await POST(zadanie("/device/token", { metoda: "POST", cialo: { deviceCode: z.deviceCode }, ip: unikalnyIp() }), undefined);
      expect(res.status).toBe(200);
      const t = await res.json();
      tokeny.push(t.tokenId);
      const [tc] = await zdarzenia("token_created");
      expect(tc.token_id).toBe(t.tokenId);
      expect(tc.detail.via).toBe("device_code");
      expect(JSON.stringify(await sql`select * from auth_events where token_id = ${t.tokenId}`)).not.toContain(t.accessToken);

      // unieważnienie: bez sudo, wpis token_revoked z tokenId
      const { uniewaznUrzadzenie } = await import("./devices");
      expect((await uniewaznUrzadzenie(t.tokenId)).ok).toBe(true);
      expect((await zdarzenia("token_revoked"))[0].token_id).toBe(t.tokenId);
    });

    it("FK: wpisu o nieistniejącym tokenie nie da się zapisać (zapiszZdarzenie połyka błąd i loguje)", async () => {
      const { zapiszZdarzenie } = await import("@/lib/auth/second-factor");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      await zapiszZdarzenie("token_created", { tokenId: 999_999_999, detail: { testZnacznik: znacznik } });
      expect(spy).toHaveBeenCalled();
      const [{ ile }] = await sql`select count(*)::int as ile from auth_events where detail ->> 'testZnacznik' = ${znacznik}`;
      expect(ile).toBe(0);
    });
  });
});
