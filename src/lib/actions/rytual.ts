"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/guard";
import { dzienHandlowyTeraz } from "@/lib/api-v2/prop-konta";
import { DzienZapisSchema } from "@/lib/api-v2/contract/v2";
import { zapiszNotatkeDniaUi } from "@/lib/decyzje/dzien";

import type { ActionState } from "./settings";
import { bladWalidacji, poleLf, tekstUzytkownika } from "./walidacja";

/*
 * Rytuał dnia na ekranie „Dziś” (MUST 11). Zapis w tym samym miejscu co `PUT /api/v2/days/:date`: jedna notatka dnia
 * bez konta (ADR-033; Słowa użytkownika 16.10.2026: «Tak, zawsze jedna»), jako aktor `ui` przez `lib/decyzje/dzien.ts`
 * (code review fazy 5, P3). Pola walidowane tym samym schematem co API (`DzienZapisSchema`, audyt pkt 5).
 * Formularz wysyła `wersja` = skrót SWOICH pól z chwili otwarcia: zmiana tych pól w tle = odmowa z opcją „scal” (P1, B1).
 * Unieważnienie dnia to Twoje słowa (`user_words`, rola `day.invalidation`), zapisane bajt w bajt; zmiana = nowy wpis
 * wskazujący poprzedni (`supersedes_id`), stary zostaje.
 */

const RYTUAL_DZIEN = /^\d{4}-\d{2}-\d{2}$/;

const NAZWY: Record<string, string> = {
  preSession: "Plan na sesję",
  postSession: "Jeden wniosek z sesji",
  bias: "Bias dnia",
  maxTrades: "Maks. trade'ów",
  sleep: "Sen",
  energy: "Energia",
  mood: "Nastrój",
  dayRating: "Ocena dnia",
};

function dzienZFormularza(d: FormData): string | null {
  const dzien = d.get("day");
  if (typeof dzien !== "string" || !RYTUAL_DZIEN.test(dzien)) return null;
  // Rytuał piszemy tylko na dzisiejszy dzień handlowy: wstecz to już dopisek po fakcie.
  return dzien === dzienHandlowyTeraz() ? dzien : null;
}

/** Skala 1–5 albo puste pole (null); inna wartość przechodzi dalej, żeby schemat odrzucił ją z komunikatem. */
function skala(d: FormData, k: string): number | null {
  const w = d.get(k);
  if (w === null || w === "") return null;
  return Number(w);
}

function wersja(d: FormData): string {
  const w = d.get("wersja");
  return typeof w === "string" ? w : "";
}

export async function zapiszPrzedSesja(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const dzien = dzienZFormularza(d);
  if (!dzien) return { error: "Rytuał zapisuje się tylko na dzisiejszy dzień handlowy. Odśwież stronę." };

  const biasSurowy = d.get("bias");
  const maxSurowy = d.get("maxTrades");
  const pola = DzienZapisSchema.safeParse({
    bias: biasSurowy === "" || biasSurowy === null ? null : biasSurowy,
    maxTrades: maxSurowy === "" || maxSurowy === null ? null : Number(maxSurowy),
    sleep: skala(d, "sleep"),
    energy: skala(d, "energy"),
    preSession: poleLf(d, "preSession")?.trim() || null,
  });
  if (!pola.success) return { error: bladWalidacji(pola.error, NAZWY) };
  if (pola.data.preSession) {
    const t = tekstUzytkownika(20_000).safeParse(pola.data.preSession);
    if (!t.success) return { error: bladWalidacji(t.error, { "": NAZWY.preSession }) };
  }

  // Unieważnienie: dosłownie, bez trim (słowa użytkownika bajt w bajt). Pusty tekst nic nie zapisuje.
  const uniew = poleLf(d, "invalidation");
  if (uniew !== null && uniew.trim().length > 0) {
    const t = tekstUzytkownika(20_000).safeParse(uniew);
    if (!t.success) return { error: bladWalidacji(t.error, { "": "Unieważnienie" }) };
  }

  const { bias, maxTrades, sleep, energy, preSession } = pola.data;
  const w = await zapiszNotatkeDniaUi(dzien, { bias, maxTrades, sleep, energy, preSession }, wersja(d), uniew, d.get("scal") === "1");
  if (!w.ok) return { error: w.komunikat, konflikt: w.konflikt };
  revalidatePath("/");
  return { ok: true };
}

export async function zapiszPoSesji(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const dzien = dzienZFormularza(d);
  if (!dzien) return { error: "Notatka po sesji zapisuje się tylko na dzisiejszy dzień handlowy. Odśwież stronę." };
  const pola = DzienZapisSchema.safeParse({
    postSession: poleLf(d, "postSession")?.trim() || null,
    dayRating: skala(d, "dayRating"),
    mood: skala(d, "mood"),
  });
  if (!pola.success) return { error: bladWalidacji(pola.error, NAZWY) };
  if (pola.data.postSession) {
    const t = tekstUzytkownika(20_000).safeParse(pola.data.postSession);
    if (!t.success) return { error: bladWalidacji(t.error, { "": NAZWY.postSession }) };
  }
  const { postSession, dayRating, mood } = pola.data;
  const w = await zapiszNotatkeDniaUi(dzien, { postSession, dayRating, mood }, wersja(d), null, d.get("scal") === "1");
  if (!w.ok) return { error: w.komunikat, konflikt: w.konflikt };
  revalidatePath("/");
  return { ok: true };
}
