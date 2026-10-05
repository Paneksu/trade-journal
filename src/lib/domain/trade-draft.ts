/**
 * Szkic trade'a i jego walidacja - czesc czysta zapisu (ADR-026).
 *
 * Zapis trade'a ma dwa wejscia: formularz (`saveTrade`) i API synchronizacji
 * (`/api/ingest`). Oba zamieniaja swoje surowe dane na `TradeDraft`, a reszte
 * robi `persistTrade` (lib/trades/persist.ts): ta funkcja tu, potem
 * `computeTrade`, potem jedna transakcja. Dzieki temu reguly - i KOMUNIKATY
 * bledow po polsku - istnieja w jednym miejscu, a nie w dwoch rozjezdzajacych
 * sie kopiach.
 *
 * Modul jest czysty: zadnej bazy, zadnego Next. Instrument przychodzi z
 * zewnatrz, bo od jego strefy zalezy odczyt godzin (ADR-022).
 *
 * Kolejnosc sprawdzen jest czescia kontraktu: uzytkownik dostaje ZAWSZE
 * pierwszy blad z tej listy, tak jak dawal go formularz przed wydzieleniem
 * tego modulu. Nie przestawiac bez zmiany testow.
 */

import { fromLocalInput, type Direction, type InstrumentSpec } from "./calc";
import { czyStatus, maWynik, type StatusTrade } from "./status";

/** Tolerancja przy porownaniach sum kontraktow - liczby z formularza to stringi
    zamieniane na float, wiec 0.1 + 0.2 nie daje dokladnie 0.3. */
export const EPS_KONTRAKTY = 1e-6;

/** Moment: gotowa data (API, ISO z offsetem) albo zapis `datetime-local`
    z formularza, ktory czytamy w strefie gieldy instrumentu (ADR-022). */
export type CzasSzkicu = Date | { lokalny: string };

export type WyjscieSzkicu = {
  /** Numer wiersza od 1 - tak wiersz nazywa komunikat bledu. Puste wiersze
      formularza parser pomija, ale ich numery zostaja zajete. */
  numer: number;
  czas: CzasSzkicu | null;
  /** `null` = brak albo nieczytelna liczba; walidacja zglasza to jako brak ceny. */
  cena: number | null;
  /** `null` = nie podano (jedyne wyjscie bez liczby to cala pozycja). */
  kontrakty: number | null;
  /** Kwota z rachunku brokera dla kawalka, w centach. */
  kwotaBrokera: number | null;
  notatka: string | null;
};

export type TagSzkicu = { tagId: number; interval: string | null };

export type KierunekSzkicu = {
  /** Zaznaczony checkbox "kierunek trafiony". */
  directionCorrect: boolean;
  /** Czy blok oceny kierunku w ogole byl pokazany (ADR-018). */
  kierunekOceniany: boolean;
  badExecutionReason: string | null;
  potentialR: number | null;
};

/**
 * Wszystko, co moze przyniesc zapis trade'a. Pola opcjonalne maja jedno
 * znaczenie: `undefined` = "nie ruszaj tego, co jest w bazie" (przy edycji)
 * albo domyslna wartosc (przy tworzeniu). `null` = "wyczysc". Formularz wysyla
 * zawsze wszystko, wiec dla niego roznica nie istnieje; API przy aktualizacji
 * korzysta z niej, zeby nie kasowac tego, czego klient nie zna.
 */
export type TradeDraft = {
  id: number | null;
  accountId: number | null;
  instrumentId: number | null;
  backtestSessionId: number | null;
  /** Surowy tekst: walidacja zna tylko "long" i "short". */
  direction: string | null;
  /** Surowy tekst: walidacja zna tylko statusy z `STATUSY`. */
  status: string;
  entryTime: CzasSzkicu | null;
  entryPrice: number | null;
  contracts: number | null;
  wyjscia: WyjscieSzkicu[];
  stopLoss: number | null;
  takeProfit: number | null;
  mae: number | null;
  mfe: number | null;
  /** Kwota z rachunku dla calego trade'a, w centach (ADR-016). */
  brokerAmount: number | null;

  note?: string | null;
  moodNote?: string | null;
  /** Gotowosc 1-10; wszystko poza skala to "nie oceniam" (CHECK w bazie to tylko siatka). */
  readiness?: number | null;
  custom?: Record<string, unknown>;
  tags?: TagSzkicu[];
  kierunek?: KierunekSzkicu;
};

