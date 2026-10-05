/**
 * Zrodlo trade'a (ADR-026) i rodzaj sesji (ADR-027) - nazwy do interfejsu i
 * walidacja wartosci z formularza. Modul czysty, bez importow z bazy.
 */

export type ZrodloTradu = "form" | "tradingview" | "fxreplay";

/** Plakietka zrodla; `null` dla trade'a wpisanego recznie (nie ma czym go oznaczac). */
export function nazwaZrodla(zrodlo: ZrodloTradu): string | null {
  switch (zrodlo) {
    case "tradingview":
      return "TradingView";
    case "fxreplay":
      return "FX Replay";
    default:
      return null;
  }
}

export const RODZAJE_SESJI = ["backtest", "forward"] as const;
export type RodzajSesji = (typeof RODZAJE_SESJI)[number];

export const RODZAJ_SESJI_NAZWY: Record<RodzajSesji, string> = {
  backtest: "backtest",
  forward: "forward",
};

export function czyRodzajSesji(w: unknown): w is RodzajSesji {
  return typeof w === "string" && (RODZAJE_SESJI as readonly string[]).includes(w);
}

/** Rodzaj sesji z formularza; brak albo smiec = `backtest` (wartosc domyslna kolumny). */
export function rodzajSesjiZFormularza(w: unknown): RodzajSesji {
  return czyRodzajSesji(w) ? w : "backtest";
}

/** Filtr `source` z `parseFilters` na wartosc przelacznika zrodla w pasku (parametr `zrodlo`). */
export function zrodloPrzelacznika(source: "live" | "backtest" | "forward" | "sessions" | "all"): string {
  return source === "all" ? "wszystko" : source === "sessions" ? "sesje" : source;
}
