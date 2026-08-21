"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { dayNotes, savedViews } from "@/lib/db/schema";
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

/* --- Dziennik dnia -------------------------------------------------------- */

export async function saveDayNote(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const day = text(d, "day");
  if (!day) return { error: "Brak daty." };

  const accountIdRaw = Number(d.get("accountId"));
  const accountId = Number.isInteger(accountIdRaw) && accountIdRaw > 0 ? accountIdRaw : null;

  const values = {
    day,
    accountId,
    preSession: text(d, "preSession"),
    postSession: text(d, "postSession"),
    mood: rating(d, "mood"),
    energy: rating(d, "energy"),
    dayRating: rating(d, "dayRating"),
    updatedAt: new Date(),
  };

  // Jeden wpis na dzien i konto - powtorny zapis nadpisuje poprzedni.
  await db
    .insert(dayNotes)
    .values(values)
    .onConflictDoUpdate({
      target: [dayNotes.day, dayNotes.accountId],
      set: values,
    });

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
