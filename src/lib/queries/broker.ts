import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import { czyWynikUkryty } from "@/lib/api-v2/ukrycie-wyniku";
import { przebiegDopasowania } from "@/lib/brokerzy/dopasowania";
import { ukryteTradyBrokera, warunekUkryty } from "@/lib/brokerzy/odczyt";
import { brokerSkonfigurowany } from "@/lib/brokerzy/klucz";
import { db } from "@/lib/db";
import {
  accounts,
  apiTokens,
  brokerAccounts,
  brokerFills,
  brokerImports,
  brokerTrades,
  dayAccounts,
  instruments,
  propFirmPlatforms,
  trades,
} from "@/lib/db/schema";
import { PLATFORMY_Z_PARSEREM } from "@/lib/domain/brokerzy/formaty";
import { localDate } from "@/lib/domain/calc";
import { kategoriaKonta } from "@/lib/domain/kategorie";
import { uzgodnij } from "@/lib/domain/brokerzy/uzgodnienie";
import { getSettings } from "@/lib/auth/guard";

/**
 * Zapytania ekranow danych brokera (Prop → Polaczenia, Dzis, trade): lista firm i platform jako DANE, konta u brokera,
 * historia importow, »Uzgodnione z rachunku« z mozliwoscia cofniecia, »Do decyzji« z kandydatami. To odczyty dla
 * zalogowanego uzytkownika (wlasciciela), bez slepej oceny: wynik widzi czlowiek, nie agent.
 */

const DZIEN_MS = 86_400_000;
/** Lista firm starzeje sie w tygodniach: po 30 dniach od odczytu UI ostrzega (ADR-034 pkt 1). */
export const WIEK_OSTRZEZENIA_DNI = 30;

export type PlatformaFirmy = {
  id: number;
  platform: string;
  methods: string[];
  exportHint: string | null;
  sourceUrl: string;
  readOn: string;
  ageDays: number;
  stale: boolean;
  needsVerification: boolean;
  notes: string | null;
  /** Czy dziennik rozpoznaje plik tej platformy (parser z prawdziwego pliku). */
  maParser: boolean;
};

export type FirmaZPlatformami = { firm: string; platformy: PlatformaFirmy[] };

export async function listaFirmIPlatform(teraz: Date = new Date()): Promise<FirmaZPlatformami[]> {
  const wiersze = await db.select().from(propFirmPlatforms).orderBy(asc(propFirmPlatforms.firm), asc(propFirmPlatforms.platform), desc(propFirmPlatforms.readOn));
  const mapa = new Map<string, FirmaZPlatformami>();
  const widziane = new Set<string>();
  for (const w of wiersze) {
    const klucz = `${w.firm}|${w.platform}`;
    if (widziane.has(klucz)) continue; // najnowszy odczyt wygrywa
    widziane.add(klucz);
    const wiek = Math.max(0, Math.floor((teraz.getTime() - new Date(`${w.readOn}T00:00:00Z`).getTime()) / DZIEN_MS));
    const firma = mapa.get(w.firm) ?? { firm: w.firm, platformy: [] };
    firma.platformy.push({
      id: w.id,
      platform: w.platform,
      methods: w.methods,
      exportHint: w.exportHint,
      sourceUrl: w.sourceUrl,
      readOn: w.readOn,
      ageDays: wiek,
      stale: wiek > WIEK_OSTRZEZENIA_DNI,
      needsVerification: w.needsVerification,
      notes: w.notes,
      maParser: PLATFORMY_Z_PARSEREM.includes(platformaPliku(w.platform)),
    });
    mapa.set(w.firm, firma);
  }
  return [...mapa.values()];
}

/** Nazwa platformy z listy firm -> platforma pliku (`broker_accounts.platform`). */
export function platformaPliku(nazwa: string): "tradovate" | "tradingview" | "topstepx" | "rithmic" | "ninjatrader" | "generic" {
  const n = nazwa.toLowerCase();
  if (n.includes("tradovate")) return "tradovate";
  if (n.includes("topstep")) return "topstepx";
  if (n.includes("rithmic")) return "rithmic";
  if (n.includes("ninja")) return "ninjatrader";
  if (n.includes("tradingview")) return "tradingview";
  return "generic";
}

