import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

/*
 * Zamkniecie logowania nowych urzadzen do czasu wlaczenia 2FA (ADR-030).
 * Slowa uzytkownika 15.10.2026: «Zamkniete do wlaczenia 2FA». Decyzja zapisana w kodzie 17.10.2026
 * (autoryzacja sesji glownej): uzytkownik nie ma dostepu do zmiennych w Coolify, wiec warunek
 * pilnuje sam kod, a nie zmienna DEVICE_LOGIN_DISABLED (ta zostaje jako dodatkowy wylacznik).
 */

export const KOD_WYMAGANE_2FA = "device_login_requires_2fa";
export const KOMUNIKAT_WYMAGANE_2FA = "Włącz 2FA, żeby łączyć urządzenia";

/** Czy w ustawieniach jest wlaczone TOTP. Blad bazy propaguje sie: zamkniete jest bezpieczniejsze niz otwarte. */
export async function dwaFaWlaczone(): Promise<boolean> {
  const [s] = await db
    .select({ wlaczone: settings.totpEnabledAt })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return Boolean(s?.wlaczone);
}
