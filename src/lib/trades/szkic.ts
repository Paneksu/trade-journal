import "server-only";
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { tradeExits, trades } from "@/lib/db/schema";
import type { TradeDraft } from "@/lib/domain/trade-draft";

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const liczba = (w: string | null): number | null => (w === null ? null : Number(w));

/**
 * Szkic istniejacego trade'a do ponownego zapisu przez `persistTrade` (przeliczenie wyniku z nowa kwota z rachunku albo
 * nowa stawka oplat). Pola opcjonalne (notatka, pola wlasne, tagi, kierunek) zostaja `undefined`, czyli »nie ruszaj«.
 * `brokerAmount` podajemy jawnie: `undefined` zachowuje kwote z bazy, `null` ja czysci.
 */
export async function szkicIstniejacegoTradu(
  tx: Db,
  tradeId: number,
  brokerAmount?: number | null,
): Promise<TradeDraft | null> {
  const [t] = await tx.select().from(trades).where(eq(trades.id, tradeId)).limit(1);
  if (!t) return null;
  const wyjscia = await tx.select().from(tradeExits).where(eq(tradeExits.tradeId, tradeId)).orderBy(asc(tradeExits.sortOrder), asc(tradeExits.id));
  return {
    id: t.id,
    accountId: t.accountId,
    instrumentId: t.instrumentId,
    backtestSessionId: t.backtestSessionId,
    direction: t.direction,
    status: t.status,
    entryTime: t.entryTime,
    entryPrice: Number(t.entryPrice),
    contracts: Number(t.contracts),
    wyjscia: wyjscia.map((w, i) => ({
      numer: i + 1,
      czas: w.exitTime,
      cena: Number(w.exitPrice),
      kontrakty: Number(w.contracts),
      kwotaBrokera: w.brokerAmount,
      notatka: w.note,
    })),
    stopLoss: liczba(t.stopLoss),
    takeProfit: liczba(t.takeProfit),
    mae: liczba(t.mae),
    mfe: liczba(t.mfe),
    brokerAmount: brokerAmount === undefined ? t.brokerAmount : brokerAmount,
  };
}
