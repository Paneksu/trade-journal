import Link from "next/link";

import { Badge } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { maWynik } from "@/lib/domain/status";
import { TRADE_STATUS_NAMES } from "@/lib/domain/types";
import type { TradeRecord } from "@/lib/queries/trades";
import { dateTime, money, pnlClass, price, rValue, wynikClass } from "@/lib/format";

/**
 * Zwiezla lista trade'ow do pulpitu i podgladu dnia.
 * Pelna tabela z filtrami i kolumnami zyje w `trades-table.tsx`.
 */
export function TradeList({
  trades,
  emptyText = "Brak trade'ów w tym zakresie.",
}: {
  trades: TradeRecord[];
  emptyText?: string;
}) {
  if (trades.length === 0) {
    return <p className="px-4 py-6 text-sm text-faint">{emptyText}</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {trades.map((t) => (
        <li key={t.id}>
          <Link
            href={`/trades/${t.id}`}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2"
          >
            <span
              className={cx(
                "w-9 shrink-0 text-[11px] font-semibold uppercase sm:w-10 sm:text-xs",
                t.direction === "long" ? "text-profit" : "text-loss",
              )}
            >
              {t.direction === "long" ? "long" : "short"}
            </span>

            <span className="w-12 shrink-0 font-mono text-sm text-text sm:w-14">
              {t.instrumentSymbol}
            </span>

            <span className="hidden min-w-0 flex-1 gap-1.5 sm:flex">
              {/* Skrot bez interwalow, wiec tag powtorzony na kilku warstwach
                  (ADR-017) pokazalby sie tu trzy razy pod rzad. Na liscie liczy
                  sie JAKI tag, nie ile razy - stad deduplikacja po `id`. */}
              {dedupTagi(t.tags)
                .slice(0, 3)
                .map((tag) => (
                  <Badge key={tag.assignmentId} color={tag.color} title={tag.category}>
                    {tag.name}
                  </Badge>
                ))}
              {dedupTagi(t.tags).length > 3 && (
                <span className="self-center text-xs text-faint">
                  +{dedupTagi(t.tags).length - 3}
                </span>
              )}
            </span>

            <span className="liczba ml-auto hidden text-xs text-faint md:block">
              {price(t.entryPrice, t.tickSize)} → {price(t.exitPrice, t.tickSize)}
            </span>

            <span className="liczba hidden w-24 shrink-0 text-right text-xs text-faint sm:block">
              {/* Czas gieldy instrumentu, nie strefa uzytkownika (ADR-022):
                  w tej samej strefie sie go wpisuje, wiec w tej samej ma
                  wracac - inaczej wpis 09:35 wracalby jako 15:35. */}
              {dateTime(t.entryTime, t.exchangeTimezone)}
            </span>

            <span
              className={cx(
                "liczba ml-auto w-14 shrink-0 text-right text-sm sm:ml-0 sm:w-16",
                pnlClass(t.rMultiple),
              )}
            >
              {rValue(t.rMultiple)}
            </span>

            <span
              className={cx(
                "liczba w-24 shrink-0 text-right text-sm font-medium sm:w-28",
                wynikClass(t.wynik),
              )}
            >
              {/* Prefiks "~" zamiast osobnego znacznika "hipot." (ta sama
                  konwencja co w galerii, ADR recenzji 2026-08-30) - jedna
                  litera nie rozsadza sztywnej szerokosci kolumny tak jak
                  robilo to dopisane slowo. */}
              {t.status === "missed" && "~"}
              {maWynik(t.status)
                ? money(t.pnl, { currency: t.currency, sign: true })
                : TRADE_STATUS_NAMES[t.status]}
              {maWynik(t.status) && t.wynik === "be" && (
                <span className="ml-1 text-xs opacity-70">BE</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Po jednym chipie na tag, niezaleznie od liczby interwalow (ADR-017). */
function dedupTagi<T extends { id: number }>(tagi: T[]): T[] {
  const widziane = new Set<number>();
  return tagi.filter((t) => (widziane.has(t.id) ? false : (widziane.add(t.id), true)));
}
