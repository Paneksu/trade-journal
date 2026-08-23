import Link from "next/link";

import { DataPoint, Panel } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { POWOD_NAZWY, type PowodZlejEgzekucji } from "@/lib/domain/kierunek";
import type { Stats } from "@/lib/domain/stats";
import type { TradeForAnalysis } from "@/lib/domain/types";
import { int, money, percent, rValue, tradesCount } from "@/lib/format";

/**
 * Kierunek a egzekucja (ADR-018).
 *
 * Odpowiada na jedno pytanie: ile kosztuje mnie moja reka, przy zalozeniu ze
 * czytam rynek poprawnie. Skutecznosc tego nie pokazuje - trade wyprowadzony na
 * BE z zagrania, ktore poszlo potem trzy R w dobra strone, wyglada w niej
 * dokladnie tak samo jak wejscie pod prad.
 *
 * Rozbicie po powodach liczymy tutaj, a nie w `computeStats`: to jest widok
 * jednego panelu, nie miara, ktora ma jechac do kazdej grupy i do Edge Findera.
 */
export function KierunekPanel({
  stats,
  trades,
  currency,
}: {
  stats: Stats;
  trades: TradeForAnalysis[];
  currency: string;
}) {
  if (stats.directionCount === 0) {
    return (
      <Panel
        title="Kierunek a egzekucja"
        description="Ile kosztuje ręka, gdy głowa ma rację."
      >
        <p className="px-4 py-4 text-sm text-faint">
          Żaden zamknięty trade nie ma jeszcze oceny kierunku. Przy stracie albo BE zaznacz
          w formularzu „kierunek był dobry, zawiodła egzekucja&rdquo; — dopiero wtedy da się
          oddzielić błąd analizy od błędu wykonania.
        </p>
      </Panel>
    );
  }

  const rozbicie = rozbijPoPowodach(trades);
  const lepszaNizSkutecznosc =
    stats.directionAccuracy !== null && stats.directionAccuracy > stats.winRate;

  return (
    <Panel
      title="Kierunek a egzekucja"
      description="Ile kosztuje ręka, gdy głowa ma rację."
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
        <DataPoint label="Trafność kierunku">
          <span className={cx(lepszaNizSkutecznosc && "text-profit")}>
            {percent(stats.directionAccuracy)}
          </span>
          <span className="ml-1 text-xs text-faint">
            · przy skuteczności {percent(stats.winRate)}
          </span>
        </DataPoint>

        <DataPoint label="Straty techniczne">
          {int(stats.technicalCount)}
          <span className="ml-1 text-xs text-faint">
            {rValue(stats.technicalSumR)} · {money(stats.technicalPnl, { currency, sign: true })}
          </span>
        </DataPoint>

        <DataPoint label="Utracone R">
          <span className={cx(stats.lostR > 0 && "text-loss")}>{rValue(stats.lostR)}</span>
          <span className="ml-1 text-xs text-faint">
            {stats.lostRCount === 0
              ? "brak wpisanych potencjałów"
              : `· potencjał wpisany w ${tradesCount(stats.lostRCount)}`}
          </span>
        </DataPoint>

        <DataPoint label="Sufit systemu">
          {rValue(stats.potentialExpectancyR)}
          <span className="ml-1 text-xs text-faint">
            {stats.potentialExpectancyR === null
              ? "wpisz potencjał, żeby policzyć"
              : `· zamiast ${rValue(stats.expectancyR)} na trade`}
          </span>
        </DataPoint>
      </div>

      {stats.directionUnassessed > 0 && (
        <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
          {stats.directionUnassessed} zamkniętych trade&apos;ów nie ma jeszcze oceny kierunku.
          Wygrane liczą się jako trafione z definicji, więc dopóki nie przejrzysz strat,
          trafność jest zawyżona.
        </p>
      )}

      {rozbicie.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {rozbicie.map((w) => (
            <li key={w.powod} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-text">{POWOD_NAZWY[w.powod]}</p>
                <p className="liczba shrink-0 text-xs text-faint">
                  {w.count} · {rValue(w.sumR)}
                  {w.lostR > 0 && <span className="text-loss"> · −{rValue(w.lostR, false)}</span>}
                </p>
              </div>
              {w.tradeIds.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1">
                  {w.tradeIds.slice(0, 8).map((id) => (
                    /* Cel dotykowy co najmniej 24 x 24 px (WCAG 2.2, 2.5.8) -
                       przy jednocyfrowych numerach sam tekst jest za waski. */
                    <Link
                      key={id}
                      href={`/trades/${id}`}
                      className="liczba inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-line px-1 text-xs text-faint hover:border-faint hover:text-text"
                    >
                      {id}
                    </Link>
                  ))}
                  {w.tradeIds.length > 8 && (
                    <span className="self-center text-xs text-faint">
                      +{w.tradeIds.length - 8}
                    </span>
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

type Wiersz = {
  powod: PowodZlejEgzekucji;
  count: number;
  sumR: number;
  lostR: number;
  tradeIds: number[];
};

function rozbijPoPowodach(trades: TradeForAnalysis[]): Wiersz[] {
  const map = new Map<PowodZlejEgzekucji, Wiersz>();
  for (const t of trades) {
    if (t.badExecutionReason === null) continue;
    const w = map.get(t.badExecutionReason) ?? {
      powod: t.badExecutionReason,
      count: 0,
      sumR: 0,
      lostR: 0,
      tradeIds: [],
    };
    w.count += 1;
    w.sumR += t.rMultiple ?? 0;
    // Clamp na zero per trade, tak samo jak w `utraconeR` - trade lepszy od
    // zadeklarowanego potencjalu nie ma kompensowac cudzych bledow.
    if (t.potentialR !== null) w.lostR += Math.max(0, t.potentialR - (t.rMultiple ?? 0));
    w.tradeIds.push(t.id);
    map.set(t.badExecutionReason, w);
  }
  return [...map.values()].sort((a, b) => b.lostR - a.lostR || b.count - a.count);
}
