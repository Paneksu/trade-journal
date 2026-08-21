/**
 * Statystyki zbioru zamknietych trade'ow.
 *
 * Modul czysty. Wszystkie kwoty wchodza i wychodza w centach.
 * Tam, gdzie miara nie ma sensu (brak strat, brak stopa), zwracamy `null`,
 * nigdy zera ani nieskonczonosci - zero klamie w interfejsie, a nieskonczonosc
 * psuje wykresy.
 */

export type TradeStat = {
  id: number;
  pnlNet: number;
  pnlGross: number;
  commission: number;
  rMultiple: number | null;
  riskAmount: number | null;
  durationS: number | null;
  entryTime: Date;
  tradingDay: string;
  contracts: number;
  maeR: number | null;
  mfeR: number | null;
};

export type Stats = {
  count: number;
  wins: number;
  losses: number;
  flat: number;
  winRate: number;
  pnlNet: number;
  pnlGross: number;
  commissions: number;
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
};

export function emptyStats(): Stats {
  return {
    count: 0,
    wins: 0,
    losses: 0,
    flat: 0,
    winRate: 0,
    pnlNet: 0,
    pnlGross: 0,
    commissions: 0,
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

export function computeStats(list: TradeStat[]): Stats {
  if (list.length === 0) return emptyStats();

  const ordered = chronologically(list);
  const s = emptyStats();

  const profits: number[] = [];
  const losses: number[] = [];
  const rValues: number[] = [];
  const durations: number[] = [];
  const maeValues: number[] = [];
  const mfeValues: number[] = [];

  let winStreak = 0;
  let lossStreak = 0;
  let equity = 0;
  let peak = 0;
  let equityR = 0;
  let peakR = 0;

  for (const t of ordered) {
    s.count += 1;
    s.pnlNet += t.pnlNet;
    s.pnlGross += t.pnlGross;
    s.commissions += t.commission;
    s.totalContracts += t.contracts;

    if (t.pnlNet > 0) {
      s.wins += 1;
      profits.push(t.pnlNet);
      winStreak += 1;
      lossStreak = 0;
    } else if (t.pnlNet < 0) {
      s.losses += 1;
      losses.push(-t.pnlNet);
      lossStreak += 1;
      winStreak = 0;
    } else {
      s.flat += 1;
      winStreak = 0;
      lossStreak = 0;
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

    equity += t.pnlNet;
    peak = Math.max(peak, equity);
    s.maxDrawdown = Math.max(s.maxDrawdown, peak - equity);

    s.best = s.best === null ? t.pnlNet : Math.max(s.best, t.pnlNet);
    s.worst = s.worst === null ? t.pnlNet : Math.min(s.worst, t.pnlNet);
  }

  s.currentStreak = winStreak > 0 ? winStreak : -lossStreak;
  s.winRate = s.count > 0 ? s.wins / s.count : 0;
  s.avgWin = mean(profits);
  s.avgLoss = mean(losses);
  s.payoff =
    s.avgWin !== null && s.avgLoss !== null && s.avgLoss > 0 ? s.avgWin / s.avgLoss : null;

  const sumProfits = profits.reduce((a, b) => a + b, 0);
  const sumLosses = losses.reduce((a, b) => a + b, 0);
  s.profitFactor = sumLosses > 0 ? sumProfits / sumLosses : null;

  s.expectancyCash = Math.round(s.pnlNet / s.count);
  s.countWithR = rValues.length;
  s.expectancyR = mean(rValues);
  s.stdevR = stdev(rValues);
  s.systemQuality =
    s.expectancyR !== null && s.stdevR !== null && s.stdevR > 0 ? s.expectancyR / s.stdevR : null;
  s.breakEvenWinRate = s.payoff !== null ? 1 / (1 + s.payoff) : null;

  const avgDuration = mean(durations);
  s.avgDurationS = avgDuration === null ? null : Math.round(avgDuration);
  s.avgMaeR = mean(maeValues);
  s.avgMfeR = mean(mfeValues);

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
    equity += t.pnlNet;
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
    wpis.pnl += t.pnlNet;
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
