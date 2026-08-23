/**
 * Interwal czasowy przypisany do konkretnego przypisania tagu do trade'a,
 * nie do samego tagu (ADR-013). Jeden tag "wybicie" moze wiec opisywac
 * wejscie zauwazone na 5m i osobno na 1h.
 *
 * Kolejnosc listy jest kolejnoscia wyswietlania i sortowania w calej
 * aplikacji - nigdy alfabetyczna. Alfabetycznie "1h" wypada przed "1m"
 * (h < m), a czasowo 1m jest drobniejsze i powinno byc pierwsze.
 */
export const INTERWALY = [
  "30s",
  "1m",
  "2m",
  "3m",
  "4m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "D",
  "W",
  "M",
] as const;

export type Interwal = (typeof INTERWALY)[number];

/** Strazy typu: string z formularza albo z bazy jest Interwalem tylko gdy jest na liscie. */
export function czyInterwal(w: string | null | undefined): w is Interwal {
  if (w === null || w === undefined) return false;
  return (INTERWALY as readonly string[]).includes(w);
}

/** Pozycja w kolejnosci wyswietlania - do sortowania wierszy tabel po skali czasu. */
export function porzadekInterwalu(w: Interwal): number {
  return INTERWALY.indexOf(w);
}

/**
 * Paruje pliki zrzutow z interwalami wybranymi dla kazdego z nich po indeksie
 * - nie po nazwie czy zawartosci. Uzywane przy nowym trade'cie (formularz
 * wysyla rownolegle "shot" i "shotint"), gdzie kazdy plik ma osobny interwal
 * wybrany w podgladzie. Cicha zamiana interwalow miedzy zdjeciami przy
 * przesunieciu indeksow jest dokladnie tym bledem, ktorego nikt by nie
 * zauwazyl - stad wydzielona, czysta funkcja pokryta testem.
 *
 * Wartosc spoza `INTERWALY` (albo brak wartosci na danej pozycji) zamienia
 * sie w `null`, nie odrzuca calej pary - jeden zle wypelniony wybor nie ma
 * blokowac wgrania pozostalych plikow.
 */
export function sparujZInterwalami<T>(
  pliki: readonly T[],
  interwaly: readonly (string | null | undefined)[],
): { plik: T; interval: Interwal | null }[] {
  return pliki.map((plik, i) => {
    const w = interwaly[i];
    return { plik, interval: czyInterwal(w) ? w : null };
  });
}
