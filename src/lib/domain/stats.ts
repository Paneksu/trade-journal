/**
 * Statystyki zbioru zamknietych trade'ow.
 *
 * Modul czysty. Wszystkie kwoty wchodza i wychodza w centach.
 * Tam, gdzie miara nie ma sensu (brak strat, brak stopa), zwracamy `null`,
 * nigdy zera ani nieskonczonosci - zero klamie w interfejsie, a nieskonczonosc
 * psuje wykresy.
 *
 * `progi` nie ma wartosci domyslnej - kompilator ma wskazac kazde wywolanie,
 * zeby nikt nie policzyl statystyk z progiem "z powietrza". Klasyfikacja
 * kazdego trade'a jako zysk/strata/be idzie przez `wynikTrade` (ADR-011) -
 * to jedyne miejsce w module, ktore decyduje, czy trade jest wygrana.
 */

import {
  kierunekTrafiony,
  utraconeR,
  type PowodZlejEgzekucji,
} from "./kierunek";
import { wynikTrade, type Progi } from "./outcome";

export type TradeStat = {
  id: number;
  pnl: number;
  rMultiple: number | null;
  riskAmount: number | null;
  durationS: number | null;
  entryTime: Date;
  tradingDay: string;
  contracts: number;
  maeR: number | null;
  mfeR: number | null;
  /* Kierunek a egzekucja (ADR-018). Pola sa WYMAGANE, nie opcjonalne - dzieki
     temu kompilator wskazuje kazda fabryke testowa i nikt nie policzy trafnosci
     z danych, ktorych po prostu nie ma. `null` w `directionCorrect` znaczy
     "nieocenione", `false` - "kierunek chybiony". */
  directionCorrect: boolean | null;
  badExecutionReason: PowodZlejEgzekucji | null;
  potentialR: number | null;
  /* Wyjscia czesciowe (2026-08-30). Pola WYMAGANE, nie opcjonalne - z tego
     samego powodu co przy ADR-018: kompilator ma wskazac kazda fabryke
     testowa, ktora ich nie ma, zamiast po cichu liczyc agregaty skalowania
     z danych, ktorych po prostu nie ma. */
  /** Liczba wyjsc czastkowych. 1 = pojedyncze wyjscie, >1 = skalowanie. */
  exitCount: number;
  /** Wplyw skalowania na wynik w R. `null`, gdy `exitCount < 2` albo brak
      ryzyka zdefiniowanego stopem - patrz `computeTrade`. */
  scalingR: number | null;
};

