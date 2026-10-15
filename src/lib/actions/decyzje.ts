"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/guard";
import { potwierdzReguleKonta } from "@/lib/decyzje/prop";
import { rozstrzygnijSprzecznosc } from "@/lib/decyzje/rozstrzygniecia";
import { cofnijSugestie, odrzucSugestie, zatwierdzSugestie, type WynikDecyzji } from "@/lib/decyzje/sugestie";
import {
  odrzucWersjeReguly,
  odrzucWersjeSetupu,
  przyjmijWersjeReguly,
  przyjmijWersjeRegulyZPoprawka,
  przyjmijWersjeSetupu,
  przyjmijWersjeSetupuZPoprawka,
} from "@/lib/decyzje/wersje";

/*
 * Akcje minimalnych ekranow decyzji (faza 2b). Kazda za sesja (requireSession) i kazda zapisuje jako
 * aktor `ui` w transakcji (lib/decyzje): tylko tak baza przepuszcza zatwierdzenie. Agent z tokenem tej
 * sciezki nie ma - to osobna warstwa, niezalezna od braku trasy w API.
 */

export type DecyzjaState = { ok?: boolean; komunikat?: string; error?: string };

function liczba(d: FormData, pole: string): number | null {
  const w = Number(d.get(pole));
  return Number.isInteger(w) && w >= 1 ? w : null;
}

function tekst(d: FormData, pole: string): string {
  const w = d.get(pole);
  return typeof w === "string" ? w : "";
}

function stan(w: WynikDecyzji): DecyzjaState {
  return w.ok ? { ok: true, komunikat: w.komunikat } : { error: w.komunikat };
}

const BRAK_ID: DecyzjaState = { error: "Brak identyfikatora pozycji. Odśwież stronę i spróbuj ponownie." };

export async function decydujORegule(_p: DecyzjaState, d: FormData): Promise<DecyzjaState> {
  await requireSession();
  const id = liczba(d, "id");
  if (id === null) return BRAK_ID;
  const decyzja = d.get("decyzja");
  let wynik: WynikDecyzji;
  if (decyzja === "przyjmij") wynik = await przyjmijWersjeReguly(id);
  else if (decyzja === "popraw") wynik = await przyjmijWersjeRegulyZPoprawka(id, tekst(d, "tekst"));
  else if (decyzja === "odrzuc") wynik = await odrzucWersjeReguly(id, tekst(d, "powod"));
  else return { error: "Nieznana decyzja. Wybierz: przyjmij, popraw i przyjmij albo odrzuć." };
  revalidatePath("/decyzje");
  return stan(wynik);
}

export async function decydujOSetupie(_p: DecyzjaState, d: FormData): Promise<DecyzjaState> {
  await requireSession();
  const id = liczba(d, "id");
  if (id === null) return BRAK_ID;
  const decyzja = d.get("decyzja");
  let wynik: WynikDecyzji;
  if (decyzja === "przyjmij") wynik = await przyjmijWersjeSetupu(id);
  else if (decyzja === "popraw") {
    const pola = ["stopRule", "targetRule", "beRule", "invalidation", "avoid"] as const;
    const poprawki: Record<string, string> = {};
    for (const p of pola) if (d.has(p)) poprawki[p] = tekst(d, p);
    wynik = await przyjmijWersjeSetupuZPoprawka(id, poprawki);
  } else if (decyzja === "odrzuc") wynik = await odrzucWersjeSetupu(id, tekst(d, "powod"));
  else return { error: "Nieznana decyzja. Wybierz: przyjmij albo odrzuć." };
  revalidatePath("/decyzje");
  return stan(wynik);
}

export async function potwierdzReguly(_p: DecyzjaState, d: FormData): Promise<DecyzjaState> {
  await requireSession();
  const id = liczba(d, "id");
  if (id === null) return BRAK_ID;
  const wynik = await potwierdzReguleKonta(id);
  revalidatePath("/decyzje");
  return stan(wynik);
}

export async function decydujOSugestii(_p: DecyzjaState, d: FormData): Promise<DecyzjaState> {
  await requireSession();
  const id = liczba(d, "id");
  if (id === null) return BRAK_ID;
  const decyzja = d.get("decyzja");
  let wynik: WynikDecyzji;
  if (decyzja === "zatwierdz") wynik = await zatwierdzSugestie(id);
  else if (decyzja === "odrzuc") wynik = await odrzucSugestie(id);
  else if (decyzja === "cofnij") wynik = await cofnijSugestie(id);
  else return { error: "Nieznana decyzja. Wybierz: zatwierdź, odrzuć albo cofnij." };
  revalidatePath("/decyzje");
  return stan(wynik);
}

export async function decydujOSprzecznosci(_p: DecyzjaState, d: FormData): Promise<DecyzjaState> {
  await requireSession();
  const id = liczba(d, "id");
  if (id === null) return BRAK_ID;
  const wynik = await rozstrzygnijSprzecznosc(id, d.get("decyzja"), tekst(d, "slowa"));
  revalidatePath("/decyzje/rozstrzygniecia");
  revalidatePath("/decyzje");
  return stan(wynik);
}
