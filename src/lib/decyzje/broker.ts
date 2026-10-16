import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { zapiszKontaDnia } from "@/lib/api-v2/konta-dnia";
import { zapisJakoUi } from "@/lib/api-v2/zapis";
import { odepnijDopasowanie, odswiezKwoteDopasowania, przebiegDopasowania, zastosujDopasowanie } from "@/lib/brokerzy/dopasowania";
import {
  BladImportu,
  cofnijImport,
  domenaTraduBrokera,
  utworzTradeZDanychBrokera,
  zastosujPlikBrokera,
  type OpcjeImportu,
  type PorazkaImportu,
  type WynikCofniecia,
  type WynikImportu,
} from "@/lib/brokerzy/import";
import { przeliczOkno, poczatekOkna, type KontoBrokeraKontekst } from "@/lib/brokerzy/przeliczanie";
import { authEvents, brokerAccounts, brokerTrades, ingestSkips, trades } from "@/lib/db/schema";
import { persistTrade } from "@/lib/trades/persist";
import { stawkaOplatRt } from "@/lib/trades/stawki";
import { szkicIstniejacegoTradu } from "@/lib/trades/szkic";

/**
 * Decyzje uzytkownika o danych brokera (ADR-034): podglad i zapis importu, cofniecie importu i dopasowania, reczne
 * dopasowanie, przypisanie konta, przeliczenie historii z oplatami. Wszystko w transakcji z aktorem `ui` (`zapisJakoUi`):
 * tylko wtedy baza (triggery tj_broker_*) pozwala na reczne dopasowania i przypisanie kont; agent AI ani automat takiej
 * sciezki nie maja. Wolane z akcji serwera po `requireSession()`.
 */

export type WynikOperacji = { ok: true; komunikat: string; dane?: Record<string, unknown> } | { ok: false; komunikat: string };

const blad = (komunikat: string): WynikOperacji => ({ ok: false, komunikat });

/** Sygnal do wycofania transakcji suchego biegu (podgladu): niesie wynik, ktory ma wyjsc. */
class Wycofaj<T> extends Error {
  constructor(readonly wynik: T) {
    super("wycofanie podgladu");
  }
}

function porazkaZBledu(e: unknown): PorazkaImportu | null {
  if (e instanceof BladImportu) return { ok: false, status: e.status, kod: e.kod, komunikat: e.message };
  const kod = (e as { code?: string; cause?: { code?: string } } | null)?.code ?? (e as { cause?: { code?: string } } | null)?.cause?.code;
  if (kod === "TJ403") {
    return { ok: false, status: 422, kod: "forbidden", komunikat: "Baza odrzuciła zapis danych brokera (brak uprawnień aktora). Zaloguj się ponownie i spróbuj jeszcze raz." };
  }
  return null;
}

/**
 * PODGLAD importu: pelny import w transakcji, ktora zawsze sie wycofuje, wiec nic nie zostaje w bazie, a wynik jest dokladnie
 * taki, jaki da zapis (ta sama sciezka kodu, zero dryfu). Zawiera dopasowania 1:1 zaznaczone domyslnie, trade'y do decyzji,
 * ostrzezenia (strefa, kolejnosc) i bledne wiersze.
 */
export async function podgladImportu(o: Omit<OpcjeImportu, "pochodzenie" | "tokenId">): Promise<WynikImportu> {
  try {
    await zapisJakoUi(async (tx) => {
      const w = await zastosujPlikBrokera(tx, { ...o, pochodzenie: "ui", tokenId: null, utworz: [] });
      throw new Wycofaj(w);
    });
    throw new Error("podgladImportu: transakcja nie została wycofana");
  } catch (e) {
    if (e instanceof Wycofaj) return e.wynik as WynikImportu;
    const p = porazkaZBledu(e);
    if (p) return p;
    throw e;
  }
}

/** ZAPIS importu z UI: plik, strefa, przypisania kont, odznaczone dopasowania, trade'y do utworzenia. Jedna transakcja. */
export async function zapiszImport(o: Omit<OpcjeImportu, "pochodzenie" | "tokenId">): Promise<WynikImportu> {
  try {
    return await zapisJakoUi((tx) => zastosujPlikBrokera(tx, { ...o, pochodzenie: "ui", tokenId: null }));
  } catch (e) {
    const p = porazkaZBledu(e);
    if (p) return p;
    throw e;
  }
}

