import { describe, expect, it } from "vitest";

import { scoreDiscipline } from "./discipline";
import { findEdges } from "./edge-finder";
import { dimension } from "./grouping";
import { DOMYSLNE_PROGI } from "./outcome";
import { assessSample, expectancyInterval, requiredSample } from "./sample-size";
import type { TradeForAnalysis } from "./types";

const progi = DOMYSLNE_PROGI;
let counter = 0;

function trade(n: Partial<TradeForAnalysis> = {}): TradeForAnalysis {
  counter += 1;
  return {
    id: counter,
    pnl: 10_000,
    rMultiple: 1,
    riskAmount: 10_000,
    durationS: 600,
    entryTime: new Date(2026, 2, 2, 15, 30 + counter),
    tradingDay: "2026-03-02",
    contracts: 1,
    maeR: null,
    mfeR: null,
    wynik: "zysk",
    direction: "long",
    accountId: 1,
    accountName: "Glowne",
    instrumentId: 1,
    instrumentSymbol: "NQ",
    exchangeTimezone: "America/New_York",
    strategyId: 1,
    strategyName: "Wybicie",
    backtestSessionId: null,
    marketSession: "rth",
    weekday: 1,
    entryHour: 10,
    moodNote: null,
    readiness: 7,
    executionRating: 4,
    ruleCount: 3,
    rulesMet: 3,
    hasRules: true,
    hasStop: true,
    directionCorrect: null,
    kierunekTrafiony: null,
    badExecutionReason: null,
    potentialR: null,
    exitCount: 1,
    scalingR: null,
    tags: [],
    custom: {},
    ...n,
  };
}

function series(howMany: number, n: Partial<TradeForAnalysis>): TradeForAnalysis[] {
  return Array.from({ length: howMany }, () => trade(n));
}

describe("findEdges", () => {
  const trades = [
    ...series(16, { marketSession: "rth", pnl: 10_000, rMultiple: 1 }),
    ...series(16, { marketSession: "overnight", pnl: -10_000, rMultiple: -1 }),
  ];

  it("wskazuje kontekst o najwyzszej oczekiwanej wartosci", () => {
    const w = findEdges(trades, [dimension("session")], { progi, pairs: false });
    expect(w.edges[0].conditions[0].value).toBe("sesja główna");
    expect(w.edges[0].deltaR).toBeCloseTo(1, 6);
    expect(w.edges[0].count).toBe(16);
  });

  it("wskazuje wyciek po drugiej stronie", () => {
    const w = findEdges(trades, [dimension("session")], { progi, pairs: false });
    expect(w.leaks[0].conditions[0].value).toBe("noc");
    expect(w.leaks[0].deltaR).toBeCloseTo(-1, 6);
  });

  it("pomija konteksty ponizej progu probki i mowi ile ich bylo", () => {
    const small = [
      ...series(20, { instrumentSymbol: "NQ" }),
      ...series(3, { instrumentSymbol: "ES" }),
    ];
    const w = findEdges(small, [dimension("instrument")], { progi, minSample: 15, pairs: false });
    expect(w.edges.concat(w.leaks).some((z) => z.conditions[0].value === "ES")).toBe(false);
    expect(w.skippedTooSmall).toBe(1);
  });

  it("nie zglasza kontekstu obejmujacego cala probe", () => {
    const uniform = series(20, { instrumentSymbol: "NQ" });
    const w = findEdges(uniform, [dimension("instrument")], { progi, pairs: false });
    expect(w.edges).toHaveLength(0);
    expect(w.leaks).toHaveLength(0);
  });

  it("nie bierze pod uwage wymiaru wyliczonego z wyniku", () => {
    // Przedzial R jest funkcja wyniku - "trade'y z +2R do +3R maja 100% skutecznosci"
    // to tautologia, a nie przewaga.
    const mixed = [
      ...series(20, { rMultiple: 2.5, pnl: 25_000 }),
      ...series(20, { rMultiple: -1, pnl: -10_000 }),
    ];
    const w = findEdges(mixed, [dimension("rrange")], { progi, minSample: 15, pairs: false });
    expect(w.edges).toHaveLength(0);
    expect(w.leaks).toHaveLength(0);
  });

  it("pomija wymiar, ktory ma tylko jedna wartosc", () => {
    const oneAccount = [
      ...series(16, { instrumentSymbol: "NQ", pnl: 10_000, rMultiple: 1 }),
      ...series(16, { instrumentSymbol: "ES", pnl: -10_000, rMultiple: -1 }),
    ];
    const w = findEdges(oneAccount, [dimension("account"), dimension("instrument")], {
      progi,
      minSample: 15,
    });
    const wszystkie = w.edges.concat(w.leaks);
    expect(wszystkie.every((z) => z.conditions.every((c) => c.dimension !== "Konto"))).toBe(true);
  });

  it("znajduje przeciecie dwoch wymiarow", () => {
    const mixed = [
      ...series(16, { instrumentSymbol: "NQ", direction: "long", pnl: 20_000, rMultiple: 2 }),
      ...series(16, { instrumentSymbol: "NQ", direction: "short", pnl: -10_000, rMultiple: -1 }),
      ...series(16, { instrumentSymbol: "ES", direction: "long", pnl: -10_000, rMultiple: -1 }),
      ...series(16, { instrumentSymbol: "ES", direction: "short", pnl: -10_000, rMultiple: -1 }),
    ];
    const w = findEdges(mixed, [dimension("instrument"), dimension("direction")], {
      progi,
      minSample: 15,
    });
    expect(w.edges[0].conditions).toHaveLength(2);
    expect(w.edges[0].conditions.map((c) => c.value).sort()).toEqual(["NQ", "long"]);
  });
});

