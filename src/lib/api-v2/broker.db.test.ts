import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zadanie, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, wywolaj, zgodneZKontraktem } from "./test/pomocnik-2b";
import { CASH, ORDERS, wierszOrders } from "@/lib/brokerzy/testowe";
import type { TradeDraft } from "@/lib/domain/trade-draft";

vi.mock("server-only", () => ({}));

/*
 * Granica danych brokera i automat 1:1 (ADR-034 pkt 3, 4, 7) na PRAWDZIWEJ, lokalnej bazie i prawdziwych trasach:
 *  - token import_broker niczego innego nie otworzy, a tokeny read / write / propose nie otworza inboxa;
 *  - automat stosuje WYLACZNIE dopasowania 1:1 (z »Cofnij«), nigdy nie tworzy trade'ow ani nie przypisuje kont;
 *  - plik z blednymi wierszami nie jest stosowany, ten sam plik drugi raz to duplicate;
 *  - slepa ocena obejmuje dane brokera (resultHidden), sugestie broker_match i broker_trade wymagaja zatwierdzenia w UI.
 */
const sha = (t: string | Uint8Array) => createHash("sha256").update(typeof t === "string" ? Buffer.from(t, "utf8") : t).digest("hex");
const KONTO_PLIKU = "TST00000000001";
const DZIEN = "2026-10-14";

