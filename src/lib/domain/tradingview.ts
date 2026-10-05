/**
 * Mapowanie symboli z TradingView i FX Replay na symbol z katalogu instrumentow
 * dziennika (ADR-026). Modul czysty.
 *
 * TradingView podaje kontrakt w kilku postaciach, wszystkie dla tego samego
 * instrumentu w dzienniku:
 *   CME_MINI:NQZ2026   gielda + symbol + kod miesiaca + rok
 *   NQ1!  MNQ1!        kontrakt ciagly (1! = najblizszy, 2! = nastepny)
 *   NQZ2026  NQZ26     bez gieldy
 *   NQ                 sam korzen
 *
 * Kontrakt ciagly i konkretny miesiac sa tu rownowazne: dziennik trzyma
 * instrument (NQ), nie serie kontraktow, a wartosc ticku nie zalezy od miesiaca.
 *
 * CFD NIE jest mapowane (US100, NAS100, USTEC): to inny produkt niz kontrakt
 * futures - inna wielkosc pozycji i wartosc punktu - wiec zamiana po cichu
 * dalaby wynik w pieniadzach zly o czynnik, ktorego nikt by nie zauwazyl.
 * Gdy FX Replay okaze sie podawac taki symbol dla kontraktu, dopisuje sie go
 * do `ALIASY` swiadoma decyzja, nie domyslem.
 */

/** Kody miesiecy kontraktow terminowych: F=sty ... Z=gru. */
const KODY_MIESIECY = "FGHJKMNQUVXZ";

/** Jawne aliasy nazw nie bedacych korzeniem kontraktu. Puste celowo - patrz wyzej. */
export const ALIASY: Readonly<Record<string, string>> = {};

export type WynikSymbolu =
  | { ok: true; symbol: string }
  | { ok: false; error: string };

/**
 * @param surowy  symbol tak, jak przyszedl od klienta
 * @param znane   symbole z katalogu instrumentow; gdy podane, wynik musi byc na liscie
 */
export function mapujSymbol(surowy: string, znane?: readonly string[]): WynikSymbolu {
  const wejscie = (surowy ?? "").trim();
  if (wejscie === "") {
    return { ok: false, error: "symbol: pusty. Podaj np. NQ, NQ1! albo CME_MINI:NQZ2026." };
  }

  const opisZnanych = znane && znane.length > 0 ? ` Znane instrumenty: ${znane.join(", ")}.` : "";
  const odrzuc = (powod: string): WynikSymbolu => ({
    ok: false,
    error: `symbol »${wejscie}«: ${powod}${opisZnanych}`,
  });
  const znany = (s: string) => (znane ? znane.includes(s) : true);

  let rdzen = wejscie.toUpperCase();
  // Gielda: "CME_MINI:NQZ2026", "COMEX:GC1!".
  const dwukropek = rdzen.lastIndexOf(":");
  if (dwukropek !== -1) rdzen = rdzen.slice(dwukropek + 1);
  rdzen = rdzen.trim();

  if (!/^[A-Z0-9!]+$/.test(rdzen)) {
    return odrzuc("zawiera znaki spoza liter, cyfr i »!«.");
  }

  const alias = ALIASY[rdzen];
  if (alias) return znany(alias) ? { ok: true, symbol: alias } : odrzuc("alias wskazuje instrument spoza katalogu.");

  // Kontrakt ciagly: "NQ1!", "MNQ2!".
  const ciagly = /^([A-Z0-9]+?)\d!$/.exec(rdzen);
  if (ciagly) rdzen = ciagly[1];

  if (rdzen.includes("!")) return odrzuc("nieczytelny zapis kontraktu ciaglego (oczekiwano np. NQ1!).");

  // Najpierw sam korzen: "6E", "M2K", "NQ" nie sa miesiacem z rokiem.
  if (znany(rdzen) && (znane || !/[FGHJKMNQUVXZ]\d{1,4}$/.test(rdzen))) {
    return { ok: true, symbol: rdzen };
  }

  // Korzen + kod miesiaca + rok: "NQZ2026", "NQZ26", "ESH6".
  const zMiesiacem = new RegExp(`^([A-Z0-9]{1,4}?)([${KODY_MIESIECY}])(\\d{4}|\\d{1,2})$`).exec(rdzen);
  if (zMiesiacem && znany(zMiesiacem[1])) {
    return { ok: true, symbol: zMiesiacem[1] };
  }

  if (/^(US100|NAS100|USTEC|NDX|NASDAQ)$/.test(rdzen)) {
    return odrzuc("to indeks albo CFD, nie kontrakt futures z katalogu - wartosc punktu jest inna, wiec nie mapuje go sam.");
  }
  return odrzuc("nie pasuje do zadnego instrumentu z katalogu.");
}
