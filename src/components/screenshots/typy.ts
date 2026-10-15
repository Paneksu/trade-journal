/** Zrzut w takiej postaci, jakiej potrzebuje widok - bez pol, ktorych nie rysujemy. */
export type Shot = {
  id: number;
  file: string;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  /** Interwal, z jakiego pochodzi ten obraz - ADR-015. Osobny od interwalu tagu. */
  interval: string | null;
  /** UI v2 (zakładka Zrzuty): pochodzenie i czas zrzutu, np. "tradingview · 09:41". Tylko do odczytu. */
  pochodzenie?: string | null;
};

/**
 * Wlasciciel wgrywanych zrzutow. Trade w trakcie edycji ma juz identyfikator,
 * dzien dziennika bywa zakladany dopiero przy pierwszym zrzucie - stad dwa
 * ksztalty zamiast jednego id.
 */
export type CelZrzutow =
  | { typ: "trade"; tradeId: number }
  | { typ: "dzien"; day: string; accountId: number | null; backtestSessionId?: number | null };
