import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EMPTY_FILTERS, parseFilters } from "./filters";

/*
 * Test na PRAWDZIWEJ, lokalnej bazie: zapytania zgodnosci (queries/oceny.ts)
 * i filtry SQL, ktorych atrapa bazy by nie sprawdzila (ADR-028). Uruchamia sie
 * tylko wtedy, gdy DATABASE_URL wskazuje na 127.0.0.1 / localhost - bez tego
 * jest POMINIETY (i raport musi to powiedziec), nigdy nie siega po produkcje.
 */

vi.mock("server-only", () => ({}));

const URL_BAZY = process.env.DATABASE_URL ?? "";
function lokalna(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

describe.skipIf(!lokalna(URL_BAZY))("zgodnosc z regulami na prawdziwej bazie", () => {
  const sql = postgres(URL_BAZY, { max: 2 });
  const PREFIKS = "ZGODNOSC-TEST";
  let kontoId = 0;
  const idyTradow: number[] = [];

  async function trade(dzien: string, r: number, status = "closed"): Promise<number> {
    const [w] = await sql`
      insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts,
                          pnl, risk_amount, r_multiple, trading_day, note)
      values (${kontoId}, (select id from instruments where symbol = 'NQ'), 'long', ${status}::trade_status,
              ${dzien + "T14:35:00Z"}, 20000, 1, ${Math.round(r * 40000)}, 40000, ${r}, ${dzien}, ${PREFIKS})
      returning id`;
    idyTradow.push(w.id);
    return w.id;
  }

  async function ocena(tradeId: number, basis: "chart" | "history", reguly: [string, string, string?][]) {
    const [rev] = await sql`insert into trade_reviews (trade_id, basis) values (${tradeId}, ${basis}) returning id`;
    for (const [ruleId, verdict, user] of reguly) {
      await sql`insert into trade_rule_checks (review_id, rule_id, rule_text, verdict, user_verdict)
                values (${rev.id}, ${ruleId}, ${"tresc " + ruleId}, ${verdict}, ${user ?? null})`;
    }
  }

  beforeAll(async () => {
    const [k] = await sql`insert into accounts (name, type) values (${PREFIKS}, 'live') returning id`;
    kontoId = k.id;

    // Dzien 1992-05-01..: cztery zamkniete trady + jeden nie wziety (nie liczy sie do statystyk).
    const t1 = await trade("1992-05-04", 2);
    const t2 = await trade("1992-05-05", -1);
    const t3 = await trade("1992-05-06", 1);
    await trade("1992-05-07", 0.5); // bez oceny AI
    const tMissed = await trade("1992-05-08", 3, "missed");

    await ocena(t1, "chart", [["R-1", "pass"], ["R-2", "pass", "agree"]]);
    await ocena(t2, "chart", [["R-1", "fail", "disagree"], ["R-2", "pass"], ["R-3", "na"]]);
    // t3: ocena z wykresu mowi pass, ocena po fakcie fail - przy "kazda" wygrywa ta z wykresu (nie znala wyniku), regula liczy sie raz
    await ocena(t3, "chart", [["R-1", "pass"]]);
    await ocena(t3, "history", [["R-1", "fail"]]);
    await ocena(tMissed, "chart", [["R-1", "fail"]]);
  });

  afterAll(async () => {
    await sql`delete from trades where note = ${PREFIKS}`;
    await sql`delete from accounts where name = ${PREFIKS}`;
    await sql.end();
  });

  const zakres = () => ({ ...EMPTY_FILTERS, from: "1992-05-01", to: "1992-05-31", accounts: [kontoId] });

  it("liczy tylko pass/fail w mianowniku, a na i trady bez oceny osobno; 'nie wziete' nie wchodza", async () => {
    const { getZgodnosc } = await import("./oceny");
    const w = await getZgodnosc(zakres());

    // reguly: R-1: t1 pass, t2 fail, t3 pass(chart); R-2: t1 pass, t2 pass; R-3: t2 na
    expect(w.reguly).toEqual({ ocenione: 5, zgodne: 4, niezgodne: 1, nieocenione: 1, zgodnoscPct: 80 });
    // trady: t1 zgodny, t2 niezgodny (R-1 fail), t3 zgodny; czwarty bez oceny
    expect(w.trady).toMatchObject({ ocenione: 3, zgodne: 2, niezgodne: 1, nieocenione: 1, zgodnoscPct: 66.7 });

    const r1 = w.poRegule.find((r) => r.ruleId === "R-1")!;
    expect(r1).toMatchObject({ ocenione: 3, zgodne: 2, niezgodne: 1, nieocenione: 0 });
    expect(r1.sredniaRPrzyDotrzymaniu).toBe(1.5); // t1 (2R) i t3 (1R)
    expect(r1.sredniaRPrzyZlamaniu).toBe(-1); // t2
    expect(w.poRegule[0].ruleId).toBe("R-1"); // najczesciej lamana na gorze
    expect(w.zgodaUzytkownika).toEqual({ wypowiedzi: 2, zgadzaSie: 1, niezgadzaSie: 1, zgodaPct: 50 });
  });

  it("podstawa=chart bierze tylko oceny z wykresu", async () => {
    const { getZgodnosc } = await import("./oceny");
    const w = await getZgodnosc(zakres(), "chart");
    const r1 = w.poRegule.find((r) => r.ruleId === "R-1")!;
    expect(r1).toMatchObject({ zgodne: 2, niezgodne: 1 }); // t3 chart = pass
  });

  it("podstawa=history bierze tylko oceny po fakcie", async () => {
    const { getZgodnosc } = await import("./oceny");
    const w = await getZgodnosc(zakres(), "history");
    expect(w.reguly).toMatchObject({ ocenione: 1, zgodne: 0, niezgodne: 1 }); // tylko t3 R-1 fail
    expect(w.trady.nieocenione).toBe(3); // reszta bez oceny po fakcie
  });

  it("ocena po fakcie uzupelnia regule, ktorej ocena z wykresu nie rozstrzygnela (na)", async () => {
    const { getZgodnosc } = await import("./oceny");
    const [t] = await sql`select id from trades where note = ${PREFIKS} and trading_day = '1992-05-05'`;
    const [rev] = await sql`insert into trade_reviews (trade_id, basis) values (${t.id}, 'history') returning id`;
    await sql`insert into trade_rule_checks (review_id, rule_id, rule_text, verdict) values (${rev.id}, 'R-3', 'tresc R-3', 'fail')`;
    const w = await getZgodnosc(zakres());
    const r3 = w.poRegule.find((r) => r.ruleId === "R-3")!;
    expect(r3).toMatchObject({ ocenione: 1, niezgodne: 1, nieocenione: 0 }); // na z wykresu ustapilo ocenie po fakcie
    await sql`delete from trade_reviews where id = ${rev.id}`;
  });

  it("filtr regula+werdykt i zgodnosc zwracaja te same trady co zestawienie (getTrades)", async () => {
    const { getTrades } = await import("./trades");
    const f = (adres: string) => ({
      ...parseFilters(Object.fromEntries(new URLSearchParams(adres))),
      from: "1992-05-01",
      to: "1992-05-31",
      accounts: [kontoId],
      source: "all" as const,
    });
    const dni = async (adres: string) => (await getTrades(f(adres))).map((t) => t.tradingDay).sort();

    // t3 ma pass z wykresu i fail po fakcie: ta sama regula, wygrywa wykres, wiec trade jest zgodny
    // (identycznie jak w zestawieniu powyzej - lista i liczby nie moga sie roznic)
    expect(await dni("zgodnosc=niezgodne")).toEqual(["1992-05-05", "1992-05-08"]);
    expect(await dni("zgodnosc=zgodne")).toEqual(["1992-05-04", "1992-05-06"]);
    // nie wziety trade ma tylko fail, wiec jest niezgodny; trade bez oceny jest nieoceniony
    expect(await dni("zgodnosc=nieocenione")).toEqual(["1992-05-07"]);
    expect(await dni("regula=R-3&werdykt=na")).toEqual(["1992-05-05"]);
    expect(await dni("regula=R-3&werdykt=fail")).toEqual([]);
    expect(await dni("werdykt=na")).toEqual(["1992-05-05"]);
    expect(await dni("regula=R-2")).toEqual(["1992-05-04", "1992-05-05"]);
    expect(await dni("kategoria=realne")).toEqual(["1992-05-04", "1992-05-05", "1992-05-06", "1992-05-07", "1992-05-08"]);
    expect(await dni("kategoria=prop_eval")).toEqual([]);
  });
});