export async function cofnijImportUi(importId: number): Promise<WynikCofniecia> {
  return zapisJakoUi((tx) => cofnijImport(tx, importId));
}

/** Cofniecie JEDNEGO dopasowania z listy »Uzgodnione z rachunku«: przywraca poprzednia kwote i zostawia decyzje (nie wraca automatem). */
export async function cofnijDopasowanieUi(brokerTradeId: number): Promise<WynikOperacji> {
  return zapisJakoUi(async (tx) => {
    const [bt] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, brokerTradeId)).for("update").limit(1);
    if (!bt) return blad(`Trade brokera #${brokerTradeId} nie istnieje (import mógł zostać cofnięty). Odśwież listę.`);
    if (bt.tradeId === null) return blad(`Trade brokera #${brokerTradeId} nie jest dopasowany, więc nie ma czego cofać. Odśwież listę.`);
    const w = await odepnijDopasowanie(tx, bt, { nowyStan: "skipped", przywrocKwote: true });
    await tx.insert(authEvents).values({ kind: "broker_match_reverted", detail: { brokerTradeId, tradeId: bt.tradeId, przywrocono: w.przywrocono, skasowanoTrade: w.skasowanoTrade } });
    return {
      ok: true,
      komunikat: w.skasowanoTrade ? "Cofnięte: trade utworzony z danych brokera został usunięty." : w.przywrocono ? "Cofnięte: wynik wrócił do poprzedniego." : (w.uwaga ?? "Cofnięte."),
    };
  });
}

/** Reczne dopasowanie trade'a brokera do trade'a dziennika (wybor uzytkownika z listy kandydatow). */
export async function dopasujRecznieUi(brokerTradeId: number, tradeId: number): Promise<WynikOperacji> {
  return zapisJakoUi(async (tx) => {
    const [bt] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, brokerTradeId)).for("update").limit(1);
    if (!bt) return blad(`Trade brokera #${brokerTradeId} nie istnieje (import mógł zostać cofnięty). Odśwież listę.`);
    const w = await zastosujDopasowanie(tx, bt, tradeId, "user");
    if (!w.ok) return blad(`Nie da się dopasować: ${w.komunikat}.`);
    return { ok: true, komunikat: w.wynik.kwotaZapisana ? "Dopasowane. Wynik trade'a pochodzi teraz z rachunku." : "Dopasowane (trade brokera nie ma jeszcze kwoty netto, więc wynik się nie zmienił)." };
  });
}

/** »Pomiń« w Do decyzji: trade brokera przestaje czekac na decyzje (i nie jest ponownie dopasowywany automatem). */
export async function pominTradeBrokeraUi(brokerTradeId: number, przywroc = false): Promise<WynikOperacji> {
  return zapisJakoUi(async (tx) => {
    const [bt] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, brokerTradeId)).for("update").limit(1);
    if (!bt) return blad(`Trade brokera #${brokerTradeId} nie istnieje. Odśwież listę.`);
    if (bt.tradeId !== null) return blad(`Trade brokera #${brokerTradeId} jest dopasowany; najpierw go odepnij (Cofnij).`);
    await tx.update(brokerTrades).set({ matchState: przywroc ? "unmatched" : "skipped", updatedAt: new Date() }).where(eq(brokerTrades.id, brokerTradeId));
    return { ok: true, komunikat: przywroc ? "Wrócił do decyzji." : "Pominięty. Nie będzie dopasowywany automatycznie." };
  });
}

