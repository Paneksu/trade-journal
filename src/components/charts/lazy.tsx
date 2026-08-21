"use client";

import dynamic from "next/dynamic";

import type { ComponentProps } from "react";
import type {
  DailyBars as DailyBarsType,
  EquityChart as EquityChartType,
  GroupBars as GroupBarsType,
  MaeMfeScatter as MaeMfeScatterType,
  RHistogram as RHistogramType,
} from "./charts";

/**
 * Wykresy laduja sie dopiero po pierwszym renderze.
 *
 * Biblioteka wykresow to najciezszy kawalek JavaScriptu w calej aplikacji,
 * a na pulpicie wszystkie wykresy sa ponizej pierwszego ekranu. Ladowane
 * leniwie schodza z drogi pierwszemu wyswietleniu; kazdy ma zastepcze pudelko
 * o tej samej wysokosci, wiec uklad nie skacze.
 */

function Placeholder({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface-2 text-xs text-faint"
      style={{ height }}
      aria-hidden
    >
      wczytuję wykres…
    </div>
  );
}

export const EquityChart = dynamic<ComponentProps<typeof EquityChartType>>(
  () => import("./charts").then((m) => m.EquityChart),
  { ssr: false, loading: () => <Placeholder height={340} /> },
);

export const RHistogram = dynamic<ComponentProps<typeof RHistogramType>>(
  () => import("./charts").then((m) => m.RHistogram),
  { ssr: false, loading: () => <Placeholder height={220} /> },
);

export const DailyBars = dynamic<ComponentProps<typeof DailyBarsType>>(
  () => import("./charts").then((m) => m.DailyBars),
  { ssr: false, loading: () => <Placeholder height={200} /> },
);

export const MaeMfeScatter = dynamic<ComponentProps<typeof MaeMfeScatterType>>(
  () => import("./charts").then((m) => m.MaeMfeScatter),
  { ssr: false, loading: () => <Placeholder height={260} /> },
);

export const GroupBars = dynamic<ComponentProps<typeof GroupBarsType>>(
  () => import("./charts").then((m) => m.GroupBars),
  { ssr: false, loading: () => <Placeholder height={200} /> },
);
