import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
} from "node:crypto";
import * as OTPAuth from "otpauth";

/*
 * Czysta warstwa 2FA (ADR-031): bez bazy, bez `next/*`, wiec w pelni testowalna.
 *
 * - TOTP wg RFC 6238: 6 cyfr, SHA-1, krok 30 s, tolerancja +-1 krok.
 * - Sekret w bazie zaszyfrowany AES-256-GCM. Klucz glowny pochodzi z TOTP_ENC_KEY,
 *   a z niego HKDF wyprowadza OSOBNE klucze: do szyfrowania sekretu i do HMAC kodow
 *   zapasowych. Wyciek samej bazy nie daje ani sekretu, ani mozliwosci sprawdzenia
 *   kodow zapasowych.
 * - Kody zapasowe: 10 znakow z 32-znakowego alfabetu (50 bitow), w bazie HMAC-SHA256.
 */

export const TOTP_ISSUER = "Dziennik tradingowy";
export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const BACKUP_CODE_COUNT = 10;
export const BACKUP_CODE_LENGTH = 10;
/** 32 znaki bez mylacych: bez 0/O i 1/I. */
export const BACKUP_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/* --- klucz glowny ----------------------------------------------------------- */

/**
 * Czyta TOTP_ENC_KEY: 32 bajty zapisane jako base64, base64url albo 64 znaki hex.
 * Rzuca z komunikatem, ktory mowi co jest nie tak i jak wygenerowac poprawny klucz.
 */
export function wczytajKluczGlowny(raw: string | undefined = process.env.TOTP_ENC_KEY): Buffer {
  const wartosc = (raw ?? "").trim();
  const jakGenerowac = `Wygeneruj: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`;
  if (!wartosc) {
    throw new Error(`Brak zmiennej TOTP_ENC_KEY (32 losowe bajty). ${jakGenerowac}`);
  }
  let bajty: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(wartosc)) bajty = Buffer.from(wartosc, "hex");
  else if (/^[A-Za-z0-9_-]{43}={0,1}$/.test(wartosc)) bajty = Buffer.from(wartosc, "base64url");
  else if (/^[A-Za-z0-9+/]{43}={0,1}$/.test(wartosc)) bajty = Buffer.from(wartosc, "base64");
  if (!bajty || bajty.length !== 32) {
    throw new Error(
      `TOTP_ENC_KEY ma ${wartosc.length} znaków i nie zapisuje 32 bajtów (oczekiwane: 43 znaki base64url albo 64 znaki hex). ${jakGenerowac}`,
    );
  }
  return bajty;
}

/** Czy klucz jest ustawiony i poprawny (bez rzucania; do wyswietlenia ostrzezenia w UI). */
export function kluczTotpDziala(): boolean {
  try {
    wczytajKluczGlowny();
    return true;
  } catch {
    return false;
  }
}

function podklucz(etykieta: "enc" | "backup", master = wczytajKluczGlowny()): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `tj-totp-${etykieta}-v1`, 32));
}

/* --- szyfrowanie sekretu ---------------------------------------------------- */

/** Przeznaczenie szyfrogramu: wiaze go z miejscem uzycia, wiec sekret z bazy i ciasteczko konfiguracji nie sa wymienne. */
export type PrzeznaczenieSzyfrogramu = "sekret-w-bazie" | "ciasteczko-konfiguracji";
const aad = (cel: PrzeznaczenieSzyfrogramu) =>
  Buffer.from(cel === "sekret-w-bazie" ? "tj-totp-secret-v1" : "tj-totp-setup-v1");
const DLUGOSC_IV = 12;
const DLUGOSC_TAGU = 16;