/** »Zaktualizuj kwote«: rachunek zmienil netto dopasowanego trade'a (np. Cash History), a automat nie rusza recznych dopasowan. */
export async function zaktualizujKwoteUi(brokerTradeId: number): Promise<WynikOperacji> {
  return zapisJakoUi(async (tx) => {
    const [bt] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, brokerTradeId)).for("update").limit(1);
    if (!bt) return blad(`Trade brokera #${brokerTradeId} nie istnieje. Odśwież listę.`);
    if (bt.tradeId === null) return blad(`Trade brokera #${brokerTradeId} nie jest dopasowany, więc nie ma czego aktualizować.`);
    const w = await odswiezKwoteDopasowania(tx, bt);
    if (w.blad) return blad(`Nie udało się zaktualizować kwoty: ${w.blad}`);
    return { ok: true, komunikat: w.zmieniono ? "Kwota w dzienniku zgadza się teraz z rachunkiem." : "Kwota w dzienniku już zgadzała się z rachunkiem, nic nie zmieniono." };
  });
}

/** Tworzy trade dziennika z danych brokera (klik uzytkownika). Ceny, czasy i wyjscia z wypelnien; bez SL, wiec R puste. */
export async function utworzTradeZBrokeraUi(brokerTradeId: number): Promise<WynikOperacji> {
  return zapisJakoUi(async (tx) => {
    const [bt] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, brokerTradeId)).for("update").limit(1);
    if (!bt) return blad(`Trade brokera #${brokerTradeId} nie istnieje. Odśwież listę.`);
    if (bt.tradeId !== null) return blad(`Trade brokera #${brokerTradeId} ma już trade w dzienniku (#${bt.tradeId}).`);
    const [ba] = await tx.select({ konto: brokerAccounts.accountId }).from(brokerAccounts).where(eq(brokerAccounts.id, bt.brokerAccountId)).limit(1);
    if (!ba || ba.konto === null) return blad("Konto u brokera nie jest przypisane do konta dziennika. Przypisz je w Połączeniach.");
    const [nagrobek] = await tx.select({ id: ingestSkips.id }).from(ingestSkips).where(eq(ingestSkips.externalRef, bt.externalRef)).limit(1);
    if (nagrobek) return blad("Ten trade został wcześniej skasowany w aplikacji (nagrobek), więc nie powstanie ponownie.");
    const domena = await domenaTraduBrokera(tx, bt);
    if (!domena) return blad("Nie udało się odtworzyć wypełnień tego trade'a (dane mogły się zmienić po cofnięciu importu).");
    const w = await utworzTradeZDanychBrokera(tx, bt, ba.konto, domena);
    if (!w.ok) return blad(`Trade nie powstał: ${w.komunikat}.`);
    return { ok: true, komunikat: `Utworzono trade #${w.tradeId} z danych rachunku.`, dane: { tradeId: w.tradeId } };
  });
}

/** »Dopasuj ponownie«: stosuje dopasowania 1:1 dla wszystkich niedopasowanych trade'ow brokera (np. po dopisaniu trade'ow do dziennika). */
export async function dopasujPonownieUi(): Promise<WynikOperacji> {
  return zapisJakoUi(async (tx) => {
    const przebieg = await przebiegDopasowania(tx, { rodzaj: "user" });
    return {
      ok: true,
      komunikat: `Dopasowano ${przebieg.zastosowane.length}; do decyzji: ${przebieg.niejednoznaczne + przebieg.bez}.`,
      dane: { dopasowane: przebieg.zastosowane.length, niejednoznaczne: przebieg.niejednoznaczne, bez: przebieg.bez, bledy: przebieg.bledy.length },
    };
  });
}

/**
 * Przypisuje konto u brokera do konta dziennika (albo odpina: `null`). Odpiecie cofa najpierw dopasowania tego konta
 * (przywraca poprzednie kwoty); przypisanie uruchamia przeliczenie stawek i dopasowanie 1:1.
 */
