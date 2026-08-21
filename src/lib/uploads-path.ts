import path from "node:path";

/**
 * Sciezki do katalogu ze zrzutami. Modul jest czysty (bez `sharp` i bez
 * `server-only`), zeby dalo sie go pokryc testami - to jedyna bariera miedzy
 * parametrem z adresu URL a systemem plikow.
 */

export function uploadsDir(): string {
  // Katalog jest konfigurowalny w czasie dzialania (wolumen w Dockerze),
  // wiec bundler nie da rady go przesledzic - i nie musi.
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOADS_DIR ?? "./.dane/zrzuty");
}

/**
 * Zamienia sciezke wzgledna na bezwzgledna tylko wtedy, gdy wyglada dokladnie
 * tak, jak sciezki, ktore sami zapisujemy: `<id trade'a>/<losowy hex>.webp`.
 * Wszystko inne odrzucamy - nazwa pliku nigdy nie pochodzi od uzytkownika.
 */
export function safePath(relative: string): string | null {
  if (!/^[0-9]+\/[a-f0-9]+(-mini)?\.webp$/.test(relative)) return null;
  const base = uploadsDir();
  const full = path.resolve(base, relative);
  return full.startsWith(base + path.sep) ? full : null;
}

export function tradeDir(tradeId: number): string {
  return path.join(/*turbopackIgnore: true*/ uploadsDir(), String(tradeId));
}