export type KontoPolaczone = {
  brokerAccountId: number;
  platform: string;
  last4: string | null;
  accountId: number | null;
  accountName: string | null;
  category: string | null;
  tz: string | null;
  lastImportAt: string | null;
  lastFillAt: string | null;
  fills: number;
  tradesTotal: number;
  tradesMatched: number;
  tradesPending: number;
};

export async function kontaPolaczone(): Promise<KontoPolaczone[]> {
  const wiersze = await db
    .select({ ba: brokerAccounts, nazwa: accounts.name, typ: accounts.type, faza: accounts.propPhase })
    .from(brokerAccounts)
    .leftJoin(accounts, eq(brokerAccounts.accountId, accounts.id))
    .orderBy(asc(brokerAccounts.id));
  const wynik: KontoPolaczone[] = [];
  for (const { ba, nazwa, typ, faza } of wiersze) {
    const [imp] = await db.execute<{ at: Date | string | null }>(sql`
      select max(i.created_at) as at from broker_imports i
       where i.status = 'committed'
         and (exists (select 1 from broker_fills f where f.import_id = i.id and f.broker_account_id = ${ba.id})
              or exists (select 1 from broker_cash_events e where e.import_id = i.id and e.broker_account_id = ${ba.id}))`);
    // Slepa ocena (tak samo jak w statusBrokera): czas ostatniego wypelnienia i liczniki tylko z trade'ow brokera bez ukrytego wyniku,
    // a wypelnienia liczymy bez tych, ktore naleza do trade'ow ukrytych.
    const [f] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(brokerFills)
      .where(
        and(
          eq(brokerFills.brokerAccountId, ba.id),
          or(
            isNull(brokerFills.brokerTradeId),
            inArray(brokerFills.brokerTradeId, db.select({ id: brokerTrades.id }).from(brokerTrades).where(and(eq(brokerTrades.brokerAccountId, ba.id), sql`not ${warunekUkryty}`))),
          ),
        ),
      );
    const [ost] = await db
      .select({ at: sql<Date | string | null>`max(coalesce(${brokerTrades.exitTime}, ${brokerTrades.entryTime}))` })
      .from(brokerTrades)
      .where(and(eq(brokerTrades.brokerAccountId, ba.id), sql`not ${warunekUkryty}`));
    const [t] = await db
      .select({
        razem: sql<number>`count(*)::int`,
        dopasowane: sql<number>`count(*) filter (where ${brokerTrades.matchState} = 'matched')::int`,
        czeka: sql<number>`count(*) filter (where ${brokerTrades.matchState} in ('unmatched', 'ambiguous') and ${brokerTrades.status} = 'closed')::int`,
      })
      .from(brokerTrades)
      .where(and(eq(brokerTrades.brokerAccountId, ba.id), sql`not ${warunekUkryty}`));
    wynik.push({
      brokerAccountId: ba.id,
      platform: ba.platform,
      last4: ba.labelLast4,
      accountId: ba.accountId,
      accountName: nazwa,
      category: typ ? kategoriaKonta({ type: typ, propPhase: faza }) : null,
      tz: ba.tz,
      lastImportAt: imp?.at ? new Date(imp.at).toISOString() : null,
      lastFillAt: ost.at ? new Date(ost.at).toISOString() : null,
      fills: f.n,
      tradesTotal: t.razem,
      tradesMatched: t.dopasowane,
      tradesPending: t.czeka,
    });
  }
  return wynik;
}

export type ImportWiersz = {
  id: number;
  createdAt: string;
  origin: "ui" | "tj_watch" | "oauth";
  format: string;
  status: "committed" | "reverted" | "rejected";
  fillsNew: number;
  fillsDuplicate: number;
  tradesMatched: number;
  tradesCreated: number;
  pendingDecisions: number;
  rowsSkipped: number;
  warnings: { code: string; message: string }[];
  note: string | null;
  tz: string;
};

