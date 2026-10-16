import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { Transakcja } from "@/lib/api-v2/zapis";
import { brokerCashEvents, brokerFills, brokerTrades, instruments } from "@/lib/db/schema";
import { tradingDay } from "@/lib/domain/calc";
import { grupujWypelnienia, type TradeZGrupowania } from "@/lib/domain/brokerzy/grupowanie";
import { rdzenKontraktu } from "@/lib/domain/brokerzy/kontrakty";
import { przypiszBrutto, przypiszOplaty, type BruttoTradu } from "@/lib/domain/brokerzy/oplaty";
import type { Wypelnienie, ZdarzenieCash } from "@/lib/domain/brokerzy/typy";
import { wynikTraduBrokera, type WynikTraduBrokera } from "@/lib/domain/brokerzy/wynik";
import { instrumentSpec } from "@/lib/queries/dictionaries";
import { stawkaOplatRt } from "@/lib/trades/stawki";

import { odepnijDopasowanie, odswiezKwoteDopasowania } from "./dopasowania";

/**
 * Przeliczanie trade'ow brokera z wypelnien i Cash History (ADR-034 pkt 2). Jedna funkcja robi to samo po wgraniu pliku,
 * po cofnieciu importu i po zmianie stawek: bierze wypelnienia konta i kontraktu od ostatniego punktu plaskiej pozycji,
 * grupuje je, rozdziela oplaty, dolicza wynik brutto i zapisuje zmiany. Trade brokera zachowuje id i powiazanie z dziennikiem,
 * dopoki zachowuje klucz (id pierwszego wypelnienia wejscia).
 */

export type KontoBrokeraKontekst = {
  id: number;
  platforma: string;
  /** 12 znakow skrotu konta, ktore wchodza do `external_ref`. */
  krotki: string;
  /** Konto dziennika przypisane do tego konta u brokera (NULL = jeszcze nie). */
  kontoDziennikaId: number | null;
};

export const prefiksWypelnien = (k: KontoBrokeraKontekst): string => `${k.platforma}:${k.krotki}:`;
export const refWypelnienia = (k: KontoBrokeraKontekst, idZrodla: string): string => `${prefiksWypelnien(k)}${idZrodla}`;
export const refZdarzenia = (k: KontoBrokeraKontekst, idZrodla: string): string => `${prefiksWypelnien(k)}cash:${idZrodla}`;
export const refTradu = (k: KontoBrokeraKontekst, klucz: string): string => `brk:${prefiksWypelnien(k)}${klucz}`;

type WierszFill = typeof brokerFills.$inferSelect;
type WierszCash = typeof brokerCashEvents.$inferSelect;
export type WierszTraduBrokera = typeof brokerTrades.$inferSelect;

function naWypelnienie(w: WierszFill, k: KontoBrokeraKontekst): Wypelnienie {
  return {
    idZrodla: w.externalRef.slice(prefiksWypelnien(k).length),
    konto: "",
    kontrakt: w.contract,
    strona: w.side,
    ilosc: Number(w.qty),
    cena: Number(w.price),
    czas: w.filledAt,
    zlecenie: w.orderRef,
    raw: {},
    numerWiersza: 0,
  };
}

function naZdarzenie(w: WierszCash, k: KontoBrokeraKontekst): ZdarzenieCash {
  return {
    idZrodla: w.externalRef.slice(`${prefiksWypelnien(k)}cash:`.length),
    konto: "",
    rodzaj: w.kind,
    deltaCenty: w.deltaCents,
    kontrakt: w.contract,
    czas: w.occurredAt,
    raw: {},
    numerWiersza: 0,
  };
}

/** Poczatek okna przeliczania: wejscie trade'a, ktory obejmuje `odCzasu`, inaczej sam `odCzasu` (pozycja plaska). */
export async function poczatekOkna(tx: Transakcja, kontoId: number, kontrakt: string, odCzasu: Date): Promise<Date> {
  const [poprzedni] = await tx
    .select({ entryTime: brokerTrades.entryTime, exitTime: brokerTrades.exitTime, status: brokerTrades.status })
    .from(brokerTrades)
    .where(and(eq(brokerTrades.brokerAccountId, kontoId), eq(brokerTrades.contract, kontrakt), lte(brokerTrades.entryTime, odCzasu)))
    .orderBy(desc(brokerTrades.entryTime))
    .limit(1);
  if (poprzedni && (poprzedni.status === "open" || (poprzedni.exitTime !== null && poprzedni.exitTime.getTime() >= odCzasu.getTime()))) {
    return poprzedni.entryTime;
  }
  return odCzasu;
}

