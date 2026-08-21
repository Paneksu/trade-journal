import { describe, expect, it } from "vitest";

import { dimension, dimensionsForFields, durationBucket, groupBy, sizeBucket } from "./grouping";
import type { TradeForAnalysis } from "./types";

function trade(n: Partial<TradeForAnalysis> = {}): TradeForAnalysis {
  return {
    id: 1,
    pnlNet: 10_000,
    pnlGross: 10_400,
    commission: 400,
    rMultiple: 1,
    riskAmount: 10_000,
    durationS: 600,
    entryTime: new Date("2026-03-02T14:30:00Z"),
    tradingDay: "2026-03-02",
    contracts: 1,
    maeR: null,
    mfeR: null,
    direction: "long",
    accountId: 1,
    accountName: "Glowne",
    instrumentId: 1,
    instrumentSymbol: "NQ",
    strategyId: 1,
    strategyName: "Wybicie",
    backtestSessionId: null,
    marketSession: "rth",
    weekday: 1,
    entryHour: 10,
    executionRating: 4,
    ruleCount: 3,
    rulesMet: 3,
    hasRules: true,
    hasStop: true,
    tags: [],
    custom: {},
    ...n,
  };
}

describe("groupBy", () => {
  it("dzieli trade'y na grupy i liczy statystyki kazdej z osobna", () => {
    const trades = [
      trade({ id: 1, instrumentSymbol: "NQ", pnlNet: 10_000 }),
      trade({ id: 2, instrumentSymbol: "NQ", pnlNet: -5_000 }),
      trade({ id: 3, instrumentSymbol: "ES", pnlNet: 20_000 }),
    ];
    const groups = groupBy(trades, dimension("instrument"));
    expect(groups).toHaveLength(2);
    const nq = groups.find((g) => g.label === "NQ");
    expect(nq?.stats.count).toBe(2);
    expect(nq?.stats.pnlNet).toBe(5_000);
    expect(groups.find((g) => g.label === "ES")?.stats.pnlNet).toBe(20_000);
  });

  it("sortuje grupy malejaco po wyniku netto", () => {
    const trades = [
      trade({ id: 1, instrumentSymbol: "NQ", pnlNet: -5_000 }),
      trade({ id: 2, instrumentSymbol: "ES", pnlNet: 20_000 }),
    ];
    expect(groupBy(trades, dimension("instrument"))[0].label).toBe("ES");
  });

  it("trade z dwoma tagami trafia do obu grup", () => {
    const tag = (id: number, name: string) => ({
      id,
      name,
      category: "Setup",
      categoryKey: "setup",
      color: "#fff",
    });
    const trades = [trade({ id: 1, tags: [tag(1, "wybicie"), tag(2, "trend")] })];
    const groups = groupBy(trades, dimension("tag:setup"));
    expect(groups.map((g) => g.label).sort()).toEqual(["trend", "wybicie"]);
  });

  it("trade bez wartosci trafia do grupy nieprzypisanych", () => {
    const groups = groupBy([trade({ strategyName: null })], dimension("strategy"));
    expect(groups[0].label).toBe("bez strategii");
    expect(groups[0].key).toBe("");
  });

  it("grupuje po polu wlasnym typu select", () => {
    const trades = [
      trade({ id: 1, custom: { nastroj: "spokoj" }, pnlNet: 10_000 }),
      trade({ id: 2, custom: { nastroj: "presja" }, pnlNet: -20_000 }),
    ];
    const groups = groupBy(trades, dimension("field:nastroj"));
    expect(groups[0].label).toBe("spokoj");
    expect(groups[1].stats.pnlNet).toBe(-20_000);
  });

  it("pole wielokrotnego wyboru rozklada sie na kilka grup", () => {
    const trades = [trade({ custom: { bledy: ["za wczesnie", "za duzo"] } })];
    expect(groupBy(trades, dimension("field:bledy"))).toHaveLength(2);
  });
});

describe("koszyki", () => {
  it("czas trwania wpada do przedzialu", () => {
    expect(durationBucket(45)).toBe("do 1 min");
    expect(durationBucket(600)).toBe("5-15 min");
    expect(durationBucket(7_200)).toBe("ponad 1 h");
  });

  it("wielkosc pozycji wpada do przedzialu", () => {
    expect(sizeBucket(1)).toBe("1 kontrakt");
    expect(sizeBucket(3)).toBe("3-4 kontrakty");
    expect(sizeBucket(12)).toBe("10+ kontraktów");
  });
});

describe("dimensionsForFields", () => {
  it("buduje wymiary tylko dla pol wlaczonych do statystyk", () => {
    const dims = dimensionsForFields([
      { key: "nastroj", label: "Nastroj", type: "select", inStats: true },
      { key: "notatka", label: "Notatka", type: "text", inStats: true },
      { key: "ukryte", label: "Ukryte", type: "select", inStats: false },
    ]);
    expect(dims.map((w) => w.key)).toEqual(["field:nastroj"]);
  });
});
