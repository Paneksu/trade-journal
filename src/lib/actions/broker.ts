"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { LIMIT_BAJTOW } from "@/lib/domain/brokerzy/csv";
import { requireSession } from "@/lib/auth/guard";
import type { WynikCofniecia, WynikImportu } from "@/lib/brokerzy/import";
import {
  cofnijDopasowanieUi,
  cofnijImportUi,
  dopasujPonownieUi,
  dopasujRecznieUi,
  podgladImportu,
  pominTradeBrokeraUi,
  przeliczHistorieUi,
  przypiszKontoUi,
  ustawKontaDniaUi,
  utworzTradeZBrokeraUi,
  zapiszImport,
  type PodgladHistorii,
  type WynikOperacji,
} from "@/lib/decyzje/broker";
import { db } from "@/lib/db";
import { accounts, instruments } from "@/lib/db/schema";
import { importPo, type ImportWiersz } from "@/lib/queries/broker";

/*
 * Akcje serwera danych brokera (ADR-034). Kazda za sesja (`requireSession`); zapisy jako aktor `ui` przez `lib/decyzje/broker.ts`
 * (tylko wtedy baza przyjmie reczne dopasowania, przypisanie kont i cofniecie importu). Plik CSV przychodzi w FormData,
 * serwer parsuje go w pamieci i go nie zapisuje (ani jawnie, ani zaszyfrowanego). Zadne dane z przegladarki nie sa
 * zaufane: rozmiar, kodowanie, schemat komorek i SHA-256 sprawdza serwer.
 */

export type PodgladState = { wynik?: WynikImportu; error?: string };
export type OperacjaState = { ok?: boolean; komunikat?: string; error?: string; dane?: Record<string, unknown> };

const odswiez = (): void => {
  for (const p of ["/prop", "/prop/polaczenia", "/", "/decyzje", "/trades"]) revalidatePath(p);
};

const jsonPole = <T>(w: FormDataEntryValue | null, domyslne: T): T => {
  if (typeof w !== "string" || w.trim() === "") return domyslne;
  try {
    return JSON.parse(w) as T;
  } catch {
    return domyslne;
  }
};

const ZNAKI_STREFY = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/;

type Wejscie =
  | {
      ok: true;
      bajty: Uint8Array;
      strefa: string | null;
      przypisania: Record<string, number | null>;
      odznaczone: string[];
      utworz: string[];
      pominBledne: boolean;
      oczekiwanySha: string | null;
    }
  | { ok: false; error: string };

async function wczytajPlik(d: FormData): Promise<Wejscie> {
  const plik = d.get("plik");
  if (!(plik instanceof File) || plik.size === 0) {
    return { ok: false, error: "Wybierz plik CSV z eksportu (Orders albo Cash History z Tradovate)." };
  }
  if (plik.size > LIMIT_BAJTOW) {
    return { ok: false, error: `Plik ma ${plik.size} B, a limit to ${LIMIT_BAJTOW} B (5 MB). Wyeksportuj krótszy zakres dat; plik nie został zapisany.` };
  }
  const strefaSurowa = typeof d.get("strefa") === "string" ? String(d.get("strefa")).trim() : "";
  if (strefaSurowa !== "" && !ZNAKI_STREFY.test(strefaSurowa)) {
    return { ok: false, error: `Strefa czasowa »${strefaSurowa.slice(0, 40)}« nie wygląda na nazwę IANA (np. Europe/Warsaw).` };
  }
  const przypisaniaSurowe = jsonPole<Record<string, unknown>>(d.get("przypisania"), {});
  const przypisania: Record<string, number | null> = {};
  for (const [hmac, w] of Object.entries(przypisaniaSurowe)) {
    if (!/^[0-9a-f]{64}$/.test(hmac)) continue;
    if (w === null || w === "" || w === undefined) przypisania[hmac] = null;
    else if (typeof w === "number" && Number.isInteger(w) && w > 0) przypisania[hmac] = w;
    else return { ok: false, error: `Przypisanie konta: »${String(w).slice(0, 20)}« nie jest identyfikatorem konta dziennika.` };
  }
  const listaTekstow = (w: FormDataEntryValue | null): string[] =>
    jsonPole<unknown[]>(w, []).filter((x): x is string => typeof x === "string" && x.length <= 120).slice(0, 5000);
  const sha = typeof d.get("sha256") === "string" ? String(d.get("sha256")).trim().toLowerCase() : "";
  return {
    ok: true,
    bajty: new Uint8Array(await plik.arrayBuffer()),
    strefa: strefaSurowa === "" ? null : strefaSurowa,
    przypisania,
    odznaczone: listaTekstow(d.get("odznaczone")),
    utworz: listaTekstow(d.get("utworz")),
    pominBledne: d.get("pominBledne") === "1",
    oczekiwanySha: /^[0-9a-f]{64}$/.test(sha) ? sha : null,
  };
}

