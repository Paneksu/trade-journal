import { describe, expect, it } from "vitest";

import {
  businessDays,
  journalCoverage,
  noTradeBreakdown,
  reasonName,
  type DayFlag,
} from "./day-log";

function flag(day: string, noTradeReason: string | null): DayFlag {
  return { day, noTrade: true, noTradeReason };
}

describe("businessDays", () => {
  it("pomija sobote i niedziele", () => {
    // 2026-08-03 to poniedzialek, 2026-08-09 to niedziela.
    expect(businessDays("2026-08-03", "2026-08-09")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });

  it("obcina zakres do dzisiaj wlacznie", () => {
    const dni = businessDays("2026-08-01", "2026-08-31", "2026-08-05");
    expect(dni).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
  });

  it("zwraca pusto, gdy dzisiaj jest przed poczatkiem zakresu", () => {
    expect(businessDays("2026-09-01", "2026-09-30", "2026-08-21")).toEqual([]);
  });

  it("nie obcina, gdy dzisiaj jest po koncu zakresu", () => {
    expect(businessDays("2026-08-03", "2026-08-04", "2026-12-01")).toHaveLength(2);
  });
});

describe("journalCoverage", () => {
  const zakres = { from: "2026-08-03", to: "2026-08-07" }; // pon-pt

  it("liczy dni robocze z jakimkolwiek zapisem", () => {
    const c = journalCoverage({
      ...zakres,
      tradedDays: ["2026-08-03", "2026-08-04"],
      noTradeDays: ["2026-08-05"],
    });
    expect(c.expected).toBe(5);
    expect(c.covered).toBe(3);
    expect(c.ratio).toBeCloseTo(0.6, 5);
    expect(c.missing).toEqual(["2026-08-06", "2026-08-07"]);
  });

  it("nie liczy tego samego dnia dwa razy", () => {
    const c = journalCoverage({
      ...zakres,
      tradedDays: ["2026-08-03"],
      noTradeDays: ["2026-08-03"],
    });
    expect(c.covered).toBe(1);
  });

  it("ignoruje zapisy z weekendu i spoza zakresu", () => {
    const c = journalCoverage({
      ...zakres,
      tradedDays: ["2026-08-08", "2026-07-31"],
      noTradeDays: [],
    });
    expect(c.covered).toBe(0);
    expect(c.expected).toBe(5);
  });

  it("liczy dzien z samym nie wzietym setupem jako pokryty", () => {
    // Zapisany "missed" (setup byl, nie zostal wziety) jest wpisem do
    // dziennika tak samo jak trade zamkniety - wywolujacy ma go wliczyc do
    // `tradedDays`, mimo ze nie ma tam zadnego zamknietego trade'a ani
    // notatki "bez transakcji" (recenzja 2026-08-30, znalezisko 6).
    const c = journalCoverage({
      ...zakres,
      tradedDays: ["2026-08-03"],
      noTradeDays: [],
    });
    expect(c.covered).toBe(1);
    expect(c.missing).not.toContain("2026-08-03");
  });

  it("zakres bez dni roboczych nie ma pokrycia, a nie zerowe", () => {
    const c = journalCoverage({
      from: "2026-08-08",
      to: "2026-08-09",
      tradedDays: [],
      noTradeDays: [],
    });
    expect(c.expected).toBe(0);
    expect(c.ratio).toBeNull();
  });

  it("nie karze za dni, ktore jeszcze nie nadeszly", () => {
    const c = journalCoverage({
      from: "2026-08-03",
      to: "2026-08-31",
      today: "2026-08-04",
      tradedDays: ["2026-08-03", "2026-08-04"],
      noTradeDays: [],
    });
    expect(c.expected).toBe(2);
    expect(c.ratio).toBe(1);
  });
});

describe("noTradeBreakdown", () => {
  it("zlicza powody malejaco", () => {
    const out = noTradeBreakdown([
      flag("2026-08-03", "no_setup"),
      flag("2026-08-04", "market_conditions"),
      flag("2026-08-05", "no_setup"),
    ]);
    expect(out).toEqual([
      { code: "no_setup", label: "Brak setupu", count: 2 },
      { code: "market_conditions", label: "Warunki rynkowe", count: 1 },
    ]);
  });

  it("pomija dni bez flagi i bez powodu", () => {
    const out = noTradeBreakdown([
      { day: "2026-08-03", noTrade: false, noTradeReason: "no_setup" },
      flag("2026-08-04", null),
      flag("2026-08-05", "wymyslony_kod"),
    ]);
    expect(out).toEqual([]);
  });
});

describe("reasonName", () => {
  it("tlumaczy znany kod", () => {
    expect(reasonName("day_off")).toBe("Dzień wolny");
  });

  it("nieznany kod nie wywraca widoku", () => {
    expect(reasonName("cokolwiek")).toBeNull();
    expect(reasonName(null)).toBeNull();
  });
});
