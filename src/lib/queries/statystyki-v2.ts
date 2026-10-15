import "server-only";
import { and, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { backtestSessions, hypothesisVariants, trades } from "@/lib/db/schema";
import { DOMYSLNE_PROGI_STATUSU, ostrzezenieWariantow, statusZWynikow, type Pomiar } from "@/lib/domain/stats-ci";
import { pomiaryZamknietych, statystykaPoZrodlach, zOceny } from "@/lib/api-v2/statystyki";
import { dodajDni } from "@/lib/api-v2/przeglady";
import { dzienHandlowyTeraz } from "@/lib/api-v2/prop-konta";
import { hipotezyMozgu } from "@/lib/queries/mozg";
import { playbook } from "@/lib/queries/playbook";
import { poniedzialek } from "@/lib/queries/przeglad";

/**
 * Statystyki UI v2 (etap 3, wzór 10: kafle Missive). Każda liczba z n i przedziałem (Wilson dla win rate,
 * bootstrap dla oczekiwanego R, „orientacyjnie” przy n < 30), test względem break-even z własnych średnich,
 * statusy setupów i hipotez, licznik testowanych wariantów i „ile R znika” między źródłami. Te same funkcje
 * co API v2 (`statusZWynikow`, `statystykaPoZrodlach`), więc liczby w UI i u agenta są te same.
 */

/** Kafle z bieżącego (przefiltrowanego) zbioru zamkniętych trade'ów strony /stats. */
export function kafleZTradow(pomiary: Pomiar[]) {
  return zOceny(statusZWynikow(pomiary, DOMYSLNE_PROGI_STATUSU));
}

export type DyscyplinaTygodnia = { tydzien: string; ocenione: number; a: number; udzialA: number | null };

/** Udział oceny A wśród ocenionych trade'ów tydzień po tydzień (12 tygodni, bez sesji backtestu). */
async function dyscyplinaTygodniowa(): Promise<DyscyplinaTygodnia[]> {
  const koniec = poniedzialek(dzienHandlowyTeraz());
  const start = dodajDni(koniec, -7 * 11);
  const wiersze = await db
    .select({
      tydzien: sql<string>`date_trunc('week', ${trades.tradingDay})::date::text`,
      ocenione: sql<number>`count(${trades.processGrade})::int`,
      a: sql<number>`count(*) filter (where ${trades.processGrade} = 'A')::int`,
    })
    .from(trades)
    .leftJoin(backtestSessions, eq(trades.backtestSessionId, backtestSessions.id))
    .where(and(eq(trades.status, "closed"), isNotNull(trades.tradingDay), gte(trades.tradingDay, start), or(isNull(trades.backtestSessionId), sql`${backtestSessions.kind} <> 'backtest'`)))
    .groupBy(sql`1`);
  const mapa = new Map(wiersze.map((w) => [w.tydzien, w]));
  return Array.from({ length: 12 }, (_, i) => {
    const t = dodajDni(start, i * 7);
    const w = mapa.get(t);
    const ocenione = w?.ocenione ?? 0;
    const a = w?.a ?? 0;
    return { tydzien: t, ocenione, a, udzialA: ocenione > 0 ? a / ocenione : null };
  });
}

export async function statystykiV2() {
  const [pomiary, setupy, hipotezy, dyscyplina, [warianty]] = await Promise.all([
    pomiaryZamknietych(db, sql`true`),
    playbook(),
    hipotezyMozgu(),
    dyscyplinaTygodniowa(),
    db.select({ n: sql<number>`count(*)::int` }).from(hypothesisVariants),
  ]);
  const zrodla = statystykaPoZrodlach(pomiary, DOMYSLNE_PROGI_STATUSU);
  const k = Number(warianty?.n ?? 0);
  return {
    zrodla,
    setupy: setupy.map((s) => ({ slug: s.slug, nazwa: s.name, status: s.statystyka?.statusNazwa ?? "brak danych", statusKod: s.statystyka?.status ?? null, n: s.statystyka?.n ?? 0, zrodlo: s.zrodloStatystyki })),
    hipotezy: hipotezy.map((h) => ({ id: h.id, noteId: h.noteId, kod: h.code, tytul: h.title, n: h.n, progN: h.progN, faza: h.phase, decyzja: h.decision, warianty: h.warianty })),
    dyscyplina,
    warianty: k > 0 ? ostrzezenieWariantow(k, zrodla.bySource.live?.n ?? null) : null,
  };
}

export type StatystykiV2 = Awaited<ReturnType<typeof statystykiV2>>;

/** Porównanie źródeł danych (backtest, forward, demo, live) dla ekranu Backtest (wzór 6). */
export async function porownanieZrodel() {
  return statystykaPoZrodlach(await pomiaryZamknietych(db, sql`true`), DOMYSLNE_PROGI_STATUSU);
}
