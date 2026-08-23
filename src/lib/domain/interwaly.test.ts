import { describe, expect, it } from "vitest";

import { czyInterwal, INTERWALY, porzadekInterwalu } from "./interwaly";

describe("czyInterwal", () => {
  it("przyjmuje kazda wartosc z listy", () => {
    for (const w of INTERWALY) expect(czyInterwal(w)).toBe(true);
  });

  it("odrzuca pelna nazwe zamiast kodu", () => {
    expect(czyInterwal("1 min")).toBe(false);
  });

  it("odrzuca pusty string", () => {
    expect(czyInterwal("")).toBe(false);
  });

  it("odrzuca null i undefined", () => {
    expect(czyInterwal(null)).toBe(false);
    expect(czyInterwal(undefined)).toBe(false);
  });
});

describe("porzadekInterwalu", () => {
  it("daje kolejnosc listy, nie alfabetyczna", () => {
    // Alfabetycznie "1h" wyprzedza "1m" (h < m), ale 1m jest drobniejszym
    // interwalem i musi wypasc wczesniej w kolejnosci wyswietlania.
    expect(porzadekInterwalu("1m")).toBeLessThan(porzadekInterwalu("1h"));
  });

  it("odzwierciedla pelna kolejnosc od najkrotszego do najdluzszego", () => {
    const posortowane = [...INTERWALY].sort(
      (a, b) => porzadekInterwalu(a) - porzadekInterwalu(b),
    );
    expect(posortowane).toEqual(INTERWALY);
  });
});
