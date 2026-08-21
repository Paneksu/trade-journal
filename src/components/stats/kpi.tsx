import type { ReactNode } from "react";

import { cx } from "@/lib/classes";

/**
 * Kafelek KPI. Kolor niesie tylko informacje o zysku i stracie -
 * nigdy nie jest dekoracja.
 */
export function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "profit" | "loss" | "accent";
  hint?: string;
  className?: string;
}) {
  const toneClass =
    tone === "profit"
      ? "text-profit"
      : tone === "loss"
        ? "text-loss"
        : tone === "accent"
          ? "text-accent"
          : "text-text";

  return (
    <div className={cx("panel px-3.5 py-3", className)} title={hint}>
      <p className="etykieta">{label}</p>
      <p className={cx("liczba mt-1 text-xl font-semibold tracking-tight sm:text-2xl", toneClass)}>
        {value}
      </p>
      {sub && <p className="liczba mt-0.5 text-xs text-faint">{sub}</p>}
    </div>
  );
}

export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6", className)}>
      {children}
    </div>
  );
}

/** Pasek postepu probki - zawsze obok statystyk liczonych z malej liczby trade'ow. */
export function SampleBar({
  count,
  target,
  percent,
  status,
  message,
}: {
  count: number;
  target: number;
  percent: number;
  status: "too_small" | "preliminary" | "full";
  message: string;
}) {
  const color =
    status === "too_small" ? "bg-loss" : status === "preliminary" ? "bg-accent" : "bg-profit";

  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-text">{message}</p>
        <p className="liczba shrink-0 text-xs text-faint">
          {count}/{target}
        </p>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Postęp próbki"
      >
        <div className={cx("h-full rounded-full", color)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