describe("scoreDiscipline", () => {
  it("czysta seria daje sto punktow", () => {
    const w = scoreDiscipline(series(10, {}));
    expect(w.score).toBe(100);
    expect(w.signals).toHaveLength(0);
  });

  it("wykrywa trade bez stopa", () => {
    const w = scoreDiscipline([...series(9, {}), trade({ hasStop: false })]);
    const signal = w.signals.find((s) => s.code === "no_stop");
    expect(signal?.count).toBe(1);
    expect(signal?.share).toBeCloseTo(0.1, 6);
    // 10% tradeow x waga 25 = 2,5 punktu kary
    expect(w.score).toBe(98);
  });

  it("wykrywa niepelna checkliste zasad", () => {
    const w = scoreDiscipline([...series(8, {}), ...series(2, { rulesMet: 1 })]);
    expect(w.signals.find((s) => s.code === "broken_rules")?.count).toBe(2);
  });

  it("wykrywa powiekszenie pozycji po stracie", () => {
    const w = scoreDiscipline([
      trade({ pnl: -10_000, contracts: 1 }),
      trade({ pnl: 5_000, contracts: 3 }),
    ]);
    expect(w.signals.find((s) => s.code === "size_up_after_loss")?.count).toBe(1);
  });

  it("wykrywa wejscie tuz po stracie tego samego dnia", () => {
    const first = trade({
      pnl: -10_000,
      entryTime: new Date("2026-03-02T14:00:00Z"),
      durationS: 600,
    });
    const second = trade({ entryTime: new Date("2026-03-02T14:12:00Z") });
    const w = scoreDiscipline([first, second]);
    expect(w.signals.find((s) => s.code === "revenge")?.count).toBe(1);
  });

  it("nie uznaje za odwet wejscia po dlugiej przerwie", () => {
    const first = trade({
      pnl: -10_000,
      entryTime: new Date("2026-03-02T14:00:00Z"),
      durationS: 600,
    });
    const second = trade({ entryTime: new Date("2026-03-02T18:00:00Z") });
    const w = scoreDiscipline([first, second]);
    expect(w.signals.find((s) => s.code === "revenge")).toBeUndefined();
  });

  it("wykrywa ryzyko ponad wlasna norme", () => {
    const w = scoreDiscipline([...series(9, { riskAmount: 10_000 }), trade({ riskAmount: 40_000 })]);
    expect(w.signals.find((s) => s.code === "risk_above_norm")?.count).toBe(1);
  });
});