export type WyjscieZwalidowane = {
  time: Date | null;
  price: number;
  contracts: number;
  brokerAmount: number | null;
  note: string | null;
};

export type ZwalidowanySzkic = {
  accountId: number;
  instrumentId: number;
  backtestSessionId: number | null;
  direction: Direction;
  status: StatusTrade;
  entryTime: Date;
  entryPrice: number;
  contracts: number;
  /** Wyjscia po sortowaniu po czasie; puste dla planned i cancelled. */
  wyjscia: WyjscieZwalidowane[];
  stopLoss: number | null;
  takeProfit: number | null;
  mae: number | null;
  mfe: number | null;
  /** Kwota trade'a po regule "tylko gdy jest wynik i sa wyjscia". */
  brokerAmount: number | null;
};

export type WynikWalidacji =
  | { ok: true; dane: ZwalidowanySzkic }
  | { ok: false; error: string };

function naDate(c: CzasSzkicu, strefa: string): Date | null {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : c;
  return fromLocalInput(c.lokalny, strefa);
}

export function validujSzkic(
  szkic: TradeDraft,
  instrument: InstrumentSpec | null,
): WynikWalidacji {
  if (!szkic.accountId) return { ok: false, error: "Wybierz konto." };
  if (!szkic.instrumentId) return { ok: false, error: "Wybierz instrument." };
  if (szkic.direction !== "long" && szkic.direction !== "short") {
    return { ok: false, error: "Wybierz kierunek pozycji." };
  }
  const direction: Direction = szkic.direction;

  if (!instrument) return { ok: false, error: "Nie znam takiego instrumentu." };

  /* Godziny trade'a sa w czasie GIELDY, nie w strefie uzytkownika (ADR-022,
     2026-08-30). Wczesniej bylo tu `settings.timezone`: wpisane 09:35 z
     wykresu nowojorskiego zapisywalo sie jako 09:35 w Warszawie, czyli 03:35
     w Nowym Jorku - trade z otwarcia sesji ladowal w "premarket", a przy
     wieczornych godzinach takze w zlym dniu handlowym. */
  const strefaGieldy = instrument.exchangeTimezone;
  const entryTime = szkic.entryTime ? naDate(szkic.entryTime, strefaGieldy) : null;
  if (!entryTime) return { ok: false, error: "Podaj datę i godzinę wejścia." };

  if (szkic.entryPrice === null) return { ok: false, error: "Podaj cenę wejścia." };
  const entryPrice = szkic.entryPrice;

  const contracts = szkic.contracts;
  if (contracts === null || contracts <= 0) {
    return { ok: false, error: "Podaj liczbę kontraktów większą od zera." };
  }

  // --- wyjscia czesciowe ---
  const wyjsciaResult = zwalidujWyjscia(szkic.wyjscia, strefaGieldy, entryTime, contracts);
  if (!wyjsciaResult.ok) return wyjsciaResult;
  const wszystkieWyjscia = wyjsciaResult.rows;
  const closedContracts = wszystkieWyjscia.reduce((sum, w) => sum + w.contracts, 0);

  if (closedContracts > contracts + EPS_KONTRAKTY) {
    return {
      ok: false,
      error: `Suma kontraktów w wyjściach (${closedContracts}) przekracza wielkość pozycji (${contracts}).`,
    };
  }

  // Najpierw walidacja, dopiero potem korekta. Odwrotna kolejnosc miala cicha
  // dziure: status spoza enuma omijal gałąź "closed" i ladowal na "closed"
  // Z POMINIECIEM korekty, wiec trade bez ceny wyjscia zapisywal sie jako
  // zamkniety, dostawal pnl = null, a odczyt zamienial to na zero - pozycja
  // wchodzila do statystyk jako BE, ktorego nie bylo.
  if (!czyStatus(szkic.status)) {
    return { ok: false, error: "Nieznany status trade'a." };
  }
  const statusRaw: StatusTrade = szkic.status;

  // Pozycja czesciowo zamknieta jest OTWARTA - nie zmuszamy uzytkownika do
  // przelaczania statusu recznie, gdy wyjscia nie pokrywaja calej wielkosci.
  const status: StatusTrade =
    statusRaw === "closed" && closedContracts < contracts - EPS_KONTRAKTY ? "open" : statusRaw;

  // "closed" i "missed" wymagaja, zeby wyjscia pokrywaly CALA pozycje - bez
  // tego nie ma z czego policzyc ostatecznego R/PnL. Dla "closed" to w
  // praktyce sama siebie spelnia (niedopelniona suma juz zamienila status na
  // "open" wyzej) - realnie pilnuje "missed", ktore takiej auto-korekty nie ma.
  if (
    (status === "closed" || status === "missed") &&
    Math.abs(closedContracts - contracts) > EPS_KONTRAKTY
  ) {
    const brakuje = Math.round((contracts - closedContracts) * 10_000) / 10_000;
    return {
      ok: false,
      error: `Brakuje ${brakuje} kontraktów, żeby zamknąć całą pozycję (masz ${closedContracts} z ${contracts}).`,
    };
  }

  /* Trade rozstrzygniety musi miec czas kazdego wyjscia. Dawny formularz
     wymagal jednej daty wyjscia i ten wymog zostaje - bez czasu `durationS`
     jest `null`, wiec trade po cichu wypadalby ze statystyk czasu trzymania.
     Przy kilku kawalkach czas jest dodatkowo tym, co ustala ich kolejnosc,
     a od kolejnosci zalezy `scalingR`. Kolumna `trade_exits.exit_time` jest
     mimo to NULLABLE - dla pozycji otwartych i dla kawalkow wpisywanych
     w trakcie, gdy godziny jeszcze sie nie zna. */
  if (status === "closed" || status === "missed") {
    const bezCzasu = wszystkieWyjscia.findIndex((w) => w.time === null);
    if (bezCzasu !== -1) {
      return {
        ok: false,
        error: `Wyjście #${bezCzasu + 1}: podaj czas wyjścia. Trade zamknięty musi mieć godziny wszystkich wyjść.`,
      };
    }
  }

  // Statusy bez policzalnego wyniku (planned, cancelled) nie maja wyjsc -
  // nawet gdyby cos zostalo wpisane, nie zapisujemy tego ani nie liczymy.
  const wyjscia = status === "planned" || status === "cancelled" ? [] : wszystkieWyjscia;

  /* Kwota z rachunku brokera - gdy podana, jest wynikiem trade'a zamiast
     kwoty z siatki tickow (ADR-016). `maWynik(status)` zostaje bez zmian, wiec
     otwarta pozycja (nawet z czesciowym wyjsciem) nie ma tu wlasnego pola:
     jej wynik jest tymczasowy, nie "wynik z rachunku". */
  const brokerAmount =
    maWynik(status) && wyjscia.length > 0 && szkic.brokerAmount !== null
      ? szkic.brokerAmount
      : null;

  return {
    ok: true,
    dane: {
      accountId: szkic.accountId,
      instrumentId: szkic.instrumentId,
      backtestSessionId: szkic.backtestSessionId,
      direction,
      status,
      entryTime,
      entryPrice,
      contracts,
      wyjscia,
      stopLoss: szkic.stopLoss,
      takeProfit: szkic.takeProfit,
      mae: szkic.mae,
      mfe: szkic.mfe,
      brokerAmount,
    },
  };
}

