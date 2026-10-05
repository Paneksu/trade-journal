import { and, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

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
import { czyKategoria, type Kategoria } from "@/lib/domain/kategorie";
import { czyStatus } from "@/lib/domain/status";
import type { Werdykt } from "@/lib/domain/zgodnosc";

/** Wyniki oceny zgodnosci trade'a z regulami (ADR-028), liczone z `trade_rule_checks`. */
export const ZGODNOSCI_TRADU = ["zgodne", "niezgodne", "nieocenione"] as const;
export type ZgodnoscTradu = (typeof ZGODNOSCI_TRADU)[number];
const WERDYKTY: readonly Werdykt[] = ["pass", "fail", "na", "unclear"];

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
  /**
   * "live" = dziennik realny, "backtest" = sesje rodzaju backtest, "forward" =
   * sesje rodzaju forward (ADR-027), "sessions" = trady z DOWOLNEJ sesji (backtest
   * i forward razem, bez dziennika realnego), "all" = wszystko. Konkretna sesja
   * (`backtestSession`) bije rodzaj.
   */
  source: "live" | "backtest" | "forward" | "sessions" | "all";
  /** Kategoria konta (ADR-027): realne, prop_eval, prop_funded, demo. Pusta lista = bez filtru. */
  categories: Kategoria[];
  /** Zgodnosc trade'a z regulami wg oceny AI (ADR-028). */
  compliance: ZgodnoscTradu | null;
  /**
   * Podstawa oceny AI, wg ktorej liczy sie zgodnosc (ADR-028): `chart`, `history`
   * albo `null` = obie (rozstrzyganie jak w zestawieniu). Panel zgodnosci niesie
   * ja w linkach, zeby lista pokazywala te same trady, co liczby w panelu.
   */
  basis: "chart" | "history" | null;
  /** Id reguly z mozgu (np. "R-007") - trady, w ktorych ocena AI dotyczy tej reguly. */
  rule: string | null;
  /** Werdykt oceny reguly; razem z `rule` zaweza do tej reguly, sam dziala na dowolnej. */
  ruleVerdict: Werdykt | null;
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
  categories: [],
  compliance: null,
  basis: null,
  rule: null,
  ruleVerdict: null,
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
  const zgodnosc = one("zgodnosc");
  const regula = one("regula");
  const podstawa = one("podstawa");
  const werdykt = one("werdykt");

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
    source:
      source === "backtest"
        ? "backtest"
        : source === "forward"
          ? "forward"
          : source === "sesje"
            ? "sessions"
            : source === "wszystko"
              ? "all"
              : "live",
    categories: texts(p.kategoria).filter(czyKategoria),
    compliance: (ZGODNOSCI_TRADU as readonly string[]).includes(zgodnosc ?? "")
      ? (zgodnosc as ZgodnoscTradu)
      : null,
    basis: podstawa === "chart" || podstawa === "history" ? podstawa : null,
    // Id reguly trafia do SQL jako parametr, ale i tak wpuszczamy tylko ksztalt,
    // ktory API przyjmuje - smieci z adresu nie maja po co dochodzic do bazy.
    rule: regula && /^[A-Za-z0-9._-]{1,40}$/.test(regula) ? regula : null,
    ruleVerdict: (WERDYKTY as readonly string[]).includes(werdykt ?? "") ? (werdykt as Werdykt) : null,
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
  if (f.source !== "live") p.set("zrodlo", f.source === "all" ? "wszystko" : f.source === "sessions" ? "sesje" : f.source);
  if (f.categories.length) p.set("kategoria", f.categories.join(","));
  put("zgodnosc", f.compliance);
  put("podstawa", f.basis);
  put("regula", f.rule);
  put("werdykt", f.ruleVerdict);
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
  if (f.categories.length) n += 1;
  if (f.compliance) n += 1;
  if (f.rule || f.ruleVerdict) n += 1;
  n += Object.keys(f.fields).length;
  return n;
}

