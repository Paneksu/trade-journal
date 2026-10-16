/**
 * Dopasowanie trade'ow brokera do trade'ow dziennika (ADR-034 pkt 4). Czyste funkcje.
 *
 * Kandydat: trade dziennika na koncie przypisanym do konta u brokera, ten sam instrument i kierunek, wejscie w oknie
 * +-120 s od wejscia z brokera. Okno 120 s, bo czasy w dzienniku pochodza z formularza i z TradingView (dokladnosc do
 * minuty). Dopasowanie 1:1 = dokladnie jeden kandydat, ktory sam pasuje tylko do tego jednego trade'a brokera, i ta sama
 * liczba kontraktow. Wszystko inne (kilku kandydatow, inna liczba kontraktow) to »niejednoznaczne« i trafia do decyzji
 * uzytkownika. Trade z backtestu nigdy nie jest kandydatem (odfiltrowuje go wolajacy: `backtest_session_id IS NULL`).
 */

/** Okno dopasowania wejscia w sekundach (stala z ADR-034, testowana). */
export const OKNO_DOPASOWANIA_S = 120;

const EPS_ILOSC = 1e-6;

export type KandydatDziennika = {
  id: number;
  accountId: number;
  instrumentId: number;
  direction: "long" | "short";
  entryTime: Date;
  contracts: number;
};

export type TradeBrokeraDoDopasowania = {
  id: number;
  /** Konto DZIENNIKA przypisane do konta u brokera; `null` = konto jeszcze nieprzypisane. */
  accountId: number | null;
  instrumentId: number | null;
  direction: "long" | "short";
  entryTime: Date;
  maxQty: number;
};

export type StanDopasowania = "jeden_do_jednego" | "niejednoznaczne" | "brak";

export type Dopasowanie = {
  brokerTradeId: number;
  stan: StanDopasowania;
  /** Ustawione tylko przy 1:1. */
  tradeId: number | null;
  /** Wszyscy kandydaci w oknie (pusta lista przy braku). */
  kandydaci: number[];
  /** Powod po polsku, gdy nie 1:1. */
  powod: string | null;
};

export function wOknie(a: Date, b: Date, okno = OKNO_DOPASOWANIA_S): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= okno * 1000;
}

export function dopasuj(broker: TradeBrokeraDoDopasowania[], dziennik: KandydatDziennika[]): Dopasowanie[] {
  const kandydaciBrokera = new Map<number, KandydatDziennika[]>();
  const brokeryKandydata = new Map<number, number[]>();
  for (const b of broker) {
    const k =
      b.accountId === null || b.instrumentId === null
        ? []
        : dziennik.filter(
            (d) => d.accountId === b.accountId && d.instrumentId === b.instrumentId && d.direction === b.direction && wOknie(d.entryTime, b.entryTime),
          );
    kandydaciBrokera.set(b.id, k);
    for (const d of k) brokeryKandydata.set(d.id, [...(brokeryKandydata.get(d.id) ?? []), b.id]);
  }

  return broker.map((b): Dopasowanie => {
    const k = kandydaciBrokera.get(b.id) ?? [];
    const ids = k.map((d) => d.id);
    if (b.accountId === null) {
      return { brokerTradeId: b.id, stan: "brak", tradeId: null, kandydaci: [], powod: "konto u brokera nie jest przypisane do konta dziennika" };
    }
    if (b.instrumentId === null) {
      return { brokerTradeId: b.id, stan: "brak", tradeId: null, kandydaci: [], powod: "instrument tego kontraktu nie jest znany w dzienniku (dopasuj instrument i uzgodnij ponownie)" };
    }
    if (k.length === 0) {
      return { brokerTradeId: b.id, stan: "brak", tradeId: null, kandydaci: [], powod: "w dzienniku nie ma trade'a z tym samym kontem, instrumentem i kierunkiem w oknie ±120 s od wejścia" };
    }
    if (k.length > 1) {
      return { brokerTradeId: b.id, stan: "niejednoznaczne", tradeId: null, kandydaci: ids, powod: `${k.length} trade'ów dziennika pasuje w oknie ±120 s (wybierz właściwy)` };
    }
    const d = k[0];
    const brokerowDlaD = brokeryKandydata.get(d.id) ?? [];
    if (brokerowDlaD.length > 1) {
      return { brokerTradeId: b.id, stan: "niejednoznaczne", tradeId: null, kandydaci: ids, powod: `trade #${d.id} pasuje do ${brokerowDlaD.length} trade'ów brokera naraz (wybierz właściwy)` };
    }
    if (Math.abs(d.contracts - b.maxQty) > EPS_ILOSC) {
      return { brokerTradeId: b.id, stan: "niejednoznaczne", tradeId: null, kandydaci: ids, powod: `inna liczba kontraktów: broker ${b.maxQty}, dziennik ${d.contracts} (trade #${d.id})` };
    }
    return { brokerTradeId: b.id, stan: "jeden_do_jednego", tradeId: d.id, kandydaci: ids, powod: null };
  });
}

export type PrzesunieciePodejrzane = { godziny: number; dopasowan: number; bazowo: number };

/**
 * Wykrywa podejrzenie, ze czasy w pliku sa w innej strefie niz zalozona (ADR-034 pkt 2): przesuniecie o PELNE godziny,
 * ktore daje wyraznie wiecej dopasowan 1:1 niz brak przesuniecia. Tylko ostrzega; nigdy nie przesuwa sam.
 * Warunek: co najmniej dwa dopasowania po przesunieciu i co najmniej dwa razy tyle, co bez niego.
 */
export function wykryjPrzesunieciaStrefy(
  broker: TradeBrokeraDoDopasowania[],
  dziennik: KandydatDziennika[],
  zakresGodzin = 14,
): PrzesunieciePodejrzane | null {
  const ile1do1 = (przesuniecieGodzin: number): number =>
    dopasuj(
      broker.map((b) => ({ ...b, entryTime: new Date(b.entryTime.getTime() + przesuniecieGodzin * 3_600_000) })),
      dziennik,
    ).filter((d) => d.stan === "jeden_do_jednego").length;
  const bazowo = ile1do1(0);
  let najlepsze: PrzesunieciePodejrzane | null = null;
  for (let h = -zakresGodzin; h <= zakresGodzin; h += 1) {
    if (h === 0) continue;
    const ile = ile1do1(h);
    if (ile >= 2 && ile >= 2 * Math.max(bazowo, 1) && (najlepsze === null || ile > najlepsze.dopasowan)) {
      najlepsze = { godziny: h, dopasowan: ile, bazowo };
    }
  }
  return najlepsze;
}
