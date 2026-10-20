/**
 * Zrodla obrazu zrzutu dla `<img>`: miniatura i pelny plik w jednym `srcset`, zeby przegladarka sama
 * wziela pelny plik, gdy kafel na ekranie (z gestoscia pikseli, np. 2x na Retinie) jest szerszy niz
 * miniatura. Powod (Slowa uzytkownika 20.10.2026: «w zrzutach dalej te screeny sa rozmyte», «Chciałbym od razu
 * uzyskać najwyższą jakość, bez konieczności dodatkowego klikania»): sama miniatura 560 px rozciagnieta
 * na kafel ~900 px urzadzenia rozmywala tekst i cienkie linie wykresu.
 *
 * `sizes="auto, ..."`: przy `loading="lazy"` przegladarka bierze rzeczywista szerokosc kafla z ukladu
 * (Chrome 126+); starsze przegladarki uzywaja listy zapasowej po przecinku.
 *
 * Czysty modul (bez Reacta i bez serwera): ten sam dla stron serwerowych i komponentow klienckich.
 */

/** Szerokosc miniatury zapisywanej przez `saveScreenshot` (lib/screenshots.ts, THUMBNAIL_WIDTH). */
export const SZEROKOSC_MINIATURY = 560;

export type ZrzutDoObrazu = {
  file: string;
  thumbnail: string | null;
  /** Szerokosc PELNEGO pliku (kolumna `screenshots.width`). */
  width: number | null;
};

export type ZrodlaObrazu = { src: string; srcSet?: string; sizes?: string };

const adres = (sciezka: string) => `/api/screenshots/${sciezka}`;

/**
 * `zapas` to lista `sizes` dla przegladarek bez `auto` (np. "(max-width: 640px) 100vw, 50vw").
 * Bez miniatury albo bez znanej szerokosci: sam pelny plik (ostry zawsze, tylko ciezszy).
 */
export function zrodlaZrzutu(z: ZrzutDoObrazu, zapas: string): ZrodlaObrazu {
  const pelny = adres(z.file);
  if (!z.thumbnail || !z.width || z.width <= 0) return { src: pelny };
  const mini = adres(z.thumbnail);
  // Miniatura nie jest powiekszana (withoutEnlargement): przy waskim obrazie ma jego szerokosc.
  if (z.width <= SZEROKOSC_MINIATURY) return { src: mini };
  return {
    src: mini,
    srcSet: `${mini} ${SZEROKOSC_MINIATURY}w, ${pelny} ${z.width}w`,
    sizes: `auto, ${zapas}`,
  };
}
