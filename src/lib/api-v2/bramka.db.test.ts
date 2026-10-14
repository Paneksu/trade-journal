import { sql as dsql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { contractHash } from "./contract/endpoints";
import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, unikalnyIp, zadanie, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Brama withApi na prawdziwej bazie: tokeny, zakresy, unieważnienie, wygaśnięcie,
 * limity, blokada, wyłącznik awaryjny, HTTPS, mapowanie błędów triggerów.
 * Pominięty bez lokalnej bazy tj_* (DATABASE_URL), więc raport musi to powiedzieć.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("withApi: brama tokenów (baza lokalna)", () => {
  let sql: Sql;
  const utworzone: number[] = [];
  const tok = async (scopes: string[], o?: Parameters<typeof nowyToken>[2]): Promise<Par> => {
    const t = await nowyToken(sql, scopes, o);
    utworzone.push(t.id);
    return t;
  };

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
  });
  afterAll(async () => {
    await sprzatnijPoTokenach(sql, utworzone);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function meta(req: Request) {
    const { GET } = await import("@/app/api/v2/meta/route");
    return GET(req, undefined);
  }

  it("bez tokenu 401 z WWW-Authenticate i kodem maszynowym", async () => {
    const res = await meta(zadanie("/meta"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect((await res.json()).code).toBe("unauthorized");
  });

  it("token o dobrym kształcie, ale nieznany = 401 bez zdradzania powodu", async () => {
    const wyg = await tok(["read"]);
    const falszywy = wyg.token.slice(0, -4) + "AAAA";
    const res = await meta(zadanie("/meta", { token: falszywy }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthorized");
  });

  it("poprawny token read: /meta zwraca contractHash zgodny z plikiem kontraktu", async () => {
    const t = await tok(["read"]);
    const res = await meta(zadanie("/meta", { token: t.token }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const dane = await res.json();
    expect(dane.apiVersion).toBe(2);
    expect(dane.contractHash).toBe(contractHash());
    expect(dane.scopes).toEqual(["read", "write", "propose", "import"]);
    expect(typeof dane.rulesVersion).toBe("number");
    expect(dane.limits.requestsPerMinute).toBe(120);
  });

  it("unieważniony token zwraca 401 token_revoked (po stwierdzeniu, że to prawdziwy token)", async () => {
    const t = await tok(["read"], { revokedAt: new Date(Date.now() - 1000) });
    const res = await meta(zadanie("/meta", { token: t.token }));
    expect(res.status).toBe(401);
    const dane = await res.json();
    expect(dane.code).toBe("token_revoked");
    expect(dane.error).toContain("unieważniony");
  });

  it("unieważnienie w locie: ten sam token działa, a po UPDATE revoked_at przestaje bez restartu", async () => {
    const t = await tok(["read"]);
    expect((await meta(zadanie("/meta", { token: t.token }))).status).toBe(200);
    await sql`update api_tokens set revoked_at = now(), revoked_reason = 'test' where id = ${t.id}`;
    expect((await meta(zadanie("/meta", { token: t.token }))).status).toBe(401);
  });

  it("wygasły token zwraca 401 token_expired", async () => {
    const t = await tok(["read"], { expiresAt: new Date(Date.now() - 60_000) });
    const res = await meta(zadanie("/meta", { token: t.token }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("token_expired");
  });

  it("token jeszcze niewygasły działa", async () => {
    const t = await tok(["read"], { expiresAt: new Date(Date.now() + 3_600_000) });
    expect((await meta(zadanie("/meta", { token: t.token }))).status).toBe(200);
  });

  it("brak zakresu = 403 z nazwą brakującego zakresu i listą tego, co token ma", async () => {
    const t = await tok(["read"]);
    const { POST } = await import("@/app/api/v2/notes/route");
    const res = await POST(zadanie("/notes", { metoda: "POST", token: t.token, cialo: { kind: "learning", title: "x" } }), undefined);
    expect(res.status).toBe(403);
    const dane = await res.json();
    expect(dane.code).toBe("insufficient_scope");
    expect(dane.missingScope).toBe("write");
    expect(dane.error).toContain("read");
  });

  it("token tylko propose nie czyta (zakresy się nie dziedziczą)", async () => {
    const t = await tok(["propose"]);
    const res = await meta(zadanie("/meta", { token: t.token }));
    expect(res.status).toBe(403);
    expect((await res.json()).missingScope).toBe("read");
  });

  it("limit 120 zapytań na minutę jest NA TOKEN, nie na adres", async () => {
    const a = await tok(["read"]);
    const b = await tok(["read"]);
    const ip = unikalnyIp();
    for (let i = 0; i < 120; i += 1) {
      expect((await meta(zadanie("/meta", { token: a.token, ip }))).status).toBe(200);
    }
    const przekroczony = await meta(zadanie("/meta", { token: a.token, ip }));
    expect(przekroczony.status).toBe(429);
    expect(przekroczony.headers.get("retry-after")).toBeTruthy();
    expect((await przekroczony.json()).code).toBe("rate_limited");
    // drugi token z tego samego adresu nie jest dotknięty
    expect((await meta(zadanie("/meta", { token: b.token, ip }))).status).toBe(200);
    // a ten sam token z innej sieci nadal jest ograniczony (urządzenie zmienia sieć, limit idzie za tokenem)
    expect((await meta(zadanie("/meta", { token: a.token, ip: unikalnyIp() }))).status).toBe(429);
  });

  it("po 8 błędnych tokenach adres jest zablokowany (429), także z poprawnym tokenem", async () => {
    const t = await tok(["read"]);
    const ip = unikalnyIp();
    for (let i = 0; i < 8; i += 1) {
      expect((await meta(zadanie("/meta", { token: "zly", ip }))).status).toBe(401);
    }
    const zablokowany = await meta(zadanie("/meta", { token: t.token, ip }));
    expect(zablokowany.status).toBe(429);
    expect((await zablokowany.json()).code).toBe("locked_out");
    expect((await meta(zadanie("/meta", { token: t.token, ip: unikalnyIp() }))).status).toBe(200);
  });

  it("wyłącznik awaryjny API_V2_DISABLED=1 = 404, nawet z poprawnym tokenem", async () => {
    const t = await tok(["read"]);
    vi.stubEnv("API_V2_DISABLED", "1");
    expect((await meta(zadanie("/meta", { token: t.token }))).status).toBe(404);
  });

  it("produkcja bez HTTPS = 403, z HTTPS przechodzi", async () => {
    const t = await tok(["read"]);
    vi.stubEnv("NODE_ENV", "production");
    expect((await meta(zadanie("/meta", { token: t.token }))).status).toBe(403);
    const res = await meta(zadanie("/meta", { token: t.token, naglowki: { "x-forwarded-proto": "https" } }));
    expect(res.status).toBe(200);
  });

  it("last_used_at zapisuje się przy pierwszym użyciu i nie częściej niż raz na minutę", async () => {
    const t = await tok(["read"]);
    const [przed] = await sql`select last_used_at from api_tokens where id = ${t.id}`;
    expect(przed.last_used_at).toBeNull();
    const ip = unikalnyIp();
    await meta(zadanie("/meta", { token: t.token, ip }));
    const [po1] = await sql`select last_used_at, last_used_ip from api_tokens where id = ${t.id}`;
    expect(po1.last_used_at).toBeInstanceOf(Date);
    expect(po1.last_used_ip).toBe(ip);
    await meta(zadanie("/meta", { token: t.token, ip: unikalnyIp() }));
    const [po2] = await sql`select last_used_at, last_used_ip from api_tokens where id = ${t.id}`;
    expect(po2.last_used_at.getTime()).toBe(po1.last_used_at.getTime());
    expect(po2.last_used_ip).toBe(ip);
    // po minucie zapis się odświeża
    await sql`update api_tokens set last_used_at = now() - interval '2 minutes' where id = ${t.id}`;
    await meta(zadanie("/meta", { token: t.token }));
    const [po3] = await sql`select last_used_at from api_tokens where id = ${t.id}`;
    expect(Date.now() - po3.last_used_at.getTime()).toBeLessThan(30_000);
  });

  it("wyjątek w handlerze = 500 bez szczegółów technicznych, z identyfikatorem do logów", async () => {
    const t = await tok(["read"]);
    const { withApi } = await import("./with-api");
    const res = await withApi({ scopes: ["read"] }, async () => {
      throw new Error("sekretna sciezka C:\\baza\\haslo");
    })(zadanie("/x", { token: t.token }), undefined);
    expect(res.status).toBe(500);
    const tekst = await res.text();
    expect(tekst).not.toContain("sekretna");
    expect(tekst).toContain("requestId");
    expect(console.error).toHaveBeenCalled();
  });

  it("trigger TJ403 z bazy wychodzi jako 403 approval_forbidden: błąd we własnym kodzie nie zatwierdzi reguły", async () => {
    const t = await tok(["read", "write", "propose", "import"]);
    // Reguła i jej wersja 'proposed' założone legalnie (jak robi POST /rules/proposals).
    const { POST } = await import("@/app/api/v2/rules/proposals/route");
    const utworzona = await POST(
      zadanie("/rules/proposals", {
        metoda: "POST",
        token: t.token,
        cialo: { title: `Bramka-test ${Date.now()}`, textMd: "Nie wchodzę po 11:00.", origin: "mentor", evidence: { video: "abc", t: 120, quote: "after eleven you are donating" } },
      }),
      undefined,
    );
    expect(utworzona.status).toBe(201);

    // Symulacja błędu we własnym kodzie: handler próbuje przestawić wersję na 'approved'.
    const { withApi } = await import("./with-api");
    const res = await withApi({ scopes: ["propose"] }, async (_r, api) => {
      await api.zapis((tx) =>
        tx.execute(dsql`update rule_versions set status = 'approved', ruleset_version = 1, decided_at = now() where created_by_token_id = ${t.id}`),
      );
      return Response.json({ ok: true });
    })(zadanie("/x", { token: t.token }), undefined);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("approval_forbidden");

    const [wersja] = await sql`select status from rule_versions where created_by_token_id = ${t.id}`;
    expect(wersja.status).toBe("proposed");
  });
});
