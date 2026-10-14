import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, parametry, polacz, sprzatnijPoTokenach, zadanie, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Rdzeń trade'ów przez API v2 (zapis zawsze przez persistTrade -> computeTrade)
 * oraz dzień (days/:date), sesje, pominięcia i oceny. Dowodem zapisu jest
 * ODCZYT Z BAZY po zapisie, nie sama odpowiedź HTTP.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("trades, days, sessions, skips, reviews przez v2 (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let kontoId = 0;
  const znacznik = Date.now().toString(36);
  const REF = `fxr:v2-${znacznik}`;
  /** Rok 1991: nie wchodzi w drogę innym danym lokalnej bazy. */
  const DZIEN = "1991-03-12";

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
    // Pozostalosci po przerwanym przebiegu: notatki dni bez konta z kwietnia 1991 (dni testowe).
    await sql`delete from day_notes where account_id is null and day between '1991-04-01' and '1991-04-30'`;
    rw = await nowyToken(sql, ["read", "write"]);
    ro = await nowyToken(sql, ["read"]);
    const [k] = await sql`insert into accounts (name, type) values (${`V2-TEST-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
  });
  afterAll(async () => {
    await sql`delete from trades where account_id = ${kontoId}`;
    await sql`delete from day_notes where day = ${DZIEN} or account_id = ${kontoId} or (account_id is null and day between '1991-04-01' and '1991-04-30')`;
    await sql`delete from ingest_skips where external_ref like ${`%v2-${znacznik}%`}`;
    await sql`delete from backtest_sessions where external_ref like ${`%v2-${znacznik}%`}`;
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const trade = (nr: number, nadpisz: Record<string, unknown> = {}) => ({
    externalRef: `${REF}-${nr}`,
    accountId: kontoId,
    symbol: "NQ1!",
    direction: "long",
    entryTime: `${DZIEN}T14:35:00Z`,
    entryPrice: 20000,
    contracts: 1,
    stopLoss: 19990,
    takeProfit: 20030,
    exits: [{ time: `${DZIEN}T14:50:00Z`, price: 20020 }],
    ...nadpisz,
  });

  async function wyslijTrady(trades: unknown[], extra: Record<string, unknown> = {}, token = rw.token) {
    const { POST } = await import("@/app/api/v2/trades/route");
    return POST(zadanie("/trades", { metoda: "POST", token, cialo: { trades, ...extra } }), undefined);
  }

  describe("trades", () => {
    it("zapis idzie przez computeTrade: wynik i ryzyko w centach czytamy z bazy (20 pkt NQ = 40000 c, ryzyko 10 pkt = 20000 c, 2R)", async () => {
      const res = await wyslijTrady([trade(1)]);
      expect(res.status).toBe(200);
      const dane = await res.json();
      expect(dane.summary.created).toBe(1);
      expect(dane.results[0].status).toBe("created");
      const id = dane.results[0].id as number;

      const [w] = await sql`select pnl::float8 as pnl, risk_amount::float8 as risk_amount, r_multiple::float8 as r, status::text as status, trading_day::text as dzien, source, external_ref from trades where id = ${id}`;
      expect(w).toMatchObject({ pnl: 40000, risk_amount: 20000, r: 2, status: "closed", dzien: DZIEN, source: "fxreplay", external_ref: `${REF}-1` });
    });

    it("persistTrade z tx czyta instrument w TEJ SAMEJ transakcji (instrument jeszcze niezatwierdzony) i nic nie zostaje po rollbacku", async () => {
      const { persistTrade } = await import("@/lib/trades/persist");
      const { db } = await import("@/lib/db");
      const { instruments } = await import("@/lib/db/schema");
      const symbol = `TX${znacznik}`.slice(0, 12).toUpperCase();
      class Wycofaj extends Error {}
      let wynik: Awaited<ReturnType<typeof persistTrade>> | null = null;
      await db
        .transaction(async (tx) => {
          const [i] = await tx.insert(instruments).values({ symbol, name: "Instrument testowy w transakcji", tickSize: "0.25", tickValue: 5000 }).returning({ id: instruments.id });
          wynik = await persistTrade(
            {
              id: null,
              accountId: kontoId,
              instrumentId: i.id,
              backtestSessionId: null,
              direction: "long",
              status: "closed",
              entryTime: new Date(`${DZIEN}T14:35:00Z`),
              entryPrice: 100,
              contracts: 1,
              wyjscia: [{ numer: 1, czas: new Date(`${DZIEN}T14:50:00Z`), cena: 101, kontrakty: null, kwotaBrokera: null, notatka: null }],
              stopLoss: 99,
              takeProfit: null,
              mae: null,
              mfe: null,
              brokerAmount: null,
              note: undefined,
              moodNote: undefined,
              readiness: undefined,
              custom: undefined,
              tags: undefined,
            },
            undefined,
            { tx },
          );
          throw new Wycofaj();
        })
        .catch((e) => {
          if (!(e instanceof Wycofaj)) throw e;
        });
      expect(wynik, JSON.stringify(wynik)).toMatchObject({ ok: true });
      const [{ ile }] = await sql`select count(*)::int as ile from instruments where symbol = ${symbol}`;
      expect(ile).toBe(0);
    });

    it("dryRun liczy bez zapisu", async () => {
      const res = await wyslijTrady([trade(2)], { dryRun: true });
      const dane = await res.json();
      expect(dane.results[0].status).toBe("created");
      expect(dane.results[0].preview.pnl).toBe(40000);
      const [{ ile }] = await sql`select count(*)::int as ile from trades where external_ref = ${`${REF}-2`}`;
      expect(ile).toBe(0);
    });

    it("ponowne wysłanie tej samej paczki jest idempotentne (unchanged, jeden wiersz)", async () => {
      await wyslijTrady([trade(3)]);
      const drugi = await (await wyslijTrady([trade(3)])).json();
      expect(drugi.results[0].status).toBe("unchanged");
      const [{ ile }] = await sql`select count(*)::int as ile from trades where external_ref = ${`${REF}-3`}`;
      expect(ile).toBe(1);
    });

    it("mode=update zmienia treść, a edycja użytkownika w aplikacji wygrywa (conflict)", async () => {
      await wyslijTrady([trade(4)]);
      const zmiana = await (await wyslijTrady([trade(4, { exits: [{ time: `${DZIEN}T14:55:00Z`, price: 20010 }] })], { mode: "update" })).json();
      expect(zmiana.results[0].status).toBe("updated");
      const [w] = await sql`select pnl::float8 as pnl from trades where external_ref = ${`${REF}-4`}`;
      expect(w.pnl).toBe(20000);
      await sql`update trades set note = 'poprawka użytkownika', updated_at = now() + interval '1 minute' where external_ref = ${`${REF}-4`}`;
      const konflikt = await (await wyslijTrady([trade(4, { exits: [{ time: `${DZIEN}T14:56:00Z`, price: 20030 }] })], { mode: "update" })).json();
      expect(konflikt.results[0].status).toBe("conflict");
      const [po] = await sql`select pnl::float8 as pnl, note from trades where external_ref = ${`${REF}-4`}`;
      expect(po).toMatchObject({ pnl: 20000, note: "poprawka użytkownika" });
    });

    it("jedna zła pozycja nie blokuje reszty, a błąd mówi pole + wartość + czego oczekiwano", async () => {
      const res = await wyslijTrady([trade(5), trade(6, { entryTime: "1991-03-12T14:35:00" }), trade(7, { accountId: 999_999 })]);
      const dane = await res.json();
      expect(dane.results.map((r: { status: string }) => r.status)).toEqual(["created", "error", "error"]);
      expect(dane.results[1].error).toContain("pole entryTime");
      expect(dane.results[1].error).toContain("1991-03-12T14:35:00");
      expect(dane.results[2].error).toContain("pole accountId");
      expect(dane.results[2].error).toContain("999999");
    });

    it("token tylko do odczytu nie zapisze trade'ów (403), ale je wyliczy", async () => {
      expect((await wyslijTrady([trade(8)], {}, ro.token)).status).toBe(403);
      const { GET } = await import("@/app/api/v2/trades/route");
      const lista = await (await GET(zadanie(`/trades?refs=${REF}-1`, { token: ro.token }), undefined)).json();
      expect(lista.trades).toHaveLength(1);
      expect(lista.trades[0].externalRef).toBe(`${REF}-1`);
      expect(lista.trades[0].editedInApp).toBe(false);
    });

    it("GET /trades: zły parametr = 400 z wartością", async () => {
      const { GET } = await import("@/app/api/v2/trades/route");
      const res = await GET(zadanie("/trades?limit=9999", { token: ro.token }), undefined);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("9999");
    });
  });

  describe("sesje, pominięcia, oceny", () => {
    it("sesja: 201 dla nowej, 200 dla istniejącej, a trade można przypiąć przez sessionRef", async () => {
      const { POST } = await import("@/app/api/v2/backtest-sessions/route");
      const cialo = { externalRef: `fxr:sesja-v2-${znacznik}`, name: `Sesja v2 ${znacznik}`, kind: "backtest", symbol: "NQ1!" };
      const a = await POST(zadanie("/backtest-sessions", { metoda: "POST", token: rw.token, cialo }), undefined);
      expect(a.status).toBe(201);
      const b = await POST(zadanie("/backtest-sessions", { metoda: "POST", token: rw.token, cialo }), undefined);
      expect(b.status).toBe(200);
      expect((await b.json()).created).toBe(false);

      const res = await wyslijTrady([trade(20, { sessionRef: cialo.externalRef })]);
      const id = (await res.json()).results[0].id;
      const [w] = await sql`select backtest_session_id from trades where id = ${id}`;
      expect(w.backtest_session_id).toBe((await a.json()).id);
    });

    it("pominięcie: kolejne wysłanie trade'a o tym kluczu daje skipped", async () => {
      const ref = `${REF}-pominiety`;
      const { POST } = await import("@/app/api/v2/skips/route");
      const res = await POST(zadanie("/skips", { metoda: "POST", token: rw.token, cialo: { skips: [{ externalRef: ref, note: "test" }] } }), undefined);
      expect((await res.json()).results[0].status).toBe("recorded");
      const dane = await (await wyslijTrady([trade(21, { externalRef: ref })])).json();
      expect(dane.results[0].status).toBe("skipped");
    });

    it("ocena AI: 201 przy nowej, 200 przy podmianie, 404 dla nieistniejącego trade'a", async () => {
      const id = (await (await wyslijTrady([trade(22)])).json()).results[0].id;
      const { POST } = await import("@/app/api/v2/trades/[id]/reviews/route");
      const ocena = { basis: "chart", summaryMd: "Setup zgodny z planem.", ruleChecks: [{ ruleId: "R-007", ruleText: "Nie po 11:00", verdict: "pass" }] };
      const a = await POST(zadanie(`/trades/${id}/reviews`, { metoda: "POST", token: rw.token, cialo: ocena }), parametry({ id: String(id) }));
      expect(a.status).toBe(201);
      const b = await POST(zadanie(`/trades/${id}/reviews`, { metoda: "POST", token: rw.token, cialo: ocena }), parametry({ id: String(id) }));
      expect(b.status).toBe(200);
      const [{ ile }] = await sql`select count(*)::int as ile from trade_reviews where trade_id = ${id}`;
      expect(ile).toBe(1);
      const nie = await POST(zadanie("/trades/999999999/reviews", { metoda: "POST", token: rw.token, cialo: ocena }), parametry({ id: "999999999" }));
      expect(nie.status).toBe(404);
      const zlyId = await POST(zadanie("/trades/abc/reviews", { metoda: "POST", token: rw.token, cialo: ocena }), parametry({ id: "abc" }));
      expect(zlyId.status).toBe(400);
    });
  });

  describe("days/:date", () => {
    const put = async (data: string, cialo: unknown, token = rw.token) => {
      const { PUT } = await import("@/app/api/v2/days/[date]/route");
      return PUT(zadanie(`/days/${data}`, { metoda: "PUT", token, cialo }), parametry({ date: data }));
    };
    const get = async (data: string, query = "", token = ro.token) => {
      const { GET } = await import("@/app/api/v2/days/[date]/route");
      return GET(zadanie(`/days/${data}${query}`, { token }), parametry({ date: data }));
    };

    it("zapis i odczyt notatki dnia konta; powtórny zapis nadpisuje tylko podane pola", async () => {
      const a = await put("1991-04-01", { accountId: kontoId, preSession: "Bias long, unieważnienie pod 19900.", mood: 4, energy: 3 });
      expect(a.status).toBe(201);
      const b = await put("1991-04-01", { accountId: kontoId, postSession: "Zgodnie z planem." });
      expect(b.status).toBe(200);
      const dzien = await (await get("1991-04-01", `?accountId=${kontoId}`)).json();
      expect(dzien.dayNote).toMatchObject({ preSession: "Bias long, unieważnienie pod 19900.", postSession: "Zgodnie z planem.", mood: 4, energy: 3, noTrade: false });
      const [w] = await sql`select pre_session, post_session from day_notes where day = '1991-04-01' and account_id = ${kontoId}`;
      expect(w).toMatchObject({ pre_session: "Bias long, unieważnienie pod 19900.", post_session: "Zgodnie z planem." });
    });

    it("dzień z trade'ami nie może być dniem bez transakcji (409), a dzień pusty może", async () => {
      await wyslijTrady([trade(30)]);
      // dziennik bez konta: ta zasada w aplikacji jest globalna dla dnia
      const konflikt = await put(DZIEN, { noTrade: true, noTradeReason: "no_setup" });
      expect(konflikt.status).toBe(409);
      expect((await konflikt.json()).code).toBe("day_has_trades");
      const ok = await put("1991-04-02", { noTrade: true, noTradeReason: "no_setup" });
      expect(ok.status).toBe(201);
      const dzien = await (await get("1991-04-02")).json();
      expect(dzien.dayNote).toMatchObject({ noTrade: true, noTradeReason: "no_setup" });
    });

    it("odznaczenie noTrade czyści powód (bez osieroconego powodu)", async () => {
      await put("1991-04-03", { noTrade: true, noTradeReason: "no_setup" });
      await put("1991-04-03", { noTrade: false });
      const dzien = await (await get("1991-04-03")).json();
      expect(dzien.dayNote).toMatchObject({ noTrade: false, noTradeReason: null });
    });

    it("GET dnia zbiera trade'y konta; błędne wejścia dają 400/404/422 z komunikatem", async () => {
      const dzien = await (await get(DZIEN, `?accountId=${kontoId}`)).json();
      expect(dzien.trades.length).toBeGreaterThan(0);
      expect((await get("2026-02-30")).status).toBe(400);
      expect((await get("wczoraj")).status).toBe(400);
      expect((await put("1991-04-04", { accountId: 999_999, mood: 3 })).status).toBe(404);
      expect((await put("1991-04-04", { accountId: kontoId, sessionId: 1 })).status).toBe(422);
      expect((await put("1991-04-04", { mood: 9 })).status).toBe(400);
      expect((await put("1991-04-04", { noTradeReason: "wymyślony" })).status).toBe(422);
      expect((await put("1991-04-04", { mood: 3 }, ro.token)).status).toBe(403);
    });
  });
});
