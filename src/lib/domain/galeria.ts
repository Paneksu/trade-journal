/**
 * Uklad siatki zrzutow. Czyste funkcje zwracajace klasy Tailwinda, zeby dalo
 * sie je pokryc testami i zeby karta trade'a, panel dnia i formularz uzywaly
 * dokladnie tego samego rozstawienia.
 *
 * Zasada: liczba zdjec decyduje o liczbie kolumn, a pierwsze zdjecie dostaje
 * role glowna tylko wtedy, gdy jest poziome i gdy siatka i tak zostawilaby
 * dziure (3 albo 5 sztuk). Wiersze maja stala wysokosc, a nie proporcje
 * liczona z szerokosci - inaczej pionowy zrzut obok poziomego rozpycha wiersz
 * i zostawia pod sasiadem pusta dziure.
 */

/** Wysokosc wiersza siatki - jedna dla wszystkich kafli, takze glownego. */
const WIERSZ = "auto-rows-[11rem] sm:auto-rows-[13rem]";

/** Klasy kolumn dla kontenera siatki. */
export function ukladSiatki(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return `grid-cols-1 sm:grid-cols-2 ${WIERSZ}`;
  if (n <= 4) return `grid-cols-2 ${WIERSZ}`;
  return `grid-cols-2 lg:grid-cols-3 ${WIERSZ}`;
}

/** Klasy pojedynczego kafla: rozpietosc glownego zdjecia albo nic. */
export function klasaKafla(i: number, n: number, pion: boolean): string {
  if (n <= 1) return "col-span-full";
  if (i === 0 && !pion && (n === 3 || n === 5)) return "col-span-2";
  return "";
}

/**
 * Zrzut jest pionowy, gdy znamy oba wymiary i wysokosc przewaza. Sluzy tylko
 * do decyzji o kaflu glownym - pion rozciagniety na dwie kolumny bylby
 * przyciety do paska.
 */
export function czyPion(width: number | null, height: number | null): boolean {
  return width !== null && height !== null && height > width;
}