export async function ostatnieImporty(limit = 20): Promise<ImportWiersz[]> {
  const wiersze = await db.select().from(brokerImports).orderBy(desc(brokerImports.createdAt)).limit(limit);
  return wiersze.map((w) => ({
    id: w.id,
    createdAt: w.createdAt.toISOString(),
    origin: w.origin,
    format: w.format,
    status: w.status,
    fillsNew: w.fillsNew,
    fillsDuplicate: w.fillsDuplicate,
    tradesMatched: w.tradesMatched,
    tradesCreated: w.tradesCreated,
    pendingDecisions: w.pendingDecisions,
    rowsSkipped: w.rowsSkipped,
    warnings: w.warnings,
    note: w.note,
    tz: w.tz,
  }));
}

export type UzgodnioneWiersz = {
  brokerTradeId: number;
  tradeId: number;
  matchKind: "auto" | "user" | "ai_accepted" | "created";
  matchedAt: string;
  contract: string;
  direction: "long" | "short";
  quantity: number;
  entryTime: string;
  accountName: string | null;
  /** Wynik przed dopasowaniem (poprzednia kwota z rachunku albo wynik wyliczony) i po (netto z rachunku), w centach. */
  pnlPrzed: number | null;
  pnlPo: number | null;
  feesCents: number | null;
  feeSource: "broker" | "rate" | null;
  /** »Poslizg i oplaty«: roznica miedzy wynikiem z rachunku a wyliczonym. */
  roznicaCenty: number | null;
  /** Slepa ocena: trade dziennika ma werdykt AI wydany przed wynikiem i nie jest zamkniety; wynik zakryty (puste pola). */
  wynikUkryty: boolean;
};

/** »Uzgodnione z rachunku«: dopasowane trade'y brokera z wynikiem »bylo -> jest«, najnowsze pierwsze. */
export async function uzgodnioneZRachunku(limit = 30, dni = 30, teraz: Date = new Date()): Promise<UzgodnioneWiersz[]> {
  const od = new Date(teraz.getTime() - dni * DZIEN_MS);
  const wiersze = await db
    .select({ bt: brokerTrades, nazwa: accounts.name, pnl: trades.pnl, pnlEstimate: trades.pnlEstimate, fees: trades.fees, brokerAmount: trades.brokerAmount })
    .from(brokerTrades)
    .innerJoin(trades, eq(brokerTrades.tradeId, trades.id))
    .innerJoin(brokerAccounts, eq(brokerTrades.brokerAccountId, brokerAccounts.id))
    .leftJoin(accounts, eq(brokerAccounts.accountId, accounts.id))
    .where(and(eq(brokerTrades.matchState, "matched"), gte(brokerTrades.matchedAt, od)))
    .orderBy(desc(brokerTrades.matchedAt), desc(brokerTrades.id))
    .limit(limit);
  const ukryte = await ukryteTradyBrokera(db, wiersze.map((w) => w.bt.id));
  return wiersze.map(({ bt, nazwa, pnl, pnlEstimate, fees, brokerAmount }) => {
    const zakryty = ukryte.has(bt.id);
    const u = uzgodnij({ pnl, pnlEstimate, brokerAmount, feesEstimate: fees, feesBroker: bt.feeSource === "broker" ? bt.feesCents : null });
    return {
      brokerTradeId: bt.id,
      tradeId: bt.tradeId as number,
      matchKind: bt.matchKind as "auto" | "user" | "ai_accepted" | "created",
      matchedAt: (bt.matchedAt as Date).toISOString(),
      contract: bt.contract,
      direction: bt.direction,
      quantity: Number(bt.maxQty),
      entryTime: bt.entryTime.toISOString(),
      accountName: nazwa,
      // Przed dopasowaniem wynikiem byla poprzednia kwota z rachunku, a gdy jej nie bylo, wynik wyliczony.
      pnlPrzed: zakryty ? null : (bt.prevBrokerAmountCents ?? pnlEstimate),
      pnlPo: zakryty ? null : pnl,
      feesCents: zakryty ? null : bt.feesCents,
      feeSource: zakryty ? null : bt.feeSource,
      roznicaCenty: zakryty ? null : u.roznicaCenty,
      wynikUkryty: zakryty,
    };
  });
}

