"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { customFields, tagCategories, tags, tradeTags } from "@/lib/db/schema";
import { toKey, TYPES_WITH_OPTIONS, type FieldType } from "@/lib/fields/fields";
import type { ActionState } from "./settings";

/* Tagi i pola wlasne - czyli cala swoboda opisywania trade'a.
   Nic tu nie jest zaszyte w kodzie: kategorie, wartosci i typy pol
   definiuje uzytkownik. */

function text(d: FormData, k: string): string | null {
  const w = d.get(k);
  if (w === null) return null;
  const s = String(w).trim();
  return s === "" ? null : s;
}

function checkbox(d: FormData, k: string): boolean {
  return d.get(k) !== null;
}

function order(d: FormData, k: string): number {
  const n = Number(d.get(k));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/* --- Kategorie tagow ------------------------------------------------------ */

export async function saveTagCategory(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const id = Number(d.get("id")) || null;
  const name = text(d, "name");
  if (!name) return { error: "Podaj nazwę kategorii." };

  const key = text(d, "key") ?? toKey(name);
  if (!key) return { error: "Z tej nazwy nie da się zrobić klucza. Użyj liter łacińskich." };

  const row = { name, key, description: text(d, "description"), sortOrder: order(d, "sortOrder") };

  if (id) await db.update(tagCategories).set(row).where(eq(tagCategories.id, id));
  else await db.insert(tagCategories).values(row);

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Kasowanie kategorii kaskadowo zdejmuje jej tagi i ich przypisania do
 * trade'ow (klucz obcy `onDelete: "cascade"`). Bez tej samej blokady, co
 * `deleteTag`, kategoria bylaby furtka omijajaca zasade "tag da sie usunac
 * tylko gdy nieuzywany" - wystarczyloby skasowac kategorie zamiast tagu.
 */
export async function deleteTagCategory(id: number): Promise<ActionState> {
  await requireSession();
  const uzyc = await policzUzyciaKategorii(id);
  if (uzyc > 0) {
    return {
      error: `Kategoria ma tagi użyte w ${uzyc} trade'ach. Zarchiwizuj tagi zamiast kasować kategorię.`,
    };
  }
  await db.delete(tagCategories).where(eq(tagCategories.id, id));
  revalidatePath("/", "layout");
  return { ok: true };
}

async function policzUzyciaKategorii(categoryId: number): Promise<number> {
  const [w] = await db
    .select({ ile: sql<number>`count(*)::int` })
    .from(tradeTags)
    .innerJoin(tags, eq(tradeTags.tagId, tags.id))
    .where(eq(tags.categoryId, categoryId));
  return w?.ile ?? 0;
}

/* --- Tagi ----------------------------------------------------------------- */

export async function saveTag(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const id = Number(d.get("id")) || null;
  const categoryId = Number(d.get("categoryId"));
  const name = text(d, "name");

  if (!Number.isInteger(categoryId) || categoryId <= 0) return { error: "Wybierz kategorię." };
  if (!name) return { error: "Podaj nazwę tagu." };

  const row = {
    categoryId,
    name,
    color: text(d, "color") ?? "#8fa3b8",
    sortOrder: order(d, "sortOrder"),
    archived: checkbox(d, "archived"),
  };

  try {
    if (id) await db.update(tags).set(row).where(eq(tags.id, id));
    else await db.insert(tags).values(row);
  } catch {
    return { error: "Taki tag już jest w tej kategorii." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Kasowanie odmawia, gdy tag siedzi na choc jednym trade - inaczej usuniecie
 * definicji po cichu wyrywaloby tag z historii, a statystyki, ktore juz go
 * policzyly, zostawalyby bez wyjasnienia rozjazdu. `archiveTag` daje ten sam
 * efekt widocznosci (tag znika z wyboru przy nowych trade'ach) bez utraty
 * danych.
 */
export async function deleteTag(id: number): Promise<ActionState> {
  await requireSession();
  const [w] = await db
    .select({ ile: sql<number>`count(*)::int` })
    .from(tradeTags)
    .where(eq(tradeTags.tagId, id));
  const uzyc = w?.ile ?? 0;
  if (uzyc > 0) {
    return {
      error: `Tag jest użyty w ${uzyc} trade'ach. Zarchiwizuj go zamiast kasować.`,
    };
  }
  await db.delete(tags).where(eq(tags.id, id));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function archiveTag(id: number, archived: boolean): Promise<ActionState> {
  await requireSession();
  await db.update(tags).set({ archived }).where(eq(tags.id, id));
  revalidatePath("/", "layout");
  return { ok: true };
}

/* --- Pola wlasne ---------------------------------------------------------- */

const FIELD_TYPES: FieldType[] = [
  "text",
  "number",
  "select",
  "multiselect",
  "bool",
  "date",
  "rating",
];

export async function saveField(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const id = Number(d.get("id")) || null;
  const label = text(d, "label");
  const type = text(d, "type") as FieldType | null;

  if (!label) return { error: "Podaj nazwę pola." };
  if (!type || !FIELD_TYPES.includes(type)) return { error: "Wybierz typ pola." };

  // Klucz powstaje raz, przy zakladaniu pola. Pozniejsza zmiana odcielaby
  // wartosci zapisane przy istniejacych trade'ach.
  const key = id ? (text(d, "key") ?? "") : toKey(label);
  if (!key) return { error: "Z tej nazwy nie da się zrobić klucza. Użyj liter łacińskich." };

  const options = TYPES_WITH_OPTIONS.includes(type)
    ? String(d.get("options") ?? "")
        .split("\n")
        .map((w) => w.trim())
        .filter(Boolean)
        .map((value) => ({ value }))
    : [];

  if (TYPES_WITH_OPTIONS.includes(type) && options.length === 0) {
    return { error: "Lista wyboru potrzebuje co najmniej jednej wartości." };
  }

  const row = {
    key,
    label,
    type,
    options,
    min: text(d, "min"),
    max: text(d, "max"),
    unit: text(d, "unit"),
    hint: text(d, "hint"),
    required: checkbox(d, "required"),
    inTable: checkbox(d, "inTable"),
    inStats: checkbox(d, "inStats"),
    scope: (text(d, "scope") ?? "both") as "trade" | "backtest" | "both",
    sortOrder: order(d, "sortOrder"),
    archived: checkbox(d, "archived"),
  };

  try {
    if (id) await db.update(customFields).set(row).where(eq(customFields.id, id));
    else await db.insert(customFields).values(row);
  } catch {
    return { error: `Pole o kluczu ${key} już istnieje.` };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Pole usuwamy naprawde tylko na wyrazne zyczenie. Domyslnie archiwizujemy,
 * bo wartosci zapisane przy trade'ach zostaja w JSONB i mozna do nich wrocic.
 */
export async function deleteField(id: number): Promise<ActionState> {
  await requireSession();
  await db.delete(customFields).where(eq(customFields.id, id));
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function archiveField(id: number, archived: boolean): Promise<ActionState> {
  await requireSession();
  await db.update(customFields).set({ archived }).where(eq(customFields.id, id));
  revalidatePath("/", "layout");
  return { ok: true };
}
