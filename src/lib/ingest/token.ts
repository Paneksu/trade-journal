import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Token API synchronizacji (ADR-026). Na serwerze lezy WYLACZNIE jego skrot
 * SHA-256 (`INGEST_TOKEN_SHA256`, 64 znaki hex): wyciek zmiennych srodowiska
 * albo logow nie daje atakujacemu tokenu, ktory otwiera zapis do dziennika.
 *
 * Token ma byc dlugim losowym ciagiem (>= 32 bajty entropii), a nie haslem -
 * dlatego szybki SHA-256 wystarcza i nie potrzeba scrypta jak przy hasle.
 */

export function skrotTokenu(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Skrot z env jako 32 bajty albo `null`, gdy zmiennej nie ma lub jest zepsuta. */
export function wczytajSkrot(env: string | undefined): Buffer | null {
  const w = (env ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(w)) return null;
  return Buffer.from(w, "hex");
}

/** Wyciaga token z naglowka `Authorization: Bearer <token>`. */
export function tokenZNaglowka(naglowek: string | null): string | null {
  if (!naglowek) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(naglowek.trim());
  return m ? m[1] : null;
}

/** Porownanie w stalym czasie: skroty maja te sama dlugosc, wiec `timingSafeEqual` nie rzuca. */
export function tokenPasuje(naglowek: string | null, skrot: Buffer): boolean {
  const token = tokenZNaglowka(naglowek);
  if (token === null) return false;
  const policzony = createHash("sha256").update(token, "utf8").digest();
  return policzony.length === skrot.length && timingSafeEqual(policzony, skrot);
}
