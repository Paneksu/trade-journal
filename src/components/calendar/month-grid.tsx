import Link from "next/link";

import { cx } from "@/lib/classes";
import { moneyShort, rValue } from "@/lib/format";

/**
 * Miesiac jako mapa wynikow. Tydzien zaczyna sie w poniedzialek.
 * Nasycenie tla oddaje wielkosc wyniku wzgledem najlepszego i najgorszego dnia,
 * dzieki czemu jeden zly dzien nie ginie wsrod dziesieciu przecietnych.
 */

export type DayResult = { day: string; pnl: number; count: number; r: number };

/** Dzien swiadomie odpuszczony: bez wyniku, ale z zapisem. */
export type NoTradeDay = { day: string; reason: string | null };

const HEADERS = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"];

function daysInMonth(month: string): string[] {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from(
    { length: last },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}

/** Poniedzialek = 0, niedziela = 6. */
function weekdayIndex(day: string): number {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return (d + 6) % 7;
}

export function MonthGrid({
  month,
  days,
  noTradeDays = [],
  currency,
  unit = "cash",
  linkBase = "/calendar",
}: {
  month: string;
  days: DayResult[];
  noTradeDays?: NoTradeDay[];
  currency: string;
  unit?: "cash" | "r";
  linkBase?: string;
}) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const noTradeByDay = new Map(noTradeDays.map((d) => [d.day, d]));
  const all = daysInMonth(month);
  const offset = all.length > 0 ? weekdayIndex(all[0]) : 0;

  const values = days.map((d) => (unit === "cash" ? d.pnl : d.r));
  const maxWin = Math.max(1, ...values.filter((w) => w > 0));
  const maxLoss = Math.min(-1, ...values.filter((w) => w < 0));

  /* Gorna granica nasycenia to 0,20. Powyzej niej tekst na kaflu spada
     ponizej kontrastu 4,5:1 - sprawdzone axe, nie na oko. */
  const intensity = (value: number): number => {
    if (value === 0) return 0;
    const share = value > 0 ? value / maxWin : value / maxLoss;
    return Math.min(0.2, 0.07 + share * 0.13);
  };

  return (
    <div className="px-3 pb-3">
      <div className="grid grid-cols-7 gap-1">
        {HEADERS.map((h) => (
          <div key={h} className="etykieta py-1 text-center">
            {h}
          </div>
        ))}

        {Array.from({ length: offset }, (_, i) => (
          <div key={`pusty-${i}`} />
        ))}

        {all.map((day) => {
          const result = byDay.get(day);
          const pause = result ? undefined : noTradeByDay.get(day);
          const value = result ? (unit === "cash" ? result.pnl : result.r) : 0;
          const alpha = result ? intensity(value) : 0;
          // Skladowe zgodne z tokenami --color-profit i --color-loss.
          const rgb = value > 0 ? "70 192 139" : "229 101 79";

          const opis = pause
            ? pause.reason
              ? `Dzień bez transakcji: ${pause.reason.toLowerCase()}`
              : "Dzień bez transakcji"
            : undefined;

          return (
            <Link
              key={day}
              href={`${linkBase}?dzien=${day}`}
              title={opis}
              className={cx(
                "flex min-h-16 flex-col rounded-[var(--radius-control)] border p-1.5",
                "transition-colors duration-150",
                result || pause ? "border-line-strong" : "border-line hover:border-line-strong",
                // Dzien bez transakcji nie jest ani zyskiem, ani strata - zadnego tintu.
                pause && "bg-surface-2",
              )}
              style={
                result && value !== 0
                  ? { backgroundColor: `rgb(${rgb} / ${alpha})` }
                  : undefined
              }
            >
              <span
                className={cx(
                  "liczba text-[11px]",
                  result || pause ? "text-muted" : "text-faint",
                )}
              >
                {Number(day.slice(-2))}
              </span>
              {result && (
                <>
                  <span
                    className={cx(
                      "liczba mt-auto text-xs font-medium",
                      value > 0
                        ? "text-profit-bright"
                        : value < 0
                          ? "text-loss-bright"
                          : "text-muted",
                    )}
                  >
                    {unit === "cash" ? moneyShort(result.pnl, currency) : rValue(result.r)}
                  </span>
                  <span className="liczba text-[11px] text-muted">{result.count} tr.</span>
                </>
              )}
              {pause && (
                <>
                  {/* Na waskim ekranie kafel ma szerokosc dwoch slow - dluzszy
                      podpis lamalby siatke, wiec schodzi do skrotu. */}
                  <span className="mt-auto text-[11px] leading-tight font-medium whitespace-nowrap text-muted sm:hidden">
                    pauza
                  </span>
                  <span className="mt-auto hidden text-[11px] leading-tight font-medium text-muted sm:block">
                    bez transakcji
                  </span>
                  {pause.reason && (
                    <span className="hidden truncate text-[11px] leading-tight text-faint sm:block">
                      {pause.reason}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
