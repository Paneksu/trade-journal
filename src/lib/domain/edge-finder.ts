/**
 * Edge Finder - szuka kontekstow, w ktorych wyniki odstaja od sredniej.
 *
 * Sprawdza kazdy wymiar osobno i kazda pare wymiarow. Zwraca tylko konteksty
 * o probce nie mniejszej niz `minSample`, bo przewaga policzona z pieciu
 * tradeow jest szumem, a nie znaleziskiem. Wielkosc probki jest zawsze czescia
 * wyniku, zeby nikt nie czytal samej liczby.
 */

import type { Dimension } from "./grouping";
import { computeStats, type Stats } from "./stats";
import type { TradeForAnalysis } from "./types";

export type Finding = {
  key: string;
  conditions: { dimension: string; value: string }[];
  count: number;
  share: number;
  expectancyR: number | null;
  expectancyCash: number;
  pnlNet: number;
  winRate: number;
  /** Roznica oczekiwanej wartosci wzgledem calej proby, w R. */
  deltaR: number | null;
  /** Roznica oczekiwanej wartosci wzgledem calej proby, w centach. */
  deltaCash: number;
  kind: "edge" | "leak";
};

export type EdgeFinderResult = {
  baseline: Stats;
  edges: Finding[];
  leaks: Finding[];
  contextsChecked: number;
  skippedTooSmall: number;
};

type Options = {
  minSample?: number;
  maxResults?: number;
  /** Czy szukac takze przeciec dwoch wymiarow naraz. */
  pairs?: boolean;
};

function bucketize(trades: TradeForAnalysis[], dim: Dimension): Map<string, TradeForAnalysis[]> {
  const buckets = new Map<string, TradeForAnalysis[]>();
  for (const t of trades) {
    for (const w of dim.values(t)) {
      const list = buckets.get(w);
      if (list) list.push(t);
      else buckets.set(w, [t]);
    }
  }
  return buckets;
}

export function findEdges(
  trades: TradeForAnalysis[],
  dimensions: Dimension[],
  options: Options = {},
): EdgeFinderResult {
  const minSample = options.minSample ?? 15;
  const maxResults = options.maxResults ?? 5;
  const baseline = computeStats(trades);
  const candidates: Finding[] = [];
  let checked = 0;
  let skipped = 0;

  const assess = (conditions: Finding["conditions"], list: TradeForAnalysis[]) => {
    checked += 1;
    if (list.length < minSample) {
      skipped += 1;
      return;
    }
    // Kontekst obejmujacy cala probe nie niesie zadnej informacji.
    if (list.length === trades.length) return;

    const s = computeStats(list);
    const deltaR =
      s.expectancyR !== null && baseline.expectancyR !== null
        ? s.expectancyR - baseline.expectancyR
        : null;
    const deltaCash = s.expectancyCash - baseline.expectancyCash;

    candidates.push({
      key: conditions.map((c) => `${c.dimension}=${c.value}`).join(" + "),
      conditions,
      count: s.count,
      share: trades.length > 0 ? s.count / trades.length : 0,
      expectancyR: s.expectancyR,
      expectancyCash: s.expectancyCash,
      pnlNet: s.pnlNet,
      winRate: s.winRate,
      deltaR,
      deltaCash,
      kind: (deltaR ?? deltaCash) >= 0 ? "edge" : "leak",
    });
  };

  const single = dimensions
    // Wymiar wyliczony z wyniku (przedzial R) nie moze byc kandydatem na przewage.
    .filter((d) => !d.outcomeDerived)
    .map((d) => ({ dim: d, buckets: bucketize(trades, d) }))
    // Wymiar o jednej wartosci nie rozroznia niczego - np. jedyne konto.
    .filter((d) => d.buckets.size > 1);

  for (const { dim, buckets } of single) {
    for (const [value, list] of buckets) {
      assess([{ dimension: dim.label, value }], list);
    }
  }

  if (options.pairs !== false) {
    for (let i = 0; i < single.length; i += 1) {
      for (let j = i + 1; j < single.length; j += 1) {
        const a = single[i];
        const b = single[j];
        for (const [valueA, listA] of a.buckets) {
          if (listA.length < minSample) continue;
          const ids = new Set(listA.map((t) => t.id));
          for (const [valueB, listB] of b.buckets) {
            if (listB.length < minSample) continue;
            const intersection = listB.filter((t) => ids.has(t.id));
            assess(
              [
                { dimension: a.dim.label, value: valueA },
                { dimension: b.dim.label, value: valueB },
              ],
              intersection,
            );
          }
        }
      }
    }
  }

  const measure = (z: Finding) => z.deltaR ?? z.deltaCash / 10_000;

  const edges = candidates
    .filter((z) => measure(z) > 0)
    .sort((a, b) => measure(b) - measure(a))
    .slice(0, maxResults);
  const leaks = candidates
    .filter((z) => measure(z) < 0)
    .sort((a, b) => measure(a) - measure(b))
    .slice(0, maxResults);

  return { baseline, edges, leaks, contextsChecked: checked, skippedTooSmall: skipped };
}
