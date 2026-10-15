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

function wTransakcji<T>(actor: string, fn: (tx: Transakcja) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('tj.actor', ${actor}, true)`);
    return fn(tx);
  });
}

/**
 * Zapis z aktorem innym niz `ui`: `api:<id tokenu>`, `ingest`. Aktor `ui` (zatwierdzenia uzytkownika) jest
 * ODRZUCANY (audyt 6): ta funkcja jest dostepna dla tras API, a trasa nie moze sie podszyc pod uzytkownika
 * przez przekazanie napisu. Zatwierdzenia ida przez `zapisJakoUi` z modulow `lib/decyzje`; straznik
 * (guard.test.ts) zabrania uzycia `zapisJakoUi` i importu `lib/decyzje` oraz `lib/actions` w `src/app/api/**`
 * i w `src/lib/api-v2/**`.
 */
export function zapisZAktorem<T>(actor: string, fn: (tx: Transakcja) => Promise<T>): Promise<T> {
  if (actor.trim().toLowerCase() === "ui") {
    throw new Error("zapisZAktorem odrzuca aktora »ui«: zatwierdzenia użytkownika zapisuje wyłącznie moduł lib/decyzje przez zapisJakoUi (sesja po requireSession), nigdy trasa API.");
  }
  return wTransakcji(actor, fn);
}

/** Zapis jako uzytkownik w aplikacji (`tj.actor = ui`): tylko dla akcji serwera po `requireSession()`, przez `lib/decyzje`. */
export function zapisJakoUi<T>(fn: (tx: Transakcja) => Promise<T>): Promise<T> {
  return wTransakcji("ui", fn);
}

/** Aktor starych tras /api/ingest/** (nie znaja tokenu v2 w handlerze). */
export const AKTOR_INGEST = "ingest";

export const zapisIngest: Zapis = (fn) => zapisZAktorem(AKTOR_INGEST, fn);

/**
 * Wykonuje `fn` na sciezce planu zamrozonego przed wejsciem (`tj.sciezka = plan`, lokalnie dla transakcji): tylko wtedy aktor
 * API moze ustawic `trades.setup_id` i `setup_version_id` (trigger `trades_guard_*`, migracja 0028; Slowa uzytkownika 15.10.2026:
 * «Plan z moich slow = zatwierdzenie»). Znacznik jest zdejmowany zaraz po `fn`. Oceny procesu ta sciezka nie odblokowuje.
 */
export async function wSciezcePlanu<T>(tx: Transakcja, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('tj.sciezka', 'plan', true)`);
  // Bez `finally`: po bledzie transakcja jest przerwana (zapytania daja 25P02 i maskuja prawdziwy blad), a znacznik jest lokalny dla transakcji i ginie z jej wycofaniem.
  const wynik = await fn();
  await tx.execute(sql`select set_config('tj.sciezka', '', true)`);
  return wynik;
}
