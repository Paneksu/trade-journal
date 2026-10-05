import { describe, expect, it } from "vitest";

import { mapujSymbol } from "./tradingview";

const KATALOG = ["ES", "MES", "NQ", "MNQ", "YM", "MYM", "6E", "M2K", "ZN", "GC"];

function symbol(s: string, znane: readonly string[] = KATALOG): string {
  const w = mapujSymbol(s, znane);
  if (!w.ok) throw new Error(w.error);
  return w.symbol;
}

describe("mapujSymbol", () => {
  it.each([
    ["NQ", "NQ"],
    ["nq", "NQ"],
    ["NQ1!", "NQ"],
    ["NQ2!", "NQ"],
    ["MNQ1!", "MNQ"],
    // FX Replay: kontrakt ciagly bez "!" (N+Q+1 nie moze byc czytane jako miesiac Q)
    ["CME_MINI:NQ1", "NQ"],
    ["CME_MINI:MNQ1", "MNQ"],
    ["CBOT_MINI:YM1", "YM"],
    ["CBOT:ZN1", "ZN"],
    ["CME:6E1", "6E"],
    ["COMEX:GC1", "GC"],
    ["CME_MINI:ES1", "ES"],
    ["CME_MINI:NQZ2026", "NQ"],
    ["CME_MINI:MNQZ2026", "MNQ"],
    ["NQU2026", "NQ"],
    ["NQZ26", "NQ"],
    ["ESH6", "ES"],
    ["6E1!", "6E"],
    ["CME:6EZ2026", "6E"],
    ["M2K", "M2K"],
    ["M2KZ2026", "M2K"],
    ["  NQ  ", "NQ"],
  ])("%s -> %s", (wejscie, oczekiwany) => {
    expect(symbol(wejscie)).toBe(oczekiwany);
  });

  it("katalog jest wymagany: bez niego nie ma zgadywania", () => {
    // @ts-expect-error znane jest argumentem wymaganym
    expect(() => mapujSymbol("NQ1")).toThrow();
  });

  it("niejednoznaczne czytanie to blad, a nie wybor pierwszego", () => {
    const w = mapujSymbol("NQ1", ["N", "NQ"]); // N+Q(miesiac)+1 oraz NQ+1
    expect(w.ok).toBe(false);
    if (!w.ok) {
      expect(w.error).toContain("niejednoznaczny");
      expect(w.error).toContain("N");
      expect(w.error).toContain("NQ");
    }
  });

  it("nieznany symbol to czytelny blad z lista znanych instrumentow", () => {
    const w = mapujSymbol("XYZ1!", KATALOG);
    expect(w.ok).toBe(false);
    if (w.ok) return;
    expect(w.error).toContain("»XYZ1!«");
    expect(w.error).toContain("Znane instrumenty: ES, MES, NQ");
  });

  it("CFD i indeksy nie sa mapowane po cichu", () => {
    for (const s of ["US100", "NAS100", "USTEC", "NDX"]) {
      const w = mapujSymbol(s, KATALOG);
      expect(w.ok, s).toBe(false);
      if (!w.ok) expect(w.error).toContain("nie kontrakt futures");
    }
  });

  it("pusty i smieciowy symbol", () => {
    expect(mapujSymbol("", KATALOG).ok).toBe(false);
    expect(mapujSymbol("   ", KATALOG).ok).toBe(false);
    expect(mapujSymbol("NQ; DROP TABLE", KATALOG).ok).toBe(false);
    expect(mapujSymbol("NQ!!", KATALOG).ok).toBe(false);
  });

  it("korzen nieznany w katalogu nie przechodzi nawet z poprawnym miesiacem", () => {
    expect(mapujSymbol("CLZ2026", KATALOG).ok).toBe(false);
    expect(mapujSymbol("CLZ2026", [...KATALOG, "CL"]).ok).toBe(true);
  });
});