export type KandydatWiersz = { tradeId: number; entryTime: string; contracts: number; pnl: number | null; direction: "long" | "short" };

export type DoDecyzjiWiersz = {
  brokerTradeId: number;
  contract: string;
  instrumentId: number | null;
  direction: "long" | "short";
  quantity: number;
  entryTime: string;
  exitTime: string | null;
  netCents: number | null;
  feeSource: "broker" | "rate" | null;
  brokerAccountId: number;
  accountId: number | null;
  accountName: string | null;
  last4: string | null;
  stan: "ambiguous" | "unmatched";
  powod: string | null;
  kandydaci: KandydatWiersz[];
  /** Slepa ocena: wynik tego trade'a brokera jest zakryty (puste pola wyniku), bo na tym koncie i w tym dniu trade z werdyktem AI nie jest zamkniety. */
  wynikUkryty: boolean;
};

/** »Do decyzji«: zamkniete trade'y brokera bez dopasowania, z kandydatami z dziennika i powodem. */
export async function doDecyzji(limit = 100): Promise<DoDecyzjiWiersz[]> {
  const wiersze = await db
    .select({ bt: brokerTrades, ba: brokerAccounts, nazwa: accounts.name })
    .from(brokerTrades)
    .innerJoin(brokerAccounts, eq(brokerTrades.brokerAccountId, brokerAccounts.id))
    .leftJoin(accounts, eq(brokerAccounts.accountId, accounts.id))
    // slepa ocena: trade'y brokera z ukrytym wynikiem nie ida do listy (samo ich pojawienie sie zdradzaloby zamkniecie)
    .where(and(eq(brokerTrades.status, "closed"), inArray(brokerTrades.matchState, ["unmatched", "ambiguous"]), isNull(brokerTrades.tradeId), sql`not ${warunekUkryty}`))
    .orderBy(desc(brokerTrades.entryTime))
    .limit(limit);
  if (wiersze.length === 0) return [];

  // Kandydaci i powody z tej samej domeny co przy imporcie (odczyt: nic nie zapisujemy).
  const przebieg = await db.transaction((tx) => przebiegDopasowania(tx, { tylkoUstal: true, rodzaj: "user" }));
  const poId = new Map(przebieg.dopasowania.map((d) => [d.brokerTradeId, d]));
  const idKandydatow = [...new Set(przebieg.dopasowania.flatMap((d) => d.kandydaci))];
  const kandydaci = idKandydatow.length
    ? await db.select({ id: trades.id, entryTime: trades.entryTime, contracts: trades.contracts, pnl: trades.pnl, direction: trades.direction }).from(trades).where(inArray(trades.id, idKandydatow))
    : [];
  const kandydatPoId = new Map(kandydaci.map((k) => [k.id, k]));
  const ukryte = await ukryteTradyBrokera(db, wiersze.map((w) => w.bt.id));
  return wiersze.map(({ bt, ba, nazwa }) => {
    const d = poId.get(bt.id);
    const zakryty = ukryte.has(bt.id);
    return {
      brokerTradeId: bt.id,
      contract: bt.contract,
      instrumentId: bt.instrumentId,
      direction: bt.direction,
      quantity: Number(bt.maxQty),
      entryTime: bt.entryTime.toISOString(),
      exitTime: zakryty ? null : (bt.exitTime?.toISOString() ?? null),
      netCents: zakryty ? null : bt.netCents,
      feeSource: zakryty ? null : bt.feeSource,
      wynikUkryty: zakryty,
      brokerAccountId: ba.id,
      accountId: ba.accountId,
      accountName: nazwa,
      last4: ba.labelLast4,
      stan: bt.matchState === "ambiguous" ? "ambiguous" : "unmatched",
      powod:
        ba.accountId === null
          ? "konto u brokera nie jest przypisane do konta dziennika"
          : (d?.powod ?? (bt.instrumentId === null ? "kontrakt nie ma instrumentu w dzienniku" : null)),
      kandydaci: (d?.kandydaci ?? []).flatMap((id) => {
        const k = kandydatPoId.get(id);
        return k ? [{ tradeId: k.id, entryTime: k.entryTime.toISOString(), contracts: Number(k.contracts), pnl: zakryty ? null : k.pnl, direction: k.direction }] : [];
      }),
    };
  });
}

