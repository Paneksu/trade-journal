import { describe, expect, it } from "vitest";

import {
  KopertaTradowSchema,
  OcenaSchema,
  opiszBledyZod,
  SesjaSchema,
  TradeSchema,
  zrodloZRef,
} from "./schema";

function poprawny(nadpisz: Record<string, unknown> = {}) {
  return {
    externalRef: "fxr:sesja1-t7",
    accountId: 1,
    symbol: "NQ1!",
    direction: "long",
    entryTime: "2026-03-10T09:35:00-04:00",
    entryPrice: 20000.25,
    contracts: 2,
    stopLoss: 19990,
    takeProfit: 20020,
    exits: [{ time: "2026-03-10T09:50:00-04:00", price: 20010 }],
    ...nadpisz,
  };
}

function blad(wejscie: unknown): string[] {
  const w = TradeSchema.safeParse(wejscie);
  if (w.success) throw new Error("oczekiwano bledu");
  return opiszBledyZod(w.error, wejscie);
}

describe("TradeSchema", () => {
  it("poprawny trade przechodzi, domyslnie closed i bez wyjsc to []", () => {
    const w = TradeSchema.parse(poprawny());
    expect(w.status).toBe("closed");
    expect(w.entryTime.toISOString()).toBe("2026-03-10T13:35:00.000Z");
    expect(w.exits[0].time?.toISOString()).toBe("2026-03-10T13:50:00.000Z");
    expect(TradeSchema.parse(poprawny({ exits: undefined })).exits).toEqual([]);
  });

  it("czas bez offsetu jest odrzucony z komunikatem o strefie i faktyczna wartoscia", () => {
    const e = blad(poprawny({ entryTime: "2026-03-10T09:35" }));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("pole entryTime");
    expect(e[0]).toContain("2026-03-10T09:35");
    expect(e[0]).toContain("offsetem");
  });

  it("czas z samym Z, z ulamkiem sekund i z +01:00 przechodzi, bez dwukropka w offsecie nie", () => {
    expect(TradeSchema.safeParse(poprawny({ entryTime: "2026-03-10T13:35:00Z" })).success).toBe(true);
    expect(TradeSchema.safeParse(poprawny({ entryTime: "2026-03-10T13:35:00.123Z" })).success).toBe(true);
    expect(TradeSchema.safeParse(poprawny({ entryTime: "2026-03-10T14:35:00+01:00" })).success).toBe(true);
    expect(TradeSchema.safeParse(poprawny({ entryTime: "2026-03-10T09:35:00-0400" })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ entryTime: "2026-13-10T09:35:00Z" })).success).toBe(false);
  });

  it("literowka w nazwie pola to blad, nie cicho zgubiona wartosc", () => {
    const e = blad(poprawny({ stoploss: 19990 }));
    expect(e.join(" ")).toContain("stoploss");
    expect(e.join(" ")).toContain("nieznane pola");
  });

  it("externalRef musi miec prefiks tv: albo fxr:", () => {
    expect(TradeSchema.safeParse(poprawny({ externalRef: "abc" })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ externalRef: "tv:123" })).success).toBe(true);
    expect(TradeSchema.safeParse(poprawny({ externalRef: "tv:" + "x".repeat(121) })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ externalRef: "tv:a b" })).success).toBe(false);
  });

  it("zrodlo musi zgadzac sie z prefiksem", () => {
    expect(zrodloZRef("tv:1")).toBe("tradingview");
    expect(zrodloZRef("fxr:1")).toBe("fxreplay");
    const e = blad(poprawny({ source: "tradingview" }));
    expect(e[0]).toContain("nie zgadza się z prefiksem");
  });

  it("sessionId i sessionRef razem to blad", () => {
    const e = blad(poprawny({ sessionId: 1, sessionRef: "fxr:s1" }));
    expect(e[0]).toContain("nie oba naraz");
  });

  it("liczby: NaN, Infinity, tekst, zero kontraktow", () => {
    expect(TradeSchema.safeParse(poprawny({ entryPrice: "20000" })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ entryPrice: null })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ contracts: 0 })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ contracts: -1 })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ stopLoss: null })).success).toBe(true);
    expect(TradeSchema.safeParse(poprawny({ readiness: 11 })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ readiness: 5 })).success).toBe(true);
  });

  it("status spoza listy i kierunek spoza long/short", () => {
    expect(TradeSchema.safeParse(poprawny({ status: "zamkniety" })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ direction: "buy" })).success).toBe(false);
  });

  it("tag: tagId albo para category+name, interwal z listy", () => {
    expect(TradeSchema.safeParse(poprawny({ tags: [{ tagId: 3, interval: "5m" }] })).success).toBe(true);
    expect(TradeSchema.safeParse(poprawny({ tags: [{ category: "confluence", name: "FVG", interval: "1h" }] })).success).toBe(true);
    expect(TradeSchema.safeParse(poprawny({ tags: [{ category: "confluence" }] })).success).toBe(false);
    expect(TradeSchema.safeParse(poprawny({ tags: [{ tagId: 3, interval: "7m" }] })).success).toBe(false);
  });

  it("limity: ponad 20 wyjsc i ponad 40 tagow", () => {
    const wyjscia = Array.from({ length: 21 }, () => ({ price: 1 }));
    expect(TradeSchema.safeParse(poprawny({ exits: wyjscia })).success).toBe(false);
    const tagi = Array.from({ length: 41 }, () => ({ tagId: 1 }));
    expect(TradeSchema.safeParse(poprawny({ tags: tagi })).success).toBe(false);
  });
});

