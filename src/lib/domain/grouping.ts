/**
 * Grupowanie trade'ow po dowolnym wymiarze i liczenie statystyk kazdej grupy.
 *
 * Wymiar zwraca liste wartosci, a nie jedna wartosc: trade z trzema tagami
 * ma trafic do trzech grup naraz. Suma tradeow w grupach bywa wtedy wieksza
 * niz liczba tradeow - to celowe i tak sie te tabele czyta.
 */

import { czyInterwal, porzadekInterwalu, warstwaLub, WARSTWY, type Warstwa } from "./interwaly";
import { POWOD_NAZWY, WARIANT_KIERUNKU_NAZWY } from "./kierunek";
import type { Progi } from "./outcome";
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
  /**
   * Wlasny porzadek wierszy - np. skala czasu ma sens chronologiczny
   * (30s przed 1m przed 1h), nie sortowanie po wyniku. Gdy brak, `groupBy`
   * sortuje malejaco po `stats.pnl` jak dotychczas.
   */
  sortValues?: (a: string, b: string) => number;
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

/**
 * Kubelki gotowosci. Skala 1-10 rozbita na dziesiec grup dalaby probki po
 * jednym trade'cie i nic by nie przeszlo progu `minSample` - cztery przedzialy
 * to kompromis miedzy rozdzielczoscia a tym, zeby liczby cokolwiek znaczyly.
 */
export const GOTOWOSC_KUBELKI = [
  "1-3 słaba",
  "4-6 przeciętna",
  "7-8 dobra",
  "9-10 szczyt",
] as const;

export function readinessBucket(poziom: number): string {
  if (poziom <= 3) return GOTOWOSC_KUBELKI[0];
  if (poziom <= 6) return GOTOWOSC_KUBELKI[1];
  if (poziom <= 8) return GOTOWOSC_KUBELKI[2];
  return GOTOWOSC_KUBELKI[3];
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
  /* Wymiary "Strategia", "Ocena wykonania" i "Zgodność z zasadami" zniknely
     2026-08-29 razem z polami w formularzu. Kolumny w bazie zostaly, ale nowe
     trade'y ich nie wypelniaja, wiec kazdy z tych wymiarow zsuwalby cala
     historie do jednej grupy "brak danych" i udawal, ze cos mierzy.
     W ich miejsce wchodzi gotowosc - jedyna z tych rzeczy, ktora uzytkownik
     wpisuje PRZED wejsciem, wiec jedyna, ktora wolno zestawiac z wynikiem. */
  readiness: {
    label: "Gotowość",
    values: (t) => (t.readiness === null ? [] : [readinessBucket(t.readiness)]),
    sortValues: (a, b) => indeksGotowosci(a) - indeksGotowosci(b),
  },
  stop: { label: "Stop loss", values: (t) => [t.hasStop ? "ze stopem" : "bez stopa"] },
  rrange: { label: "Przedział R", values: (t) => [rBucket(t.rMultiple)], outcomeDerived: true },
  wynik: { label: "Wynik", values: (t) => [t.wynik], outcomeDerived: true },
  /* Interwal siedzi na przypisaniu tagu, nie na trade'cie wprost (ADR-013) -
     trade z tagami na dwoch interwalach nalezy do obu grup, tak jak przy
     kazdym innym wymiarze tagowym w tym module. To NIE jest outcomeDerived:
     interwal jest wybierany przez uzytkownika przy tagowaniu, nie wyliczony
     z wyniku trade'a. */
  interval: {
    label: "Interwał",
    values: (t) => [...new Set(t.tags.map((tag) => tag.interval).filter((w): w is string => w !== null))],
    sortValues: (a, b) => indeksInterwalu(a) - indeksInterwalu(b),
  },
  /* Warstwa wyprowadzona z interwalu przypisania (ADR-017), nie z osobnej
     kategorii tagow. Trade z konfluencjami na 4h i na 5m nalezy do obu warstw -
     tak jak przy kazdym innym wymiarze tagowym w tym module. */
  tfLayer: {
    label: "Warstwa TF",
    values: (t) => [
      ...new Set(t.tags.map((tag) => warstwaLub(tag.interval)).filter((w): w is Warstwa => w !== null)),
    ],
    sortValues: (a, b) => indeksWarstwy(a) - indeksWarstwy(b),
  },
  /* Konfluencje rozbite na warstwy. Wartoscia jest SAMA NAZWA tagu, nie
     "FVG · 4h" - inaczej kazdy interwal tworzylby wlasny kubelek, probki
     rozsypalyby sie na okruchy i nic nie przeszloby progu minSample.
     Rozdzielenie na dwa wymiary jest tu calym sensem: Edge Finder porownuje
     PARY wymiarow, wiec sam znajduje kombinacje "konfluencja HTF x LTF",
     bez zadnej zmiany w edge-finder.ts. */
  conf_htf: {
    label: "Konfluencja HTF",
    values: (t) => konfluencjeWarstwy(t, "HTF"),
  },
  conf_ltf: {
    label: "Konfluencja LTF",
    values: (t) => konfluencjeWarstwy(t, "LTF"),
  },
  /* Ponizsze dwa MUSZA byc outcomeDerived. Powod zlej egzekucji istnieje
     wylacznie przy trade'ach nie-wygranych, wiec Edge Finder "odkrylby", ze
     kontekst "powod = niepotrzebny stop" ma oczekiwana wartosc ponizej zera -
     z definicji, a nie z obserwacji. Ta sama pulapka co przy `rrange`. */
  badreason: {
    label: "Powód złej egzekucji",
    values: (t) => (t.badExecutionReason === null ? [] : [POWOD_NAZWY[t.badExecutionReason]]),
    outcomeDerived: true,
  },
  directionHit: {
    label: "Trafność kierunku",
    values: (t) =>
      t.kierunekTrafiony === null
        ? []
        : [WARIANT_KIERUNKU_NAZWY[t.kierunekTrafiony ? "tak" : "nie"]],
    outcomeDerived: true,
  },
};

