/**
 * Uklad galerii zrzutow - justowany (jak Google Photos/Flickr), nie siatka ze
 * stala wysokoscia wiersza. Jedno drzewo DOM: kontener `flex flex-wrap`,
 * kazdy kafel dostaje `flex-basis` proporcjonalny do wlasnej szerokosci przy
 * wspolnej bazowej wysokosci wiersza i `flex-grow` proporcjonalny do aspect
 * ratio - przy wspolnej wysokosci kazdy kafel wychodzi wtedy dokladnie na
 * swoja naturalna szerokosc, zero przyciecia, zero pasow. Zawijanie do
 * kolejnych wierszy robi sam CSS (`flex-wrap`) na podstawie szerokosci
 * kontenera, wiec responsywnosc nie potrzebuje osobnego wariantu na telefon -
 * to jedno i to samo drzewo na kazdej szerokosci ekranu. Powod wprost od
 * uzytkownika: przyciety zrzut nie jest wiarygodnym dowodem transakcji (patrz
 * docs/decyzje.md, wpis "zrzut zawsze w pelnym kadrze", nastepca ADR-009).
 *
 * Modul jest czysty: same funkcje liczace liczby, bez efektow ubocznych i bez
 * wiedzy o DOM czy Tailwindzie. Podzial na wiersze i domykanie ostatniego
 * (niepelnego) wiersza nie jest juz zadaniem JS - to teraz czysty CSS
 * flex-wrap w komponencie, wiec `wiersze`/`proporcjaWiersza` zostaly
 * usuniete razem z dwoma celami proporcji na dwa warianty ukladu.
 */

/** Uzywana, gdy wymiary zdjecia nie sa jeszcze znane (np. przed uploadem). */
export const PROPORCJA_DOMYSLNA = 16 / 9;

/**
 * Docelowa wysokosc wiersza galerii, w rem. Jedna stala zamiast dwoch celow
 * sumy proporcji (szeroki/waski) z poprzedniej wersji - responsywnosc teraz
 * wychodzi z szerokosci kontenera przez CSS `flex-wrap`, wiec liczba kafli w
 * wierszu na telefonie i na desktopie ustala sie sama, bez osobnego
 * przelicznika w JS.
 */
export const BAZA_WYSOKOSCI_WIERSZA = 9;

/**
 * Proporcja (szerokosc/wysokosc) pojedynczego zdjecia. Brak wymiarow albo
 * wysokosc zero (dzielenie przez zero) daje wartosc domyslna zamiast NaN czy
 * Infinity, ktore rozsypalyby dalsze liczenie flex-basis.
 */
export function proporcja(width: number | null, height: number | null): number {
  if (width === null || height === null || height === 0) return PROPORCJA_DOMYSLNA;
  return width / height;
}

/**
 * Flex-grow pojedynczego kafla. Proporcjonalny do jego aspect ratio: przy
 * wspolnej wysokosci wiersza i wspolnym flex-basis to wlasnie daje kazdemu
 * kaflowi jego naturalna szerokosc bez znieksztalcenia.
 */
export function wzrostKafla(i: number, proporcje: number[]): number {
  return proporcje[i];
}

/**
 * Flex-basis pojedynczego kafla, w rem: szerokosc, jaka zdjecie mialoby przy
 * bazowej wysokosci wiersza. To startowa (nie koncowa - `flex-grow` dobija do
 * pelnej szerokosci wiersza) szerokosc, od ktorej CSS liczy zawijanie -
 * decyduje wiec, ile kafli zmiesci sie obok siebie zanim `flex-wrap` zacznie
 * nowy wiersz.
 */
export function bazaKafla(i: number, proporcje: number[], baza: number): number {
  return proporcje[i] * baza;
}
