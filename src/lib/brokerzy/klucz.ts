import "server-only";
import { createHash, createHmac, hkdfSync } from "node:crypto";

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

/**
 * Decyzja sesji glownej (autoryzacja uzytkownika z 17.10.2026), ADR-034 odstepstwo 14: gdy `BROKER_ID_HMAC_KEY` nie jest ustawiony,
 * klucz wyprowadzamy przez HKDF-SHA256 z `SESSION_SECRET` z osobnym `info`. Jawna zmienna ma pierwszenstwo. Zmiana `SESSION_SECRET`
 * (bez jawnej zmiennej) daje nowe skroty kont: stare konta u brokera nie zostana rozpoznane, a `tj` przypisze je ponownie.
 */
const INFO_KLUCZA_KONT = "tj-broker-id-v1";

function kluczZSrodowiska(): Buffer {
  const surowy = (process.env.BROKER_ID_HMAC_KEY ?? "").trim();
  if (surowy === "") {
    const sekret = (process.env.SESSION_SECRET ?? "").trim();
    if (sekret.length < 32) {
      throw new BladKonfiguracjiBrokera(
        "Brak BROKER_ID_HMAC_KEY, a SESSION_SECRET (z którego klucz mógłby zostać wyprowadzony) nie ma co najmniej 32 znaków, więc import z brokera jest wyłączony. Naprawa: ustaw SESSION_SECRET (min. 32 znaki) albo BROKER_ID_HMAC_KEY (32 losowe bajty, base64url) w panelu wdrożeniowym i zrestartuj aplikację.",
      );
    }
    return Buffer.from(hkdfSync("sha256", Buffer.from(sekret, "utf8"), Buffer.alloc(0), INFO_KLUCZA_KONT, 32));
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
