import { cookies, headers } from "next/headers";

import { czyHttpsZNaglowkow } from "@/lib/ingest/http";
import { odszyfrujSekret, zaszyfrujSekret } from "./totp";
import {
  PENDING_2FA_COOKIE,
  PENDING_2FA_MAX_AGE_S,
  readScoped,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  signScoped,
  signToken,
  SUDO_COOKIE,
  SUDO_MAX_AGE_S,
} from "./token";

/* Warstwa ciasteczek. Funkcje czysto kryptograficzne siedza w `token.ts`,
   zeby proxy moglo ich uzywac bez dotykania API zadania. */

/**
 * Opcje wspolne dla wszystkich ciasteczek uwierzytelniania (ADR-031).
 *
 * Na produkcji zawsze `Secure` i `SameSite=Strict`: adres http z Coolify zostaje
 * usuniety, wiec nie ma juz powodu, dla ktorego ciasteczko mialoby isc otwartym
 * tekstem. Poza produkcja `Secure` tylko przy HTTPS (wg naglowka od proxy), zeby
 * lokalny `next dev` na http://localhost nadal dzialal.
 *
 * Koszt `Strict`: wejscie z linku z zewnatrz (np. z maila) trafia na strone bez
 * sesji i wymaga drugiego klikniecia. Dla dziennika jednoosobowego to akceptowalne.
 */
async function opcje(maxAge: number) {
  const h = await headers();
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production" || czyHttpsZNaglowkow(h),
    path: "/",
    maxAge,
  };
}

export async function setSessionCookie(version: number): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signToken(version), await opcje(SESSION_MAX_AGE_S));
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(SUDO_COOKIE);
  jar.delete(PENDING_2FA_COOKIE);
}

export async function sessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

/* --- drugi krok logowania ------------------------------------------------------ */

export async function setPendingTwoFactorCookie(version: number): Promise<void> {
  const jar = await cookies();
  jar.set(
    PENDING_2FA_COOKIE,
    signScoped("2fa", version, PENDING_2FA_MAX_AGE_S),
    await opcje(PENDING_2FA_MAX_AGE_S),
  );
}

/** Wersja sesji, dla ktorej haslo zostalo podane, albo null, gdy ciasteczko brak, wygaslo lub jest podrobione. */
export async function pendingTwoFactorVersion(): Promise<number | null> {
  const jar = await cookies();
  return readScoped("2fa", jar.get(PENDING_2FA_COOKIE)?.value)?.version ?? null;
}

export async function clearPendingTwoFactorCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(PENDING_2FA_COOKIE);
}

/* --- tryb sudo ------------------------------------------------------------------ */

export async function setSudoCookie(version: number): Promise<void> {
  const jar = await cookies();
  jar.set(SUDO_COOKIE, signScoped("sudo", version, SUDO_MAX_AGE_S), await opcje(SUDO_MAX_AGE_S));
}

export async function clearSudoCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SUDO_COOKIE);
}

/** Do kiedy (ms od epoki) trwa tryb sudo dla danej wersji sesji, albo null. */
export async function sudoValidUntil(version: number): Promise<number | null> {
  const jar = await cookies();
  const odczyt = readScoped("sudo", jar.get(SUDO_COOKIE)?.value);
  return odczyt && odczyt.version === version ? odczyt.expiresAt : null;
}

/* --- konfiguracja TOTP w toku --------------------------------------------------- */

const SETUP_COOKIE = "tj_totp_setup";
const SETUP_MAX_AGE_S = 10 * 60;

/**
 * Sekret, ktory zostal pokazany jako QR, a jeszcze nie zostal potwierdzony kodem, nie
 * trafia do bazy (CHECK w 0016 nie pozwala na sekret bez daty wlaczenia). Czeka
 * w ciasteczku HttpOnly, zaszyfrowanym tym samym kluczem co sekret w bazie, wiec
 * przegladarka nie moze go ani odczytac, ani podmienic.
 */
export async function setTotpSetupCookie(version: number, sekretBase32: string): Promise<void> {
  const jar = await cookies();
  const wygasa = Date.now() + SETUP_MAX_AGE_S * 1000;
  jar.set(
    SETUP_COOKIE,
    zaszyfrujSekret(`${version}:${wygasa}:${sekretBase32}`, undefined, "ciasteczko-konfiguracji"),
    await opcje(SETUP_MAX_AGE_S),
  );
}

export async function readTotpSetupCookie(version: number): Promise<string | null> {
  const jar = await cookies();
  const zapis = jar.get(SETUP_COOKIE)?.value;
  if (!zapis) return null;
  try {
    const [v, wygasa, sekret] = odszyfrujSekret(zapis, undefined, "ciasteczko-konfiguracji").split(":");
    if (Number(v) !== version || !(Number(wygasa) > Date.now()) || !sekret) return null;
    return sekret;
  } catch {
    return null;
  }
}

export async function clearTotpSetupCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SETUP_COOKIE);
}