export async function przypiszKontoUi(brokerAccountId: number, accountId: number | null): Promise<WynikOperacji> {
  return zapisJakoUi(async (tx) => {
    const [ba] = await tx.select().from(brokerAccounts).where(eq(brokerAccounts.id, brokerAccountId)).for("update").limit(1);
    if (!ba) return blad(`Konto u brokera #${brokerAccountId} nie istnieje. Odśwież listę.`);
    if (accountId !== null) {
      const [zajete] = await tx.select({ id: brokerAccounts.id }).from(brokerAccounts).where(and(eq(brokerAccounts.accountId, accountId), sql`${brokerAccounts.id} <> ${brokerAccountId}`)).limit(1);
      if (zajete) return blad(`Konto dziennika #${accountId} ma już przypisane inne konto u brokera. Jedno konto dziennika ma co najwyżej jedno konto u brokera; najpierw je odepnij.`);
    }
    if (ba.accountId === accountId) return { ok: true, komunikat: "Bez zmian." };

    // Dopasowania poprzedniego konta dziennika tracą sens: cofamy je z przywroceniem kwot.
    const dopasowane = await tx.select().from(brokerTrades).where(and(eq(brokerTrades.brokerAccountId, brokerAccountId), sql`${brokerTrades.tradeId} is not null`));
    for (const bt of dopasowane) await odepnijDopasowanie(tx, bt, { nowyStan: "unmatched", przywrocKwote: true });
    await tx.update(brokerTrades).set({ matchState: "unmatched", updatedAt: new Date() }).where(and(eq(brokerTrades.brokerAccountId, brokerAccountId), eq(brokerTrades.matchState, "ambiguous")));
    await tx.update(brokerAccounts).set({ accountId }).where(eq(brokerAccounts.id, brokerAccountId));
    await tx.insert(authEvents).values({ kind: "broker_account_mapped", detail: { brokerAccountId, accountId, poprzednio: ba.accountId, odpietych: dopasowane.length } });

    let dopasowano = 0;
    if (accountId !== null) {
      // stawki zaleza od konta dziennika: przeliczamy trade'y brokera, potem dopasowujemy 1:1
      const kontrakty = await tx
        .selectDistinct({ kontrakt: brokerTrades.contract })
        .from(brokerTrades)
        .where(eq(brokerTrades.brokerAccountId, brokerAccountId));
      const ctx: KontoBrokeraKontekst = { id: ba.id, platforma: ba.platform, krotki: ba.externalAccountHmac.slice(0, 12), kontoDziennikaId: accountId };
      for (const { kontrakt } of kontrakty) {
        const [pierwszy] = await tx.select({ t: brokerTrades.entryTime }).from(brokerTrades).where(and(eq(brokerTrades.brokerAccountId, brokerAccountId), eq(brokerTrades.contract, kontrakt))).orderBy(asc(brokerTrades.entryTime)).limit(1);
        if (pierwszy) await przeliczOkno(tx, ctx, kontrakt, await poczatekOkna(tx, ba.id, kontrakt, pierwszy.t), null);
      }
      const przebieg = await przebiegDopasowania(tx, { kontaBrokera: [brokerAccountId], rodzaj: "user" });
      dopasowano = przebieg.zastosowane.length;
    }
    return { ok: true, komunikat: accountId === null ? `Odpięto konto (cofnięto ${dopasowane.length} dopasowań).` : `Przypisano konto. Dopasowano ${dopasowano} trade'ów 1:1.`, dane: { dopasowano, odpietych: dopasowane.length } };
  });
}

/* ------------------------------------------------- przeliczenie historii z oplatami */

export type PodgladHistorii = {
  /** Trade'y bez kwoty z rachunku, ktore maja wyjscia (kandydaci do przeliczenia). */
  kandydaci: number;
  /** Ile z nich zmieni wynik po przeliczeniu ze stawka. */
  zmieni: number;
  /** Suma zmian wyniku w centach (ujemna: opłaty obnizaja wynik). */
  sumaRoznicyCenty: number;
  /** Trade'y, dla ktorych nie ma stawki oplat (instrument bez klasy, konto bez stawek): zostaja bez zmian. */
  bezStawki: number;
  /** Trade'y, ktorych nie da sie zapisac (np. niespojne dane): pominiete z powodem. */
  bledy: { tradeId: number; powod: string }[];
};

const MAKS_HISTORII = 5000;

/**
 * Przycisk »Przelicz historie z oplatami« (Slowa uzytkownika 16.10.2026: «Przycisk z podgladem»): przelicza przez `persistTrade`
 * WYLACZNIE trade'y bez kwoty z rachunku. `zapisz = false` to podglad (suchy bieg, nic nie zapisuje). Trade z kwota z rachunku
 * zostaje nietkniety: jego wynik jest faktem z rachunku.
 */
