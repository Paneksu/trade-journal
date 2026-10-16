"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { KOMUNIKAT_WYMAGANE_2FA } from "@/lib/api-v2/logowanie-urzadzen";
import { odrzucKod, odrzucWszystkieOczekujace, uniewaznToken, utworzTokenImportu, ZAKRESY_TOKENU_IMPORTU, zatwierdzKod, znajdzKodDoZatwierdzenia } from "@/lib/api-v2/urzadzenia";
import { checkRateLimit, clearAttempts, recordFailedAttempt } from "@/lib/auth/guard";
import { requireSession } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/password";
import { KOMUNIKAT_SUDO, sprawdzBlokade, stanSudo, wyczyscBlokade, zapiszNiepowodzenie, zdarzenie } from "@/lib/auth/zadanie";
import type { Settings } from "@/lib/db/schema";

/*
 * Akcje strony Urzadzenia (ADR-030). Wszystkie za sesja. Zatwierdzenie
 * urzadzenia NIE nadaje nic ponad to, o co urzadzenie poprosilo, a zakresu
 * "zatwierdzaj" nie ma - agent z tokenem nigdy nie zatwierdzi reguly.
 *
 * SUDO (ADR-031, domkniete po scaleniu z faza 1): zatwierdzenie urzadzenia i utworzenie tokenu
 * importu wymagaja trybu sudo (kod TOTP albo zapasowy, 10 minut). Gdy 2FA jest wylaczone, nie ma
 * czym podniesc uprawnien, wiec akcja sama zada hasla (stan "nie_dotyczy", jak zmiana hasla).
 * Odrzucenie i uniewaznienie sudo NIE wymagaja: odcinanie dostepu ma byc latwiejsze niz jego nadanie.
 * Kazda decyzja zostawia wpis w auth_events (bez kodow i hasel).
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

/** Czego akcja zada przed nadaniem dostepu: sudo juz aktywne, haslo (2FA wylaczone) albo wejscie w sudo. */
export type Potwierdzenie = "aktywne" | "haslo" | "sudo";

async function rodzajPotwierdzenia(s: Pick<Settings, "totpEnabledAt" | "sessionVersion">): Promise<Potwierdzenie> {
  const st = await stanSudo(s);
  return st.stan === "aktywny" ? "aktywne" : st.stan === "wymagany" ? "sudo" : "haslo";
}

/** `null` = wolno; w przeciwnym razie komunikat dla uzytkownika. Liczy bledy hasla do wspolnej blokady. */
async function wymagajPotwierdzenia(s: Settings, haslo: string): Promise<string | null> {
  const rodzaj = await rodzajPotwierdzenia(s);
  if (rodzaj === "aktywne") return null;
  if (rodzaj === "sudo") return KOMUNIKAT_SUDO;
  if (haslo === "") return "Podaj hasło, żeby potwierdzić nadanie dostępu.";
  const blokada = await sprawdzBlokade(false);
  if (blokada.zablokowany) return blokada.komunikat;
  if (!s.passwordHash || !(await verifyPassword(haslo, s.passwordHash))) {
    await zapiszNiepowodzenie(false);
    await zdarzenie("login_fail", { kontekst: "potwierdzenie_urzadzenia" });
    return "Nieprawidłowe hasło.";
  }
  await wyczyscBlokade();
  return null;
}

export type PolaczState = {
  /** Czego zada zatwierdzenie (pole hasla, wejscie w sudo albo nic). */
  potwierdzenie?: Potwierdzenie;
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
  const sesja = await requireSession();
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
    potwierdzenie: await rodzajPotwierdzenia(sesja),
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
  const sesja = await requireSession();
  const id = Number(d.get("id"));
  if (!Number.isInteger(id) || id < 1) return { error: "Brak identyfikatora żądania." };

  if (d.get("decyzja") === "odrzuc") {
    const w = await odrzucKod(id);
    if (!w.ok) return { error: w.komunikat };
    await zdarzenie("device_denied", { zadanieId: id });
    revalidatePath("/settings/devices");
    return { ok: true, wynik: "Urządzenie odrzucone. Terminal dostanie odmowę." };
  }

  const brak = await wymagajPotwierdzenia(sesja, String(d.get("haslo") ?? ""));
  if (brak) return { error: brak, potwierdzenie: await rodzajPotwierdzenia(sesja) };

  const zakresy = d.getAll("scope").map(String);
  const w = await zatwierdzKod(id, zakresy);
  if (!w.ok) return { error: w.komunikat };
  await zdarzenie("device_approved", { zadanieId: id, zakresy: w.scopes });
  revalidatePath("/settings/devices");
  return { ok: true, wynik: `Urządzenie połączone z zakresami: ${w.scopes.join(", ")}. Terminal odbierze token w ciągu kilku sekund.` };
}

export async function uniewaznUrzadzenie(id: number): Promise<{ ok?: boolean; error?: string }> {
  await requireSession();
  const w = await uniewaznToken(id, "ui");
  if (!w.ok) return { error: w.komunikat };
  await zdarzenie("token_revoked", { tokenId: id });
  revalidatePath("/settings/devices");
  return { ok: true };
}

/** Odrzuca wszystkie oczekujące żądania logowania urządzeń (bez kodów); za sesją. */
export async function odrzucOczekujace(): Promise<{ ok?: boolean; error?: string; odrzucono?: number }> {
  await requireSession();
  const ile = await odrzucWszystkieOczekujace();
  await zdarzenie("device_denied", { zbiorczo: true, odrzucono: ile });
  revalidatePath("/settings/devices");
  return { ok: true, odrzucono: ile };
}

export type TokenImportuState = { token?: string; prefix?: string; expiresAt?: string; error?: string; potwierdzenie?: Potwierdzenie };

/**
 * Jedyna droga do zakresu "import" (Slowa uzytkownika 15.10.2026): reczny przycisk w UI, za sesja.
 * Token (24 h) jest pokazywany RAZ w odpowiedzi tej akcji i nigdzie nie jest zapisany w jawnej postaci.
 * Wymaga sudo. Bez wlaczonego 2FA jest ZABLOKOWANE (Slowa uzytkownika 15.10.2026: «Zamkniete do
 * wlaczenia 2FA»; w kodzie od 17.10.2026): nie pytamy o haslo, tylko mowimy, co wlaczyc.
 */
export async function utworzTokenImportuAkcja(haslo = ""): Promise<TokenImportuState> {
  const sesja = await requireSession();
  if (!sesja.totpEnabledAt) return { error: KOMUNIKAT_WYMAGANE_2FA, potwierdzenie: "haslo" };
  const brak = await wymagajPotwierdzenia(sesja, haslo);
  if (brak) return { error: brak, potwierdzenie: await rodzajPotwierdzenia(sesja) };
  const t = await utworzTokenImportu();
  await zdarzenie("token_created", { tokenId: t.id, via: "ui", zakresy: ZAKRESY_TOKENU_IMPORTU, tokenImportu: true });
  revalidatePath("/settings/devices");
  return { token: t.token, prefix: t.prefix, expiresAt: t.expiresAt.toISOString() };
}
