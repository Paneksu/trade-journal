import Link from "next/link";

import { Panel } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import type { DisciplineResult } from "@/lib/domain/discipline";
import { percent } from "@/lib/format";

/**
 * Miernik dyscypliny. Nie ocenia wynikow, tylko zachowanie - dlatego stoi
 * osobno od statystyk pienieznych.
 */
export function DisciplinePanel({ result }: { result: DisciplineResult }) {
  const tone =
    result.score >= 90 ? "text-profit" : result.score >= 70 ? "text-accent" : "text-loss";
  const bar =
    result.score >= 90 ? "bg-profit" : result.score >= 70 ? "bg-accent" : "bg-loss";

  return (
    <Panel
      title="Dyscyplina"
      description="Zachowanie przy stole, nie wynik finansowy."
      actions={<span className={cx("liczba text-2xl font-semibold", tone)}>{result.score}</span>}
    >
      <div className="px-4 pt-3">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={result.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Wskaźnik dyscypliny"
        >
          <div className={cx("h-full rounded-full", bar)} style={{ width: `${result.score}%` }} />
        </div>
      </div>

      {result.signals.length === 0 ? (
        <p className="px-4 py-4 text-sm text-faint">
          Żadnych odstępstw. Każdy trade miał stop, zasady były odhaczone, wielkość pozycji
          nie rosła po stracie.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {result.signals.map((s) => (
            <li key={s.code} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-text">{s.title}</p>
                <p className="liczba shrink-0 text-xs text-faint">
                  {s.count} · {percent(s.share, 0)}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-faint">{s.description}</p>
              {s.tradeIds.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1">
                  {s.tradeIds.slice(0, 8).map((id) => (
                    /* Cel dotykowy ma miec co najmniej 24 x 24 px (WCAG 2.2, 2.5.8).
                       Przy jednocyfrowych numerach sam tekst jest za waski. */
                    <Link
                      key={id}
                      href={`/trades/${id}`}
                      className="liczba inline-flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-control)] px-1 text-xs text-accent hover:bg-accent-dim hover:underline"
                    >
                      #{id}
                    </Link>
                  ))}
                  {s.tradeIds.length > 8 && (
                    <span className="text-xs text-faint">i {s.tradeIds.length - 8} więcej</span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
