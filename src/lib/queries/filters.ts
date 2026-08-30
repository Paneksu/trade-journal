import { and, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { trades } from "@/lib/db/schema";
import { czyInterwal, czyWarstwa, interwalyWarstwy, type Warstwa } from "@/lib/domain/interwaly";
import {
  czyPowod,
  czyWariantKierunku,
  sqlKierunek,
  type PowodZlejEgzekucji,
  type WariantKierunku,
} from "@/lib/domain/kierunek";
import { sqlWynik, type Progi, type Wynik } from "@/lib/domain/outcome";
import { czyStatus } from "@/lib/domain/status";

/**
 * Filtry tabeli i statystyk. Jedno miejsce, w ktorym adres URL zamienia sie
 * na warunki SQL - dzieki temu kazdy ekran filtruje tak samo, a zapisany widok
 * to po prostu zapamietane parametry adresu.
 */

export type Filters = {
  from: string | null;
  to: string | null;
  accounts: number[];
  instruments: number[];
  strategies: number[];
  tags: number[];
  /** Interwal przypisania tagu (ADR-013), nie interwal instrumentu. */
  intervals: string[];
  /** Warstwa analizy wyprowadzona z interwalu przypisania (ADR-017). */
  layers: Warstwa[];
  /** Trafnosc kierunku (ADR-018). "nieocenione" to osobny stan, nie brak filtru. */
  directionHit: WariantKierunku | null;
  reasons: PowodZlejEgzekucji[];
  /**
   * Zrzuty: `true` = tylko ze zrzutem, `false` = tylko bez zrzutu, `null` = bez
   * filtru. Trzy stany, nie dwa - inaczej opcja "tylko bez zrzutu" w pasku
   * filtrow nie mialaby jak istniec. Galeria ustawia `true`, gdy parametru
   * nie ma w adresie w ogole; jawne `zezrzutem=wszystko` to zdejmuje.
   */
  withShots: boolean | null;
  /**
   * Trade'y nie wziete ("missed"). `"tylko"` = wylacznie one, `"bez"` = wszystko
   * poza nimi, `null` = bez filtru wszedzie (rozni sie od `withShots`, ktory w
   * galerii dostaje domyslna wartosc - tu domyslne zachowanie jest takie samo
   * na kazdym ekranie: nie wziete pokazuja sie razem z reszta).
   */
  missed: "tylko" | "bez" | null;
  /**
   * Czesciowe wyjscia z pozycji. `"skalowane"` = tylko trade'y z wiecej niz
   * jednym wyjsciem (`exit_count > 1`), `"jedno"` = tylko z dokladnie jednym,
   * `null` = bez filtru. Trzy stany, ten sam wzorzec co `missed`.
   */
  skalowanie: "skalowane" | "jedno" | null;
  direction: "long" | "short" | null;
  status: string | null;
  sessions: string[];
  outcome: Wynik | null;
  search: string | null;
  /** "live" = dziennik realny, "backtest" = symulacje, "all" = oba zbiory */
  source: "live" | "backtest" | "all";
  backtestSession: number | null;
  fields: Record<string, string[]>;
};

export const EMPTY_FILTERS: Filters = {
  from: null,
  to: null,
  accounts: [],
  instruments: [],
  strategies: [],
  tags: [],
  intervals: [],
  layers: [],
  directionHit: null,
  reasons: [],
  withShots: null,
  missed: null,
  skalowanie: null,
  direction: null,
  status: null,
  sessions: [],
  outcome: null,
  search: null,
  source: "live",
  backtestSession: null,
  fields: {},
};

export type SearchParams = Record<string, string | string[] | undefined>;

function numbers(w: string | string[] | undefined): number[] {
  if (!w) return [];
  const list = Array.isArray(w) ? w : w.split(",");
  return list.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

function texts(w: string | string[] | undefined): string[] {
  if (!w) return [];
  const list = Array.isArray(w) ? w : w.split(",");
  return list.map((s) => s.trim()).filter(Boolean);
}

export function parseFilters(p: SearchParams): Filters {
  const fields: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(p)) {
    if (!key.startsWith("pole_")) continue;
    const w = texts(value);
    if (w.length > 0) fields[key.slice(5)] = w;
  }

  const one = (k: string) => {
    const w = p[k];
    const s = Array.isArray(w) ? w[0] : w;
    return s && s !== "" ? s : null;
  };

  const source = one("zrodlo");
  const session = one("sesja");
  const direction = one("kierunek");
  const outcome = one("wynik");
  const directionHit = one("kierunek_ok");
  const zrzuty = one("zezrzutem");
  const pominiete = one("pominiete");
  const skalowanie = one("skalowanie");
  const status = one("status");

  return {
    from: one("od"),
    to: one("do"),
    accounts: numbers(p.konto),
    instruments: numbers(p.instrument),
    strategies: numbers(p.strategia),
    tags: numbers(p.tag),
    intervals: texts(p.interwal).filter(czyInterwal),
    layers: texts(p.warstwa).filter(czyWarstwa),
    directionHit: czyWariantKierunku(directionHit) ? directionHit : null,
    reasons: texts(p.powod).filter(czyPowod),
    withShots: zrzuty === "1" ? true : zrzuty === "0" ? false : null,
    missed: pominiete === "tylko" ? "tylko" : pominiete === "nie" ? "bez" : null,
    skalowanie:
      skalowanie === "skalowane" ? "skalowane" : skalowanie === "jedno" ? "jedno" : null,
    direction: direction === "long" ? "long" : direction === "short" ? "short" : null,
    // Nieznany status w adresie (literowka, stara wartosc z zakladki) trafialby
    // wprost do SQL bez ostrzezenia - `czyStatus` domyka nowo powstaly modul.
    status: czyStatus(status) ? status : null,
    sessions: texts(p.rynek),
    outcome:
      outcome === "zysk" || outcome === "strata" || outcome === "be" ? outcome : null,
    search: one("szukaj"),
    source: source === "backtest" ? "backtest" : source === "wszystko" ? "all" : "live",
    backtestSession: session ? Number(session) : null,
    fields,
  };
}

/** Zamienia filtry z powrotem na parametry adresu - do zapisanych widokow i linkow. */
export function toSearchParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  const put = (k: string, w: string | number | null | undefined) => {
    if (w !== null && w !== undefined && w !== "") p.set(k, String(w));
  };
  put("od", f.from);
  put("do", f.to);
  if (f.accounts.length) p.set("konto", f.accounts.join(","));
  if (f.instruments.length) p.set("instrument", f.instruments.join(","));
  if (f.strategies.length) p.set("strategia", f.strategies.join(","));
  if (f.tags.length) p.set("tag", f.tags.join(","));
  if (f.intervals.length) p.set("interwal", f.intervals.join(","));
  if (f.layers.length) p.set("warstwa", f.layers.join(","));
  put("kierunek_ok", f.directionHit);
  if (f.reasons.length) p.set("powod", f.reasons.join(","));
  if (f.withShots !== null) p.set("zezrzutem", f.withShots ? "1" : "0");
  if (f.missed !== null) p.set("pominiete", f.missed === "tylko" ? "tylko" : "nie");
  if (f.skalowanie !== null) p.set("skalowanie", f.skalowanie);
  put("kierunek", f.direction);
  put("status", f.status);
  if (f.sessions.length) p.set("rynek", f.sessions.join(","));
  if (f.outcome) p.set("wynik", f.outcome);
  put("szukaj", f.search);
  if (f.source !== "live") p.set("zrodlo", f.source === "all" ? "wszystko" : "backtest");
  put("sesja", f.backtestSession);
  for (const [key, values] of Object.entries(f.fields)) {
    if (values.length) p.set(`pole_${key}`, values.join(","));
  }
  return p;
}

