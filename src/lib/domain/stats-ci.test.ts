import { describe, expect, it } from "vitest";

import {
  bootstrapExpectancy,
  breakEvenWinRate,
  DOMYSLNE_PROGI_STATUSU,
  fazaHipotezy,
  generatorZZiarnem,
  odwrotnaNormalna,
  ostrzezenieWariantow,
  progiStatusuZJson,
  statusZWynikow,
  wilson,
  zawyzenieNajlepszego,
} from "./stats-ci";

/** Procenty z jednym miejscem po przecinku, tak jak w raporcie metodyki. */
const pp = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);

/** n trade'ow: `w` wygranych po +2R i `l` strat po -1R, reszta (BE) po 0R. */
const seria = (w: number, l: number, be = 0, wygranaR = 2): number[] => [
  ...Array<number>(w).fill(wygranaR),
  ...Array<number>(l).fill(-1),
  ...Array<number>(be).fill(0),
];

describe("wilson: przypadki z raportu metodyki (docs/research/metodyka.md 1.2)", () => {
  it.each([
    [15, 30, 33.2, 66.8],
    [8, 10, 49.0, 94.3],
    [50, 100, 40.4, 59.6],
    [100, 200, 43.1, 56.9],
  ])("%i z %i daje %f-%f%%", (wygrane, n, low, high) => {
    const w = wilson(wygrane, n);
    expect(pp(w.low)).toBe(low);
    expect(pp(w.high)).toBe(high);
    expect(w.p).toBeCloseTo(wygrane / n, 12);
  });

  it("przedzial zawsze mieści się w 0-1, takze na krancach (0/10 i 10/10)", () => {
    const zero = wilson(0, 10);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeGreaterThan(0);
    const komplet = wilson(10, 10);
    expect(komplet.high).toBeCloseTo(1, 12);
    expect(komplet.high).toBeLessThanOrEqual(1);
    expect(komplet.low).toBeLessThan(1);
  });

  it("n = 0 to brak odpowiedzi (null), a nie przedzial 0-100%", () => {
    expect(wilson(0, 0)).toEqual({ n: 0, wins: 0, p: null, low: null, high: null });
  });

  it("odrzuca niemozliwe wejscie z komunikatem zawierajacym wartosci", () => {
    expect(() => wilson(11, 10)).toThrow(/od 0 do n \(10\), jest 11/);
    expect(() => wilson(-1, 10)).toThrow(RangeError);
    expect(() => wilson(1, 2.5)).toThrow(/n musi być liczbą całkowitą/);
  });
});

