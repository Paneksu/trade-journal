/**
 * Zrodlo trade'a (ADR-026) i rodzaj sesji (ADR-027) - nazwy do interfejsu i
 * walidacja wartosci z formularza. Modul czysty, bez importow z bazy. Jedyny import
 * to `sql` z drizzle-orm (tagged template, nie klient bazy) - ten sam swiadomy wyjatek
 * co w `outcome.ts`: regula zrodla danych ma lustro w SQL obok wersji TypeScript.
 */

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

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

/* ---------------------------------------------------------------------------
   Zrodlo danych trade'a (ADR-033, MUST 6; Slowa uzytkownika 14.10.2026: «Wyliczane»)
   ---------------------------------------------------------------------------
   Backtest / forward / demo / live. NIE ma kolumny `data_source`: wszystkie
   cztery wartosci wynikaja z danych, a ADR-027 odrzucil zapis kategorii na
   trade'ie, bo zmiana fazy konta musialaby przepisac cala historie.

   Reguly (kolejnosc ma znaczenie):
     1. trade nalezy do sesji -> rodzaj sesji (`backtest` | `forward`);
     2. konto `demo` albo `paper` -> `demo`;
     3. reszta (`live`, `prop`) -> `live`. Podzial `live` na realne / prop eval /
        prop funded daje `kategoriaKonta` (ADR-027).
   Nie mylic z `trades.source` (ADR-026: skad przyszedl wpis - formularz, TradingView, FX Replay).

   Ta sama regula istnieje w dwoch postaciach: `zrodloDanych` (TypeScript) i
   `sqlZrodloDanych` (fragment SQL). Test `src/lib/api-v2/decyzje-eksport-zrodla.db.test.ts` (zrodlo danych: TS kontra SQL) porownuje je na
   prawdziwych wierszach, wzorem `wynikTrade` / `sqlWynik` (ADR-011). Zmiana jednej
   wymaga zmiany drugiej.
*/

export const ZRODLA_DANYCH = ["backtest", "forward", "demo", "live"] as const;
export type ZrodloDanych = (typeof ZRODLA_DANYCH)[number];

export const ZRODLO_DANYCH_NAZWY: Record<ZrodloDanych, string> = {
  backtest: "backtest (replay)",
  forward: "forward",
  demo: "demo",
  live: "live",
};

export type WejscieZrodlaDanych = {
  /** Rodzaj sesji, do ktorej nalezy trade; `null` = trade poza sesja. */
  rodzajSesji: RodzajSesji | null;
  /** Czy trade ma `backtest_session_id` (przy `rodzajSesji = null` oznacza uszkodzone dane: traktujemy jak backtest). */
  wSesji?: boolean;
  typKonta: "live" | "demo" | "prop" | "paper";
};

export function zrodloDanych(w: WejscieZrodlaDanych): ZrodloDanych {
  if (w.rodzajSesji !== null) return w.rodzajSesji;
  if (w.wSesji === true) return "backtest";
  if (w.typKonta === "demo" || w.typKonta === "paper") return "demo";
  return "live";
}

export type KolumnyZrodlaDanych = {
  /** `trades.backtest_session_id` */
  backtestSessionId: SQLWrapper;
  /** `backtest_sessions.kind` (z LEFT JOIN) */
  rodzajSesji: SQLWrapper;
  /** `accounts.type` (typ enum rzutowany na text przez ::text) */
  typKonta: SQLWrapper;
};

/** Odpowiednik `zrodloDanych` jako wyrazenie SQL zwracajace text. */
export function sqlZrodloDanych(k: KolumnyZrodlaDanych): SQL {
  return sql`(case
    when ${k.backtestSessionId} is not null then coalesce(${k.rodzajSesji}::text, 'backtest')
    when ${k.typKonta}::text in ('demo', 'paper') then 'demo'
    else 'live'
  end)`;
}