export async function przeliczHistorieUi(zapisz: boolean): Promise<{ ok: true; podglad: PodgladHistorii; zapisano: boolean } | { ok: false; komunikat: string }> {
  return zapisJakoUi(async (tx) => {
    const wiersze = await tx
      .select({ id: trades.id, pnl: trades.pnl, fees: trades.fees, ingestedAt: trades.ingestedAt, updatedAt: trades.updatedAt, source: trades.source, externalRef: trades.externalRef, snapshot: trades.sourceSnapshot })
      .from(trades)
      .where(and(isNull(trades.brokerAmount), eq(trades.status, "closed"), sql`${trades.exitCount} > 0`))
      .orderBy(desc(trades.id))
      .limit(MAKS_HISTORII + 1);
    if (wiersze.length > MAKS_HISTORII) {
      return { ok: false as const, komunikat: `Do przeliczenia jest ponad ${MAKS_HISTORII} trade'ów naraz. Zawęź zakres (np. przez archiwizację starych kont) albo przelicz w kilku przebiegach.` };
    }
    const podglad: PodgladHistorii = { kandydaci: wiersze.length, zmieni: 0, sumaRoznicyCenty: 0, bezStawki: 0, bledy: [] };
    for (const w of wiersze) {
      const szkic = await szkicIstniejacegoTradu(tx, w.id);
      if (!szkic) continue;
      // Wpis z API, ktorego uzytkownik nie poprawial: zachowujemy znacznik (zapis przez API nie zrobi z niego »poprawionego w aplikacji«).
      const nieruszany = w.ingestedAt !== null && w.updatedAt.getTime() <= w.ingestedAt.getTime() && w.externalRef !== null && (w.source === "tradingview" || w.source === "fxreplay");
      const meta = nieruszany ? { source: w.source as "tradingview" | "fxreplay", externalRef: w.externalRef as string, sourceSnapshot: w.snapshot } : undefined;
      const suchy = await persistTrade(szkic, meta, { tx, dryRun: true });
      if (!suchy.ok) {
        podglad.bledy.push({ tradeId: w.id, powod: suchy.error });
        continue;
      }
      const nowyPnl = suchy.podglad?.pnl ?? null;
      const roznica = nowyPnl === null || w.pnl === null ? 0 : nowyPnl - w.pnl;
      if (nowyPnl !== null && w.pnl !== null && roznica !== 0) {
        podglad.zmieni += 1;
        podglad.sumaRoznicyCenty += roznica;
      }
      // »Bez stawki« = trade zostaje brutto z flaga (instrument bez klasy kontraktu albo konto bez stawek).
      const stawka = szkic.accountId && szkic.instrumentId ? await stawkaOplatRt(tx, { accountId: szkic.accountId, instrumentId: szkic.instrumentId, entryTime: szkic.entryTime instanceof Date ? szkic.entryTime : new Date() }) : null;
      if (stawka === null) podglad.bezStawki += 1;
      if (zapisz) {
        const zapis = await persistTrade(szkic, meta, { tx });
        if (!zapis.ok) podglad.bledy.push({ tradeId: w.id, powod: zapis.error });
      }
    }
    if (zapisz) {
      await tx.insert(authEvents).values({
        kind: "broker_history_recalculated",
        detail: { kandydaci: podglad.kandydaci, zmieni: podglad.zmieni, sumaRoznicyCenty: podglad.sumaRoznicyCenty, bezStawki: podglad.bezStawki, bledy: podglad.bledy.length },
      });
    }
    return { ok: true as const, podglad, zapisano: zapisz };
  });
}

/** Aktywne konta dnia (rytual przed sesja, wielokrotne): ustalenie dnia, nie zatwierdzenie; ten sam zapis co `PUT /days/:date/accounts`. */
export async function ustawKontaDniaUi(dzien: string, accountIds: number[]): Promise<WynikOperacji> {
  return zapisJakoUi(async (tx) => {
    const w = await zapiszKontaDnia(tx, dzien, accountIds);
    if (!w.ok) return blad(w.komunikat);
    return { ok: true, komunikat: w.accounts.length === 0 ? "Wyczyszczono konta dnia." : `Konta dnia: ${w.accounts.map((k) => k.name).join(", ")}.` };
  });
}
