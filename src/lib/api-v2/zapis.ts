import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * Wspolny sposob zapisu dla KAZDEJ trasy zapisujacej (ADR-030, wymog "kazdy zapis
 * v2 z tj.actor", potwierdzony przez uzytkownika 15.10.2026: «Wymog zostaje,
 * poprawiamy»). Transakcja ustawia `tj.actor` na tym samym polaczeniu co zapis
 * (`true` = lokalnie dla transakcji; z `false` wartosc wyciekalaby na polaczenie z puli).
 */

export type Transakcja = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Wykonuje `fn` w transakcji z ustawionym aktorem. */
export type Zapis = <T>(fn: (tx: Transakcja) => Promise<T>) => Promise<T>;

export function zapisZAktorem<T>(actor: string, fn: (tx: Transakcja) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('tj.actor', ${actor}, true)`);
    return fn(tx);
  });
}

/** Aktor starych tras /api/ingest/** (nie znaja tokenu v2 w handlerze). */
export const AKTOR_INGEST = "ingest";

export const zapisIngest: Zapis = (fn) => zapisZAktorem(AKTOR_INGEST, fn);
