/**
 * Ucieczka formul w komorkach CSV (CSV injection, ADR-034 pkt 2). Kazdy eksport CSV z dziennika poprzedza apostrofem
 * komorke tekstowa zaczynajaca sie od `=`, `+`, `-`, `@`, tabulatora albo CR: Excel i Arkusze nie wykonaja jej jako formuly.
 * Jedna funkcja na cale repo; liczby (typ number) idą bez apostrofu, bo ujemna liczba nie jest formula.
 */

const NIEBEZPIECZNE = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Bezpieczny tekst komorki CSV (przed cytowaniem). */
export function zabezpieczKomorkeCsv(wartosc: string): string {
  return wartosc.length > 0 && NIEBEZPIECZNE.has(wartosc[0]) ? `'${wartosc}` : wartosc;
}

/** Komorka CSV gotowa do wpisania do pliku: ucieczka formul, potem cytowanie, gdy trzeba. Liczby bez zmian. */
export function komorkaCsv(wartosc: string | number | boolean | null | undefined): string {
  if (wartosc === null || wartosc === undefined) return "";
  if (typeof wartosc === "number") return Number.isFinite(wartosc) ? String(wartosc) : "";
  if (typeof wartosc === "boolean") return wartosc ? "true" : "false";
  const t = zabezpieczKomorkeCsv(wartosc);
  return /[",\r\n;]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

export function liniaCsv(komorki: (string | number | boolean | null | undefined)[]): string {
  return komorki.map(komorkaCsv).join(",");
}