describe.skipIf(!MOZNA_NA_BAZIE)("dane brokera: granica tokenu, automat 1:1, slepa ocena, sugestie (baza lokalna)", { timeout: 30_000 }, () => {
  let sql: Sql;
  let broker: Par;
  let rw: Par;
  let ro: Par;
  let mnq = 0;
  let nq = 0;
  let kontoId = 0;
  let brokerAccountId = 0;
  let nazwaKonta = "";

  const inbox = async (tekst: string | Uint8Array, token = broker.token, naglowki: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/v2/broker/inbox/route");
    const res = await POST(
      zadanie("/broker/inbox", { metoda: "POST", token, surowe: tekst, naglowki: { "content-type": "text/csv", ...naglowki } }),
      undefined,
    );
    return { status: res.status, json: await res.json() };
  };
  const get = (modul: Promise<Record<string, unknown>>, sciezka: string, token = ro.token, ctx?: ReturnType<typeof PARAMS>) => wywolaj(modul, "GET", sciezka, { token }, ctx);

  /** Sprzatanie jako uzytkownik (aktor ui): baza nie pozwala usuwac danych brokera nikomu innemu. */
  async function sprzatnij() {
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      await tx`delete from broker_imports`;
      await tx`delete from broker_cash_events`;
      await tx`delete from trade_reviews where trade_id in (select id from trades where account_id = ${kontoId})`;
      await tx`delete from trades where account_id = ${kontoId}`;
      await tx`delete from ingest_skips where external_ref like 'brk:%'`;
      await tx`delete from broker_accounts where id <> ${brokerAccountId} and label_last4 in ('0001', '0009')`;
      await tx`delete from ai_suggestions where kind in ('broker_match', 'broker_trade')`;
    });
  }

  async function zapiszTrade(szkic: Partial<TradeDraft> & Pick<TradeDraft, "instrumentId" | "direction" | "entryTime" | "entryPrice" | "contracts">, wyjscie: { czas: string; cena: number }): Promise<number> {
    const { persistTrade } = await import("@/lib/trades/persist");
    const w = await persistTrade({
      id: null,
      accountId: kontoId,
      backtestSessionId: null,
      status: "closed",
      wyjscia: [{ numer: 1, czas: new Date(wyjscie.czas), cena: wyjscie.cena, kontrakty: null, kwotaBrokera: null, notatka: null }],
      stopLoss: null,
      takeProfit: null,
      mae: null,
      mfe: null,
      brokerAmount: null,
      ...szkic,
    });
    if (!w.ok) throw new Error(`persistTrade: ${w.error}`);
    return w.id;
  }

  /** Trade A dziennika (z poslizgiem ceny wejscia wzgledem brokera: 20100,00 zamiast 20100,25). */
  const tradeA = () =>
    zapiszTrade({ instrumentId: mnq, direction: "long", entryTime: new Date(`${DZIEN}T13:30:35Z`), entryPrice: 20100, contracts: 3 }, { czas: `${DZIEN}T13:34:50Z`, cena: 20112.5 });
  const tradeB = (przesuniecieS: number) =>
    zapiszTrade({ instrumentId: nq, direction: "short", entryTime: new Date(Date.parse(`${DZIEN}T14:10:00Z`) + przesuniecieS * 1000), entryPrice: 20250, contracts: 2 }, { czas: `${DZIEN}T14:15:30Z`, cena: 20240 });
  const tradeC = () =>
    zapiszTrade({ instrumentId: mnq, direction: "long", entryTime: new Date(`${DZIEN}T15:00:30Z`), entryPrice: 20300, contracts: 1 }, { czas: `${DZIEN}T15:05:00Z`, cena: 20305 });

  const wiersz = async (id: number) => (await sql`select pnl, pnl_estimate, fees, broker_amount, source, external_ref, contracts::float8 as contracts from trades where id = ${id}`)[0];

  beforeAll(async () => {
    await Promise.all([
      import("@/app/api/v2/broker/inbox/route"),
      import("@/app/api/v2/broker/trades/route"),
      import("@/app/api/v2/broker/trades/[id]/route"),
      import("@/app/api/v2/broker/status/route"),
      import("@/app/api/v2/days/[date]/accounts/route"),
      import("@/app/api/v2/trades/[id]/route"),
      import("@/app/api/v2/ai-suggestions/route"),
    ]);
    sql = polacz();
    await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
    const instr = async (symbol: string, tickValue: number, klasa: string) => {
      const [i] = await sql`select id from instruments where symbol = ${symbol}`;
      if (i) {
        await sql`update instruments set size_class = ${klasa}, tick_value = ${tickValue}, tick_size = 0.25 where id = ${i.id}`;
        return i.id as number;
      }
      return (await sql`insert into instruments (symbol, name, exchange, tick_size, tick_value, sort_order, size_class) values (${symbol}, ${symbol}, 'CME', 0.25, ${tickValue}, 90, ${klasa}) returning id`)[0].id as number;
    };
    mnq = await instr("MNQ", 500, "micro");
    nq = await instr("NQ", 5000, "mini");
    nazwaKonta = `BRK-api-${Date.now().toString(36)}`;
    const [k] = await sql`insert into accounts (name, type, fee_rt_mini_cents, fee_rt_micro_cents) values (${nazwaKonta}, 'live', 350, 100) returning id`;
    kontoId = k.id;
    broker = await nowyToken(sql, ["import_broker"], { expiresAt: new Date(Date.now() + 86_400_000), createdVia: "ui" });
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    // konto z pliku przypisane do konta dziennika (robi to uzytkownik w UI; tu: aktor ui, jak akcja)
    const { skrotKonta } = await import("@/lib/brokerzy/klucz");
    const s = skrotKonta("tradovate", KONTO_PLIKU);
    const [b] = await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      return tx`insert into broker_accounts (account_id, platform, method, external_account_hmac, label_last4) values (${kontoId}, 'tradovate', 'export_file', ${s.hmac}, ${s.ostatnie4}) returning id`;
    });
    brokerAccountId = b.id;
  }, 120_000);

  afterAll(async () => {
    await sprzatnij();
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      await tx`delete from broker_accounts where id = ${brokerAccountId}`;
    });
    await sql`delete from day_accounts where account_id = ${kontoId}`;
    await sql`delete from auth_events where token_id = ${broker.id}`;
    await sprzatnijNowe(sql, [rw.id, ro.id]);
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id]);
    await sql`delete from api_tokens where id = ${broker.id}`;
    await sql.end();
  });

  beforeEach(async () => {
    wyczyscLimiter();
    await sprzatnij();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  /* ------------------------------------------------------------ granica tokenu */

  describe("granica tokenu import_broker", () => {
    it("tokeny read / write / propose nie otwieraja inboxa (403 insufficient_scope), a nic nie zostaje w bazie", async () => {
      for (const t of [ro, rw]) {
        const r = await inbox(ORDERS, t.token);
        expect(r.status).toBe(403);
        expect(r.json).toMatchObject({ code: "insufficient_scope", missingScope: "import_broker" });
      }
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(0);
      expect((await sql`select count(*)::int as n from broker_imports`)[0].n).toBe(0);
      const ping = await wywolaj(import("@/app/api/v2/broker/inbox/route"), "GET", "/broker/inbox", { token: rw.token });
      expect(ping.status).toBe(403);
    });

    it("token import_broker niczego innego nie otworzy: odczyty, zapisy i kolejka dostaja 403", async () => {
      const sciezki: [string, Promise<Record<string, unknown>>, "GET" | "POST" | "PUT", string, unknown?, Record<string, string>?][] = [
        ["GET", import("@/app/api/v2/me/route"), "GET", "/me"],
        ["GET", import("@/app/api/v2/meta/route"), "GET", "/meta"],
        ["GET", import("@/app/api/v2/trades/route"), "GET", "/trades"],
        ["GET", import("@/app/api/v2/broker/trades/route"), "GET", "/broker/trades"],
        ["GET", import("@/app/api/v2/broker/status/route"), "GET", "/broker/status"],
        ["POST", import("@/app/api/v2/trades/route"), "POST", "/trades", { trades: [] }],
        ["POST", import("@/app/api/v2/ai-suggestions/route"), "POST", "/ai-suggestions", {}],
        ["PUT", import("@/app/api/v2/days/[date]/accounts/route"), "PUT", `/days/${DZIEN}/accounts`, { accountIds: [kontoId] }, { date: DZIEN }],
      ];
      for (const [, modul, metoda, sciezka, cialo, params] of sciezki) {
        const r = await wywolaj(modul, metoda, sciezka, { token: broker.token, cialo }, params ? PARAMS(params) : undefined);
        expect(r.status, `${metoda} ${sciezka}`).toBe(403);
        expect(r.json.code).toBe("insufficient_scope");
      }
      expect((await sql`select count(*)::int as n from day_accounts where account_id = ${kontoId}`)[0].n).toBe(0);
    });

    it("token uniewazniony albo wygasly dostaje 401; brak tokenu 401; ping zwraca formaty, limit i termin", async () => {
      const uniewazniony = await nowyToken(sql, ["import_broker"], { expiresAt: new Date(Date.now() + 86_400_000), createdVia: "ui", revokedAt: new Date() });
      const wygasly = await nowyToken(sql, ["import_broker"], { expiresAt: new Date(Date.now() - 1000), createdVia: "ui" });
      try {
        expect((await inbox(ORDERS, uniewazniony.token)).json.code).toBe("token_revoked");
        expect((await inbox(ORDERS, wygasly.token)).json.code).toBe("token_expired");
        const { POST } = await import("@/app/api/v2/broker/inbox/route");
        const bez = await POST(new Request("http://localhost/api/v2/broker/inbox", { method: "POST", body: ORDERS, headers: { "content-type": "text/csv", "x-forwarded-for": "198.51.100.77" } }), undefined);
        expect(bez.status).toBe(401);
      } finally {
        await sql`delete from api_tokens where id in (${uniewazniony.id}, ${wygasly.id})`;
      }
      const ping = await get(import("@/app/api/v2/broker/inbox/route"), "/broker/inbox", broker.token);
      expect(ping.status).toBe(200);
      expect(ping.json).toMatchObject({ accepts: ["tradovate_orders", "tradovate_cash_history"], maxBytes: 5 * 1024 * 1024 });
      zgodneZKontraktem("get", "/broker/inbox", ping.json);
    });

    it("baza tez pilnuje: zapis do tabel brokera z aktorem tokenu AI to TJ403, a z aktorem tokenu importu przechodzi", async () => {
      const { zapisZAktorem } = await import("./zapis");
      const wstaw = (aktor: string) =>
        zapisZAktorem(aktor, async (tx) => {
          const { sql: dsql } = await import("drizzle-orm");
          await tx.execute(dsql`insert into broker_imports (origin, format, file_sha256, tz, rows_total, rows_skipped, fills_new, fills_duplicate, trades_matched, trades_created, pending_decisions, created_by_token_id)
            values ('tj_watch', 'x', ${sha(`x${Math.random()}`)}, 'UTC', 0, 0, 0, 0, 0, 0, 0, ${Number(aktor.slice(4))})`);
          throw new Error("wycofaj");
        });
      const kod = async (aktor: string) => {
        try {
          await wstaw(aktor);
        } catch (e) {
          const c = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
          return c ?? (e as Error).message;
        }
        return "bez bledu";
      };
      expect(await kod(`api:${rw.id}`)).toBe("TJ403");
      expect(await kod(`api:${ro.id}`)).toBe("TJ403");
      expect(await kod(`api:${broker.id}`)).toBe("wycofaj"); // doszlo do konca: wstawienie przeszlo, wycofanie to nasz rzut
    });
  });

  /* ------------------------------------------------------------ walidacja inboxa */

  describe("inbox: walidacja pliku", () => {
    it("zly Content-Type 415, zly naglowek SHA 400, niezgodny SHA 409, nieznany format 422, pusty plik 422", async () => {
      expect((await inbox(ORDERS, broker.token, { "content-type": "application/json" })).status).toBe(415);
      const zle = await inbox(ORDERS, broker.token, { "x-tj-sha256": "abc" });
      expect(zle.status).toBe(400);
      const niezgodny = await inbox(ORDERS, broker.token, { "x-tj-sha256": "0".repeat(64) });
      expect(niezgodny.status).toBe(409);
      expect(niezgodny.json).toMatchObject({ code: "sha_mismatch", sha256: sha(ORDERS) });
      const nieznany = await inbox("a,b\n1,2\n");
      expect(nieznany.status).toBe(422);
      expect(nieznany.json.code).toBe("unknown_format");
      expect(nieznany.json.error).toContain("Tradovate: Orders");
      expect((await inbox("")).status).toBe(422);
      expect((await sql`select count(*)::int as n from broker_imports`)[0].n).toBe(0);
    });

    it("plik ponad 5 MB: 413 i nic zapisane", async () => {
      const r = await inbox(new Uint8Array(5 * 1024 * 1024 + 10).fill(97));
      expect(r.status).toBe(413);
      expect(r.json.code).toBe("payload_too_large");
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(0);
    });

    it("limit 30 plikow na 10 minut na token: 31. dostaje 429 z Retry-After", async () => {
      let ostatni = { status: 0, json: {} as Record<string, unknown> };
      for (let i = 0; i < 31; i += 1) ostatni = await inbox("a,b\n1,2\n");
      expect(ostatni.status).toBe(429);
      expect(ostatni.json.code).toBe("rate_limited");
    });

    it("plik z blednym wierszem nie jest stosowany: 422 rows_invalid, zero wypelnien, jeden zapis »odrzucony« (takze po ponowieniu)", async () => {
      const zepsuty = ORDERS.replace("20100.25,3,10/14/2026 15:30:05", "abc,3,10/14/2026 15:30:05");
      const r = await inbox(zepsuty);
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ code: "rows_invalid", sha256: sha(zepsuty) });
      expect(r.json.rowErrors[0].powod).toContain("avgPrice");
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(0);
      expect((await sql`select count(*)::int as n from broker_trades`)[0].n).toBe(0);
      const [odrzucony] = await sql`select status, origin, fills_new, note from broker_imports`;
      expect(odrzucony).toMatchObject({ status: "rejected", origin: "tj_watch", fills_new: 0 });
      expect(odrzucony.note).toContain("avgPrice");
      await inbox(zepsuty);
      expect((await sql`select count(*)::int as n from broker_imports`)[0].n).toBe(1);
      expect((await sql`select count(*)::int as n from auth_events where kind = 'broker_import_rejected'`)[0].n).toBeGreaterThanOrEqual(1);
    });

    it("UTF-16LE z BOM daje ten sam wynik co UTF-8, a SHA liczy sie z bajtow pliku", async () => {
      const bajty = new Uint8Array(Buffer.from(`﻿${ORDERS}`, "utf16le"));
      const r = await inbox(bajty, broker.token, { "x-tj-sha256": sha(bajty) });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json).toMatchObject({ sha256: sha(bajty), fills: { new: 9, duplicate: 0 } });
    });

    it("ostrzezenie o strefie: plik bez przesuniecia jest czytany w strefie z ustawien i mowi to w notes", async () => {
      const r = await inbox(ORDERS);
      expect(r.status).toBe(201);
      expect(r.json.notes.join(" ")).toContain("nie podaje strefy czasowej");
      expect(r.json.timezone).toBe("Europe/Warsaw");
      zgodneZKontraktem("post", "/broker/inbox", r.json);
    });
  });

  /* ------------------------------------------------------------ automat 1:1 */

  describe("automat: dopasowania 1:1 z Cofnij, niejednoznaczne do decyzji, nigdy nie tworzy trade'ow", () => {
    it("Orders + Cash History: A dopasowany od razu (auto), B (dwoch kandydatow) i C (inna liczba kontraktow) czekaja na decyzje, dziennik bez nowych trade'ow", async () => {
      const a = await tradeA();
      const b1 = await tradeB(0);
      const b2 = await tradeB(40);
      const c = await tradeC();
      const przed = await wiersz(a);
      expect([Number(przed.pnl), Number(przed.pnl_estimate)]).toEqual([7200, 7200]); // poslizg ceny wejscia: 20100,00 zamiast 20100,25
      const liczbaPrzed = (await sql`select count(*)::int as n from trades where account_id = ${kontoId}`)[0].n;

      const r = await inbox(ORDERS);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.trades).toEqual({ matched: 1, needsDecision: 2, open: 1 });

      // dowod z bazy: A ma kwote z rachunku (netto), wynik wyliczony zostal do porownania
      const po = await wiersz(a);
      expect([Number(po.pnl), Number(po.broker_amount), Number(po.pnl_estimate), Number(po.fees)]).toEqual([7050, 7050, 7200, 300]);
      const [bt] = await sql`select match_kind, match_state, trade_id, prev_broker_amount_cents, net_cents::int as net, fee_source from broker_trades where trade_id = ${a}`;
      expect(bt).toMatchObject({ match_kind: "auto", match_state: "matched", prev_broker_amount_cents: null, net: 7050, fee_source: "rate" });
      // B i C nietkniete
      for (const id of [b1, b2, c]) expect((await wiersz(id)).broker_amount).toBeNull();
      const niedop = await sql`select contract, match_state, trade_id from broker_trades where trade_id is null and status = 'closed' order by entry_time`;
      expect(niedop.map((t) => [t.contract, t.match_state])).toEqual([["NQZ6", "ambiguous"], ["MNQZ6", "ambiguous"]]);
      // automat nigdy nie tworzy trade'a w dzienniku
      expect((await sql`select count(*)::int as n from trades where account_id = ${kontoId}`)[0].n).toBe(liczbaPrzed);
      expect((await sql`select count(*)::int as n from trades where source = 'broker'`)[0].n).toBe(0);
      // lista zmian z »Cofnij«: wpis w dzienniku zdarzen z pochodzeniem
      const [imp] = await sql`select origin, created_by_token_id, trades_matched, pending_decisions from broker_imports`;
      expect(imp).toMatchObject({ origin: "tj_watch", created_by_token_id: broker.id, trades_matched: 1, pending_decisions: 2 });

      // Cash History domyka oplaty z rachunku (zrodlo broker) i netto zostaje 7050 (3 x 1,00 USD)
      const r2 = await inbox(CASH);
      expect(r2.status).toBe(201);
      const [po2] = await sql`select fee_source, fees_cents::int as f, net_cents::int as n, gross_source from broker_trades where trade_id = ${a}`;
      expect(po2).toEqual({ fee_source: "broker", f: 300, n: 7050, gross_source: "broker" });
      expect(Number((await wiersz(a)).pnl)).toBe(7050);
    });

    it("odczyt API: trade brokera, szczegoly, blok broker w trade'zie z roznica »poslizg i oplaty«, status, zgodnosc z kontraktem", async () => {
      const a = await tradeA();
      await inbox(ORDERS);
      await inbox(CASH);

      const lista = await get(import("@/app/api/v2/broker/trades/route"), `/broker/trades?from=${DZIEN}&to=${DZIEN}`);
      expect(lista.status).toBe(200);
      zgodneZKontraktem("get", "/broker/trades", lista.json);
      expect(lista.json.trades).toHaveLength(4);
      const dopasowany = lista.json.trades.find((t: { tradeId: number | null }) => t.tradeId === a);
      expect(dopasowany).toMatchObject({
        contract: "MNQZ6",
        instrument: "MNQ",
        direction: "long",
        quantity: 3,
        status: "closed",
        grossCents: 7350,
        feesCents: 300,
        netCents: 7050,
        feeSource: "broker",
        matchState: "matched",
        matchKind: "auto",
        resultHidden: false,
        brokerAccount: { last4: "0001" },
        account: { id: kontoId, name: nazwaKonta, category: "realne", firm: null, program: null, phase: null },
      });
      // numer konta nie wychodzi: tylko ostatnie 4 znaki
      expect(JSON.stringify(lista.json)).not.toContain(KONTO_PLIKU);

      const bez = await get(import("@/app/api/v2/broker/trades/route"), "/broker/trades?unmatched=true");
      expect(bez.json.trades.every((t: { tradeId: number | null }) => t.tradeId === null)).toBe(true);
      // w dzienniku jest tylko trade A, wiec B, C (zamkniete) i D (otwarty) nie maja kandydatow
      expect(bez.json.trades.map((t: { contract: string; matchState: string }) => `${t.contract}:${t.matchState}`).sort()).toEqual(["MNQZ6:unmatched", "MNQZ6:unmatched", "NQZ6:unmatched"]);

      const szczegoly = await get(import("@/app/api/v2/broker/trades/[id]/route"), `/broker/trades/${dopasowany.id}`, ro.token, PARAMS({ id: String(dopasowany.id) }));
      expect(szczegoly.status).toBe(200);
      zgodneZKontraktem("get", "/broker/trades/{id}", szczegoly.json);
      expect(szczegoly.json.fills.map((f: { side: string; quantity: number; price: number; feeCents: number }) => [f.side, f.quantity, f.price, f.feeCents])).toEqual([["buy", 3, 20100.25, 150], ["sell", 3, 20112.5, 150]]);
      expect(JSON.stringify(szczegoly.json)).not.toContain("raw");

      const trade = await get(import("@/app/api/v2/trades/[id]/route"), `/trades/${a}`, ro.token, PARAMS({ id: String(a) }));
      expect(trade.status).toBe(200);
      zgodneZKontraktem("get", "/trades/{id}", trade.json);
      expect(trade.json.result).toMatchObject({ pnlCents: 7050, feesCents: 300, pnlEstimateCents: 7200, pnlSource: "broker", estimateDifferenceCents: -150 });
      expect(trade.json.broker).toMatchObject({ matchKind: "auto", netCents: 7050, pnlSource: "broker", differenceCents: -150, slippageCents: -150, feeDifferenceCents: 0 });

      const status = await get(import("@/app/api/v2/broker/status/route"), `/broker/status?day=${DZIEN}`);
      expect(status.status).toBe(200);
      zgodneZKontraktem("get", "/broker/status", status.json);
      expect(status.json.accounts[0]).toMatchObject({ accountId: kontoId, platform: "tradovate", unmatchedBrokerTrades: 2, journalTradesWithoutBrokerData: 0 });
      expect(status.json.accounts[0].lastImportAt).toBeTruthy();
    });

    it("»Cofnij« dopasowania: wynik wraca, trade brokera zostaje »pominiety« i kolejny plik go nie dopasuje drugi raz; cofniecie importu przywraca kwoty", async () => {
      const a = await tradeA();
      const r1 = await inbox(ORDERS);
      expect(Number((await wiersz(a)).pnl)).toBe(7050);
      const [bt] = await sql`select id from broker_trades where trade_id = ${a}`;

      const { cofnijDopasowanieUi, cofnijImportUi } = await import("@/lib/decyzje/broker");
      const c = await cofnijDopasowanieUi(bt.id);
      expect(c.ok, JSON.stringify(c)).toBe(true);
      const po = await wiersz(a);
      expect([po.broker_amount, Number(po.pnl)]).toEqual([null, 7200]);
      expect((await sql`select match_state, trade_id, match_kind from broker_trades where id = ${bt.id}`)[0]).toEqual({ match_state: "skipped", trade_id: null, match_kind: null });

      // plik zachodzacy z nowym zleceniem: A nie wraca do dopasowania (decyzja uzytkownika)
      const nowe = ORDERS.trimEnd() + "\n" + wierszOrders({ id: "698000000099", strona: "Buy", cena: "20500", ilosc: 1, czas: "10/14/2026 19:00:00", konto: KONTO_PLIKU });
      const r2 = await inbox(nowe);
      expect(r2.status, JSON.stringify(r2.json)).toBe(201);
      expect(r2.json.trades.matched).toBe(0);
      expect((await wiersz(a)).broker_amount).toBeNull();

      // cofniecie calego importu kasuje tylko wiersze WYLACZNIE jego (audyt W1/S1): drugi plik zawiera te same wypelnienia, wiec zostaja
      const cofniety = await cofnijImportUi(r1.json.importId);
      expect(cofniety.ok, JSON.stringify(cofniety)).toBe(true);
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBeGreaterThan(0);
      expect((await sql`select count(*)::int as n from broker_import_rows where import_id = ${r2.json.importId} and kind = 'fill'`)[0].n).toBe(
        (await sql`select count(*)::int as n from broker_fills`)[0].n,
      );
      expect((await sql`select status from broker_imports where id = ${r1.json.importId}`)[0].status).toBe("reverted");
      // drugi import cofniety odtwarza trade'y z pozostalych danych: po cofnieciu obu nic nie zostaje
      const cofniety2 = await cofnijImportUi(r2.json.importId);
      expect(cofniety2.ok).toBe(true);
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(0);
      expect((await sql`select count(*)::int as n from broker_trades`)[0].n).toBe(0);
      expect(Number((await wiersz(a)).pnl)).toBe(7200);
    });

    it("cofniecie importu z dopasowaniem 1:1 przywraca poprzednia kwote z rachunku i wynik wyliczony", async () => {
      const a = await tradeA();
      const r = await inbox(ORDERS);
      expect(r.json.trades.matched).toBe(1);
      const { cofnijImportUi } = await import("@/lib/decyzje/broker");
      const w = await cofnijImportUi(r.json.importId);
      expect(w.ok).toBe(true);
      const po = await wiersz(a);
      expect([po.broker_amount, Number(po.pnl), Number(po.pnl_estimate)]).toEqual([null, 7200, 7200]);
      expect((await sql`select count(*)::int as n from broker_trades`)[0].n).toBe(0);
    });

    it("automat nie zmienia juz dopasowanego trade'a: plik z wypelnieniem sprzed wejscia A (zmienia klucz trade'a) to 422 would_alter_matched i nic nie zostaje zapisane (audyt W2)", async () => {
      const a = await tradeA();
      const r1 = await inbox(ORDERS);
      expect(r1.json.trades.matched).toBe(1);
      const przed = {
        wyp: (await sql`select count(*)::int as n from broker_fills`)[0].n,
        bt: await sql`select id, external_ref, trade_id, match_state from broker_trades order by id`,
        imp: (await sql`select count(*)::int as n from broker_imports where status = 'committed'`)[0].n,
      };
      const wczesniej = ORDERS.trimEnd() + String.fromCharCode(10) + wierszOrders({ id: "698000000777", strona: "Buy", cena: "20090", ilosc: 1, czas: "10/14/2026 14:00:00", konto: KONTO_PLIKU });
      const r2 = await inbox(wczesniej);
      expect(r2.status, JSON.stringify(r2.json)).toBe(422);
      expect(JSON.stringify(r2.json)).toContain("would_alter_matched");
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(przed.wyp);
      expect(await sql`select id, external_ref, trade_id, match_state from broker_trades order by id`).toEqual(przed.bt);
      expect((await sql`select count(*)::int as n from broker_imports where status = 'committed'`)[0].n).toBe(przed.imp);
      expect(Number((await wiersz(a)).pnl)).toBe(7050);
    });

    it("POST /trades z externalRef »brk:« jest odrzucany: trade z danych brokera powstaje tylko z zatwierdzonej sugestii albo importu w UI", async () => {
      const { POST } = await import("@/app/api/v2/trades/route");
      const res = await POST(
        zadanie("/trades", {
          metoda: "POST",
          token: rw.token,
          cialo: {
            trades: [
              { accountId: kontoId, symbol: "MNQ", direction: "long", entryTime: `${DZIEN}T13:30:35Z`, entryPrice: 20100, contracts: 1, exits: [{ time: `${DZIEN}T13:34:50Z`, price: 20101 }], externalRef: "brk:tradovate:abcdefabcdef:1" },
            ],
          },
        }),
        undefined,
      );
      const odp = JSON.stringify(await res.json());
      expect(odp).toContain('"error":1');
      expect(odp).toContain("tv:<id> albo fxr:<id>");
      expect((await sql`select count(*)::int as n from trades where external_ref like 'brk:%'`)[0].n).toBe(0);
    });

    it("ten sam plik drugi raz: 200 duplicate z tym samym SHA i bez zmian w bazie; konto nieprzypisane z nowego pliku zostaje nieprzypisane", async () => {
      const r1 = await inbox(ORDERS);
      const r2 = await inbox(ORDERS);
      expect(r2.status).toBe(200);
      expect(r2.json).toMatchObject({ status: "duplicate", sha256: sha(ORDERS), importId: r1.json.importId });
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(9);

      // inne konto u brokera (inny numer w pliku): powstaje jako NIEPRZYPISANE, a inbox nie umie go przypisac
      const inne = ORDERS.replaceAll(KONTO_PLIKU, "TST00000000009");
      const r3 = await inbox(inne);
      expect(r3.status).toBe(201);
      const nowe = await sql`select account_id, label_last4 from broker_accounts where label_last4 = '0009'`;
      expect(nowe).toEqual([{ account_id: null, label_last4: "0009" }]);
      const niedopasowane = await sql`select count(*)::int as n from broker_trades bt join broker_accounts ba on ba.id = bt.broker_account_id where ba.label_last4 = '0009' and bt.match_state <> 'unmatched'`;
      expect(niedopasowane[0].n).toBe(0);
    });
  });

  /* ------------------------------------------------------------ sugestie AI */

  describe("sugestie broker_match i broker_trade: AI proponuje, zatwierdza tylko uzytkownik", () => {
    const sugeruj = (token: string, cialo: unknown) => wywolaj(import("@/app/api/v2/ai-suggestions/route"), "POST", "/ai-suggestions", { token, cialo });
    const dowod = [{ type: "broker_trade", note: "ten sam kontrakt, kierunek i ilosc w oknie 120 s" }];
    const baza = { claim: "To jest ten trade z rachunku.", evidence: dowod, evidenceLevel: "partial" as const, n: 1 };

    it("broker_match: tylko z zakresem propose, bez wejscia do wyniku przed zatwierdzeniem; zatwierdzenie w UI dopisuje kwote, cofniecie ja zdejmuje", async () => {
      const b1 = await tradeB(0);
      const b2 = await tradeB(40);
      await inbox(ORDERS);
      const [btB] = await sql`select id from broker_trades where contract = 'NQZ6'`;
      expect((await wiersz(b1)).broker_amount).toBeNull();

      expect((await sugeruj(ro.token, { kind: "broker_match", target: { type: "trade", id: b1 }, payload: { brokerTradeId: btB.id }, ...baza })).status).toBe(403);
      const r = await sugeruj(rw.token, { kind: "broker_match", target: { type: "trade", id: b1 }, payload: { brokerTradeId: btB.id }, ...baza });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      zgodneZKontraktem("post", "/ai-suggestions", r.json);
      expect(r.json.suggestion).toMatchObject({ kind: "broker_match", status: "pending" });
      // niezatwierdzona sugestia niczego nie zmienia
      expect((await wiersz(b1)).broker_amount).toBeNull();
      expect((await sql`select trade_id from broker_trades where id = ${btB.id}`)[0].trade_id).toBeNull();

      // agent (aktor api:) nie zatwierdzi
      const { zapisZAktorem } = await import("./zapis");
      const { sql: dsql } = await import("drizzle-orm");
      await expect(zapisZAktorem(`api:${rw.id}`, (tx) => tx.execute(dsql`update ai_suggestions set status = 'accepted', decided_at = now() where id = ${r.json.suggestion.id}`))).rejects.toMatchObject({ cause: { code: "TJ403" } });

      const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
      const ok = await zatwierdzSugestie(r.json.suggestion.id);
      expect(ok.ok, JSON.stringify(ok)).toBe(true);
      const po = await wiersz(b1);
      // B: short 2 NQ, brutto 300,00, oplaty z rachunku wg stawki konta 2 x 3,50 = 7,00 -> netto 293,00
      expect([Number(po.broker_amount), Number(po.pnl)]).toEqual([29_300, 29_300]);
      expect((await sql`select match_kind, match_state, trade_id from broker_trades where id = ${btB.id}`)[0]).toEqual({ match_kind: "ai_accepted", match_state: "matched", trade_id: b1 });
      expect((await wiersz(b2)).broker_amount).toBeNull();

      expect((await cofnijSugestie(r.json.suggestion.id)).ok).toBe(true);
      expect((await wiersz(b1)).broker_amount).toBeNull();
      expect((await sql`select match_state, trade_id from broker_trades where id = ${btB.id}`)[0]).toEqual({ match_state: "skipped", trade_id: null });
    });

    it("broker_match: odrzucane z powodem (trade juz dopasowany 409, inne konto 422, otwarta pozycja 422, nieznany trade brokera 422)", async () => {
      const a = await tradeA();
      const b1 = await tradeB(0);
      await tradeB(40);
      await inbox(ORDERS);
      const [btA] = await sql`select id from broker_trades where trade_id = ${a}`;
      const [btB] = await sql`select id from broker_trades where contract = 'NQZ6'`;
      const [btD] = await sql`select id from broker_trades where status = 'open'`;
      const inneKonto = (await sql`insert into accounts (name) values (${`BRK-inne-${Date.now()}`}) returning id`)[0].id as number;
      try {
        const innyTrade = await zapiszTrade({ accountId: inneKonto, instrumentId: nq, direction: "short", entryTime: new Date(`${DZIEN}T14:10:00Z`), entryPrice: 20250, contracts: 2 }, { czas: `${DZIEN}T14:15:30Z`, cena: 20240 });
        const juz = await sugeruj(rw.token, { kind: "broker_match", target: { type: "trade", id: a }, payload: { brokerTradeId: btA.id }, ...baza });
        expect(juz.status).toBe(409);
        expect(juz.json.code).toBe("already_present");
        const zleKonto = await sugeruj(rw.token, { kind: "broker_match", target: { type: "trade", id: innyTrade }, payload: { brokerTradeId: btB.id }, ...baza });
        expect(zleKonto.status).toBe(422);
        expect(zleKonto.json.code).toBe("account_mismatch");
        const otwarta = await sugeruj(rw.token, { kind: "broker_match", target: { type: "trade", id: b1 }, payload: { brokerTradeId: btD.id }, ...baza });
        expect(otwarta.json.code).toBe("broker_trade_open");
        const nieznany = await sugeruj(rw.token, { kind: "broker_match", target: { type: "trade", id: b1 }, payload: { brokerTradeId: 999_999_999 }, ...baza });
        expect(nieznany.json.code).toBe("unknown_reference");
      } finally {
        await sql`delete from trades where account_id = ${inneKonto}`;
        await sql`delete from accounts where id = ${inneKonto}`;
      }
    });

    it("broker_trade: trade w dzienniku powstaje dopiero po zatwierdzeniu w UI (source broker, ref brk:, kwota netto), cofniecie kasuje go bez nagrobka", async () => {
      await inbox(ORDERS);
      const [btC] = await sql`select id from broker_trades where contract = 'MNQZ6' and status = 'closed' and max_qty = 2`;
      const liczba = async () => (await sql`select count(*)::int as n from trades where account_id = ${kontoId}`)[0].n as number;
      const przed = await liczba();

      const r = await sugeruj(rw.token, { kind: "broker_trade", target: { type: "broker_trade", id: btC.id }, payload: { wordsIds: [] }, ...baza });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(await liczba()).toBe(przed); // AI nie tworzy trade'a, tylko proponuje

      const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
      const ok = await zatwierdzSugestie(r.json.suggestion.id);
      expect(ok.ok, JSON.stringify(ok)).toBe(true);
      expect(await liczba()).toBe(przed + 1);
      const [bt] = await sql`select trade_id, match_kind, external_ref from broker_trades where id = ${btC.id}`;
      expect(bt.match_kind).toBe("created");
      const utworzony = await wiersz(bt.trade_id);
      expect(utworzony).toMatchObject({ source: "broker", external_ref: bt.external_ref, contracts: 2 });
      expect(Number(utworzony.broker_amount)).toBe(1600); // netto trade'a C: brutto 18,00 minus oplaty 2,00
      expect(utworzony.external_ref).toMatch(/^brk:tradovate:[0-9a-f]{12}:/);

      expect((await cofnijSugestie(r.json.suggestion.id)).ok).toBe(true);
      expect(await liczba()).toBe(przed);
      expect((await sql`select count(*)::int as n from ingest_skips where external_ref = ${bt.external_ref}`)[0].n).toBe(0); // bez nagrobka
      expect((await sql`select trade_id, match_state from broker_trades where id = ${btC.id}`)[0]).toEqual({ trade_id: null, match_state: "skipped" });
    });

    it("broker_trade: pozycja otwarta, brak przypisanego konta i skasowany wczesniej trade (nagrobek) sa odrzucane z powodem", async () => {
      await inbox(ORDERS);
      const [otwarty] = await sql`select id from broker_trades where status = 'open'`;
      const r = await sugeruj(rw.token, { kind: "broker_trade", target: { type: "broker_trade", id: otwarty.id }, payload: { wordsIds: [] }, ...baza });
      expect(r.json.code).toBe("broker_trade_open");

      const [zamkniety] = await sql`select id, external_ref from broker_trades where status = 'closed' limit 1`;
      await sql`insert into ingest_skips (external_ref, reason) values (${zamkniety.external_ref}, 'deleted')`;
      const nagrobek = await sugeruj(rw.token, { kind: "broker_trade", target: { type: "broker_trade", id: zamkniety.id }, payload: { wordsIds: [] }, ...baza });
      expect(nagrobek.status).toBe(409);
      expect(nagrobek.json.code).toBe("tombstoned");

      const inne = ORDERS.replaceAll(KONTO_PLIKU, "TST00000000009");
      await inbox(inne);
      const [bezKonta] = await sql`select bt.id from broker_trades bt join broker_accounts ba on ba.id = bt.broker_account_id where ba.label_last4 = '0009' and bt.status = 'closed' limit 1`;
      const nieprzypisane = await sugeruj(rw.token, { kind: "broker_trade", target: { type: "broker_trade", id: bezKonta.id }, payload: { wordsIds: [] }, ...baza });
      expect(nieprzypisane.json.code).toBe("broker_account_unmapped");
    });
  });

  /* ------------------------------------------------------------ decyzje uzytkownika kontra automat (recenzja i audyt, 17.10.2026) */
  describe("automat nie uchyla decyzji uzytkownika", () => {
    const wczesniejPlik = () =>
      ORDERS.trimEnd() + String.fromCharCode(10) + wierszOrders({ id: "698000000777", strona: "Buy", cena: "20090", ilosc: 1, czas: "10/14/2026 14:00:00", konto: KONTO_PLIKU });

    it("odznaczenie dopasowania 1:1 na podgladzie jest trwale: kolejny plik z automatu go nie stosuje (K1)", async () => {
      const a = await tradeA();
      const { podgladImportu, zapiszImport } = await import("@/lib/decyzje/broker");
      const bajty = new TextEncoder().encode(ORDERS);
      const podglad = await podgladImportu({ bajty, strefa: null });
      expect(podglad.ok, JSON.stringify(podglad)).toBe(true);
      if (!podglad.ok) return;
      const poz = podglad.pozycje.find((p) => p.kandydaci.length === 1 && p.kandydaci[0] === a);
      expect(poz, "podglad nie pokazal kandydata A").toBeTruthy();
      const w = await zapiszImport({ bajty, strefa: null, odznaczone: [poz!.externalRef] });
      expect(w.ok, JSON.stringify(w)).toBe(true);
      expect((await sql`select match_state, trade_id from broker_trades where external_ref = ${poz!.externalRef}`)[0]).toEqual({ match_state: "skipped", trade_id: null });
      expect((await wiersz(a)).broker_amount).toBeNull();

      const dalszy = ORDERS.trimEnd() + String.fromCharCode(10) + wierszOrders({ id: "698000000778", strona: "Buy", cena: "20500", ilosc: 1, czas: "10/14/2026 19:00:00", konto: KONTO_PLIKU });
      const r = await inbox(dalszy);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect((await sql`select match_state, trade_id from broker_trades where external_ref = ${poz!.externalRef}`)[0]).toEqual({ match_state: "skipped", trade_id: null });
      expect((await wiersz(a)).broker_amount).toBeNull();
    });

    it("pominiety (cofniety) trade brokera: plik, ktory zmienilby jego klucz, to would_alter_matched, a nie ciche przywrocenie", async () => {
      const a = await tradeA();
      await inbox(ORDERS);
      const [bt] = await sql`select id from broker_trades where trade_id = ${a}`;
      const { cofnijDopasowanieUi } = await import("@/lib/decyzje/broker");
      expect((await cofnijDopasowanieUi(bt.id)).ok).toBe(true);
      const przed = (await sql`select count(*)::int as n from broker_fills`)[0].n;
      const r = await inbox(wczesniejPlik());
      expect(r.status, JSON.stringify(r.json)).toBe(422);
      expect(JSON.stringify(r.json)).toContain("would_alter_matched");
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(przed);
      expect((await sql`select match_state from broker_trades where id = ${bt.id}`)[0].match_state).toBe("skipped");
      expect(JSON.stringify(r.json)).not.toContain("#null");
      expect(JSON.stringify(r.json)).toContain("pominąłeś");

      // z pominiecia jest powrot: trade widac w sekcji »Pominiete« i wraca do decyzji przyciskiem
      const { pominiete, doDecyzji } = await import("@/lib/queries/broker");
      expect((await pominiete()).map((w) => w.brokerTradeId)).toContain(bt.id);
      const { pominTradeBrokeraUi } = await import("@/lib/decyzje/broker");
      expect((await pominTradeBrokeraUi(bt.id, true)).ok).toBe(true);
      expect((await pominiete()).map((w) => w.brokerTradeId)).not.toContain(bt.id);
      expect((await doDecyzji()).map((w) => w.brokerTradeId)).toContain(bt.id);
    });

    it("dopasowanie reczne: Cash History nie zmienia kwoty w dzienniku, trade pojawia sie jako »rachunek zmienil netto«, a »Zaktualizuj kwote« ja zmienia", async () => {
      await sql`update accounts set fee_rt_micro_cents = 50 where id = ${kontoId}`; // stawka nizsza niz w Cash History (1,00 USD), wiec netto sie zmieni
      try {
        const a = await tradeA();
        await inbox(ORDERS);
        const [bt] = await sql`select id from broker_trades where trade_id = ${a}`;
        const { cofnijDopasowanieUi, dopasujRecznieUi, zaktualizujKwoteUi } = await import("@/lib/decyzje/broker");
        expect((await cofnijDopasowanieUi(bt.id)).ok).toBe(true);
        expect((await dopasujRecznieUi(bt.id, a)).ok).toBe(true);
        const [przed] = await sql`select broker_amount::int as k from trades where id = ${a}`;
        expect((await sql`select match_kind from broker_trades where id = ${bt.id}`)[0].match_kind).toBe("user");

        const r = await inbox(CASH);
        expect(r.status, JSON.stringify(r.json)).toBe(201);
        const [po] = await sql`select broker_amount::int as k from trades where id = ${a}`;
        expect(po.k, "automat nie moze zmienic kwoty recznego dopasowania").toBe(przed.k);
        const [netto] = await sql`select net_cents::int as n from broker_trades where id = ${bt.id}`;
        expect(netto.n).not.toBe(przed.k);

        const { nettoZmienione } = await import("@/lib/queries/broker");
        const lista = await nettoZmienione();
        expect(lista.find((w) => w.brokerTradeId === bt.id)).toMatchObject({ tradeId: a, bylo: przed.k, jest: netto.n });

        expect((await zaktualizujKwoteUi(bt.id)).ok).toBe(true);
        expect((await sql`select broker_amount::int as k from trades where id = ${a}`)[0].k).toBe(netto.n);
        expect((await nettoZmienione()).find((w) => w.brokerTradeId === bt.id)).toBeUndefined();
      } finally {
        await sql`update accounts set fee_rt_micro_cents = 100 where id = ${kontoId}`;
      }
    });
  });

  /* ------------------------------------------------------------ slepa ocena */

  describe("slepa ocena obejmuje dane brokera (ukrycie-wyniku.ts)", () => {
    /** Trade otwarty z werdyktem AI wydanym przed wynikiem: jego wynik jest ukryty, dopoki sie nie zamknie. */
    async function tradeOtwartyZWerdyktem(entryIso: string): Promise<number> {
      const { persistTrade } = await import("@/lib/trades/persist");
      const w = await persistTrade({ id: null, accountId: kontoId, instrumentId: mnq, backtestSessionId: null, direction: "long", status: "open", entryTime: new Date(entryIso), entryPrice: 20100, contracts: 3, wyjscia: [], stopLoss: 20090, takeProfit: null, mae: null, mfe: null, brokerAmount: null });
      if (!w.ok) throw new Error(w.error);
      await sql`insert into trade_reviews (trade_id, basis, summary_md, kind, as_of, evidence_hash) values (${w.id}, 'chart', 'ocena przed wynikiem', 'ai', now(), ${sha(`dowod${w.id}`)})`;
      return w.id;
    }

    it("trade z ukrytym wynikiem: niedopasowane trade'y brokera z tego konta i dnia po jego wejsciu wychodza z resultHidden i bez wyniku; po zamknieciu wszystko wraca", async () => {
      const x = await tradeOtwartyZWerdyktem(`${DZIEN}T13:20:00Z`);
      await inbox(ORDERS);
      await inbox(CASH);

      const lista = await get(import("@/app/api/v2/broker/trades/route"), `/broker/trades?from=${DZIEN}&to=${DZIEN}`);
      expect(lista.json.trades).toHaveLength(4);
      for (const t of lista.json.trades) {
        expect(t.resultHidden, JSON.stringify(t)).toBe(true);
        expect([t.netCents, t.grossCents, t.feesCents, t.status, t.exitTime, t.avgExitPrice, t.fillCount]).toEqual([null, null, null, null, null, null, null]);
        expect(t.quantity).toBeGreaterThan(0); // wejscie (kierunek, ilosc, czas) zostaje
      }
      const szczegoly = await get(import("@/app/api/v2/broker/trades/[id]/route"), `/broker/trades/${lista.json.trades[0].id}`, ro.token, PARAMS({ id: String(lista.json.trades[0].id) }));
      expect(szczegoly.json.resultHidden).toBe(true);
      expect(szczegoly.json.fills).toEqual([]);
      zgodneZKontraktem("get", "/broker/trades/{id}", szczegoly.json);
      expect([szczegoly.json.grossCents, szczegoly.json.netCents, szczegoly.json.feesCents]).toEqual([null, null, null]);

      // zamkniecie trade'a z werdyktem: dane wracaja
      await sql`update trades set status = 'closed', exit_time = ${`${DZIEN}T13:25:00Z`}, exit_price = 20105, exit_count = 1 where id = ${x}`;
      const po = await get(import("@/app/api/v2/broker/trades/route"), `/broker/trades?from=${DZIEN}&to=${DZIEN}`);
      expect(po.json.trades.every((t: { resultHidden: boolean }) => t.resultHidden === false)).toBe(true);
      expect(po.json.trades.some((t: { netCents: number | null }) => t.netCents === 7050)).toBe(true);
    });

    it("ekran Polaczen nie zdradza zamkniecia: lista »Do decyzji«, liczniki konta i czas ostatniego wypelnienia pomijaja ukryte trade'y brokera", async () => {
      await tradeOtwartyZWerdyktem(`${DZIEN}T13:20:00Z`);
      await inbox(ORDERS);
      await inbox(CASH);
      const { kontaPolaczone, doDecyzji } = await import("@/lib/queries/broker");
      expect(await doDecyzji()).toEqual([]);
      const k = (await kontaPolaczone()).find((x) => x.brokerAccountId === brokerAccountId);
      expect(k).toMatchObject({ tradesTotal: 0, tradesMatched: 0, tradesPending: 0, lastFillAt: null, fills: 0 });
    });

    it("interfejs tez zakrywa wynik: podglad importu, »Do decyzji« i dane przy trade'zie nie pokazuja liczb trade'u z ukrytym wynikiem", async () => {
      const x = await tradeOtwartyZWerdyktem(`${DZIEN}T13:20:00Z`);
      const { podgladImportu } = await import("@/lib/decyzje/broker");
      const podglad = await podgladImportu({ bajty: new TextEncoder().encode(ORDERS), strefa: null, oczekiwanySha: null });
      expect(podglad.ok, JSON.stringify(podglad)).toBe(true);
      if (!podglad.ok) return;
      expect(podglad.pozycje.length).toBeGreaterThan(0);
      for (const p of podglad.pozycje) {
        expect(p.wynikUkryty).toBe(true);
        expect([p.nettoCenty, p.bruttoCenty, p.oplatyCenty, p.pnlPrzed, p.pnlPo, p.wyjscie, p.cenaWyjscia]).toEqual([null, null, null, null, null, null, null]);
      }
      // podglad niczego nie zapisal
      expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(0);

      await inbox(ORDERS);
      await inbox(CASH);
      const { doDecyzji, daneRachunkuTradu } = await import("@/lib/queries/broker");
      // ukryte trade'y brokera w ogole nie ida do »Do decyzji« (samo pojawienie sie zdradzaloby zamkniecie)
      expect(await doDecyzji()).toEqual([]);
      const dane = await daneRachunkuTradu(x);
      expect(dane).toMatchObject({ wynikUkryty: true, pnl: null, pnlEstimate: null, fees: null, brokerAmount: null, roznicaCenty: null });

      // po zamknieciu trade'a z werdyktem liczby wracaja
      await sql`update trades set status = 'closed', exit_time = ${`${DZIEN}T13:25:00Z`}, exit_price = 20105, exit_count = 1 where id = ${x}`;
      const odslonieta = await doDecyzji();
      expect(odslonieta.length).toBeGreaterThan(0);
      expect(odslonieta.every((w) => !w.wynikUkryty)).toBe(true);
    });

    it("trade dopasowany do trade'a z ukrytym wynikiem: blok broker bez wyniku, wyjscia i oplat, a wypelnienia tylko sprzed wejscia", async () => {
      const x = await tradeOtwartyZWerdyktem(`${DZIEN}T13:32:00Z`);
      await inbox(ORDERS);
      await inbox(CASH);
      const [btA] = await sql`select id from broker_trades where contract = 'MNQZ6' and max_qty = 3`;
      // wymuszone powiazanie (jak z recznego dopasowania): trade otwarty ma werdykt, wiec jego wynik jest ukryty
      await sql.begin(async (tx) => {
        await tx`select set_config('tj.actor', 'ui', true)`;
        await tx`update broker_trades set trade_id = ${x}, match_kind = 'user', match_state = 'matched' where id = ${btA.id}`;
      });
      const r = await get(import("@/app/api/v2/trades/[id]/route"), `/trades/${x}`, ro.token, PARAMS({ id: String(x) }));
      expect(r.status).toBe(200);
      zgodneZKontraktem("get", "/trades/{id}", r.json);
      expect(r.json.resultHidden).toBe(true);
      expect(r.json.result).toBeNull();
      expect(r.json.broker).toMatchObject({ resultHidden: true, exitTime: null, grossCents: null, feesCents: null, netCents: null, pnlEstimateCents: null, differenceCents: null });
      // wejscie brokera 13:30:05 jest PRZED wejsciem trade'a (13:32:00), wyjscie 13:34:50 po nim
      expect(r.json.broker.fills.map((f: { side: string }) => f.side)).toEqual(["buy"]);

      const szczegoly = await get(import("@/app/api/v2/broker/trades/[id]/route"), `/broker/trades/${btA.id}`, ro.token, PARAMS({ id: String(btA.id) }));
      expect(szczegoly.json).toMatchObject({ resultHidden: true, netCents: null, status: null });
      expect(szczegoly.json.fills).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------------ konta dnia */

  describe("aktywne konta dnia (wielokrotne)", () => {
    it("PUT zapisuje kilka kont naraz, GET je zwraca z kategoria; bez write 403; nieznane konto 422; puste czysci", async () => {
      const drugi = (await sql`insert into accounts (name, type, prop_phase) values (${`BRK-prop-${Date.now()}`}, 'prop', 'eval') returning id`)[0].id as number;
      try {
        const put = (token: string, cialo: unknown) => wywolaj(import("@/app/api/v2/days/[date]/accounts/route"), "PUT", `/days/${DZIEN}/accounts`, { token, cialo }, PARAMS({ date: DZIEN }));
        expect((await put(ro.token, { accountIds: [kontoId] })).status).toBe(403);
        const r = await put(rw.token, { accountIds: [kontoId, drugi, kontoId] });
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        zgodneZKontraktem("put", "/days/{date}/accounts", r.json);
        expect(r.json.accounts.map((k: { id: number; category: string | null }) => [k.id, k.category]).sort()).toEqual([[kontoId, "realne"], [drugi, "prop_eval"]].sort());
        const odczyt = await get(import("@/app/api/v2/days/[date]/accounts/route"), `/days/${DZIEN}/accounts`, ro.token, PARAMS({ date: DZIEN }));
        zgodneZKontraktem("get", "/days/{date}/accounts", odczyt.json);
        expect(odczyt.json.accounts).toHaveLength(2);
        expect((await sql`select count(*)::int as n from day_accounts where day = ${DZIEN}`)[0].n).toBe(2);

        const nieznane = await put(rw.token, { accountIds: [999_999_999] });
        expect(nieznane.status).toBe(422);
        expect(nieznane.json.code).toBe("unknown_reference");
        const zleDane = await put(rw.token, { accountIds: ["a"] });
        expect(zleDane.status).toBe(400);
        const zlaData = await wywolaj(import("@/app/api/v2/days/[date]/accounts/route"), "PUT", `/days/dzis/accounts`, { token: rw.token, cialo: { accountIds: [] } }, PARAMS({ date: "dzis" }));
        expect(zlaData.status).toBe(400);

        const czysci = await put(rw.token, { accountIds: [] });
        expect(czysci.json.accounts).toEqual([]);
        expect((await sql`select count(*)::int as n from day_accounts where day = ${DZIEN}`)[0].n).toBe(0);
      } finally {
        await sql`delete from day_accounts where day = ${DZIEN}`;
        await sql`delete from accounts where id = ${drugi}`;
      }
    });
  });
});
