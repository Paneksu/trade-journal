import "server-only";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";

import { sqlBrokerUkryty, wejscieTradu } from "@/lib/api-v2/ukrycie-wyniku";
import type { Transakcja } from "@/lib/api-v2/zapis";
import { accounts, brokerAccounts, brokerFills, brokerImports, brokerTrades, dayAccounts, instruments, propFirmPresets, propRules, settings, trades } from "@/lib/db/schema";
import { localDate } from "@/lib/domain/calc";
import { kategoriaKonta } from "@/lib/domain/kategorie";
import { uzgodnij } from "@/lib/domain/brokerzy/uzgodnienie";
import type { db as bazaDb } from "@/lib/db";

/**
 * Odczyty danych brokera dla API (AI) i UI (ADR-034 pkt 7). Slepa ocena przez ten sam mechanizm co reszta API
 * (`ukrycie-wyniku.ts`, funkcja `sqlBrokerUkryty`): trade brokera dopasowany do trade'a z ukrytym wynikiem, albo niedopasowany
 * z tego samego konta i dnia po wejsciu takiego trade'a, wychodzi z `resultHidden: true` i bez wyniku, wyjscia i statusu.
 * Numer konta u brokera nie wychodzi nigdy: tylko ostatnie 4 znaki.
 */

type Db = Transakcja | typeof bazaDb;

export type KontoDlaAI = {
  id: number;
  name: string;
  /** Kategoria konta z ADR-027 (realne, demo, prop_eval, prop_funded) albo null, gdy konto prop nie ma fazy. */
  category: string | null;
  firm: string | null;
  program: string | null;
  phase: "eval" | "funded" | null;
};

