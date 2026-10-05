import { describe, expect, it } from "vitest";

import { mapujSymbol } from "./tradingview";

const KATALOG = ["ES", "MES", "NQ", "MNQ", "YM", "6E", "M2K", "ZN", "GC"];

function symbol(s: string, znane: readonly string[] | undefined = KATALOG): string {
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
    ["CME_MINI:NQZ2026", "NQ"],
    ["CME_MINI:MNQZ2026", "MNQ"],
    ["NQZ2026", "NQ"],
    ["NQZ26", "NQ"],
    ["ESH6", "ES"],
    ["CME_MINI:ES1!", "ES"],
    ["COMEX:GC1!", "GC"],
    ["6E", "6E"],
    ["6E1!", "6E"],
    ["CME:6EZ2026", "6E"],
    ["M2K", "M2K"],
    ["M2KZ2026", "M2K"],
    ["  NQ  ", "NQ"],
  ])("%s -> %s (z katalogiem)", (wejscie, oczekiwany) => {
    expect(symbol(wejscie)).toBe(oczekiwany);
  });

  it("dziala tez bez katalogu, dla tych samych form", () => {
    expect(symbol("CME_MINI:NQZ2026", undefined)).toBe("NQ");
    expect(symbol("NQ1!", undefined)).toBe("NQ");
    expect(symbol("MNQ1!", undefined)).toBe("MNQ");
    expect(symbol("NQ", undefined)).toBe("NQ");
    expect(symbol("6E", undefined)).toBe("6E");
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
    const smiec = mapujSymbol("NQ; DROP TABLE", KATALOG);
    expect(smiec.ok).toBe(false);
    expect(mapujSymbol("NQ!!", KATALOG).ok).toBe(false);
  });

  it("korzen nieznany w katalogu nie przechodzi nawet z poprawnym miesiacem", () => {
    expect(mapujSymbol("CLZ2026", KATALOG).ok).toBe(false);
    expect(mapujSymbol("CLZ2026", [...KATALOG, "CL"]).ok).toBe(true);
  });
});
