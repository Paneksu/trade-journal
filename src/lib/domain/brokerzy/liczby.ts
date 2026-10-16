/**
 * Liczby z plikow brokera. Kwoty maja przecinek tysiecy w cudzyslowie ("24,995.50"), ulamek po kropce.
 * Zadnego zgadywania: zapis, ktorego nie rozumiemy (np. przecinek dziesietny), to blad komorki z numerem wiersza,
 * a nie po cichu inna liczba. Kwoty zamieniamy na centy ARYTMETYKA NA NAPISIE, bez liczb zmiennoprzecinkowych.
 */

export type WynikLiczby = { ok: true; wartosc: number } | { ok: false; powod: string };
export type WynikCentow = { ok: true; centy: number } | { ok: false; powod: string };

const Z_TYSIACAMI = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const ZWYKLA = /^-?\d+(\.\d+)?$/;

/** Czyta dziesietna liczbe: `12.5`, `-4.50`, `554,139.00`. Przecinek wolno tylko jako separator tysiecy. */
export function parsujLiczbe(tekst: string): WynikLiczby {
  const t = tekst.trim();
  if (t === "") return { ok: false, powod: "pusta wartosc" };
  let czysty: string;
  if (ZWYKLA.test(t)) czysty = t;
  else if (Z_TYSIACAMI.test(t)) czysty = t.replaceAll(",", "");
  else {
    return {
      ok: false,
      powod: `»${t.slice(0, 40)}« nie jest liczba (oczekiwano np. 30785.50 albo "554,139.00": kropka dziesietna, przecinek tylko jako tysiace)`,
    };
  }
  const n = Number(czysty);
  if (!Number.isFinite(n)) return { ok: false, powod: `»${t.slice(0, 40)}« jest poza zakresem liczb` };
  return { ok: true, wartosc: n };
}

/** Kwota w dolarach -> centy (calkowite). Wiecej niz dwa miejsca po kropce (poza zerami) to blad: kwota nie jest w centach. */
export function parsujCenty(tekst: string): WynikCentow {
  const t = tekst.trim();
  if (t === "") return { ok: false, powod: "pusta kwota" };
  let czysty: string;
  if (ZWYKLA.test(t)) czysty = t;
  else if (Z_TYSIACAMI.test(t)) czysty = t.replaceAll(",", "");
  else {
    return { ok: false, powod: `»${t.slice(0, 40)}« nie jest kwota (oczekiwano np. -4.50 albo "24,995.50")` };
  }
  const minus = czysty.startsWith("-");
  const [calosc, ulamek = ""] = (minus ? czysty.slice(1) : czysty).split(".");
  const nadmiar = ulamek.slice(2);
  if (nadmiar !== "" && /[1-9]/.test(nadmiar)) {
    return { ok: false, powod: `kwota »${t}« ma wiecej niz dwa miejsca po kropce, wiec nie jest w centach` };
  }
  const centy = Number(calosc) * 100 + Number((ulamek + "00").slice(0, 2));
  if (!Number.isSafeInteger(centy)) return { ok: false, powod: `kwota »${t.slice(0, 40)}« jest poza zakresem` };
  return { ok: true, centy: centy === 0 ? 0 : minus ? -centy : centy };
}
