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
      "SESSION_SECRET musi mieć co najmniej 32 znaki. Ustaw go w zmiennych środowiska.",
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
  // Tylko cyfry: inaczej z podpisanego ciasteczka innego przeznaczenia da sie zlozyc
  // ciag, ktory daje poprawny podpis i wersje NaN (proxy by go wpuscilo).
  if (!/^[0-9]+$/.test(version) || !/^[0-9]+$/.test(expiresAt)) return null;
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

/*
 * Tokeny o ograniczonym przeznaczeniu (ADR-031): "czeka na drugi krok" (5 min)
 * i tryb sudo (10 min). Maja ten sam ksztalt `wersja.wygasa.podpis` co sesja, ale
 * podpis liczy sie z dopisanym przeznaczeniem, wiec zaden z nich nie jest
 * waznym tokenem sesji i odwrotnie. Wersja sesji wiaze je z biezaca sesja:
 * podbicie `session_version` uniewaznia je razem z ciasteczkami sesji.
 */

export const PENDING_2FA_COOKIE = "tj_2fa";
export const PENDING_2FA_MAX_AGE_S = 5 * 60;
export const SUDO_COOKIE = "tj_sudo";
export const SUDO_MAX_AGE_S = 10 * 60;

export type TokenScope = "2fa" | "sudo";

export function signScoped(scope: TokenScope, version: number, ttlS: number, now = Date.now()): string {
  const data = `${version}.${now + ttlS * 1000}`;
  return `${data}.${sign(`tj-${scope}:${data}`)}`;
}

export function readScoped(
  scope: TokenScope,
  token: string | undefined,
  now = Date.now(),
): { version: number; expiresAt: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, expiresAt, signature] = parts;
  if (!/^[0-9]+$/.test(version) || !/^[0-9]+$/.test(expiresAt)) return null;
  const expected = Buffer.from(sign(`tj-${scope}:${version}.${expiresAt}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;
  if (!(Number(expiresAt) > now)) return null;
  return { version: Number(version), expiresAt: Number(expiresAt) };
}
