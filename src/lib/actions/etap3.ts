"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/guard";
import { dodajWpisKsiegiUi, przypnijRegulyUi } from "@/lib/decyzje/prop";
import { zatwierdzPrzegladUi } from "@/lib/decyzje/przeglad";
import { PROP_KSIEGA_RODZAJE } from "@/lib/api-v2/contract/funkcje";

/*
 * Akcje etapu 3 UI v2: zatwierdzenie przeglądu tygodnia, przypięcie presetu prop do konta i księga kosztów.
 * Każda za sesją; zapis jako aktor `ui` w `lib/decyzje`. Kwoty z formularza w dolarach, do bazy w centach.
 */

export type Etap3State = { ok?: boolean; komunikat?: string; error?: string };

const tekst = (w: FormDataEntryValue | null) => (typeof w === "string" ? w.replace(/\r\n/g, "\n") : "");
const dataISO = (w: FormDataEntryValue | null) => (typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : null);

/** „2 500,50” albo „2500.5” -> 250050 centów; puste -> undefined; błędne -> NaN. */
function centy(w: FormDataEntryValue | null): number | undefined {
  if (typeof w !== "string" || w.trim() === "") return undefined;
  const n = Number(w.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}
function calkowita(w: FormDataEntryValue | null): number | undefined {
  if (typeof w !== "string" || w.trim() === "") return undefined;
  const n = Number(w);
  return Number.isInteger(n) ? n : Number.NaN;
}

export async function zatwierdzPrzeglad(_p: Etap3State, d: FormData): Promise<Etap3State> {
  await requireSession();
  const tydzien = dataISO(d.get("weekStart"));
  if (!tydzien) return { error: "Brak tygodnia. Odśwież stronę." };
  const r = d.get("rozliczenie");
  const rozliczenie = r === "kept" || r === "partial" || r === "broken" ? r : null;
  const w = await zatwierdzPrzegladUi(tydzien, { wnioski: tekst(d.get("wnioski")), zobowiazanie: tekst(d.get("zobowiazanie")), rozliczenie, slowaRozliczenia: tekst(d.get("slowaRozliczenia")) });
  if (!w.ok) return { error: w.komunikat };
  revalidatePath("/przeglad");
  return { ok: true, komunikat: w.komunikat };
}

export async function przypnijPreset(_p: Etap3State, d: FormData): Promise<Etap3State> {
  await requireSession();
  const konto = calkowita(d.get("accountId"));
  const od = dataISO(d.get("validFrom"));
  if (!konto || !od) return { error: "Podaj datę zakupu konta (obowiązywania reguł)." };
  const presetId = calkowita(d.get("presetId"));
  const pola = {
    maxDdCents: centy(d.get("maxDd")),
    ddLockCents: centy(d.get("ddLock")),
    dailyLossCents: centy(d.get("dailyLoss")),
    profitTargetCents: centy(d.get("profitTarget")),
    consistencyPct: (() => {
      const w = d.get("consistency");
      if (typeof w !== "string" || w.trim() === "") return undefined;
      const n = Number(w.replace(",", "."));
      return Number.isFinite(n) ? n : Number.NaN;
    })(),
    minDays: calkowita(d.get("minDays")),
    maxContractsMini: calkowita(d.get("maxMini")),
    maxContractsMicro: calkowita(d.get("maxMicro")),
  };
  for (const [k, v] of Object.entries(pola)) if (Number.isNaN(v)) return { error: `Pole ${k}: wpisz liczbę.` };
  const ddRaw = d.get("ddType");
  const ddType = ddRaw === "eod" || ddRaw === "intraday" || ddRaw === "static" || ddRaw === "trailing_to_static" ? ddRaw : undefined;
  if (!presetId && (!ddType || pola.maxDdCents === undefined)) return { error: "Bez presetu podaj typ DD i maksymalny DD." };
  const zrodlo = tekst(d.get("sourceUrl")).trim();
  const w = await przypnijRegulyUi(
    konto,
    {
      validFrom: od,
      ...(presetId ? { presetId } : {}),
      ...(ddType ? { ddType } : {}),
      ...Object.fromEntries(Object.entries(pola).filter(([, v]) => v !== undefined)),
      ...(zrodlo ? { sourceUrl: zrodlo } : {}),
    } as Parameters<typeof przypnijRegulyUi>[1],
    d.get("potwierdz") === "on",
  );
  if (!w.ok) return { error: w.komunikat };
  revalidatePath(`/prop/${konto}`);
  revalidatePath("/prop");
  return { ok: true, komunikat: w.komunikat };
}

export async function dodajWpisKsiegi(_p: Etap3State, d: FormData): Promise<Etap3State> {
  await requireSession();
  const konto = calkowita(d.get("accountId"));
  const kind = d.get("kind");
  const kwota = centy(d.get("kwota"));
  const kiedy = dataISO(d.get("occurredOn"));
  if (!konto || !kiedy) return { error: "Podaj datę wpisu." };
  if (typeof kind !== "string" || !(PROP_KSIEGA_RODZAJE as readonly string[]).includes(kind)) return { error: "Wybierz rodzaj wpisu." };
  if (kwota === undefined || Number.isNaN(kwota) || kwota === 0) return { error: "Podaj kwotę w dolarach (bez zera)." };
  // Koszt zawsze ujemny, wypłata i zwrot dodatnie: znak z rodzaju, użytkownik wpisuje samą kwotę.
  const wplyw = kind === "payout" || kind === "refund";
  const zeZnakiem = kind === "other" ? kwota : wplyw ? Math.abs(kwota) : -Math.abs(kwota);
  const w = await dodajWpisKsiegiUi(konto, { kind: kind as (typeof PROP_KSIEGA_RODZAJE)[number], amountCents: zeZnakiem, occurredOn: kiedy, note: tekst(d.get("note")).trim() || null });
  if (!w.ok) return { error: w.komunikat };
  revalidatePath(`/prop/${konto}`);
  revalidatePath("/prop");
  return { ok: true, komunikat: w.komunikat };
}
