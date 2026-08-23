import type { Direction, MarketSession } from "./calc";
import type { Wynik } from "./outcome";
import type { TradeStat } from "./stats";

/**
 * Trade w postaci gotowej do analizy: wynik finansowy plus wszystkie wymiary,
 * po ktorych wolno grupowac. Warstwa zapytan sklada ten ksztalt raz,
 * a caly modul domeny operuje juz tylko na nim.
 */
export type TradeForAnalysis = TradeStat & {
  /** Zysk/strata/be, policzone raz w `queries/trades.ts` (ADR-011) - komponenty
      czytaja gotowe pole i nie znaja progow. */
  wynik: Wynik;
  direction: Direction;
  accountId: number;
  accountName: string;
  instrumentId: number;
  instrumentSymbol: string;
  strategyId: number | null;
  strategyName: string | null;
  backtestSessionId: number | null;
  marketSession: MarketSession | null;
  weekday: number | null;
  entryHour: number | null;
  executionRating: number | null;
  ruleCount: number;
  rulesMet: number;
  hasRules: boolean;
  hasStop: boolean;
  tags: {
    id: number;
    name: string;
    category: string;
    categoryKey: string;
    color: string;
    /** Interwal tego konkretnego przypisania tagu do trade'a, nie tagu samego (ADR-013). */
    interval: string | null;
  }[];
  custom: Record<string, unknown>;
};

export const WEEKDAY_NAMES = [
  "niedziela",
  "poniedziałek",
  "wtorek",
  "środa",
  "czwartek",
  "piątek",
  "sobota",
] as const;

export const SESSION_NAMES: Record<MarketSession, string> = {
  premarket: "przed sesją",
  rth: "sesja główna",
  afterhours: "po sesji",
  overnight: "noc",
};

export const DIRECTION_NAMES: Record<Direction, string> = {
  long: "long",
  short: "short",
};

export const TRADE_STATUS_NAMES: Record<string, string> = {
  planned: "planowany",
  open: "otwarty",
  closed: "zamknięty",
  cancelled: "anulowany",
};
