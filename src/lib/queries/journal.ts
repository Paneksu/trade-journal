import "server-only";
import { and, asc, count, eq, gte, isNull, lte } from "drizzle-orm";

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

/**
 * Ile trade'ow ma dany dzien handlowy. Sluzy do pilnowania, zeby dzien
 * oznaczony jako "bez transakcji" nie przeczyl zapisanym trade'om.
 */
export async function countTradesOnDay(day: string): Promise<number> {
  const [row] = await db
    .select({ ile: count() })
    .from(trades)
    .where(eq(trades.tradingDay, day));
  return row?.ile ?? 0;
}
