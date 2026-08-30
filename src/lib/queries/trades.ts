import "server-only";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accounts,
  backtestSessions,
  instruments,
  screenshots,
  strategies,
  tagCategories,
  tags,
  tradeExits,
  tradeTags,
  trades,
} from "@/lib/db/schema";
import { computeTrade } from "@/lib/domain/calc";
import { czyInterwal, porzadekInterwalu } from "@/lib/domain/interwaly";
import { czyPowod, kierunekTrafiony } from "@/lib/domain/kierunek";
import { wynikTrade, type Progi } from "@/lib/domain/outcome";
import type { StatusTrade } from "@/lib/domain/status";
import type { TradeForAnalysis } from "@/lib/domain/types";
import { getProgi, instrumentSpec } from "./dictionaries";
import { whereClause, type Filters } from "./filters";

/**
 * Jedno miejsce, w ktorym wiersz bazy zamienia sie w `TradeForAnalysis`.
 * Caly modul domeny widzi juz tylko ten ksztalt.
 */

const columns = {
  id: trades.id,
  accountId: trades.accountId,
  accountName: accounts.name,
  currency: accounts.currency,
  instrumentId: trades.instrumentId,
  instrumentSymbol: instruments.symbol,
  instrumentName: instruments.name,
  tickSize: instruments.tickSize,
  exchangeTimezone: instruments.exchangeTimezone,
  strategyId: trades.strategyId,
  strategyName: strategies.name,
  strategyRules: strategies.rules,
  backtestSessionId: trades.backtestSessionId,
  backtestSessionName: backtestSessions.name,
  direction: trades.direction,
  status: trades.status,
  entryTime: trades.entryTime,
  entryPrice: trades.entryPrice,
  exitTime: trades.exitTime,
  exitPrice: trades.exitPrice,
  contracts: trades.contracts,
  stopLoss: trades.stopLoss,
  takeProfit: trades.takeProfit,
  mae: trades.mae,
  mfe: trades.mfe,
  note: trades.note,
  moodNote: trades.moodNote,
  readiness: trades.readiness,
  executionRating: trades.executionRating,
  rulesMet: trades.rulesMet,
  custom: trades.custom,
  ticks: trades.ticks,
  riskTicks: trades.riskTicks,
  pnl: trades.pnl,
  riskAmount: trades.riskAmount,
  rMultiple: trades.rMultiple,
  maeR: trades.maeR,
  mfeR: trades.mfeR,
  durationS: trades.durationS,
  marketSession: trades.marketSession,
  weekday: trades.weekday,
  entryHour: trades.entryHour,
  tradingDay: trades.tradingDay,
  brokerAmount: trades.brokerAmount,
  directionCorrect: trades.directionCorrect,
  badExecutionReason: trades.badExecutionReason,
  potentialR: trades.potentialR,
  createdAt: trades.createdAt,
  // Wyjscia czesciowe (2026-08-30) - liczniki denormalizowane w trades,
  // patrz komentarz w schema.ts. Same wiersze trade_exits dociaga tylko
  // getTrade - lista i tabela potrzebuja wylacznie tych liczb.
  closedContracts: trades.closedContracts,
  exitCount: trades.exitCount,
  scalingR: trades.scalingR,
};

export type TradeRecord = TradeForAnalysis & {
  status: StatusTrade;
  entryPrice: string;
  exitPrice: string | null;
  exitTime: Date | null;
  stopLoss: string | null;
  takeProfit: string | null;
  mae: string | null;
  mfe: string | null;
  note: string | null;
  currency: string;
  instrumentName: string;
  tickSize: string;
  backtestSessionName: string | null;
  ticks: number | null;
  riskTicks: number | null;
  /** Kwota z rachunku brokera w centach albo null, gdy wynik jest z tickow (ADR-016). */
  brokerAmount: number | null;
  rulesMetIds: string[];
  screenshotCount: number;
  /** Pierwszy zrzut w kolejnosci wyswietlania - kafel galerii. `null`, gdy brak. */
  firstShot: { file: string; width: number | null; height: number | null } | null;
  /** Suma kontraktow zamknietych wyjsciami czastkowymi (trade_exits). */
  closedContracts: number;
  /** Liczba wyjsc czastkowych. */
  exitCount: number;
  /** Wplyw skalowania na wynik w R - patrz komentarz przy kolumnie w schema.ts. */
  scalingR: number | null;
};

