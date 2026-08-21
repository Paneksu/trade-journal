import { describe, expect, it } from "vitest";

import { computeStats, dailyPnl, emptyStats, equityCurve, rHistogram, type TradeStat } from "./stats";

/** Piec zamknietych tradeow: +200, -100, +300, -100, -50 USD. Suma: +250 USD. */
function sample(): TradeStat[] {
  const dane: [number, number | null][] = [
    [20_000, 2],
    [-10_000, -1],
    [30_000, 3],
    [-10_000, -1],
    [-5_000, -0.5],
  ];
  return dane.map(([pnl, r], idx) => ({
    id: idx + 1,
    pnlNet: pnl,
    pnlGross: pnl + 400,
    commission: 400,
    rMultiple: r,
    riskAmount: 10_000,
    durationS: 600 * (idx + 1),
    entryTime: new Date(`2026-03-0${idx + 2}T14:30:00Z`),
    tradingDay: `2026-03-0${idx + 2}`,
    contracts: 1,
    maeR: null,
    mfeR: null,
  }));
}

describe("computeStats", () => {
  const s = computeStats(sample());

  it("liczy wynik netto i podzial na wygrane oraz przegrane", () => {
    expect(s.count).toBe(5);
    expect(s.pnlNet).toBe(25_000);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(3);
    expect(s.winRate).toBeCloseTo(0.4, 6);
  });

  it("liczy srednia wygrana, srednia strate i payoff", () => {
    expect(s.avgWin).toBe(25_000);
    expect(s.avgLoss).toBeCloseTo(8_333.3333, 3);
    expect(s.payoff).toBeCloseTo(3, 6);
  });

  it("liczy profit factor jako iloraz sumy zyskow i sumy strat", () => {
    expect(s.profitFactor).toBeCloseTo(2, 6);
  });

  it("liczy oczekiwana wartosc na trade w gotowce i w R", () => {
    expect(s.expectancyCash).toBe(5_000);
    expect(s.expectancyR).toBeCloseTo(0.5, 6);
    expect(s.sumR).toBeCloseTo(2.5, 6);
  });

  it("liczy maksymalne obsuniecie z krzywej kapitalu, nie z pojedynczej straty", () => {
    expect(s.maxDrawdown).toBe(15_000);
  });

  it("liczy serie wygranych i przegranych", () => {
    expect(s.maxWinStreak).toBe(1);
    expect(s.maxLossStreak).toBe(2);
    expect(s.currentStreak).toBe(-2);
  });

  it("liczy odchylenie R i wskaznik jakosci systemu", () => {
    expect(s.stdevR).toBeCloseTo(1.8708, 4);
    expect(s.systemQuality).toBeCloseTo(0.2673, 4);
  });

  it("liczy prog oplacalnosci z payoffu", () => {
    expect(s.breakEvenWinRate).toBeCloseTo(0.25, 6);
  });

  it("podaje najlepszy i najgorszy trade", () => {
    expect(s.best).toBe(30_000);
    expect(s.worst).toBe(-10_000);
  });

  it("liczy sredni czas trwania", () => {
    expect(s.avgDurationS).toBe(1_800);
  });
});

describe("przypadki brzegowe", () => {
  it("pusta lista daje zerowe statystyki, a nie bledy dzielenia", () => {
    const s = computeStats([]);
    expect(s).toEqual(emptyStats());
    expect(s.profitFactor).toBeNull();
    expect(s.winRate).toBe(0);
  });

  it("brak strat oznacza brak profit factora, a nie nieskonczonosc", () => {
    const s = computeStats(sample().filter((t) => t.pnlNet > 0));
    expect(s.profitFactor).toBeNull();
    expect(s.payoff).toBeNull();
    expect(s.breakEvenWinRate).toBeNull();
  });

  it("trade na zero nie liczy sie ani do wygranych, ani do przegranych", () => {
    const dane = sample();
    dane[0].pnlNet = 0;
    const s = computeStats(dane);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(3);
    expect(s.flat).toBe(1);
  });

  it("trade'y bez stopa nie psuja statystyk w R", () => {
    const dane = sample().map((t) => ({ ...t, rMultiple: null }));
    const s = computeStats(dane);
    expect(s.expectancyR).toBeNull();
    expect(s.countWithR).toBe(0);
    expect(s.pnlNet).toBe(25_000);
  });
});

describe("equityCurve", () => {
  it("narasta od salda poczatkowego i zapamietuje szczyt oraz obsuniecie", () => {
    const punkty = equityCurve(sample(), 100_000);
    expect(punkty).toHaveLength(6);
    expect(punkty[0].equity).toBe(100_000);
    expect(punkty[3].equity).toBe(140_000);
    expect(punkty[5].equity).toBe(125_000);
    expect(punkty[5].drawdown).toBe(15_000);
    expect(punkty[3].drawdown).toBe(0);
  });

  it("porzadkuje trade'y po czasie wejscia niezaleznie od kolejnosci na wejsciu", () => {
    const odwrocone = [...sample()].reverse();
    const punkty = equityCurve(odwrocone, 0);
    expect(punkty.at(-1)?.equity).toBe(25_000);
    expect(punkty[1].equity).toBe(20_000);
  });
});

describe("dailyPnl", () => {
  it("sumuje wynik w obrebie jednego dnia handlowego", () => {
    const dane = sample().map((t) => ({ ...t, tradingDay: "2026-03-02" }));
    const dni = dailyPnl(dane);
    expect(dni).toHaveLength(1);
    expect(dni[0].pnl).toBe(25_000);
    expect(dni[0].count).toBe(5);
  });

  it("zwraca dni w kolejnosci chronologicznej", () => {
    expect(dailyPnl(sample()).map((d) => d.day)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
    ]);
  });
});

describe("rHistogram", () => {
  it("grupuje wyniki w przedzialy po pol R", () => {
    const h = rHistogram(sample());
    expect(h.map((b) => b.bucket)).toEqual([-1, -0.5, 2, 3]);
    expect(h.find((b) => b.bucket === -1)?.count).toBe(2);
  });

  it("pomija trade'y bez R", () => {
    expect(rHistogram(sample().map((t) => ({ ...t, rMultiple: null })))).toEqual([]);
  });
});
