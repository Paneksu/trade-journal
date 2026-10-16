import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { dayNotes, userWords } from "@/lib/db/schema";
import { zapisJakoUi } from "@/lib/api-v2/zapis";
import { celKonfliktuNotatkiDnia } from "@/lib/trades/day-notes";

/**
 * Zapisy notatki dnia z aplikacji (code review fazy 5, P1 i P3, 16.10.2026): jako aktor `ui`, jak reszta decyzji.
 *
 * Notatka dnia dziennika jest JEDNA i bez konta (ADR-033; Słowa użytkownika 16.10.2026: «Tak, zawsze jedna»).
 * Notatki sesji backtestu mają własne wiersze i własne akcje (`saveBacktestDayNote`), tu ich nie ma.
 *
 * Nadpisanie: formularz wysyła `wersja` = `updatedAt` notatki z chwili otwarcia ("" gdy notatki nie było). Gdy
 * w międzyczasie notatkę zmienił ktoś inny (druga karta, rytuał, AI przez API), zapis jest odrzucany zamiast
 * po cichu nadpisać cudzy tekst. Szybka notatka z arkusza „+” nie potrzebuje wersji: dopisuje atomowo w SQL.
 */

export type PolaNotatkiDnia = Partial<
  Pick<typeof dayNotes.$inferInsert, "preSession" | "postSession" | "mood" | "energy" | "dayRating" | "noTrade" | "noTradeReason" | "bias" | "maxTrades" | "sleep">
>;

export type WynikNotatkiDnia = { ok: true } | { ok: false; komunikat: string; konflikt?: boolean };

const KONFLIKT =
  "Notatkę dnia ktoś zmienił po otwarciu formularza (inna karta, rytuał albo AI). Nic nie zapisaliśmy: odśwież stronę, a swój tekst skopiuj przed odświeżeniem.";

class Konflikt extends Error {}

const warunekDnia = (dzien: string) => and(eq(dayNotes.day, dzien), isNull(dayNotes.accountId), isNull(dayNotes.backtestSessionId));

/**
 * Zapis pól notatki dnia bez konta z kontrolą wersji. `wersja` = ISO `updatedAt` widziany w formularzu albo ""
 * (formularz otwarty, gdy notatki jeszcze nie było); `uniewaznienie` = słowa użytkownika (rola `day.invalidation`),
 * zapisywane w tej samej transakcji, nowa rewizja tylko przy zmianie treści.
 */
export async function zapiszNotatkeDniaUi(dzien: string, pola: PolaNotatkiDnia, wersja: string, uniewaznienie?: string | null): Promise<WynikNotatkiDnia> {
  return zapisJakoUi(async (tx) => {
    const teraz = new Date();
    const [obecna] = await tx.select({ id: dayNotes.id, updatedAt: dayNotes.updatedAt }).from(dayNotes).where(warunekDnia(dzien)).for("update").limit(1);
    if (obecna) {
      if (obecna.updatedAt.toISOString() !== wersja) throw new Konflikt();
      await tx.update(dayNotes).set({ ...pola, updatedAt: teraz }).where(eq(dayNotes.id, obecna.id));
    } else {
      if (wersja !== "") throw new Konflikt();
      // Dwa równoległe pierwsze zapisy: drugi trafi w konflikt indeksu i dostanie odmowę, nie nadpisze pierwszego.
      const wstawione = await tx
        .insert(dayNotes)
        .values({ day: dzien, accountId: null, backtestSessionId: null, ...pola, updatedAt: teraz })
        .onConflictDoNothing()
        .returning({ id: dayNotes.id });
      if (wstawione.length === 0) throw new Konflikt();
    }
    if (uniewaznienie != null && uniewaznienie.trim().length > 0) {
      const [poprzednie] = await tx
        .select({ id: userWords.id, text: userWords.text })
        .from(userWords)
        .where(and(eq(userWords.day, dzien), eq(userWords.role, "day.invalidation"), isNull(userWords.tradeId)))
        .orderBy(desc(userWords.id))
        .limit(1);
      if (!poprzednie || poprzednie.text !== uniewaznienie) {
        await tx.insert(userWords).values({ text: uniewaznienie, source: "ui", role: "day.invalidation", day: dzien, capturedAt: teraz, supersedesId: poprzednie?.id ?? null });
      }
    }
    return { ok: true } as const;
  }).catch((e: unknown) => {
    if (e instanceof Konflikt) return { ok: false, komunikat: KONFLIKT, konflikt: true };
    throw e;
  });
}

/** Szybka notatka: dopisanie na końcu „Po sesji” jednym poleceniem SQL (bez okna wyścigu między odczytem a zapisem). */
export async function dopiszDoPoSesjiUi(dzien: string, tekst: string): Promise<WynikNotatkiDnia> {
  return zapisJakoUi(async (tx) => {
    await tx
      .insert(dayNotes)
      .values({ day: dzien, accountId: null, backtestSessionId: null, postSession: tekst, updatedAt: new Date() })
      .onConflictDoUpdate({
        ...celKonfliktuNotatkiDnia(null, null),
        set: {
          postSession: sql`coalesce(nullif(${dayNotes.postSession}, '') || E'\n\n', '') || excluded.post_session`,
          updatedAt: sql`now()`,
        },
      });
    return { ok: true } as const;
  });
}
