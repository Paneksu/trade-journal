/**
 * Wczytanie pliku CSV z eksportu brokera do tablicy wierszy (ADR-034 pkt 2). Modul czysty (csv-parse nie dotyka dysku ani sieci).
 *
 * Limity i walidacja po stronie SERWERA (walidacja w przegladarce nie jest zabezpieczeniem): plik do 5 MB, do 20 000
 * wierszy, do 64 kolumn, komórka do 1 KB. Przekroczenie to odrzucenie calego pliku, NIGDY obciecie. Kodowanie: UTF-8
 * (BOM usuwany) albo UTF-16LE z BOM. Separator (przecinek albo srednik) z naglowka. Import niczego nie wykonuje:
 * komórki to tekst; ucieczka formul (CSV injection) dotyczy EKSPORTU z dziennika i jest w `csv-eksport.ts`.
 */

import { CsvError, parse } from "csv-parse/sync";

export const LIMIT_BAJTOW = 5 * 1024 * 1024;
export const LIMIT_WIERSZY = 20_000;
export const LIMIT_KOLUMN = 64;
export const LIMIT_KOMORKI = 1024;

export type WierszCsv = { numer: number; komorki: string[] };

export type WynikCsv =
  | { ok: true; naglowek: string[]; wiersze: WierszCsv[]; separator: "," | ";"; kodowanie: "utf-8" | "utf-16le" }
  | { ok: false; kod: "too_large" | "bad_encoding" | "bad_csv" | "too_many_rows" | "too_many_columns" | "cell_too_long" | "empty"; komunikat: string };

function dekoduj(bajty: Uint8Array): { ok: true; tekst: string; kodowanie: "utf-8" | "utf-16le" } | { ok: false; komunikat: string } {
  if (bajty.length >= 2 && bajty[0] === 0xff && bajty[1] === 0xfe) {
    if ((bajty.length - 2) % 2 !== 0) return { ok: false, komunikat: "Plik UTF-16LE ma nieparzystą liczbę bajtów, więc jest uszkodzony albo ucięty." };
    return { ok: true, tekst: new TextDecoder("utf-16le").decode(bajty.subarray(2)), kodowanie: "utf-16le" };
  }
  if (bajty.length >= 2 && bajty[0] === 0xfe && bajty[1] === 0xff) {
    return { ok: false, komunikat: "Plik jest w UTF-16BE, którego nie obsługujemy. Wyeksportuj go ponownie (UTF-8 albo UTF-16LE)." };
  }
  try {
    let b = bajty;
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
    return { ok: true, tekst: new TextDecoder("utf-8", { fatal: true }).decode(b), kodowanie: "utf-8" };
  } catch {
    return { ok: false, komunikat: "Plik nie jest poprawnym UTF-8 (ani UTF-16LE z BOM). Wyeksportuj go ponownie bez zmiany kodowania." };
  }
}

/** Separator z pierwszej linii: ten, ktorego jest wiecej poza cudzyslowami (remis: przecinek). */
function wykryjSeparator(tekst: string): "," | ";" {
  const koniec = tekst.search(/\r?\n/);
  const linia = koniec === -1 ? tekst : tekst.slice(0, koniec);
  let wCudzyslowie = false;
  let przecinki = 0;
  let srednikii = 0;
  for (const znak of linia) {
    if (znak === '"') wCudzyslowie = !wCudzyslowie;
    else if (!wCudzyslowie && znak === ",") przecinki += 1;
    else if (!wCudzyslowie && znak === ";") srednikii += 1;
  }
  return srednikii > przecinki ? ";" : ",";
}

export function wczytajCsv(bajty: Uint8Array): WynikCsv {
  if (bajty.length === 0) return { ok: false, kod: "empty", komunikat: "Plik jest pusty (0 bajtów)." };
  if (bajty.length > LIMIT_BAJTOW) {
    return {
      ok: false,
      kod: "too_large",
      komunikat: `Plik ma ${bajty.length} B, a limit to ${LIMIT_BAJTOW} B (5 MB). Wyeksportuj krótszy zakres dat; plik nie został przycięty ani zapisany.`,
    };
  }
  const d = dekoduj(bajty);
  if (!d.ok) return { ok: false, kod: "bad_encoding", komunikat: d.komunikat };
  const separator = wykryjSeparator(d.tekst);

  let rekordy: { rekord: string[]; linia: number }[];
  try {
    const wyniki = parse(d.tekst, {
      delimiter: separator,
      skip_empty_lines: true,
      relax_column_count: true,
      info: true,
      bom: false,
      max_record_size: LIMIT_KOLUMN * (LIMIT_KOMORKI + 2),
    }) as { record: string[]; info: { lines: number } }[];
    rekordy = wyniki.map((w) => ({ rekord: w.record, linia: w.info.lines }));
  } catch (e) {
    if (e instanceof CsvError) {
      return { ok: false, kod: "bad_csv", komunikat: `Plik nie jest poprawnym CSV (linia ${e.lines ?? "?"}: ${e.code}). Wyeksportuj go ponownie.` };
    }
    throw e;
  }
  if (rekordy.length === 0) return { ok: false, kod: "empty", komunikat: "Plik nie ma żadnego wiersza." };

  const [naglowek, ...dane] = rekordy;
  if (naglowek.rekord.length > LIMIT_KOLUMN) {
    return { ok: false, kod: "too_many_columns", komunikat: `Nagłówek ma ${naglowek.rekord.length} kolumn, a limit to ${LIMIT_KOLUMN}. Plik nie wygląda na eksport z brokera.` };
  }
  if (dane.length > LIMIT_WIERSZY) {
    return { ok: false, kod: "too_many_rows", komunikat: `Plik ma ${dane.length} wierszy danych, a limit to ${LIMIT_WIERSZY}. Wyeksportuj krótszy zakres dat; plik nie został przycięty.` };
  }
  for (const r of rekordy) {
    if (r.rekord.length > LIMIT_KOLUMN) {
      return { ok: false, kod: "too_many_columns", komunikat: `Wiersz w linii ${r.linia} ma ${r.rekord.length} kolumn, a limit to ${LIMIT_KOLUMN}.` };
    }
    const zbyt = r.rekord.findIndex((k) => k.length > LIMIT_KOMORKI);
    if (zbyt !== -1) {
      return {
        ok: false,
        kod: "cell_too_long",
        komunikat: `Komórka w linii ${r.linia}, kolumna ${zbyt + 1} ma ${r.rekord[zbyt].length} znaków, a limit to ${LIMIT_KOMORKI}. Plik odrzucony w całości (nie obcinamy danych).`,
      };
    }
  }
  return {
    ok: true,
    naglowek: naglowek.rekord.map((k) => k),
    wiersze: dane.map((r) => ({ numer: r.linia, komorki: r.rekord })),
    separator,
    kodowanie: d.kodowanie,
  };
}
