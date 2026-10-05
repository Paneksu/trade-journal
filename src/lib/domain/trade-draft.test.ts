import { describe, expect, it } from "vitest";

import type { InstrumentSpec } from "./calc";
import { validujSzkic, type TradeDraft } from "./trade-draft";

const NQ: InstrumentSpec = {
  tickSize: 0.25,
  tickValue: 5000,
  rthFrom: "09:30",
  rthTo: "16:00",
  exchangeTimezone: "America/New_York",
};

/** Poprawny, zamkniety trade z jednym wyjsciem - baza dla kazdego przypadku. */
function szkic(nadpisz: Partial<TradeDraft> = {}): TradeDraft {
  return {
    id: null,
    accountId: 1,
    instrumentId: 1,
    backtestSessionId: null,
    direction: "long",
    status: "closed",
    entryTime: { lokalny: "2026-03-10T09:35" },
    entryPrice: 20000,
    contracts: 2,
    wyjscia: [
      {
        numer: 1,
        czas: { lokalny: "2026-03-10T09:50" },
        cena: 20010,
        kontrakty: null,
        kwotaBrokera: null,
        notatka: null,
      },
    ],
    stopLoss: 19990,
    takeProfit: 20020,
    mae: null,
    mfe: null,
    brokerAmount: null,
    ...nadpisz,
  };
}

function blad(s: TradeDraft, instrument: InstrumentSpec | null = NQ): string {
  const w = validujSzkic(s, instrument);
  if (w.ok) throw new Error("oczekiwano bledu, jest ok");
  return w.error;
}