/** Jeden kawalek wyjscia z pozycji, z policzonym wynikiem - dolaczany tylko
    przy `getTrade`, nigdy przy liscie (patrz `getTrades`). */
export type TradeExitRecord = {
  id: number;
  sortOrder: number;
  exitTime: Date | null;
  exitPrice: number;
  contracts: number;
  brokerAmount: number | null;
  note: string | null;
  /** Ruch w tickach TEGO kawalka - liczony `computeTrade`, nie wlasnym wzorem. */
  ticks: number | null;
  /** Wynik TEGO kawalka w centach. */
  pnl: number | null;
  /** R TEGO kawalka - liczone wzgledem ryzyka proporcjonalnego do jego wielkosci,
      tak zeby suma R kawalkow wazona ich udzialem w pozycji dala R calego trade'a. */
  rMultiple: number | null;
};

/** `TradeRecord` z lista wyjsc czastkowych - zwraca wylacznie `getTrade`. */
export type TradeDetail = TradeRecord & { exits: TradeExitRecord[] };

type ShotSummary = { count: number; first: TradeRecord["firstShot"] };
const PUSTE_ZRZUTY: ShotSummary = { count: 0, first: null };

function baseQuery() {
  return db
    .select(columns)
    .from(trades)
    .innerJoin(accounts, eq(trades.accountId, accounts.id))
    .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
    .leftJoin(strategies, eq(trades.strategyId, strategies.id))
    .leftJoin(backtestSessions, eq(trades.backtestSessionId, backtestSessions.id));
}

type Row = Awaited<ReturnType<typeof baseQuery>>[number];
type TagRow = TradeForAnalysis["tags"][number];

function build(row: Row, rowTags: TagRow[], zrzuty: ShotSummary, progi: Progi): TradeRecord {
  const met = (row.rulesMet ?? []) as string[];
  const rules = (row.strategyRules ?? []) as { id: string }[];

  const pnl = Number(row.pnl ?? 0);
  const riskAmount = row.riskAmount === null ? null : Number(row.riskAmount);
  const contracts = Number(row.contracts);
  const rMultiple = row.rMultiple === null ? null : Number(row.rMultiple);
  const potentialR = row.potentialR === null ? null : Number(row.potentialR);

  return {
    id: row.id,
    pnl,
    rMultiple,
    riskAmount,
    durationS: row.durationS,
    entryTime: row.entryTime,
    tradingDay: row.tradingDay ?? "",
    contracts,
    maeR: row.maeR === null ? null : Number(row.maeR),
    mfeR: row.mfeR === null ? null : Number(row.mfeR),

    wynik: wynikTrade({ pnl, riskAmount, contracts }, progi),
    directionCorrect: row.directionCorrect,
    kierunekTrafiony: kierunekTrafiony(
      {
        pnl,
        riskAmount,
        contracts,
        rMultiple,
        directionCorrect: row.directionCorrect,
        badExecutionReason: czyPowod(row.badExecutionReason) ? row.badExecutionReason : null,
        potentialR,
      },
      progi,
    ),
    badExecutionReason: czyPowod(row.badExecutionReason) ? row.badExecutionReason : null,
    potentialR,
    direction: row.direction,
    accountId: row.accountId,
    accountName: row.accountName,
    instrumentId: row.instrumentId,
    instrumentSymbol: row.instrumentSymbol,
    exchangeTimezone: row.exchangeTimezone,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    backtestSessionId: row.backtestSessionId,
    marketSession: row.marketSession,
    weekday: row.weekday,
    entryHour: row.entryHour,
    moodNote: row.moodNote,
    readiness: row.readiness,
    executionRating: row.executionRating,
    ruleCount: rules.length,
    rulesMet: met.length,
    hasRules: rules.length > 0,
    hasStop: row.stopLoss !== null,
    tags: rowTags,
    custom: (row.custom ?? {}) as Record<string, unknown>,

    status: row.status,
    entryPrice: row.entryPrice,
    exitPrice: row.exitPrice,
    exitTime: row.exitTime,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    mae: row.mae,
    mfe: row.mfe,
    note: row.note,
    currency: row.currency,
    instrumentName: row.instrumentName,
    tickSize: row.tickSize,
    backtestSessionName: row.backtestSessionName,
    ticks: row.ticks,
    riskTicks: row.riskTicks,
    brokerAmount: row.brokerAmount === null ? null : Number(row.brokerAmount),
    rulesMetIds: met,
    screenshotCount: zrzuty.count,
    firstShot: zrzuty.first,
    closedContracts: Number(row.closedContracts),
    exitCount: row.exitCount,
    scalingR: row.scalingR === null ? null : Number(row.scalingR),
  };
}

