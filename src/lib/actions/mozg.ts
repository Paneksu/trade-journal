"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/guard";
import { poprawInterpretacje, poprawSlowa, utworzNotatkeUi, zmienNotatkeUi } from "@/lib/decyzje/notatki";
import { KorektaInterpretacjiSchema } from "@/lib/api-v2/contract/funkcje";
import { NotatkaUtworzSchema, NotatkaZmienSchema } from "@/lib/api-v2/contract/v2";

import { bladWalidacji, tekstUzytkownika } from "./walidacja";

/*
 * Akcje Mózgu (UI v2, etap 2). Każda za sesją; zapis jako aktor `ui` w `lib/decyzje/notatki.ts`.
 * Teksty z <textarea> przychodzą z CRLF (form-data); cofamy tylko tę zamianę przeglądarki (jak w rytuale dnia).
 */

export type MozgState = { ok?: boolean; komunikat?: string; error?: string; rev?: number };

const lf = (w: FormDataEntryValue | null) => (typeof w === "string" ? w.replace(/\r\n/g, "\n") : "");
const liczba = (w: FormDataEntryValue | null) => {
  const n = Number(w);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function zapiszNotatke(_p: MozgState, d: FormData): Promise<MozgState> {
  await requireSession();
  const id = liczba(d.get("id"));
  const tytul = lf(d.get("tytul"));
  const tresc = lf(d.get("tresc"));
  // Walidacja tymi samymi schematami co POST/PATCH /api/v2/notes (audyt pkt 5) i teksty bez NUL.
  const nazwy = { title: "Tytuł", bodyMd: "Treść", kind: "Rodzaj" };
  const schemat = id === null ? NotatkaUtworzSchema.pick({ kind: true, title: true, bodyMd: true }) : NotatkaZmienSchema;
  const p = schemat.safeParse(id === null ? { kind: lf(d.get("kind")), title: tytul, bodyMd: tresc } : { title: tytul, bodyMd: tresc });
  if (!p.success) return { error: bladWalidacji(p.error, nazwy) };
  for (const [nazwa, t, max] of [["Tytuł", tytul, 800], ["Treść", tresc, 800_000]] as const) {
    const s = tekstUzytkownika(max).safeParse(t);
    if (!s.success) return { error: bladWalidacji(s.error, { "": nazwa }) };
  }
  if (id === null) {
    const w = await utworzNotatkeUi(lf(d.get("kind")), tytul, tresc);
    if (!w.ok) return { error: w.komunikat };
    revalidatePath("/mozg");
    redirect(`/mozg/notatki/${w.id}`);
  }
  const rev = liczba(d.get("rev"));
  if (rev === null) return { error: "Brak numeru rewizji. Odśwież stronę." };
  const w = await zmienNotatkeUi(id, rev, tytul, tresc);
  if (!w.ok) return { error: w.komunikat };
  revalidatePath(`/mozg/notatki/${id}`);
  revalidatePath("/mozg");
  redirect(`/mozg/notatki/${id}`);
}

export async function poprawSlowaAkcja(_p: MozgState, d: FormData): Promise<MozgState> {
  await requireSession();
  const id = liczba(d.get("wordsId"));
  if (id === null) return { error: "Brak identyfikatora słów." };
  const w = await poprawSlowa(id, lf(d.get("tekst")));
  if (!w.ok) return { error: w.komunikat };
  const sciezka = d.get("sciezka");
  if (typeof sciezka === "string" && sciezka.startsWith("/")) revalidatePath(sciezka);
  return { ok: true, komunikat: "Zapisano nową rewizję. Poprzednia wersja zostaje w historii." };
}

export async function poprawInterpretacjeAkcja(_p: MozgState, d: FormData): Promise<MozgState> {
  await requireSession();
  const id = liczba(d.get("wordsId"));
  if (id === null) return { error: "Brak identyfikatora słów." };
  const term = lf(d.get("haslo")).trim();
  const meaning = lf(d.get("znaczenie")).trim();
  // Te same granice co POST /api/v2/profile/corrections (audyt pkt 5); słowa korekty bez NUL.
  const p = KorektaInterpretacjiSchema.pick({ afterInterpretation: true, term: true, termMeaning: true }).safeParse({
    afterInterpretation: lf(d.get("interpretacja")),
    ...(term ? { term } : {}),
    ...(meaning ? { termMeaning: meaning } : {}),
  });
  if (!p.success) return { error: bladWalidacji(p.error, { afterInterpretation: "Interpretacja", term: "Hasło", termMeaning: "Znaczenie" }) };
  for (const [nazwa, t] of [["Twoje słowa", lf(d.get("slowa"))], ["Interpretacja", lf(d.get("interpretacja"))]] as const) {
    const s = tekstUzytkownika(80_000).safeParse(t);
    if (!s.success) return { error: bladWalidacji(s.error, { "": nazwa }) };
  }
  const w = await poprawInterpretacje(id, lf(d.get("slowa")), lf(d.get("interpretacja")), term && meaning ? { term, meaning } : undefined);
  if (!w.ok) return { error: w.komunikat };
  const sciezka = d.get("sciezka");
  if (typeof sciezka === "string" && sciezka.startsWith("/")) revalidatePath(sciezka);
  revalidatePath("/mozg/profil");
  return { ok: true, komunikat: term ? "Zapisano poprawkę. Hasło słownika czeka w „Do decyzji”." : "Zapisano poprawkę interpretacji." };
}
