/**
 * Mapowanie symboli z TradingView i FX Replay na symbol z katalogu instrumentow
 * dziennika (ADR-026). Modul czysty.
 *
 * Ten sam instrument bywa zapisany na kilka sposobow:
 *   CME_MINI:NQZ2026   gielda + korzen + kod miesiaca + rok
 *   NQ1!  MNQ1!        kontrakt ciagly (TradingView)
 *   CME_MINI:NQ1       kontrakt ciagly bez "!" (FX Replay)
 *   NQZ26  ESH6        bez gieldy
 *   NQ                 sam korzen
 *
 * Zapis jest dwuznaczny z natury: "NQ1" to korzen NQ z numerem kontraktu, ale
 * rownie dobrze N + Q(sierpien) + rok 1. Dlatego NIE wybieramy pierwszej
 * pasujacej interpretacji. Zbieramy wszystkie, zostawiamy te, ktorych korzen
 * jest w katalogu instrumentow, i dopiero wtedy: 0 = blad, 1 = wynik,
 * wiecej = blad "niejednoznaczny". Katalog jest wiec argumentem WYMAGANYM -
 * bez niego nie ma jak odroznic korzenia od przyrostka.
 *
 * CFD NIE jest mapowane (US100, NAS100, USTEC): to inny produkt niz kontrakt
 * futures - inna wielkosc pozycji i wartosc punktu - wiec zamiana po cichu
 * dalaby wynik w pieniadzach zly o czynnik, ktorego nikt by nie zauwazyl.
 */

export type WynikSymbolu = { ok: true; symbol: string } | { ok: false; error: string };

const MIESIAC_ROK = /^[FGHJKMNQUVXZ](?:\d{4}|\d{1,2})$/;
const CIAGLY = /^[1-9]!?$/;

/**
 * @param surowy  symbol tak, jak przyszedl od klienta
 * @param znane   symbole z katalogu instrumentow (wymagane)
 */
export function mapujSymbol(surowy: string, znane: readonly string[]): WynikSymbolu {
  if (!Array.isArray(znane) || znane.length === 0) {
    throw new Error("mapujSymbol: katalog instrumentow (znane) jest wymagany i nie moze byc pusty.");
  }
  const wejscie = (surowy ?? "").trim();
  if (wejscie === "") {
    return { ok: false, error: "symbol: pusty. Podaj np. NQ, NQ1!, CME_MINI:NQ1 albo CME_MINI:NQZ2026." };
  }

  const opisZnanych = ` Znane instrumenty: ${znane.join(", ")}.`;
  const odrzuc = (powod: string): WynikSymbolu => ({
    ok: false,
    error: `symbol »${wejscie}«: ${powod}${opisZnanych}`,
  });

  let rdzen = wejscie.toUpperCase();
  // Gielda: "CME_MINI:NQZ2026", "COMEX:GC1!".
  const dwukropek = rdzen.lastIndexOf(":");
  if (dwukropek !== -1) rdzen = rdzen.slice(dwukropek + 1);
  rdzen = rdzen.trim();

  if (!/^[A-Z0-9!]+$/.test(rdzen)) {
    return odrzuc("zawiera znaki spoza liter, cyfr i »!«.");
  }

  const opisy = new Map<string, string[]>(); // korzen z katalogu -> jak go odczytano
  const dodaj = (korzen: string, jak: string) => {
    if (!znane.includes(korzen)) return;
    opisy.set(korzen, [...(opisy.get(korzen) ?? []), jak]);
  };

  dodaj(rdzen, "dokładny symbol");
  for (let dl = 1; dl < rdzen.length; dl += 1) {
    const korzen = rdzen.slice(0, dl);
    const reszta = rdzen.slice(dl);
    if (MIESIAC_ROK.test(reszta)) dodaj(korzen, `korzeń ${korzen} + miesiąc i rok (${reszta})`);
    if (CIAGLY.test(reszta)) dodaj(korzen, `korzeń ${korzen} + kontrakt ciągły (${reszta})`);
  }

  if (opisy.size === 1) return { ok: true, symbol: [...opisy.keys()][0] };
  if (opisy.size > 1) {
    const lista = [...opisy.entries()].map(([k, jak]) => `${k} (${jak.join("; ")})`).join(" albo ");
    return {
      ok: false,
      error: `symbol »${wejscie}«: zapis niejednoznaczny - pasuje do ${lista}. Podaj dokładny symbol albo kontrakt z kodem miesiąca i rokiem.`,
    };
  }

  if (/^(US100|NAS100|USTEC|NDX|NASDAQ)$/.test(rdzen)) {
    return odrzuc(
      "to indeks albo CFD, nie kontrakt futures z katalogu - wartość punktu jest inna, więc nie mapuję go sam.",
    );
  }
  return odrzuc("nie pasuje do żadnego instrumentu z katalogu.");
}