/** Zwraca `iv.tag.szyfrogram` (base64url), jak w model-danych.md. */
export function zaszyfrujSekret(
  sekret: string,
  master?: Buffer,
  cel: PrzeznaczenieSzyfrogramu = "sekret-w-bazie",
): string {
  const iv = randomBytes(DLUGOSC_IV);
  const cipher = createCipheriv("aes-256-gcm", podklucz("enc", master), iv, {
    authTagLength: DLUGOSC_TAGU,
  });
  cipher.setAAD(aad(cel));
  const szyfrogram = Buffer.concat([cipher.update(sekret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), szyfrogram].map((b) => b.toString("base64url")).join(".");
}

export function odszyfrujSekret(
  zapis: string,
  master?: Buffer,
  cel: PrzeznaczenieSzyfrogramu = "sekret-w-bazie",
): string {
  const czesci = zapis.split(".");
  if (czesci.length !== 3) {
    throw new Error("Zaszyfrowany sekret TOTP ma zły format (oczekiwane: iv.tag.szyfrogram).");
  }
  const [iv, tag, szyfrogram] = czesci.map((c) => Buffer.from(c, "base64url"));
  // Node przyjmuje skrocony tag GCM (nawet 4 bajty), co oslabia uwierzytelnienie. Wymagamy pelnego.
  if (iv.length !== DLUGOSC_IV || tag.length !== DLUGOSC_TAGU) {
    throw new Error(
      `Zaszyfrowany sekret TOTP ma zły format: iv ${iv.length} B (oczekiwane ${DLUGOSC_IV}), tag ${tag.length} B (oczekiwane ${DLUGOSC_TAGU}).`,
    );
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", podklucz("enc", master), iv, {
      authTagLength: DLUGOSC_TAGU,
    });
    decipher.setAAD(aad(cel));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(szyfrogram), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Nie udało się odszyfrować sekretu TOTP: TOTP_ENC_KEY różni się od klucza, którym go zaszyfrowano, albo dane w bazie są uszkodzone.",
    );
  }
}

/* --- TOTP ------------------------------------------------------------------- */

export function nowySekretBase32(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function zbuduj(sekretBase32: string, label = "dziennik"): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_S,
    secret: OTPAuth.Secret.fromBase32(sekretBase32),
  });
}

export function adresOtpauth(sekretBase32: string): string {
  return zbuduj(sekretBase32).toString();
}

export function numerKroku(timestampMs: number): number {
  return Math.floor(timestampMs / 1000 / TOTP_PERIOD_S);
}

/** Kod, jaki aplikacja pokaze w danej chwili (do testow i skryptow lokalnych). */
export function kodTotp(sekretBase32: string, timestampMs = Date.now()): string {
  return zbuduj(sekretBase32).generate({ timestamp: timestampMs });
}

/**
 * Sprawdza kod 6-cyfrowy. Zwraca numer kroku, z ktorego kod pochodzi (do ochrony
 * przed powtorka), albo null. Kod nie-cyfrowy lub zlej dlugosci odpada bez liczenia HMAC.
 */
export function sprawdzKodTotp(
  sekretBase32: string,
  kod: string,
  timestampMs = Date.now(),
): number | null {
  if (!/^[0-9]{6}$/.test(kod)) return null;
  const delta = zbuduj(sekretBase32).validate({
    token: kod,
    timestamp: timestampMs,
    window: TOTP_WINDOW,
  });
  return delta === null ? null : numerKroku(timestampMs) + delta;
}

/* --- kody zapasowe ---------------------------------------------------------- */

export function noweKodyZapasowe(ile = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: ile }, () =>
    Array.from(
      { length: BACKUP_CODE_LENGTH },
      () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)],
    ).join(""),
  );
}

/** Wielkie litery, bez spacji i myslnikow: uzytkownik moze przepisac `ABCDE-FGHJK` jak chce. */
export function normalizujKod(wpisane: string): string {
  return wpisane.replace(/[\s-]/g, "").toUpperCase();
}

/** Do wyswietlenia: ABCDE-FGHJK. */
export function formatujKodZapasowy(kod: string): string {
  return `${kod.slice(0, 5)}-${kod.slice(5)}`;
}

export function czyKodZapasowy(znormalizowany: string): boolean {
  return (
    znormalizowany.length === BACKUP_CODE_LENGTH &&
    [...znormalizowany].every((z) => BACKUP_ALPHABET.includes(z))
  );
}

export function hmacKoduZapasowego(znormalizowany: string, master?: Buffer): string {
  return createHmac("sha256", podklucz("backup", master)).update(znormalizowany).digest("hex");
}
