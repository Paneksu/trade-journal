/**
 * Opłaty i wynik brutto z Cash History przypisane do wypelnien i trade'ow brokera (ADR-034 pkt 2 i 5). Czyste funkcje.
 *
 * Wiersz Commission nie ma id zlecenia. Laczymy go z wypelnieniem po SEKUNDZIE (`Timestamp` prowizji = `Fill Time`
 * zlecenia) i KONTRAKCIE; POTWIERDZONE na probkach. Gdy w tej samej sekundzie na tym samym kontrakcie jest kilka
 * wypelnien, suma prowizji dzieli sie miedzy nie proporcjonalnie do ilosci (metoda najwiekszej reszty: suma sie zgadza
 * co do centa). `Trade Paired` to wynik BRUTTO pary i leży w sekundzie wyjscia.
 */

import type { TradeZGrupowania } from "./grupowanie";
import type { Wypelnienie, ZdarzenieCash } from "./typy";

const sekunda = (d: Date): number => Math.floor(d.getTime() / 1000);

/** Rozklada `suma` (centy) na czesci proporcjonalnie do `wagi`, bez utraty centa. */
export function rozdzielProporcjonalnie(suma: number, wagi: number[]): number[] {
  const calosc = wagi.reduce((s, w) => s + w, 0);
  if (wagi.length === 0) return [];
  if (calosc <= 0) return wagi.map((_, i) => (i === 0 ? suma : 0));
  const dokladne = wagi.map((w) => (suma * w) / calosc);
  const podloga = dokladne.map((x) => Math.floor(x));
  let reszta = suma - podloga.reduce((s, x) => s + x, 0);
  const kolejnosc = dokladne
    .map((x, i) => ({ i, ulamek: x - Math.floor(x) }))
    .sort((a, b) => b.ulamek - a.ulamek || a.i - b.i);
  for (const { i } of kolejnosc) {
    if (reszta <= 0) break;
    podloga[i] += 1;
    reszta -= 1;
  }
  return podloga;
}

export type OplatyWypelnien = {
  /** Oplata w centach (>= 0) per id zrodla wypelnienia; brak klucza = nie znaleziono prowizji dla tego wypelnienia. */
  poId: Map<string, number>;
  /** Zdarzenia kosztowe (Commission, Fee) bez pasujacego wypelnienia: czekaja na plik Orders. */
  bezWypelnienia: ZdarzenieCash[];
};

const KOSZTOWE = new Set(["commission", "fee"]);

export function przypiszOplaty(wypelnienia: Wypelnienie[], zdarzenia: ZdarzenieCash[]): OplatyWypelnien {
  const koszty = zdarzenia.filter((z) => KOSZTOWE.has(z.rodzaj) && z.kontrakt !== null);
  const poId = new Map<string, number>();
  const bezWypelnienia: ZdarzenieCash[] = [];

  const wypGrupy = new Map<string, Wypelnienie[]>();
  for (const w of wypelnienia) {
    const k = `${w.kontrakt}|${sekunda(w.czas)}`;
    wypGrupy.set(k, [...(wypGrupy.get(k) ?? []), w]);
  }
  const kosztGrupy = new Map<string, ZdarzenieCash[]>();
  for (const z of koszty) {
    const k = `${z.kontrakt}|${sekunda(z.czas)}`;
    kosztGrupy.set(k, [...(kosztGrupy.get(k) ?? []), z]);
  }
  for (const [klucz, zd] of kosztGrupy) {
    const fills = wypGrupy.get(klucz);
    if (!fills || fills.length === 0) {
      bezWypelnienia.push(...zd);
      continue;
    }
    // Koszt ma znak minus; oplata jest nieujemna (zwrot prowizji nie robi z oplaty zysku).
    const oplata = Math.max(0, -zd.reduce((s, z) => s + z.deltaCenty, 0));
    const czesci = rozdzielProporcjonalnie(oplata, fills.map((f) => f.ilosc));
    fills.forEach((f, i) => poId.set(f.idZrodla, czesci[i]));
  }
  return { poId, bezWypelnienia };
}

export type BruttoTradu = {
  /** Suma Trade Paired w sekundach wyjsc trade'a; `null`, gdy pokrycie niepelne albo sekunda wspolna z innym trade'em. */
  centy: number | null;
  /** Ile sekund wyjsc nie mialo wiersza Trade Paired. */
  bezPary: number;
  /** Sekundy wyjsc wspolne z innym trade'em tego kontraktu (nie da sie rozstrzygnac, ktoremu nalezy wiersz). */
  niejednoznaczne: number;
};

/**
 * Wynik BRUTTO z Cash History dla zamknietych trade'ow jednego konta. Klucz mapy to `klucz` trade'a. Wiersz Trade Paired
 * nalezy do trade'a, ktory ma wyjscie w tej samej sekundzie na tym samym kontrakcie; gdy takich trade'ow jest wiecej niz
 * jeden, wiersza nie przypisujemy zadnemu (wynik brutto wyliczy `computeTrade` z cen).
 */
export function przypiszBrutto(trade: TradeZGrupowania[], zdarzenia: ZdarzenieCash[]): Map<string, BruttoTradu> {
  const poSekundzie = new Map<string, number>();
  for (const z of zdarzenia) {
    if (z.rodzaj !== "trade_paired" || z.kontrakt === null) continue;
    const k = `${z.kontrakt}|${sekunda(z.czas)}`;
    poSekundzie.set(k, (poSekundzie.get(k) ?? 0) + z.deltaCenty);
  }
  const wynik = new Map<string, BruttoTradu>();

  const wlasciciele = new Map<string, Set<string>>();
  for (const t of trade) {
    if (t.status !== "closed") continue;
    for (const w of t.wyjscia) {
      const k = `${t.kontrakt}|${sekunda(w.czas)}`;
      const s = wlasciciele.get(k) ?? new Set<string>();
      s.add(t.klucz);
      wlasciciele.set(k, s);
    }
  }
  for (const t of trade) {
    if (t.status !== "closed") continue;
    const sekundy = [...new Set(t.wyjscia.map((w) => sekunda(w.czas)))];
    let suma = 0;
    let bezPary = 0;
    let niejednoznaczne = 0;
    for (const s of sekundy) {
      const k = `${t.kontrakt}|${s}`;
      if ((wlasciciele.get(k)?.size ?? 0) > 1) {
        niejednoznaczne += 1;
        continue;
      }
      const kwota = poSekundzie.get(k);
      if (kwota === undefined) {
        bezPary += 1;
        continue;
      }
      suma += kwota;
    }
    wynik.set(t.klucz, { centy: bezPary === 0 && niejednoznaczne === 0 ? suma : null, bezPary, niejednoznaczne });
  }
  return wynik;
}