/**
 * Tagi wielu trade'ow jednym zapytaniem (bez N+1).
 *
 * KONTRAKT: zwrocona lista MOZE zawierac ten sam `id` tagu wielokrotnie - raz
 * na kazdy interwal, na ktorym ta konfluencja wystapila (ADR-017). Kto renderuje
 * te liste, musi uzyc `assignmentId` jako klucza Reacta; kto po niej grupuje,
 * musi przepuscic wartosci przez `new Set`.
 *
 * Sortowanie konczymy w TypeScripcie, nie w SQL: baza nie zna kolejnosci z
 * `INTERWALY`, a "FVG · 4h, FVG · 5m" ulozone alfabetycznie czyta sie odwrotnie
 * do skali czasu.
 */
async function tagsForTrades(ids: number[]): Promise<Map<number, TagRow[]>> {
  const map = new Map<number, TagRow[]>();
  if (ids.length === 0) return map;

  const rows = await db
    .select({
      tradeId: tradeTags.tradeId,
      assignmentId: tradeTags.id,
      id: tags.id,
      name: tags.name,
      color: tags.color,
      category: tagCategories.name,
      categoryKey: tagCategories.key,
      interval: tradeTags.interval,
      categorySort: tagCategories.sortOrder,
    })
    .from(tradeTags)
    .innerJoin(tags, eq(tradeTags.tagId, tags.id))
    .innerJoin(tagCategories, eq(tags.categoryId, tagCategories.id))
    .where(inArray(tradeTags.tradeId, ids))
    .orderBy(asc(tagCategories.sortOrder), asc(tags.name));

  const porzadek = new Map<number, number>();
  for (const w of rows) {
    const list = map.get(w.tradeId) ?? [];
    list.push({
      assignmentId: w.assignmentId,
      id: w.id,
      name: w.name,
      category: w.category,
      categoryKey: w.categoryKey,
      color: w.color,
      interval: w.interval,
    });
    porzadek.set(w.assignmentId, w.categorySort);
    map.set(w.tradeId, list);
  }

  // Brak interwalu ma zostac PRZED wskazanymi - tag bez skali czasu opisuje
  // caly trade, nie konkretna warstwe.
  const skala = (w: string | null) =>
    w === null ? -1 : czyInterwal(w) ? porzadekInterwalu(w) : Number.POSITIVE_INFINITY;

  for (const [tradeId, list] of map) {
    list.sort(
      (a, b) =>
        (porzadek.get(a.assignmentId) ?? 0) - (porzadek.get(b.assignmentId) ?? 0) ||
        a.name.localeCompare(b.name, "pl") ||
        skala(a.interval) - skala(b.interval),
    );
    map.set(tradeId, list);
  }

  return map;
}

