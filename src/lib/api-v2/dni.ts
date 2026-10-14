import "server-only";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/lib/db";
import { accounts, backtestSessions, dayNotes, notes, trades, userWords } from "@/lib/db/schema";
import { isNoTradeReason } from "@/lib/domain/day-log";
import { countSessionTradesOnDay, countTradesOnDay } from "@/lib/queries/journal";
import { celKonfliktuNotatkiDnia } from "@/lib/trades/day-notes";

import type { DzienQuery, DzienZapisSchema } from "./contract/v2";
import type { Zapis } from "./zapis";
import { zSlow } from "./slowa";

/**
 * Dzien (plan: `days/:date`). Odczyt zbiera wszystko, co wisi na dniu; zapis
 * robi to samo co akcja UI `saveDayNote` / `saveBacktestDayNote` (te same
 * indeksy konfliktu, ta sama zasada "trade'y sa twardszym dowodem niz znacznik").
 */

function zakres(q: { accountId?: number | null; sessionId?: number | null }) {
  return { accountId: q.accountId ?? null, sessionId: q.sessionId ?? null };
}

export async function odczytajDzien(data: string, q: z.output<typeof DzienQuery>) {
  const { accountId, sessionId } = zakres(q);

  const warunekNotatki: SQL = sessionId
    ? and(eq(dayNotes.day, data), eq(dayNotes.backtestSessionId, sessionId))!
    : accountId
      ? and(eq(dayNotes.day, data), eq(dayNotes.accountId, accountId), isNull(dayNotes.backtestSessionId))!
      : and(eq(dayNotes.day, data), isNull(dayNotes.accountId), isNull(dayNotes.backtestSessionId))!;
  const [notatkaDnia] = await db.select().from(dayNotes).where(warunekNotatki).limit(1);

  const warunekTradow: SQL[] = [eq(trades.tradingDay, data)];
  if (sessionId) warunekTradow.push(eq(trades.backtestSessionId, sessionId));
  else {
    warunekTradow.push(isNull(trades.backtestSessionId));
    if (accountId) warunekTradow.push(eq(trades.accountId, accountId));
  }
  const tradowDnia = await db
    .select({ id: trades.id, status: sql<string>`${trades.status}::text`, direction: trades.direction })
    .from(trades)
    .where(and(...warunekTradow))
    .orderBy(asc(trades.entryTime))
    .limit(200);

  const slowa = await db.select().from(userWords).where(eq(userWords.day, data)).orderBy(asc(userWords.id)).limit(200);
  const notatki = await db
    .select({ id: notes.id, kind: notes.kind, slug: notes.slug, title: notes.title, rev: notes.rev })
    .from(notes)
    .where(and(eq(notes.day, data), isNull(notes.archivedAt)))
    .orderBy(asc(notes.id))
    .limit(200);

  return {
    date: data,
    scope: { accountId, sessionId },
    dayNote: notatkaDnia
      ? {
          id: notatkaDnia.id,
          preSession: notatkaDnia.preSession,
          postSession: notatkaDnia.postSession,
          mood: notatkaDnia.mood,
          energy: notatkaDnia.energy,
          dayRating: notatkaDnia.dayRating,
          noTrade: notatkaDnia.noTrade,
          noTradeReason: notatkaDnia.noTradeReason,
          bias: notatkaDnia.bias,
          maxTrades: notatkaDnia.maxTrades,
          sleep: notatkaDnia.sleep,
          updatedAt: notatkaDnia.updatedAt.toISOString(),
        }
      : null,
    trades: tradowDnia,
    userWords: slowa.map(zSlow),
    notes: notatki,
  };
}

export type WynikZapisuDnia =
  | { ok: true; id: number; utworzono: boolean }
  | { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string };

export async function zapiszDzien(data: string, d: z.output<typeof DzienZapisSchema>, zapis: Zapis): Promise<WynikZapisuDnia> {
  const accountId = d.accountId ?? null;
  const sessionId = d.sessionId ?? null;
  if (accountId && sessionId) {
    return { ok: false, status: 422, kod: "ambiguous_scope", komunikat: "Podaj accountId albo sessionId, nie oba naraz: dzień należy do konta albo do sesji backtestu." };
  }
  if (accountId) {
    const [k] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (!k) return { ok: false, status: 404, kod: "account_not_found", komunikat: `pole accountId: »${accountId}« - nie ma takiego konta.` };
  }
  if (sessionId) {
    const [s] = await db.select({ id: backtestSessions.id }).from(backtestSessions).where(eq(backtestSessions.id, sessionId)).limit(1);
    if (!s) return { ok: false, status: 404, kod: "session_not_found", komunikat: `pole sessionId: »${sessionId}« - nie ma takiej sesji.` };
  }
  if (d.noTradeReason !== undefined && d.noTradeReason !== null && !isNoTradeReason(d.noTradeReason)) {
    return { ok: false, status: 422, kod: "invalid_reason", komunikat: `pole noTradeReason: »${d.noTradeReason}« nie jest powodem z listy aplikacji.` };
  }

  if (d.noTrade === true) {
    const ile = sessionId ? await countSessionTradesOnDay(sessionId, data) : await countTradesOnDay(data);
    if (ile > 0) {
      return {
        ok: false,
        status: 409,
        kod: "day_has_trades",
        komunikat: sessionId
          ? `Sesja #${sessionId} ma ${data} zapisane trade'y (${ile}); dzień nie był bez sygnału. Dwa źródła prawdy o dniu nie mogą sobie przeczyć.`
          : `Dzień ${data} ma zapisane trade'y (${ile}), więc nie można go oznaczyć jako dnia bez transakcji.`,
      };
    }
  }

  // Tylko pola podane w ciele; reszta wiersza zostaje, jak byla.
  const podane: Partial<typeof dayNotes.$inferInsert> = {};
  if (d.preSession !== undefined) podane.preSession = d.preSession;
  if (d.postSession !== undefined) podane.postSession = d.postSession;
  if (d.mood !== undefined) podane.mood = d.mood;
  if (d.energy !== undefined) podane.energy = d.energy;
  if (d.dayRating !== undefined) podane.dayRating = d.dayRating;
  if (d.bias !== undefined) podane.bias = d.bias;
  if (d.maxTrades !== undefined) podane.maxTrades = d.maxTrades;
  if (d.sleep !== undefined) podane.sleep = d.sleep;
  if (d.noTrade !== undefined) {
    podane.noTrade = d.noTrade;
    // Odznaczenie flagi nie zostawia osieroconego powodu.
    if (!d.noTrade) podane.noTradeReason = null;
  }
  if (d.noTradeReason !== undefined && d.noTrade !== false) {
    podane.noTradeReason = (d.noTradeReason ?? null) as typeof dayNotes.$inferInsert.noTradeReason;
  }
  const teraz = new Date();

  const [wiersz] = await zapis((tx) =>
    tx
    .insert(dayNotes)
    .values({ day: data, accountId: sessionId ? null : accountId, backtestSessionId: sessionId, ...podane, updatedAt: teraz })
    .onConflictDoUpdate({ ...celKonfliktuNotatkiDnia(accountId, sessionId), set: { ...podane, updatedAt: teraz } })
    .returning({ id: dayNotes.id, utworzono: sql<boolean>`(xmax = 0)` }),
  );
  return { ok: true, id: wiersz.id, utworzono: wiersz.utworzono };
}