/** Podglad (zero zapisow): format, konta w pliku, nowe wypelnienia i duplikaty, bledne wiersze, dopasowania 1:1 do odznaczenia. */
export async function podgladImportuAkcja(_p: PodgladState, d: FormData): Promise<PodgladState> {
  await requireSession();
  const w = await wczytajPlik(d);
  if (!w.ok) return { error: w.error };
  const wynik = await podgladImportu({
    bajty: w.bajty,
    strefa: w.strefa,
    przypisania: w.przypisania,
    pominBledneWiersze: w.pominBledne,
    oczekiwanySha: null,
  });
  return { wynik };
}

/** Zapis: serwer sprawdza SHA-256 z podgladu (plik moglby sie zmienic), zapisuje w jednej transakcji z aktorem ui. */
export async function zapiszImportAkcja(_p: PodgladState, d: FormData): Promise<PodgladState> {
  await requireSession();
  const w = await wczytajPlik(d);
  if (!w.ok) return { error: w.error };
  if (w.oczekiwanySha === null) return { error: "Brak skrótu SHA-256 z podglądu. Zrób podgląd pliku jeszcze raz." };
  const wynik = await zapiszImport({
    bajty: w.bajty,
    strefa: w.strefa,
    przypisania: w.przypisania,
    odznaczone: w.odznaczone,
    utworz: w.utworz,
    pominBledneWiersze: w.pominBledne,
    oczekiwanySha: w.oczekiwanySha,
  });
  if (wynik.ok) odswiez();
  return { wynik };
}

export async function cofnijImportAkcja(importId: number): Promise<WynikCofniecia> {
  await requireSession();
  if (!Number.isInteger(importId) || importId < 1) return { ok: false, status: 404, komunikat: "Brak identyfikatora importu." };
  const w = await cofnijImportUi(importId);
  if (w.ok) odswiez();
  return w;
}

const idPoprawne = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

function wynikOperacji(w: WynikOperacji): OperacjaState {
  return w.ok ? { ok: true, komunikat: w.komunikat, dane: w.dane } : { error: w.komunikat };
}

export async function cofnijDopasowanieAkcja(brokerTradeId: number): Promise<OperacjaState> {
  await requireSession();
  if (!idPoprawne(brokerTradeId)) return { error: "Brak identyfikatora trade'a brokera." };
  const w = await cofnijDopasowanieUi(brokerTradeId);
  if (w.ok) odswiez();
  return wynikOperacji(w);
}

export async function dopasujRecznieAkcja(brokerTradeId: number, tradeId: number): Promise<OperacjaState> {
  await requireSession();
  if (!idPoprawne(brokerTradeId) || !idPoprawne(tradeId)) return { error: "Wybierz trade z listy kandydatów." };
  const w = await dopasujRecznieUi(brokerTradeId, tradeId);
  if (w.ok) odswiez();
  return wynikOperacji(w);
}

export async function pominTradeBrokeraAkcja(brokerTradeId: number, przywroc = false): Promise<OperacjaState> {
  await requireSession();
  if (!idPoprawne(brokerTradeId)) return { error: "Brak identyfikatora trade'a brokera." };
  const w = await pominTradeBrokeraUi(brokerTradeId, przywroc);
  if (w.ok) odswiez();
  return wynikOperacji(w);
}

export async function utworzTradeZBrokeraAkcja(brokerTradeId: number): Promise<OperacjaState> {
  await requireSession();
  if (!idPoprawne(brokerTradeId)) return { error: "Brak identyfikatora trade'a brokera." };
  const w = await utworzTradeZBrokeraUi(brokerTradeId);
  if (w.ok) odswiez();
  return wynikOperacji(w);
}

/** »Dopasuj ponownie«: stosuje 1:1 dla wszystkich niedopasowanych (np. po dopisaniu trade'ow do dziennika). */
export async function dopasujPonownieAkcja(): Promise<OperacjaState> {
  await requireSession();
  const w = await dopasujPonownieUi();
  if (w.ok) odswiez();
  return wynikOperacji(w);
}