/**
 * Sprawdza wiersze wyjsc i ustala ich kolejnosc.
 *
 * Sortuje po czasie rosnaco - `computeTrade` NIE sortuje wyjsc samo (kontrakt
 * funkcji, patrz `calc.ts`: kolejnosc odpowiada za `scalingR`), wiec to jest
 * jedyne miejsce, w ktorym kolejnosc kawalkow zostaje ustalona. Wiersze bez
 * czasu ida PO wierszach z czasem, w kolejnosci wpisania - nie da sie ich
 * uszeregowac chronologicznie, wiec nie udajemy, ze sie da.
 *
 * JEDEN wiersz z pusta liczba kontraktow znaczy "cala pozycja". Bez tej reguly
 * najczestszy przypadek - jedno wyjscie, cala pozycja - kazalby wpisywac te sama
 * liczbe dwa razy. Przy dwoch i wiecej wierszach pusta liczba jest bledem.
 */
function zwalidujWyjscia(
  wiersze: WyjscieSzkicu[],
  strefaGieldy: string,
  entryTime: Date,
  pozycja: number,
): { ok: true; rows: WyjscieZwalidowane[] } | { ok: false; error: string } {
  type Surowe = {
    idx: number;
    numer: number;
    time: Date | null;
    price: number;
    contracts: number | null;
    brokerAmount: number | null;
    note: string | null;
  };
  const surowe: Surowe[] = [];

  wiersze.forEach((w, idx) => {
    surowe.push({
      idx,
      numer: w.numer,
      time: null,
      price: w.cena ?? Number.NaN,
      contracts: w.kontrakty,
      brokerAmount: w.kwotaBrokera,
      note: w.notatka,
    });
  });

  // Petla sprawdzajaca, w tej samej kolejnosci pol co dawny parser formularza:
  // cena, kontrakty, czas - dla kazdego wiersza po kolei.
  for (let i = 0; i < wiersze.length; i += 1) {
    const w = wiersze[i];
    if (w.cena === null) {
      return { ok: false, error: `Wyjście #${w.numer}: podaj cenę wyjścia.` };
    }
    if (w.kontrakty !== null && w.kontrakty <= 0) {
      return {
        ok: false,
        error: `Wyjście #${w.numer}: liczba kontraktów musi być większa od zera.`,
      };
    }
    if (w.czas !== null) {
      const time = naDate(w.czas, strefaGieldy);
      if (!time) {
        return { ok: false, error: `Wyjście #${w.numer}: nie rozpoznaję podanej daty i godziny.` };
      }
      if (time.getTime() < entryTime.getTime()) {
        return { ok: false, error: "Wyjście nie może być wcześniej niż wejście." };
      }
      surowe[i].time = time;
    }
  }

  /* Jedno wyjscie bez podanej liczby kontraktow = cala pozycja. Przy kilku
     wierszach nie ma czego domyslac - wtedy blad. */
  if (surowe.length === 1 && surowe[0].contracts === null) {
    surowe[0].contracts = pozycja;
  }
  const brakujacy = surowe.find((w) => w.contracts === null);
  if (brakujacy) {
    return {
      ok: false,
      error: `Wyjście #${brakujacy.numer}: podaj liczbę kontraktów. Przy kilku wyjściach trzeba ją wpisać przy każdym.`,
    };
  }

  const zCzasem = surowe
    .filter((w) => w.time !== null)
    .sort((a, b) => a.time!.getTime() - b.time!.getTime() || a.idx - b.idx);
  const bezCzasu = surowe.filter((w) => w.time === null);

  return {
    ok: true,
    rows: [...zCzasem, ...bezCzasu].map(
      (w): WyjscieZwalidowane => ({
        time: w.time,
        price: w.price,
        contracts: w.contracts as number,
        brokerAmount: w.brokerAmount,
        note: w.note,
      }),
    ),
  };
}
