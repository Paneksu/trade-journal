/**
 * Kierunek trafiony mimo zlej egzekucji (ADR-018).
 *
 * Dziennik musi odrozniac dwie zupelnie rozne porazki: "pomylilem sie co do
 * kierunku" i "mialem racje, ale wyszedlem za wczesnie albo dostalem
 * niepotrzebne BE". Mieszanie ich zaciera obraz - skutecznosc 41% moze znaczyc
 * system bez przewagi albo system z przewaga i zla reka.
 *
 * Wygranej NIE zaznacza sie recznie: `directionCorrect` zostaje wtedy `null`,
 * a wyprowadzenie "zysk => kierunek trafiony" zyje wylacznie tutaj. Zapis
 * `true` do bazy przy wygranej bylby denormalizacja, ktora sklamie po zmianie
 * progu BE w ustawieniach - dokladnie pulapka opisana w ADR-011.
 *
 * Modul czysty poza `sqlKierunek`, ktore - tak jak `sqlWynik` w `outcome.ts` -
 * buduje fragment SQL przez tagged template z drizzle-orm, zeby ten sam warunek
 * dalo sie policzyc w bazie i w TypeScripcie bez dwoch wzorow obok siebie.
 * Kolumny dostaje wywolujacy; modul nie zna schematu bazy.
 */

import { sql, type SQL } from "drizzle-orm";

import { sqlWynik, wynikTrade, type KolumnyWyniku, type Progi } from "./outcome";

export const POWODY = ["unnecessary_be", "unnecessary_sl", "early_exit"] as const;

export type PowodZlejEgzekucji = (typeof POWODY)[number];

export const POWOD_NAZWY: Record<PowodZlejEgzekucji, string> = {
  unnecessary_be: "niepotrzebne BE",
  unnecessary_sl: "niepotrzebny stop",
  early_exit: "za wczesne wyjście",
};

/** Strazy typu: string z formularza albo z bazy jest powodem tylko gdy jest na liscie. */
export function czyPowod(w: string | null | undefined): w is PowodZlejEgzekucji {
  if (w === null || w === undefined) return false;
  return (POWODY as readonly string[]).includes(w);
}

/** Minimum, ktore trzeba wiedziec o trade'cie, zeby ocenic trafnosc kierunku. */
export type TradeKierunek = {
  pnl: number;
  riskAmount: number | null;
  contracts: number;
  rMultiple: number | null;
  directionCorrect: boolean | null;
  badExecutionReason: PowodZlejEgzekucji | null;
  potentialR: number | null;
};

/**
 * Trzy stany, nie dwa. `null` znaczy "nieocenione", a nie "kierunek chybiony" -
 * nieoznaczona strata nie ma prawa psuc trafnosci, bo uzytkownik jej po prostu
 * nie przejrzal. Wygrana wpada w `true` z definicji.
 */
export function kierunekTrafiony(t: TradeKierunek, progi: Progi): boolean | null {
  if (wynikTrade(t, progi) === "zysk") return true;
  return t.directionCorrect;
}

/** Kierunek dobry, wynik nie - czyli strata wylacznie z powodu egzekucji. */
export function strataTechniczna(t: TradeKierunek, progi: Progi): boolean {
  return wynikTrade(t, progi) !== "zysk" && kierunekTrafiony(t, progi) === true;
}

/**
 * Ile R zostawione na stole. Clamp na zero per trade jest istotny: trade, ktory
 * wyszedl lepiej niz zadeklarowany potencjal, nie ma generowac "ujemnej straty"
 * kompensujacej cudze bledy w sumie zbiorczej.
 *
 * `null` gdy potencjal nie zostal wpisany - zero klamalo by, ze egzekucja byla
 * czysta.
 */
export function utraconeR(t: TradeKierunek, progi: Progi): number | null {
  if (kierunekTrafiony(t, progi) !== true) return null;
  if (t.potentialR === null) return null;
  return Math.max(0, t.potentialR - (t.rMultiple ?? 0));
}

export type WejscieKierunku = {
  directionCorrect: boolean | null;
  badExecutionReason: PowodZlejEgzekucji | null;
  potentialR: number | null;
};

/**
 * Doprowadza trojke pol do postaci, ktora przejdzie przez CHECK `trades_kierunek`.
 * Wolane PRZED zapisem - bez tego uzytkownik dostaje w twarz surowy komunikat
 * Postgresa zamiast zachowania formularza.
 *
 * Trzy reguly:
 *  - przy wygranej cala trojka to `null` (trafnosc wyprowadzamy z wyniku),
 *  - powod i potencjal maja sens wylacznie przy trafionym kierunku,
 *  - `oceniane` mowi, czy blok w ogole byl pokazany. To jest roznica miedzy
 *    "kierunek chybiony" a "nie pytalismy": odznaczony checkbox na widocznym
 *    bloku to jawna odpowiedz `false`, a nie brak danych. Bez tego rozroznienia
 *    mianownik trafnosci rownalby sie licznikowi i metryka zawsze pokazywalaby
 *    sto procent.
 */
export function normalizujKierunek(
  wejscie: WejscieKierunku,
  kontekst: { wygrana: boolean; oceniane: boolean },
): WejscieKierunku {
  const pusto: WejscieKierunku = {
    directionCorrect: null,
    badExecutionReason: null,
    potentialR: null,
  };
  if (kontekst.wygrana || !kontekst.oceniane) return pusto;
  if (wejscie.directionCorrect !== true) {
    return { directionCorrect: false, badExecutionReason: null, potentialR: null };
  }
  return wejscie;
}

export type WariantKierunku = "tak" | "nie" | "nieocenione";

export const WARIANTY_KIERUNKU = ["tak", "nie", "nieocenione"] as const;

export const WARIANT_KIERUNKU_NAZWY: Record<WariantKierunku, string> = {
  tak: "kierunek trafiony",
  nie: "kierunek chybiony",
  nieocenione: "nieocenione",
};

export function czyWariantKierunku(w: string | null | undefined): w is WariantKierunku {
  return w === "tak" || w === "nie" || w === "nieocenione";
}

export type KolumnyKierunku = KolumnyWyniku & {
  directionCorrect: SQL | import("drizzle-orm").SQLWrapper;
};

/**
 * Odpowiednik `kierunekTrafiony` jako warunek SQL. Wygrana wchodzi do "tak"
 * przez `sqlWynik`, a nie przez zapisana kolumne - inaczej filtr rozjechalby
 * sie z etykieta w tym samym renderze.
 */
export function sqlKierunek(
  kolumny: KolumnyKierunku,
  progi: Progi,
  wariant: WariantKierunku,
): SQL {
  const zysk = sqlWynik(kolumny, progi, "zysk");
  if (wariant === "tak") {
    return sql`(${zysk} or ${kolumny.directionCorrect} is true)`;
  }
  if (wariant === "nie") {
    return sql`(not (${zysk}) and ${kolumny.directionCorrect} is false)`;
  }
  return sql`(not (${zysk}) and ${kolumny.directionCorrect} is null)`;
}
