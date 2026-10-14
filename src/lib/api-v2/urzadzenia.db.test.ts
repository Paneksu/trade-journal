import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { REGEX_TOKEN_V2 } from "./token";
import { MOZNA_NA_BAZIE, polacz, unikalnyIp, zadanie, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Logowanie kodem urządzenia (ADR-030, wzór RFC 8628) od `device/start` przez
 * zatwierdzenie w aplikacji do tokenu wydanego dokładnie raz, oraz strona
 * Urządzenia (lista, zakresy, ostatnie użycie, unieważnienie).
 */
describe.skipIf(!MOZNA_NA_BAZIE)("device code: start, zatwierdzenie, token raz (baza lokalna)", () => {
  let sql: Sql;
  const stworzoneTokeny: number[] = [];
  const nazwy: string[] = [];
  const znacznik = Date.now().toString(36);

  beforeAll(async () => {
    sql = polacz();
  });
  afterAll(async () => {
    if (stworzoneTokeny.length > 0) {
      await sql`delete from device_codes where token_id = any(${stworzoneTokeny})`;
      await sql`delete from api_tokens where id = any(${stworzoneTokeny})`;
    }
    if (nazwy.length > 0) await sql`delete from device_codes where client_name = any(${nazwy})`;
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const nazwa = (s: string) => {
    const n = `${s} ${znacznik}`;
    nazwy.push(n);
    return n;
  };

  async function start(cialo: unknown, ip = unikalnyIp()) {
    const { POST } = await import("@/app/api/v2/device/start/route");
    return POST(zadanie("/device/start", { metoda: "POST", cialo, ip }), undefined);
  }
  async function odpytaj(deviceCode: string, ip = unikalnyIp()) {
    const { POST } = await import("@/app/api/v2/device/token/route");
    return POST(zadanie("/device/token", { metoda: "POST", cialo: { deviceCode }, ip }), undefined);
  }
  async function meta(token: string) {
    const { GET } = await import("@/app/api/v2/meta/route");
    return GET(zadanie("/meta", { token }), undefined);
  }
  /** Bez czekania 5 s: cofa znacznik ostatniego odpytania. */
  const odswiez = (deviceCodeSha: string) => sql`update device_codes set last_polled_at = now() - interval '10 seconds' where device_code_sha256 = ${deviceCodeSha}`;
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  it("start zwraca kod urządzenia, kod do przepisania, adres, czas życia 600 s i interwał 5 s", async () => {
    const res = await start({ clientName: nazwa("tj na laptopie"), scopes: ["read", "write"] });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(d.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(d.verificationUri).toMatch(/\/urzadzenia\/polacz$/);
    expect(d.verificationUri).not.toContain(d.userCode); // kod się przepisuje, nie klika
    expect(d.expiresIn).toBe(600);
    expect(d.interval).toBe(5);
    // w bazie leży tylko skrót device_code
    const [w] = await sql`select device_code_sha256, expires_at - created_at as zywotnosc from device_codes where user_code = ${d.userCode}`;
    expect(w.device_code_sha256).toBe(sha(d.deviceCode));
    expect(w.device_code_sha256).not.toContain(d.deviceCode);
  });

  it("start: zły zakres (w tym «approve»), pusta lista i duplikaty są odrzucone", async () => {
    expect((await start({ clientName: "x", scopes: ["approve"] })).status).toBe(400);
    expect((await start({ clientName: "x", scopes: ["read", "approve"] })).status).toBe(400);
    expect((await start({ clientName: "x", scopes: [] })).status).toBe(400);
    expect((await start({ clientName: "x", scopes: ["read", "read"] })).status).toBe(400);
    expect((await start({ clientName: "", scopes: ["read"] })).status).toBe(400);
    expect((await start({ clientName: "x", scopes: ["read"], extra: 1 })).status).toBe(400);
  });

  it("start jest publiczny, ale limitowany: 11. start z jednego adresu w godzinie = 429", async () => {
    const ip = unikalnyIp();
    for (let i = 0; i < 10; i += 1) {
      expect((await start({ clientName: nazwa(`limit ${i}`), scopes: ["read"] }, ip)).status).toBe(200);
    }
    const res = await start({ clientName: nazwa("limit 11"), scopes: ["read"] }, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await start({ clientName: nazwa("inny adres"), scopes: ["read"] }, unikalnyIp())).status).toBe(200);
  });

  it("pełna ścieżka: oczekiwanie -> zatwierdzenie w aplikacji z zawężeniem -> token RAZ -> token działa -> drugi odbiór odrzucony", async () => {
    const urz = await import("./urzadzenia");
    const s = await (await start({ clientName: nazwa("pełna ścieżka"), scopes: ["read", "write", "propose"] })).json();
    const shaKodu = sha(s.deviceCode);

    // 1. przed zatwierdzeniem: authorization_pending
    const czeka = await odpytaj(s.deviceCode);
    expect(czeka.status).toBe(400);
    expect((await czeka.json()).code).toBe("authorization_pending");

    // 2. ekran aplikacji: użytkownik przepisuje kod (małe litery, bez kreski) i widzi nazwę, adres IP i zakresy
    const znaleziony = await urz.znajdzKodDoZatwierdzenia(s.userCode.toLowerCase().replace("-", ""));
    expect(znaleziony.ok).toBe(true);
    if (!znaleziony.ok) return;
    expect(znaleziony.kod.clientName).toBe(`pełna ścieżka ${znacznik}`);
    expect(znaleziony.kod.requestedScopes).toEqual(["read", "write", "propose"]);
    expect(znaleziony.kod.clientIp).toMatch(/^198\.51\./);

    // 3. zawężenie: bez propose
    const zatw = await urz.zatwierdzKod(znaleziony.kod.id, ["read", "write"]);
    expect(zatw).toEqual({ ok: true, scopes: ["read", "write"] });

    // 4. token wydawany przy odpytaniu, nie przy zatwierdzeniu: do tej chwili w bazie go nie ma
    const [przed] = await sql`select token_id, consumed_at from device_codes where device_code_sha256 = ${shaKodu}`;
    expect(przed.token_id).toBeNull();
    await odswiez(shaKodu);
    const wydany = await odpytaj(s.deviceCode);
    expect(wydany.status).toBe(200);
    const t = await wydany.json();
    stworzoneTokeny.push(t.tokenId);
    expect(t.accessToken).toMatch(REGEX_TOKEN_V2);
    expect(t.tokenType).toBe("Bearer");
    expect(t.scopes).toEqual(["read", "write"]);

    // w bazie tylko skrót tokenu, nigdy jawny token
    const [w] = await sql`select token_sha256, name, scopes, created_via from api_tokens where id = ${t.tokenId}`;
    expect(w.token_sha256).toBe(sha(t.accessToken));
    expect(w.created_via).toBe("device_code");
    expect(w.name).toBe(`pełna ścieżka ${znacznik}`);
    expect(w.scopes).toEqual(["read", "write"]);
    const wszystko = JSON.stringify(await sql`select * from device_codes where device_code_sha256 = ${shaKodu}`);
    expect(wszystko).not.toContain(t.accessToken);

    // 5. token działa w API v2
    expect((await meta(t.accessToken)).status).toBe(200);

    // 6. drugi odbiór tego samego kodu: token wydaje się dokładnie raz
    await odswiez(shaKodu);
    const drugi = await odpytaj(s.deviceCode);
    expect(drugi.status).toBe(400);
    expect((await drugi.json()).code).toBe("invalid_grant");
    const [{ ile }] = await sql`select count(*)::int as ile from api_tokens where name = ${`pełna ścieżka ${znacznik}`}`;
    expect(ile).toBe(1);
  });

  it("rownolegle odpytania zatwierdzonego kodu wydaja DOKLADNIE jeden token", async () => {
    const urz = await import("./urzadzenia");
    const s = await (await start({ clientName: nazwa("wyścig"), scopes: ["read"] })).json();
    const k = await urz.znajdzKodDoZatwierdzenia(s.userCode);
    if (!k.ok) throw new Error(k.komunikat);
    await urz.zatwierdzKod(k.kod.id, ["read"]);
    await odswiez(sha(s.deviceCode));
    const wyniki = await Promise.all([odpytaj(s.deviceCode), odpytaj(s.deviceCode), odpytaj(s.deviceCode), odpytaj(s.deviceCode)]);
    const statusy = wyniki.map((r) => r.status).sort();
    expect(statusy).toEqual([200, 400, 400, 400]);
    for (const r of wyniki) {
      if (r.status === 200) stworzoneTokeny.push((await r.json()).tokenId);
    }
    const [{ ile }] = await sql`select count(*)::int as ile from api_tokens where name = ${`wyścig ${znacznik}`}`;
    expect(ile).toBe(1);
  });

  it("nie da się nadać więcej, niż urządzenie poprosiło (ani zakresu «approve»), ani zero zakresów", async () => {
    const urz = await import("./urzadzenia");
    const s = await (await start({ clientName: nazwa("zakresy"), scopes: ["read"] })).json();
    const k = await urz.znajdzKodDoZatwierdzenia(s.userCode);
    if (!k.ok) throw new Error(k.komunikat);
    const wiecej = await urz.zatwierdzKod(k.kod.id, ["read", "write"]);
    expect(wiecej.ok).toBe(false);
    if (!wiecej.ok) expect(wiecej.komunikat).toContain("write");
    const approve = await urz.zatwierdzKod(k.kod.id, ["approve"]);
    expect(approve.ok).toBe(false);
    expect((await urz.zatwierdzKod(k.kod.id, [])).ok).toBe(false);
    const [w] = await sql`select approved_at from device_codes where id = ${k.kod.id}`;
    expect(w.approved_at).toBeNull();
  });

  it("odrzucenie w aplikacji: terminal dostaje 403 access_denied, a token nie powstaje", async () => {
    const urz = await import("./urzadzenia");
    const s = await (await start({ clientName: nazwa("odrzucony"), scopes: ["read"] })).json();
    const k = await urz.znajdzKodDoZatwierdzenia(s.userCode);
    if (!k.ok) throw new Error(k.komunikat);
    expect((await urz.odrzucKod(k.kod.id)).ok).toBe(true);
    await odswiez(sha(s.deviceCode));
    const res = await odpytaj(s.deviceCode);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("access_denied");
    // po decyzji kod nie nadaje się już do zatwierdzenia
    expect((await urz.znajdzKodDoZatwierdzenia(s.userCode)).ok).toBe(false);
    expect((await urz.zatwierdzKod(k.kod.id, ["read"])).ok).toBe(false);
  });

  it("wygasły kod urządzenia: expired_token przy odpytaniu i brak możliwości zatwierdzenia", async () => {
    const urz = await import("./urzadzenia");
    const s = await (await start({ clientName: nazwa("wygasły"), scopes: ["read"] })).json();
    await sql`update device_codes set expires_at = now() - interval '1 second', created_at = now() - interval '11 minutes' where device_code_sha256 = ${sha(s.deviceCode)}`;
    const res = await odpytaj(s.deviceCode);
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.code).toBe("expired_token");
    expect(d.error).toContain("tj login");
    const znaleziony = await urz.znajdzKodDoZatwierdzenia(s.userCode);
    expect(znaleziony.ok).toBe(false);
    if (!znaleziony.ok) expect(znaleziony.komunikat).toContain("wygasł");
  });

  it("zatwierdzony, ale nieodebrany kod też wygasa: po 10 minutach token już nie powstanie", async () => {
    const urz = await import("./urzadzenia");
    const s = await (await start({ clientName: nazwa("zatwierdzony i wygasły"), scopes: ["read"] })).json();
    const k = await urz.znajdzKodDoZatwierdzenia(s.userCode);
    if (!k.ok) throw new Error(k.komunikat);
    await urz.zatwierdzKod(k.kod.id, ["read"]);
    await sql`update device_codes set expires_at = now() - interval '1 second' where id = ${k.kod.id}`;
    const res = await odpytaj(s.deviceCode);
    expect((await res.json()).code).toBe("expired_token");
    const [{ ile }] = await sql`select count(*)::int as ile from api_tokens where name = ${`zatwierdzony i wygasły ${znacznik}`}`;
    expect(ile).toBe(0);
  });

  it("zbyt częste odpytywanie = 429 slow_down; nieznany kod = invalid_grant", async () => {
    const s = await (await start({ clientName: nazwa("slow down"), scopes: ["read"] })).json();
    const pierwsze = await odpytaj(s.deviceCode);
    expect((await pierwsze.json()).code).toBe("authorization_pending");
    const drugie = await odpytaj(s.deviceCode);
    expect(drugie.status).toBe(429);
    expect((await drugie.json()).code).toBe("slow_down");
    const nieznany = await odpytaj("x".repeat(43));
    expect(nieznany.status).toBe(400);
    expect((await nieznany.json()).code).toBe("invalid_grant");
  });

  it("odpytywanie ma limit na adres (61. zapytanie w minucie = 429)", async () => {
    const ip = unikalnyIp();
    for (let i = 0; i < 60; i += 1) await odpytaj("y".repeat(43), ip);
    expect((await odpytaj("y".repeat(43), ip)).status).toBe(429);
  });

  it("złe formaty: kod za krótki i nieznane pola = 400", async () => {
    const { POST } = await import("@/app/api/v2/device/token/route");
    expect((await POST(zadanie("/device/token", { metoda: "POST", cialo: { deviceCode: "krotki" } }), undefined)).status).toBe(400);
    expect((await POST(zadanie("/device/token", { metoda: "POST", cialo: { deviceCode: "z".repeat(43), x: 1 } }), undefined)).status).toBe(400);
  });

  it("kod przepisany z błędem formatu daje czytelny komunikat z faktyczną wartością", async () => {
    const urz = await import("./urzadzenia");
    const w = await urz.znajdzKodDoZatwierdzenia("KTWM-4HQP");
    expect(w.ok).toBe(false);
    if (!w.ok) {
      expect(w.komunikat).toContain("KTWM-4HQP");
      expect(w.komunikat).toContain("8 liter");
    }
  });

  describe("strona Urządzenia: lista, ostatnie użycie, unieważnienie", () => {
    it("lista pokazuje zakresy, ostatnie użycie i status, a unieważnienie działa od razu", async () => {
      const urz = await import("./urzadzenia");
      const s = await (await start({ clientName: nazwa("lista"), scopes: ["read", "write"] })).json();
      const k = await urz.znajdzKodDoZatwierdzenia(s.userCode);
      if (!k.ok) throw new Error(k.komunikat);
      await urz.zatwierdzKod(k.kod.id, ["read"]);
      await odswiez(sha(s.deviceCode));
      const t = await (await odpytaj(s.deviceCode)).json();
      stworzoneTokeny.push(t.tokenId);

      let lista = await urz.listaTokenow();
      let wiersz = lista.find((x) => x.id === t.tokenId)!;
      expect(wiersz).toMatchObject({ name: `lista ${znacznik}`, scopes: ["read"], status: "aktywny", lastUsedAt: null, nieuzywany: false });

      const ip = unikalnyIp();
      const { GET } = await import("@/app/api/v2/meta/route");
      expect((await GET(zadanie("/meta", { token: t.accessToken, ip }), undefined)).status).toBe(200);
      lista = await urz.listaTokenow();
      wiersz = lista.find((x) => x.id === t.tokenId)!;
      expect(wiersz.lastUsedAt).toBeInstanceOf(Date);
      expect(wiersz.lastUsedIp).toBe(ip);

      expect(await urz.uniewaznToken(t.tokenId, "ui")).toEqual({ ok: true });
      expect((await meta(t.accessToken)).status).toBe(401);
      wiersz = (await urz.listaTokenow()).find((x) => x.id === t.tokenId)!;
      expect(wiersz.status).toBe("uniewazniony");
      expect(wiersz.revokedReason).toBe("ui");
      const drugi = await urz.uniewaznToken(t.tokenId);
      expect(drugi.ok).toBe(false);
    });

    it("token nieużywany od 90 dni jest oznaczony do rozważenia unieważnienia", async () => {
      const urz = await import("./urzadzenia");
      const s = await (await start({ clientName: nazwa("stary"), scopes: ["read"] })).json();
      const k = await urz.znajdzKodDoZatwierdzenia(s.userCode);
      if (!k.ok) throw new Error(k.komunikat);
      await urz.zatwierdzKod(k.kod.id, ["read"]);
      await odswiez(sha(s.deviceCode));
      const t = await (await odpytaj(s.deviceCode)).json();
      stworzoneTokeny.push(t.tokenId);
      await sql`update api_tokens set created_at = now() - interval '120 days' where id = ${t.tokenId}`;
      const w = (await urz.listaTokenow()).find((x) => x.id === t.tokenId)!;
      expect(w.nieuzywany).toBe(true);
      await sql`update api_tokens set last_used_at = now() - interval '2 days' where id = ${t.tokenId}`;
      expect((await urz.listaTokenow()).find((x) => x.id === t.tokenId)!.nieuzywany).toBe(false);
    });

    it("status tokenu: wygasły jest rozpoznany", async () => {
      const urz = await import("./urzadzenia");
      const teraz = new Date("2026-10-14T12:00:00Z");
      expect(urz.statusTokenu({ revokedAt: null, expiresAt: new Date("2026-10-14T11:59:59Z") }, teraz)).toBe("wygasly");
      expect(urz.statusTokenu({ revokedAt: null, expiresAt: null }, teraz)).toBe("aktywny");
      expect(urz.statusTokenu({ revokedAt: teraz, expiresAt: null }, teraz)).toBe("uniewazniony");
    });
  });
});
