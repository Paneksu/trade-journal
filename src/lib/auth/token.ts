import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Sesja bezstanowa: podpisany token w ciasteczku HttpOnly.
 * Przy jednym uzytkowniku tabela sesji nie daje nic poza kolejnym zapytaniem
 * do bazy przy kazdym zadaniu. Uniewaznienie wszystkich sesji dziala przez
 * `sessionVersion` w ustawieniach - podbicie licznika uniewaznia stare tokeny.
 */

export const SESSION_COOKIE = "tj_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET musi miec co najmniej 32 znaki. Ustaw go w zmiennych srodowiska.",
    );
  }
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function signToken(
  version: number,
  expiresAt = Date.now() + SESSION_MAX_AGE_S * 1000,
): string {
  const data = `${version}.${expiresAt}`;
  return `${data}.${sign(data)}`;
}

/** Sprawdza sam podpis i termin waznosci. Nie dotyka bazy - uzywa tego proxy. */
export function readToken(token: string | undefined): { version: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [version, expiresAt, signature] = parts;
  const expected = Buffer.from(sign(`${version}.${expiresAt}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;
  if (!(Number(expiresAt) > Date.now())) return null;

  return { version: Number(version) };
}

/** Pelna weryfikacja: podpis, termin i zgodnosc z aktualna wersja sesji. */
export function verifyToken(token: string | undefined, version: number): boolean {
  const read = readToken(token);
  return read !== null && read.version === version;
}
