/**
 * Grupowanie trade'ow po dowolnym wymiarze i liczenie statystyk kazdej grupy.
 *
 * Wymiar zwraca liste wartosci, a nie jedna wartosc: trade z trzema tagami
 * ma trafic do trzech grup naraz. Suma tradeow w grupach bywa wtedy wieksza
 * niz liczba tradeow - to celowe i tak sie te tabele czyta.
 */

import { computeStats, type Stats } from "./stats";
import { SESSION_NAMES, WEEKDAY_NAMES, type TradeForAnalysis } from "./types";

export type Dimension = {
  key: string;
  label: string;
  /** Wartosci, do ktorych nalezy trade. Pusta lista = brak przypisania. */
  values: (t: TradeForAnalysis) => string[];
  /**
   * Wymiar wyliczony z wyniku trade'a (np. przedzial R). W tabelach jest
   * przydatny, ale Edge Finder musi go pomijac - inaczej "znajduje", ze
   * trade'y z przedzialu +2R do +3R maja sto procent skutecznosci.
   */
  outcomeDerived?: boolean;
};

export type Group = {
  key: string;
  label: string;
  stats: Stats;
  trades: TradeForAnalysis[];
};

const UNASSIGNED = "";

export function durationBucket(seconds: number | null): string {
  if (seconds === null) return "nieznany";
  if (seconds < 60) return "do 1 min";
  if (seconds < 300) return "1-5 min";
  if (seconds < 900) return "5-15 min";
  if (seconds < 3_600) return "15-60 min";
  return "ponad 1 h";
}

export function sizeBucket(contracts: number): string {
  const n = Math.abs(contracts);
  if (n <= 1) return "1 kontrakt";
  if (n <= 2) return "2 kontrakty";
  if (n <= 4) return "3-4 kontrakty";
  if (n <= 9) return "5-9 kontraktów";
  return "10+ kontraktów";
}

export function rBucket(r: number | null): string {
  if (r === null) return "bez R";
  if (r <= -2) return "poniżej -2R";
  if (r <= -1) return "-2R do -1R";
  if (r < 0) return "-1R do 0";
  if (r < 1) return "0 do 1R";
  if (r < 2) return "1R do 2R";
  if (r < 3) return "2R do 3R";
  return "3R i wyżej";
}

function asText(w: unknown): string[] {
  if (w === null || w === undefined || w === "") return [];
  if (Array.isArray(w)) return w.flatMap(asText);
  if (typeof w === "boolean") return [w ? "tak" : "nie"];
  return [String(w)];
}

const BUILTIN: Record<string, Omit<Dimension, "key">> = {
  instrument: { label: "Instrument", values: (t) => [t.instrumentSymbol] },
  account: { label: "Konto", values: (t) => [t.accountName] },
  strategy: { label: "Strategia", values: (t) => asText(t.strategyName) },
  direction: { label: "Kierunek", values: (t) => [t.direction] },
  session: {
    label: "Sesja rynkowa",
    values: (t) => (t.marketSession ? [SESSION_NAMES[t.marketSession]] : []),
  },
  weekday: {
    label: "Dzień tygodnia",
    values: (t) => (t.weekday === null ? [] : [WEEKDAY_NAMES[t.weekday]]),
  },
  hour: {
    label: "Godzina wejścia",
    values: (t) => (t.entryHour === null ? [] : [`${String(t.entryHour).padStart(2, "0")}:00`]),
  },
  duration: { label: "Czas trzymania", values: (t) => [durationBucket(t.durationS)] },
  size: { label: "Wielkość pozycji", values: (t) => [sizeBucket(t.contracts)] },
  month: { label: "Miesiąc", values: (t) => [t.tradingDay.slice(0, 7)] },
  rating: {
    label: "Ocena wykonania",
    values: (t) => (t.executionRating === null ? [] : [`${t.executionRating}/5`]),
  },
  rules: {
    label: "Zgodność z zasadami",
    values: (t) => {
      if (!t.hasRules) return [];
      return [t.rulesMet >= t.ruleCount ? "wszystkie zasady" : "zasady złamane"];
    },
  },
  stop: { label: "Stop loss", values: (t) => [t.hasStop ? "ze stopem" : "bez stopa"] },
  rrange: { label: "Przedział R", values: (t) => [rBucket(t.rMultiple)], outcomeDerived: true },
};

/**
 * Buduje wymiar po kluczu. Obsluguje trzy rodziny:
 * "instrument" (wbudowane), "tag:<kategoria>" i "field:<klucz>".
 */
export function dimension(key: string): Dimension {
  if (key.startsWith("tag:")) {
    const category = key.slice(4);
    return {
      key,
      label: category,
      values: (t) => t.tags.filter((tag) => tag.categoryKey === category).map((tag) => tag.name),
    };
  }
  if (key.startsWith("field:")) {
    const field = key.slice(6);
    return { key, label: field, values: (t) => asText(t.custom?.[field]) };
  }
  const d = BUILTIN[key];
  if (!d) return { key, label: key, values: () => [] };
  return { key, ...d };
}

export function builtinDimensions(): Dimension[] {
  return Object.keys(BUILTIN).map(dimension);
}

type FieldDescription = {
  key: string;
  label: string;
  type: string;
  inStats: boolean;
};

/** Pola tekstowe i notatki nie nadaja sie do grupowania - kazda wartosc bylaby osobna grupa. */
const GROUPABLE_TYPES = new Set(["select", "multiselect", "bool", "rating"]);

export function dimensionsForFields(fields: FieldDescription[]): Dimension[] {
  return fields
    .filter((p) => p.inStats && GROUPABLE_TYPES.has(p.type))
    .map((p) => ({
      key: `field:${p.key}`,
      label: p.label,
      values: (t: TradeForAnalysis) => asText(t.custom?.[p.key]),
    }));
}

export function dimensionsForTags(categories: { key: string; name: string }[]): Dimension[] {
  return categories.map((k) => ({
    key: `tag:${k.key}`,
    label: k.name,
    values: (t: TradeForAnalysis) =>
      t.tags.filter((tag) => tag.categoryKey === k.key).map((tag) => tag.name),
  }));
}

export function groupBy(
  trades: TradeForAnalysis[],
  dim: Dimension,
  options: { emptyLabel?: string } = {},
): Group[] {
  const emptyLabel = options.emptyLabel ?? defaultEmptyLabel(dim);
  const buckets = new Map<string, TradeForAnalysis[]>();

  for (const t of trades) {
    const values = dim.values(t);
    const keys = values.length > 0 ? values : [UNASSIGNED];
    for (const k of keys) {
      const list = buckets.get(k);
      if (list) list.push(t);
      else buckets.set(k, [t]);
    }
  }

  return [...buckets.entries()]
    .map(([key, list]) => ({
      key,
      label: key === UNASSIGNED ? emptyLabel : key,
      stats: computeStats(list),
      trades: list,
    }))
    .sort((a, b) => b.stats.pnlNet - a.stats.pnlNet);
}

function defaultEmptyLabel(dim: Dimension): string {
  if (dim.key === "strategy") return "bez strategii";
  if (dim.key.startsWith("tag:")) return "bez tagu";
  if (dim.key.startsWith("field:")) return "nie wypełnione";
  return "brak danych";
}
