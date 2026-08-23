import { describe, expect, it } from "vitest";

import { dimension, dimensionsForFields, durationBucket, groupBy, sizeBucket } from "./grouping";
import { DOMYSLNE_PROGI } from "./outcome";
import type { TradeForAnalysis } from "./types";

const progi = DOMYSLNE_PROGI;

function trade(n: Partial<TradeForAnalysis> = {}): TradeForAnalysis {
  return {
    id: 1,
    pnl: 10_000,
    rMultiple: 1,
    riskAmount: 10_000,
    durationS: 600,
    entryTime: new Date("2026-03-02T14:30:00Z"),
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

function tag(
  id: number,
  name: string,
  interval: string | null = null,
  category = "Setup",
  categoryKey = "setup",
) {
  return { id, name, category, categoryKey, color: "#fff", interval };
}

describe("groupBy", () => {
  it("dzieli trade'y na grupy i liczy statystyki kazdej z osobna", () => {
    const trades = [
      trade({ id: 1, instrumentSymbol: "NQ", pnl: 10_000 }),
      trade({ id: 2, instrumentSymbol: "NQ", pnl: -5_000 }),
      trade({ id: 3, instrumentSymbol: "ES", pnl: 20_000 }),
    ];
    const groups = groupBy(trades, dimension("instrument"), { progi });
    expect(groups).toHaveLength(2);
    const nq = groups.find((g) => g.label === "NQ");
    expect(nq?.stats.count).toBe(2);
    expect(nq?.stats.pnl).toBe(5_000);
    expect(groups.find((g) => g.label === "ES")?.stats.pnl).toBe(20_000);
  });

  it("sortuje grupy malejaco po wyniku", () => {
    const trades = [
      trade({ id: 1, instrumentSymbol: "NQ", pnl: -5_000 }),
      trade({ id: 2, instrumentSymbol: "ES", pnl: 20_000 }),
    ];
    expect(groupBy(trades, dimension("instrument"), { progi })[0].label).toBe("ES");
  });

  it("trade z dwoma tagami trafia do obu grup", () => {
    const trades = [trade({ id: 1, tags: [tag(1, "wybicie"), tag(2, "trend")] })];
    const groups = groupBy(trades, dimension("tag:setup"), { progi });
    expect(groups.map((g) => g.label).sort()).toEqual(["trend", "wybicie"]);
  });

  it("trade bez wartosci trafia do grupy nieprzypisanych", () => {
    const groups = groupBy([trade({ strategyName: null })], dimension("strategy"), { progi });
    expect(groups[0].label).toBe("bez strategii");
    expect(groups[0].key).toBe("");
  });

  it("grupuje po polu wlasnym typu select", () => {
    const trades = [
      trade({ id: 1, custom: { nastroj: "spokoj" }, pnl: 10_000 }),
      trade({ id: 2, custom: { nastroj: "presja" }, pnl: -20_000 }),
    ];
    const groups = groupBy(trades, dimension("field:nastroj"), { progi });
    expect(groups[0].label).toBe("spokoj");
    expect(groups[1].stats.pnl).toBe(-20_000);
  });

  it("pole wielokrotnego wyboru rozklada sie na kilka grup", () => {
    const trades = [trade({ custom: { bledy: ["za wczesnie", "za duzo"] } })];
    expect(groupBy(trades, dimension("field:bledy"), { progi })).toHaveLength(2);
  });

  it("trade z tagami na dwoch interwalach trafia do obu grup interwalu", () => {
    const trades = [trade({ id: 1, tags: [tag(1, "wybicie", "5m"), tag(2, "trend", "1h")] })];
    const groups = groupBy(trades, dimension("interval"), { progi });
    expect(groups.map((g) => g.label).sort()).toEqual(["1h", "5m"]);
  });

  it("trade bez interwalu na zadnym tagu trafia do grupy brak danych", () => {
    const trades = [trade({ tags: [tag(1, "wybicie", null)] })];
    const groups = groupBy(trades, dimension("interval"), { progi });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("brak danych");
  });

  it("wymiar interwalu sortuje wg listy z lib/domain/interwaly, nie alfabetycznie", () => {
    const trades = [
      trade({ id: 1, tags: [tag(1, "a", "1h")] }),
      trade({ id: 2, tags: [tag(2, "b", "1m")] }),
    ];
    const groups = groupBy(trades, dimension("interval"), { progi });
    // Alfabetycznie "1h" < "1m", ale czasowo 1m jest drobniejsze i musi
    // wypasc jako pierwsze - patrz interwaly.ts.
    expect(groups.map((g) => g.label)).toEqual(["1m", "1h"]);
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