/** Warunki SQL wspolne dla tabeli, statystyk i wykresow. */
export function whereClause(f: Filters, progi: Progi): SQL | undefined {
  const w: (SQL | undefined)[] = [];

  if (f.source === "live") w.push(isNull(trades.backtestSessionId));
  if (f.source === "sessions") {
    // Trady z dowolnej sesji, bez dziennika realnego (ekran /backtest).
    w.push(
      f.backtestSession
        ? eq(trades.backtestSessionId, f.backtestSession)
        : sql`${trades.backtestSessionId} is not null`,
    );
  }
  if (f.source === "backtest" || f.source === "forward") {
    // Konkretna sesja bije rodzaj; bez niej zawezamy do sesji danego rodzaju (ADR-027).
    w.push(
      f.backtestSession
        ? eq(trades.backtestSessionId, f.backtestSession)
        : sql`${trades.backtestSessionId} in (select id from backtest_sessions where kind = ${f.source})`,
    );
  }

  if (f.categories.length) {
    // Kategoria wynika z konta (ADR-027); prop bez fazy nie wpada do zadnej.
    const warunkiKont = f.categories.map((k) =>
      k === "realne"
        ? sql`a.type::text = 'live'`
        : k === "demo"
          ? sql`a.type::text in ('demo', 'paper')`
          : k === "prop_eval"
            ? sql`(a.type::text = 'prop' and a.prop_phase = 'eval')`
            : sql`(a.type::text = 'prop' and a.prop_phase = 'funded')`,
    );
    w.push(
      sql`${trades.accountId} in (select a.id from accounts a where ${sql.join(warunkiKont, sql` or `)})`,
    );
  }

  // Zgodnosc z regulami (ADR-028). W mianowniku tylko pass/fail - na i unclear
  // nie sa ani zgodnoscia, ani zlamaniem (patrz domain/zgodnosc.ts).
  // Kazda regula liczy sie RAZ na trade, tym samym rozstrzygnieciem co w
  // zestawieniu (queries/oceny.ts): wygrywa ocena, ktora cos rozstrzygnela,
  // a przy remisie ta z wykresu (nie znala wyniku). Bez tego lista i
  // zestawienie obok niej pokazywalyby rozne trady jako niezgodne.
  const sprawdzenie = (warunek: SQL) =>
    sql`exists (select 1 from (
      select distinct on (c0.rule_id) c0.rule_id, c0.verdict
      from trade_rule_checks c0 join trade_reviews r on r.id = c0.review_id
      where r.trade_id = ${trades.id}${f.basis ? sql` and r.basis = ${f.basis}` : sql``}
      order by c0.rule_id, (c0.verdict in ('pass', 'fail')) desc, (r.basis = 'chart') desc
    ) c where ${warunek})`;
  if (f.compliance === "niezgodne") w.push(sprawdzenie(sql`c.verdict = 'fail'`));
  if (f.compliance === "zgodne") {
    w.push(sprawdzenie(sql`c.verdict = 'pass'`));
    w.push(sql`not ${sprawdzenie(sql`c.verdict = 'fail'`)}`);
  }
  if (f.compliance === "nieocenione") w.push(sql`not ${sprawdzenie(sql`c.verdict in ('pass', 'fail')`)}`);
  if (f.rule || f.ruleVerdict) {
    const czesci: SQL[] = [];
    if (f.rule) czesci.push(sql`c.rule_id = ${f.rule}`);
    if (f.ruleVerdict) czesci.push(sql`c.verdict = ${f.ruleVerdict}`);
    w.push(sprawdzenie(sql.join(czesci, sql` and `)));
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
    /* Pozycja czesciowo zamknieta ma juz niepuste `pnl` (zysk zrealizowany),
       ale jej wynik NIE jest rozstrzygniety - status zostaje "open". Bez tego
       warunku wchodzilaby na liste pod ?wynik=zysk, podczas gdy KPI nad ta
       sama lista licza sie z `closedOnly`, wiec lista i licznik pokazywalyby
       dwa rozne zbiory. */
    w.push(sql`${trades.status}::text in ('closed', 'missed')`);
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
