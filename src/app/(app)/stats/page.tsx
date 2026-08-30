import { DailyBars, EquityChart, MaeMfeScatter, GroupBars, RHistogram } from "@/components/charts/lazy";
import { UnitSwitch, SourceSwitch } from "@/components/layout/toolbar";
import { DimensionPicker } from "@/components/stats/dimension-picker";
import { DisciplinePanel } from "@/components/stats/discipline-panel";
import { KierunekPanel } from "@/components/stats/kierunek-panel";
import { EdgeFinderPanel } from "@/components/stats/edge-finder-panel";
import { GroupTable } from "@/components/stats/group-table";
import { KpiRow } from "@/components/stats/kpi-row";
import { SampleBar } from "@/components/stats/kpi";
import { PominietePanel } from "@/components/stats/pominiete-panel";
import { FilterBar } from "@/components/trades/filter-bar";
import { DataPoint, EmptyState, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { localDate } from "@/lib/domain/calc";
import { scoreDiscipline } from "@/lib/domain/discipline";
import { findEdges } from "@/lib/domain/edge-finder";
import { czyPominiety } from "@/lib/domain/status";
import { statystykiPominietych } from "@/lib/domain/pominiete";
import {
  builtinDimensions,
  dimension,
  dimensionsForFields,
  dimensionsForTags,
  groupBy,
} from "@/lib/domain/grouping";
import { assessSample, expectancyInterval, requiredSample } from "@/lib/domain/sample-size";
import { computeStats, dailyPnl, equityCurve, rHistogram } from "@/lib/domain/stats";
import {
  getAccounts,
  getFields,
  getInstruments,
  getProgi,
  getTagCategories,
  getTags,
} from "@/lib/queries/dictionaries";
import { activeFilterCount, parseFilters } from "@/lib/queries/filters";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { duration, int, money, num, percent, pnlClass, rValue, tradesCount } from "@/lib/format";

export const metadata = { title: "Statystyki — Dziennik tradingowy" };

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const settings = await requireSession();
  const params = await searchParams;
  const filters = parseFilters(params);
  const unit = params.jednostka === "r" ? "r" : "cash";
  const dimensionKey = typeof params.wymiar === "string" ? params.wymiar : "instrument";

  const [accounts, instruments, tags, tagCategories, fields, trades] =
    await Promise.all([
      getAccounts(),
      getInstruments(),
        getTags(),
      getTagCategories(),
      getFields(),
      getTrades(filters),
    ]);

  const progi = await getProgi();
  const closed = closedOnly(trades);
  const stats = computeStats(closed, progi);
  const pominiete = trades.filter((t) => czyPominiety(t.status));
  const pominieteStats = statystykiPominietych(pominiete, progi);
  const account = accounts.find((k) => k.id === filters.accounts[0]) ?? accounts[0];
  const currency = account?.currency ?? settings.baseCurrency;

  const allDimensions = [
    ...builtinDimensions(),
    ...dimensionsForTags(tagCategories),
    ...dimensionsForFields(fields),
  ];
  const chosen = allDimensions.find((d) => d.key === dimensionKey) ?? dimension("instrument");
  const groups = groupBy(closed, chosen, { progi });

  const curve = equityCurve(closed, account?.startingBalance ?? 0).map((p) => ({
    index: p.index,
    equity: p.equity,
    equityR: p.equityR,
    drawdown: p.drawdown,
    day: p.time ? localDate(p.time, settings.timezone) : null,
  }));

  const excursions = closed
    .filter((t) => t.maeR !== null && t.mfeR !== null)
    .map((t) => ({ id: t.id, maeR: t.maeR as number, mfeR: t.mfeR as number, rMultiple: t.rMultiple }));

  const sample = assessSample(stats.count, 100, settings.minSample);
  const interval = expectancyInterval(stats.expectancyR, stats.stdevR, stats.countWithR);
  const needed = requiredSample(stats.stdevR, 0.2);

  const edges = findEdges(closed, allDimensions, {
    progi,
    minSample: settings.minSample,
    maxResults: 5,
  });
  const discipline = scoreDiscipline(closed);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etykieta">Analiza</p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">Statystyki</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceSwitch
            active={
              params.zrodlo === "backtest"
                ? "backtest"
                : params.zrodlo === "wszystko"
                  ? "wszystko"
                  : "live"
            }
          />
          <UnitSwitch active={unit} />
        </div>
      </header>

      <FilterBar
        accounts={accounts}
        instruments={instruments}
        tags={tags}
        fields={fields}
        activeCount={activeFilterCount(filters)}
      />

      {closed.length === 0 ? (
        <>
          <Panel>
            <EmptyState
              title="Brak zamkniętych trade'ów w tym zakresie"
              description="Statystyki liczymy tylko z pozycji zamkniętych. Zmień filtry albo dopisz wyjścia do otwartych trade'ów."
            />
          </Panel>
          {/* Sekcja pokazuje sie tez bez zamknietych trade'ow - pominiete nie
              wymagaja zadnego closedOnly, wiec maja co pokazac nawet wtedy
              (recenzja 2026-08-30, znalezisko 9). */}
          <PominietePanel stats={pominieteStats} />
        </>
      ) : (
        <>
          <KpiRow stats={stats} currency={currency} />

          {/* Pod KpiRow, nie nad nim - opis panelu mowi "nie wchodzi do
              zadnej liczby powyzej", a nad pasekiem filtrow nie bylo niczego,
              do czego to zdanie mogloby sie odnosic (recenzja 2026-08-30,
              znalezisko 9). */}
          <PominietePanel stats={pominieteStats} />

          <div className="panel">
            <SampleBar {...sample} />
            <div className="grid grid-cols-2 gap-4 border-t border-line p-4 sm:grid-cols-4">
              <DataPoint label="Przedział oczekiwanej wartości">
                {interval
                  ? `${rValue(interval.low, false)} … ${rValue(interval.high, false)}`
                  : "za mało danych"}
              </DataPoint>
              <DataPoint label="Odchylenie R">{num(stats.stdevR, 2)}</DataPoint>
              <DataPoint
                label="Jakość systemu"
                valueClassName={(stats.systemQuality ?? 0) > 0.2 ? "text-profit" : undefined}
              >
                {num(stats.systemQuality, 2)}
              </DataPoint>
              <DataPoint label="Do precyzji ±0,20R potrzeba">
                {needed === null ? "—" : tradesCount(needed)}
              </DataPoint>
            </div>
          </div>

          <Panel title="Krzywa kapitału">
            <div className="px-2 py-3">
              <EquityChart points={curve} unit={unit} currency={currency} height={300} />
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Rozkład wyników w R">
              <div className="px-2 py-3">
                <RHistogram data={rHistogram(closed)} />
              </div>
            </Panel>
            <Panel title="Wynik dzienny">
              <div className="px-2 py-3">
                <DailyBars data={dailyPnl(closed)} currency={currency} />
              </div>
            </Panel>
          </div>

          <Panel
            title="Rozbicie"
            description="Te same statystyki policzone osobno dla każdej wartości wybranego wymiaru."
          >
            <DimensionPicker
              options={allDimensions.map((d) => ({ key: d.key, label: d.label }))}
              active={chosen.key}
            />
            <div className="border-t border-line px-2 py-3">
              <GroupBars
                data={groups.map((g) => ({
                  label: g.label,
                  value: unit === "cash" ? g.stats.pnl : g.stats.sumR,
                  count: g.stats.count,
                }))}
                currency={currency}
                unit={unit}
              />
            </div>
            <div className="border-t border-line">
              <GroupTable groups={groups} currency={currency} minSample={settings.minSample} />
            </div>
          </Panel>

          <EdgeFinderPanel result={edges} currency={currency} minSample={settings.minSample} />

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title="MAE i MFE"
              description="Jak głęboko trade schodził pod wodę i jak daleko sięgał zysk. Czerwona linia to Twój stop."
            >
              {excursions.length === 0 ? (
                <p className="px-4 py-6 text-sm text-faint">
                  Żaden trade nie ma wpisanego MAE ani MFE. Wpisuj je w formularzu, jeśli chcesz
                  wiedzieć, czy stopy nie są za ciasne, a cele za bliskie.
                </p>
              ) : (
                <>
                  <div className="px-2 py-3">
                    <MaeMfeScatter data={excursions} />
                  </div>
                  <div className="grid grid-cols-2 gap-4 border-t border-line p-4">
                    <DataPoint label="Średnie MAE">{rValue(stats.avgMaeR, false)}</DataPoint>
                    <DataPoint label="Średnie MFE">{rValue(stats.avgMfeR, false)}</DataPoint>
                  </div>
                </>
              )}
            </Panel>

            <DisciplinePanel result={discipline} />

            <KierunekPanel stats={stats} trades={closed} currency={currency} />
          </div>

          <Panel title="Pozostałe liczby">
            <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
              <DataPoint label="Średnia wygrana">
                {money(stats.avgWin, { currency })}
              </DataPoint>
              <DataPoint label="Średnia strata">
                {money(stats.avgLoss === null ? null : -stats.avgLoss, { currency })}
              </DataPoint>
              <DataPoint label="Najlepszy trade">{money(stats.best, { currency, sign: true })}</DataPoint>
              <DataPoint label="Najgorszy trade">{money(stats.worst, { currency, sign: true })}</DataPoint>

              <DataPoint label="Najdłuższa seria wygranych">{int(stats.maxWinStreak)}</DataPoint>
              <DataPoint label="Najdłuższa seria strat">{int(stats.maxLossStreak)}</DataPoint>
              <DataPoint label="Aktualna seria">
                {stats.currentStreak === 0
                  ? "—"
                  : `${Math.abs(stats.currentStreak)} ${stats.currentStreak > 0 ? "wygranych" : "strat"}`}
              </DataPoint>
              <DataPoint label="Średni czas trzymania">{duration(stats.avgDurationS)}</DataPoint>

              <DataPoint label="Trade'y na zero (BE)">
                {`${int(stats.be)} (${percent(stats.beRate)})`}
              </DataPoint>
              <DataPoint label="Suma kontraktów">{int(stats.totalContracts)}</DataPoint>

              {/* Suma R bez licznika trade'ow jest bezwartosciowa (ten sam
                  wzorzec co "Utracone R" w kierunek-panel.tsx, ADR-018) - bez
                  niego nie widac, czy +3R to jeden szczesliwy trade, czy dziesiec
                  konsekwentnych. Gdy nikt nie skalowal, kafel ma powiedziec
                  wprost "nie dotyczy" - zero sugerowaloby neutralny wplyw,
                  ktorego tu po prostu nie ma co mierzyc. */}
              <DataPoint
                label="Wpływ częściowych realizacji"
                valueClassName={stats.skalowaneCount > 0 ? pnlClass(stats.skalowanieSumaR) : "text-faint"}
              >
                {stats.skalowaneCount === 0 ? (
                  "nie dotyczy"
                ) : (
                  <>
                    {rValue(stats.skalowanieSumaR)}
                    <span className="ml-1 text-xs text-faint">· {tradesCount(stats.skalowaneCount)}</span>
                  </>
                )}
              </DataPoint>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
