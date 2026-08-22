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
  tradeTags,
  trades,
} from "@/lib/db/schema";
import type { TradeForAnalysis } from "@/lib/domain/types";
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
  commission: trades.commission,
  note: trades.note,
  executionRating: trades.executionRating,
  rulesMet: trades.rulesMet,
  custom: trades.custom,
  ticks: trades.ticks,
  riskTicks: trades.riskTicks,
  pnlGross: trades.pnlGross,
  pnlNet: trades.pnlNet,
  riskAmount: trades.riskAmount,
  rMultiple: trades.rMultiple,
  maeR: trades.maeR,
  mfeR: trades.mfeR,
  durationS: trades.durationS,
  marketSession: trades.marketSession,
  weekday: trades.weekday,
  entryHour: trades.entryHour,
  tradingDay: trades.tradingDay,
  createdAt: trades.createdAt,
};

export type TradeRecord = TradeForAnalysis & {
  status: string;
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
  rulesMetIds: string[];
  screenshotCount: number;
};

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

function build(row: Row, rowTags: TagRow[], screenshotCount: number): TradeRecord {
  const met = (row.rulesMet ?? []) as string[];
  const rules = (row.strategyRules ?? []) as { id: string }[];

  return {
    id: row.id,
    pnlNet: Number(row.pnlNet ?? 0),
    pnlGross: Number(row.pnlGross ?? 0),
    commission: Number(row.commission ?? 0),
    rMultiple: row.rMultiple === null ? null : Number(row.rMultiple),
    riskAmount: row.riskAmount === null ? null : Number(row.riskAmount),
    durationS: row.durationS,
    entryTime: row.entryTime,
    tradingDay: row.tradingDay ?? "",
    contracts: Number(row.contracts),
    maeR: row.maeR === null ? null : Number(row.maeR),
    mfeR: row.mfeR === null ? null : Number(row.mfeR),

    direction: row.direction,
    accountId: row.accountId,
    accountName: row.accountName,
    instrumentId: row.instrumentId,
    instrumentSymbol: row.instrumentSymbol,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    backtestSessionId: row.backtestSessionId,
    marketSession: row.marketSession,
    weekday: row.weekday,
    entryHour: row.entryHour,
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
    rulesMetIds: met,
    screenshotCount,
  };
}

async function tagsForTrades(ids: number[]): Promise<Map<number, TagRow[]>> {
  const map = new Map<number, TagRow[]>();
  if (ids.length === 0) return map;

  const rows = await db
    .select({
      tradeId: tradeTags.tradeId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
      category: tagCategories.name,
      categoryKey: tagCategories.key,
    })
    .from(tradeTags)
    .innerJoin(tags, eq(tradeTags.tagId, tags.id))
    .innerJoin(tagCategories, eq(tags.categoryId, tagCategories.id))
    .where(inArray(tradeTags.tradeId, ids))
    .orderBy(asc(tagCategories.sortOrder), asc(tags.name));

  for (const w of rows) {
    const list = map.get(w.tradeId) ?? [];
    list.push({
      id: w.id,
      name: w.name,
      category: w.category,
      categoryKey: w.categoryKey,
      color: w.color,
    });
    map.set(w.tradeId, list);
  }
  return map;
}

async function screenshotCounts(ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ tradeId: screenshots.tradeId, count: sql<number>`count(*)::int` })
    .from(screenshots)
    .where(inArray(screenshots.tradeId, ids))
    .groupBy(screenshots.tradeId);
  // Zrzut dnia ma `tradeId` puste - `inArray` go nie zwroci, ale typ na to pozwala.
  for (const w of rows) if (w.tradeId !== null) map.set(w.tradeId, w.count);
  return map;
}

export async function getTrades(f: Filters, limit?: number): Promise<TradeRecord[]> {
  const query = baseQuery()
    .where(whereClause(f))
    .orderBy(desc(trades.entryTime), desc(trades.id));
  const rows = limit ? await query.limit(limit) : await query;

  const ids = rows.map((r) => r.id);
  const [tagMap, shotMap] = await Promise.all([tagsForTrades(ids), screenshotCounts(ids)]);

  return rows.map((r) => build(r, tagMap.get(r.id) ?? [], shotMap.get(r.id) ?? 0));
}

/** Tylko zamkniete trade'y - podstawa wszystkich statystyk. */
export function closedOnly(list: TradeRecord[]): TradeRecord[] {
  return list.filter((t) => t.status === "closed");
}

export async function getTrade(id: number): Promise<TradeRecord | null> {
  const rows = await baseQuery().where(eq(trades.id, id)).limit(1);
  if (rows.length === 0) return null;
  const [tagMap, shotMap] = await Promise.all([tagsForTrades([id]), screenshotCounts([id])]);
  return build(rows[0], tagMap.get(id) ?? [], shotMap.get(id) ?? 0);
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
    .groupBy(trades.backtestSessionId);
  const map = new Map<number, number>();
  for (const w of rows) if (w.sessionId !== null) map.set(w.sessionId, w.count);
  return map;
}