export type Stats = {
  count: number;
  wins: number;
  losses: number;
  be: number;
  beRate: number;
  winRate: number;
  pnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  payoff: number | null;
  profitFactor: number | null;
  expectancyCash: number;
  expectancyR: number | null;
  sumR: number;
  countWithR: number;
  best: number | null;
  worst: number | null;
  maxDrawdown: number;
  maxDrawdownR: number;
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number;
  avgDurationS: number | null;
  stdevR: number | null;
  systemQuality: number | null;
  breakEvenWinRate: number | null;
  avgMaeR: number | null;
  avgMfeR: number | null;
  totalContracts: number;

  /* --- Kierunek a egzekucja (ADR-018) --------------------------------------
     Mianownikiem trafnosci sa WYLACZNIE trade'y ocenione. Nieoznaczona strata
     to "nie wiem", nie "kierunek chybiony" - wliczanie jej zanizaloby wynik za
     sam fakt, ze uzytkownik czegos nie przejrzal. */
  /** Ile trade'ow ma rozstrzygniety kierunek (wygrane wliczaja sie z definicji). */
  directionCount: number;
  directionHits: number;
  /** `directionHits / directionCount`; `null`, gdy nie ma czego liczyc. */
  directionAccuracy: number | null;
  /** Kierunek dobry, wynik zly - strata wylacznie z powodu egzekucji. */
  technicalCount: number;
  technicalPnl: number;
  technicalSumR: number;
  /** Suma R zostawionych na stole, z clampem na zero per trade. */
  lostR: number;
  /** Z ilu trade'ow policzono `lostR` - bez tego sama suma nic nie znaczy. */
  lostRCount: number;
  /**
   * Sufit systemu: oczekiwana wartosc przy idealnej egzekucji tych samych wejsc.
   * Mianownik to `countWithR`, ten sam co w `expectancyR` - inaczej sufit
   * potrafi wyjsc NIZEJ od oczekiwanej wartosci, co jest bez sensu i od razu
   * podwaza zaufanie do calego panelu.
   */
  potentialExpectancyR: number | null;
  /** Zamkniete trade'y bez oceny kierunku - kontekst dla trafnosci, nie ozdoba. */
  directionUnassessed: number;

  /* --- Wyjscia czesciowe (2026-08-30) --------------------------------------
     Skaluje sie glownie to, co jest na plusie - stad wymiar w `grouping.ts`
     ma `outcomeDerived: true` (patrz komentarz tam). Te trzy pola sa
     policzone z tego samego przejscia po liscie, co reszta agregatow. */
  /** Ile trade'ow ma wiecej niz jedno wyjscie. */
  skalowaneCount: number;
  /** Suma `scalingR` po trade'ach ze skalowaniem (pomija `null`). */
  skalowanieSumaR: number;
  /** Srednia `scalingR` po trade'ach ze skalowaniem. `null`, gdy zaden trade
      go nie ma - zero by klamalo, sugerujac neutralny wplyw skalowania. */
  skalowanieSredniaR: number | null;
};

export function emptyStats(): Stats {
  return {
    count: 0,
    wins: 0,
    losses: 0,
    be: 0,
    beRate: 0,
    winRate: 0,
    pnl: 0,
    avgWin: null,
    avgLoss: null,
    payoff: null,
    profitFactor: null,
    expectancyCash: 0,
    expectancyR: null,
    sumR: 0,
    countWithR: 0,
    best: null,
    worst: null,
    maxDrawdown: 0,
    maxDrawdownR: 0,
    maxWinStreak: 0,
    maxLossStreak: 0,
    currentStreak: 0,
    avgDurationS: null,
    stdevR: null,
    systemQuality: null,
    breakEvenWinRate: null,
    avgMaeR: null,
    avgMfeR: null,
    totalContracts: 0,
    directionCount: 0,
    directionHits: 0,
    directionAccuracy: null,
    technicalCount: 0,
    technicalPnl: 0,
    technicalSumR: 0,
    lostR: 0,
    lostRCount: 0,
    potentialExpectancyR: null,
    directionUnassessed: 0,
    skalowaneCount: 0,
    skalowanieSumaR: 0,
    skalowanieSredniaR: null,
  };
}

export function chronologically<T extends { entryTime: Date; id: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const diff = a.entryTime.getTime() - b.entryTime.getTime();
    return diff !== 0 ? diff : a.id - b.id;
  });
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, w) => s + w, 0) / values.length;
}

/** Odchylenie standardowe z proby (n-1). Ponizej dwoch pomiarow nie istnieje. */
function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((s, w) => s + w, 0) / values.length;
  const sum = values.reduce((s, w) => s + (w - m) ** 2, 0);
  return Math.sqrt(sum / (values.length - 1));
}

