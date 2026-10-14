"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { odrzucKod, odrzucWszystkieOczekujace, uniewaznToken, zatwierdzKod, znajdzKodDoZatwierdzenia } from "@/lib/api-v2/urzadzenia";
import { checkRateLimit, clearAttempts, recordFailedAttempt } from "@/lib/auth/guard";
import { requireSession } from "@/lib/auth/guard";

/*
 * Akcje strony Urzadzenia (ADR-030). Wszystkie za sesja. Zatwierdzenie
 * urzadzenia NIE nadaje nic ponad to, o co urzadzenie poprosilo, a zakresu
 * "zatwierdzaj" nie ma - agent z tokenem nigdy nie zatwierdzi reguly.
 *
 * !!! WARUNEK SCALENIA / PUBLICZNEGO WYSTAWIENIA (krytyczne z audytu):
 * TODO(faza 1): tryb sudo (ponowne haslo + TOTP) przed zatwierdzeniem urzadzenia
 * (`zatwierdzUrzadzenie`) i wpisy w `auth_events` (device_approved / device_denied /
 * token_revoked). Faza 1 jest na osobnej galezi, wiec tutaj tego nie ma. Do czasu sudo
 * `device/start` mozna zamknac zmienna DEVICE_LOGIN_DISABLED=1.
 */

export type KodWidok = {
  id: number;
  userCode: string;
  clientName: string;
  clientIp: string | null;
  requestedScopes: string[];
  createdAt: string;
  expiresAt: string;
};

export type PolaczState = {
  kod?: KodWidok;
  /** Adres przegladarki, w ktorej siedzi uzytkownik; do porownania z adresem urzadzenia. */
  ipPrzegladarki?: string;
  error?: string;
  ok?: boolean;
  wynik?: string;
};

async function ipPrzegladarki(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const wpisy = xff.split(",").map((x) => x.trim()).filter(Boolean);
    if (wpisy.length > 0) return wpisy[wpisy.length - 1];
  }
  return h.get("x-real-ip")?.trim() || "nieznany";
}

/** Zgadywanie kodow: osiem blednych prob w 10 minut blokuje to okno (jak logowanie). */
const KLUCZ_PROB = "device-approve";

export async function znajdzKod(_p: PolaczState, d: FormData): Promise<PolaczState> {
  await requireSession();
  const blokada = checkRateLimit(KLUCZ_PROB);
  if (!blokada.allowed) {
    return { error: `Za dużo błędnych kodów. Spróbuj ponownie za ${blokada.retryInS} s.` };
  }
  const wpisany = String(d.get("kod") ?? "");
  const wynik = await znajdzKodDoZatwierdzenia(wpisany);
  if (!wynik.ok) {
    recordFailedAttempt(KLUCZ_PROB);
    return { error: wynik.komunikat };
  }
  clearAttempts(KLUCZ_PROB);
  const k = wynik.kod;
  return {
    ipPrzegladarki: await ipPrzegladarki(),
    kod: {
      id: k.id,
      userCode: k.userCode,
      clientName: k.clientName,
      clientIp: k.clientIp,
      requestedScopes: k.requestedScopes,
      createdAt: k.createdAt.toISOString(),
      expiresAt: k.expiresAt.toISOString(),
    },
  };
}

export async function zatwierdzUrzadzenie(_p: PolaczState, d: FormData): Promise<PolaczState> {
  await requireSession();
  const id = Number(d.get("id"));
  if (!Number.isInteger(id) || id < 1) return { error: "Brak identyfikatora żądania." };

  if (d.get("decyzja") === "odrzuc") {
    const w = await odrzucKod(id);
    if (!w.ok) return { error: w.komunikat };
    revalidatePath("/settings/devices");
    return { ok: true, wynik: "Urządzenie odrzucone. Terminal dostanie odmowę." };
  }

  const zakresy = d.getAll("scope").map(String);
  const w = await zatwierdzKod(id, zakresy);
  if (!w.ok) return { error: w.komunikat };
  revalidatePath("/settings/devices");
  return { ok: true, wynik: `Urządzenie połączone z zakresami: ${w.scopes.join(", ")}. Terminal odbierze token w ciągu kilku sekund.` };
}

export async function uniewaznUrzadzenie(id: number): Promise<{ ok?: boolean; error?: string }> {
  await requireSession();
  const w = await uniewaznToken(id, "ui");
  if (!w.ok) return { error: w.komunikat };
  revalidatePath("/settings/devices");
  return { ok: true };
}

/** Odrzuca wszystkie oczekujące żądania logowania urządzeń (bez kodów); za sesją. */
export async function odrzucOczekujace(): Promise<{ ok?: boolean; error?: string; odrzucono?: number }> {
  await requireSession();
  const ile = await odrzucWszystkieOczekujace();
  revalidatePath("/settings/devices");
  return { ok: true, odrzucono: ile };
}
