import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { accounts, instruments, propRules } from "@/lib/db/schema";
import { tradingDay } from "@/lib/domain/calc";

/**
 * Stawka oplat dla trade'a (ADR-034 pkt 5): round turn (prowizja + gielda + NFA) za JEDEN kontrakt, w centach, dla klasy
 * instrumentu (mini / micro). Obowiazuje: regula prop z dnia trade'a (najnowsza z `valid_from <= dzien`), a gdy jej stawki
 * brak albo konto nie jest prop, stawka konta. `null` = brak stawki (instrument bez klasy, konto bez stawek): wynik jest
 * wtedy brutto z flaga »bez oplat«, a `trades.fees` zostaje NULL.
 */

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function stawkaOplatRt(
  tx: Db,
  o: { accountId: number; instrumentId: number; entryTime: Date },
): Promise<number | null> {
  const [instrument] = await tx
    .select({ sizeClass: instruments.sizeClass, exchangeTimezone: instruments.exchangeTimezone })
    .from(instruments)
    .where(eq(instruments.id, o.instrumentId))
    .limit(1);
  if (!instrument?.sizeClass) return null;
  const [konto] = await tx
    .select({ type: accounts.type, mini: accounts.feeRtMiniCents, micro: accounts.feeRtMicroCents })
    .from(accounts)
    .where(eq(accounts.id, o.accountId))
    .limit(1);
  if (!konto) return null;
  const mini = instrument.sizeClass === "mini";

  if (konto.type === "prop") {
    const dzien = tradingDay(o.entryTime, instrument.exchangeTimezone);
    const [regula] = await tx
      .select({ mini: propRules.feeRtMiniCents, micro: propRules.feeRtMicroCents })
      .from(propRules)
      .where(and(eq(propRules.accountId, o.accountId), lte(propRules.validFrom, dzien)))
      .orderBy(desc(propRules.validFrom))
      .limit(1);
    const stawkaReguly = regula ? (mini ? regula.mini : regula.micro) : null;
    if (stawkaReguly !== null && stawkaReguly !== undefined) return stawkaReguly;
  }
  const stawkaKonta = mini ? konto.mini : konto.micro;
  return stawkaKonta ?? null;
}