export type PominietyWiersz = { brokerTradeId: number; contract: string; direction: "long" | "short"; quantity: number; entryTime: string; accountName: string | null };

/** Trade'y brokera, ktore uzytkownik pominal albo ktorych dopasowanie cofnal (stan `skipped`): stad wracaja do decyzji. Ukryte (slepa ocena) pomijamy. */
export async function pominiete(limit = 50): Promise<PominietyWiersz[]> {
  const wiersze = await db
    .select({ bt: brokerTrades, nazwa: accounts.name })
    .from(brokerTrades)
    .innerJoin(brokerAccounts, eq(brokerTrades.brokerAccountId, brokerAccounts.id))
    .leftJoin(accounts, eq(brokerAccounts.accountId, accounts.id))
    .where(and(eq(brokerTrades.matchState, "skipped"), eq(brokerTrades.status, "closed"), isNull(brokerTrades.tradeId), sql`not ${warunekUkryty}`))
    .orderBy(desc(brokerTrades.entryTime))
    .limit(limit);
  return wiersze.map(({ bt, nazwa }) => ({
    brokerTradeId: bt.id,
    contract: bt.contract,
    direction: bt.direction,
    quantity: Number(bt.maxQty),
    entryTime: bt.entryTime.toISOString(),
    accountName: nazwa,
  }));
}

export type NettoZmienioneWiersz = {
  brokerTradeId: number;
  tradeId: number;
  contract: string;
  direction: "long" | "short";
  entryTime: string;
  matchKind: "auto" | "user" | "ai_accepted" | "created";
  /** Kwota w dzienniku teraz i netto z rachunku po ostatnim imporcie (centy). */
  bylo: number | null;
  jest: number;
};

/**
 * »Rachunek zmienil netto trade'a«: dopasowany trade, w ktorym kwota w dzienniku rozni sie od netto z rachunku (np. po Cash History).
 * Automat zmienia kwote tylko dla dopasowan »auto«; dla recznych, z sugestii i utworzonych decyduje uzytkownik (ADR-034, pkt 3).
 */
export async function nettoZmienione(limit = 50): Promise<NettoZmienioneWiersz[]> {
  const wiersze = await db
    .select({ bt: brokerTrades, kwota: trades.brokerAmount })
    .from(brokerTrades)
    .innerJoin(trades, eq(brokerTrades.tradeId, trades.id))
    .where(
      and(
        eq(brokerTrades.matchState, "matched"),
        sql`${brokerTrades.netCents} is not null`,
        sql`${trades.brokerAmount} is distinct from ${brokerTrades.netCents}`,
        sql`not ${warunekUkryty}`,
      ),
    )
    .orderBy(desc(brokerTrades.updatedAt))
    .limit(limit);
  return wiersze.map(({ bt, kwota }) => ({
    brokerTradeId: bt.id,
    tradeId: bt.tradeId as number,
    contract: bt.contract,
    direction: bt.direction,
    entryTime: bt.entryTime.toISOString(),
    matchKind: bt.matchKind as NettoZmienioneWiersz["matchKind"],
    bylo: kwota,
    jest: bt.netCents as number,
  }));
}

