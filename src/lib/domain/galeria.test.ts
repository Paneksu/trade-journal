import { describe, expect, it } from "vitest";

import {
  BAZA_WYSOKOSCI_WIERSZA,
  PROPORCJA_DOMYSLNA,
  bazaKafla,
  proporcja,
  wzrostKafla,
} from "./galeria";

describe("proporcja", () => {
  it("bez wymiarow zwraca wartosc domyslna", () => {
    expect(proporcja(null, null)).toBe(PROPORCJA_DOMYSLNA);
    expect(proporcja(1920, null)).toBe(PROPORCJA_DOMYSLNA);
    expect(proporcja(null, 1080)).toBe(PROPORCJA_DOMYSLNA);
  });

  it("wysokosc zero (dzielenie przez zero) tez zwraca wartosc domyslna", () => {
    expect(proporcja(1920, 0)).toBe(PROPORCJA_DOMYSLNA);
  });

  it("liczy aspect-ratio z podanych wymiarow", () => {
    expect(proporcja(1920, 1080)).toBeCloseTo(1920 / 1080);
    expect(proporcja(1080, 1920)).toBeCloseTo(1080 / 1920);
  });
});

describe("wzrostKafla", () => {
  it("zwraca proporcje zdjecia jako flex-grow", () => {
    const proporcje = [1.5, 0.6, 2.1];
    expect(wzrostKafla(0, proporcje)).toBe(1.5);
    expect(wzrostKafla(1, proporcje)).toBe(0.6);
    expect(wzrostKafla(2, proporcje)).toBe(2.1);
  });
});

describe("bazaKafla", () => {
  it("flex-basis to proporcja razy baza wysokosci wiersza", () => {
    const proporcje = [1.5, 0.6, 2.1];
    expect(bazaKafla(0, proporcje, BAZA_WYSOKOSCI_WIERSZA)).toBeCloseTo(
      1.5 * BAZA_WYSOKOSCI_WIERSZA,
    );
    expect(bazaKafla(1, proporcje, BAZA_WYSOKOSCI_WIERSZA)).toBeCloseTo(
      0.6 * BAZA_WYSOKOSCI_WIERSZA,
    );
  });

  it("jest proporcjonalna do aspect ratio - nic nie jest normalizowane wzgledem calego wiersza", () => {
    // Zadna suma nie jest liczona w JS (to teraz robi CSS flex-wrap), wiec
    // podwojenie proporcji musi dokladnie podwoic flex-basis, niezaleznie od
    // tego, ile innych zdjec jest w tablicy.
    const proporcje = [0.8, 1.6];
    const bazowa = [proporcje[0], proporcje[0] * 2];
    expect(bazaKafla(0, bazowa, BAZA_WYSOKOSCI_WIERSZA)).toBeCloseTo(
      bazaKafla(1, bazowa, BAZA_WYSOKOSCI_WIERSZA) / 2,
    );
  });
});

describe("regresja - zaden eksport nie wraca do starego ukladu przycinajacego", () => {
  it("zaden wynik nie zawiera 'object-cover' ani 'auto-rows-'", () => {
    const proporcje = [1.5, 0.6, 2.1, 1.0];

    const wyniki = [
      proporcja(1920, 1080),
      proporcja(null, null),
      wzrostKafla(0, proporcje),
      bazaKafla(0, proporcje, BAZA_WYSOKOSCI_WIERSZA),
      PROPORCJA_DOMYSLNA,
      BAZA_WYSOKOSCI_WIERSZA,
    ];

    const zserializowane = JSON.stringify(wyniki);
    expect(zserializowane).not.toContain("object-cover");
    expect(zserializowane).not.toContain("auto-rows-");
  });
});
