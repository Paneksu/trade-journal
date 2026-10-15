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
        and ${capturedAt} > uw_h.entry_time
        and (${tradeId} = uw_h.id or (${tradeId} is null and ${day} is not null and ${day} = uw_h.trading_day)))`;
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

/** Wejscie trade'a (do porownan »po wejsciu«); null, gdy trade nie istnieje. */
export async function wejscieTradu(tx: Db, tradeId: number): Promise<Date | null> {
  const [t] = await tx.select({ entryTime: trades.entryTime }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  return t?.entryTime ?? null;
}
