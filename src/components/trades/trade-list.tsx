import Link from "next/link";
import { Lock } from "lucide-react";

import { ukryteTrady } from "@/lib/api-v2/ukrycie-wyniku";
import { db } from "@/lib/db";

import { cx } from "@/lib/classes";
import { maWynik } from "@/lib/domain/status";
import { TRADE_STATUS_NAMES } from "@/lib/domain/types";
import type { TradeRecord } from "@/lib/queries/trades";
import { dateTime, money, pnlClass, rValue, wynikClass } from "@/lib/format";


/**
 * Zwiezla lista trade'ow do pulpitu i podgladu dnia.
 * Pelna tabela z filtrami i kolumnami zyje w `trades-table.tsx`.
 */
export async function TradeList({
  trades,
  emptyText = "Brak trade'ów w tym zakresie.",
}: {
  trades: TradeRecord[];
  emptyText?: string;
}) {
  // Ślepa ocena (blokery review 16.10.2026): dla otwartego trade'a z werdyktem AI ani R, ani kwota nie trafiają do HTML.
  const ukryte = await ukryteTrady(db, trades.map((t) => t.id));
  if (trades.length === 0) {
    return <p className="py-4 text-karta text-muted">{emptyText}</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {trades.map((t) => {
        /* Pozycja czesciowo zamknieta: "open" z co najmniej jednym wyjsciem ma
           juz zrealizowany kawalek wyniku. `maWynik` celowo tego nie pokazuje -
           status "open" nie ma policzalnego KONCOWEGO wyniku - wiec ten
           przypadek dostaje wlasna galaz, z etykieta mowiaca wprost, ze to nie
           jest wynik zamknietego trade'a (ta sama logika co karta trade'a). */
        const czesciowoZamkniete = t.status === "open" && t.exitCount > 0;
        const ukryty = ukryte.has(t.id);
        return (
        <li key={t.id}>
          {/* UI v2 (etap 4): wiersz w dwóch liniach jak księga (wzór 14c), żeby mieścił się w karcie panelu dnia
              przy każdej szerokości; ceny wejścia i wyjścia zostają na karcie trade'a. */}
          <Link
            href={`/trades/${t.id}`}
            className="przejscie flex min-h-12 items-center gap-3 px-1 py-2 hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="num text-karta text-text">{t.instrumentSymbol}</span>
                <span className="text-meta text-muted">{t.direction === "long" ? "long" : "short"}</span>
                {/* Tagi zostają na karcie trade'a i w księdze: kolorowy chip na tle karty nie trzymał kontrastu AA. */}
                {t.tags.length > 0 && <span className="text-meta text-muted">· {dedupTagi(t.tags).map((x) => x.name).join(", ")}</span>}
              </span>
              {/* Czas giełdy instrumentu, nie strefa użytkownika (ADR-022). */}
              <span className="num block text-meta text-muted">{dateTime(t.entryTime, t.exchangeTimezone)}</span>
            </span>

            {ukryty ? (
              <span className="flex shrink-0 items-center gap-1.5 text-meta text-muted">
                <Lock size={13} className="text-accent" aria-hidden />
                wynik po zamknięciu
              </span>
            ) : (
            <span className="shrink-0 text-right">
              <span className={cx("num block text-karta", pnlClass(t.rMultiple))}>{rValue(t.rMultiple)}</span>
              <span
                className={cx(
                  "num block text-meta",
                  maWynik(t.status) ? wynikClass(t.wynik) : czesciowoZamkniete ? pnlClass(t.pnl) : "text-muted",
                )}
              >
                {/* Prefiks "~" dla nie wziętego (konwencja galerii, recenzja 2026-08-30). */}
                {t.status === "missed" && "~"}
                {maWynik(t.status) || czesciowoZamkniete ? money(t.pnl, { currency: t.currency, sign: true }) : TRADE_STATUS_NAMES[t.status]}
                {maWynik(t.status) && t.wynik === "be" && <span className="ml-1 opacity-70">BE</span>}
                {czesciowoZamkniete && <span className="ml-1 text-accent">częściowo</span>}
              </span>
            </span>
            )}
          </Link>
        </li>
        );
      })}
    </ul>
  );
}

/** Po jednym chipie na tag, niezaleznie od liczby interwalow (ADR-017). */
function dedupTagi<T extends { id: number }>(tagi: T[]): T[] {
  const widziane = new Set<number>();
  return tagi.filter((t) => (widziane.has(t.id) ? false : (widziane.add(t.id), true)));
}
