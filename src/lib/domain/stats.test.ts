import { describe, expect, it } from "vitest";

import { DOMYSLNE_PROGI } from "./outcome";
import { computeStats, dailyPnl, emptyStats, equityCurve, rHistogram, type TradeStat } from "./stats";

const progi = DOMYSLNE_PROGI;

/** Piec zamknietych tradeow: +200, -100, +300, -100, -50 USD. Suma: +250 USD.
    Ryzyko 100 USD na kazdym - prog BE domyslny to 10 USD, wiec zaden z nich
    nie wpada w BE. */
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
    pnl,
    rMultiple: r,
    riskAmount: 10_000,
    durationS: 600 * (idx + 1),
    entryTime: new Date(`2026-03-0${idx + 2}T14:30:00Z`),
    tradingDay: `2026-03-0${idx + 2}`,
    contracts: 1,
    maeR: null,
    mfeR: null,
    directionCorrect: null,
    badExecutionReason: null,
    potentialR: null,
  }));
}

describe("computeStats", () => {
  const s = computeStats(sample(), progi);

  it("liczy wynik i podzial na wygrane oraz przegrane", () => {
    expect(s.count).toBe(5);
    expect(s.pnl).toBe(25_000);
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
    const s = computeStats([], progi);
    expect(s).toEqual(emptyStats());
    expect(s.profitFactor).toBeNull();
    expect(s.winRate).toBe(0);
  });

  it("brak strat oznacza brak profit factora, a nie nieskonczonosc", () => {
    const s = computeStats(
      sample().filter((t) => t.pnl > 0),
      progi,
    );
    expect(s.profitFactor).toBeNull();
    expect(s.payoff).toBeNull();
    expect(s.breakEvenWinRate).toBeNull();
  });

  it("trade w widelkach progu BE nie liczy sie ani do wygranych, ani do przegranych", () => {
    const dane = sample();
    dane[0].pnl = 0;
    const s = computeStats(dane, progi);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(3);
    expect(s.be).toBe(1);
  });

  it("trade'y bez stopa nie psuja statystyk w R", () => {
    const dane = sample().map((t) => ({ ...t, rMultiple: null }));
    const s = computeStats(dane, progi);
    expect(s.expectancyR).toBeNull();
    expect(s.countWithR).toBe(0);
    expect(s.pnl).toBe(25_000);
  });
});