export function computeStats(list: TradeStat[], progi: Progi): Stats {
  if (list.length === 0) return emptyStats();

  const ordered = chronologically(list);
  const s = emptyStats();

  const profits: number[] = [];
  const losses: number[] = [];
  const rValues: number[] = [];
  const durations: number[] = [];
  const maeValues: number[] = [];
  const mfeValues: number[] = [];
  const scalingValues: number[] = [];

  let winStreak = 0;
  let lossStreak = 0;
  let equity = 0;
  let peak = 0;
  let equityR = 0;
  let peakR = 0;

  for (const t of ordered) {
    s.count += 1;
    s.pnl += t.pnl;
    s.totalContracts += t.contracts;

    const wynik = wynikTrade(t, progi);
    if (wynik === "zysk") {
      s.wins += 1;
      profits.push(t.pnl);
      winStreak += 1;
      lossStreak = 0;
    } else if (wynik === "strata") {
      s.losses += 1;
      losses.push(-t.pnl);
      lossStreak += 1;
      winStreak = 0;
    } else {
      // BE ani nie przerywa, ani nie przedluza serii (ADR-011): kto przesuwa
      // stopy na zero, nie powinien tym samym ruchem zaczynac nowej serii.
      s.be += 1;
    }
    s.maxWinStreak = Math.max(s.maxWinStreak, winStreak);
    s.maxLossStreak = Math.max(s.maxLossStreak, lossStreak);

    if (t.rMultiple !== null) {
      rValues.push(t.rMultiple);
      s.sumR += t.rMultiple;
      equityR += t.rMultiple;
      peakR = Math.max(peakR, equityR);
      s.maxDrawdownR = Math.max(s.maxDrawdownR, peakR - equityR);
    }

    if (t.durationS !== null) durations.push(t.durationS);
    if (t.maeR !== null) maeValues.push(t.maeR);
    if (t.mfeR !== null) mfeValues.push(t.mfeR);

    equity += t.pnl;
    peak = Math.max(peak, equity);
    s.maxDrawdown = Math.max(s.maxDrawdown, peak - equity);

    s.best = s.best === null ? t.pnl : Math.max(s.best, t.pnl);
    s.worst = s.worst === null ? t.pnl : Math.min(s.worst, t.pnl);

    // Kierunek a egzekucja (ADR-018) - w tym samym przejsciu, wiec kazda grupa
    // w `groupBy` i kazdy kontekst w Edge Finderze dostaje te liczby za darmo.
    const trafiony = kierunekTrafiony(t, progi);
    if (trafiony !== null) {
      s.directionCount += 1;
      if (trafiony) s.directionHits += 1;
    }
    if (trafiony === true && wynik !== "zysk") {
      s.technicalCount += 1;
      s.technicalPnl += t.pnl;
      s.technicalSumR += t.rMultiple ?? 0;
    }
    const stracone = utraconeR(t, progi);
    if (stracone !== null) {
      s.lostR += stracone;
      s.lostRCount += 1;
    }

    // Wyjscia czesciowe (2026-08-30) - w tym samym przejsciu, tak jak reszta.
    // `scalingR` z kontraktu `computeTrade` jest `null` juz przy mniej niz
    // dwoch wyjsciach, wiec `skalowaneCount` (samo `exitCount > 1`) bywa
    // WIEKSZE niz liczba trade'ow z policzonym `scalingR` (brak ryzyka -
    // stopa - tez daje `null`). Srednia liczymy tylko z tych drugich, tak
    // jak `avgMaeR`/`avgMfeR` ponizej - `mean()` na zebranej liscie, nie na
    // szerszym liczniku.
    if (t.exitCount > 1) s.skalowaneCount += 1;
    if (t.scalingR !== null) scalingValues.push(t.scalingR);
  }

  s.currentStreak = winStreak > 0 ? winStreak : -lossStreak;
  // BE poza mianownikiem (ADR-011): skutecznosc porownuje sie z progiem
  // oplacalnosci wyliczonym z payoffu, czyli z trade'ow rozstrzygnietych.
  // Inaczej im lepiej ktos przesuwa stopy na zero, tym gorzej wygladalby system.
  s.winRate = s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0;
  s.beRate = s.count > 0 ? s.be / s.count : 0;
  s.avgWin = mean(profits);
  s.avgLoss = mean(losses);
  s.payoff =
    s.avgWin !== null && s.avgLoss !== null && s.avgLoss > 0 ? s.avgWin / s.avgLoss : null;

  const sumProfits = profits.reduce((a, b) => a + b, 0);
  const sumLosses = losses.reduce((a, b) => a + b, 0);
  s.profitFactor = sumLosses > 0 ? sumProfits / sumLosses : null;

  s.expectancyCash = Math.round(s.pnl / s.count);
  s.countWithR = rValues.length;
  s.expectancyR = mean(rValues);
  s.stdevR = stdev(rValues);
  s.systemQuality =
    s.expectancyR !== null && s.stdevR !== null && s.stdevR > 0 ? s.expectancyR / s.stdevR : null;
  s.breakEvenWinRate = s.payoff !== null ? 1 / (1 + s.payoff) : null;

  s.directionAccuracy = s.directionCount > 0 ? s.directionHits / s.directionCount : null;
  s.directionUnassessed = s.count - s.directionCount;
  // Sufit liczymy tylko wtedy, gdy ktokolwiek wpisal potencjal - inaczej byloby
  // to `expectancyR` przebrane za nowa metryke. Mianownik MUSI byc ten sam co
  // w `expectancyR` (czyli `countWithR`, nie `count`): przy trade'ach bez R
  // sufit wyszedlby ponizej oczekiwanej wartosci, ktora rzekomo ogranicza.
  s.potentialExpectancyR =
    s.lostRCount > 0 && s.countWithR > 0 ? (s.sumR + s.lostR) / s.countWithR : null;

  const avgDuration = mean(durations);
  s.avgDurationS = avgDuration === null ? null : Math.round(avgDuration);
  s.avgMaeR = mean(maeValues);
  s.avgMfeR = mean(mfeValues);

  s.skalowanieSumaR = scalingValues.reduce((a, b) => a + b, 0);
  s.skalowanieSredniaR = mean(scalingValues);

  return s;
}

