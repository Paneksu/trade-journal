/**
 * Rozpoznanie formatu pliku po NAGLOWKACH (ADR-034 pkt 2). Kazdy format deklaruje kolumny wymagane (bez wielkosci liter
 * i bialych znakow na brzegach). Plik pasuje, gdy ma wszystkie kolumny jednego formatu; zero albo dwa dopasowania to
 * odrzucenie z lista obslugiwanych formatow. Zadnego zgadywania i recznego mapowania kolumn.
 *
 * Etap A: Tradovate Orders i Cash History, potwierdzone na prawdziwych plikach uzytkownika (13.10.2026). Kolejne formaty
 * (Fills, Performance, TopstepX, Rithmic, NinjaTrader, TradingView, generic) powstaja WYLACZNIE z prawdziwego pliku.
 */

import type { NazwaFormatu, PlatformaPliku } from "./typy";

export type OpisFormatu = {
  nazwa: NazwaFormatu;
  platforma: PlatformaPliku;
  /** Nazwa dla czlowieka (UI, komunikaty). */
  etykieta: string;
  /** Kolumny wymagane, znormalizowane (male litery, bez bialych znakow na brzegach). */
  wymagane: readonly string[];
};

export const FORMATY: readonly OpisFormatu[] = [
  {
    nazwa: "tradovate_orders",
    platforma: "tradovate",
    etykieta: "Tradovate: Orders",
    wymagane: ["orderid", "account", "b/s", "contract", "avgprice", "filledqty", "fill time", "status", "timestamp"],
  },
  {
    nazwa: "tradovate_cash_history",
    platforma: "tradovate",
    etykieta: "Tradovate: Cash History",
    wymagane: ["account", "transaction id", "timestamp", "delta", "cash change type", "currency", "contract"],
  },
];

/** Platformy, dla ktorych istnieje parser (reszta firm na liscie nie ma jeszcze obslugiwanego formatu). */
export const PLATFORMY_Z_PARSEREM: readonly PlatformaPliku[] = [...new Set(FORMATY.map((f) => f.platforma))];

export const normalizujNaglowek = (k: string): string => k.trim().toLowerCase();

export type WynikRozpoznania =
  | { ok: true; format: OpisFormatu; indeksy: Map<string, number> }
  | { ok: false; kod: "unknown_format" | "ambiguous_format"; komunikat: string };

export function listaFormatow(): string {
  return FORMATY.map((f) => `${f.etykieta} (kolumny: ${f.wymagane.join(", ")})`).join("; ");
}

export function rozpoznajFormat(naglowek: string[]): WynikRozpoznania {
  const indeksy = new Map<string, number>();
  naglowek.forEach((k, i) => {
    const n = normalizujNaglowek(k);
    if (!indeksy.has(n)) indeksy.set(n, i);
  });
  const pasujace = FORMATY.filter((f) => f.wymagane.every((k) => indeksy.has(k)));
  if (pasujace.length === 1) return { ok: true, format: pasujace[0], indeksy };
  if (pasujace.length > 1) {
    return {
      ok: false,
      kod: "ambiguous_format",
      komunikat: `Nagłówek pasuje do kilku formatów naraz (${pasujace.map((f) => f.etykieta).join(", ")}), więc nie wybieram żadnego. Wyeksportuj każdy raport osobno.`,
    };
  }
  const widziane = naglowek.slice(0, 12).map((k) => k.trim()).join(", ");
  return {
    ok: false,
    kod: "unknown_format",
    komunikat: `Nie rozpoznaję formatu pliku. Nagłówek: ${widziane}${naglowek.length > 12 ? ", …" : ""}. Obsługiwane formaty: ${listaFormatow()}.`,
  };
}
