import { describe, expect, it } from "vitest";

import { czyKategoria, kategoriaKonta, walidujFazeProp } from "./kategorie";

describe("kategoriaKonta", () => {
  it("live to realne, demo i paper to demo", () => {
    expect(kategoriaKonta({ type: "live", propPhase: null })).toBe("realne");
    expect(kategoriaKonta({ type: "demo", propPhase: null })).toBe("demo");
    expect(kategoriaKonta({ type: "paper", propPhase: null })).toBe("demo");
  });

  it("prop zalezy od fazy, a bez fazy nie nalezy nigdzie", () => {
    expect(kategoriaKonta({ type: "prop", propPhase: "eval" })).toBe("prop_eval");
    expect(kategoriaKonta({ type: "prop", propPhase: "funded" })).toBe("prop_funded");
    expect(kategoriaKonta({ type: "prop", propPhase: null })).toBeNull();
  });

  it("czyKategoria zna cztery wartosci", () => {
    for (const k of ["realne", "prop_eval", "prop_funded", "demo"]) expect(czyKategoria(k)).toBe(true);
    expect(czyKategoria("backtest")).toBe(false);
    expect(czyKategoria(null)).toBe(false);
  });
});

describe("walidujFazeProp", () => {
  it("faza tylko przy koncie prop; dla innych typow zawsze null", () => {
    expect(walidujFazeProp("prop", "eval")).toEqual({ ok: true, faza: "eval" });
    expect(walidujFazeProp("prop", "funded")).toEqual({ ok: true, faza: "funded" });
    expect(walidujFazeProp("live", "eval")).toEqual({ ok: true, faza: null });
    expect(walidujFazeProp("demo", "funded")).toEqual({ ok: true, faza: null });
  });
  it("prop bez fazy jest dozwolony, nieznana faza nie", () => {
    expect(walidujFazeProp("prop", null)).toEqual({ ok: true, faza: null });
    expect(walidujFazeProp("prop", "")).toEqual({ ok: true, faza: null });
    expect(walidujFazeProp("prop", "live").ok).toBe(false);
  });
});
