import { describe, expect, it } from "vitest";

import { DOMYSLNE_PROGI } from "./outcome";
import { statystykiPominietych, type PominietyWejscie } from "./pominiete";

const p = DOMYSLNE_PROGI;

function trade(w: Partial<PominietyWejscie>): PominietyWejscie {
  return { pnl: 0, riskAmount: 10_000, contracts: 1, rMultiple: 0, ...w };
}

describe("statystykiPominietych", () => {
  it("pusta lista daje same zera, nie null", () => {
    const wynik = statystykiPominietych([], p);
    expect(wynik).toEqual({
      count: 0,
      wygrane: 0,
      przegrane: 0,
      be: 0,
      zyskowneR: 0,
      sumaR: 0,
      sumaPnl: 0,
    });
  });

  it("trade dokladnie na progu BE wpada do be, nie do wygranych", () => {
    // prog = 100 (tysieczne R) * 10 000 centow / 1000 = 1000 centow (jak w outcome.test.ts).
    const wynik = statystykiPominietych([trade({ pnl: 1_000, rMultiple: 1 })], p);
    expect(wynik.be).toBe(1);
    expect(wynik.wygrane).toBe(0);
    expect(wynik.przegrane).toBe(0);
  });

  it("trade o wlosek nad progiem BE to wygrana", () => {
    const wynik = statystykiPominietych([trade({ pnl: 1_001, rMultiple: 1.5 })], p);
    expect(wynik.wygrane).toBe(1);
    expect(wynik.be).toBe(0);
  });

  it("zyskowneR sumuje tylko wygrane, sumaR liczy wszystko netto", () => {
    const wygrany = trade({ pnl: 5_000, rMultiple: 2 });
    const stratny = trade({ pnl: -3_000, rMultiple: -1 });
    const wynik = statystykiPominietych([wygrany, stratny], p);

    expect(wynik.count).toBe(2);
    expect(wynik.wygrane).toBe(1);
    expect(wynik.przegrane).toBe(1);
    // zyskowneR - suma R samych wygranych = R faktycznie stracone.
    expect(wynik.zyskowneR).toBe(2);
    // sumaR - netto calego zbioru: pominiety stratny to R oszczedzone.
    expect(wynik.sumaR).toBe(1);
    expect(wynik.sumaPnl).toBe(2_000);
  });

  it("brak rMultiple traktuje jak zero, nie wywala liczenia", () => {
    const wynik = statystykiPominietych([trade({ pnl: 1_500, rMultiple: null })], p);
    expect(wynik.wygrane).toBe(1);
    expect(wynik.zyskowneR).toBe(0);
    expect(wynik.sumaR).toBe(0);
  });
});
