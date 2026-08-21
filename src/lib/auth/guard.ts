import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings as settingsTable, type Settings } from "@/lib/db/schema";
import { sessionCookie } from "./session";
import { verifyToken } from "./token";

/**
 * Straz dostepu. `cache` z Reacta sprawia, ze w obrebie jednego renderu
 * ustawienia czytane sa z bazy raz, niezaleznie od tego ile komponentow ich potrzebuje.
 */

export const getSettings = cache(async (): Promise<Settings> => {
  const [s] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1)).limit(1);
  if (!s) {
    throw new Error(
      "Baza nie ma wiersza ustawien. Uruchom `npm run seed`, zeby zalozyc konto i haslo.",
    );
  }
  return s;
});

/**
 * Zwraca ustawienia albo przekierowuje na logowanie. Uzywac w kazdym layoucie.
 *
 * Ciasteczko czytamy PRZED zapytaniem do bazy. To nie kosmetyka: dostep do
 * `cookies()` przelacza strone w tryb dynamiczny, wiec Next przestaje probowac
 * ja prerenderowac podczas budowania obrazu, gdzie zadnej bazy nie ma.
 */
export const requireSession = cache(async (): Promise<Settings> => {
  const token = await sessionCookie();
  const s = await getSettings();
  if (!verifyToken(token, s.sessionVersion)) redirect("/login");
  return s;
});

export async function isSignedIn(): Promise<boolean> {
  try {
    const token = await sessionCookie();
    const s = await getSettings();
    return verifyToken(token, s.sessionVersion);
  } catch {
    return false;
  }
}

/*
 * Prosty licznik prob logowania. Trzymany w pamieci procesu - przy jednym
 * kontenerze i jednym uzytkowniku to wystarcza, a tabela w bazie bylaby
 * kolejnym zapisem przy kazdej probie.
 */
const attempts = new Map<string, { count: number; until: number }>();
const LIMIT = 8;
const LOCKOUT_MS = 10 * 60 * 1000;

export function checkRateLimit(key: string): { allowed: boolean; retryInS: number } {
  const entry = attempts.get(key);
  if (!entry) return { allowed: true, retryInS: 0 };
  if (Date.now() > entry.until) {
    attempts.delete(key);
    return { allowed: true, retryInS: 0 };
  }
  if (entry.count < LIMIT) return { allowed: true, retryInS: 0 };
  return { allowed: false, retryInS: Math.ceil((entry.until - Date.now()) / 1000) };
}

export function recordFailedAttempt(key: string): void {
  const entry = attempts.get(key);
  if (entry && Date.now() <= entry.until) {
    entry.count += 1;
    entry.until = Date.now() + LOCKOUT_MS;
  } else {
    attempts.set(key, { count: 1, until: Date.now() + LOCKOUT_MS });
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
