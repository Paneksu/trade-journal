import "server-only";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import type { Transakcja } from "@/lib/api-v2/zapis";
import { brokerAccounts, brokerTrades, trades } from "@/lib/db/schema";
import { dopasuj, OKNO_DOPASOWANIA_S, type Dopasowanie } from "@/lib/domain/brokerzy/dopasowanie";
import { persistTrade } from "@/lib/trades/persist";
import { szkicIstniejacegoTradu } from "@/lib/trades/szkic";

/**
 * Dopasowanie trade'ow brokera do trade'ow dziennika i skutki dla wyniku (ADR-034 pkt 4 i 5). Wszystko w transakcji wolajacego
 * (aktor `ui` albo token importu); baza pilnuje, ze reczne dopasowania zapisuje tylko `ui` (trigger tj_broker_dopasowanie).
 *
 * Dopasowanie WPISUJE kwote netto z rachunku jako `brokerAmount` trade'a przez `persistTrade` (jedyna droga zapisu wyniku).
 * Cen wejscia i wyjscia z formularza NIE nadpisujemy: roznica to poslizg i ma byc widoczna. Poprzednia kwota z rachunku
 * zostaje w `prev_broker_amount_cents`, zeby »Cofnij« ja przywrocilo.
 */

export type WierszTradu = typeof brokerTrades.$inferSelect;
export type RodzajDopasowania = "auto" | "user" | "ai_accepted" | "created";

export type ZastosowaneDopasowanie = {
  brokerTradeId: number;
  externalRef: string;
  tradeId: number;
  rodzaj: RodzajDopasowania;
  /** Wynik trade'a dziennika przed i po (centy); `null`, gdy kwota z rachunku nie byla znana i nic sie nie zmienilo. */
  pnlPrzed: number | null;
  pnlPo: number | null;
  kwotaZapisana: boolean;
};

export type BladDopasowania = { brokerTradeId: number; komunikat: string };

