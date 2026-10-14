/**
 * Opisy odpowiedzi »Do rozstrzygniecia«. Osobny modul bez `server-only` i bez bazy, bo importuje go
 * tez komponent kliencki (formularz); logika zapisu zostaje w `rozstrzygniecia.ts`.
 */

export const ROZSTRZYGNIECIA = ["keep_mine", "take_mentor", "both_conditional"] as const;
export type Rozstrzygniecie = (typeof ROZSTRZYGNIECIA)[number];

export const ROZSTRZYGNIECIE_OPISY: Record<Rozstrzygniecie, string> = {
  keep_mine: "Zostaje mój sposób",
  take_mentor: "Biorę mentora",
  both_conditional: "Oba, każdy z warunkiem",
};

export function czyRozstrzygniecie(w: unknown): w is Rozstrzygniecie {
  return typeof w === "string" && (ROZSTRZYGNIECIA as readonly string[]).includes(w);
}
