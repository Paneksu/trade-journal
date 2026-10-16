"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { dayNotes, savedViews, screenshots } from "@/lib/db/schema";
import { deleteDayDir, deleteScreenshot, saveScreenshot } from "@/lib/screenshots";
import { isNoTradeReason, type NoTradeReason } from "@/lib/domain/day-log";
import { czyInterwal } from "@/lib/domain/interwaly";
import { bladLimitu } from "@/lib/screenshots-limit";
import { celKonfliktuNotatkiDnia } from "@/lib/trades/day-notes";
import { countTradesOnDay, countSessionTradesOnDay } from "@/lib/queries/journal";
import { DzienZapisSchema } from "@/lib/api-v2/contract/v2";
import { zapiszNotatkeDniaUi } from "@/lib/decyzje/dzien";
import { bladWalidacji, poleLf, tekstUzytkownika } from "./walidacja";
import type { ActionState } from "./settings";

function text(d: FormData, k: string): string | null {
  const w = d.get(k);
  if (w === null) return null;
  const s = String(w).trim();
  return s === "" ? null : s;
}

function reason(d: FormData, k: string): NoTradeReason | null {
  const w = d.get(k);
  return isNoTradeReason(w) ? w : null;
}

/* --- Dziennik dnia -------------------------------------------------------- */

function positiveInt(d: FormData, k: string): number | null {
  const n = Number(d.get(k));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function saveDayNote(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const day = text(d, "day");
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Brak daty." };

  // Notatka dnia jest jedna i bez konta (ADR-033; Słowa użytkownika 16.10.2026: «Tak, zawsze jedna»): pole accountId
  // z formularza jest ignorowane. Dzień sesji backtestu ma osobną akcję (saveBacktestDayNote).
  const noTrade = d.get("noTrade") !== null;

  // Dwa źródła prawdy o dniu nie mogą sobie przeczyć: albo są trade'y, albo dzień był bez transakcji.
  if (noTrade && (await countTradesOnDay(day)) > 0) {
    return {
      error: "Tego dnia są zapisane trade'y — nie można oznaczyć go jako dnia bez transakcji.",
    };
  }

  // Walidacja tym samym schematem co PUT /api/v2/days/:date (audyt pkt 5) i teksty bez NUL.
  const skala = (k: string) => {
    const w = d.get(k);
    return w === null || w === "" ? null : Number(w);
  };
  const pola = DzienZapisSchema.safeParse({
    preSession: poleLf(d, "preSession")?.trim() || null,
    postSession: poleLf(d, "postSession")?.trim() || null,
    mood: skala("mood"),
    energy: skala("energy"),
    dayRating: skala("dayRating"),
    noTrade,
    // Odznaczenie flagi nie zostawia osieroconego powodu.
    noTradeReason: noTrade ? reason(d, "noTradeReason") : null,
  });
  if (!pola.success) return { error: bladWalidacji(pola.error, { preSession: "Przed sesją", postSession: "Po sesji", mood: "Nastrój", energy: "Energia", dayRating: "Ocena dnia" }) };
  for (const [nazwa, t] of [["Przed sesją", pola.data.preSession], ["Po sesji", pola.data.postSession]] as const) {
    if (!t) continue;
    const s = tekstUzytkownika(20_000).safeParse(t);
    if (!s.success) return { error: bladWalidacji(s.error, { "": nazwa }) };
  }
  const { preSession, postSession, mood, energy, dayRating, noTradeReason } = pola.data;
  const wersja = d.get("wersja");
  const w = await zapiszNotatkeDniaUi(
    day,
    { preSession, postSession, mood, energy, dayRating, noTrade, noTradeReason: noTradeReason as NoTradeReason | null | undefined },
    typeof wersja === "string" ? wersja : "",
    null,
    d.get("scal") === "1",
  );
  if (!w.ok) return { error: w.komunikat, konflikt: w.konflikt };

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
    // Notatka dnia dziennika jest bez konta (ADR-033, «Tak, zawsze jedna»); accountId nie wchodzi do klucza.
    .values({ day, accountId: null, backtestSessionId: sessionId })
    // Dodanie zrzutu nie zmienia treści notatki: updatedAt zostaje (review B1; formularz dnia nie dostaje fałszywego konfliktu).
    .onConflictDoUpdate({ ...celKonfliktuNotatkiDnia(null, sessionId), set: { updatedAt: sql`${dayNotes.updatedAt}` } })
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
    .onConflictDoUpdate({ ...celKonfliktuNotatkiDnia(null, sessionId), set: values });

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

  const [stan] = await db
    .select({
      ile: sql<number>`count(*)::int`,
      ostatni: sql<number>`coalesce(max(${screenshots.sortOrder}), -1)::int`,
    })
    .from(screenshots)
    .where(eq(screenshots.dayNoteId, dayNoteId));

  const limit = bladLimitu(stan.ile, files.length);
  if (limit) return { error: limit };

  // Jeden, wspolny interwal dla calej paczki - patrz komentarz przy
  // `interwalZFormularza` w lib/actions/trades.ts (ADR-015), ten sam wzor.
  const interwalRaw = text(d, "interval");
  const interval = interwalRaw !== null && czyInterwal(interwalRaw) ? interwalRaw : null;

  let sortOrder = stan.ostatni + 1;

  for (const file of files) {
    try {
      const saved = await saveScreenshot({ kind: "day", id: dayNoteId }, file);
      await db.insert(screenshots).values({
        dayNoteId,
        file: saved.file,
        thumbnail: saved.thumbnail,
        width: saved.width,
        height: saved.height,
        sortOrder: sortOrder++,
        interval,
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

/** Poprawka interwalu po fakcie - patrz `setScreenshotInterval` w actions/trades.ts (ADR-015). */
export async function setDayScreenshotInterval(id: number, interval: string): Promise<ActionState> {
  await requireSession();
  const [s] = await db.select().from(screenshots).where(eq(screenshots.id, id)).limit(1);
  if (!s || s.dayNoteId === null) return { error: "Nie ma takiego zrzutu." };
  const wartosc = interval !== "" && czyInterwal(interval) ? interval : null;
  await db.update(screenshots).set({ interval: wartosc }).where(eq(screenshots.id, id));
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
