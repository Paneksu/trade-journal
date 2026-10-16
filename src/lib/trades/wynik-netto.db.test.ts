import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MOZNA_NA_BAZIE, polacz, type Sql } from "@/lib/api-v2/test/db-pomocnik";
import type { TradeDraft } from "@/lib/domain/trade-draft";

vi.mock("server-only", () => ({}));

/*
 * Wynik trade'a jest NETTO (ADR-034 pkt 5): `persistTrade` bierze stawke oplat z reguly prop z dnia trade'a albo ze stawki konta,
 * zapisuje `fees` (NULL = nieznane), `pnl_estimate` (wynik wyliczony) i `pnl` (kwota z rachunku, gdy jest). Dowodem jest odczyt
 * wiersza z prawdziwej, lokalnej bazy po zapisie. Liczby z probki uzytkownika: short 9 MNQ 30785,50 -> 30810,50.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("wynik netto w persistTrade i przeliczenie historii (baza lokalna)", () => {
  let sql: Sql;
  let mnq = 0;
  let nq = 0;
  let bezKlasy = 0;
  const konta: number[] = [];

  const nowyKonto = async (nazwa: string, typ: "live" | "prop", mini: number | null, micro: number | null): Promise<number> => {
    const [k] = await sql`insert into accounts (name, type, fee_rt_mini_cents, fee_rt_micro_cents) values (${`WN-${nazwa}-${Date.now()}-${konta.length}`}, ${typ}, ${mini}, ${micro}) returning id`;
    konta.push(k.id);
    return k.id;
  };

  const szkicProbki = (accountId: number, instrumentId: number, o: Partial<TradeDraft> = {}): TradeDraft => ({
    id: null,
    accountId,
    instrumentId,
    backtestSessionId: null,
    direction: "short",
    status: "closed",
    entryTime: new Date("2026-10-13T14:03:12Z"),
    entryPrice: 30785.5,
    contracts: 9,
    wyjscia: [{ numer: 1, czas: new Date("2026-10-13T14:04:41Z"), cena: 30810.5, kontrakty: null, kwotaBrokera: null, notatka: null }],
    stopLoss: null,
    takeProfit: null,
    mae: null,
    mfe: null,
    brokerAmount: null,
    ...o,
  });

  async function zapisz(szkic: TradeDraft) {
    const { persistTrade } = await import("./persist");
    const w = await persistTrade(szkic);
    if (!w.ok) throw new Error(`persistTrade: ${w.error}`);
    const [t] = await sql`select pnl, fees, pnl_estimate, broker_amount, r_multiple::float8 as r from trades where id = ${w.id}`;
    return { id: w.id, ...t } as { id: number; pnl: string | null; fees: string | null; pnl_estimate: string | null; broker_amount: string | null; r: number | null };
  }
  const liczby = (t: { pnl: unknown; fees: unknown; pnl_estimate: unknown }) => [t.pnl, t.fees, t.pnl_estimate].map((x) => (x === null ? null : Number(x)));

  beforeAll(async () => {
    sql = polacz();
    await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
    const instr = async (symbol: string, tick: number, klasa: string | null) => {
      const [i] = await sql`select id from instruments where symbol = ${symbol}`;
      if (i) {
        await sql`update instruments set size_class = ${klasa}, tick_value = ${tick} where id = ${i.id}`;
        return i.id as number;
      }
      return (await sql`insert into instruments (symbol, name, exchange, tick_size, tick_value, sort_order, size_class) values (${symbol}, ${symbol}, 'CME', 0.25, ${tick}, 90, ${klasa}) returning id`)[0].id as number;
    };
    mnq = await instr("MNQ", 500, "micro");
    nq = await instr("NQ", 5000, "mini");
    bezKlasy = await instr("WNKLX", 500, null);
  });

  afterAll(async () => {
    await sql`delete from trades where account_id = any(${konta})`;
    await sql`delete from prop_rules where account_id = any(${konta})`;
    await sql`delete from accounts where id = any(${konta})`;
    await sql.end();
  });

  it("konto ze stawka micro 1,00: probka (short 9 MNQ) daje oplaty 9,00, wynik wyliczony i wynik -459,00", async () => {
    const konto = await nowyKonto("stawka", "live", 350, 100);
    const t = await zapisz(szkicProbki(konto, mnq));
    expect(liczby(t)).toEqual([-45_900, 900, -45_900]);
    expect(t.broker_amount).toBeNull(); // »wyliczony« = brak kwoty z rachunku
  });

  it("konto bez stawek: wynik brutto, oplaty NIEZNANE (NULL, nie zero), wynik wyliczony tez brutto", async () => {
    const konto = await nowyKonto("bez", "live", null, null);
    const t = await zapisz(szkicProbki(konto, mnq));
    expect(liczby(t)).toEqual([-45_000, null, -45_000]);
  });

  it("instrument bez klasy kontraktu (ani mini, ani micro): brak stawki mimo stawek konta", async () => {
    const konto = await nowyKonto("klasa", "live", 350, 100);
    const t = await zapisz(szkicProbki(konto, bezKlasy));
    expect(liczby(t)).toEqual([-45_000, null, -45_000]);
  });

  it("mini i micro biora osobne stawki tego samego konta", async () => {
    const konto = await nowyKonto("mini", "live", 350, 100);
    const t = await zapisz(szkicProbki(konto, nq, { direction: "long", contracts: 2, entryPrice: 5000, wyjscia: [{ numer: 1, czas: new Date("2026-10-13T14:10:00Z"), cena: 5001, kontrakty: null, kwotaBrokera: null, notatka: null }] }));
    // NQ: 4 ticki x 5,00 x 2 = 40,00; oplaty 2 x 3,50 = 7,00
    expect(liczby(t)).toEqual([4000 - 700, 700, 4000 - 700]);
  });

  it("kwota z rachunku (netto) wygrywa z wyliczonym, oplaty i wynik wyliczony zostaja do porownania", async () => {
    const konto = await nowyKonto("rachunek", "live", 350, 100);
    const t = await zapisz(szkicProbki(konto, mnq, { brokerAmount: -46_200 }));
    expect(liczby(t)).toEqual([-46_200, 900, -45_900]);
    expect(Number(t.broker_amount)).toBe(-46_200);
  });

  it("konto prop: stawka z reguly z dnia trade'a (najnowsza valid_from <= dzien), a gdy regula nie ma stawki, stawka konta", async () => {
    const konto = await nowyKonto("prop", "prop", null, 70);
    await sql`insert into prop_rules (account_id, valid_from, dd_type, max_dd_cents, fee_rt_micro_cents) values (${konto}, '2026-09-01', 'eod', 100000, 100)`;
    await sql`insert into prop_rules (account_id, valid_from, dd_type, max_dd_cents, fee_rt_micro_cents) values (${konto}, '2026-10-14', 'eod', 100000, 80)`;
    await sql`insert into prop_rules (account_id, valid_from, dd_type, max_dd_cents) values (${konto}, '2026-12-01', 'eod', 100000)`;
    const poDniu = async (dzien: string) => {
      const t = await zapisz(szkicProbki(konto, mnq, { entryTime: new Date(`${dzien}T14:03:12Z`), wyjscia: [{ numer: 1, czas: new Date(`${dzien}T14:04:41Z`), cena: 30810.5, kontrakty: null, kwotaBrokera: null, notatka: null }] }));
      return Number(t.fees);
    };
    expect(await poDniu("2026-10-13")).toBe(900); // regula z 1.09: 1,00 x 9
    expect(await poDniu("2026-10-14")).toBe(720); // regula z 14.10: 0,80 x 9
    expect(await poDniu("2026-12-02")).toBe(630); // regula bez stawki: stawka konta 0,70 x 9
    expect(await poDniu("2026-08-01")).toBe(630); // przed pierwsza regula: stawka konta
  });

  it("czesciowe wyjscia: oplaty od zamknietych kontraktow", async () => {
    const konto = await nowyKonto("czesc", "live", 350, 100);
    const t = await zapisz(
      szkicProbki(konto, mnq, {
        status: "open",
        direction: "long",
        entryPrice: 100,
        wyjscia: [{ numer: 1, czas: new Date("2026-10-13T14:10:00Z"), cena: 101, kontrakty: 3, kwotaBrokera: null, notatka: null }],
      }),
    );
    // zamkniete 3 z 9: 4 ticki x 0,50 x 3 = 6,00 minus 3,00
    expect(liczby(t)).toEqual([300, 300, 300]);
  });

  it("»Przelicz historie z oplatami«: podglad niczego nie zmienia, zapis dotyka tylko trade'ow bez kwoty z rachunku", async () => {
    const konto = await nowyKonto("historia", "live", null, null);
    const stary = await zapisz(szkicProbki(konto, mnq, { entryTime: new Date("2026-09-10T14:03:12Z"), wyjscia: [{ numer: 1, czas: new Date("2026-09-10T14:04:41Z"), cena: 30810.5, kontrakty: null, kwotaBrokera: null, notatka: null }] }));
    const zRachunku = await zapisz(szkicProbki(konto, mnq, { entryTime: new Date("2026-09-11T14:03:12Z"), wyjscia: [{ numer: 1, czas: new Date("2026-09-11T14:04:41Z"), cena: 30810.5, kontrakty: null, kwotaBrokera: null, notatka: null }], brokerAmount: -46_000 }));
    expect(liczby(stary)).toEqual([-45_000, null, -45_000]);
    // teraz uzytkownik ustawia stawki
    await sql`update accounts set fee_rt_micro_cents = 100 where id = ${konto}`;

    const { przeliczHistorieUi } = await import("@/lib/decyzje/broker");
    const podglad = await przeliczHistorieUi(false);
    expect(podglad.ok).toBe(true);
    if (!podglad.ok) return;
    expect(podglad.zapisano).toBe(false);
    expect(podglad.podglad.kandydaci).toBeGreaterThanOrEqual(1);
    expect(podglad.podglad.zmieni).toBeGreaterThanOrEqual(1);
    expect(podglad.podglad.sumaRoznicyCenty).toBeLessThanOrEqual(-900); // oplaty obnizaja wynik
    // podglad = zero zapisow
    expect(liczby((await sql`select pnl, fees, pnl_estimate from trades where id = ${stary.id}`)[0] as never)).toEqual([-45_000, null, -45_000]);

    const zapis = await przeliczHistorieUi(true);
    expect(zapis.ok && zapis.zapisano).toBe(true);
    expect(liczby((await sql`select pnl, fees, pnl_estimate from trades where id = ${stary.id}`)[0] as never)).toEqual([-45_900, 900, -45_900]);
    // trade z kwota z rachunku zostaje nietkniety (jego wynik jest faktem), oplaty tez
    const [rachunek] = await sql`select pnl, fees, broker_amount from trades where id = ${zRachunku.id}`;
    expect([Number(rachunek.pnl), rachunek.fees, Number(rachunek.broker_amount)]).toEqual([-46_000, null, -46_000]);
    // wpis w dzienniku zdarzen
    const [{ n }] = await sql`select count(*)::int as n from auth_events where kind = 'broker_history_recalculated'`;
    expect(n).toBeGreaterThanOrEqual(1);
  });
});
