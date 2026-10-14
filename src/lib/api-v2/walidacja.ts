import type { z } from "zod";

import { czytajJson, LIMIT_JSON } from "./body";
import { opiszBledyZod } from "./contract/schemas";
import { blad } from "./http";

/**
 * Wspolne wejscie tras v2: cialo JSON, parametry zapytania i id z adresu.
 * Kazdy blad to gotowa odpowiedz (`Response`) z kodem maszynowym i zdaniem
 * "pole + wartosc + czego oczekiwano".
 */

export type Wczytane<T> = { ok: true; dane: T } | { ok: false; odpowiedz: Response };

export async function wczytajCialo<S extends z.ZodType>(
  request: Request,
  schemat: S,
  prefiks: string,
  limit = LIMIT_JSON,
): Promise<Wczytane<z.output<S>>> {
  const cialo = await czytajJson(request, limit);
  if (!cialo.ok) {
    return {
      ok: false,
      odpowiedz: blad(cialo.status, cialo.status === 413 ? "payload_too_large" : "bad_request", cialo.error),
    };
  }
  const wynik = schemat.safeParse(cialo.dane);
  if (!wynik.success) {
    const errors = opiszBledyZod(wynik.error, cialo.dane);
    return { ok: false, odpowiedz: blad(400, "validation_failed", `${prefiks}: ${errors[0]}`, { errors }) };
  }
  return { ok: true, dane: wynik.data };
}

export function wczytajQuery<S extends z.ZodType>(request: Request, schemat: S): Wczytane<z.output<S>> {
  const surowe: Record<string, string> = {};
  for (const [k, v] of new URL(request.url).searchParams) {
    // Powtorzony parametr to blad klienta, nie "ostatni wygrywa" - wynik zalezalby od kolejnosci.
    if (k in surowe) {
      return { ok: false, odpowiedz: blad(400, "bad_request", `Parametr »${k}« występuje w adresie więcej niż raz.`) };
    }
    surowe[k] = v;
  }
  const wynik = schemat.safeParse(surowe);
  if (!wynik.success) {
    const errors = opiszBledyZod(wynik.error, surowe);
    return { ok: false, odpowiedz: blad(400, "validation_failed", `Nieprawidłowe parametry adresu: ${errors[0]}`, { errors }) };
  }
  return { ok: true, dane: wynik.data };
}

/** Dodatnia liczba calkowita z segmentu adresu (`/notes/12`). */
export function idZAdresu(surowe: string, nazwa: string): Wczytane<number> {
  if (!/^\d{1,9}$/.test(surowe) || Number(surowe) < 1) {
    return {
      ok: false,
      odpowiedz: blad(400, "bad_request", `${nazwa}: »${surowe.slice(0, 40)}« - oczekiwano dodatniej liczby całkowitej.`),
    };
  }
  return { ok: true, dane: Number(surowe) };
}
