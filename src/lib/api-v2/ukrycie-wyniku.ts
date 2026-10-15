import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { trades } from "@/lib/db/schema";

import type { Transakcja } from "./zapis";

/**
 * Slepa ocena: dopoki trade nie jest zamkniety, a ma werdykt AI wydany przed wynikiem, wszystko, co moze zdradzic
 * wynik, jest ukryte WE WSZYSTKICH odczytach API (review i audyt, 15.10.2026). Jedno zrodlo reguly:
 *  - `czyWynikUkryty` / `ukryteTrady` (w aplikacji),
 *  - `sqlWynikUkryty` i `sqlSlowaPoWejsciuUkrytego` (te same reguly jako SQL: wyszukiwarka, listy, adnotacje).
 * Slowa uzytkownika i zrzuty sa ukrywane tylko wtedy, gdy powstaly PO wejsciu: to, co napisano przed wejsciem
 * (plan, teza), jest dowodem decyzji, nie wynikiem.
 */

type Db = Transakcja | typeof db;

/** Warunek SQL: trade `tradeId` jest otwarty i ma werdykt. `tradeId` to wyrazenie SQL (kolumna albo alias). */
export function sqlWynikUkryty(tradeId: SQL): SQL {
  return sql`(exists (select 1 from trades uw_t where uw_t.id = ${tradeId} and uw_t.status::text <> 'closed')
    and exists (select 1 from trade_reviews uw_r where uw_r.trade_id = ${tradeId}))`;
}

/**
 * Warunek SQL: slowa (kolumny trade_id, day, captured_at podane jako wyrazenia) powstaly po wejsciu trade'a z ukrytym
 * wynikiem i dotycza tego trade'a albo jego dnia handlowego (slowa dnia bez trade'a).
 */
export function sqlSlowaPoWejsciuUkrytego(tradeId: SQL, day: SQL, capturedAt: SQL): SQL {
  return sql`exists (select 1 from trades uw_h
      where ${sqlWynikUkryty(sql`uw_h.id`)}
        and ${capturedAt} > ${sqlWejscieTradu(sql`uw_h.id`)}
        and (${tradeId} = uw_h.id or (${tradeId} is null and ${day} is not null and ${day} = uw_h.trading_day)))`;
}

/**
 * Wyrazenie SQL: JEDNA definicja wejscia trade'a dla calej slepej oceny = najwczesniejsze znane wejscie, czyli
 * least(entry_time_at_attach planu, biezace entry_time). `least` w Postgresie pomija NULL-e. Najwczesniejsze wejscie
 * ukrywa wiecej, wiec jest bezpieczniejsze (Slowa uzytkownika 15.10.2026: «Ukrywaj tylko notatki po wejsciu»;
 * wybor wykonawcy zatwierdzony przez sesje glowna).
 */
export function sqlWejscieTradu(tradeId: SQL): SQL {
  return sql`least((select uw_p.entry_time_at_attach from trade_plans uw_p where uw_p.trade_id = ${tradeId} limit 1),
    (select uw_e.entry_time from trades uw_e where uw_e.id = ${tradeId}))`;
}

/**
 * Warunek SQL: notatka przypieta do trade'a z ukrytym wynikiem jest ukryta, gdy powstala PO wejsciu albo byla zmieniana
 * po wejsciu (Slowa uzytkownika, 15.10.2026: «Ukrywaj tylko notatki po wejsciu»). Wybor przy notatce sprzed wejscia,
 * ale edytowanej po wejsciu: ukrywamy ja w calosci (bezpieczniej niz pokazywanie starej wersji; rewizji tresci API nie wystawia).
 */
export function sqlNotatkaPoWejsciuUkrytego(tradeId: SQL, createdAt: SQL, updatedAt: SQL): SQL {
  return sql`(${sqlWynikUkryty(tradeId)} and greatest(${createdAt}, ${updatedAt}) > ${sqlWejscieTradu(tradeId)})`;
}

/** Podzbior `ids`, ktorych wynik jest ukryty (otwarty trade z werdyktem). */
export async function ukryteTrady(tx: Db, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const wiersze = await tx
    .select({ id: trades.id })
    .from(trades)
    .where(and(inArray(trades.id, ids), sql`${trades.status}::text <> 'closed'`, sql`exists (select 1 from trade_reviews uw_x where uw_x.trade_id = ${trades.id})`));
  return new Set(wiersze.map((w) => w.id));
}

export async function czyWynikUkryty(tx: Db, tradeId: number): Promise<boolean> {
  return (await ukryteTrady(tx, [tradeId])).has(tradeId);
}

export async function czyNotatkaUkryta(tx: Db, noteId: number): Promise<boolean> {
  const [w] = await tx.execute<{ h: boolean | null }>(sql`select ${sqlNotatkaPoWejsciuUkrytego(sql`n.trade_id`, sql`n.created_at`, sql`n.updated_at`)} as h from notes n where n.id = ${noteId}`);
  return w?.h === true;
}

/** Wejscie trade'a (ta sama definicja co `sqlWejscieTradu`: najwczesniejsze znane); null, gdy trade nie istnieje. */
export async function wejscieTradu(tx: Db, tradeId: number): Promise<Date | null> {
  const [w] = await tx.execute<{ t: Date | string | null }>(sql`select ${sqlWejscieTradu(sql`${tradeId}::int`)} as t`);
  return w?.t == null ? null : new Date(w.t);
}
