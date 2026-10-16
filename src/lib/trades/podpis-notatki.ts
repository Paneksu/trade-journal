import { createHash } from "node:crypto";

/**
 * Wersja notatki dnia DLA JEDNEGO FORMULARZA (review potwierdzające fazy 5, B1, 16.10.2026): skrót wartości tylko tych
 * pól, które dany formularz zapisuje. Zmiana innych pól (druga część rytuału, szybka notatka do „Po sesji”, zrzut
 * dnia, załącznik z API) nie unieważnia formularza, więc nic nie trzeba przemontowywać ani kasować z pól.
 * Konflikt jest tylko wtedy, gdy ktoś w międzyczasie zmienił TE SAME pola.
 */
export const POLA_PRZED_SESJA = ["bias", "energy", "maxTrades", "preSession", "sleep"] as const;
export const POLA_PO_SESJI = ["dayRating", "mood", "postSession"] as const;
export const POLA_KALENDARZA = ["dayRating", "energy", "mood", "noTrade", "noTradeReason", "postSession", "preSession"] as const;

function normalizuj(klucz: string, w: unknown): unknown {
  if (klucz === "noTrade") return Boolean(w);
  return w === undefined || w === "" ? null : w;
}

export function podpisPol(wartosci: Record<string, unknown> | null | undefined, klucze: readonly string[]): string {
  const k = [...klucze].sort();
  const dane = k.map((x) => [x, normalizuj(x, wartosci?.[x])]);
  return createHash("sha256").update(JSON.stringify(dane)).digest("hex").slice(0, 24);
}
