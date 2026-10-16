/**
 * Czas z plikow brokera: format `MM/DD/YYYY HH:MM:SS` (Tradovate) bez strefy, albo z jawnym przesunieciem (ISO).
 * Strefa jest JAWNA (ADR-034 pkt 2): czas z przesunieciem bierzemy tak, jak jest; bez przesuniecia czytamy go
 * w strefie podanej przez wolajacego (ustawienie konta u brokera albo strefa uzytkownika) i mowimy to w ostrzezeniu.
 * Modul czysty. Zmiany czasu (USA, UE): godzina, ktorej nie ma (luka wiosenna), przesuwa sie do przodu;
 * godzina powtorzona (jesienna) bierze pierwsze wystapienie (czas letni); oba przypadki wracaja z flaga.
 */

import { timeParts } from "../calc";

export type WynikCzasu =
  | { ok: true; czas: Date; zPliku: boolean; niejednoznaczny: boolean; nieistniejacy: boolean }
  | { ok: false; powod: string };

const WZORZEC_USA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
const WZORZEC_ISO = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/** Przesuniecie strefy wzgledem UTC w danym momencie, w milisekundach (do minuty). */
function przesuniecie(moment: number, strefa: string): number {
  const c = timeParts(new Date(moment), strefa);
  const jakoUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, 0, 0);
  return jakoUtc - Math.floor(moment / 60_000) * 60_000;
}

/** Czas scienny w strefie -> UTC. */
export function sciennyNaUtc(
  r: number,
  mies: number,
  d: number,
  g: number,
  min: number,
  s: number,
  strefa: string,
): { czas: Date; niejednoznaczny: boolean; nieistniejacy: boolean } {
  const scienny = Date.UTC(r, mies - 1, d, g, min, s);
  const pasuje = (t: number): boolean => {
    const c = timeParts(new Date(t), strefa);
    return c.year === r && c.month === mies && c.day === d && c.hour === g && c.minute === min;
  };
  const kandydaci = new Set<number>();
  for (const zsuw of [-86_400_000, 0, 86_400_000]) {
    const t = scienny - przesuniecie(scienny + zsuw, strefa);
    if (pasuje(t)) kandydaci.add(t);
  }
  if (kandydaci.size >= 1) {
    const posortowane = [...kandydaci].sort((a, b) => a - b);
    return { czas: new Date(posortowane[0]), niejednoznaczny: posortowane.length > 1, nieistniejacy: false };
  }
  // Luka wiosenna: czytamy godzine ze starym przesunieciem (sprzed luki), co daje moment tuz po jej zakonczeniu.
  const przed = przesuniecie(scienny - 86_400_000, strefa);
  return { czas: new Date(scienny - przed), niejednoznaczny: false, nieistniejacy: true };
}

function strefaPoprawna(strefa: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: strefa });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parsuje czas z komorki pliku. `strefa` to strefa dla czasow BEZ przesuniecia.
 * Zakres rozsadnych dat sprawdza wolajacy (schemat komorki).
 */
export function parsujCzasBrokera(tekst: string, strefa: string): WynikCzasu {
  const t = tekst.trim();
  if (t === "") return { ok: false, powod: "pusty czas" };
  if (!strefaPoprawna(strefa)) return { ok: false, powod: `strefa »${strefa}« nie jest strefa IANA (np. Europe/Warsaw)` };

  const iso = WZORZEC_ISO.exec(t);
  if (iso) {
    const [, r, mies, d, g, min, s = "0", offset] = iso;
    const liczby = [r, mies, d, g, min, s].map(Number);
    if (!poprawnaData(liczby[0], liczby[1], liczby[2], liczby[3], liczby[4], liczby[5])) {
      return { ok: false, powod: `data »${t}« nie istnieje w kalendarzu` };
    }
    if (offset) {
      const przes = offset.toUpperCase() === "Z" ? 0 : przesunieciePrzezOffset(offset);
      const utc = Date.UTC(liczby[0], liczby[1] - 1, liczby[2], liczby[3], liczby[4], liczby[5]) - przes;
      return { ok: true, czas: new Date(utc), zPliku: true, niejednoznaczny: false, nieistniejacy: false };
    }
    const w = sciennyNaUtc(liczby[0], liczby[1], liczby[2], liczby[3], liczby[4], liczby[5], strefa);
    return { ok: true, ...w, zPliku: false };
  }

  const usa = WZORZEC_USA.exec(t);
  if (usa) {
    const mies = Number(usa[1]);
    const d = Number(usa[2]);
    const r = Number(usa[3]);
    let g = Number(usa[4]);
    const min = Number(usa[5]);
    const s = usa[6] === undefined ? 0 : Number(usa[6]);
    const ampm = usa[7]?.toUpperCase();
    if (ampm) {
      if (g < 1 || g > 12) return { ok: false, powod: `godzina »${usa[4]}« z AM/PM poza zakresem 1-12` };
      g = (g % 12) + (ampm === "PM" ? 12 : 0);
    }
    if (!poprawnaData(r, mies, d, g, min, s)) return { ok: false, powod: `data »${t}« nie istnieje w kalendarzu` };
    const w = sciennyNaUtc(r, mies, d, g, min, s, strefa);
    return { ok: true, ...w, zPliku: false };
  }
  return { ok: false, powod: `format czasu »${t}« nie jest rozpoznany (oczekiwano MM/DD/YYYY HH:MM:SS albo ISO 8601)` };
}

function poprawnaData(r: number, mies: number, d: number, g: number, min: number, s: number): boolean {
  if (mies < 1 || mies > 12 || d < 1 || d > 31 || g < 0 || g > 23 || min < 0 || min > 59 || s < 0 || s > 59) return false;
  const t = new Date(Date.UTC(r, mies - 1, d));
  return t.getUTCFullYear() === r && t.getUTCMonth() === mies - 1 && t.getUTCDate() === d;
}

function przesunieciePrzezOffset(offset: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!m) return 0;
  const minuty = Number(m[2]) * 60 + Number(m[3]);
  return (m[1] === "-" ? -1 : 1) * minuty * 60_000;
}
