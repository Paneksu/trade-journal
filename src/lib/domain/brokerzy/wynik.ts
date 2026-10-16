/**
 * Wynik trade'a brokera: brutto, opłaty, netto (ADR-034 pkt 5). Czyste funkcje.
 *
 *  - brutto: z pliku (Trade Paired), gdy pokrywa KAZDE wyjscie; inaczej z cen wypelnien przez `computeTrade`;
 *  - opłaty: z pliku (Commission), gdy znaleziono prowizje dla KAZDEGO wypelnienia trade'a (zrodlo `broker`); inaczej
 *    stawka x zamkniete kontrakty (`rate`, w UI »opłaty wg stawki«); bez stawki NULL;
 *  - netto = brutto - opłaty; NULL, gdy czegos brakuje (nie udajemy wyniku, ktorego nie znamy).
 */

import { computeTrade, type InstrumentSpec } from "../calc";
import type { TradeZGrupowania } from "./grupowanie";
import type { BruttoTradu } from "./oplaty";

export type WejscieWyniku = {
  trade: TradeZGrupowania;
  /** Specyfikacja instrumentu (tick, wartosc ticku); `null`, gdy rdzen kontraktu nie jest znany. */
  instrument: InstrumentSpec | null;
  /** Stawka round turn za kontrakt dla klasy tego instrumentu, w centach; `null` = brak stawki. */
  stawkaRtCenty: number | null;
  /** Oplaty z Cash History per id wypelnienia (patrz `przypiszOplaty`). */
  oplatyZPliku: Map<string, number>;
  /** Brutto z Cash History dla tego trade'a (patrz `przypiszBrutto`), jesli plik byl wgrany. */
  bruttoZPliku: BruttoTradu | null;
};

export type WynikTraduBrokera = {
  grossCents: number | null;
  grossSource: "broker" | "computed" | null;
  feesCents: number | null;
  feeSource: "broker" | "rate" | null;
  netCents: number | null;
  /** Brutto wyliczone z cen wypelnien (do porownania z plikiem), gdy znamy instrument. */
  grossComputedCents: number | null;
};

/** Dopuszczalna roznica brutto z pliku i z cen (poslizg zaokraglen cen wypelnien): 1,00 USD + 1% wyniku. */
const TOLERANCJA_BRUTTO_CENTY = 100;

export function wynikTraduBrokera(w: WejscieWyniku): WynikTraduBrokera {
  const t = w.trade;
  if (t.status !== "closed") {
    return { grossCents: null, grossSource: null, feesCents: null, feeSource: null, netCents: null, grossComputedCents: null };
  }

  let grossComputedCents: number | null = null;
  if (w.instrument) {
    const r = computeTrade({
      instrument: w.instrument,
      direction: t.kierunek,
      contracts: t.maxIlosc,
      entryPrice: t.sredniaCenaWejscia,
      exits: t.wyjscia.map((x) => ({ price: x.cena, contracts: x.ilosc, time: x.czas })),
      stopLoss: null,
      takeProfit: null,
      mae: null,
      mfe: null,
      entryTime: t.czasWejscia,
      feeRtCents: null,
    });
    grossComputedCents = r.pnl;
  }

  let grossCents: number | null = null;
  let grossSource: "broker" | "computed" | null = null;
  // Kontrola krzyzowa (recenzja W1): Trade Paired z pliku musi zgadzac sie z brutto z cen wypelnien. Duze rozjazdy (np. zlecenie rozlozone
  // na kilka sekund, wiec część par w innej sekundzie) oznaczają blad dopasowania wierszy, wiec nie podajemy go jako »z rachunku«.
  const zgodne =
    !w.bruttoZPliku ||
    w.bruttoZPliku.centy === null ||
    grossComputedCents === null ||
    Math.abs(w.bruttoZPliku.centy - grossComputedCents) <= TOLERANCJA_BRUTTO_CENTY + Math.abs(grossComputedCents) * 0.01;
  if (w.bruttoZPliku && w.bruttoZPliku.centy !== null && zgodne) {
    grossCents = w.bruttoZPliku.centy;
    grossSource = "broker";
  } else if (grossComputedCents !== null) {
    grossCents = grossComputedCents;
    grossSource = "computed";
  }

  // Oplaty z pliku: musza byc znane dla WSZYSTKICH wypelnien trade'a (wejscia i wyjscia).
  const udzialy = [...t.wejscia, ...t.wyjscia];
  const maWszystkie = udzialy.length > 0 && udzialy.every((u) => w.oplatyZPliku.has(u.idZrodla));
  let feesCents: number | null = null;
  let feeSource: "broker" | "rate" | null = null;
  if (maWszystkie) {
    // Wypelnienie podzielone odwroceniem dzieli oplate proporcjonalnie do ilosci przypadajacej na trade.
    const suma = udzialy.reduce((s, u) => s + (w.oplatyZPliku.get(u.idZrodla) as number) * (u.ilosc / u.iloscCalegoWypelnienia), 0);
    feesCents = Math.round(suma);
    feeSource = "broker";
  } else if (w.stawkaRtCenty !== null) {
    const zamkniete = t.wyjscia.reduce((s, u) => s + u.ilosc, 0);
    feesCents = Math.round(w.stawkaRtCenty * zamkniete);
    feeSource = "rate";
  }

  const netCents = grossCents !== null && feesCents !== null ? grossCents - feesCents : null;
  return { grossCents, grossSource, feesCents, feeSource, netCents, grossComputedCents };
}