describe("bootstrapExpectancy", () => {
  const r = [-1, -0.5, 0.3, 2.7, 1.1, -1, 0.6, -0.2, 1.9, -1, 0.4, 2.2, -0.8, -1, 0.9, 1.4, -0.3, -1, 0.7, 3.1];

  it("to samo ziarno daje ten sam przedzial, inne ziarno inny", () => {
    const a = bootstrapExpectancy(r, { ziarno: 7 });
    const b = bootstrapExpectancy(r, { ziarno: 7 });
    const c = bootstrapExpectancy(r, { ziarno: 8 });
    expect(a).toEqual(b);
    expect([c.low, c.high]).not.toEqual([a.low, a.high]);
  });

  it("przedzial otacza srednia i srednia to srednia arytmetyczna", () => {
    const w = bootstrapExpectancy(r, { ziarno: 1 });
    expect(w.mean).toBeCloseTo(r.reduce((x, y) => x + y, 0) / r.length, 12);
    expect(w.low!).toBeLessThan(w.mean!);
    expect(w.high!).toBeGreaterThan(w.mean!);
  });

  it("flaga orientacyjnie: n = 29 tak, n = 30 nie", () => {
    expect(bootstrapExpectancy(seria(10, 19), { ziarno: 1 }).orientacyjnie).toBe(true);
    expect(bootstrapExpectancy(seria(10, 20), { ziarno: 1 }).orientacyjnie).toBe(false);
  });

  it("przedzial ma sensowna szerokosc (zgrubnie 1,96 * sd / sqrt(n))", () => {
    const w = bootstrapExpectancy(r, { ziarno: 3, iteracje: 20_000 });
    const sr = r.reduce((x, y) => x + y, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, x) => s + (x - sr) ** 2, 0) / (r.length - 1));
    const teoria = 1.96 * (sd / Math.sqrt(r.length));
    expect((w.high! - w.low!) / 2).toBeGreaterThan(teoria * 0.9);
    expect((w.high! - w.low!) / 2).toBeLessThan(teoria * 1.1);
  });

  it("n = 0 i n = 1: brak przedzialu, zaznaczone jako zdegenerowany", () => {
    expect(bootstrapExpectancy([])).toMatchObject({ n: 0, mean: null, low: null, high: null, zdegenerowany: true, orientacyjnie: true });
    expect(bootstrapExpectancy([1.5])).toMatchObject({ n: 1, mean: 1.5, low: 1.5, high: 1.5, zdegenerowany: true });
  });

  it("pomija wartosci nieskonczone zamiast zatruc nimi srednia", () => {
    const w = bootstrapExpectancy([1, Number.NaN, 2, Number.POSITIVE_INFINITY], { ziarno: 1 });
    expect(w.n).toBe(2);
    expect(w.mean).toBe(1.5);
  });

  it("generator z ziarnem jest deterministyczny i rownomierny", () => {
    const g1 = generatorZZiarnem(42);
    const g2 = generatorZZiarnem(42);
    const x = Array.from({ length: 1000 }, g1);
    expect(x).toEqual(Array.from({ length: 1000 }, g2));
    expect(Math.min(...x)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...x)).toBeLessThan(1);
    expect(x.reduce((s, v) => s + v, 0) / 1000).toBeGreaterThan(0.45);
    expect(x.reduce((s, v) => s + v, 0) / 1000).toBeLessThan(0.55);
  });

  it("odrzuca zle parametry", () => {
    expect(() => bootstrapExpectancy([1, 2], { iteracje: 10 })).toThrow(/co najmniej 100, jest 10/);
    expect(() => bootstrapExpectancy([1, 2], { poziom: 1 })).toThrow(RangeError);
  });
});

describe("breakEvenWinRate z wlasnych W i L", () => {
  it("W = 2R, L = 1R -> 1/3", () => {
    const be = breakEvenWinRate(seria(10, 10));
    expect(be.avgWinR).toBe(2);
    expect(be.avgLossR).toBe(1);
    expect(be.winRate).toBeCloseTo(1 / 3, 12);
  });

  it("W = 1R, L = 1R -> 50%; W = 0,5R, L = 1R -> 2/3", () => {
    expect(breakEvenWinRate([1, -1]).winRate).toBeCloseTo(0.5, 12);
    expect(breakEvenWinRate([0.5, -1]).winRate).toBeCloseTo(2 / 3, 12);
  });

  it("uzywa srednich, nie pojedynczych trade'ow", () => {
    const be = breakEvenWinRate([3, 1, -2, -1]);
    expect(be.avgWinR).toBe(2);
    expect(be.avgLossR).toBe(1.5);
    expect(be.winRate).toBeCloseTo(1.5 / 3.5, 12);
  });

  it("trade'y z R = 0 nie wchodza ani do W, ani do L", () => {
    expect(breakEvenWinRate([2, -1, 0, 0])).toMatchObject({ wins: 1, losses: 1, winRate: 1 / 3 });
  });

  it("bez wygranych albo bez strat nie ma progu (null), a nie 0 ani 100%", () => {
    expect(breakEvenWinRate([1, 2]).winRate).toBeNull();
    expect(breakEvenWinRate([-1, -2]).winRate).toBeNull();
    expect(breakEvenWinRate([]).winRate).toBeNull();
  });
});

