/**
 * Okno stale do limitu zapytan na klienta (ADR-026: 120 na minute). Licznik
 * w pamieci procesu, jak blokada prob logowania w `auth/guard.ts` - przy
 * jednym kontenerze i jednym kliencie tabela w bazie bylaby zapisem na kazde zapytanie.
 */

type Okno = { start: number; liczba: number };

const okna = new Map<string, Okno>();

export function przepusc(
  klucz: string,
  limit: number,
  oknoMs: number,
  teraz: number = Date.now(),
): { allowed: boolean; retryInS: number } {
  let o = okna.get(klucz);
  if (!o || teraz - o.start >= oknoMs) {
    o = { start: teraz, liczba: 0 };
    okna.set(klucz, o);
    // Przy okazji sprzatamy wygasle okna, zeby mapa nie rosla w nieskonczonosc.
    if (okna.size > 1000) {
      for (const [k, v] of okna) if (teraz - v.start >= oknoMs) okna.delete(k);
    }
  }
  o.liczba += 1;
  if (o.liczba > limit) {
    return { allowed: false, retryInS: Math.max(1, Math.ceil((o.start + oknoMs - teraz) / 1000)) };
  }
  return { allowed: true, retryInS: 0 };
}

/** Tylko do testow. */
export function wyczyscLimiter(): void {
  okna.clear();
}
