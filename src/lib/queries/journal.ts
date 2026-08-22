import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { dayNotes, screenshots, trades } from "@/lib/db/schema";
import type { DayNote } from "@/lib/db/schema";

/** Notatki dnia. Jeden wpis na dzien i konto. */

function forAccount(accountId: number | null | undefined) {
  return accountId ? eq(dayNotes.accountId, accountId) : isNull(dayNotes.accountId);
}

export async function getDayNote(
  day: string,
  accountId: number | null | undefined,
): Promise<DayNote | undefined> {
  const [row] = await db
    .select()
    .from(dayNotes)
    .where(and(eq(dayNotes.day, day), forAccount(accountId)))
    .limit(1);
  return row;
}

export async function getDayNotes(
  from: string,
  to: string,
  accountId: number | null | undefined,
): Promise<DayNote[]> {
  return db
    .select()
    .from(dayNotes)
    .where(and(gte(dayNotes.day, from), lte(dayNotes.day, to), forAccount(accountId)))
    .orderBy(asc(dayNotes.day));
}

/** Zrzuty podpiete pod dzien, w kolejnosci wgrywania. */
export async function getDayScreenshots(dayNoteId: number | null | undefined) {
  if (!dayNoteId) return [];
  return db
    .select()
    .from(screenshots)
    .where(eq(screenshots.dayNoteId, dayNoteId))
    .orderBy(asc(screenshots.sortOrder), asc(screenshots.id));
}

/** Ile zrzutow ma kazdy z podanych wpisow dnia. */
export async function screenshotCountsForDayNotes(ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ dayNoteId: screenshots.dayNoteId, ile: count() })
    .from(screenshots)
    .where(inArray(screenshots.dayNoteId, ids))
    .groupBy(screenshots.dayNoteId);
  for (const r of rows) if (r.dayNoteId !== null) map.set(r.dayNoteId, r.ile);
  return map;
}

/** Wpisy dni bez sygnalu przypisane do sesji backtestu, od najnowszego. */
export async function getSessionDayNotes(sessionId: number): Promise<DayNote[]> {
  return db
    .select()
    .from(dayNotes)
    .where(eq(dayNotes.backtestSessionId, sessionId))
    .orderBy(desc(dayNotes.day));
}

/** Ile trade'ow ma sesja backtestu w danym dniu handlowym. */
export async function countSessionTradesOnDay(sessionId: number, day: string): Promise<number> {
  const [row] = await db
    .select({ ile: count() })
    .from(trades)
    .where(and(eq(trades.backtestSessionId, sessionId), eq(trades.tradingDay, day)));
  return row?.ile ?? 0;
}

/**
 * Ile realnych trade'ow ma dany dzien handlowy. Sluzy do pilnowania, zeby dzien
 * oznaczony jako "bez transakcji" nie przeczyl zapisanym trade'om.
 * Trade'y z backtestu sie nie licza - symulacja nie jest dowodem na to,
 * co dzialo sie w dzienniku.
 */
export async function countTradesOnDay(day: string): Promise<number> {
  const [row] = await db
    .select({ ile: count() })
    .from(trades)
    .where(and(eq(trades.tradingDay, day), isNull(trades.backtestSessionId)));
  return row?.ile ?? 0;
}
