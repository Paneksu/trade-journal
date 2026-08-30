/**
 * Status trade'a jako typ domeny, oddzielony od enuma bazy (schema.ts).
 * Modul czysty - zero importow z db, zeby dalo sie uzyc w walidacji akcji
 * serwerowej bez ciagniecia calego Drizzle.
 *
 * `missed` ("nie wziety") to setup, ktorego uzytkownik nie wzial - ma pelny
 * wynik hipotetyczny (R, PnL), ale nie liczy sie do statystyk. Bariera
 * statystyk zostaje doslownie `status === "closed"` (patrz closedOnly w
 * queries/trades.ts) - `maWynik`/`czyPominiety` sa do wszystkiego innego:
 * walidacji zapisu, prezentacji, liczenia dnia jako "z setupem".
 *
 * OSTRZEZENIE: `maWynik` NIGDY nie zastepuje `closedOnly`. `maWynik` mowi
 * tylko, czy dana pozycja MA liczby do pokazania (bo "missed" tez ma R i PnL
 * hipotetyczne) - nie mowi, czy wolno je wliczyc do statystyk. Dwie funkcje o
 * podobnym ksztalcie kusza, zeby je "uproscic" do jednej za pol roku - to by
 * po cichu wpuscilo hipotetyczne trade'y ("missed") do computeStats i innych
 * agregacji, ktore licza tylko zamkniete pozycje. Jesli potrzebujesz filtru do
 * statystyk, uzyj `closedOnly`; jesli potrzebujesz wiedziec, czy jest co
 * wyswietlic obok trade'a, uzyj `maWynik`.
 */

export const STATUSY = ["planned", "open", "closed", "cancelled", "missed"] as const;

export type StatusTrade = (typeof STATUSY)[number];

export function czyStatus(w: unknown): w is StatusTrade {
  return typeof w === "string" && (STATUSY as readonly string[]).includes(w);
}

/** "closed" i "missed" maja policzalny wynik (R, PnL) - reszta nie. */
export function maWynik(status: StatusTrade): boolean {
  return status === "closed" || status === "missed";
}

/** Setup byl, ale uzytkownik go nie wzial. */
export function czyPominiety(status: StatusTrade): boolean {
  return status === "missed";
}
