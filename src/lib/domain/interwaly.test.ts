import { describe, expect, it } from "vitest";

import { czyInterwal, INTERWALY, porzadekInterwalu, sparujZInterwalami } from "./interwaly";

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

describe("sparujZInterwalami", () => {
  it("paruje po indeksie, nie po wartosci", () => {
    const pliki = ["a.png", "b.png", "c.png"];
    const wynik = sparujZInterwalami(pliki, ["5m", "1h", "D"]);
    expect(wynik).toEqual([
      { plik: "a.png", interval: "5m" },
      { plik: "b.png", interval: "1h" },
      { plik: "c.png", interval: "D" },
    ]);
  });

  it("nie przesuwa interwalow, gdy jeden plik nie ma wyboru (pusty string)", () => {
    // Dokladnie ten blad, ktorego nikt nie zauwazy: gdyby puste pozycje byly
    // pomijane zamiast trzymac miejsce, drugi i trzeci plik dostalyby
    // interwaly nalezace do sasiadow.
    const pliki = ["a.png", "b.png", "c.png"];
    const wynik = sparujZInterwalami(pliki, ["5m", "", "D"]);
    expect(wynik).toEqual([
      { plik: "a.png", interval: "5m" },
      { plik: "b.png", interval: null },
      { plik: "c.png", interval: "D" },
    ]);
  });

  it("wartosc spoza listy zamienia sie w null, nie odrzuca pary", () => {
    const wynik = sparujZInterwalami(["a.png"], ["7m"]);
    expect(wynik).toEqual([{ plik: "a.png", interval: null }]);
  });

  it("brakujacy interwal na koncu listy (krotsza tablica) daje null", () => {
    const wynik = sparujZInterwalami(["a.png", "b.png"], ["5m"]);
    expect(wynik).toEqual([
      { plik: "a.png", interval: "5m" },
      { plik: "b.png", interval: null },
    ]);
  });
});
