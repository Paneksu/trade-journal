import { describe, expect, it } from "vitest";

import {
  czyHTF,
  czyInterwal,
  INTERWALY,
  interwalyWarstwy,
  porzadekInterwalu,
  PROG_HTF,
  sparujZInterwalami,
  warstwaInterwalu,
  warstwaLub,
} from "./interwaly";

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

describe("warstwaInterwalu", () => {
  it("prog jest domkniety od dolu - 1h to juz HTF", () => {
    expect(warstwaInterwalu(PROG_HTF)).toBe("HTF");
    expect(warstwaInterwalu("30m")).toBe("LTF");
  });

  it("kazdy interwal nalezy do dokladnie jednej warstwy", () => {
    const htf = interwalyWarstwy("HTF");
    const ltf = interwalyWarstwy("LTF");
    expect([...ltf, ...htf]).toHaveLength(INTERWALY.length);
    expect(htf.filter((w) => ltf.includes(w))).toEqual([]);
  });

  it("podzial idzie po kolejnosci listy, nie po literach nazwy", () => {
    // "4h" wypada w HTF mimo ze zaczyna sie od cyfry mniejszej niz "30m".
    expect(interwalyWarstwy("HTF")).toEqual(["1h", "4h", "D", "W", "M"]);
    expect(interwalyWarstwy("LTF")).toEqual(["30s", "1m", "2m", "3m", "4m", "5m", "15m", "30m"]);
  });
});

describe("warstwaLub", () => {
  it("brak interwalu nie nalezy do zadnej warstwy", () => {
    // Tag Setup albo Blad nie ma skali czasu - udawanie warstwy domyslnej
    // wrzucaloby go do statystyk HTF albo LTF bez podstawy.
    expect(warstwaLub(null)).toBeNull();
    expect(warstwaLub("")).toBeNull();
    expect(warstwaLub("7m")).toBeNull();
  });

  it("czyHTF nie myli braku danych z LTF", () => {
    expect(czyHTF("4h")).toBe(true);
    expect(czyHTF("5m")).toBe(false);
    expect(czyHTF(null)).toBe(false);
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
