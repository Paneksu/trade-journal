/**
 * Limit zrzutow na jeden wpis - trade albo dzien. Modul jest czysty (bez
 * `server-only`), bo ten sam rachunek robi przegladarka przed wyslaniem
 * i serwer przed zapisem. Jedno zrodlo liczby, jeden komunikat.
 */

export const MAX_ZRZUTOW = 8;

/**
 * Zwraca komunikat, gdy paczka nie miesci sie w limicie, albo null.
 *
 * Cala paczka jest odrzucana, nie przycinana: przy wklejeniu piatki do
 * szostki uzytkownik nie ma jak zgadnac, ktore dwa zdjecia weszly.
 */
export function bladLimitu(istniejace: number, dodawane: number): string | null {
  const wolne = Math.max(0, MAX_ZRZUTOW - istniejace);
  if (dodawane <= wolne) return null;
  if (wolne === 0) {
    return `Limit ${MAX_ZRZUTOW} zrzutów na wpis. Usuń któryś, żeby dodać nowy.`;
  }
  return (
    `Limit ${MAX_ZRZUTOW} zrzutów na wpis. Masz już ${istniejace}, ` +
    `dodajesz ${dodawane} — zmieści się jeszcze ${wolne}.`
  );
}