describe("statusZWynikow: progi zadeklarowane z gory", () => {
  it("n < minN: nieważny z powodem za_malo_danych, nawet gdy wszystko wygrywa", () => {
    const s = statusZWynikow(seria(19, 0));
    expect(s.status).toBe("niewazny");
    expect(s.powod).toBe("za_malo_danych");
    expect(s.opis).toContain("19 z wymaganych 20");
  });

  it("n = minN to juz ocena (granica domknieta od dolu)", () => {
    expect(statusZWynikow(seria(7, 13)).powod).not.toBe("za_malo_danych");
  });

  it("obiecujacy: 12/20 przy W=2R, L=1R ma win rate nad BE (33,3%), ale przedzial go obejmuje? (dolna granica 38,7% > BE, wiec obiecujacy w probie z n < 100)", () => {
    const s = statusZWynikow(seria(12, 8));
    expect(s.breakEven.winRate).toBeCloseTo(1 / 3, 12);
    expect(pp(s.wilson.low)).toBe(38.7);
    expect(s.status).toBe("obiecujacy");
    expect(s.powod).toBe("nad_break_even_w_probie");
    expect(s.opis).toContain("n = 20 < 100");
  });

  it("obiecujacy z przedzialem obejmujacym break-even: 9/20", () => {
    const s = statusZWynikow(seria(9, 11));
    expect(s.wilson.low!).toBeLessThan(s.breakEven.winRate!);
    expect(s.wilson.p!).toBeGreaterThan(s.breakEven.winRate!);
    expect(s.status).toBe("obiecujacy");
    expect(s.opis).toContain("jeszcze go obejmuje");
  });

  it("niejednoznaczny: win rate nie przekracza break-even, przedzial go obejmuje (6/20 przy BE 33,3%)", () => {
    const s = statusZWynikow(seria(6, 14));
    expect(s.status).toBe("niejednoznaczny");
    expect(s.powod).toBe("przedzial_obejmuje_break_even");
  });

  it("nieważny z danych: caly przedzial Wilsona nizej niz break-even (2/60 przy BE 33%)", () => {
    const s = statusZWynikow(seria(2, 58));
    expect(s.wilson.high!).toBeLessThan(s.breakEven.winRate!);
    expect(s.status).toBe("niewazny");
    expect(s.powod).toBe("dane_przeciw");
  });

  it("potwierdzony wymaga i n >= potwierdzenieN, i dolnej granicy nad break-even", () => {
    const duze = statusZWynikow(seria(60, 40));
    expect(duze.n).toBe(100);
    expect(duze.wilson.low!).toBeGreaterThan(duze.breakEven.winRate!);
    expect(duze.status).toBe("potwierdzony");
    // ten sam odsetek, ale n = 99: tylko obiecujacy
    const mniejsze = statusZWynikow(seria(60, 39));
    expect(mniejsze.n).toBe(99);
    expect(mniejsze.status).toBe("obiecujacy");
    // n = 100, ale dolna granica pod break-even: nie potwierdzony
    const slabe = statusZWynikow(seria(36, 64));
    expect(slabe.wilson.low!).toBeLessThan(slabe.breakEven.winRate!);
    expect(slabe.status).not.toBe("potwierdzony");
  });

  it("wlasne progi zmieniaja ocene: minN = 10 odblokowuje ocene 12 trade'ow", () => {
    const r = seria(8, 4);
    expect(statusZWynikow(r).powod).toBe("za_malo_danych");
    expect(statusZWynikow(r, { minN: 10, potwierdzenieN: 50 }).powod).not.toBe("za_malo_danych");
  });

  it("brak wygranych albo strat przy n >= minN: niejednoznaczny z wyjasnieniem, bez wyjatku", () => {
    const s = statusZWynikow(seria(25, 0));
    expect(s.status).toBe("niejednoznaczny");
    expect(s.opis).toContain("brakuje wygranych albo strat");
  });

  it("trade'y z R = 0 licza sie do n, ale nie do win rate", () => {
    const s = statusZWynikow(seria(7, 13, 5));
    expect(s.n).toBe(25);
    expect(s.wilson.n).toBe(20);
  });

  it("wynik jest deterministyczny (to samo ziarno)", () => {
    expect(statusZWynikow(seria(12, 8))).toEqual(statusZWynikow(seria(12, 8)));
  });
});