export type EquityPoint = {
  index: number;
  tradeId: number | null;
  time: Date | null;
  equity: number;
  equityR: number;
  peak: number;
  drawdown: number;
};

/**
 * Krzywa kapitalu z punktem zerowym na saldzie poczatkowym.
 * Zwraca n+1 punktow, zeby wykres zaczynal sie od stanu przed pierwszym tradem.
 */
export function equityCurve(list: TradeStat[], startingBalance = 0): EquityPoint[] {
  const ordered = chronologically(list);
  const points: EquityPoint[] = [
    {
      index: 0,
      tradeId: null,
      time: ordered[0]?.entryTime ?? null,
      equity: startingBalance,
      equityR: 0,
      peak: startingBalance,
      drawdown: 0,
    },
  ];

  let equity = startingBalance;
  let equityR = 0;
  let peak = startingBalance;

  ordered.forEach((t, i) => {
    equity += t.pnl;
    equityR += t.rMultiple ?? 0;
    peak = Math.max(peak, equity);
    points.push({
      index: i + 1,
      tradeId: t.id,
      time: t.entryTime,
      equity,
      equityR,
      peak,
      drawdown: peak - equity,
    });
  });

  return points;
}

/** Wynik dzienny - podstawa kalendarza i slupkow P&L. */
export function dailyPnl(list: TradeStat[]): { day: string; pnl: number; count: number; r: number }[] {
  const map = new Map<string, { day: string; pnl: number; count: number; r: number }>();
  for (const t of list) {
    const wpis = map.get(t.tradingDay) ?? { day: t.tradingDay, pnl: 0, count: 0, r: 0 };
    wpis.pnl += t.pnl;
    wpis.count += 1;
    wpis.r += t.rMultiple ?? 0;
    map.set(t.tradingDay, wpis);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Rozklad wynikow w R, w przedzialach po 0,5R. */
export function rHistogram(list: TradeStat[]): { bucket: number; label: string; count: number }[] {
  const map = new Map<number, number>();
  for (const t of list) {
    if (t.rMultiple === null) continue;
    const bucket = Math.floor(t.rMultiple * 2) / 2;
    map.set(bucket, (map.get(bucket) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, count]) => ({
      bucket,
      label: `${bucket >= 0 ? "+" : ""}${bucket.toFixed(1)}R`,
      count,
    }));
}
