import { describe, expect, it } from "vitest";

import { bladZegaraReplayu, czasZrzutuDlaOceny, zegarReplayu } from "./zegar-replayu";

describe("zegar replayu zrzutu (backtest, 20.10.2026)", () => {
  it("czyta replayTime ISO z offsetem", () => {
    expect(zegarReplayu({ replayTime: "2023-03-10T14:30:00Z" })?.toISOString()).toBe("2023-03-10T14:30:00.000Z");
    expect(zegarReplayu({ replayTime: "2023-03-10T09:30:00-05:00" })?.toISOString()).toBe("2023-03-10T14:30:00.000Z");
  });

  it("brak, zly typ albo czas bez offsetu = null (fail-closed)", () => {
    expect(zegarReplayu(null)).toBeNull();
    expect(zegarReplayu({})).toBeNull();
    expect(zegarReplayu([1])).toBeNull();
    expect(zegarReplayu({ replayTime: 1678458600000 })).toBeNull();
    expect(zegarReplayu({ replayTime: "2023-03-10T14:30:00" })).toBeNull();
    expect(zegarReplayu({ replayTime: "2023-13-40T99:30:00Z" })).toBeNull();
  });

  it("walidacja przy wgrywaniu: brak i null dozwolone, nieczytelna wartosc to blad", () => {
    expect(bladZegaraReplayu({ symbol: "NQ1!" })).toBeNull();
    expect(bladZegaraReplayu({ replayTime: null })).toBeNull();
    expect(bladZegaraReplayu({ replayTime: "2023-03-10T14:30:00Z" })).toBeNull();
    expect(bladZegaraReplayu({ replayTime: "wczoraj" })).toContain("replayTime");
    expect(bladZegaraReplayu({ replayTime: 5 })).toContain("ISO 8601");
  });

  it("backtest porownuje zegar replayu, trade realny captured_at", () => {
    const z = { capturedAt: new Date("2026-10-20T10:00:00Z"), chartState: { replayTime: "2023-03-10T14:30:00Z" } };
    expect(czasZrzutuDlaOceny(z, true)?.toISOString()).toBe("2023-03-10T14:30:00.000Z");
    expect(czasZrzutuDlaOceny(z, false)?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(czasZrzutuDlaOceny({ capturedAt: new Date(), chartState: null }, true)).toBeNull();
  });
});
