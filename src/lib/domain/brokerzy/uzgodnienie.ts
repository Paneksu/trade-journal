/**
 * Uzgodnienie wyniku szacunkowego z rzeczywistym (ADR-034 pkt 5). Czyste funkcje.
 *
 * Wynik trade'a jest albo WYLICZONY (z cen trade'a minus oplaty ze stawki), albo Z RACHUNKU (kwota netto z brokera).
 * Roznica miedzy nimi to »poslizg i oplaty« pokazywane przy trade'zie: poslizg = roznica wyniku brutto (cena zlecenia
 * brokera kontra cena w dzienniku), oplaty = roznica kosztow (rzeczywiste kontra ze stawki). Suma obu = roznica netto.
 */

export type WejscieUzgodnienia = {
  /** `trades.pnl`: netto, z rachunku albo wyliczony. */
  pnl: number | null;
  /** `trades.pnl_estimate`: wynik wyliczony. */
  pnlEstimate: number | null;
  /** `trades.broker_amount`: kwota netto z rachunku; `null` = wynik wyliczony. */
  brokerAmount: number | null;
  /** `trades.fees`: oplaty oszacowane ze stawki; `null` = nieznane. */
  feesEstimate: number | null;
  /** Oplaty z rachunku (z trade'a brokera), jesli znane. */
  feesBroker: number | null;
};

export type Uzgodnienie = {
  zrodlo: "z_rachunku" | "wyliczony";
  /** Roznica `pnl - pnlEstimate` w centach; `null` dla wyniku wyliczonego albo gdy czegos brakuje. */
  roznicaCenty: number | null;
  /** Czesc roznicy z cen (brutto): `roznica - roznicaOplat`. `null`, gdy nie znamy oplat z rachunku. */
  poslizgCenty: number | null;
  /** Czesc roznicy z oplat: oplaty oszacowane minus oplaty z rachunku. `null`, gdy nie znamy oplat z rachunku. */
  roznicaOplatCenty: number | null;
};

export function uzgodnij(w: WejscieUzgodnienia): Uzgodnienie {
  if (w.brokerAmount === null || w.pnl === null || w.pnlEstimate === null) {
    return { zrodlo: w.brokerAmount === null ? "wyliczony" : "z_rachunku", roznicaCenty: null, poslizgCenty: null, roznicaOplatCenty: null };
  }
  const roznica = w.pnl - w.pnlEstimate;
  if (w.feesBroker === null) return { zrodlo: "z_rachunku", roznicaCenty: roznica, poslizgCenty: null, roznicaOplatCenty: null };
  const oplaty = (w.feesEstimate ?? 0) - w.feesBroker;
  return { zrodlo: "z_rachunku", roznicaCenty: roznica, poslizgCenty: roznica - oplaty, roznicaOplatCenty: oplaty };
}
