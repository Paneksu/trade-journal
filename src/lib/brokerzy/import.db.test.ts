import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "@/lib/api-v2/limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, zadanie, type Par, type Sql } from "@/lib/api-v2/test/db-pomocnik";
import { ORDERS, CASH, plikOrders } from "@/lib/brokerzy/testowe";

vi.mock("server-only", () => ({}));

/*
 * Import z brokera na PRAWDZIWEJ, lokalnej bazie (ADR-034): od pliku CSV przez trasę inbox (token import_broker) i UI
 * do dopasowania z trade'em dziennika i wyniku netto. Dowodem zapisu jest odczyt z bazy po zapisie.
 */
const sha = (t: string) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
const KONTO_PLIKU = "TST00000000001";

describe.skipIf(!MOZNA_NA_BAZIE)("import z brokera: inbox, dopasowanie 1:1 i wynik netto (baza lokalna)", () => {
  let sql: Sql;
  let tokenBroker: Par;
  let mnqId = 0;
  let nqId = 0;
  let kontoId = 0;

  const inbox = async (tekst: string, token = tokenBroker.token, naglowki: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/v2/broker/inbox/route");
    const res = await POST(
      zadanie("/broker/inbox", { metoda: "POST", token, surowe: tekst, naglowki: { "content-type": "text/csv", ...naglowki } }),
      undefined,
    );
    return { status: res.status, json: await res.json() };
  };

  /** Sprzatanie jako uzytkownik (aktor ui): baza nie pozwala usuwac danych brokera nikomu innemu. */
  async function sprzatnij() {
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      await tx`delete from trades where account_id = ${kontoId}`;
      await tx`delete from broker_imports`;
      await tx`delete from broker_accounts where label_last4 in ('0001', '0002')`;
      await tx`delete from broker_cash_events`;
    });
  }

  beforeAll(async () => {
    sql = polacz();
    await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
    const [nq] = await sql`select id from instruments where symbol = 'NQ'`;
    nqId =
      nq?.id ??
      (await sql`insert into instruments (symbol, name, exchange, tick_size, tick_value, sort_order) values ('NQ', 'E-mini Nasdaq 100', 'CME', 0.25, 5000, 1) returning id`)[0].id;
    await sql`update instruments set size_class = 'mini' where id = ${nqId}`;
    const [mnq] = await sql`select id from instruments where symbol = 'MNQ'`;
    mnqId =
      mnq?.id ??
      (await sql`insert into instruments (symbol, name, exchange, tick_size, tick_value, sort_order, size_class) values ('MNQ', 'Micro E-mini Nasdaq 100', 'CME', 0.25, 500, 2, 'micro') returning id`)[0].id;
    await sql`update instruments set size_class = 'micro' where id = ${mnqId}`;
    const [k] = await sql`insert into accounts (name, type, fee_rt_mini_cents, fee_rt_micro_cents) values ('BRK-import-test', 'live', 350, 100) returning id`;
    kontoId = k.id;
    tokenBroker = await nowyToken(sql, ["import_broker"], { expiresAt: new Date(Date.now() + 86_400_000), createdVia: "ui" });
  });

  afterAll(async () => {
    await sprzatnij();
    await sql`delete from auth_events where token_id = ${tokenBroker.id}`;
    await sql`delete from api_tokens where id = ${tokenBroker.id}`;
    await sql`delete from accounts where id = ${kontoId}`;
    await sql.end();
  });

  beforeEach(async () => {
    wyczyscLimiter();
    await sprzatnij();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("inbox przyjmuje Orders od tokenu import_broker: zapisuje wypelnienia i trade'y, konto zostaje nieprzypisane, SHA wraca w odpowiedzi", async () => {
    const r = await inbox(ORDERS, tokenBroker.token, { "x-tj-sha256": sha(ORDERS) });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json).toMatchObject({ sha256: sha(ORDERS), status: "applied", format: "tradovate_orders", fills: { new: 9, duplicate: 0 }, trades: { matched: 0, open: 1 } });

    const [{ n }] = await sql`select count(*)::int as n from broker_fills`;
    expect(n).toBe(9);
    const trade = await sql`select direction, max_qty::float8 as qty, status, net_cents, fee_source, match_state from broker_trades order by entry_time`;
    expect(trade.map((t) => [t.direction, t.qty, t.status])).toEqual([["long", 3, "closed"], ["short", 2, "closed"], ["long", 2, "closed"], ["long", 1, "open"]]);
    // konto bez przypisania: nie znamy stawki ani Cash History, wiec netto nieznane (nie udajemy wyniku)
    expect(trade.every((t) => t.net_cents === null)).toBe(true);
    const [konto] = await sql`select account_id, label_last4, length(external_account_hmac) as dl from broker_accounts`;
    expect(konto).toEqual({ account_id: null, label_last4: "0001", dl: 64 });
    // numer konta nie lezy nigdzie jawnie
    const wszystko = JSON.stringify(await sql`select raw from broker_fills`) + JSON.stringify(await sql`select * from broker_accounts`);
    expect(wszystko).not.toContain(KONTO_PLIKU);
  });

  it("Cash History po Orders uzupelnia oplaty z rachunku i wynik brutto: netto zgodne z reczna rachunkowka", async () => {
    await inbox(ORDERS);
    const r = await inbox(CASH);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const wiersze = await sql`select entry_time, gross_cents::int as g, fees_cents::int as f, net_cents::int as n, gross_source, fee_source from broker_trades where status = 'closed' order by entry_time`;
    expect(wiersze.map((w) => [w.g, w.f, w.n, w.gross_source, w.fee_source])).toEqual([
      [7350, 300, 7050, "broker", "broker"],
      [30000, 700, 29300, "broker", "broker"],
      [1800, 200, 1600, "broker", "broker"],
    ]);
    const fee = await sql`select count(*) filter (where fee_cents is not null)::int as z from broker_fills`;
    expect(fee[0].z).toBe(9);
  });

  it("kolejnosc plikow bez znaczenia: Cash History przed Orders daje ten sam wynik", async () => {
    await inbox(CASH);
    expect((await sql`select count(*)::int as n from broker_cash_events`)[0].n).toBe(15);
    await inbox(ORDERS);
    const wiersze = await sql`select net_cents::int as n from broker_trades where status = 'closed' order by entry_time`;
    expect(wiersze.map((w) => w.n)).toEqual([7050, 29300, 1600]);
  });

  it("ten sam plik drugi raz to duplicate (200) i nic sie nie dubluje; zachodzacy plik dodaje tylko nowe wypelnienia", async () => {
    const pierwszy = await inbox(ORDERS);
    expect(pierwszy.status).toBe(201);
    const drugi = await inbox(ORDERS);
    expect(drugi.status).toBe(200);
    expect(drugi.json).toMatchObject({ status: "duplicate", sha256: sha(ORDERS), importId: pierwszy.json.importId });
    expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(9);

    // plik zachodzacy: te same wiersze + jedno nowe zlecenie (zamkniecie pozycji D)
    const dodatkowy = plikOrders([{ id: "698000000012", strona: "Sell", cena: "20410.5", ilosc: 1, czas: "10/14/2026 18:05:00", konto: KONTO_PLIKU }]).split("\n").slice(1).join("\n");
    const zachodzacy = ORDERS.trimEnd() + "\n" + dodatkowy;
    const trzeci = await inbox(zachodzacy);
    expect(trzeci.status, JSON.stringify(trzeci.json)).toBe(201);
    expect(trzeci.json.fills).toEqual({ new: 1, duplicate: 9 });
    const trady = await sql`select status, external_ref from broker_trades order by entry_time`;
    expect(trady.map((t) => t.status)).toEqual(["closed", "closed", "closed", "closed"]);
    // trade D zachowal id/klucz (pierwsze wejscie), tylko sie domknal
    expect((await sql`select count(*)::int as n from broker_trades`)[0].n).toBe(4);
  });
});