/** Konto dziennika opisane tak, zeby AI nie musialo pytac o typ konta: firma, program i faza z presetu najnowszej reguly. */
export async function opisKontaDlaAI(tx: Db, accountId: number): Promise<KontoDlaAI | null> {
  const [k] = await tx.select({ id: accounts.id, name: accounts.name, type: accounts.type, propPhase: accounts.propPhase }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!k) return null;
  let firm: string | null = null;
  let program: string | null = null;
  if (k.type === "prop") {
    const [r] = await tx
      .select({ firm: propFirmPresets.firm, program: propFirmPresets.program })
      .from(propRules)
      .innerJoin(propFirmPresets, eq(propRules.presetId, propFirmPresets.id))
      .where(eq(propRules.accountId, accountId))
      .orderBy(desc(propRules.validFrom))
      .limit(1);
    firm = r?.firm ?? null;
    program = r?.program ?? null;
  }
  return { id: k.id, name: k.name, category: kategoriaKonta({ type: k.type, propPhase: k.propPhase }), firm, program, phase: k.propPhase };
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export type FiltrTradowBrokera = { from?: string; to?: string; accountId?: number; unmatched?: boolean; after: number; limit: number };

export type FillDto = { id: number; side: "buy" | "sell"; quantity: number; price: number; filledAt: string; feeCents: number | null; orderRef: string | null };

type Wiersz = {
  bt: typeof brokerTrades.$inferSelect;
  ukryty: boolean;
  konto: { id: number; accountId: number | null; platform: string; last4: string | null };
  symbol: string | null;
  liczbaFills: number;
};

function dto(w: Wiersz, konto: KontoDlaAI | null) {
  const { bt, ukryty } = w;
  return {
    id: bt.id,
    externalRef: bt.externalRef,
    brokerAccount: { id: w.konto.id, platform: w.konto.platform, last4: w.konto.last4 },
    account: konto,
    contract: bt.contract,
    instrument: w.symbol,
    direction: bt.direction,
    quantity: Number(bt.maxQty),
    entryTime: bt.entryTime.toISOString(),
    avgEntryPrice: Number(bt.avgEntryPrice),
    tradingDay: bt.tradingDay,
    // Wynik, wyjscie i status zdradzilyby rozstrzygniecie trade'a, ktory ma ocene przed wynikiem.
    exitTime: ukryty ? null : iso(bt.exitTime),
    avgExitPrice: ukryty ? null : bt.avgExitPrice === null ? null : Number(bt.avgExitPrice),
    status: ukryty ? null : bt.status,
    grossCents: ukryty ? null : bt.grossCents,
    grossSource: ukryty ? null : bt.grossSource,
    feesCents: ukryty ? null : bt.feesCents,
    feeSource: ukryty ? null : bt.feeSource,
    netCents: ukryty ? null : bt.netCents,
    fillCount: ukryty ? null : w.liczbaFills,
    matchState: bt.matchState,
    matchKind: bt.matchKind,
    tradeId: bt.tradeId,
    resultHidden: ukryty,
  };
}

export type TradeBrokeraDto = ReturnType<typeof dto>;

const warunekUkryty = sqlBrokerUkryty({
  tradeId: sql`${brokerTrades.tradeId}`,
  brokerAccountId: sql`${brokerTrades.brokerAccountId}`,
  tradingDay: sql`${brokerTrades.tradingDay}`,
  entryTime: sql`${brokerTrades.entryTime}`,
});

/** Podzbior `ids` trade'ow brokera, ktorych wynik jest ukryty (slepa ocena): ten sam mechanizm co w API, uzywany tez w interfejsie. */
export async function ukryteTradyBrokera(tx: Db, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const wiersze = await tx
    .select({ id: brokerTrades.id, ukryty: sql<boolean>`${warunekUkryty}` })
    .from(brokerTrades)
    .where(inArray(brokerTrades.id, ids));
  return new Set(wiersze.filter((w) => w.ukryty === true).map((w) => w.id));
}

async function wczytaj(tx: Db, warunki: SQL[], limit: number): Promise<Wiersz[]> {
  const wiersze = await tx
    .select({
      bt: brokerTrades,
      ukryty: sql<boolean>`${warunekUkryty}`,
      kId: brokerAccounts.id,
      kAcc: brokerAccounts.accountId,
      kPlat: brokerAccounts.platform,
      kLast4: brokerAccounts.labelLast4,
      symbol: instruments.symbol,
      liczbaFills: sql<number>`(select count(*)::int from broker_fills bf where bf.broker_trade_id = broker_trades.id)`,
    })
    .from(brokerTrades)
    .innerJoin(brokerAccounts, eq(brokerTrades.brokerAccountId, brokerAccounts.id))
    .leftJoin(instruments, eq(brokerTrades.instrumentId, instruments.id))
    .where(warunki.length ? and(...warunki) : undefined)
    .orderBy(asc(brokerTrades.id))
    .limit(limit);
  return wiersze.map((r) => ({
    bt: r.bt,
    ukryty: r.ukryty === true,
    konto: { id: r.kId, accountId: r.kAcc, platform: r.kPlat, last4: r.kLast4 },
    symbol: r.symbol,
    liczbaFills: r.liczbaFills,
  }));
}

async function kontaDlaWierszy(tx: Db, wiersze: Wiersz[]): Promise<Map<number, KontoDlaAI | null>> {
  const ids = [...new Set(wiersze.map((w) => w.konto.accountId).filter((x): x is number => x !== null))];
  const mapa = new Map<number, KontoDlaAI | null>();
  for (const id of ids) mapa.set(id, await opisKontaDlaAI(tx, id));
  return mapa;
}

/** `GET /api/v2/broker/trades`: lista trade'ow brokera (paginacja po id). */
export async function listaTradowBrokera(tx: Db, f: FiltrTradowBrokera) {
  const warunki: SQL[] = [gt(brokerTrades.id, f.after)];
  if (f.from) warunki.push(gte(brokerTrades.tradingDay, f.from));
  if (f.to) warunki.push(lte(brokerTrades.tradingDay, f.to));
  if (f.accountId !== undefined) warunki.push(eq(brokerAccounts.accountId, f.accountId));
  if (f.unmatched) warunki.push(inArray(brokerTrades.matchState, ["unmatched", "ambiguous"]));
  const wiersze = await wczytaj(tx, warunki, f.limit + 1);
  const strona = wiersze.slice(0, f.limit);
  const konta = await kontaDlaWierszy(tx, strona);
  return {
    trades: strona.map((w) => dto(w, w.konto.accountId === null ? null : (konta.get(w.konto.accountId) ?? null))),
    nextAfter: wiersze.length > f.limit ? strona[strona.length - 1].bt.id : null,
  };
}

/** `GET /api/v2/broker/trades/:id`: to samo + wypelnienia (bez `raw`). Dla ukrytego trade'a tylko wejscia sprzed wejscia trade'a dziennika. */
export async function szczegolyTraduBrokera(tx: Db, id: number) {
  const [w] = await wczytaj(tx, [eq(brokerTrades.id, id)], 1);
  if (!w) return null;
  const konto = w.konto.accountId === null ? null : await opisKontaDlaAI(tx, w.konto.accountId);
  const fills = await wypelnieniaDlaAI(tx, w);
  return { ...dto(w, konto), fills };
}

/** Wypelnienia trade'a brokera widoczne dla AI (bez `raw`); ukryty: tylko sprzed wejscia trade'a dziennika (nic, gdy niedopasowany). */
async function wypelnieniaDlaAI(tx: Db, w: Wiersz): Promise<FillDto[]> {
  if (w.ukryty && w.bt.tradeId === null) return [];
  const warunki = [eq(brokerFills.brokerTradeId, w.bt.id)];
  if (w.ukryty && w.bt.tradeId !== null) {
    const wejscie = await wejscieTradu(tx, w.bt.tradeId);
    if (wejscie === null) return [];
    warunki.push(lte(brokerFills.filledAt, wejscie));
  }
  const wiersze = await tx.select().from(brokerFills).where(and(...warunki)).orderBy(asc(brokerFills.filledAt), asc(brokerFills.id));
  return wiersze.map((f) => ({
    id: f.id,
    side: f.side,
    quantity: Number(f.qty),
    price: Number(f.price),
    filledAt: f.filledAt.toISOString(),
    feeCents: f.feeCents,
    orderRef: f.orderRef,
  }));
}

/**
 * Blok `broker` w `GET /trades/:id`: powiazany trade brokera z wynikiem wyliczonym, zrodlem wyniku i roznica »poslizg i opłaty«.
 * Bez dopasowania `null`. Przy ukrytym wyniku bez pol wyniku.
 */
export async function blokBrokerDlaTradu(tx: Db, tradeId: number, wynikUkryty: boolean) {
  const [w] = await wczytaj(tx, [eq(brokerTrades.tradeId, tradeId)], 1);
  if (!w) return null;
  const ukryty = wynikUkryty || w.ukryty;
  const fills = await wypelnieniaDlaAI(tx, { ...w, ukryty });
  const [t] = await tx.select({ pnl: trades.pnl, pnlEstimate: trades.pnlEstimate, fees: trades.fees, brokerAmount: trades.brokerAmount }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  const u = uzgodnij({ pnl: t?.pnl ?? null, pnlEstimate: t?.pnlEstimate ?? null, brokerAmount: t?.brokerAmount ?? null, feesEstimate: t?.fees ?? null, feesBroker: w.bt.feeSource === "broker" ? w.bt.feesCents : null });
  return {
    brokerTradeId: w.bt.id,
    externalRef: w.bt.externalRef,
    matchKind: w.bt.matchKind,
    matchedAt: iso(w.bt.matchedAt),
    brokerAccount: { id: w.konto.id, platform: w.konto.platform, last4: w.konto.last4 },
    contract: w.bt.contract,
    direction: w.bt.direction,
    quantity: Number(w.bt.maxQty),
    entryTime: w.bt.entryTime.toISOString(),
    avgEntryPrice: Number(w.bt.avgEntryPrice),
    resultHidden: ukryty,
    exitTime: ukryty ? null : iso(w.bt.exitTime),
    avgExitPrice: ukryty ? null : w.bt.avgExitPrice === null ? null : Number(w.bt.avgExitPrice),
    grossCents: ukryty ? null : w.bt.grossCents,
    grossSource: ukryty ? null : w.bt.grossSource,
    feesCents: ukryty ? null : w.bt.feesCents,
    feeSource: ukryty ? null : w.bt.feeSource,
    netCents: ukryty ? null : w.bt.netCents,
    pnlEstimateCents: ukryty ? null : (t?.pnlEstimate ?? null),
    pnlSource: ukryty ? null : u.zrodlo === "z_rachunku" ? ("broker" as const) : ("estimate" as const),
    differenceCents: ukryty ? null : u.roznicaCenty,
    slippageCents: ukryty ? null : u.poslizgCenty,
    feeDifferenceCents: ukryty ? null : u.roznicaOplatCenty,
    fills,
  };
}

export type SourceWyniku = "estimate" | "broker";

/** Pola wyniku do `result` w `GET /trades/:id`: wynik wyliczony i zrodlo wyniku (bez dopasowania zrodlem jest szacunek). */
export function polaWynikuNetto(t: { pnl: number | null; pnlEstimate: number | null; fees: number | null; brokerAmount: number | null }) {
  return {
    feesCents: t.fees,
    pnlEstimateCents: t.pnlEstimate,
    pnlSource: (t.brokerAmount === null ? "estimate" : "broker") as SourceWyniku,
    estimateDifferenceCents: t.brokerAmount !== null && t.pnl !== null && t.pnlEstimate !== null ? t.pnl - t.pnlEstimate : null,
  };
}

/* ---------------------------------------------------------------- status */

export type StatusKonta = {
  accountId: number | null;
  accountName: string | null;
  brokerAccountId: number;
  platform: string;
  last4: string | null;
  lastImportAt: string | null;
  lastFillAt: string | null;
  unmatchedBrokerTrades: number;
  journalTradesWithoutBrokerData: number;
  needsExport: boolean;
};

export async function statusBrokera(tx: Db, dzien?: string) {
  const [ust] = await tx.select({ tz: settings.timezone }).from(settings).limit(1);
  const day = dzien ?? localDate(new Date(), ust?.tz ?? "Europe/Warsaw");

  const konta = await tx
    .select({ ba: brokerAccounts, nazwa: accounts.name })
    .from(brokerAccounts)
    .leftJoin(accounts, eq(brokerAccounts.accountId, accounts.id))
    .orderBy(asc(brokerAccounts.id));
  const naDzien = await tx.select({ accountId: dayAccounts.accountId }).from(dayAccounts).where(eq(dayAccounts.day, day));
  const wybrane = new Set(naDzien.map((d) => d.accountId));
  const pokazywane = wybrane.size > 0 ? konta.filter((k) => k.ba.accountId !== null && wybrane.has(k.ba.accountId)) : konta;

  const wynik: StatusKonta[] = [];
  for (const { ba, nazwa } of pokazywane) {
    const [imp] = await tx.execute<{ at: Date | string | null }>(sql`
      select max(i.created_at) as at from broker_imports i
       where i.status = 'committed'
         and (exists (select 1 from broker_fills f where f.import_id = i.id and f.broker_account_id = ${ba.id})
              or exists (select 1 from broker_cash_events e where e.import_id = i.id and e.broker_account_id = ${ba.id}))`);
    const [fill] = await tx.select({ at: sql<Date | string | null>`max(${brokerFills.filledAt})` }).from(brokerFills).where(eq(brokerFills.brokerAccountId, ba.id));
    const [{ n: bezDopasowania }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(brokerTrades)
      .where(and(eq(brokerTrades.brokerAccountId, ba.id), inArray(brokerTrades.matchState, ["unmatched", "ambiguous"]), eq(brokerTrades.status, "closed")));
    let dziennikBez = 0;
    let ostatniTradeDziennika: Date | null = null;
    let tradowDnia = 0;
    if (ba.accountId !== null) {
      const [d] = await tx
        .select({
          n: sql<number>`count(*)::int`,
          bez: sql<number>`count(*) filter (where not exists (select 1 from broker_trades bx where bx.trade_id = trades.id))::int`,
          ostatni: sql<Date | string | null>`max(coalesce(${trades.exitTime}, ${trades.entryTime}))`,
        })
        .from(trades)
        .where(and(eq(trades.accountId, ba.accountId), eq(trades.tradingDay, day), isNull(trades.backtestSessionId), inArray(trades.status, ["closed", "open"])));
      tradowDnia = d.n;
      dziennikBez = d.bez;
      ostatniTradeDziennika = d.ostatni === null ? null : new Date(d.ostatni);
    }
    const lastFill = fill.at === null ? null : new Date(fill.at);
    const needsExport = ba.accountId !== null && (dziennikBez > 0 || (tradowDnia > 0 && (lastFill === null || (ostatniTradeDziennika !== null && lastFill.getTime() < ostatniTradeDziennika.getTime()))));
    wynik.push({
      accountId: ba.accountId,
      accountName: nazwa,
      brokerAccountId: ba.id,
      platform: ba.platform,
      last4: ba.labelLast4,
      lastImportAt: imp?.at ? new Date(imp.at).toISOString() : null,
      lastFillAt: lastFill ? lastFill.toISOString() : null,
      unmatchedBrokerTrades: bezDopasowania,
      journalTradesWithoutBrokerData: dziennikBez,
      needsExport,
    });
  }
  const [{ odrzucone }] = await tx
    .select({ odrzucone: sql<number>`count(*)::int` })
    .from(brokerImports)
    .where(and(eq(brokerImports.status, "rejected"), gte(brokerImports.createdAt, new Date(Date.now() - 30 * 86_400_000))));
  const doDecyzji = wynik.reduce((s, k) => s + k.unmatchedBrokerTrades, 0) + odrzucone;
  const lastImportAt = wynik.map((k) => k.lastImportAt).filter((x): x is string => x !== null).sort().at(-1) ?? null;
  return {
    day,
    accounts: wynik,
    pendingDecisions: doDecyzji,
    needsExport: wynik.some((k) => k.needsExport),
    lastImportAt,
  };
}