describe("validujSzkic: komunikaty i kolejnosc", () => {
  it("poprawny szkic przechodzi, jedno wyjscie bez kontraktow to cala pozycja", () => {
    const w = validujSzkic(szkic(), NQ);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.dane.wyjscia).toHaveLength(1);
    expect(w.dane.wyjscia[0].contracts).toBe(2);
    expect(w.dane.status).toBe("closed");
  });

  it.each([
    [{ accountId: null }, "Wybierz konto."],
    [{ accountId: 0 }, "Wybierz konto."],
    [{ instrumentId: null }, "Wybierz instrument."],
    [{ direction: "flat" }, "Wybierz kierunek pozycji."],
    [{ direction: null }, "Wybierz kierunek pozycji."],
    [{ entryTime: null }, "Podaj datę i godzinę wejścia."],
    [{ entryTime: { lokalny: "wczoraj" } }, "Podaj datę i godzinę wejścia."],
    [{ entryPrice: null }, "Podaj cenę wejścia."],
    [{ contracts: null }, "Podaj liczbę kontraktów większą od zera."],
    [{ contracts: 0 }, "Podaj liczbę kontraktów większą od zera."],
    [{ status: "zamkniety" }, "Nieznany status trade'a."],
  ] as [Partial<TradeDraft>, string][])("%j -> %s", (nadpisz, komunikat) => {
    expect(blad(szkic(nadpisz))).toBe(komunikat);
  });

  it("nieznany instrument zglasza sie dopiero po koncie, instrumencie i kierunku", () => {
    expect(blad(szkic(), null)).toBe("Nie znam takiego instrumentu.");
    expect(blad(szkic({ accountId: null }), null)).toBe("Wybierz konto.");
    expect(blad(szkic({ direction: "x" }), null)).toBe("Wybierz kierunek pozycji.");
  });

  it("blad wejscia wyprzedza blad wyjscia", () => {
    const s = szkic({
      entryPrice: null,
      wyjscia: [{ numer: 1, czas: null, cena: null, kontrakty: null, kwotaBrokera: null, notatka: null }],
    });
    expect(blad(s)).toBe("Podaj cenę wejścia.");
  });

  it("wiersz wyjscia: brak ceny, kontrakty <= 0, nieczytelny czas, wyjscie przed wejsciem", () => {
    const wiersz = szkic().wyjscia[0];
    expect(blad(szkic({ wyjscia: [{ ...wiersz, numer: 3, cena: null }] }))).toBe(
      "Wyjście #3: podaj cenę wyjścia.",
    );
    expect(blad(szkic({ wyjscia: [{ ...wiersz, numer: 2, kontrakty: 0 }] }))).toBe(
      "Wyjście #2: liczba kontraktów musi być większa od zera.",
    );
    expect(blad(szkic({ wyjscia: [{ ...wiersz, czas: { lokalny: "?" } }] }))).toBe(
      "Wyjście #1: nie rozpoznaję podanej daty i godziny.",
    );
    expect(blad(szkic({ wyjscia: [{ ...wiersz, czas: { lokalny: "2026-03-10T09:00" } }] }))).toBe(
      "Wyjście nie może być wcześniej niż wejście.",
    );
  });

  it("przy kilku wyjsciach kontrakty trzeba wpisac przy kazdym", () => {
    const w = szkic().wyjscia[0];
    const s = szkic({
      wyjscia: [
        { ...w, numer: 1, kontrakty: 1 },
        { ...w, numer: 2, kontrakty: null },
      ],
    });
    expect(blad(s)).toBe(
      "Wyjście #2: podaj liczbę kontraktów. Przy kilku wyjściach trzeba ją wpisać przy każdym.",
    );
  });

  it("suma kontraktow ponad pozycje i niedobor przy closed/missed", () => {
    const w = szkic().wyjscia[0];
    expect(blad(szkic({ wyjscia: [{ ...w, kontrakty: 3 }] }))).toBe(
      "Suma kontraktów w wyjściach (3) przekracza wielkość pozycji (2).",
    );
    // closed z niepelna suma staje sie open (bez bledu)...
    const otwarty = validujSzkic(szkic({ wyjscia: [{ ...w, kontrakty: 1 }] }), NQ);
    expect(otwarty.ok && otwarty.dane.status).toBe("open");
    // ...a missed takiej korekty nie ma
    expect(blad(szkic({ status: "missed", wyjscia: [{ ...w, kontrakty: 1 }] }))).toBe(
      "Brakuje 1 kontraktów, żeby zamknąć całą pozycję (masz 1 z 2).",
    );
  });

  it("trade zamkniety wymaga czasu kazdego wyjscia, otwarty nie", () => {
    const w = szkic().wyjscia[0];
    expect(blad(szkic({ wyjscia: [{ ...w, czas: null }] }))).toBe(
      "Wyjście #1: podaj czas wyjścia. Trade zamknięty musi mieć godziny wszystkich wyjść.",
    );
    expect(validujSzkic(szkic({ status: "open", wyjscia: [{ ...w, czas: null }] }), NQ).ok).toBe(true);
  });

  it("wyjscia sortuja sie po czasie, a te bez czasu ida na koniec", () => {
    const w = szkic().wyjscia[0];
    const wynik = validujSzkic(
      szkic({
        status: "open",
        contracts: 3,
        wyjscia: [
          { ...w, numer: 1, kontrakty: 1, czas: { lokalny: "2026-03-10T10:10" }, cena: 20030 },
          { ...w, numer: 2, kontrakty: 1, czas: null, cena: 20040 },
          { ...w, numer: 3, kontrakty: 1, czas: { lokalny: "2026-03-10T09:40" }, cena: 20020 },
        ],
      }),
      NQ,
    );
    expect(wynik.ok).toBe(true);
    if (!wynik.ok) return;
    expect(wynik.dane.wyjscia.map((x) => x.price)).toEqual([20020, 20030, 20040]);
  });

  it("godziny czyta w strefie gieldy: 09:35 nowojorskie to 13:35 UTC w marcu po zmianie czasu", () => {
    const w = validujSzkic(szkic(), NQ);
    expect(w.ok && w.dane.entryTime.toISOString()).toBe("2026-03-10T13:35:00.000Z");
  });

  it("gotowa data (API) omija strefe: moment zostaje dokladnie ten", () => {
    const w = validujSzkic(szkic({ entryTime: new Date("2026-03-10T13:35:00Z") }), NQ);
    expect(w.ok && w.dane.entryTime.toISOString()).toBe("2026-03-10T13:35:00.000Z");
  });

  it("kwota brokera liczy sie tylko gdy jest wynik i sa wyjscia", () => {
    const zKwota = validujSzkic(szkic({ brokerAmount: 11600 }), NQ);
    expect(zKwota.ok && zKwota.dane.brokerAmount).toBe(11600);
    const zero = validujSzkic(szkic({ brokerAmount: 0 }), NQ);
    expect(zero.ok && zero.dane.brokerAmount).toBe(0);
    const otwarty = validujSzkic(szkic({ status: "open", brokerAmount: 11600 }), NQ);
    expect(otwarty.ok && otwarty.dane.brokerAmount).toBeNull();
  });

  it("planned i cancelled nie maja wyjsc, nawet gdy cos przyszlo", () => {
    const w = validujSzkic(szkic({ status: "planned" }), NQ);
    expect(w.ok && w.dane.wyjscia).toEqual([]);
  });
});