export type DomenaOkna = {
  wypelnienia: Wypelnienie[];
  wierszeFill: WierszFill[];
  zdarzenia: ZdarzenieCash[];
  trade: TradeZGrupowania[];
  oplaty: Map<string, number>;
  brutto: Map<string, BruttoTradu>;
};

/** Wczytuje wypelnienia i zdarzenia konta i kontraktu od `odCzasu` i grupuje je (bez zapisu). */
export async function wczytajDomene(tx: Transakcja, konto: KontoBrokeraKontekst, kontrakt: string, odCzasu: Date): Promise<DomenaOkna> {
  const wierszeFill = await tx
    .select()
    .from(brokerFills)
    .where(and(eq(brokerFills.brokerAccountId, konto.id), eq(brokerFills.contract, kontrakt), gte(brokerFills.filledAt, odCzasu)))
    .orderBy(asc(brokerFills.filledAt), asc(brokerFills.id));
  const wierszeCash = await tx
    .select()
    .from(brokerCashEvents)
    .where(and(eq(brokerCashEvents.brokerAccountId, konto.id), eq(brokerCashEvents.contract, kontrakt), gte(brokerCashEvents.occurredAt, odCzasu)))
    .orderBy(asc(brokerCashEvents.occurredAt), asc(brokerCashEvents.id));
  const wypelnienia = wierszeFill.map((w) => naWypelnienie(w, konto));
  const zdarzenia = wierszeCash.map((w) => naZdarzenie(w, konto));
  const trade = grupujWypelnienia(wypelnienia);
  const { poId } = przypiszOplaty(wypelnienia, zdarzenia);
  return { wypelnienia, wierszeFill, zdarzenia, trade, oplaty: poId, brutto: przypiszBrutto(trade, zdarzenia) };
}

export type InstrumentKontraktu = {
  id: number;
  tickSize: string;
  tickValue: number;
  rthFrom: string;
  rthTo: string;
  exchangeTimezone: string;
  sizeClass: "mini" | "micro" | null;
};

export async function instrumentKontraktu(tx: Transakcja, kontrakt: string): Promise<InstrumentKontraktu | null> {
  const rdzen = rdzenKontraktu(kontrakt);
  if (rdzen === null) return null;
  const [i] = await tx
    .select({
      id: instruments.id,
      tickSize: instruments.tickSize,
      tickValue: instruments.tickValue,
      rthFrom: instruments.rthFrom,
      rthTo: instruments.rthTo,
      exchangeTimezone: instruments.exchangeTimezone,
      sizeClass: instruments.sizeClass,
    })
    .from(instruments)
    .where(eq(instruments.symbol, rdzen))
    .limit(1);
  return i ?? null;
}

export function wynikDlaTradu(
  t: TradeZGrupowania,
  instrument: InstrumentKontraktu | null,
  stawka: number | null,
  domena: Pick<DomenaOkna, "oplaty" | "brutto">,
): WynikTraduBrokera {
  return wynikTraduBrokera({
    trade: t,
    instrument: instrument ? instrumentSpec(instrument) : null,
    stawkaRtCenty: stawka,
    oplatyZPliku: domena.oplaty,
    bruttoZPliku: domena.brutto.get(t.klucz) ?? null,
  });
}

/**
 * Plik z automatu zmienilby strukture trade'ow brokera, ktore uzytkownik juz dopasowal (albo automat dopasowal wczesniej): np. nowe
 * wypelnienie z przeszlosci zlaczyloby historie kontraktu. Takiego pliku automat nie stosuje; trafia do »Do decyzji« (zapisany jako
 * odrzucony) i czeka na reczny import w aplikacji (audyt bezpieczenstwa W2).
 */
export class BladAutomatu extends Error {
  constructor(komunikat: string) {
    super(komunikat);
    this.name = "BladAutomatu";
  }
}

export type OpcjePrzeliczania = {
  /** Automat: nie wolno usunac ani przebudowac dopasowanego trade'a brokera. */
  ochronaDopasowan?: boolean;
  /** Automat: kwote w trade'zie dziennika odswieza tylko dla dopasowan »auto« (reczne i z sugestii AI zmienia wylacznie uzytkownik). */
  tylkoAuto?: boolean;
};

