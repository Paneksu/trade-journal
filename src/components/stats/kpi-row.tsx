import { Kpi, KpiGrid } from "./kpi";
import type { Stats } from "@/lib/domain/stats";
import { expectancyInterval } from "@/lib/domain/sample-size";
import { int, money, percent, rValue, num, tradesCount } from "@/lib/format";

/**
 * Szesc liczb, ktore mowia o systemie najwiecej, plus siodma - trafnosc
 * kierunku - pokazywana dopiero wtedy, gdy jest z czego ja policzyc.
 * Kazda ma podpis z kontekstem, bo goła liczba bez odniesienia nie znaczy nic.
 */
export function KpiRow({ stats, currency }: { stats: Stats; currency: string }) {
  const interval = expectancyInterval(stats.expectancyR, stats.stdevR, stats.countWithR);

  return (
    <KpiGrid>
      <Kpi
        label="Wynik"
        value={money(stats.pnl, { currency, sign: true })}
        sub={tradesCount(stats.count)}
        tone={stats.pnl > 0 ? "profit" : stats.pnl < 0 ? "loss" : "neutral"}
      />
      <Kpi
        label="Oczekiwana wartość"
        value={rValue(stats.expectancyR)}
        sub={
          interval
            ? `przedział ${rValue(interval.low, false)} … ${rValue(interval.high, false)}`
            : `${money(stats.expectancyCash, { currency, sign: true })} na trade`
        }
        tone={(stats.expectancyR ?? 0) > 0 ? "profit" : (stats.expectancyR ?? 0) < 0 ? "loss" : "neutral"}
        hint="Ile średnio zarabia jeden trade, liczone w wielokrotności ryzyka."
      />
      <Kpi
        label="Profit factor"
        value={stats.profitFactor === null ? "—" : num(stats.profitFactor, 2)}
        sub={
          stats.profitFactor === null
            ? "brak stratnych trade'ów"
            : "suma zysków ÷ suma strat"
        }
        tone={(stats.profitFactor ?? 0) >= 1 ? "profit" : "loss"}
      />
      <Kpi
        label="Skuteczność"
        value={percent(stats.winRate)}
        sub={
          stats.breakEvenWinRate === null
            ? `${stats.wins} W / ${stats.losses} L / ${stats.be} BE`
            : `próg opłacalności ${percent(stats.breakEvenWinRate)}`
        }
        tone={
          stats.breakEvenWinRate !== null && stats.winRate > stats.breakEvenWinRate
            ? "profit"
            : "neutral"
        }
      />
      <Kpi
        label="Suma R"
        value={rValue(stats.sumR)}
        sub={`payoff ${stats.payoff === null ? "—" : num(stats.payoff, 2)} · ${int(stats.countWithR)} ze stopem`}
        tone={stats.sumR > 0 ? "profit" : stats.sumR < 0 ? "loss" : "neutral"}
      />
      <Kpi
        label="Maks. obsunięcie"
        value={money(-stats.maxDrawdown, { currency })}
        sub={`w R: ${rValue(-stats.maxDrawdownR, false)} · seria strat ${stats.maxLossStreak}`}
        tone={stats.maxDrawdown > 0 ? "loss" : "neutral"}
      />
      {/* Warunkowo: uzytkownik, ktory nie ocenia kierunku, nie ma ogladac
          samotnego kafla z kreska (ADR-018). */}
      {stats.directionCount > 0 && (
        <Kpi
          label="Trafność kierunku"
          value={percent(stats.directionAccuracy)}
          /* Podpis MUSI wymieniac nieocenione. Wygrane wpadaja do mianownika
             z definicji, wiec dopoki uzytkownik nie przejrzy strat, trafnosc
             pokazuje rowne sto procent - liczba prawdziwa i myląca naraz.
             Dopiero "N strat bez oceny" tlumaczy, skad ona sie bierze. */
          sub={
            stats.directionUnassessed > 0
              ? `${int(stats.directionUnassessed)} bez oceny — wynik niepełny`
              : `${int(stats.directionCount)} ocenionych · ${tradesCount(stats.technicalCount)} ze złą egzekucją`
          }
          tone={
            stats.directionAccuracy !== null && stats.directionAccuracy > stats.winRate
              ? "profit"
              : "neutral"
          }
          hint="Jak często miałeś rację co do kierunku — niezależnie od tego, czy egzekucja to udźwignęła."
        />
      )}
    </KpiGrid>
  );
}