/** Odrzucone pliki z automatu (ostatnie 30 dni): do pokazania w »Do decyzji« z powodem. */
export async function odrzuconePliki(teraz: Date = new Date()): Promise<ImportWiersz[]> {
  const od = new Date(teraz.getTime() - 30 * DZIEN_MS);
  const wiersze = await db.select().from(brokerImports).where(and(eq(brokerImports.status, "rejected"), gte(brokerImports.createdAt, od))).orderBy(desc(brokerImports.createdAt)).limit(20);
  return wiersze.map((w) => ({
    id: w.id,
    createdAt: w.createdAt.toISOString(),
    origin: w.origin,
    format: w.format,
    status: w.status,
    fillsNew: w.fillsNew,
    fillsDuplicate: w.fillsDuplicate,
    tradesMatched: w.tradesMatched,
    tradesCreated: w.tradesCreated,
    pendingDecisions: w.pendingDecisions,
    rowsSkipped: w.rowsSkipped,
    warnings: w.warnings,
    note: w.note,
    tz: w.tz,
  }));
}

/* ------------------------------------------------------------ konta dnia */

export type KontoDnia = { id: number; name: string; type: string; category: string | null; propPhase: string | null; wybrane: boolean };

/** Aktywne konta dnia (wielokrotne) razem z lista wszystkich aktywnych kont do wyboru. */
export async function kontaDnia(dzien: string): Promise<{ day: string; konta: KontoDnia[]; wybrano: number; wczoraj: number[] }> {
  const wszystkie = await db.select().from(accounts).where(eq(accounts.archived, false)).orderBy(asc(accounts.sortOrder), asc(accounts.id));
  const wybrane = new Set((await db.select({ id: dayAccounts.accountId }).from(dayAccounts).where(eq(dayAccounts.day, dzien))).map((w) => w.id));
  const [poprzedni] = await db.select({ d: sql<string | null>`max(${dayAccounts.day})::text` }).from(dayAccounts).where(sql`${dayAccounts.day} < ${dzien}`);
  const wczoraj = poprzedni?.d ? (await db.select({ id: dayAccounts.accountId }).from(dayAccounts).where(eq(dayAccounts.day, poprzedni.d))).map((w) => w.id) : [];
  return {
    day: dzien,
    konta: wszystkie.map((k) => ({ id: k.id, name: k.name, type: k.type, category: kategoriaKonta({ type: k.type, propPhase: k.propPhase }), propPhase: k.propPhase, wybrane: wybrane.has(k.id) })),
    wybrano: wybrane.size,
    wczoraj: wczoraj.filter((id) => wszystkie.some((k) => k.id === id)),
  };
}

export async function dzisiejszaData(): Promise<string> {
  const s = await getSettings();
  return localDate(new Date(), s?.timezone ?? "Europe/Warsaw");
}

/* ------------------------------------------------ opłaty i historia */

export type StanOplat = {
  /** Trade'y z wynikiem, dla ktorych oplaty sa nieznane (`fees IS NULL`): historia sprzed 0030 albo brak stawki. */
  bezOplat: number;
  /** Wszystkie rozstrzygniete trade'y (zamkniete z wynikiem). */
  razem: number;
  /** Kandydaci do przeliczenia: bez kwoty z rachunku. */
  doPrzeliczenia: number;
};

/** Liczba z `fees IS NULL`: ostrzezenie »czesc historii bez oplat« w statystykach (ADR-034 pkt 5). */
export async function stanOplat(): Promise<StanOplat> {
  const [w] = await db
    .select({
      razem: sql<number>`count(*) filter (where ${trades.pnl} is not null)::int`,
      bez: sql<number>`count(*) filter (where ${trades.pnl} is not null and ${trades.fees} is null and ${trades.brokerAmount} is null)::int`,
      doPrzeliczenia: sql<number>`count(*) filter (where ${trades.brokerAmount} is null and ${trades.status} = 'closed' and ${trades.exitCount} > 0)::int`,
    })
    .from(trades);
  return { bezOplat: w.bez, razem: w.razem, doPrzeliczenia: w.doPrzeliczenia };
}

export type KontoZeStawkami = {
  id: number;
  name: string;
  type: string;
  propPhase: string | null;
  feeRtMiniCents: number | null;
  feeRtMicroCents: number | null;
};

