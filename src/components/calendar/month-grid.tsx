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
  missedDays = [],
  currency,
  unit = "cash",
  linkBase = "/calendar",
  linkDnia,
}: {
  month: string;
  days: DayResult[];
  noTradeDays?: NoTradeDay[];
  /** Dni-pauzy, na ktorych mimo wszystko lezy trade `missed` (setup byl, nie wzieto go). */
  missedDays?: string[];
  currency: string;
  unit?: "cash" | "r";
  linkBase?: string;
  /** Wlasny adres kafla. Kalendarz sesji backtestu prowadzi do STRONY dnia,
      a nie do parametru `?dzien=` na tej samej stronie (2026-08-29). */
  linkDnia?: (day: string) => string;
}) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const noTradeByDay = new Map(noTradeDays.map((d) => [d.day, d]));
  const missedSet = new Set(missedDays);
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
          const missed = pause ? missedSet.has(day) : false;
          const value = result ? (unit === "cash" ? result.pnl : result.r) : 0;
          const alpha = result ? intensity(value) : 0;
          // Skladowe zgodne z tokenami --color-profit i --color-loss.
          const rgb = value > 0 ? "70 192 139" : "229 101 79";

          const opis = pause
            ? [
                pause.reason ? `Dzień bez transakcji: ${pause.reason.toLowerCase()}` : "Dzień bez transakcji",
                missed && "1 trade nie wzięty",
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined;

          return (
            <Link
              key={day}
              href={linkDnia ? linkDnia(day) : `${linkBase}?dzien=${day}`}
              title={opis}
              className={cx(
                "relative flex min-h-16 flex-col rounded-[var(--radius-control)] border p-1.5",
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
                      // `whitespace-nowrap`: `moneyShort` skleja U+2212 z symbolem
                      // waluty ("−$460"), a przegladarka bez tego lamie wiersz na
                      // znaku minus - strata wygladala jak kwota bez znaku
                      // (recenzja 2026-08-30, znalezisko 11).
                      "liczba mt-auto whitespace-nowrap text-xs font-medium",
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
              {missed && (
                <>
                  {/* Sama kropka nie moze byc jedynym nosnikiem informacji (WCAG 1.4.1)
                      - ma odpowiednik w `title` kafla i w tekscie dla czytnika ekranu. */}
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent"
                  />
                  <span className="sr-only">1 trade nie wzięty</span>
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
