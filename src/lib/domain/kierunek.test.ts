import { describe, expect, it } from "vitest";

import {
  czyPowod,
  kierunekTrafiony,
  normalizujKierunek,
  strataTechniczna,
  utraconeR,
  type TradeKierunek,
} from "./kierunek";
import { DOMYSLNE_PROGI } from "./outcome";

const PROGI = DOMYSLNE_PROGI;

/** Ryzyko 10 000 centow => prog BE to 1000 centow (100 tysiecznych R). */
function trade(over: Partial<TradeKierunek> = {}): TradeKierunek {
  return {
    pnl: -10_000,
    riskAmount: 10_000,
    contracts: 1,
    rMultiple: -1,
    directionCorrect: null,
    badExecutionReason: null,
    potentialR: null,
    ...over,
  };
}

describe("czyPowod", () => {
  it("przyjmuje wartosci z listy i odrzuca reszte", () => {
    expect(czyPowod("early_exit")).toBe(true);
    expect(czyPowod("za wczesne wyjscie")).toBe(false);
    expect(czyPowod("")).toBe(false);
    expect(czyPowod(null)).toBe(false);
    expect(czyPowod(undefined)).toBe(false);
  });
});

describe("kierunekTrafiony", () => {
  it("wygrana jest trafiona z definicji, nawet bez zaznaczenia w bazie", () => {
    const t = trade({ pnl: 20_000, rMultiple: 2, directionCorrect: null });
    expect(kierunekTrafiony(t, PROGI)).toBe(true);
  });

  it("strata z zaznaczonym kierunkiem to trafienie", () => {
    expect(kierunekTrafiony(trade({ directionCorrect: true }), PROGI)).toBe(true);
  });

  it("strata bez oceny zostaje nieoceniona, a nie chybiona", () => {
    // To nie jest szczegol: gdyby null zliczal sie jako chybienie, trafnosc
    // spadalaby za kazdy trade, ktorego uzytkownik po prostu nie przejrzal.
    expect(kierunekTrafiony(trade(), PROGI)).toBeNull();
  });

  it("BE liczy sie jak strata - kierunek trzeba ocenic recznie", () => {
    // pnl ponizej progu BE (1000 centow), wiec to nie jest "zysk".
    const t = trade({ pnl: 500, rMultiple: 0.05, directionCorrect: true });
    expect(kierunekTrafiony(t, PROGI)).toBe(true);
    expect(kierunekTrafiony(trade({ pnl: 500, rMultiple: 0.05 }), PROGI)).toBeNull();
  });
});

describe("strataTechniczna", () => {
  it("kierunek dobry, wynik zly", () => {
    expect(strataTechniczna(trade({ directionCorrect: true }), PROGI)).toBe(true);
  });

  it("wygrana nigdy nie jest strata techniczna", () => {
    const t = trade({ pnl: 20_000, rMultiple: 2 });
    expect(strataTechniczna(t, PROGI)).toBe(false);
  });

  it("strata z chybionym kierunkiem to zwykla strata", () => {
    expect(strataTechniczna(trade({ directionCorrect: false }), PROGI)).toBe(false);
  });
});

describe("utraconeR", () => {
  it("liczy roznice miedzy potencjalem a faktycznym wynikiem", () => {
    const t = trade({ directionCorrect: true, rMultiple: -1, potentialR: 3 });
    expect(utraconeR(t, PROGI)).toBe(4);
  });

  it("clamp na zero - trade lepszy od potencjalu nie tworzy ujemnej straty", () => {
    // Bez clampu taki trade kompensowalby w sumie zbiorczej cudze bledy
    // i "utracone R" zanizaloby sie samo.
    const t = trade({ pnl: 30_000, rMultiple: 3, potentialR: 2 });
    expect(utraconeR(t, PROGI)).toBe(0);
  });

  it("brak wpisanego potencjalu daje null, nie zero", () => {
    const t = trade({ directionCorrect: true, potentialR: null });
    expect(utraconeR(t, PROGI)).toBeNull();
  });

  it("chybiony kierunek nie ma czego tracic", () => {
    const t = trade({ directionCorrect: false, potentialR: 3 });
    expect(utraconeR(t, PROGI)).toBeNull();
  });

  it("brak R traktuje faktyczny wynik jako zero", () => {
    const t = trade({ directionCorrect: true, rMultiple: null, potentialR: 2.5 });
    expect(utraconeR(t, PROGI)).toBe(2.5);
  });
});

describe("normalizujKierunek", () => {
  const PUSTO = { directionCorrect: null, badExecutionReason: null, potentialR: null };

  it("wygrana czysci cala trojke - trafnosc wyprowadzamy, nie zapisujemy", () => {
    const wynik = normalizujKierunek(
      { directionCorrect: true, badExecutionReason: "early_exit", potentialR: 3 },
      { wygrana: true, oceniane: true },
    );
    expect(wynik).toEqual(PUSTO);
  });

  it("odznaczony checkbox na widocznym bloku to jawne chybienie, nie brak danych", () => {
    // Sedno metryki: gdyby to zostawalo `null`, mianownik trafnosci rownalby
    // sie licznikowi i wynik zawsze wynosilby sto procent.
    const wynik = normalizujKierunek(
      { directionCorrect: null, badExecutionReason: null, potentialR: null },
      { wygrana: false, oceniane: true },
    );
    expect(wynik.directionCorrect).toBe(false);
  });

  it("nieprzeslany blok zostawia nieocenione", () => {
    const wynik = normalizujKierunek(
      { directionCorrect: null, badExecutionReason: null, potentialR: null },
      { wygrana: false, oceniane: false },
    );
    expect(wynik).toEqual(PUSTO);
  });

  it("powod bez zaznaczonego kierunku jest kasowany, nie przepuszczany do CHECK-a", () => {
    const wynik = normalizujKierunek(
      { directionCorrect: null, badExecutionReason: "unnecessary_be", potentialR: 2 },
      { wygrana: false, oceniane: true },
    );
    expect(wynik.badExecutionReason).toBeNull();
    expect(wynik.potentialR).toBeNull();
  });

  it("poprawny komplet przechodzi bez zmian", () => {
    const wejscie = {
      directionCorrect: true,
      badExecutionReason: "unnecessary_sl" as const,
      potentialR: 2.5,
    };
    expect(normalizujKierunek(wejscie, { wygrana: false, oceniane: true })).toEqual(wejscie);
  });
});
