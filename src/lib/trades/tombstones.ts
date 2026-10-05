import "server-only";
import { inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { trades } from "@/lib/db/schema";

/**
 * Nagrobki skasowanych trade'ow (ADR-026). Trade, ktory przyszedl przez API
 * (ma `external_ref`), po skasowaniu w aplikacji zostawia wiersz w `ingest_skips`
 * - bez tego nastepna synchronizacja wskrzesilaby go jako "nowy".
 *
 * Wywolywane W TEJ SAMEJ transakcji co kasowanie: nagrobek bez skasowanego
 * trade'a albo skasowany trade bez nagrobka to oba stany, ktorych nie chcemy.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const NOTA = "skasowany w aplikacji";

/** Kasuje trade'y o podanych id i zapisuje nagrobki tych z `external_ref`. */
export async function usunTradeZNagrobkami(tradeIds: number[]): Promise<void> {
  if (tradeIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into ingest_skips (external_ref, reason, note)
      select external_ref, 'deleted', ${NOTA} from trades
      where id in (${sql.join(tradeIds.map((id) => sql`${id}`), sql`, `)})
        and external_ref is not null
      on conflict (external_ref) do nothing`);
    await tx.delete(trades).where(inArray(trades.id, tradeIds));
  });
}

/** Nagrobki dla trade'ow sesji, wolane tuz przed kasowaniem sesji (kaskada usunie je razem z nia). */
export async function nagrobkiTradeowSesji(tx: Tx, sessionId: number): Promise<void> {
  await tx.execute(sql`
    insert into ingest_skips (external_ref, reason, note)
    select external_ref, 'deleted', ${NOTA} from trades
    where backtest_session_id = ${sessionId} and external_ref is not null
    on conflict (external_ref) do nothing`);
}
