import { describe, expect, it } from "vitest";

import { czyPion, klasaKafla, ukladSiatki } from "./galeria";

/*
 * Siatka zrzutow ma jeden cel: przy kazdej liczbie zdjec od 1 do 8 uklad ma
 * byc pelny, bez sierocego kafla wiszacego w ostatnim rzedzie. Test pilnuje
 * granic, bo to jedyne miejsce, gdzie liczba zdjec zmienia wyglad.
 */

describe("ukladSiatki", () => {
  it("pojedynczy zrzut zajmuje calosc", () => {
    expect(ukladSiatki(1)).toBe("grid-cols-1");
  });

  it("dwa zrzuty schodza do jednej kolumny na waskim ekranie", () => {
    expect(ukladSiatki(2)).toContain("grid-cols-1");
    expect(ukladSiatki(2)).toContain("sm:grid-cols-2");
  });

  it("od trzech do czterech trzyma dwie kolumny", () => {
    expect(ukladSiatki(3)).toContain("grid-cols-2");
    expect(ukladSiatki(4)).toContain("grid-cols-2");
  });

  it("kazdy uklad poza pojedynczym zdjeciem ma rowne wiersze", () => {
    for (const n of [2, 3, 4, 5, 8]) expect(ukladSiatki(n)).toContain("auto-rows-");
    expect(ukladSiatki(1)).not.toContain("auto-rows-");
  });

  it("od pieciu dokłada trzecia kolumne na szerokim ekranie", () => {
    expect(ukladSiatki(5)).toContain("lg:grid-cols-3");
    expect(ukladSiatki(8)).toContain("lg:grid-cols-3");
  });
});

describe("klasaKafla", () => {
  it("jedyny zrzut rozpycha sie na cala szerokosc", () => {
    expect(klasaKafla(0, 1, false)).toBe("col-span-full");
  });

  it("przy trzech i pieciu pierwszy poziomy zrzut jest glowny", () => {
    expect(klasaKafla(0, 3, false)).toBe("col-span-2");
    expect(klasaKafla(0, 5, false)).toBe("col-span-2");
  });

  it("pionowy zrzut nie zostaje glowny - rozciagniety w poziomie bylby przyciety", () => {
    expect(klasaKafla(0, 3, true)).toBe("");
    expect(klasaKafla(0, 5, true)).toBe("");
  });

  it("przy parzystej liczbie siatka jest rowna, bez wyroznien", () => {
    expect(klasaKafla(0, 2, false)).toBe("");
    expect(klasaKafla(0, 4, false)).toBe("");
    expect(klasaKafla(0, 8, false)).toBe("");
  });

  it("dalsze zrzuty nigdy nie sa glowne", () => {
    expect(klasaKafla(1, 3, false)).toBe("");
    expect(klasaKafla(2, 5, false)).toBe("");
  });
});

describe("czyPion", () => {
  it("bez wymiarow zakladamy poziom - tak wyglada zrzut z platformy", () => {
    expect(czyPion(null, null)).toBe(false);
    expect(czyPion(1920, null)).toBe(false);
  });

  it("rozpoznaje orientacje po wymiarach", () => {
    expect(czyPion(1080, 1920)).toBe(true);
    expect(czyPion(1920, 1080)).toBe(false);
    expect(czyPion(1000, 1000)).toBe(false);
  });
});