/**
 * Licznik zrzutow i PIERWSZY zrzut kazdego trade'a - jednym zapytaniem.
 *
 * `array_agg(...)[1]` zamiast osobnego `DISTINCT ON`: licznik i tak trzeba
 * policzyc, wiec pierwszy plik dobieramy przy tej samej agregacji, bez drugiego
 * krazenia do bazy. Galeria renderuje dziesiatki kafli i to jest roznica miedzy
 * stala liczba zapytan a N+1.
 *
 * "Pierwszy" znaczy: po `sort_order`, a przy remisie po `id` - czyli ten sam
 * porzadek, ktory widac w karcie trade'a. Pojecia "zdjecia glownego" nie ma
 * i nie wprowadzamy go tylnymi drzwiami (ADR-009).
 */
async function screenshotSummary(ids: number[]): Promise<Map<number, ShotSummary>> {
  const map = new Map<number, ShotSummary>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      tradeId: screenshots.tradeId,
      count: sql<number>`count(*)::int`,
      file: sql<string | null>`(array_agg(coalesce(${screenshots.thumbnail}, ${screenshots.file}) order by ${screenshots.sortOrder}, ${screenshots.id}))[1]`,
      width: sql<number | null>`(array_agg(${screenshots.width} order by ${screenshots.sortOrder}, ${screenshots.id}))[1]`,
      height: sql<number | null>`(array_agg(${screenshots.height} order by ${screenshots.sortOrder}, ${screenshots.id}))[1]`,
    })
    .from(screenshots)
    .where(inArray(screenshots.tradeId, ids))
    .groupBy(screenshots.tradeId);

  // Zrzut dnia ma `tradeId` puste - `inArray` go nie zwroci, ale typ na to pozwala.
  for (const w of rows) {
    if (w.tradeId === null) continue;
    map.set(w.tradeId, {
      count: w.count,
      first: w.file === null ? null : { file: w.file, width: w.width, height: w.height },
    });
  }
  return map;
}

export type Opcje = { limit?: number; offset?: number };

export async function getTrades(f: Filters, opcje: Opcje = {}): Promise<TradeRecord[]> {
  // Progi pobrane raz, przed budowa zapytania: ten sam prog musi filtrowac
  // (whereClause) i etykietowac wiersze (build) - inaczej filtr `wynik=be`
  // i kolumna "Wynik" moglyby sobie przeczyc w tym samym renderze.
  const progi = await getProgi();
  let query = baseQuery()
    .where(whereClause(f, progi))
    .orderBy(desc(trades.entryTime), desc(trades.id))
    .$dynamic();
  if (opcje.limit !== undefined) query = query.limit(opcje.limit);
  if (opcje.offset) query = query.offset(opcje.offset);
  const rows = await query;

  const ids = rows.map((r) => r.id);
  const [tagMap, shotMap] = await Promise.all([tagsForTrades(ids), screenshotSummary(ids)]);

  return rows.map((r) => build(r, tagMap.get(r.id) ?? [], shotMap.get(r.id) ?? PUSTE_ZRZUTY, progi));
}

/** Ile trade'ow pasuje do filtru - do paginacji galerii, bez pobierania wierszy. */
export async function countTrades(f: Filters): Promise<number> {
  const progi = await getProgi();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trades)
    .where(whereClause(f, progi));
  return row?.n ?? 0;
}

/**
 * Tylko zamkniete trade'y - podstawa wszystkich statystyk. Doslownie
 * `=== "closed"`, celowo NIE `maWynik` (domain/status.ts): "missed" ma
 * policzalny wynik, ale ma nie liczyc sie do statystyk (sekcja "Pominiete"
 * na /stats liczy je osobno). To jest cala bariera - pulpit, /stats,
 * /trades, kalendarz i ekrany backtestu przechodza przez ten filtr.
 */
export function closedOnly(list: TradeRecord[]): TradeRecord[] {
  return list.filter((t) => t.status === "closed");
}

