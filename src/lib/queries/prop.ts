import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accounts, propLedger, trades } from "@/lib/db/schema";
import { dzienHandlowyTeraz, ksiegaKonta, listaPresetow, listaRegulKonta, przegladProp, statusKonta } from "@/lib/api-v2/prop-konta";

/**
 * Ekrany Prop (UI v2, etap 3, wzory 7a i 7b). Bufory, consistency, „gdy trafi SL”, ekspozycja i księga przez
 * te same funkcje co API v2 (`/prop/overview`, `/prop/accounts/:id/status`, `/ledger`, `/rules`, `/presets`).
 */

export type PunktSalda = { dzien: string; saldoCents: number };

/** Saldo konta dzień po dniu (zamknięte trade'y dziennika, bez sesji backtestu). */
async function krzywaSalda(accountId: number, startCents: number): Promise<PunktSalda[]> {
  const wiersze = await db
    .select({ dzien: trades.tradingDay, pnl: sql<number>`sum(${trades.pnl})::bigint` })
    .from(trades)
    .where(and(eq(trades.accountId, accountId), eq(trades.status, "closed"), isNull(trades.backtestSessionId)))
    .groupBy(trades.tradingDay)
    .orderBy(asc(trades.tradingDay));
  let saldo = startCents;
  return wiersze
    .filter((w) => w.dzien !== null)
    .map((w) => {
      saldo += Number(w.pnl);
      return { dzien: w.dzien!, saldoCents: saldo };
    });
}

export async function kontaProp() {
  const dzis = dzienHandlowyTeraz();
  const przeglad = await przegladProp(db, dzis);
  const ksiegi = await Promise.all(przeglad.accounts.map((k) => ksiegaKonta(db, k.accountId)));
  const reguly = await Promise.all(przeglad.accounts.map((k) => listaRegulKonta(db, k.accountId)));
  return {
    dzis,
    exposureNq: przeglad.exposureNq,
    konta: przeglad.accounts.map((k, i) => {
      const ks = ksiegi[i];
      const rg = reguly[i];
      const obecna = rg.ok ? (rg.rules.filter((r) => r.validFrom <= dzis).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null) : null;
      return { ...k, ksiega: ks.ok ? ks.summary : null, preset: obecna?.preset ?? null };
    }),
  };
}

export async function presetyProp() {
  return listaPresetow(db, {});
}

export async function kontoProp(id: number) {
  const [k] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!k || k.type !== "prop") return null;
  const dzis = dzienHandlowyTeraz();
  const [status, ksiega, reguly, krzywa] = await Promise.all([
    statusKonta(db, id, { day: dzis }),
    ksiegaKonta(db, id),
    listaRegulKonta(db, id),
    krzywaSalda(id, k.startingBalance),
  ]);
  return {
    konto: { id: k.id, name: k.name, currency: k.currency, startingBalance: k.startingBalance, propPhase: k.propPhase, defaultRiskAmount: k.defaultRiskAmount },
    dzis,
    status: status.ok ? status : null,
    bladStatusu: status.ok ? null : status.komunikat,
    ksiega: ksiega.ok ? ksiega : null,
    reguly: reguly.ok ? reguly.rules : [],
    krzywa,
  };
}

export type KontoProp = NonNullable<Awaited<ReturnType<typeof kontoProp>>>;

/** Księga wszystkich kont prop (zakładka „Księga” na /prop): wpisy od najnowszych z nazwą konta. */
export async function ksiegaWszystkich() {
  const wiersze = await db
    .select({ id: propLedger.id, accountId: propLedger.accountId, konto: accounts.name, kind: propLedger.kind, amountCents: propLedger.amountCents, occurredOn: propLedger.occurredOn, note: propLedger.note })
    .from(propLedger)
    .innerJoin(accounts, eq(propLedger.accountId, accounts.id))
    .orderBy(desc(propLedger.occurredOn), desc(propLedger.id));
  let koszty = 0;
  let wplywy = 0;
  for (const w of wiersze) {
    if (w.amountCents < 0) koszty += w.amountCents;
    else wplywy += w.amountCents;
  }
  return { wpisy: wiersze, kosztyCents: koszty, wplywyCents: wplywy, nettoCents: koszty + wplywy };
}
