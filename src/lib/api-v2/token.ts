import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Token API v2 (ADR-030): `tj_<prefix>_<sekret>`. Prefiks (8 znakow a-z0-9)
 * sluzy do znalezienia wiersza i do pokazania w UI; sekret to 32 losowe bajty
 * (43 znaki base64url) i nie jest nigdzie zapisany. W bazie lezy tylko SHA-256
 * calego tokenu - szybki skrot jest uzasadniony, bo token to losowy ciag
 * o entropii 256 bitow, a nie haslo.
 */

export { czyScope, SCOPES, type Scope } from "./scopes";

/** Dlugosc prefiksu i sekretu - zmiana wymaga migracji CHECK-a `prefix`. */
export const REGEX_TOKEN_V2 = /^tj_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

const ALFABET_PREFIKSU = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 8 znakow z alfabetu 36-znakowego bez obciazenia modulo (odrzucamy bajty >= 252). */
function losowyPrefiks(): string {
  let wynik = "";
  while (wynik.length < 8) {
    for (const b of randomBytes(16)) {
      if (b >= 252) continue;
      wynik += ALFABET_PREFIKSU[b % 36];
      if (wynik.length === 8) break;
    }
  }
  return wynik;
}

export function skrotTokenuV2(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type NowyToken = { token: string; prefix: string; sha256: string };

export function wygenerujToken(): NowyToken {
  const prefix = losowyPrefiks();
  const token = `tj_${prefix}_${randomBytes(32).toString("base64url")}`;
  return { token, prefix, sha256: skrotTokenuV2(token) };
}

/** Wyciaga token v2 z naglowka Authorization. `null`, gdy brak albo ksztalt nie pasuje. */
export function tokenV2ZNaglowka(naglowek: string | null): { token: string; prefix: string } | null {
  if (!naglowek) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(naglowek.trim());
  if (!m) return null;
  const t = REGEX_TOKEN_V2.exec(m[1]);
  return t ? { token: m[1], prefix: t[1] } : null;
}

/** Porownanie w stalym czasie dwoch skrotow hex (ta sama dlugosc, wiec `timingSafeEqual` nie rzuca). */
export function skrotyRowne(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Kod urzadzenia do odpytywania (32 bajty); w bazie tylko jego SHA-256. */
export function wygenerujKodUrzadzenia(): { deviceCode: string; sha256: string } {
  const deviceCode = randomBytes(32).toString("base64url");
  return { deviceCode, sha256: createHash("sha256").update(deviceCode, "utf8").digest("hex") };
}

export function skrotKoduUrzadzenia(kod: string): string {
  return createHash("sha256").update(kod, "utf8").digest("hex");
}

/** Alfabet user_code bez samoglosek i mylacych znakow (zgodny z CHECK w device_codes). */
const ALFABET_KODU = "BCDFGHJKLMNPQRSTVWXZ";

/** `KTWM-BHQP`: 8 liter z 20, bez obciazenia modulo (odrzucamy bajty >= 240). */
export function wygenerujKodUzytkownika(): string {
  let znaki = "";
  while (znaki.length < 8) {
    for (const b of randomBytes(16)) {
      if (b >= 240) continue;
      znaki += ALFABET_KODU[b % 20];
      if (znaki.length === 8) break;
    }
  }
  return `${znaki.slice(0, 4)}-${znaki.slice(4)}`;
}

/** Kod wpisany przez czlowieka: wielkosc liter, spacje i brak kreski nie przeszkadzaja. */
export function normalizujKodUzytkownika(wpisany: string): string | null {
  const czysty = wpisany.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(czysty)) return null;
  return `${czysty.slice(0, 4)}-${czysty.slice(4)}`;
}
