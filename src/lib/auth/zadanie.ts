import { headers } from "next/headers";

import { adresZNaglowkow } from "@/lib/ingest/http";
import type { AuthEventKind, Settings } from "@/lib/db/schema";
import { checkRateLimit, clearAttempts, recordFailedAttempt } from "./guard";
import { zapiszZdarzenie } from "./second-factor";
import { sudoValidUntil } from "./session";

/*
 * Pomocniki dla akcji serwerowych logowania i ustawien bezpieczenstwa: adres
 * klienta, dopisywanie zdarzen z kontekstu zadania i wspolna blokada prob.
 * Czesc zalezna od `next/headers`; czysta logika siedzi w `second-factor.ts` i `totp.ts`.
 */

/** Klucz blokady: haslo, kod TOTP, kod zapasowy i sudo liczone razem (ADR-031: 8 prob). */
export async function kluczKlienta(): Promise<string> {
  return adresZNaglowkow(await headers());
}

/**
 * Globalny licznik prob drugiego skladnika. Dosiegnac drugiego kroku moze tylko ten,
 * kto zna haslo albo ma sesje, wiec sztuczne zablokowanie go nie pomaga napastnikowi
 * z zewnatrz, a odcina zgadywanie kodu z wielu adresow naraz.
 */
export const KLUCZ_GLOBALNY_2FA = "2fa:globalnie";
export const LIMIT_GLOBALNY_2FA = 30;

export type Blokada = { zablokowany: false } | { zablokowany: true; komunikat: string };

export async function sprawdzBlokade(czyDrugiSkladnik: boolean): Promise<Blokada> {
  const klucz = await kluczKlienta();
  const lokalna = checkRateLimit(klucz);
  const globalna = czyDrugiSkladnik
    ? checkRateLimit(KLUCZ_GLOBALNY_2FA, LIMIT_GLOBALNY_2FA)
    : { allowed: true, retryInS: 0 };
  if (lokalna.allowed && globalna.allowed) return { zablokowany: false };
  const sekundy = Math.max(lokalna.retryInS, globalna.retryInS);
  return {
    zablokowany: true,
    komunikat: `Za dużo prób. Spróbuj ponownie za ${Math.max(1, Math.ceil(sekundy / 60))} min.`,
  };
}

export async function zapiszNiepowodzenie(czyDrugiSkladnik: boolean): Promise<void> {
  recordFailedAttempt(await kluczKlienta());
  if (czyDrugiSkladnik) recordFailedAttempt(KLUCZ_GLOBALNY_2FA, LIMIT_GLOBALNY_2FA);
}

export async function wyczyscBlokade(): Promise<void> {
  clearAttempts(await kluczKlienta());
}

/** Dopisuje zdarzenie z adresem i przegladarka biezacego zadania. */
export async function zdarzenie(
  rodzaj: AuthEventKind,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const h = await headers();
  await zapiszZdarzenie(rodzaj, {
    ip: adresZNaglowkow(h),
    userAgent: h.get("user-agent"),
    detail,
  });
}

/**
 * Tryb sudo (ADR-031). Gdy 2FA jest wylaczone, nie ma czym podniesc uprawnien:
 * wtedy akcja musi sama wymagac hasla (tak robi zmiana hasla), a stan to "nie_dotyczy".
 */
export type StanSudo = { stan: "aktywny"; doKiedy: number } | { stan: "wymagany" } | { stan: "nie_dotyczy" };

export async function stanSudo(s: Pick<Settings, "totpEnabledAt" | "sessionVersion">): Promise<StanSudo> {
  if (!s.totpEnabledAt) return { stan: "nie_dotyczy" };
  const doKiedy = await sudoValidUntil(s.sessionVersion);
  return doKiedy ? { stan: "aktywny", doKiedy } : { stan: "wymagany" };
}

export const KOMUNIKAT_SUDO =
  "Ta czynność wymaga potwierdzenia kodem. Wejdź w tryb sudo w Ustawienia → Bezpieczeństwo (kod z aplikacji albo kod zapasowy), potem wróć tutaj.";