function konfluencjeWarstwy(t: TradeForAnalysis, warstwa: Warstwa): string[] {
  return [
    ...new Set(
      t.tags
        .filter((tag) => tag.categoryKey === "confluence" && warstwaLub(tag.interval) === warstwa)
        .map((tag) => tag.name),
    ),
  ];
}

/** Pozycja kubelka gotowosci; nieznana wartosc leci na koniec. */
function indeksGotowosci(w: string): number {
  const i = (GOTOWOSC_KUBELKI as readonly string[]).indexOf(w);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

function indeksWarstwy(w: string): number {
  const i = (WARSTWY as readonly string[]).indexOf(w);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

/** Pozycja interwalu w kolejnosci wyswietlania; nieznana wartosc leci na koniec. */
function indeksInterwalu(w: string): number {
  return czyInterwal(w) ? porzadekInterwalu(w) : Number.POSITIVE_INFINITY;
}

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
      // `new Set` takze tutaj, blizej zrodla - `groupBy` i `bucketize` juz
      // deduplikuja, ale wymiar bywa czytany bezposrednio (ADR-017).
      values: (t) => [
        ...new Set(t.tags.filter((tag) => tag.categoryKey === category).map((tag) => tag.name)),
      ],
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
    values: (t: TradeForAnalysis) => [
      ...new Set(t.tags.filter((tag) => tag.categoryKey === k.key).map((tag) => tag.name)),
    ],
  }));
}

export function groupBy(
  trades: TradeForAnalysis[],
  dim: Dimension,
  options: { progi: Progi; emptyLabel?: string },
): Group[] {
  const emptyLabel = options.emptyLabel ?? defaultEmptyLabel(dim);
  const buckets = new Map<string, TradeForAnalysis[]>();

  for (const t of trades) {
    const values = dim.values(t);
    const keys = values.length > 0 ? values : [UNASSIGNED];
    // Deduplikacja na poziomie mechanizmu, nie w kazdym wymiarze z osobna
    // (ADR-017). Ten sam tag moze wisiec na trade'cie kilka razy - raz na
    // kazdym interwale - wiec wymiar "tag:confluence" zwroci ["FVG","FVG"].
    // Bez `new Set` ten trade wpadlby dwa razy do TEJ SAMEJ grupy i zawyzyl
    // count, pnl, sumR oraz skutecznosc. Bledu nikt by nie zglosil: liczby
    // wygladaja wiarygodnie, tylko sa nieprawdziwe.
    for (const k of new Set(keys)) {
      const list = buckets.get(k);
      if (list) list.push(t);
      else buckets.set(k, [t]);
    }
  }

  const groups = [...buckets.entries()].map(([key, list]) => ({
    key,
    label: key === UNASSIGNED ? emptyLabel : key,
    stats: computeStats(list, options.progi),
    trades: list,
  }));

  if (dim.sortValues) {
    const sortValues = dim.sortValues;
    return groups.sort((a, b) => sortValues(a.key, b.key));
  }
  return groups.sort((a, b) => b.stats.pnl - a.stats.pnl);
}

function defaultEmptyLabel(dim: Dimension): string {
  if (dim.key.startsWith("tag:")) return "bez tagu";
  if (dim.key.startsWith("field:")) return "nie wypełnione";
  return "brak danych";
}