export async function kontaZeStawkami(): Promise<KontoZeStawkami[]> {
  const w = await db.select().from(accounts).where(eq(accounts.archived, false)).orderBy(asc(accounts.sortOrder), asc(accounts.id));
  return w.map((k) => ({ id: k.id, name: k.name, type: k.type, propPhase: k.propPhase, feeRtMiniCents: k.feeRtMiniCents, feeRtMicroCents: k.feeRtMicroCents }));
}

export type InstrumentZKlasa = { id: number; symbol: string; sizeClass: "mini" | "micro" | null };

export async function instrumentyZKlasa(): Promise<InstrumentZKlasa[]> {
  const w = await db.select({ id: instruments.id, symbol: instruments.symbol, sizeClass: instruments.sizeClass }).from(instruments).orderBy(asc(instruments.sortOrder));
  return w;
}

export type StanAutomatu = {
  skonfigurowane: boolean;
  /** Tokeny importu z rachunku (bez sekretu): aktywne (niewygasle, nieuniewaznione) i ostatnie uzycie. */
  tokeny: { id: number; name: string; prefix: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revoked: boolean; expired: boolean }[];
};

export async function stanAutomatu(teraz: Date = new Date()): Promise<StanAutomatu> {
  const wiersze = await db
    .select()
    .from(apiTokens)
    .where(sql`'import_broker' = any (${apiTokens.scopes})`)
    .orderBy(desc(apiTokens.createdAt))
    .limit(10);
  return {
    skonfigurowane: brokerSkonfigurowany(),
    tokeny: wiersze.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt?.toISOString() ?? null,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revoked: t.revokedAt !== null,
      expired: t.expiresAt !== null && t.expiresAt.getTime() <= teraz.getTime(),
    })),
  };
}

/** Ostatni import zapisany po `od` (ISO): do odpytywania przez »Pobierz teraz« co 3 s przez 3 minuty. */
export async function importPo(od: Date): Promise<ImportWiersz | null> {
  const [w] = await db.select().from(brokerImports).where(and(gte(brokerImports.createdAt, od), inArray(brokerImports.status, ["committed", "rejected"]))).orderBy(desc(brokerImports.createdAt)).limit(1);
  if (!w) return null;
  return {
    id: w.id,
    createdAt: w.createdAt.toISOString(),
    origin: w.origin,
    format: w.format,
    status: w.status,
    fillsNew: w.fillsNew,
    fillsDuplicate: w.fillsDuplicate,
    tradesMatched: w.tradesMatched,
    tradesCreated: w.tradesCreated,
    pendingDecisions: w.pendingDecisions,
    rowsSkipped: w.rowsSkipped,
    warnings: w.warnings,
    note: w.note,
    tz: w.tz,
  };
}

/* ---------------------------------------------- wynik netto przy trade'zie */

export type DaneRachunkuTradu = {
  /** Wynik netto trade'a w centach (`trades.pnl`). */
  pnl: number | null;
  /** Wynik wyliczony z cen minus oplaty ze stawki. */
  pnlEstimate: number | null;
  /** Oplaty oszacowane ze stawki; `null` = nieznane (historia sprzed 0030 albo brak stawki). */
  fees: number | null;
  /** `trades.broker_amount`: `null` = wynik wyliczony; liczba = wynik z rachunku. */
  brokerAmount: number | null;
  zrodlo: "wyliczony" | "z_rachunku";
  /** Roznica »poslizg i oplaty« = wynik z rachunku - wynik wyliczony (tylko dla wyniku z rachunku). */
  roznicaCenty: number | null;
  poslizgCenty: number | null;
  roznicaOplatCenty: number | null;
  brokerTradeId: number | null;
  matchKind: "auto" | "user" | "ai_accepted" | "created" | null;
  feesBrokerCents: number | null;
  feeSource: "broker" | "rate" | null;
  /** Slepa ocena: wynik zakryty, wszystkie liczby puste. */
  wynikUkryty: boolean;
};

