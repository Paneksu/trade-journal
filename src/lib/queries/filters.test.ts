import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { DOMYSLNE_PROGI } from "@/lib/domain/outcome";

import { activeFilterCount, EMPTY_FILTERS, parseFilters, toSearchParams, whereClause } from "./filters";

const dialekt = new PgDialect();

function sqlDla(adres: string) {
  const f = parseFilters(Object.fromEntries(new URLSearchParams(adres)));
  const w = whereClause(f, DOMYSLNE_PROGI);
  return w ? dialekt.sqlToQuery(w) : { sql: "", params: [] as unknown[] };
}

describe("filtry: kategoria (ADR-027)", () => {
  it("parsuje tylko znane kategorie i odrzuca smieci", () => {
    expect(parseFilters({ kategoria: "realne,prop_eval,wymyslona" }).categories).toEqual(["realne", "prop_eval"]);
    expect(parseFilters({ kategoria: "x" }).categories).toEqual([]);
  });

  it("SQL zawiera warunki kont, bez wartosci wklejonych w tresc", () => {
    const q = sqlDla("kategoria=prop_eval,prop_funded&zrodlo=wszystko");
    expect(q.sql).toContain("a.prop_phase = 'eval'");
    expect(q.sql).toContain("a.prop_phase = 'funded'");
    expect(q.sql).toContain("select a.id from accounts a");
  });

  it("realne i demo mapuja sie na typ konta", () => {
    expect(sqlDla("kategoria=realne&zrodlo=wszystko").sql).toContain("a.type::text = 'live'");
    expect(sqlDla("kategoria=demo&zrodlo=wszystko").sql).toContain("a.type::text in ('demo', 'paper')");
  });
});

describe("filtry: zrodlo forward i backtest (ADR-027)", () => {
  it("forward zaweza do sesji rodzaju forward i przekazuje rodzaj jako parametr", () => {
    const q = sqlDla("zrodlo=forward");
    expect(q.sql).toContain("backtest_sessions where kind =");
    expect(q.params).toContain("forward");
  });

  it("backtest to teraz tylko sesje rodzaju backtest, a konkretna sesja bije rodzaj", () => {
    expect(sqlDla("zrodlo=backtest").params).toContain("backtest");
    const konkretna = sqlDla("zrodlo=forward&sesja=7");
    expect(konkretna.sql).not.toContain("backtest_sessions where kind");
    expect(konkretna.params).toContain(7);
  });

  it("wracaja do adresu przez toSearchParams", () => {
    expect(toSearchParams(parseFilters({ zrodlo: "forward" })).get("zrodlo")).toBe("forward");
    expect(toSearchParams(parseFilters({ zrodlo: "backtest" })).get("zrodlo")).toBe("backtest");
    expect(toSearchParams(parseFilters({ zrodlo: "wszystko" })).get("zrodlo")).toBe("wszystko");
    expect(toSearchParams(parseFilters({})).get("zrodlo")).toBeNull();
  });
});

describe("filtry: zgodnosc z regulami (ADR-028)", () => {
  it("znane wartosci przechodza, nieznane znikaja", () => {
    expect(parseFilters({ zgodnosc: "niezgodne" }).compliance).toBe("niezgodne");
    expect(parseFilters({ zgodnosc: "zgodne" }).compliance).toBe("zgodne");
    expect(parseFilters({ zgodnosc: "nieocenione" }).compliance).toBe("nieocenione");
    expect(parseFilters({ zgodnosc: "pewnie" }).compliance).toBeNull();
  });

  it("niezgodne = istnieje fail; zgodne = istnieje pass i nie ma fail; nieocenione = nie ma pass ani fail", () => {
    expect(sqlDla("zgodnosc=niezgodne").sql).toContain("c.verdict = 'fail'");
    const zgodne = sqlDla("zgodnosc=zgodne").sql;
    expect(zgodne).toContain("c.verdict = 'pass'");
    expect(zgodne).toMatch(/not exists \(select 1 from \(\s*select distinct on \(c0\.rule_id\)[\s\S]*\) c where c\.verdict = 'fail'/);
    expect(sqlDla("zgodnosc=nieocenione").sql).toContain("c.verdict in ('pass', 'fail')");
  });

  it("regula i werdykt ida jako parametry, a smieciowe id reguly jest odrzucane przed SQL", () => {
    const q = sqlDla("regula=R-007&werdykt=fail");
    expect(q.params).toEqual(expect.arrayContaining(["R-007", "fail"]));
    expect(q.sql).not.toContain("R-007");
    expect(parseFilters({ regula: "R-1'; drop table trades;--" }).rule).toBeNull();
    expect(parseFilters({ werdykt: "maybe" }).ruleVerdict).toBeNull();
    expect(sqlDla("regula=R-1'; drop table trades;--").sql).not.toContain("trade_rule_checks");
  });

  it("sam werdykt dziala na dowolnej regule, sama regula na dowolnym werdykcie", () => {
    expect(sqlDla("werdykt=fail").sql).toContain("c.verdict =");
    expect(sqlDla("werdykt=fail").sql).not.toContain("c.rule_id");
    expect(sqlDla("regula=R-7").sql).toContain("c.rule_id =");
    expect(sqlDla("regula=R-7").sql).not.toContain("c.verdict =");
  });

  it("filtry wracaja do adresu i licza sie jako aktywne", () => {
    const f = parseFilters({ kategoria: "demo", zgodnosc: "niezgodne", regula: "R-7", werdykt: "fail" });
    const p = toSearchParams(f);
    expect(p.get("kategoria")).toBe("demo");
    expect(p.get("zgodnosc")).toBe("niezgodne");
    expect(p.get("regula")).toBe("R-7");
    expect(p.get("werdykt")).toBe("fail");
    expect(activeFilterCount(f)).toBe(3); // regula + werdykt to jeden filtr
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });
});
