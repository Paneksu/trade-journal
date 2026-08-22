"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { dayNotes, savedViews, screenshots } from "@/lib/db/schema";
import { deleteDayDir, deleteScreenshot, saveScreenshot } from "@/lib/screenshots";
import { isNoTradeReason, type NoTradeReason } from "@/lib/domain/day-log";
import { countTradesOnDay, countSessionTradesOnDay } from "@/lib/queries/journal";
import type { ActionState } from "./settings";

function text(d: FormData, k: string): string | null {
  const w = d.get(k);
  if (w === null) return null;
  const s = String(w).trim();
  return s === "" ? null : s;
}

function rating(d: FormData, k: string): number | null {
  const n = Number(d.get(k));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function reason(d: FormData, k: string): NoTradeReason | null {
  const w = d.get(k);
  return isNoTradeReason(w) ? w : null;
}

/* --- Dziennik dnia -------------------------------------------------------- */

/**
 * Konflikt trafia w jeden z trzech czesciowych indeksow, zaleznie od tego,
 * czy dzien nalezy do sesji backtestu, do konta, czy do zadnego z nich.
 * W Postgresie NULL != NULL, wiec kazdy przypadek potrzebuje wlasnego celu.
 */
function konflikt(accountId: number | null, sessionId: number | null) {
  if (sessionId) {
    return {
      target: [dayNotes.day, dayNotes.backtestSessionId],
      targetWhere: isNotNull(dayNotes.backtestSessionId),
    };
  }
  return accountId
    ? {
        target: [dayNotes.day, dayNotes.accountId],
        targetWhere: isNull(dayNotes.backtestSessionId),
      }
    : {
        target: dayNotes.day,
        targetWhere: and(isNull(dayNotes.accountId), isNull(dayNotes.backtestSessionId)),
      };
}

function positiveInt(d: FormData, k: string): number | null {
  const n = Number(d.get(k));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function saveDayNote(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const day = text(d, "day");
  if (!day) return { error: "Brak daty." };

  const accountId = positiveInt(d, "accountId");
  const noTrade = d.get("noTrade") !== null;

  // Dwa zrodla prawdy o dniu nie moga sobie przeczyc: albo sa trade'y,
  // albo dzien byl bez transakcji.
  if (noTrade && (await countTradesOnDay(day)) > 0) {
    return {
      error: "Tego dnia są zapisane trade'y — nie można oznaczyć go jako dnia bez transakcji.",
    };
  }

  const values = {
    day,
    accountId,
    preSession: text(d, "preSession"),
    postSession: text(d, "postSession"),
    mood: rating(d, "mood"),
    energy: rating(d, "energy"),
    dayRating: rating(d, "dayRating"),
    noTrade,
    // Odznaczenie flagi nie zostawia osieroconego powodu.
    noTradeReason: noTrade ? reason(d, "noTradeReason") : null,
    updatedAt: new Date(),
  };

  // Jeden wpis na dzien i konto - powtorny zapis nadpisuje poprzedni.
  await db
    .insert(dayNotes)
    .values(values)
    .onConflictDoUpdate({ ...konflikt(accountId, null), set: values });

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Zwraca id notatki dnia, zakladajac ja w razie potrzeby. Zrzut da sie wkleic,
 * zanim cokolwiek w notatce zostanie zapisane - i tak ma byc.
 */
async function ensureDayNote(
  day: string,
  accountId: number | null,
  sessionId: number | null,
): Promise<number> {
  const [row] = await db
    .insert(dayNotes)
    .values({ day, accountId: sessionId ? null : accountId, backtestSessionId: sessionId })
    .onConflictDoUpdate({ ...konflikt(accountId, sessionId), set: { updatedAt: new Date() } })
    .returning({ id: dayNotes.id });
  return row.id;
}

/**
 * Dzien bez sygnalu w sesji backtestu. Osobna akcja, bo w symulacji nie ma
 * nastroju ani energii - liczy sie data, powod i to, co bylo na wykresie.
 */
export async function saveBacktestDayNote(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const day = text(d, "day");
  if (!day) return { error: "Podaj datę." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Data ma mieć postać RRRR-MM-DD." };

  const sessionId = positiveInt(d, "backtestSessionId");
  if (!sessionId) return { error: "Brak sesji." };

  // Ta sama zasada co w dzienniku: trade'y sa twardszym dowodem niz znacznik.
  if ((await countSessionTradesOnDay(sessionId, day)) > 0) {
    return { error: "Ta sesja ma tego dnia zapisany trade — dzień nie był bez sygnału." };
  }

  const values = {
    day,
    accountId: null,
    backtestSessionId: sessionId,
    postSession: text(d, "postSession"),
    noTrade: true,
    noTradeReason: reason(d, "noTradeReason"),
    updatedAt: new Date(),
  };

  await db
    .insert(dayNotes)
    .values(values)
    .onConflictDoUpdate({ ...konflikt(null, sessionId), set: values });

  revalidatePath("/backtest", "layout");
  return { ok: true };
}

/** Kasuje wpis dnia razem ze zrzutami i ich plikami. */
export async function deleteDayNote(id: number): Promise<ActionState> {
  await requireSession();
  const shots = await db.select().from(screenshots).where(eq(screenshots.dayNoteId, id));

  await db.delete(dayNotes).where(eq(dayNotes.id, id));
  for (const s of shots) await deleteScreenshot(s.file, s.thumbnail);
  await deleteDayDir(id);

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Zrzuty podpiete pod dzien: z pliku albo wklejone ze schowka. */
export async function addDayScreenshots(d: FormData): Promise<ActionState> {
  await requireSession();
  const day = text(d, "day");
  if (!day) return { error: "Brak daty." };

  const files = d.getAll("shot").filter((w): w is File => w instanceof File && w.size > 0);
  if (files.length === 0) return { error: "Nie widzę obrazu do wgrania." };

  const accountId = positiveInt(d, "accountId");
  const sessionId = positiveInt(d, "backtestSessionId");
  const dayNoteId = await ensureDayNote(day, accountId, sessionId);

  const [ostatni] = await db
    .select({ sortOrder: screenshots.sortOrder })
    .from(screenshots)
    .where(eq(screenshots.dayNoteId, dayNoteId))
    .orderBy(desc(screenshots.sortOrder))
    .limit(1);
  let sortOrder = (ostatni?.sortOrder ?? -1) + 1;

  for (const file of files) {
    try {
      const saved = await saveScreenshot({ kind: "day", id: dayNoteId }, file);
      await db.insert(screenshots).values({
        dayNoteId,
        kind: "other",
        file: saved.file,
        thumbnail: saved.thumbnail,
        width: saved.width,
        height: saved.height,
        sortOrder: sortOrder++,
      });
    } catch (error) {
      return { error: `Zrzut się nie wgrał: ${(error as Error).message}` };
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeDayScreenshot(id: number): Promise<ActionState> {
  await requireSession();
  const [s] = await db.select().from(screenshots).where(eq(screenshots.id, id)).limit(1);
  if (!s || s.dayNoteId === null) return { error: "Nie ma takiego zrzutu." };

  await db.delete(screenshots).where(eq(screenshots.id, id));
  await deleteScreenshot(s.file, s.thumbnail);
  revalidatePath("/", "layout");
  return { ok: true };
}

/* --- Zapisane widoki ------------------------------------------------------ */

export async function saveView(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const name = text(d, "name");
  if (!name) return { error: "Podaj nazwę widoku." };

  const query = String(d.get("query") ?? "");
  const filters = Object.fromEntries(new URLSearchParams(query).entries());
  const columns = String(d.get("columns") ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  const isDefault = d.get("isDefault") !== null;
  if (isDefault) {
    await db.update(savedViews).set({ isDefault: false }).where(sql`true`);
  }

  await db.insert(savedViews).values({ name, filters, columns, isDefault });
  revalidatePath("/trades");
  return { ok: true };
}

export async function deleteView(id: number): Promise<ActionState> {
  await requireSession();
  await db.delete(savedViews).where(eq(savedViews.id, id));
  revalidatePath("/trades");
  return { ok: true };
}