/** Wpisuje kwote netto z rachunku w trade dziennika (`persistTrade`) i zwraca wynik przed i po. */
async function wpiszKwote(
  tx: Transakcja,
  tradeId: number,
  kwota: number | null | undefined,
): Promise<{ ok: true; przed: number | null; po: number | null } | { ok: false; komunikat: string }> {
  const [przed] = await tx.select({ pnl: trades.pnl, status: trades.status }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  if (!przed) return { ok: false, komunikat: `trade #${tradeId} nie istnieje (mógł zostać skasowany)` };
  const szkic = await szkicIstniejacegoTradu(tx, tradeId, kwota);
  if (!szkic) return { ok: false, komunikat: `trade #${tradeId} nie istnieje` };
  const zapis = await persistTrade(szkic, undefined, { tx });
  if (!zapis.ok) return { ok: false, komunikat: `zapis trade'a #${tradeId} nie przeszedł: ${zapis.error}` };
  const [po] = await tx.select({ pnl: trades.pnl }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  return { ok: true, przed: przed.pnl, po: po?.pnl ?? null };
}

/** Sprawdza, czy trade brokera moze byc dopasowany do trade'a dziennika; zwraca komunikat bledu albo null. */
async function sprawdzMozliwosc(tx: Transakcja, bt: WierszTradu, tradeId: number): Promise<string | null> {
  if (bt.status !== "closed") return "trade brokera jest jeszcze otwarty (czeka na zamknięcie pozycji w kolejnym eksporcie)";
  if (bt.tradeId !== null) return `trade brokera jest już dopasowany do trade'a #${bt.tradeId}`;
  const [konto] = await tx.select({ accountId: brokerAccounts.accountId }).from(brokerAccounts).where(eq(brokerAccounts.id, bt.brokerAccountId)).limit(1);
  if (!konto || konto.accountId === null) return "konto u brokera nie jest przypisane do konta dziennika";
  const [t] = await tx
    .select({ id: trades.id, accountId: trades.accountId, status: trades.status, sesja: trades.backtestSessionId })
    .from(trades)
    .where(eq(trades.id, tradeId))
    .limit(1);
  if (!t) return `trade #${tradeId} nie istnieje (mógł zostać skasowany)`;
  if (t.sesja !== null) return `trade #${tradeId} należy do sesji backtestu, a z rachunkiem dopasowujemy tylko trade'y realne`;
  if (t.accountId !== konto.accountId) return `trade #${tradeId} jest na innym koncie dziennika niż konto u brokera`;
  if (t.status !== "closed") return `trade #${tradeId} nie jest zamknięty (status ${t.status}), więc nie przyjmie wyniku z rachunku`;
  const [zajety] = await tx.select({ id: brokerTrades.id }).from(brokerTrades).where(eq(brokerTrades.tradeId, tradeId)).limit(1);
  if (zajety) return `trade #${tradeId} jest już dopasowany do innego trade'a brokera (#${zajety.id})`;
  return null;
}

/** Dopasowuje trade brokera do trade'a dziennika (kwota netto wchodzi do wyniku, jesli jest znana). */
export async function zastosujDopasowanie(
  tx: Transakcja,
  bt: WierszTradu,
  tradeId: number,
  rodzaj: RodzajDopasowania,
): Promise<{ ok: true; wynik: ZastosowaneDopasowanie } | { ok: false; komunikat: string }> {
  const powod = await sprawdzMozliwosc(tx, bt, tradeId);
  if (powod) return { ok: false, komunikat: powod };
  const [przed] = await tx.select({ kwota: trades.brokerAmount }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  let pnlPrzed: number | null = null;
  let pnlPo: number | null = null;
  let zapisana = false;
  if (bt.netCents !== null) {
    const w = await wpiszKwote(tx, tradeId, bt.netCents);
    if (!w.ok) return { ok: false, komunikat: w.komunikat };
    pnlPrzed = w.przed;
    pnlPo = w.po;
    zapisana = true;
  }
  await tx
    .update(brokerTrades)
    .set({
      tradeId,
      matchKind: rodzaj,
      matchState: "matched",
      matchedAt: new Date(),
      prevBrokerAmountCents: przed?.kwota ?? null,
      updatedAt: new Date(),
    })
    .where(eq(brokerTrades.id, bt.id));
  return { ok: true, wynik: { brokerTradeId: bt.id, externalRef: bt.externalRef, tradeId, rodzaj, pnlPrzed, pnlPo, kwotaZapisana: zapisana } };
}

/**
 * Odpina trade brokera od trade'a dziennika. Przywraca poprzednia kwote z rachunku, o ile uzytkownik nie zmienil jej po
 * dopasowaniu. Trade dziennika utworzony z danych brokera (rodzaj `created`) jest kasowany bez nagrobka (ADR-034 pkt 2).
 */
export async function odepnijDopasowanie(
  tx: Transakcja,
  bt: WierszTradu,
  o: { nowyStan: "unmatched" | "skipped"; przywrocKwote: boolean },
): Promise<{ przywrocono: boolean; skasowanoTrade: boolean; uwaga: string | null }> {
  if (bt.tradeId === null) return { przywrocono: false, skasowanoTrade: false, uwaga: null };
  let przywrocono = false;
  let skasowano = false;
  let uwaga: string | null = null;
  const tradeId = bt.tradeId;

  // Najpierw odpinamy w brokerze (CHECK-i wymagaja zmiany trzech pol razem), potem ruszamy trade dziennika.
  await tx
    .update(brokerTrades)
    .set({ tradeId: null, matchKind: null, matchState: o.nowyStan, matchedAt: null, prevBrokerAmountCents: null, updatedAt: new Date() })
    .where(eq(brokerTrades.id, bt.id));

  if (bt.matchKind === "created") {
    await tx.delete(trades).where(and(eq(trades.id, tradeId), eq(trades.source, "broker")));
    skasowano = true;
  } else if (o.przywrocKwote) {
    const [t] = await tx.select({ kwota: trades.brokerAmount }).from(trades).where(eq(trades.id, tradeId)).limit(1);
    if (t) {
      if (t.kwota !== null && bt.netCents !== null && t.kwota !== bt.netCents) {
        uwaga = `Trade #${tradeId} ma kwotę z rachunku zmienioną po dopasowaniu (${t.kwota} zamiast ${bt.netCents} centów), więc jej nie przywracam.`;
      } else if (t.kwota !== (bt.prevBrokerAmountCents ?? null)) {
        const w = await wpiszKwote(tx, tradeId, bt.prevBrokerAmountCents ?? null);
        if (w.ok) przywrocono = true;
        else uwaga = w.komunikat;
      }
    }
  }
  return { przywrocono, skasowanoTrade: skasowano, uwaga };
}

/** Kwota netto trade'a brokera zmienila sie (np. doszla Cash History z oplatami): odswiezamy ja w dopasowanym trade'zie. */
export async function odswiezKwoteDopasowania(tx: Transakcja, bt: WierszTradu): Promise<void> {
  if (bt.tradeId === null || bt.netCents === null || bt.matchKind === "created") return;
  const [t] = await tx.select({ kwota: trades.brokerAmount }).from(trades).where(eq(trades.id, bt.tradeId)).limit(1);
  if (!t || t.kwota === bt.netCents) return;
  const w = await wpiszKwote(tx, bt.tradeId, bt.netCents);
  // Zmiana kwoty dopasowanego trade'a ma byc WIDOCZNA na liscie »Uzgodnione z rachunku« (było -> jest, z »Cofnij«), takze dla starego dopasowania.
  if (w.ok) await tx.update(brokerTrades).set({ matchedAt: new Date(), updatedAt: new Date() }).where(eq(brokerTrades.id, bt.id));
}

export type PrzebiegDopasowania = {
  zastosowane: ZastosowaneDopasowanie[];
  /** Trade'y brokera z kilkoma kandydatami albo inna liczba kontraktow (do decyzji w UI). */
  niejednoznaczne: number;
  /** Trade'y brokera bez kandydata w dzienniku (do decyzji w UI: utworz trade albo pomin). */
  bez: number;
  bledy: BladDopasowania[];
  /** Wynik domeny dla kazdego rozpatrzonego trade'a brokera (do podgladu). */
  dopasowania: Dopasowanie[];
};

/**
 * Szuka dopasowan dla niedopasowanych zamknietych trade'ow brokera (konta przypisane do kont dziennika) i stosuje 1:1.
 * `odznaczone` (external_ref) pomija stosowanie, ale zostawia trade'a jako kandydata. `tylkoUstal`: nie stosuje niczego.
 */
export async function przebiegDopasowania(
  tx: Transakcja,
  o: { kontaBrokera?: number[]; rodzaj: "auto" | "user"; odznaczone?: Set<string>; tylkoUstal?: boolean; dlaTradow?: Set<number> },
): Promise<PrzebiegDopasowania> {
  const warunki = [eq(brokerTrades.status, "closed"), inArray(brokerTrades.matchState, ["unmatched", "ambiguous"]), isNull(brokerTrades.tradeId)];
  if (o.kontaBrokera) {
    if (o.kontaBrokera.length === 0) return { zastosowane: [], niejednoznaczne: 0, bez: 0, bledy: [], dopasowania: [] };
    warunki.push(inArray(brokerTrades.brokerAccountId, o.kontaBrokera));
  }
  const kandydaciBrokera = await tx
    .select({ bt: brokerTrades, kontoDziennika: brokerAccounts.accountId })
    .from(brokerTrades)
    .innerJoin(brokerAccounts, eq(brokerTrades.brokerAccountId, brokerAccounts.id))
    .where(and(...warunki));
  const wiersze = kandydaciBrokera.filter((w) => w.kontoDziennika !== null);
  if (wiersze.length === 0) return { zastosowane: [], niejednoznaczne: 0, bez: 0, bledy: [], dopasowania: [] };

  const konta = [...new Set(wiersze.map((w) => w.kontoDziennika as number))];
  // reduce zamiast Math.min(...tablica): rozwiniecie tablicy rzuca RangeError przy ~120 tys. elementow (audyt N2)
  let najwczesniej = Infinity;
  let najpozniej = -Infinity;
  for (const w of wiersze) {
    const t = w.bt.entryTime.getTime();
    if (t < najwczesniej) najwczesniej = t;
    if (t > najpozniej) najpozniej = t;
  }
  const minCzas = new Date(najwczesniej - (OKNO_DOPASOWANIA_S + 1) * 1000);
  const maxCzas = new Date(najpozniej + (OKNO_DOPASOWANIA_S + 1) * 1000);
  const dziennik = await tx
    .select({ id: trades.id, accountId: trades.accountId, instrumentId: trades.instrumentId, direction: trades.direction, entryTime: trades.entryTime, contracts: trades.contracts })
    .from(trades)
    .where(
      and(
        inArray(trades.accountId, konta),
        isNull(trades.backtestSessionId),
        eq(trades.status, "closed"),
        gte(trades.entryTime, minCzas),
        lte(trades.entryTime, maxCzas),
        sql`not exists (select 1 from broker_trades bx where bx.trade_id = ${trades.id})`,
      ),
    );
  const wynik = dopasuj(
    wiersze.map((w) => ({
      id: w.bt.id,
      accountId: w.kontoDziennika,
      instrumentId: w.bt.instrumentId,
      direction: w.bt.direction,
      entryTime: w.bt.entryTime,
      maxQty: Number(w.bt.maxQty),
    })),
    dziennik.map((d) => ({ ...d, contracts: Number(d.contracts) })),
  );

  const przebieg: PrzebiegDopasowania = { zastosowane: [], niejednoznaczne: 0, bez: 0, bledy: [], dopasowania: wynik };
  for (const d of wynik) {
    const bt = wiersze.find((w) => w.bt.id === d.brokerTradeId)!.bt;
    if (d.stan === "jeden_do_jednego" && d.tradeId !== null) {
      if (o.tylkoUstal || o.odznaczone?.has(bt.externalRef)) continue;
      const w = await zastosujDopasowanie(tx, bt, d.tradeId, o.rodzaj);
      if (w.ok) przebieg.zastosowane.push(w.wynik);
      else przebieg.bledy.push({ brokerTradeId: bt.id, komunikat: w.komunikat });
      continue;
    }
    const stan = d.stan === "niejednoznaczne" ? "ambiguous" : "unmatched";
    if (d.stan === "niejednoznaczne") przebieg.niejednoznaczne += 1;
    else przebieg.bez += 1;
    if (!o.tylkoUstal && bt.matchState !== stan) {
      await tx.update(brokerTrades).set({ matchState: stan, updatedAt: new Date() }).where(eq(brokerTrades.id, bt.id));
    }
  }
  return przebieg;
}