export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.from || f.to) n += 1;
  if (f.accounts.length) n += 1;
  if (f.instruments.length) n += 1;
  if (f.strategies.length) n += 1;
  if (f.tags.length) n += 1;
  if (f.intervals.length) n += 1;
  if (f.layers.length) n += 1;
  if (f.directionHit) n += 1;
  if (f.reasons.length) n += 1;
  if (f.withShots !== null) n += 1;
  if (f.missed !== null) n += 1;
  if (f.skalowanie !== null) n += 1;
  if (f.direction) n += 1;
  if (f.status) n += 1;
  if (f.sessions.length) n += 1;
  if (f.outcome) n += 1;
  if (f.search) n += 1;
  n += Object.keys(f.fields).length;
  return n;
}

/** Warunki SQL wspolne dla tabeli, statystyk i wykresow. */
export function whereClause(f: Filters, progi: Progi): SQL | undefined {
  const w: (SQL | undefined)[] = [];

  if (f.source === "live") w.push(isNull(trades.backtestSessionId));
  if (f.source === "backtest") {
    w.push(
      f.backtestSession
        ? eq(trades.backtestSessionId, f.backtestSession)
        : isNotNull(trades.backtestSessionId),
    );
  }

  if (f.from) w.push(gte(trades.tradingDay, f.from));
  if (f.to) w.push(lte(trades.tradingDay, f.to));
  if (f.accounts.length) w.push(inArray(trades.accountId, f.accounts));
  if (f.instruments.length) w.push(inArray(trades.instrumentId, f.instruments));
  if (f.strategies.length) w.push(inArray(trades.strategyId, f.strategies));
  if (f.direction) w.push(eq(trades.direction, f.direction));
  if (f.status) w.push(sql`${trades.status}::text = ${f.status}`);
  if (f.sessions.length) {
    w.push(or(...f.sessions.map((session) => sql`${trades.marketSession}::text = ${session}`)));
  }
  if (f.outcome) {
    w.push(
      sqlWynik(
        { pnl: trades.pnl, riskAmount: trades.riskAmount, contracts: trades.contracts },
        progi,
        f.outcome,
      ),
    );
    // "zysk"/"strata"/"be" opisuja ZREALIZOWANY rezultat - trade nie wziety
    // ("missed") nigdy go nie ma, wiec domyslnie nie wchodzi do zadnej z tych
    // etykiet (inaczej "przegrane" mieszalyby prawdziwe straty z hipotetycznymi
    // wynikami pominietych setupow). Wyjatek: gdy uzytkownik jawnie prosi o same
    // pominiete (`f.missed === "tylko"`), wykluczenie by dawalo zawsze pustke -
    // wtedy filtr wyniku ocenia hipotetyczny wynik samych "missed".
    if (f.missed !== "tylko") w.push(sql`${trades.status}::text <> 'missed'`);
  }

  if (f.search) {
    const pattern = `%${f.search}%`;
    w.push(or(ilike(trades.note, pattern), sql`${trades.custom}::text ILIKE ${pattern}`));
  }

  if (f.tags.length) {
    const ids = sql.join(
      f.tags.map((tagId) => sql`${tagId}`),
      sql`, `,
    );
    w.push(
      sql`EXISTS (SELECT 1 FROM trade_tags tt WHERE tt.trade_id = ${trades.id} AND tt.tag_id IN (${ids}))`,
    );
  }

  if (f.intervals.length) {
    const values = sql.join(
      f.intervals.map((iv) => sql`${iv}`),
      sql`, `,
    );
    w.push(
      sql`EXISTS (SELECT 1 FROM trade_tags tt WHERE tt.trade_id = ${trades.id} AND tt.interval IN (${values}))`,
    );
  }

  if (f.layers.length) {
    // Warstwa to zbior interwalow (ADR-017), wiec ten sam ksztalt co filtr
    // interwalu - jeden EXISTS na przypisaniach tagow.
    const values = sql.join(
      f.layers.flatMap((warstwa) => interwalyWarstwy(warstwa)).map((iv) => sql`${iv}`),
      sql`, `,
    );
    w.push(
      sql`EXISTS (SELECT 1 FROM trade_tags tt WHERE tt.trade_id = ${trades.id} AND tt.interval IN (${values}))`,
    );
  }

  if (f.directionHit) {
    // Przez `sqlKierunek`, zeby prog BE byl liczony jednym wzorem po obu
    // stronach - inaczej filtr i etykieta rozjechalyby sie w tym samym renderze.
    w.push(
      sqlKierunek(
        {
          pnl: trades.pnl,
          riskAmount: trades.riskAmount,
          contracts: trades.contracts,
          directionCorrect: trades.directionCorrect,
        },
        progi,
        f.directionHit,
      ),
    );
    // Trafnosc kierunku ocenia egzekucje, ktora faktycznie sie odbyla - trade
    // nie wziety ("missed") ma tylko wynik hipotetyczny, wiec domyslnie nie
    // wchodzi do miary (ten sam wzorzec co przy filtrze wyniku wyzej).
    // Wyjatek: `f.missed === "tylko"` prosi jawnie o same pominiete.
    if (f.missed !== "tylko") w.push(sql`${trades.status}::text <> 'missed'`);
  }

  if (f.reasons.length) {
    w.push(or(...f.reasons.map((r) => sql`${trades.badExecutionReason}::text = ${r}`)));
  }

  if (f.withShots !== null) {
    const istnieje = sql`EXISTS (SELECT 1 FROM screenshots s WHERE s.trade_id = ${trades.id})`;
    w.push(f.withShots ? istnieje : sql`NOT ${istnieje}`);
  }

  if (f.missed === "tylko") w.push(sql`${trades.status}::text = 'missed'`);
  if (f.missed === "bez") w.push(sql`${trades.status}::text <> 'missed'`);

  // Czesciowe wyjscia z pozycji - to jedyne miejsce, w ktorym adres URL
  // zamienia sie na warunek SQL po `exit_count`.
  if (f.skalowanie === "skalowane") w.push(sql`${trades.exitCount} > 1`);
  if (f.skalowanie === "jedno") w.push(sql`${trades.exitCount} = 1`);

  for (const [key, values] of Object.entries(f.fields)) {
    /* Wartosc pola wlasnego bywa tablica (lista wielokrotnego wyboru),
       tekstem, liczba albo wartoscia logiczna. Operator `?` lapie element
       tablicy i tekst, a `->>` porownuje reszte po rzutowaniu na tekst.
       Warunki budujemy po jednej wartosci, bo drizzle rozklada tablice
       na osobne parametry, a nie na literal tablicowy Postgresa. */
    w.push(
      or(
        ...values.flatMap((value) => [
          sql`${trades.custom} -> ${key} ? ${value}`,
          sql`${trades.custom} ->> ${key} = ${value}`,
        ]),
      ),
    );
  }

  const active = w.filter(Boolean) as SQL[];
  return active.length > 0 ? and(...active) : undefined;
}
