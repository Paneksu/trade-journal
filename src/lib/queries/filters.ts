import { and, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { trades } from "@/lib/db/schema";

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
  direction: "long" | "short" | null;
  status: string | null;
  sessions: string[];
  outcome: "win" | "loss" | null;
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

  return {
    from: one("od"),
    to: one("do"),
    accounts: numbers(p.konto),
    instruments: numbers(p.instrument),
    strategies: numbers(p.strategia),
    tags: numbers(p.tag),
    direction: direction === "long" ? "long" : direction === "short" ? "short" : null,
    status: one("status"),
    sessions: texts(p.rynek),
    outcome: outcome === "zysk" ? "win" : outcome === "strata" ? "loss" : null,
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
  put("kierunek", f.direction);
  put("status", f.status);
  if (f.sessions.length) p.set("rynek", f.sessions.join(","));
  if (f.outcome) p.set("wynik", f.outcome === "win" ? "zysk" : "strata");
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
  if (f.direction) n += 1;
  if (f.status) n += 1;
  if (f.sessions.length) n += 1;
  if (f.outcome) n += 1;
  if (f.search) n += 1;
  n += Object.keys(f.fields).length;
  return n;
}

/** Warunki SQL wspolne dla tabeli, statystyk i wykresow. */
export function whereClause(f: Filters): SQL | undefined {
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
  if (f.outcome === "win") w.push(sql`${trades.pnlNet} > 0`);
  if (f.outcome === "loss") w.push(sql`${trades.pnlNet} < 0`);

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