/**
 * Wyjscia czastkowe jednego trade'a, posortowane `sort_order, id` (wzorzec
 * ze `screenshots`), kazde z policzonym wynikiem TEGO kawalka. Liczymy przez
 * `computeTrade` z kontraktami zawezonymi do wielkosci kawalka - dzieki temu
 * ryzyko (a wiec i R) skaluje sie proporcjonalnie, bez wlasnego wzoru obok
 * modulu domeny (patrz komentarz przy `TradeExitRecord`).
 */
async function exitsForTrade(row: Row): Promise<TradeExitRecord[]> {
  const wiersze = await db
    .select()
    .from(tradeExits)
    .where(eq(tradeExits.tradeId, row.id))
    .orderBy(asc(tradeExits.sortOrder), asc(tradeExits.id));
  if (wiersze.length === 0) return [];

  const [instrument] = await db
    .select()
    .from(instruments)
    .where(eq(instruments.id, row.instrumentId))
    .limit(1);
  if (!instrument) return [];

  const spec = instrumentSpec(instrument);
  const stopLoss = row.stopLoss === null ? null : Number(row.stopLoss);
  const entryPrice = Number(row.entryPrice);

  return wiersze.map((w) => {
    const contracts = Number(w.contracts);
    const exitPrice = Number(w.exitPrice);
    const wynik = computeTrade({
      instrument: spec,
      direction: row.direction,
      contracts,
      entryPrice,
      exits: [{ price: exitPrice, contracts, time: w.exitTime, brokerAmount: w.brokerAmount }],
      stopLoss,
      takeProfit: null,
      mae: null,
      mfe: null,
      entryTime: row.entryTime,
    });
    return {
      id: w.id,
      sortOrder: w.sortOrder,
      exitTime: w.exitTime,
      exitPrice,
      contracts,
      brokerAmount: w.brokerAmount,
      note: w.note,
      ticks: wynik.ticks,
      pnl: wynik.pnl,
      rMultiple: wynik.rMultiple,
    };
  });
}

export async function getTrade(id: number): Promise<TradeDetail | null> {
  const rows = await baseQuery().where(eq(trades.id, id)).limit(1);
  if (rows.length === 0) return null;
  const [tagMap, shotMap, progi, exits] = await Promise.all([
    tagsForTrades([id]),
    screenshotSummary([id]),
    getProgi(),
    exitsForTrade(rows[0]),
  ]);
  return { ...build(rows[0], tagMap.get(id) ?? [], shotMap.get(id) ?? PUSTE_ZRZUTY, progi), exits };
}

export async function getScreenshots(tradeId: number) {
  return db
    .select()
    .from(screenshots)
    .where(eq(screenshots.tradeId, tradeId))
    .orderBy(asc(screenshots.sortOrder), asc(screenshots.id));
}

/** Ostatnio uzyte wartosci - do podpowiedzi w formularzu nowego trade'a. */
export async function lastUsed(): Promise<{
  accountId: number | null;
  instrumentId: number | null;
  strategyId: number | null;
  contracts: string | null;
}> {
  const [w] = await db
    .select({
      accountId: trades.accountId,
      instrumentId: trades.instrumentId,
      strategyId: trades.strategyId,
      contracts: trades.contracts,
    })
    .from(trades)
    .orderBy(desc(trades.createdAt))
    .limit(1);
  return w ?? { accountId: null, instrumentId: null, strategyId: null, contracts: null };
}

/** Liczba trade'ow w kazdej sesji backtestu - do listy sesji. */
export async function tradeCountsBySession(): Promise<Map<number, number>> {
  const rows = await db
    .select({ sessionId: trades.backtestSessionId, count: sql<number>`count(*)::int` })
    .from(trades)
    /* Nie wzieta pozycja nie jest wykonanym trade'em backtestu - licznik
       sesji ma nie zawyzac sie o setupy, ktorych nikt nie wzial. */
    .where(sql`${trades.status}::text <> 'missed'`)
    .groupBy(trades.backtestSessionId);
  const map = new Map<number, number>();
  for (const w of rows) if (w.sessionId !== null) map.set(w.sessionId, w.count);
  return map;
}
