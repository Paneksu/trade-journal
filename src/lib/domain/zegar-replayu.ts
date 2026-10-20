/**
 * Zegar replayu zapisany przy zrzucie backtestu (20.10.2026).
 *
 * Problem: ocena »chart« przyjmuje zrzut jako dowod tylko wtedy, gdy powstal najpozniej w chwili wejscia.
 * Przy backteście wejscie trade'a jest w czasie REPLAYU (np. 2023), a `captured_at` zrzutu to czas zegarowy
 * (2026), wiec kazdy zrzut z replayu wygladal na zrobiony "po wejsciu" i ocena odpadala z `look_ahead`.
 *
 * Regula: lacznik dopisuje do `chartState` zrzutu pole `replayTime` - zegar replayu (czas rynkowy, ktory
 * replay pokazywal w chwili zrzutu) jako ISO 8601 z offsetem, np. "2023-03-10T14:30:00Z". Dla trade'a z
 * backtestu (sesja rodzaju "backtest" albo zrodlo fxreplay; sesja "forward" tylko ze zrodlem fxreplay) serwer porownuje z
 * wejsciem WYLACZNIE `replayTime`;
 * brak albo nieczytelna wartosc = zrzut nie jest dowodem sprzed wejscia (fail-closed). `captured_at`
 * nie ma tu znaczenia, bo to inny zegar.
 *
 * Czysty modul: bez bazy i bez Next.
 */

/** Nazwa pola w `chartState` (kontrakt z lacznikiem tj). */
export const POLE_ZEGARA_REPLAYU = "replayTime";

const ISO_Z_OFFSETEM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Czy tekst jest czasem ISO 8601 z offsetem (Z albo +hh:mm), ktory da sie odczytac. */
export function czyCzasIso(tekst: string): boolean {
  return ISO_Z_OFFSETEM.test(tekst) && !Number.isNaN(Date.parse(tekst));
}

/** Zegar replayu ze stanu wykresu zrzutu albo null (brak pola, zly typ, zly format). */
export function zegarReplayu(chartState: unknown): Date | null {
  if (chartState === null || typeof chartState !== "object" || Array.isArray(chartState)) return null;
  const w = (chartState as Record<string, unknown>)[POLE_ZEGARA_REPLAYU];
  if (typeof w !== "string" || !czyCzasIso(w)) return null;
  return new Date(w);
}

/**
 * Blad walidacji pola przy WGRYWANIU zrzutu: pole podane, ale nieczytelne. Odrzucamy od razu (400), zeby
 * lacznik dowiedzial sie o zlym formacie przy zrzucie, a nie dopiero przy ocenie. Brak pola jest dozwolony.
 */
export function bladZegaraReplayu(chartState: Record<string, unknown>): string | null {
  if (!(POLE_ZEGARA_REPLAYU in chartState)) return null;
  const w = chartState[POLE_ZEGARA_REPLAYU];
  if (w === null) return null;
  if (typeof w !== "string" || !czyCzasIso(w)) {
    return `pole ${POLE_ZEGARA_REPLAYU}: oczekiwano zegara replayu jako ISO 8601 z offsetem, np. 2023-03-10T14:30:00Z (albo null, gdy nieznany)`;
  }
  return null;
}

/**
 * Czas, z ktorym porownujemy zrzut w kontroli look-ahead oceny »chart«:
 *  - trade z backtestu: zegar replayu z `chartState.replayTime` (null, gdy go brak);
 *  - trade realny: `captured_at` (czas zegarowy zrobienia).
 * null = brak dowodu, ze zrzut powstal przed wejsciem.
 */
export function czasZrzutuDlaOceny(z: { capturedAt: Date | null; chartState: unknown }, zBacktestu: boolean): Date | null {
  return zBacktestu ? zegarReplayu(z.chartState) : z.capturedAt;
}
