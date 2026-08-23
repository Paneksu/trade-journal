import { describe, expect, it } from "vitest";

import { DOMYSLNE_PROGI, progBE, wynikTrade } from "./outcome";

/** Progi domyslne: 0,100R i 2,00 USD (200 centow) na kontrakt zapasowo. */
const p = DOMYSLNE_PROGI;

describe("progBE", () => {
  it("liczy prog jako ulamek ryzyka, gdy stop jest zdefiniowany", () => {
    // 100 (tysieczne R) * 10 000 (centy ryzyka) / 1000 = 1000 centow.
    expect(progBE(10_000, 1, p)).toBe(1_000);
  });

  it("bez ryzyka liczy prog zapasowy na kontrakt", () => {
    expect(progBE(null, 2, p)).toBe(400);
  });

  it("ryzyko zerowe traktuje jak brak ryzyka - liczy prog na kontrakt", () => {
    expect(progBE(0, 3, p)).toBe(600);
  });

  it("bierze wartosc bezwzgledna liczby kontraktow", () => {
    expect(progBE(null, -3, p)).toBe(600);
  });
});

describe("wynikTrade", () => {
  it("granica jest domknieta - pnl rowne progowi co do centa to be", () => {
    expect(wynikTrade({ pnl: 1_000, riskAmount: 10_000, contracts: 1 }, p)).toBe("be");
    expect(wynikTrade({ pnl: -1_000, riskAmount: 10_000, contracts: 1 }, p)).toBe("be");
  });

  it("cent nad progiem to juz zysk, cent pod - strata", () => {
    expect(wynikTrade({ pnl: 1_001, riskAmount: 10_000, contracts: 1 }, p)).toBe("zysk");
    expect(wynikTrade({ pnl: -1_001, riskAmount: 10_000, contracts: 1 }, p)).toBe("strata");
  });

  it("pnl w widelkach progu to be, nawet gdy niezerowy", () => {
    expect(wynikTrade({ pnl: 700, riskAmount: 10_000, contracts: 1 }, p)).toBe("be");
    expect(wynikTrade({ pnl: -700, riskAmount: 10_000, contracts: 1 }, p)).toBe("be");
  });

  it("bez stopa liczy prog per kontrakt", () => {
    expect(wynikTrade({ pnl: 400, riskAmount: null, contracts: 2 }, p)).toBe("be");
    expect(wynikTrade({ pnl: 401, riskAmount: null, contracts: 2 }, p)).toBe("zysk");
    expect(wynikTrade({ pnl: -401, riskAmount: null, contracts: 2 }, p)).toBe("strata");
  });

  it("ujemna liczba kontraktow nie odwraca progu", () => {
    expect(wynikTrade({ pnl: 600, riskAmount: null, contracts: -3 }, p)).toBe("be");
    expect(wynikTrade({ pnl: 601, riskAmount: null, contracts: -3 }, p)).toBe("zysk");
  });

  it("pnl null-a nie dostaje - wywolujacy podaje liczbe (0 dla brakow)", () => {
    expect(wynikTrade({ pnl: 0, riskAmount: null, contracts: 1 }, p)).toBe("be");
  });
});
