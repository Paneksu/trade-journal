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
 * Wlasciciel zrzutu: trade albo dzien dziennika. Katalogi trzymamy osobno,
 * zeby identyfikatory z dwoch tabel nigdy nie wpadly na siebie.
 */
export type ShotOwner = { kind: "trade"; id: number } | { kind: "day"; id: number };

export function ownerSegment(owner: ShotOwner): string {
  return owner.kind === "trade" ? String(owner.id) : `dzien-${owner.id}`;
}

/**
 * Zamienia sciezke wzgledna na bezwzgledna tylko wtedy, gdy wyglada dokladnie
 * tak, jak sciezki, ktore sami zapisujemy: `<wlasciciel>/<losowy hex>.webp`,
 * gdzie wlasciciel to `<id trade'a>` albo `dzien-<id notatki>`.
 * Wszystko inne odrzucamy - nazwa pliku nigdy nie pochodzi od uzytkownika.
 */
export function safePath(relative: string): string | null {
  if (!/^(?:[0-9]+|dzien-[0-9]+)\/[a-f0-9]+(-mini)?\.webp$/.test(relative)) return null;
  const base = uploadsDir();
  const full = path.resolve(base, relative);
  return full.startsWith(base + path.sep) ? full : null;
}

export function ownerDir(owner: ShotOwner): string {
  return path.join(/*turbopackIgnore: true*/ uploadsDir(), ownerSegment(owner));
}

export function tradeDir(tradeId: number): string {
  return ownerDir({ kind: "trade", id: tradeId });
}
