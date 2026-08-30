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
