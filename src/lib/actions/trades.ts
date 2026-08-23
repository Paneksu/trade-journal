"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { instruments, screenshots, tradeTags, trades } from "@/lib/db/schema";
import { computeTrade, fromLocalInput, type Direction } from "@/lib/domain/calc";
import { czyInterwal } from "@/lib/domain/interwaly";
import { cleanValues, fieldsForScope, readFromForm, validateValues } from "@/lib/fields/fields";
import { getFields, instrumentSpec } from "@/lib/queries/dictionaries";
import { deleteScreenshot, deleteTradeDir, saveScreenshot } from "@/lib/screenshots";
import { bladLimitu } from "@/lib/screenshots-limit";

export type FormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: number;
  savedAt?: number;
};

function text(data: FormData, key: string): string | null {
  const w = data.get(key);
  if (w === null) return null;
  const s = String(w).trim();
  return s === "" ? null : s;
}

function number(data: FormData, key: string): number | null {
  const s = text(data, key);
  if (s === null) return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function integer(data: FormData, key: string): number | null {
  const n = number(data, key);
  return n === null ? null : Math.round(n);
}

/**
 * Identyfikator powiazania albo nic. Puste opcje list wyboru ("bez strategii",
 * "dziennik realny") maja wartosc 0 - bez tej zamiany baza dostaje zero
 * i odrzuca zapis na kluczu obcym.
 */
function optionalId(data: FormData, key: string): number | null {
  const n = integer(data, key);
  return n !== null && n > 0 ? n : null;
}

export async function saveTrade(_previous: FormState, data: FormData): Promise<FormState> {
  const settings = await requireSession();
  const timezone = settings.timezone;

  const id = integer(data, "id");
  const accountId = integer(data, "accountId");
  const instrumentId = integer(data, "instrumentId");
  const backtestSessionId = optionalId(data, "backtestSessionId");
  const strategyId = optionalId(data, "strategyId");
  const directionRaw = text(data, "direction");
  const statusRaw = text(data, "status") ?? "closed";

  // Limit sprawdzamy przed zapisem, zeby nie zostawic trade'a z polowa zdjec.
  const nowe = zrzutyZFormularza(data);
  const limit = bladLimitu(id ? await policzZrzuty(id) : 0, nowe.length);
  if (limit) return { ok: false, error: limit };

  if (!accountId) return { ok: false, error: "Wybierz konto." };
  if (!instrumentId) return { ok: false, error: "Wybierz instrument." };
  if (directionRaw !== "long" && directionRaw !== "short") {
    return { ok: false, error: "Wybierz kierunek pozycji." };
  }
  const direction: Direction = directionRaw;

  const [instrument] = await db
    .select()
    .from(instruments)
    .where(eq(instruments.id, instrumentId))
    .limit(1);
  if (!instrument) return { ok: false, error: "Nie znam takiego instrumentu." };

  const entryTime = fromLocalInput(text(data, "entryTime") ?? "", timezone);
  if (!entryTime) return { ok: false, error: "Podaj datę i godzinę wejścia." };

  const entryPrice = number(data, "entryPrice");
  if (entryPrice === null) return { ok: false, error: "Podaj cenę wejścia." };

  const contracts = number(data, "contracts");
  if (contracts === null || contracts <= 0) {
    return { ok: false, error: "Podaj liczbę kontraktów większą od zera." };
  }

  const exitTimeRaw = text(data, "exitTime");
  const exitTime = exitTimeRaw ? fromLocalInput(exitTimeRaw, timezone) : null;
  const exitPrice = number(data, "exitPrice");

  // Brak ceny wyjscia oznacza, ze pozycja jest wciaz otwarta - nie zmuszamy
  // uzytkownika do przelaczania statusu recznie.
  const status =
    statusRaw === "closed" && exitPrice === null
      ? "open"
      : (statusRaw as "planned" | "open" | "closed" | "cancelled");

  if (status === "closed" && !exitTime) {
    return { ok: false, error: "Trade zamknięty musi mieć datę wyjścia." };
  }
  if (exitTime && exitTime.getTime() < entryTime.getTime()) {
    return { ok: false, error: "Wyjście nie może być wcześniej niż wejście." };
  }

  const stopLoss = number(data, "stopLoss");
  const takeProfit = number(data, "takeProfit");
  const mae = number(data, "mae");
  const mfe = number(data, "mfe");

  const result = computeTrade({
    instrument: instrumentSpec(instrument),
    direction,
    contracts,
    entryPrice,
    exitPrice: status === "closed" ? exitPrice : null,
    stopLoss,
    takeProfit,
    mae,
    mfe,
    entryTime,
    exitTime: status === "closed" ? exitTime : null,
  });

  // --- pola wlasne ---
  const allFields = await getFields();
  const activeFields = fieldsForScope(allFields, backtestSessionId !== null);
  const values = cleanValues(activeFields, readFromForm(activeFields, data));
  const errors = validateValues(activeFields, values);
  if (errors.length > 0) {
    return {
      ok: false,
      error: "Popraw zaznaczone pola.",
      fieldErrors: Object.fromEntries(errors.map((b) => [b.key, b.message])),
    };
  }

  const row = {
    accountId,
    instrumentId,
    strategyId: strategyId ?? null,
    backtestSessionId: backtestSessionId ?? null,
    direction,
    status,
    entryTime,
    entryPrice: String(entryPrice),
    exitTime: status === "closed" ? exitTime : null,
    exitPrice: status === "closed" && exitPrice !== null ? String(exitPrice) : null,
    contracts: String(contracts),
    stopLoss: stopLoss === null ? null : String(stopLoss),
    takeProfit: takeProfit === null ? null : String(takeProfit),
    mae: mae === null ? null : String(mae),
    mfe: mfe === null ? null : String(mfe),
    note: text(data, "note"),
    executionRating: integer(data, "executionRating"),
    rulesMet: data.getAll("rule").map(String),
    custom: values,
    ticks: result.ticks,
    riskTicks: result.riskTicks,
    pnl: result.pnl,
    riskAmount: result.riskAmount,
    rMultiple: result.rMultiple === null ? null : result.rMultiple.toFixed(4),
    maeR: result.maeR === null ? null : result.maeR.toFixed(4),
    mfeR: result.mfeR === null ? null : result.mfeR.toFixed(4),
    durationS: result.durationS,
    marketSession: result.marketSession,
    weekday: result.weekday,
    entryHour: result.entryHour,
    tradingDay: result.tradingDay,
    updatedAt: new Date(),
  };

  let savedId: number;
  if (id) {
    await db.update(trades).set(row).where(eq(trades.id, id));
    savedId = id;
  } else {
    const [created] = await db.insert(trades).values(row).returning({ id: trades.id });
    savedId = created.id;
  }

  // --- tagi ---
  // Interwal siedzi w osobnym polu "tagint:<id>" obok checkboxa "tag" - nie
  // w jednej zakodowanej wartosci ("12:5m"), bo nazwa "tag" jest wspoldzielona
  // z filter-bar.tsx i z tagMany, ktore o interwale nic nie wiedza.
  const selectedTags = data
    .getAll("tag")
    .map((w) => Number(w))
    .filter((n) => Number.isInteger(n) && n > 0);
  await db.delete(tradeTags).where(eq(tradeTags.tradeId, savedId));
  if (selectedTags.length > 0) {
    await db
      .insert(tradeTags)
      .values(
        selectedTags.map((tagId) => {
          const raw = data.get(`tagint:${tagId}`);
          const interval = typeof raw === "string" && czyInterwal(raw) ? raw : null;
          return { tradeId: savedId, tagId, interval };
        }),
      )
      .onConflictDoNothing();
  }

  // --- zrzuty ---
  // Formularz przysyla pliki tylko przy nowym trade'cie; w edycji zrzuty leca
  // osobno przez `addTradeScreenshots`, wiec licznik zaczyna od zera dopiero
  // wtedy, gdy trade faktycznie zadnych nie ma.
  const shotError = await wgrajZrzuty(savedId, zrzutyZFormularza(data));
  if (shotError) return { ok: false, id: savedId, error: `Trade zapisany, ale ${shotError}` };

  revalidatePath("/", "layout");

  if (text(data, "stay") === "1") {
    return { ok: true, id: savedId, savedAt: Date.now() };
  }
  redirect(`/trades/${savedId}`);
}

export async function deleteTrade(id: number): Promise<void> {
  await requireSession();
  await db.delete(trades).where(eq(trades.id, id));
  await deleteTradeDir(id);
  revalidatePath("/", "layout");
  redirect("/trades");
}

/* --- Zrzuty --------------------------------------------------------------- */

function zrzutyZFormularza(data: FormData): File[] {
  return data.getAll("shot").filter((w): w is File => w instanceof File && w.size > 0);
}

async function policzZrzuty(tradeId: number): Promise<number> {
  const [w] = await db
    .select({ ile: sql<number>`count(*)::int` })
    .from(screenshots)
    .where(eq(screenshots.tradeId, tradeId));
  return w?.ile ?? 0;
}

/**
 * Zapisuje pliki i dopisuje je na koncu listy. Numeracja startuje od tego, co
 * juz lezy w bazie - inaczej zdjecie dograne pozniej wskakiwaloby na poczatek.
 * Zwraca komunikat bledu albo null.
 */
async function wgrajZrzuty(tradeId: number, files: File[]): Promise<string | null> {
  if (files.length === 0) return null;

  const [stan] = await db
    .select({ ostatni: sql<number>`coalesce(max(${screenshots.sortOrder}), -1)::int` })
    .from(screenshots)
    .where(eq(screenshots.tradeId, tradeId));
  let sortOrder = (stan?.ostatni ?? -1) + 1;

  for (const file of files) {
    try {
      const saved = await saveScreenshot({ kind: "trade", id: tradeId }, file);
      await db.insert(screenshots).values({
        tradeId,
        file: saved.file,
        thumbnail: saved.thumbnail,
        width: saved.width,
        height: saved.height,
        sortOrder: sortOrder++,
      });
    } catch (error) {
      return `zrzut się nie wgrał: ${(error as Error).message}`;
    }
  }
  return null;
}

/** Zrzuty dogrywane do istniejacego trade'a: z pliku, ze schowka albo przeciagniete. */
export async function addTradeScreenshots(data: FormData): Promise<FormState> {
  await requireSession();
  const tradeId = integer(data, "tradeId");
  if (!tradeId) return { ok: false, error: "Nie wiem, do którego trade'a przypiąć zrzut." };

  const files = zrzutyZFormularza(data);
  if (files.length === 0) return { ok: false, error: "Nie widzę obrazu do wgrania." };

  const limit = bladLimitu(await policzZrzuty(tradeId), files.length);
  if (limit) return { ok: false, error: limit };

  const blad = await wgrajZrzuty(tradeId, files);
  if (blad) return { ok: false, error: blad[0].toUpperCase() + blad.slice(1) };

  revalidatePath("/", "layout");
  return { ok: true, id: tradeId };
}

export async function removeScreenshot(screenshotId: number): Promise<FormState> {
  await requireSession();
  const [s] = await db.select().from(screenshots).where(eq(screenshots.id, screenshotId)).limit(1);
  if (!s) return { ok: false, error: "Nie ma takiego zrzutu." };
  await db.delete(screenshots).where(eq(screenshots.id, screenshotId));
  await deleteScreenshot(s.file, s.thumbnail);
  // Licznik zrzutow siedzi tez w tabeli trade'ow, wiec odswiezamy caly uklad.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Masowe tagowanie z tabeli - dodaje albo zdejmuje tag na wielu trade'ach naraz. */
export async function tagMany(tradeIds: number[], tagId: number, add: boolean): Promise<void> {
  await requireSession();
  if (tradeIds.length === 0) return;

  if (add) {
    // Tagowanie masowe z tabeli nie zna kontekstu pojedynczego trade'a, wiec
    // interwal przypisania zawsze zostaje pusty - uzytkownik dopowie go
    // recznie w karcie trade'a, jesli ma sens.
    await db
      .insert(tradeTags)
      .values(tradeIds.map((tradeId) => ({ tradeId, tagId, interval: null })))
      .onConflictDoNothing();
  } else {
    await db
      .delete(tradeTags)
      .where(and(inArray(tradeTags.tradeId, tradeIds), eq(tradeTags.tagId, tagId)));
  }
  revalidatePath("/", "layout");
}

export async function deleteMany(tradeIds: number[]): Promise<void> {
  await requireSession();
  if (tradeIds.length === 0) return;
  await db.delete(trades).where(inArray(trades.id, tradeIds));
  await Promise.all(tradeIds.map(deleteTradeDir));
  revalidatePath("/", "layout");
}