export type SkutekOkna = {
  /** Trade'y brokera po przeliczeniu (nowe i istniejace) z flaga, czy sa nowe w tym przebiegu. */
  trade: { wiersz: WierszTraduBrokera; domena: TradeZGrupowania; nowy: boolean; zmieniony: boolean }[];
  usuniete: number;
  /** Uwagi z odpinania dopasowan (np. kwota zmieniona po dopasowaniu, wiec nie przywrocona): do pokazania uzytkownikowi. */
  uwagi: string[];
};

const rowne = (a: number | null, b: number | null): boolean => a === b;

/**
 * Przelicza okno (konto brokera, kontrakt) od `odCzasu` i zapisuje wynik. `importId` dostaja NOWE trade'y brokera
 * (przy cofaniu importu przekazujemy null).
 */
export async function przeliczOkno(
  tx: Transakcja,
  konto: KontoBrokeraKontekst,
  kontrakt: string,
  odCzasu: Date,
  importId: number | null,
  opcje: OpcjePrzeliczania = {},
): Promise<SkutekOkna> {
  const start = await poczatekOkna(tx, konto.id, kontrakt, odCzasu);
  const dom = await wczytajDomene(tx, konto, kontrakt, start);

  // 1) oplaty na wypelnieniach (fee_cents): zapisujemy tylko to, co sie zmienilo
  for (const w of dom.wierszeFill) {
    const id = w.externalRef.slice(prefiksWypelnien(konto).length);
    const nowa = dom.oplaty.get(id) ?? null;
    if (!rowne(w.feeCents, nowa)) await tx.update(brokerFills).set({ feeCents: nowa }).where(eq(brokerFills.id, w.id));
  }

  // 2) trade'y brokera
  const instrument = await instrumentKontraktu(tx, kontrakt);
  const istniejace = await tx
    .select()
    .from(brokerTrades)
    .where(and(eq(brokerTrades.brokerAccountId, konto.id), eq(brokerTrades.contract, kontrakt), gte(brokerTrades.entryTime, start)));
  const poRef = new Map(istniejace.map((t) => [t.externalRef, t]));
  const wynik: SkutekOkna = { trade: [], usuniete: 0, uwagi: [] };
  const widziane = new Set<string>();
  const fillePoId = new Map(dom.wierszeFill.map((w) => [w.externalRef.slice(prefiksWypelnien(konto).length), w]));

  for (const t of dom.trade) {
    const ref = refTradu(konto, t.klucz);
    widziane.add(ref);
    const stawka =
      konto.kontoDziennikaId !== null && instrument
        ? await stawkaOplatRt(tx, { accountId: konto.kontoDziennikaId, instrumentId: instrument.id, entryTime: t.czasWejscia })
        : null;
    const w = wynikDlaTradu(t, instrument, stawka, dom);
    const wartosci = {
      contract: kontrakt,
      instrumentId: instrument?.id ?? null,
      direction: t.kierunek,
      maxQty: String(t.maxIlosc),
      entryTime: t.czasWejscia,
      exitTime: t.czasWyjscia,
      avgEntryPrice: String(t.sredniaCenaWejscia),
      avgExitPrice: t.sredniaCenaWyjscia === null ? null : String(t.sredniaCenaWyjscia),
      status: t.status,
      grossCents: w.grossCents,
      grossSource: w.grossSource,
      feesCents: w.feesCents,
      feeSource: w.feeSource,
      netCents: w.netCents,
      tradingDay: instrument ? tradingDay(t.czasWejscia, instrument.exchangeTimezone) : tradingDay(t.czasWejscia, "America/New_York"),
    };
    const stary = poRef.get(ref);
    let wiersz: WierszTraduBrokera;
    let zmieniony = false;
    if (stary) {
      // zmiana STRUKTURY trade'a (kierunek, ilosc, czasy, ceny, status) vs zmiana samych liczb finansowych (brutto, oplaty, netto)
      const strukturalna =
        stary.instrumentId !== wartosci.instrumentId ||
        stary.direction !== wartosci.direction ||
        Number(stary.maxQty) !== t.maxIlosc ||
        stary.entryTime.getTime() !== t.czasWejscia.getTime() ||
        (stary.exitTime?.getTime() ?? null) !== (t.czasWyjscia?.getTime() ?? null) ||
        Number(stary.avgEntryPrice) !== t.sredniaCenaWejscia ||
        (stary.avgExitPrice === null ? null : Number(stary.avgExitPrice)) !== t.sredniaCenaWyjscia ||
        stary.status !== t.status;
      zmieniony =
        strukturalna ||
        !rowne(stary.grossCents, w.grossCents) ||
        stary.grossSource !== w.grossSource ||
        !rowne(stary.feesCents, w.feesCents) ||
        stary.feeSource !== w.feeSource ||
        !rowne(stary.netCents, w.netCents) ||
        stary.tradingDay !== wartosci.tradingDay;
      // Automat nie przebudowuje trade'a dopasowanego recznie, z sugestii AI ani utworzonego z danych brokera: to decyzje uzytkownika.
      // Decyzja sesji glownej (autoryzacja uzytkownika z 17.10.2026), ADR-034 odstepstwo 13.
      if (opcje.ochronaDopasowan && strukturalna && stary.tradeId !== null && stary.matchKind !== "auto") {
        throw new BladAutomatu(
          `Ten plik zmieniłby trade brokera ${stary.externalRef} (${stary.contract}, wejście ${stary.entryTime.toISOString()}) dopasowany do trade'a #${stary.tradeId} dziennika ręcznie albo z sugestii (rodzaj: ${stary.matchKind}). Automat takich plików nie stosuje. Zaimportuj plik ręcznie w aplikacji (Prop → Połączenia) i sprawdź podgląd.`,
        );
      }
      if (zmieniony) {
        const [zapisany] = await tx
          .update(brokerTrades)
          .set({ ...wartosci, updatedAt: new Date() })
          .where(eq(brokerTrades.id, stary.id))
          .returning();
        wiersz = zapisany;
      } else {
        wiersz = stary;
      }
    } else {
      const [nowy] = await tx
        .insert(brokerTrades)
        .values({ ...wartosci, brokerAccountId: konto.id, importId, externalRef: ref, matchState: "unmatched" })
        .returning();
      wiersz = nowy;
    }
    wynik.trade.push({ wiersz, domena: t, nowy: !stary, zmieniony });
  }

  // 3) trade'y, ktorych po przeliczeniu nie ma (np. po cofnieciu importu): odpinamy od dziennika i kasujemy
  for (const stary of istniejace) {
    if (widziane.has(stary.externalRef)) continue;
    // Pominiety (»Cofnij« albo »Pomin«) liczy sie jak dopasowany: odrzucenie przez uzytkownika nie moze wrocic automatem.
    // Decyzja sesji glownej (autoryzacja uzytkownika z 17.10.2026), ADR-034 odstepstwo 13.
    if (opcje.ochronaDopasowan && (stary.tradeId !== null || stary.matchState === "skipped")) {
      throw new BladAutomatu(
        `Ten plik zmieniłby trade brokera ${stary.externalRef} (${stary.contract}, wejście ${stary.entryTime.toISOString()}), który jest już dopasowany do trade'a #${stary.tradeId} dziennika: nowe wypełnienia zmieniają podział historii kontraktu na trade'y. Automat takich plików nie stosuje. Zaimportuj plik ręcznie w aplikacji (Prop → Połączenia) i sprawdź podgląd.`,
      );
    }
    if (stary.tradeId !== null) {
      const o = await odepnijDopasowanie(tx, stary, { nowyStan: "unmatched", przywrocKwote: true });
      if (o.uwaga) wynik.uwagi.push(o.uwaga);
    }
    await tx.delete(brokerTrades).where(eq(brokerTrades.id, stary.id));
    wynik.usuniete += 1;
  }

  // 4) przypisanie wypelnien do trade'ow: najpierw wszystkie wejscia, potem wszystkie wyjscia, wiec wyjscie wygrywa z wejsciem
  // (odwrocenie jednym wypelnieniem nalezy do zamykanego trade'a; wejscie nowego wynika z jego klucza #flip).
  for (const czesc of ["wejscia", "wyjscia"] as const) {
    for (const { wiersz, domena } of wynik.trade) {
      const ids = domena[czesc].map((u) => fillePoId.get(u.idZrodla)?.id).filter((x): x is number => x !== undefined);
      if (ids.length === 0) continue;
      await tx
        .update(brokerFills)
        .set({ brokerTradeId: wiersz.id })
        .where(and(inArray(brokerFills.id, ids), sql`${brokerFills.brokerTradeId} is distinct from ${wiersz.id}`));
    }
  }

  // 5) dopasowane trade'y: kwota z rachunku mogla sie zmienic (np. doszla Cash History z oplatami)
  for (const { wiersz, zmieniony } of wynik.trade) {
    if (wiersz.tradeId !== null && zmieniony && (!opcje.tylkoAuto || wiersz.matchKind === "auto")) await odswiezKwoteDopasowania(tx, wiersz);
  }
  return wynik;
}
