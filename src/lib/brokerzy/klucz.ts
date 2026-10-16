import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * Konto u brokera w bazie to HMAC-SHA256 (klucz `BROKER_ID_HMAC_KEY`) i ostatnie 4 znaki, nigdy numer jawnie (ADR-034 pkt 2).
 * Klucz: 32 bajty losowe, base64url (43 znaki) albo hex (64 znaki). Brak klucza = import wylaczony (blad konfiguracji, nie
 * ciche zapisanie numeru w innej postaci). Zmiana klucza oznacza nowe skroty kont: stare konta nie zostana rozpoznane.
 */

export class BladKonfiguracjiBrokera extends Error {
  constructor(komunikat: string) {
    super(komunikat);
    this.name = "BladKonfiguracjiBrokera";
  }
}

function kluczZSrodowiska(): Buffer {
  const surowy = (process.env.BROKER_ID_HMAC_KEY ?? "").trim();
  if (surowy === "") {
    throw new BladKonfiguracjiBrokera(
      "Brak zmiennej środowiskowej BROKER_ID_HMAC_KEY, więc import z brokera jest wyłączony. Naprawa: ustaw 32 losowe bajty (node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\") w panelu wdrożeniowym i zrestartuj aplikację.",
    );
  }
  const bajty = /^[0-9a-f]{64}$/i.test(surowy) ? Buffer.from(surowy, "hex") : Buffer.from(surowy, "base64url");
  if (bajty.length < 32) {
    throw new BladKonfiguracjiBrokera(
      `BROKER_ID_HMAC_KEY ma ${bajty.length} bajtów, a wymagane jest co najmniej 32 (base64url 43 znaki albo hex 64 znaki). Naprawa: wygeneruj nowy klucz.`,
    );
  }
  return bajty;
}

export type SkrotKonta = { hmac: string; krotki: string; ostatnie4: string };

/** Skrot konta u brokera w ramach platformy. `krotki` (12 znakow) wchodzi do `external_ref`. */
export function skrotKonta(platforma: string, numerKonta: string, klucz: Buffer = kluczZSrodowiska()): SkrotKonta {
  const numer = numerKonta.trim();
  const hmac = createHmac("sha256", klucz).update(`${platforma}:${numer}`, "utf8").digest("hex");
  return { hmac, krotki: hmac.slice(0, 12), ostatnie4: numer.slice(-4) };
}

export function sha256Hex(bajty: Uint8Array): string {
  return createHash("sha256").update(bajty).digest("hex");
}

/** Czy import ma skonfigurowany klucz (UI pokazuje to w Polaczeniach, zeby blad byl widoczny przed wgraniem pliku). */
export function brokerSkonfigurowany(): boolean {
  try {
    kluczZSrodowiska();
    return true;
  } catch {
    return false;
  }
}