describe("wynik BE (ADR-011)", () => {
  /** Ryzyko 10 000 centow, prog domyslny 0,100R -> 1000 centow (10 USD). */
  function trade(id: number, pnl: number, extra: Partial<TradeStat> = {}): TradeStat {
    return {
      id,
      pnl,
      rMultiple: null,
      riskAmount: 10_000,
      directionCorrect: null,
      badExecutionReason: null,
      potentialR: null,
      durationS: null,
      entryTime: new Date(2026, 2, id, 12, 0),
      tradingDay: `2026-03-${String(id).padStart(2, "0")}`,
      contracts: 1,
      maeR: null,
      mfeR: null,
      ...extra,
    };
  }

  it("BE zostaje poza mianownikiem skutecznosci", () => {
    // 2 zyski, 1 strata, 1 BE - skutecznosc liczy sie z 3, nie z 4.
    const s = computeStats(
      [trade(1, 20_000), trade(2, 20_000), trade(3, -10_000), trade(4, 500)],
      progi,
    );
    expect(s.count).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.be).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 6);
  });

  it("profit factor ignoruje trade'y BE", () => {
    const s = computeStats([trade(1, 20_000), trade(2, -10_000), trade(3, 500)], progi);
    // suma zyskow 20000, suma strat 10000 - BE (500) nie wchodzi do zadnej z sum.
    expect(s.profitFactor).toBeCloseTo(2, 6);
  });

  it("BE w srodku serii wygranych nie przerywa jej ani nie przedluza", () => {
    const s = computeStats(
      [trade(1, 20_000), trade(2, 500), trade(3, 20_000)],
      progi,
    );
    // W, BE, W - seria wygranych trwa 2, nie 1 i nie 3.
    expect(s.maxWinStreak).toBe(2);
    expect(s.currentStreak).toBe(2);
  });

  it("BE w srodku serii przegranych nie przerywa jej ani nie przedluza", () => {
    const s = computeStats(
      [trade(1, -20_000), trade(2, 500), trade(3, -20_000)],
      progi,
    );
    // L, BE, L - seria strat trwa 2.
    expect(s.maxLossStreak).toBe(2);
    expect(s.currentStreak).toBe(-2);
  });

  it("liczy beRate jako udzial BE w calej probce", () => {
    const s = computeStats([trade(1, 20_000), trade(2, 500), trade(3, 500), trade(4, 500)], progi);
    expect(s.be).toBe(3);
    expect(s.beRate).toBeCloseTo(0.75, 6);
  });

  it("bez stopa uzywa progu kwotowego na kontrakt", () => {
    // Bez ryzyka prog to 200 centow na kontrakt (domyslny) - 2 kontrakty = 400.
    const bezStopu = trade(1, 400, { riskAmount: null, contracts: 2 });
    const s = computeStats([bezStopu], progi);
    expect(s.be).toBe(1);

    const nadProgiem = trade(2, 401, { riskAmount: null, contracts: 2 });
    const s2 = computeStats([nadProgiem], progi);
    expect(s2.wins).toBe(1);
    expect(s2.be).toBe(0);
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

describe("kierunek a egzekucja (ADR-018)", () => {
  /** Ryzyko 10 000 centow -> prog BE 1000 centow. */
  function t(id: number, pnl: number, extra: Partial<TradeStat> = {}): TradeStat {
    return {
      id,
      pnl,
      rMultiple: pnl / 10_000,
      riskAmount: 10_000,
      durationS: null,
      entryTime: new Date(`2026-03-${String(id).padStart(2, "0")}T14:30:00Z`),
      tradingDay: `2026-03-${String(id).padStart(2, "0")}`,
      contracts: 1,
      maeR: null,
      mfeR: null,
      directionCorrect: null,
      badExecutionReason: null,
      potentialR: null,
      ...extra,
    };
  }

  it("wygrana wchodzi do trafnosci bez zaznaczania, chybienie obniza wynik", () => {
    const s = computeStats(
      [
        t(1, 20_000),
        t(2, -10_000, { directionCorrect: true, badExecutionReason: "early_exit" }),
        t(3, -10_000, { directionCorrect: false }),
        t(4, -10_000), // nieocenione - poza mianownikiem
      ],
      DOMYSLNE_PROGI,
    );
    expect(s.directionCount).toBe(3);
    expect(s.directionHits).toBe(2);
    expect(s.directionAccuracy).toBeCloseTo(2 / 3, 10);
  });

  it("trafnosc kierunku potrafi byc wyzsza niz skutecznosc", () => {
    // Sedno funkcji: system z przewaga i zla reka wyglada inaczej niz system
    // bez przewagi, mimo tego samego winrate.
    const s = computeStats(
      [
        t(1, 20_000),
        t(2, -10_000, { directionCorrect: true }),
        t(3, -10_000, { directionCorrect: true }),
      ],
      DOMYSLNE_PROGI,
    );
    expect(s.winRate).toBeCloseTo(1 / 3, 10);
    expect(s.directionAccuracy).toBe(1);
  });

  it("straty techniczne to trafiony kierunek bez zysku - wygrane sie nie licza", () => {
    const s = computeStats(
      [
        t(1, 20_000),
        t(2, -10_000, { directionCorrect: true }),
        t(3, 500, { directionCorrect: true }), // BE, nie zysk
      ],
      DOMYSLNE_PROGI,
    );
    expect(s.technicalCount).toBe(2);
    expect(s.technicalPnl).toBe(-9_500);
  });

  it("utracone R sumuje sie z clampem na zero per trade", () => {
    const s = computeStats(
      [
        t(1, -10_000, { directionCorrect: true, potentialR: 3 }), // -1R przy potencjale 3R => 4
        t(2, 30_000, { potentialR: 2 }), // wygrana ponad potencjal => 0, nie -1
      ],
      DOMYSLNE_PROGI,
    );
    expect(s.lostR).toBe(4);
    expect(s.lostRCount).toBe(2);
  });

  it("sufit systemu zostaje pusty, gdy nikt nie wpisal potencjalu", () => {
    // Inaczej byloby to expectancyR przebrane za nowa metryke.
    const s = computeStats([t(1, 20_000), t(2, -10_000)], DOMYSLNE_PROGI);
    expect(s.potentialExpectancyR).toBeNull();
    expect(s.lostR).toBe(0);
  });

  it("sufit systemu przewyzsza oczekiwana wartosc o utracone R na trade", () => {
    const s = computeStats(
      [
        t(1, 10_000),
        t(2, -10_000, { directionCorrect: true, potentialR: 3 }),
      ],
      DOMYSLNE_PROGI,
    );
    expect(s.expectancyR).toBeCloseTo(0, 10);
    expect(s.potentialExpectancyR).toBeCloseTo(2, 10);
  });
});

describe("sufit systemu nigdy nie jest nizszy niz oczekiwana wartosc", () => {
  function t(id: number, pnl: number, extra: Partial<TradeStat> = {}): TradeStat {
    return {
      id,
      pnl,
      rMultiple: null,
      riskAmount: 10_000,
      durationS: null,
      entryTime: new Date(`2026-03-${String(id).padStart(2, "0")}T14:30:00Z`),
      tradingDay: `2026-03-${String(id).padStart(2, "0")}`,
      contracts: 1,
      maeR: null,
      mfeR: null,
      directionCorrect: null,
      badExecutionReason: null,
      potentialR: null,
      ...extra,
    };
  }

  it("liczy sie tym samym mianownikiem co expectancyR, mimo trade'ow bez R", () => {
    // Bez wspolnego mianownika trade'y bez stopa (rMultiple = null) rozwadnialy
    // sufit i wychodzil ON PONIZEJ oczekiwanej wartosci, ktora rzekomo ogranicza.
    const s = computeStats(
      [
        t(1, 10_000, { rMultiple: 1 }),
        t(2, -10_000, { rMultiple: -1, directionCorrect: true, potentialR: 3 }),
        t(3, 5_000, { riskAmount: null, rMultiple: null }),
        t(4, 5_000, { riskAmount: null, rMultiple: null }),
      ],
      DOMYSLNE_PROGI,
    );
    expect(s.expectancyR).toBeCloseTo(0, 10);
    expect(s.potentialExpectancyR).toBeCloseTo(2, 10);
    expect(s.potentialExpectancyR!).toBeGreaterThanOrEqual(s.expectancyR!);
  });
});
