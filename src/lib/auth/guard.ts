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
      "Baza nie ma wiersza ustawień. Uruchom `npm run seed`, żeby założyć konto i hasło.",
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
type Wpis = { count: number; until: number; eskalowano: boolean };
const attempts = new Map<string, Wpis>();
const LIMIT = 8;
const LOCKOUT_MS = 10 * 60 * 1000;

/*
 * Eskalacja: kazda kolejna blokada tego samego klucza trwa dwa razy dluzej niz poprzednia
 * (10 min, 20, 40 ... do 12 h). Seria zanika po dobie bez blokad, a poprawne logowanie
 * zeruje ja dla swojego adresu. Bez tego atakujacy, ktory zna haslo i rotuje adresy,
 * zgadywalby kod 2FA w tempie "limit na 10 minut" bez konca (ok. 4300 prob na dobe).
 */
const serie = new Map<string, { n: number; ostatnia: number }>();
const SERIA_ZANIKA_MS = 24 * 60 * 60 * 1000;
const MAX_BLOKADA_MS = 12 * 60 * 60 * 1000;

export function checkRateLimit(
  key: string,
  limit: number = LIMIT,
): { allowed: boolean; retryInS: number } {
  const entry = attempts.get(key);
  if (!entry) return { allowed: true, retryInS: 0 };
  if (Date.now() > entry.until) {
    attempts.delete(key);
    return { allowed: true, retryInS: 0 };
  }
  if (entry.count < limit) return { allowed: true, retryInS: 0 };
  return { allowed: false, retryInS: Math.ceil((entry.until - Date.now()) / 1000) };
}

/** Gorny limit wpisow: licznik jest w pamieci, a klucze pochodza z adresow klientow. */
const MAX_WPISOW = 5000;

function sprzatnijWygasle(): void {
  const teraz = Date.now();
  for (const [k, v] of attempts) if (teraz > v.until) attempts.delete(k);
  for (const [k, v] of serie) if (teraz - v.ostatnia > SERIA_ZANIKA_MS) serie.delete(k);
  // Gdy nadal za duzo (atak z wielu adresow): zostaja najswiezsze, najstarsze wypadaja.
  for (const mapa of [attempts, serie] as Map<string, unknown>[]) {
    while (mapa.size > MAX_WPISOW) {
      const najstarszy = mapa.keys().next().value;
      if (najstarszy === undefined) break;
      mapa.delete(najstarszy);
    }
  }
}

export function recordFailedAttempt(key: string, limit: number = LIMIT): void {
  if (attempts.size >= MAX_WPISOW || serie.size >= MAX_WPISOW) sprzatnijWygasle();
  const teraz = Date.now();
  let entry = attempts.get(key);
  if (entry && teraz <= entry.until) {
    entry.count += 1;
    // Wydluzona blokada (eskalowana) nie moze sie skrocic kolejnym wpisem.
    if (!entry.eskalowano) entry.until = teraz + LOCKOUT_MS;
  } else {
    entry = { count: 1, until: teraz + LOCKOUT_MS, eskalowano: false };
    attempts.set(key, entry);
  }

  if (entry.count >= limit && !entry.eskalowano) {
    const poprzednia = serie.get(key);
    const n = poprzednia && teraz - poprzednia.ostatnia <= SERIA_ZANIKA_MS ? poprzednia.n + 1 : 1;
    serie.set(key, { n, ostatnia: teraz });
    entry.until = teraz + Math.min(LOCKOUT_MS * 2 ** (n - 1), MAX_BLOKADA_MS);
    entry.eskalowano = true;
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
  serie.delete(key);
}
