/**
 * Ocena procesu osobno od wyniku (ADR-033, MUST 3; metodyka R4, R8).
 *
 * Skala A/B/C wg Tendlera: A = zgodny z regulami, B = drobne odchylenia, C =
 * naruszenie. Siatka 2x2 laczy proces z wynikiem:
 *   dobry proces + zysk   - zasluzony zysk
 *   dobry proces + strata - "dobra strata" (zostaje, nie ruszaj procesu)
 *   zly proces   + zysk   - "szczescie" (najgrozniejsze: nagradza zle nawyki)
 *   zly proces   + strata - zasluzona strata
 * Trade'y z wynikiem BE licza sie osobno (ani zysk, ani strata), a trade'y bez
 * oceny procesu osobno: nie zgadujemy za uzytkownika.
 *
 * "Dobry proces" to domyslnie A i B (B = drobne odchylenia, plan dotrzymany);
 * `dobryProces` mozna zawezic do samego A. Modul czysty.
 */

import type { Wynik } from "./outcome";

export type OcenaProcesu = "A" | "B" | "C";
export const OCENY_PROCESU: readonly OcenaProcesu[] = ["A", "B", "C"];

export function czyOcenaProcesu(w: unknown): w is OcenaProcesu {
  return w === "A" || w === "B" || w === "C";
}

export const OCENA_PROCESU_OPISY: Record<OcenaProcesu, string> = {
  A: "A: zgodny z regułami",
  B: "B: drobne odchylenia",
  C: "C: naruszenie",
};

export type TradeDoSiatki = {
  id: number;
  entryTime: Date;
  processGrade: OcenaProcesu | null;
  wynik: Wynik;
  rMultiple: number | null;
  pnlCents: number;
};

export type Komorka = {
  count: number;
  /** Suma R z tych trade'ow, ktore maja R (trade bez stopa nie ma R). */
  sumR: number;
  countR: number;
  avgR: number | null;
  sumPnlCents: number;
  tradeIds: number[];
};

function pustaKomorka(): Komorka {
  return { count: 0, sumR: 0, countR: 0, avgR: null, sumPnlCents: 0, tradeIds: [] };
}

function dodaj(k: Komorka, t: TradeDoSiatki): void {
  k.count += 1;
  k.tradeIds.push(t.id);
  k.sumPnlCents += t.pnlCents;
  if (t.rMultiple !== null && Number.isFinite(t.rMultiple)) {
    k.sumR += t.rMultiple;
    k.countR += 1;
  }
}

function zamknij(k: Komorka): Komorka {
  k.avgR = k.countR > 0 ? k.sumR / k.countR : null;
  return k;
}

export type SiatkaProcesu = {
  /** Dobry proces. */
  zasluzonyZysk: Komorka;
  dobraStrata: Komorka;
  /** Zly proces. */
  szczescie: Komorka;
  zasluzonaStrata: Komorka;
  /** Wynik BE: osobno dla dobrego i zlego procesu. */
  beDobryProces: Komorka;
  beZlyProces: Komorka;
  nieocenione: Komorka;
  ocenione: number;
  rozklad: Record<OcenaProcesu, Komorka & { udzial: number | null }>;
  /**
   * Koszt gry C ("inchworm" Tendlera): suma R i P/L trade'ow z oceną C.
   * Ujemna suma = ile kosztowala gra C.
   */
  kosztGryC: { count: number; sumR: number; sumPnlCents: number };
};

export function siatkaProcesu(trades: readonly TradeDoSiatki[], dobryProces: readonly OcenaProcesu[] = ["A", "B"]): SiatkaProcesu {
  const dobre = new Set<OcenaProcesu>(dobryProces);
  const s = {
    zasluzonyZysk: pustaKomorka(),
    dobraStrata: pustaKomorka(),
    szczescie: pustaKomorka(),
    zasluzonaStrata: pustaKomorka(),
    beDobryProces: pustaKomorka(),
    beZlyProces: pustaKomorka(),
    nieocenione: pustaKomorka(),
  };
  const rozklad = { A: pustaKomorka(), B: pustaKomorka(), C: pustaKomorka() };
  let ocenione = 0;

  for (const t of trades) {
    if (t.processGrade === null) {
      dodaj(s.nieocenione, t);
      continue;
    }
    ocenione += 1;
    dodaj(rozklad[t.processGrade], t);
    const dobry = dobre.has(t.processGrade);
    if (t.wynik === "be") dodaj(dobry ? s.beDobryProces : s.beZlyProces, t);
    else if (dobry) dodaj(t.wynik === "zysk" ? s.zasluzonyZysk : s.dobraStrata, t);
    else dodaj(t.wynik === "zysk" ? s.szczescie : s.zasluzonaStrata, t);
  }

  for (const k of Object.values(s)) zamknij(k);
  for (const k of Object.values(rozklad)) zamknij(k);
  const rozkladZUdzialem = {
    A: { ...rozklad.A, udzial: ocenione > 0 ? rozklad.A.count / ocenione : null },
    B: { ...rozklad.B, udzial: ocenione > 0 ? rozklad.B.count / ocenione : null },
    C: { ...rozklad.C, udzial: ocenione > 0 ? rozklad.C.count / ocenione : null },
  };
  return {
    ...s,
    ocenione,
    rozklad: rozkladZUdzialem,
    kosztGryC: { count: rozklad.C.count, sumR: rozklad.C.sumR, sumPnlCents: rozklad.C.sumPnlCents },
  };
}

const RANGA: Record<OcenaProcesu, number> = { A: 0, B: 1, C: 2 };

/**
 * Najlepsze i najgorsze trade'y wedlug PROCESU, nie wyniku (R8). Proces ma tylko
 * trzy stopnie, wiec remisy sa nieuniknione: rozstrzyga czas wejscia, potem id.
 * Celowo NIE rozstrzygamy wynikiem - to podmienialoby ocene procesu ocena wyniku.
 * Przy malej liczbie ocenionych trade'ow lista najlepszych i najgorszych sie nie
 * pokrywa: najlepsze dostaja polowe (zaokraglona w gore), najgorsze reszte.
 */
export function najlepszeINajgorsze(
  trades: readonly TradeDoSiatki[],
  k = 3,
): { najlepsze: number[]; najgorsze: number[] } {
  const ocenione = trades.filter((t) => t.processGrade !== null);
  const rosnaco = [...ocenione].sort(
    (a, b) =>
      RANGA[a.processGrade!] - RANGA[b.processGrade!] || a.entryTime.getTime() - b.entryTime.getTime() || a.id - b.id,
  );
  const liczbaNajlepszych = Math.min(k, Math.ceil(rosnaco.length / 2));
  const najlepsze = rosnaco.slice(0, liczbaNajlepszych);
  const reszta = rosnaco.slice(liczbaNajlepszych);
  // Najgorsze: od konca (C pierwsze); w ramach tej samej oceny najwczesniejsze wejscie jako pierwsze.
  const malejaco = [...reszta].sort(
    (a, b) =>
      RANGA[b.processGrade!] - RANGA[a.processGrade!] || a.entryTime.getTime() - b.entryTime.getTime() || a.id - b.id,
  );
  return { najlepsze: najlepsze.map((t) => t.id), najgorsze: malejaco.slice(0, k).map((t) => t.id) };
}