export async function daneRachunkuTradu(tradeId: number): Promise<DaneRachunkuTradu | null> {
  // Slepa ocena: trade otwarty z werdyktem AI nie pokazuje wyniku ani rozbicia (ten sam mechanizm co API).
  if (await czyWynikUkryty(db, tradeId)) {
    const [bt] = await db.select({ id: brokerTrades.id, matchKind: brokerTrades.matchKind }).from(brokerTrades).where(eq(brokerTrades.tradeId, tradeId)).limit(1);
    return { pnl: null, pnlEstimate: null, fees: null, brokerAmount: null, zrodlo: "wyliczony", roznicaCenty: null, poslizgCenty: null, roznicaOplatCenty: null, brokerTradeId: bt?.id ?? null, matchKind: bt?.matchKind ?? null, feesBrokerCents: null, feeSource: null, wynikUkryty: true };
  }
  const [t] = await db.select({ pnl: trades.pnl, pnlEstimate: trades.pnlEstimate, fees: trades.fees, brokerAmount: trades.brokerAmount }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  if (!t) return null;
  const [bt] = await db.select({ id: brokerTrades.id, matchKind: brokerTrades.matchKind, feesCents: brokerTrades.feesCents, feeSource: brokerTrades.feeSource }).from(brokerTrades).where(eq(brokerTrades.tradeId, tradeId)).limit(1);
  const u = uzgodnij({ pnl: t.pnl, pnlEstimate: t.pnlEstimate, brokerAmount: t.brokerAmount, feesEstimate: t.fees, feesBroker: bt?.feeSource === "broker" ? bt.feesCents : null });
  return {
    pnl: t.pnl,
    pnlEstimate: t.pnlEstimate,
    fees: t.fees,
    brokerAmount: t.brokerAmount,
    zrodlo: u.zrodlo === "z_rachunku" ? "z_rachunku" : "wyliczony",
    roznicaCenty: u.roznicaCenty,
    poslizgCenty: u.poslizgCenty,
    roznicaOplatCenty: u.roznicaOplatCenty,
    brokerTradeId: bt?.id ?? null,
    matchKind: bt?.matchKind ?? null,
    feesBrokerCents: bt?.feesCents ?? null,
    feeSource: bt?.feeSource ?? null,
    wynikUkryty: false,
  };
}

export type StawkiDlaFormularza = {
  /** Stawka obowiazujaca dzis dla konta: regula prop z dnia (najnowsza z `valid_from <= dzis`), inaczej stawka konta (centy, round turn). */
  konta: Record<number, { mini: number | null; micro: number | null }>;
  /** Klasa kontraktu instrumentu (`mini` / `micro` / null). */
  instrumenty: Record<number, "mini" | "micro" | null>;
};

/**
 * Stawki do podgladu wyniku NETTO w formularzu trade'a (klient liczy `computeTrade` z `feeRtCents` = stawka[konto][klasa]).
 * Zapis i tak liczy serwer (`persistTrade`); to tylko podglad przed zapisem.
 */
export async function stawkiDlaFormularza(): Promise<StawkiDlaFormularza> {
  const dzis = await dzisiejszaData();
  const kontaWiersze = await db.select({ id: accounts.id, type: accounts.type, mini: accounts.feeRtMiniCents, micro: accounts.feeRtMicroCents }).from(accounts);
  const reguly = await db.execute<{ account_id: number; mini: string | null; micro: string | null }>(sql`
    select distinct on (account_id) account_id, fee_rt_mini_cents::text as mini, fee_rt_micro_cents::text as micro
      from prop_rules where valid_from <= ${dzis}::date order by account_id, valid_from desc`);
  const poKoncie = new Map(reguly.map((r) => [r.account_id, r]));
  const konta: StawkiDlaFormularza["konta"] = {};
  for (const k of kontaWiersze) {
    const r = k.type === "prop" ? poKoncie.get(k.id) : undefined;
    konta[k.id] = {
      mini: r?.mini != null ? Number(r.mini) : k.mini,
      micro: r?.micro != null ? Number(r.micro) : k.micro,
    };
  }
  const instr = await db.select({ id: instruments.id, klasa: instruments.sizeClass }).from(instruments);
  return { konta, instrumenty: Object.fromEntries(instr.map((i) => [i.id, i.klasa])) };
}
