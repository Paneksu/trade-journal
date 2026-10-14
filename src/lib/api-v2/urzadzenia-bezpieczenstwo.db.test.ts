import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { czyInnyAdres } from "./adres";
import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, polacz, unikalnyIp, zadanie, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/* Poprawki krytyczne z audytu: phishing kodem urządzenia (ADR-030). */

describe("ekran zatwierdzenia: ostrzeżenie o innym adresie (logika czysta)", () => {
  it("ten sam adres, także IPv4 zapisany jako IPv6, nie ostrzega", () => {
    expect(czyInnyAdres("203.0.113.9", "203.0.113.9")).toBe(false);
    expect(czyInnyAdres("::ffff:127.0.0.1", "127.0.0.1")).toBe(false);
  });
  it("inny adres ostrzega; brak danych nie udaje pewności", () => {
    expect(czyInnyAdres("203.0.113.9", "198.51.100.4")).toBe(true);
    expect(czyInnyAdres(null, "198.51.100.4")).toBe(false);
    expect(czyInnyAdres("203.0.113.9", "nieznany")).toBe(false);
  });
});

describe("lista urządzeń nie ujawnia kodów oczekujących żądań", () => {
  const zrodlo = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");
  it("strona Ustawienia → Urządzenia nie odwołuje się do userCode", () => {
    const strona = zrodlo("../../app/(app)/settings/devices/page.tsx");
    expect(strona).not.toMatch(/userCode/);
    expect(strona).toContain("clientIp");
  });
  it("ekran zatwierdzenia podpisuje nazwę jako podaną przez urządzenie i ostrzega o innym IP", () => {
    const komponent = zrodlo("../../components/settings/devices.tsx");
    expect(komponent).toContain("podało samo urządzenie");
    expect(komponent).toContain("czyInnyAdres");
  });
  it("akcje zatwierdzenia i tworzenia tokenu importu wymagają potwierdzenia (sudo albo hasło) i zostawiają wpis w auth_events", () => {
    const akcje = zrodlo("../actions/devices.ts");
    expect(akcje).not.toMatch(/WARUNEK SCALENIA/); // TODO z fazy 2 zamknięte
    expect(akcje).toMatch(/wymagajPotwierdzenia\(sesja, String\(d\.get\("haslo"\)/);
    expect(akcje).toMatch(/wymagajPotwierdzenia\(sesja, haslo\)/);
    for (const rodzaj of ["device_approved", "device_denied", "token_created", "token_revoked"]) {
      expect(akcje, rodzaj).toContain(`"${rodzaj}"`);
    }
  });
});

describe.skipIf(!MOZNA_NA_BAZIE)("limit żądań, sprzątanie i wyłącznik device/start (baza lokalna)", () => {
  let sql: Sql;
  const nazwy: string[] = [];
  const znacznik = Date.now().toString(36);
  beforeAll(async () => {
    sql = polacz();
    // Test liczy GLOBALNY limit, więc zaczyna od pustej kolejki żądań w bazie testowej.
    await sql`delete from device_codes where token_id is null`;
  });
  afterAll(async () => {
    await sql`delete from device_codes where client_name = any(${nazwy})`;
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterAll(() => vi.unstubAllEnvs());

  async function start(nazwa: string) {
    const { POST } = await import("@/app/api/v2/device/start/route");
    nazwy.push(nazwa);
    return POST(zadanie("/device/start", { metoda: "POST", cialo: { clientName: nazwa, scopes: ["read"] }, ip: unikalnyIp() }), undefined);
  }

  it("21. niewygasłe żądanie jest odrzucone (429 too_many_pending), a po odrzuceniu jednego znów można", async () => {
    for (let i = 0; i < 20; i += 1) expect((await start(`limit ${i} ${znacznik}`)).status).toBe(200);
    const res = await start(`limit 21 ${znacznik}`);
    expect(res.status).toBe(429);
    const d = await res.json();
    expect(d.code).toBe("too_many_pending");
    expect(d.error).toContain("20");
    expect(res.headers.get("retry-after")).toBe("600");
    await sql`update device_codes set denied_at = now() where client_name = ${`limit 0 ${znacznik}`}`;
    expect((await start(`limit 22 ${znacznik}`)).status).toBe(200);
  });

  it("wygasłe żądania są sprzątane przy kolejnym starcie (po 10 minutach, nie po dobie)", async () => {
    await sql`insert into device_codes (device_code_sha256, user_code, client_name, requested_scopes, created_at, expires_at)
              values (${"a".repeat(64)}, 'BBBB-CCCC', ${`stare ${znacznik}`}, ${["read"]}, now() - interval '11 minutes', now() - interval '1 minute')`;
    nazwy.push(`stare ${znacznik}`);
    await sql`update device_codes set denied_at = now() where token_id is null and client_name like ${`limit %${znacznik}`}`;
    expect((await start(`po sprzataniu ${znacznik}`)).status).toBe(200);
    const [{ ile }] = await sql`select count(*)::int as ile from device_codes where client_name = ${`stare ${znacznik}`}`;
    expect(ile).toBe(0);
  });

  it("równoległe starty z wielu adresów nie przekraczają limitu 20 (blokada obejmuje też wstawienie)", async () => {
    await sql`delete from device_codes where token_id is null`;
    // Wstawienie spowolnione o 100 ms: bez blokady obejmującej INSERT wszystkie zliczyłyby 0 i wstawiły.
    await sql.unsafe("create or replace function tj_test_opoznij_kod() returns trigger language plpgsql as $$ begin perform pg_sleep(0.1); return new; end $$");
    await sql.unsafe("create trigger tj_test_opoznienie_kod before insert on device_codes for each row execute function tj_test_opoznij_kod()");
    try {
      const wyniki = await Promise.all(Array.from({ length: 30 }, (_, i) => start(`rownolegle ${i} ${znacznik}`)));
      const statusy = wyniki.map((r) => r.status);
      expect(statusy.filter((s) => s === 200)).toHaveLength(20);
      expect(statusy.filter((s) => s === 429)).toHaveLength(10);
      const [{ ile }] = await sql`select count(*)::int as ile from device_codes where client_name like ${`rownolegle %${znacznik}`}`;
      expect(ile).toBe(20);
    } finally {
      await sql.unsafe("drop trigger if exists tj_test_opoznienie_kod on device_codes");
      await sql.unsafe("drop function if exists tj_test_opoznij_kod()");
    }
  });

  it("«Odrzuć wszystkie oczekujące» zwalnia limit bez znajomości kodów i nie rusza już zatwierdzonych", async () => {
    const urz = await import("./urzadzenia");
    await sql`delete from device_codes where token_id is null`;
    for (let i = 0; i < 20; i += 1) await start(`zalew ${i} ${znacznik}`);
    expect((await start(`zalew 21 ${znacznik}`)).status).toBe(429);
    const [pierwszy] = await sql`select id from device_codes where client_name = ${`zalew 0 ${znacznik}`}`;
    await urz.zatwierdzKod(pierwszy.id, ["read"]);
    expect(await urz.odrzucWszystkieOczekujace()).toBe(19);
    const [zatw] = await sql`select approved_at, denied_at from device_codes where id = ${pierwszy.id}`;
    expect(zatw.approved_at).not.toBeNull();
    expect(zatw.denied_at).toBeNull();
    expect((await start(`po zalewie ${znacznik}`)).status).toBe(200);
  });

  it("DEVICE_LOGIN_DISABLED=1 zamyka device/start (403), a bez niej działa; device/token nadal odpowiada", async () => {
    await sql`delete from device_codes where token_id is null`;
    vi.stubEnv("DEVICE_LOGIN_DISABLED", "1");
    const zamkniete = await start(`wylaczone ${znacznik}`);
    expect(zamkniete.status).toBe(403);
    expect((await zamkniete.json()).code).toBe("device_login_disabled");
    const [{ ile }] = await sql`select count(*)::int as ile from device_codes where client_name = ${`wylaczone ${znacznik}`}`;
    expect(ile).toBe(0);
    const { POST } = await import("@/app/api/v2/device/token/route");
    const token = await POST(zadanie("/device/token", { metoda: "POST", cialo: { deviceCode: "x".repeat(43) } }), undefined);
    expect(token.status).toBe(400); // invalid_grant: trasa żyje, nie jest wyłączona przełącznikiem startu
    vi.unstubAllEnvs();
    expect((await start(`wlaczone ${znacznik}`)).status).toBe(200);
  });
});

describe.skipIf(!MOZNA_NA_BAZIE)("lista oczekujących nie niesie kodu (P2)", () => {
  it("oczekujaceKody() zwraca żądania bez pola userCode (typ i dane)", async () => {
    const sql = polacz();
    const nazwa = `P2 ${Date.now().toString(36)}`;
    try {
      const { POST } = await import("@/app/api/v2/device/start/route");
      await sql`delete from device_codes where token_id is null`;
      const res = await POST(zadanie("/device/start", { metoda: "POST", cialo: { clientName: nazwa, scopes: ["read"] }, ip: unikalnyIp() }), undefined);
      const { userCode } = await res.json();
      const urz = await import("./urzadzenia");
      const lista = await urz.oczekujaceKody();
      expect(lista.length).toBeGreaterThan(0);
      for (const z of lista) expect(Object.keys(z)).not.toContain("userCode");
      expect(JSON.stringify(lista)).not.toContain(userCode);
    } finally {
      await sql`delete from device_codes where client_name = ${nazwa}`;
      await sql.end();
    }
  });
});
