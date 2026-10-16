import "server-only";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

import { opisKontaDlaAI, type KontoDlaAI } from "@/lib/brokerzy/odczyt";
import { accounts, dayAccounts } from "@/lib/db/schema";
import type { db as bazaDb } from "@/lib/db";

import type { Transakcja } from "./with-api";

/**
 * Aktywne konta dnia (ADR-034 pkt 6): wielokrotne (Slowa uzytkownika 16.10.2026: «Kilka naraz»). To ustalenie dnia, nie
 * zatwierdzenie, wiec zapisuje je rowniez aktor API (`write`). AI bierze z tego konto dla trade'ow z notatki, a z konta firme,
 * program, faze i stawke oplat; przy kilku kontach nie zgaduje, tylko czeka na dopasowanie po imporcie.
 */

type Db = Transakcja | typeof bazaDb;

export async function odczytajKontaDnia(tx: Db, dzien: string): Promise<{ day: string; accounts: KontoDlaAI[] }> {
  const wiersze = await tx.select({ id: dayAccounts.accountId }).from(dayAccounts).innerJoin(accounts, eq(dayAccounts.accountId, accounts.id)).where(eq(dayAccounts.day, dzien)).orderBy(asc(accounts.sortOrder), asc(accounts.id));
  const konta: KontoDlaAI[] = [];
  for (const w of wiersze) {
    const k = await opisKontaDlaAI(tx, w.id);
    if (k) konta.push(k);
  }
  return { day: dzien, accounts: konta };
}

export type WynikKontDnia = { ok: true; day: string; accounts: KontoDlaAI[] } | { ok: false; status: 422; kod: string; komunikat: string };

/** Zastepuje zestaw kont dnia. Puste `ids` czyści wybór (AI pyta wtedy jednym zdaniem). */
export async function zapiszKontaDnia(tx: Transakcja, dzien: string, ids: number[]): Promise<WynikKontDnia> {
  const unikalne = [...new Set(ids)];
  if (unikalne.length > 0) {
    const istniejace = await tx.select({ id: accounts.id, archived: accounts.archived }).from(accounts).where(inArray(accounts.id, unikalne));
    const znane = new Map(istniejace.map((k) => [k.id, k]));
    const brak = unikalne.filter((id) => !znane.has(id));
    if (brak.length > 0) {
      return { ok: false, status: 422, kod: "unknown_reference", komunikat: `pole accountIds: konto #${brak.join(", #")} nie istnieje (lista kont: GET /api/v2/meta).` };
    }
    const zarchiwizowane = unikalne.filter((id) => znane.get(id)?.archived);
    if (zarchiwizowane.length > 0) {
      return { ok: false, status: 422, kod: "account_archived", komunikat: `pole accountIds: konto #${zarchiwizowane.join(", #")} jest zarchiwizowane i nie może być kontem dnia.` };
    }
  }
  if (unikalne.length === 0) {
    await tx.delete(dayAccounts).where(eq(dayAccounts.day, dzien));
  } else {
    await tx.delete(dayAccounts).where(and(eq(dayAccounts.day, dzien), notInArray(dayAccounts.accountId, unikalne)));
    await tx.insert(dayAccounts).values(unikalne.map((accountId) => ({ day: dzien, accountId }))).onConflictDoNothing();
  }
  return { ok: true, ...(await odczytajKontaDnia(tx, dzien)) };
}
