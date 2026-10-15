"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { dayNotes, instruments, trades } from "@/lib/db/schema";
import { dzienHandlowyTeraz } from "@/lib/api-v2/prop-konta";
import { getAccounts } from "@/lib/queries/dictionaries";
import { celKonfliktuNotatkiDnia } from "@/lib/trades/day-notes";

import { addDayScreenshots } from "./journal";
import { addTradeScreenshots } from "./trades";

/*
 * Szybkie wpisy z telefonu (UI v2, etap 4, PWA): arkusz „+” w dolnym pasku. Notatka DOPISUJE się do „Po sesji”
 * dzisiejszej notatki dnia (nic nie nadpisuje: nastrój, energia i plan zostają), zdjęcie idzie istniejącym
 * uploadem do dnia albo trade'u (origin = manual z domyślnej kolumny; zrzuty AI i z łącznika zostają nietknięte).
 * Konto notatki = to samo, które pokazuje kalendarz (pierwsze konto), żeby wpis był widoczny w panelu dnia.
 */

export type SzybkiStan = { ok?: boolean; komunikat?: string; error?: string };

async function kontoKalendarza(): Promise<number | null> {
  const konta = await getAccounts();
  return konta[0]?.id ?? null;
}

export async function szybkaNotatka(_p: SzybkiStan, d: FormData): Promise<SzybkiStan> {
  await requireSession();
  const surowy = d.get("tekst");
  // Słowa bajt w bajt: cofamy tylko zamianę LF -> CRLF, którą robi formularz HTML.
  const tekst = typeof surowy === "string" ? surowy.replace(/\r\n/g, "\n") : "";
  if (tekst.trim().length === 0) return { error: "Wpisz choć jedno zdanie." };
  const dzien = dzienHandlowyTeraz();
  const konto = await kontoKalendarza();
  const [obecna] = await db
    .select({ postSession: dayNotes.postSession })
    .from(dayNotes)
    .where(and(eq(dayNotes.day, dzien), konto ? eq(dayNotes.accountId, konto) : isNull(dayNotes.accountId), isNull(dayNotes.backtestSessionId)))
    .limit(1);
  const po = obecna?.postSession?.trim() ? `${obecna.postSession}\n\n${tekst}` : tekst;
  const teraz = new Date();
  await db
    .insert(dayNotes)
    .values({ day: dzien, accountId: konto, backtestSessionId: null, postSession: po, updatedAt: teraz })
    .onConflictDoUpdate({ ...celKonfliktuNotatkiDnia(konto, null), set: { postSession: po, updatedAt: teraz } });
  revalidatePath("/", "layout");
  return { ok: true, komunikat: "Dopisano do notatki dnia." };
}

export type CelZdjecia = { klucz: string; etykieta: string };

/** Cele zdjęcia: dzisiejszy dzień i 5 ostatnich trade'ów dziennika (bez sesji backtestu). */
export async function celeZdjecia(): Promise<{ dzien: string; cele: CelZdjecia[] }> {
  await requireSession();
  const dzien = dzienHandlowyTeraz();
  const ostatnie = await db
    .select({ id: trades.id, symbol: instruments.symbol, kierunek: trades.direction, dzien: trades.tradingDay })
    .from(trades)
    .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
    .where(isNull(trades.backtestSessionId))
    .orderBy(desc(trades.entryTime))
    .limit(5);
  return {
    dzien,
    cele: [
      { klucz: "dzien", etykieta: `Dzień ${dzien}` },
      ...ostatnie.map((t) => ({ klucz: `trade:${t.id}`, etykieta: `${t.symbol} ${t.kierunek} · ${t.dzien ?? ""}` })),
    ],
  };
}

export async function szybkieZdjecie(_p: SzybkiStan, d: FormData): Promise<SzybkiStan> {
  await requireSession();
  const cel = d.get("cel");
  const plik = d.get("shot");
  if (!(plik instanceof File) || plik.size === 0) return { error: "Zrób albo wybierz zdjęcie." };
  const dalej = new FormData();
  dalej.append("shot", plik);
  if (cel === "dzien") {
    dalej.append("day", dzienHandlowyTeraz());
    const konto = await kontoKalendarza();
    if (konto) dalej.append("accountId", String(konto));
    const w = await addDayScreenshots(dalej);
    return w.error ? { error: w.error } : { ok: true, komunikat: "Zdjęcie dodane do dnia." };
  }
  const m = typeof cel === "string" ? /^trade:(\d+)$/.exec(cel) : null;
  if (!m) return { error: "Wybierz, do czego dodać zdjęcie." };
  dalej.append("tradeId", m[1]);
  const w = await addTradeScreenshots(dalej);
  return w.ok ? { ok: true, komunikat: "Zdjęcie dodane do trade'u." } : { error: w.error ?? "Zdjęcie się nie wgrało." };
}
