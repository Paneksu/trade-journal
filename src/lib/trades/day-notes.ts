import { and, isNotNull, isNull } from "drizzle-orm";

import { dayNotes } from "@/lib/db/schema";

/**
 * Cel `ON CONFLICT` dla notatki dnia. Konflikt trafia w jeden z trzech
 * czesciowych indeksow, zaleznie od tego, czy dzien nalezy do sesji backtestu,
 * do konta, czy do zadnego z nich. W Postgresie NULL != NULL, wiec kazdy
 * przypadek potrzebuje wlasnego celu. Wspolne dla akcji UI i API v2.
 */
export function celKonfliktuNotatkiDnia(accountId: number | null, sessionId: number | null) {
  if (sessionId) {
    return {
      target: [dayNotes.day, dayNotes.backtestSessionId],
      targetWhere: isNotNull(dayNotes.backtestSessionId),
    };
  }
  return accountId
    ? {
        target: [dayNotes.day, dayNotes.accountId],
        targetWhere: isNull(dayNotes.backtestSessionId),
      }
    : {
        target: dayNotes.day,
        targetWhere: and(isNull(dayNotes.accountId), isNull(dayNotes.backtestSessionId)),
      };
}
