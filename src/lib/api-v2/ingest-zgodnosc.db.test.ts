import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { skrotTokenu } from "@/lib/ingest/token";
import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, unikalnyIp, zadanie, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Zgodność wsteczna (ADR-030): /api/ingest/** przyjmuje stary skrót
 * (INGEST_TOKEN_SHA256) albo token v2 z zakresem write, a KAŻDA odpowiedź niesie
 * Deprecation i Link do /api/v2. Usunięcie tras dopiero po fazie 3, za zgodą.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("/api/ingest/** przyjmuje token v2 i stary skrót, z nagłówkiem Deprecation (baza lokalna)", () => {
  let sql: Sql;
  let write: Par;
  let readOnly: Par;
  let revoked: Par;
  let czytelnik: Par;
  const STARY = `tj_stary_token_${Date.now().toString(36)}_0123456789abcdef`;

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
    write = await nowyToken(sql, ["write"]);
    readOnly = await nowyToken(sql, ["read"]);
    revoked = await nowyToken(sql, ["read", "write"], { revokedAt: new Date(Date.now() - 1000) });
    czytelnik = await nowyToken(sql, ["read"]);
  });
  afterAll(async () => {
    await sprzatnijPoTokenach(sql, [write.id, readOnly.id, revoked.id, czytelnik.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("INGEST_TOKEN_SHA256", "");
  });

  const meta = async (token?: string) => {
    const { GET } = await import("@/app/api/ingest/meta/route");
    return GET(zadanie("/meta", { token, baza: "http://localhost/api/ingest" }), undefined);
  };
  const skips = async (token: string | undefined, ref: string) => {
    const { POST } = await import("@/app/api/ingest/skips/route");
    return POST(zadanie("/skips", { metoda: "POST", token, cialo: { skips: [{ externalRef: ref }] }, baza: "http://localhost/api/ingest" }), undefined);
  };
  const oznaczenie = (res: Response) => ({ deprecation: res.headers.get("deprecation"), link: res.headers.get("link") });
  const WYGASZANIE = { deprecation: "true", link: '</api/v2>; rel="successor-version"' };

  it("token v2 z zakresem write działa na ingest i odpowiedź niesie Deprecation + Link", async () => {
    const res = await skips(write.token, `tv:zgodnosc-${Date.now()}`);
    expect(res.status).toBe(200);
    expect(oznaczenie(res)).toEqual(WYGASZANIE);
    expect((await res.json()).results[0].status).toBe("recorded");
    await sql`delete from ingest_skips where external_ref like 'tv:zgodnosc-%'`;
  });

  it("token v2 bez zakresu write dostaje 403 z nazwą zakresu (też z Deprecation)", async () => {
    const res = await meta(readOnly.token);
    expect(res.status).toBe(403);
    const d = await res.json();
    expect(d.code).toBe("insufficient_scope");
    expect(d.missingScope).toBe("write");
    expect(oznaczenie(res)).toEqual(WYGASZANIE);
  });

  it("unieważniony token v2 = 401 z Deprecation", async () => {
    const res = await meta(revoked.token);
    expect(res.status).toBe(401);
    expect(oznaczenie(res)).toEqual(WYGASZANIE);
  });

  it("stary skrót z INGEST_TOKEN_SHA256 nadal działa, z Deprecation i wpisem w logu o użyciu starego tokenu", async () => {
    vi.stubEnv("INGEST_TOKEN_SHA256", skrotTokenu(STARY));
    const res = await meta(STARY);
    expect(res.status).toBe(200);
    expect(oznaczenie(res)).toEqual(WYGASZANIE);
    const log = (console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join("\n");
    expect(log).toContain("DEPRECATED");
    expect(log).toContain("INGEST_TOKEN_SHA256");
    expect((await res.json()).apiVersion).toBe(1); // stary kontrakt bez zmian
  });

  it("stary skrót i token v2 działają równolegle w tej samej instalacji", async () => {
    vi.stubEnv("INGEST_TOKEN_SHA256", skrotTokenu(STARY));
    expect((await meta(STARY)).status).toBe(200);
    expect((await meta(write.token)).status).toBe(200);
    expect((await meta("zly-token")).status).toBe(401);
  });

  it("bez starej zmiennej i bez tokenu v2 ingest nie istnieje (404 + Deprecation), ale token v2 go otwiera", async () => {
    const bezTokenu = await meta(undefined);
    expect(bezTokenu.status).toBe(404);
    expect(oznaczenie(bezTokenu)).toEqual(WYGASZANIE);
    expect((await meta(write.token)).status).toBe(200);
  });

  it("zły token v2 liczy się do blokady adresu (8 błędów = 429), tak jak w starym trybie", async () => {
    const ip = unikalnyIp();
    const { GET } = await import("@/app/api/ingest/meta/route");
    const zly = `${write.token.slice(0, -3)}zzz`;
    for (let i = 0; i < 8; i += 1) {
      const r = await GET(zadanie("/meta", { token: zly, ip, baza: "http://localhost/api/ingest" }), undefined);
      expect(r.status).toBe(401);
    }
    const zablokowany = await GET(zadanie("/meta", { token: write.token, ip, baza: "http://localhost/api/ingest" }), undefined);
    expect(zablokowany.status).toBe(429);
    expect(oznaczenie(zablokowany)).toEqual(WYGASZANIE);
  });

  it("trasa ingest/meta zwraca to samo co v2/meta poza wersją i polami kontraktu", async () => {
    const stare = await (await meta(write.token)).json();
    const { GET } = await import("@/app/api/v2/meta/route");
    const nowe = await (await GET(zadanie("/meta", { token: czytelnik.token }), undefined)).json();
    expect(stare.apiVersion).toBe(1);
    expect(nowe.apiVersion).toBe(2);
    expect(nowe.instruments).toEqual(stare.instruments);
    expect(nowe.intervals).toEqual(stare.intervals);
    expect(stare.contractHash).toBeUndefined();
  });
});
