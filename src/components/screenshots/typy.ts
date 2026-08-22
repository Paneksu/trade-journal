/** Zrzut w takiej postaci, jakiej potrzebuje widok - bez pol, ktorych nie rysujemy. */
export type Shot = {
  id: number;
  file: string;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
};

/**
 * Wlasciciel wgrywanych zrzutow. Trade w trakcie edycji ma juz identyfikator,
 * dzien dziennika bywa zakladany dopiero przy pierwszym zrzucie - stad dwa
 * ksztalty zamiast jednego id.
 */
export type CelZrzutow =
  | { typ: "trade"; tradeId: number }
  | { typ: "dzien"; day: string; accountId: number | null; backtestSessionId?: number | null };
