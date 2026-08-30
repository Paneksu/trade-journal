import { type Progi, wynikTrade } from "./outcome";

/**
 * Statystyki trade'ow pominietych ("nie wzietych") - sekcja "Pominiete" na
 * /stats. Licza sie OSOBNO od statystyk glownych (closedOnly zostaje
 * doslownie status === "closed"), ale klasyfikacja wygrany/przegrany/be
 * idzie przez ten sam `wynikTrade` z outcome.ts - ten sam prog BE co wszedzie
 * (ADR-011), inaczej "by wygralo" klamaloby wobec kolumny "Wynik" gdzie
 * indziej w aplikacji.
 *
 * Dwie liczby R, nie jedna:
 *  - `zyskowneR`  - suma R samych wygranych = R faktycznie stracone przez to,
 *                   ze setup nie zostal wziety,
 *  - `sumaR`      - netto calego zbioru (pominiety stratny to R oszczedzone).
 * Sama `zyskowneR` systematycznie schlebia - pokazuje tylko upuszczone zyski,
 * nigdy oszczedzone straty.
 */

export type PominietyWejscie = {
  pnl: number;
  riskAmount: number | null;
  contracts: number;
  rMultiple: number | null;
};

export type StatystykiPominietych = {
  count: number;
  wygrane: number;
  przegrane: number;
  be: number;
  zyskowneR: number;
  sumaR: number;
  sumaPnl: number;
};

export function statystykiPominietych(
  list: readonly PominietyWejscie[],
  progi: Progi,
): StatystykiPominietych {
  const wynik: StatystykiPominietych = {
    count: list.length,
    wygrane: 0,
    przegrane: 0,
    be: 0,
    zyskowneR: 0,
    sumaR: 0,
    sumaPnl: 0,
  };

  for (const t of list) {
    const w = wynikTrade({ pnl: t.pnl, riskAmount: t.riskAmount, contracts: t.contracts }, progi);
    const r = t.rMultiple ?? 0;

    wynik.sumaPnl += t.pnl;
    wynik.sumaR += r;

    if (w === "zysk") {
      wynik.wygrane += 1;
      wynik.zyskowneR += r;
    } else if (w === "strata") {
      wynik.przegrane += 1;
    } else {
      wynik.be += 1;
    }
  }

  return wynik;
}
