"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { dayNotes, userWords } from "@/lib/db/schema";
import { dzienHandlowyTeraz } from "@/lib/api-v2/prop-konta";
import { celKonfliktuNotatkiDnia } from "@/lib/trades/day-notes";

import type { ActionState } from "./settings";

/*
 * Rytuał dnia na ekranie „Dziś” (MUST 11). Zapis w tym samym miejscu co `PUT /api/v2/days/:date`
 * bez konta (notatka dnia z accountId = null): to, co wpisze AI w rytuale, i to, co wpiszesz tu,
 * jest jednym wpisem. Unieważnienie dnia to Twoje słowa (`user_words`, role `day.invalidation`),
 * zapisane bajt w bajt; zmiana = nowy wpis wskazujący poprzedni (`supersedes_id`), stary zostaje.
 */

const RYTUAL_DZIEN = /^\d{4}-\d{2}-\d{2}$/;

function pole(d: FormData, k: string): string | null {
  const w = d.get(k);
  return typeof w === "string" ? w : null;
}

function skala(d: FormData, k: string): number | null {
  const n = Number(d.get(k));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function dzienZFormularza(d: FormData): string | null {
  const dzien = pole(d, "day");
  if (!dzien || !RYTUAL_DZIEN.test(dzien)) return null;
  // Rytuał piszemy tylko na dzisiejszy dzień handlowy: wstecz to już dopisek po fakcie.
  return dzien === dzienHandlowyTeraz() ? dzien : null;
}

async function zapiszNotatke(dzien: string, wartosci: Partial<typeof dayNotes.$inferInsert>) {
  const teraz = new Date();
  await db
    .insert(dayNotes)
    .values({ day: dzien, accountId: null, backtestSessionId: null, ...wartosci, updatedAt: teraz })
    .onConflictDoUpdate({ ...celKonfliktuNotatkiDnia(null, null), set: { ...wartosci, updatedAt: teraz } });
}

export async function zapiszPrzedSesja(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const dzien = dzienZFormularza(d);
  if (!dzien) return { error: "Rytuał zapisuje się tylko na dzisiejszy dzień handlowy. Odśwież stronę." };

  const biasSurowy = pole(d, "bias");
  const bias = biasSurowy === "long" || biasSurowy === "short" || biasSurowy === "neutral" ? biasSurowy : null;
  const max = Number(d.get("maxTrades"));
  const maxTrades = Number.isInteger(max) && max >= 1 && max <= 20 ? max : null;
  if (d.get("maxTrades") && maxTrades === null) {
    return { error: `Maks. trade'ów: »${String(d.get("maxTrades"))}« - wpisz liczbę od 1 do 20.` };
  }

  await zapiszNotatke(dzien, {
    bias,
    maxTrades,
    sleep: skala(d, "sleep"),
    energy: skala(d, "energy"),
    preSession: pole(d, "preSession")?.trim() || null,
  });

  // Unieważnienie: dosłownie, bez trim (słowa użytkownika bajt w bajt). Pusty tekst nic nie zapisuje.
  // Formularz HTML wysyła nowe linie z <textarea> jako CRLF (specyfikacja form-data), choć w polu
  // użytkownik ma LF. Cofamy tylko tę zamianę przeglądarki, żeby zapisać dokładnie to, co było w polu.
  const tekst = pole(d, "invalidation")?.replace(/\r\n/g, "\n") ?? null;
  if (tekst !== null && tekst.trim().length > 0) {
    const [poprzednie] = await db
      .select({ id: userWords.id, text: userWords.text })
      .from(userWords)
      .where(and(eq(userWords.day, dzien), eq(userWords.role, "day.invalidation"), isNull(userWords.tradeId)))
      .orderBy(desc(userWords.id))
      .limit(1);
    if (!poprzednie || poprzednie.text !== tekst) {
      await db.insert(userWords).values({
        text: tekst,
        source: "ui",
        role: "day.invalidation",
        day: dzien,
        capturedAt: new Date(),
        supersedesId: poprzednie?.id ?? null,
      });
    }
  }

  revalidatePath("/");
  return { ok: true };
}

export async function zapiszPoSesji(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const dzien = dzienZFormularza(d);
  if (!dzien) return { error: "Notatka po sesji zapisuje się tylko na dzisiejszy dzień handlowy. Odśwież stronę." };
  await zapiszNotatke(dzien, {
    postSession: pole(d, "postSession")?.trim() || null,
    dayRating: skala(d, "dayRating"),
    mood: skala(d, "mood"),
  });
  revalidatePath("/");
  return { ok: true };
}