describe("progiStatusuZJson", () => {
  it("brak = domyslne; czesciowe = uzupelnione domyslnymi", () => {
    expect(progiStatusuZJson(null)).toEqual({ ok: true, progi: DOMYSLNE_PROGI_STATUSU });
    expect(progiStatusuZJson({})).toEqual({ ok: true, progi: DOMYSLNE_PROGI_STATUSU });
    expect(progiStatusuZJson({ minN: 30 })).toEqual({ ok: true, progi: { minN: 30, potwierdzenieN: 100 } });
  });

  it.each([
    [{ minN: 0 }, /minN/],
    [{ minN: 2.5 }, /minN/],
    [{ minN: "20" }, /minN/],
    [{ minN: 50, potwierdzenieN: 40 }, /potwierdzenieN: oczekiwano liczby całkowitej >= minN \(50\), jest 40/],
    [[], /obiektem/],
  ])("odrzuca %j", (wejscie, wzor) => {
    const w = progiStatusuZJson(wejscie);
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.error).toMatch(wzor);
  });
});

describe("fazaHipotezy", () => {
  it("n < prog_n zbieranie, n >= prog_n do oceny", () => {
    expect(fazaHipotezy(19, 20)).toBe("zbieranie");
    expect(fazaHipotezy(20, 20)).toBe("do_oceny");
    expect(fazaHipotezy(0, 1)).toBe("zbieranie");
  });
});

describe("licznik wariantow (zawyzenie najlepszego)", () => {
  it("odwrotna normalna: znane wartosci", () => {
    expect(odwrotnaNormalna(0.5)).toBeCloseTo(0, 9);
    expect(odwrotnaNormalna(0.975)).toBeCloseTo(1.959964, 5);
    expect(odwrotnaNormalna(0.025)).toBeCloseTo(-1.959964, 5);
    expect(odwrotnaNormalna(0.999)).toBeCloseTo(3.090232, 5);
  });

  it("k = 1 nie zawyza; k = 2 ok. 0,56; rosnie z k", () => {
    expect(zawyzenieNajlepszego(1)).toBe(0);
    expect(zawyzenieNajlepszego(2)).toBeCloseTo(0.5642, 1);
    expect(zawyzenieNajlepszego(10)).toBeCloseTo(1.5388, 1);
    expect(zawyzenieNajlepszego(100)).toBeGreaterThan(zawyzenieNajlepszego(10));
  });

  it("ostrzezenie: od dwoch wariantow zawyzony, z liczbami w tekscie", () => {
    const o = ostrzezenieWariantow(5, 40);
    expect(o.zawyzony).toBe(true);
    expect(o.tekst).toContain("5 wariantów na 40 trade'ach");
    expect(o.tekst).toContain("zawyżony");
    const jeden = ostrzezenieWariantow(1, null);
    expect(jeden.zawyzony).toBe(false);
    expect(jeden.tekst).not.toContain("zawyżony");
  });

  it("odrzuca k < 1 i k niecalkowite", () => {
    expect(() => zawyzenieNajlepszego(0)).toThrow(/k musi być liczbą całkowitą >= 1, jest 0/);
    expect(() => zawyzenieNajlepszego(1.5)).toThrow(RangeError);
  });
});

describe("pomiary z klasyfikacja wyniku (BE wg progu, nie wg znaku R)", () => {
  it("+0,05R oznaczone jako BE nie wchodzi do wygranych, ale liczy sie do n i expectancy", () => {
    const pomiary = [
      ...seria(8, 8).map((r) => ({ r, wynik: r > 0 ? ("zysk" as const) : ("strata" as const) })),
      { r: 0.05, wynik: "be" as const },
      { r: -0.04, wynik: "be" as const },
    ];
    const s = statusZWynikow(pomiary, { minN: 10, potwierdzenieN: 100 });
    expect(s.n).toBe(18);
    expect(s.wins).toBe(8);
    expect(s.losses).toBe(8);
    expect(s.wilson.n).toBe(16);
    expect(s.expectancy.mean).toBeCloseTo((8 * 2 - 8 + 0.05 - 0.04) / 18, 12);
    // gdyby klasyfikowac po znaku, wygranych byloby 9
    expect(statusZWynikow(pomiary.map((p) => p.r), { minN: 10, potwierdzenieN: 100 }).wins).toBe(9);
  });

  it("break-even liczy srednie tylko z trade'ow sklasyfikowanych jako zysk i strata", () => {
    const be = breakEvenWinRate([{ r: 2, wynik: "zysk" }, { r: -1, wynik: "strata" }, { r: 0.08, wynik: "be" }]);
    expect(be.avgWinR).toBe(2);
    expect(be.winRate).toBeCloseTo(1 / 3, 12);
  });
});