describe("KopertaTradowSchema", () => {
  it("domyslnie create i bez suchego biegu; pusta paczka i ponad 50 odrzucone", () => {
    const k = KopertaTradowSchema.parse({ trades: [{}] });
    expect(k.mode).toBe("create");
    expect(k.dryRun).toBe(false);
    expect(KopertaTradowSchema.safeParse({ trades: [] }).success).toBe(false);
    expect(KopertaTradowSchema.safeParse({ trades: Array.from({ length: 51 }, () => ({})) }).success).toBe(false);
    expect(KopertaTradowSchema.safeParse({ trades: Array.from({ length: 50 }, () => ({})) }).success).toBe(true);
    expect(KopertaTradowSchema.safeParse({ trades: [{}], mode: "upsert" }).success).toBe(false);
  });
});

describe("OcenaSchema", () => {
  const regula = { ruleId: "R-007", ruleText: "Wchodzimy tylko w oknie 9:30-10:30", verdict: "pass" };

  it("poprawna ocena z regulami", () => {
    const o = OcenaSchema.parse({ basis: "chart", brainVerdict: "wejdz", ruleChecks: [regula] });
    expect(o.ruleChecks[0].ruleText).toContain("oknie");
  });

  it("regula bez tresci (rule_text) jest odrzucona - kopia tresci jest obowiazkowa", () => {
    expect(OcenaSchema.safeParse({ basis: "chart", ruleChecks: [{ ruleId: "R-1", verdict: "pass" }] }).success).toBe(false);
    expect(OcenaSchema.safeParse({ basis: "chart", ruleChecks: [{ ...regula, ruleText: "" }] }).success).toBe(false);
  });

  it("zduplikowane id reguly w jednej ocenie to blad z wskazaniem pola", () => {
    const w = OcenaSchema.safeParse({ basis: "history", ruleChecks: [regula, regula] });
    expect(w.success).toBe(false);
    if (!w.success) expect(opiszBledyZod(w.error, {}).join(" ")).toContain("drugi raz");
  });

  it("brainPlan: znane pola maja typy, nieznane przechodza", () => {
    const ok = OcenaSchema.safeParse({
      basis: "chart",
      brainPlan: { entry: 20000, stopLoss: 19990, interwalWejscia: "5m", interwalyKontekstu: ["1h", "4h"], notatka: "x" },
    });
    expect(ok.success).toBe(true);
    for (const plan of [
      { entry: "20000" },
      { stopLoss: Number.POSITIVE_INFINITY },
      { interwalWejscia: 5 },
      { interwalWejscia: "x".repeat(21) },
      { interwalyKontekstu: "1h" },
      { interwalyKontekstu: Array.from({ length: 11 }, () => "1h") },
    ]) {
      expect(OcenaSchema.safeParse({ basis: "chart", brainPlan: plan }).success, JSON.stringify(plan)).toBe(false);
    }
  });

  it("werdykty i podstawa tylko z list", () => {
    expect(OcenaSchema.safeParse({ basis: "dowolna" }).success).toBe(false);
    expect(OcenaSchema.safeParse({ basis: "chart", brainVerdict: "kup" }).success).toBe(false);
    expect(OcenaSchema.safeParse({ basis: "chart", ruleChecks: [{ ...regula, verdict: "maybe" }] }).success).toBe(false);
  });
});

describe("SesjaSchema", () => {
  it("domyslnie backtest, forward dozwolony, zly rodzaj nie", () => {
    expect(SesjaSchema.parse({ externalRef: "fxr:s1", name: "Sesja" }).kind).toBe("backtest");
    expect(SesjaSchema.parse({ externalRef: "fxr:s1", name: "Sesja", kind: "forward" }).kind).toBe("forward");
    expect(SesjaSchema.safeParse({ externalRef: "fxr:s1", name: "S", kind: "live" }).success).toBe(false);
    expect(SesjaSchema.safeParse({ externalRef: "fxr:s1", name: "" }).success).toBe(false);
    expect(SesjaSchema.safeParse({ externalRef: "fxr:s1", name: "S", dataFrom: "10.03.2026" }).success).toBe(false);
  });
});
