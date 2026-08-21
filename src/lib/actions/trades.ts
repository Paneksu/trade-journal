"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { instruments, screenshots, tradeTags, trades } from "@/lib/db/schema";
import { commissionFor, computeTrade, fromLocalInput, type Direction } from "@/lib/domain/calc";
import { cleanValues, fieldsForScope, readFromForm, validateValues } from "@/lib/fields/fields";
import { getFields, instrumentSpec } from "@/lib/queries/dictionaries";
import { deleteScreenshot, deleteTradeDir, saveScreenshot } from "@/lib/screenshots";

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

/** Kwota w formularzu podawana jest w dolarach, w bazie trzymamy centy. */
function cents(data: FormData, key: string): number | null {
  const n = number(data, key);
  return n === null ? null : Math.round(n * 100);
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

  // Puste pole prowizji oznacza "policz z katalogu instrumentow".
  const commissionRaw = cents(data, "commission");
  const commission =
    commissionRaw ?? commissionFor(contracts, Number(instrument.commissionPerContract));

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
    commission,
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
    commission,
    note: text(data, "note"),
    executionRating: integer(data, "executionRating"),
    rulesMet: data.getAll("rule").map(String),
    custom: values,
    ticks: result.ticks,
    riskTicks: result.riskTicks,
    pnlGross: result.pnlGross,
    pnlNet: result.pnlNet,
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
  const selectedTags = data
    .getAll("tag")
    .map((w) => Number(w))
    .filter((n) => Number.isInteger(n) && n > 0);
  await db.delete(tradeTags).where(eq(tradeTags.tradeId, savedId));
  if (selectedTags.length > 0) {
    await db
      .insert(tradeTags)
      .values(selectedTags.map((tagId) => ({ tradeId: savedId, tagId })))
      .onConflictDoNothing();
  }

  // --- zrzuty ---
  for (const [fieldName, kind] of [
    ["shot_before", "before"],
    ["shot_after", "after"],
  ] as const) {
    const files = data.getAll(fieldName).filter((w): w is File => w instanceof File && w.size > 0);
    for (const [i, file] of files.entries()) {
      try {
        const saved = await saveScreenshot(savedId, file);
        await db.insert(screenshots).values({
          tradeId: savedId,
          kind,
          file: saved.file,
          thumbnail: saved.thumbnail,
          width: saved.width,
          height: saved.height,
          sortOrder: i,
        });
      } catch (error) {
        return {
          ok: false,
          id: savedId,
          error: `Trade zapisany, ale zrzut się nie wgrał: ${(error as Error).message}`,
        };
      }
    }
  }

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

export async function removeScreenshot(screenshotId: number): Promise<void> {
  await requireSession();
  const [s] = await db.select().from(screenshots).where(eq(screenshots.id, screenshotId)).limit(1);
  if (!s) return;
  await db.delete(screenshots).where(eq(screenshots.id, screenshotId));
  await deleteScreenshot(s.file, s.thumbnail);
  revalidatePath(`/trades/${s.tradeId}`);
}

/** Masowe tagowanie z tabeli - dodaje albo zdejmuje tag na wielu trade'ach naraz. */
export async function tagMany(tradeIds: number[], tagId: number, add: boolean): Promise<void> {
  await requireSession();
  if (tradeIds.length === 0) return;

  if (add) {
    await db
      .insert(tradeTags)
      .values(tradeIds.map((tradeId) => ({ tradeId, tagId })))
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
