/**
 * Status reguly jest WYLICZANY z jej wersji, nie zapisywany (model-danych 4.3).
 * Czysta funkcja: ten sam kod uzywa API i (w fazie 5) UI.
 */

export type StatusWersji = "proposed" | "approved" | "rejected" | "superseded";
export type StatusReguly = "proposed" | "active" | "retired" | "rejected";

export type WersjaDoStatusu = { version: number; status: StatusWersji };

/**
 * - wycofana (retired_at) wygrywa ze wszystkim;
 * - jest zatwierdzona wersja -> aktywna (ewentualna czekajaca propozycja to osobna flaga);
 * - jest propozycja i nic zatwierdzonego -> proponowana;
 * - w przeciwnym razie (same odrzucone) -> odrzucona.
 */
export function statusReguly(wersje: WersjaDoStatusu[], wycofana: boolean): StatusReguly {
  if (wycofana) return "retired";
  if (wersje.some((w) => w.status === "approved")) return "active";
  if (wersje.some((w) => w.status === "proposed")) return "proposed";
  return "rejected";
}

export function maOczekujacaPropozycje(wersje: WersjaDoStatusu[]): boolean {
  return wersje.some((w) => w.status === "proposed");
}

/** Kod nastepnej reguly: R-001, R-002... (min. 3 cyfry), z najwyzszego istniejacego numeru. */
export function nastepnyKodReguly(istniejace: string[]): string {
  let max = 0;
  for (const k of istniejace) {
    const m = /^R-(\d{3,})$/.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `R-${String(max + 1).padStart(3, "0")}`;
}

/** Kod nastepnej hipotezy: H-001... */
export function nastepnyKodHipotezy(istniejace: string[]): string {
  let max = 0;
  for (const k of istniejace) {
    const m = /^H-(\d{3,})$/.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `H-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Bramka "ponizej progu AI nie proponuje reguly" (MUST 5). Propozycje mentora
 * progu nie maja i sa podpisane n=0 (Slowa uzytkownika, 14.10.2026: "Bez progu,
 * podpisane n=0"); import z sejfu to tez nie AI.
 */
export function bramkaN(
  origin: "ai" | "mentor" | "vault-import" | "user",
  n: number | null,
  progN: number | null,
): { ok: true } | { ok: false; powod: string } {
  if (origin !== "ai") return { ok: true };
  if (n === null || progN === null) {
    return { ok: false, powod: "propozycja AI wymaga hipotezy (hypothesisId), z której liczy się n" };
  }
  if (n < progN) {
    return {
      ok: false,
      powod: `hipoteza ma n = ${n}, a próg to ${progN}; poniżej progu AI nie proponuje reguły (zbierz więcej trade'ów albo zgłoś obserwację jako notatkę)`,
    };
  }
  return { ok: true };
}
