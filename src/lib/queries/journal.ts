import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

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

/** Jeden dzien sesji backtestu. Brak wpisu jest normalny - strona dnia daje
 *  wtedy pusty formularz, zamiast udawac, ze dnia nie ma. */
export async function getSessionDayNote(
  sessionId: number,
  day: string,
): Promise<DayNote | undefined> {
  const [row] = await db
    .select()
    .from(dayNotes)
    .where(and(eq(dayNotes.backtestSessionId, sessionId), eq(dayNotes.day, day)))
    .limit(1);
  return row;
}

/** Ile trade'ow ma sesja backtestu w danym dniu handlowym. */
export async function countSessionTradesOnDay(sessionId: number, day: string): Promise<number> {
  const [row] = await db
    .select({ ile: count() })
    .from(trades)
    .where(
      and(
        eq(trades.backtestSessionId, sessionId),
        eq(trades.tradingDay, day),
        /* Nie wzieta pozycja nie jest wykonanym trade'em - patrz komentarz
           przy countTradesOnDay ponizej. */
        sql`${trades.status}::text <> 'missed'`,
      ),
    );
  return row?.ile ?? 0;
}

/**
 * Ile realnych trade'ow ma dany dzien handlowy. Sluzy do pilnowania, zeby dzien
 * oznaczony jako "bez transakcji" nie przeczyl zapisanym trade'om.
 * Trade'y z backtestu sie nie licza - symulacja nie jest dowodem na to,
 * co dzialo sie w dzienniku.
 *
 * Trade nie wziety ("missed") tez sie nie liczy - jest dowodem odwrotnym:
 * setup byl, uzytkownik go NIE wzial, wiec dzien wciaz jest "bez transakcji"
 * w sensie, o ktory chodzi tej fladze. Jedyny wyjatek od zasady "trade'y
 * wygrywaja z flaga" (ADR-006) - patrz ADR-024.
 */
export async function countTradesOnDay(day: string): Promise<number> {
  const [row] = await db
    .select({ ile: count() })
    .from(trades)
    .where(
      and(
        eq(trades.tradingDay, day),
        isNull(trades.backtestSessionId),
        sql`${trades.status}::text <> 'missed'`,
      ),
    );
  return row?.ile ?? 0;
}

/**
 * Notatki dnia dziennika w zakresie: JEDNA na dzień (runda r2, 16.10.2026, decyzja sesji głównej: notatka dnia
 * jest bez konta, bo tak zapisują ją rytuał na „Dziś” i AI przez `PUT /api/v2/days/:date`). Starsze wpisy
 * kalendarza leżą na pierwszym koncie: gdy dzień nie ma notatki bez konta, pokazujemy ten starszy wpis, a pierwszy
 * zapis z kalendarza tworzy już notatkę bez konta. Sesje backtestu mają własne notatki i tu nie wchodzą.
 */
export async function getNotatkiDnia(from: string, to: string): Promise<DayNote[]> {
  const wiersze = await db
    .select()
    .from(dayNotes)
    .where(and(gte(dayNotes.day, from), lte(dayNotes.day, to), isNull(dayNotes.backtestSessionId)))
    .orderBy(asc(dayNotes.day), asc(dayNotes.id));
  const poDniu = new Map<string, DayNote>();
  for (const w of wiersze) {
    const obecna = poDniu.get(w.day);
    if (!obecna || (obecna.accountId !== null && w.accountId === null)) poDniu.set(w.day, w);
  }
  return [...poDniu.values()];
}

/** Zrzuty dnia dziennika ze wszystkich jego notatek (bez konta i starszych z kontem), bez sesji backtestu. */
export async function getZrzutyDnia(day: string) {
  return db
    .select({ s: screenshots })
    .from(screenshots)
    .innerJoin(dayNotes, eq(screenshots.dayNoteId, dayNotes.id))
    .where(and(eq(dayNotes.day, day), isNull(dayNotes.backtestSessionId)))
    .orderBy(asc(screenshots.sortOrder), asc(screenshots.id))
    .then((w) => w.map((x) => x.s));
}