/** Przypisanie konta u brokera do konta dziennika (`accountId = null` odpina). */
export async function przypiszKontoAkcja(brokerAccountId: number, accountId: number | null): Promise<OperacjaState> {
  await requireSession();
  if (!idPoprawne(brokerAccountId) || (accountId !== null && !idPoprawne(accountId))) return { error: "Wybierz konto dziennika z listy." };
  const w = await przypiszKontoUi(brokerAccountId, accountId);
  if (w.ok) odswiez();
  return wynikOperacji(w);
}

/** »Przelicz historie z oplatami«: `zapisz = false` to podglad (nic nie zapisuje). Tylko trade'y bez kwoty z rachunku. */
export async function przeliczHistorieAkcja(zapisz: boolean): Promise<{ ok: true; podglad: PodgladHistorii; zapisano: boolean } | { ok: false; komunikat: string }> {
  await requireSession();
  const w = await przeliczHistorieUi(zapisz === true);
  if (w.ok && w.zapisano) {
    for (const p of ["/", "/stats", "/trades", "/prop", "/calendar", "/prop/polaczenia"]) revalidatePath(p);
  }
  return w;
}

/** »Pobierz teraz«: czy od chwili klikniecia przyszedl import (z automatu albo z reki). Odpytywane co 3 s przez 3 minuty. */
export async function sprawdzNowyImportAkcja(odIso: string): Promise<{ import: ImportWiersz | null }> {
  await requireSession();
  const od = new Date(odIso);
  if (Number.isNaN(od.getTime())) return { import: null };
  return { import: await importPo(od) };
}

/* ------------------------------------------------------------ konta dnia */

/** Rytual na »Dzis«: zapis aktywnych kont dnia (wielokrotne). To ustalenie dnia, wiec bez zatwierdzen. */
export async function ustawKontaDniaAkcja(dzien: string, accountIds: number[]): Promise<OperacjaState> {
  await requireSession();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dzien)) return { error: "Brak dnia. Odśwież stronę." };
  if (!Array.isArray(accountIds) || accountIds.length > 20 || !accountIds.every(idPoprawne)) return { error: "Lista kont jest nieprawidłowa." };
  const w = await ustawKontaDniaUi(dzien, accountIds);
  if (w.ok) revalidatePath("/");
  return wynikOperacji(w);
}

/* ---------------------------------------------------------------- stawki */

const centyZPola = (w: string | null | undefined): number | null | undefined => {
  if (w === null || w === undefined || w.trim() === "") return null;
  const n = Number(w.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 1000) return undefined;
  return Math.round(n * 100);
};

/** Stawki oplat konta nie-prop (round turn za kontrakt, USD): mini i micro. Dla kont prop stawka idzie z reguly (przypiecie presetu). */
export async function zapiszStawkiKontaAkcja(accountId: number, mini: string, micro: string): Promise<OperacjaState> {
  await requireSession();
  if (!idPoprawne(accountId)) return { error: "Wybierz konto." };
  const m = centyZPola(mini);
  const u = centyZPola(micro);
  if (m === undefined || u === undefined) return { error: "Stawka to kwota w dolarach od 0 do 1000 za kontrakt w obie strony (np. 3,50). Puste pole znaczy »brak stawki«." };
  await db.update(accounts).set({ feeRtMiniCents: m, feeRtMicroCents: u }).where(eq(accounts.id, accountId));
  for (const p of ["/settings/accounts", "/prop/polaczenia", "/trades"]) revalidatePath(p);
  return { ok: true, komunikat: "Stawki zapisane. Nowe trade'y liczą wynik netto; historię przeliczysz przyciskiem w Połączeniach." };
}

/** Klasa kontraktu instrumentu (mini / micro) dla stawki oplat. Puste = nieznana (brak stawki, wynik brutto z flaga). */
export async function ustawKlaseInstrumentuAkcja(instrumentId: number, klasa: string): Promise<OperacjaState> {
  await requireSession();
  if (!idPoprawne(instrumentId)) return { error: "Wybierz instrument." };
  if (klasa !== "mini" && klasa !== "micro" && klasa !== "") return { error: "Klasa kontraktu to mini albo micro." };
  await db.update(instruments).set({ sizeClass: klasa === "" ? null : klasa }).where(eq(instruments.id, instrumentId));
  revalidatePath("/settings/instruments");
  return { ok: true, komunikat: "Zapisano." };
}