describe("assessSample", () => {
  it("ponizej progu mowi wprost, ze liczby nic nie znacza", () => {
    const o = assessSample(8, 100, 15);
    expect(o.status).toBe("too_small");
    expect(o.message).toContain("8 z 100");
  });

  it("miedzy progiem a celem oznacza probke jako wstepna", () => {
    const o = assessSample(63, 100, 15);
    expect(o.status).toBe("preliminary");
    expect(o.percent).toBe(63);
  });

  it("po osiagnieciu celu probka jest pelna", () => {
    expect(assessSample(120, 100, 15).status).toBe("full");
    expect(assessSample(120, 100, 15).percent).toBe(100);
  });
});

describe("niepewnosc wyniku", () => {
  it("liczy przedzial ufnosci dla oczekiwanej wartosci", () => {
    const p = expectancyInterval(0.5, 2, 100);
    expect(p?.margin).toBeCloseTo(0.392, 3);
    expect(p?.low).toBeCloseTo(0.108, 3);
    expect(p?.high).toBeCloseTo(0.892, 3);
  });

  it("bez odchylenia nie ma przedzialu", () => {
    expect(expectancyInterval(0.5, null, 100)).toBeNull();
    expect(expectancyInterval(0.5, 2, 1)).toBeNull();
  });

  it("mowi ile trade'ow potrzeba do zadanej precyzji", () => {
    expect(requiredSample(2, 0.2)).toBe(385);
    expect(requiredSample(null)).toBeNull();
  });
});

describe("findEdges a tag powtorzony na kilku interwalach (ADR-017)", () => {
  let nr = 0;
  const konfluencja = (interval: string) => ({
    assignmentId: (nr += 1),
    id: 7,
    name: "FVG",
    category: "Konfluencje",
    categoryKey: "confluence",
    color: "#fff",
    interval,
  });

  it("nie zawyza probki, przez co kontekst nie przechodzi progu na kredyt", () => {
    // Dziesiec trade'ow, kazdy z FVG na 4h i na 5m. Bez deduplikacji kubelek
    // "FVG" mialby 20 pozycji i przeszedlby minSample=15 - Edge Finder
    // oglosilby przewage policzona z dziesieciu trade'ow policzonych podwojnie.
    const trades = Array.from({ length: 10 }, (_, i) =>
      trade({
        id: i + 1,
        pnl: 10_000,
        rMultiple: 1,
        tags: [konfluencja("4h"), konfluencja("5m")],
      }),
    ).concat(
      Array.from({ length: 20 }, (_, i) =>
        trade({ id: 100 + i, pnl: -10_000, rMultiple: -1, tags: [] }),
      ),
    );

    const w = findEdges(trades, [dimension("tag:confluence")], {
      progi,
      minSample: 15,
      pairs: false,
    });
    expect(w.edges.find((z) => z.key.includes("FVG"))).toBeUndefined();
  });

  it("liczy taki trade raz, gdy probka jest wystarczajaca", () => {
    const trades = Array.from({ length: 16 }, (_, i) =>
      trade({
        id: i + 1,
        pnl: 10_000,
        rMultiple: 1,
        tags: [konfluencja("4h"), konfluencja("5m")],
      }),
    ).concat(
      // Druga wartosc wymiaru jest konieczna: wymiar o jednym kubelku nie
      // rozroznia niczego i Edge Finder odrzuca go, zanim cokolwiek policzy.
      Array.from({ length: 16 }, (_, i) =>
        trade({
          id: 100 + i,
          pnl: -10_000,
          rMultiple: -1,
          tags: [{ ...konfluencja("5m"), id: 8, name: "EQ" }],
        }),
      ),
    );

    const w = findEdges(trades, [dimension("tag:confluence")], {
      progi,
      minSample: 15,
      pairs: false,
    });
    const znalezisko = w.edges.find((z) => z.key.includes("FVG"));
    expect(znalezisko?.count).toBe(16);
  });
});
