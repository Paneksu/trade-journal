import { DailyBars, EquityChart, MaeMfeScatter, GroupBars, RHistogram } from "@/components/charts/lazy";
import { UnitSwitch, SourceSwitch } from "@/components/layout/toolbar";
import { DimensionPicker } from "@/components/stats/dimension-picker";
import { DisciplinePanel } from "@/components/stats/discipline-panel";
import { EdgeFinderPanel } from "@/components/stats/edge-finder-panel";
import { GroupTable } from "@/components/stats/group-table";
import { KpiRow } from "@/components/stats/kpi-row";
import { SampleBar } from "@/components/stats/kpi";
import { FilterBar } from "@/components/trades/filter-bar";
import { DataPoint, EmptyState, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { localDate } from "@/lib/domain/calc";
import { scoreDiscipline } from "@/lib/domain/discipline";
import { findEdges } from "@/lib/domain/edge-finder";
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
  getStrategies,
  getTagCategories,
  getTags,
} from "@/lib/queries/dictionaries";
import { activeFilterCount, parseFilters } from "@/lib/queries/filters";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { duration, int, money, num, percent, rValue, tradesCount } from "@/lib/format";

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

  const [accounts, instruments, strategies, tags, tagCategories, fields, trades] =
    await Promise.all([
      getAccounts(),
      getInstruments(),
      getStrategies(),
      getTags(),
      getTagCategories(),
      getFields(),
      getTrades(filters),
    ]);

  const closed = closedOnly(trades);
  const stats = computeStats(closed);
  const account = accounts.find((k) => k.id === filters.accounts[0]) ?? accounts[0];
  const currency = account?.currency ?? settings.baseCurrency;

  const allDimensions = [
    ...builtinDimensions(),
    ...dimensionsForTags(tagCategories),
    ...dimensionsForFields(fields),
  ];
  const chosen = allDimensions.find((d) => d.key === dimensionKey) ?? dimension("instrument");
  const groups = groupBy(closed, chosen);

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

  const edges = findEdges(closed, allDimensions, { minSample: settings.minSample, maxResults: 5 });
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
        strategies={strategies}
        tags={tags}
        fields={fields}
        activeCount={activeFilterCount(filters)}
      />

      {closed.length === 0 ? (
        <Panel>
          <EmptyState
            title="Brak zamkniętych trade'ów w tym zakresie"
            description="Statystyki liczymy tylko z pozycji zamkniętych. Zmień filtry albo dopisz wyjścia do otwartych trade'ów."
          />
        </Panel>
      ) : (
        <>
          <KpiRow stats={stats} currency={currency} />

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
                  value: unit === "cash" ? g.stats.pnlNet : g.stats.sumR,
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

              <DataPoint label="Trade'y bez zmiany">{int(stats.flat)}</DataPoint>
              <DataPoint label="Suma kontraktów">{int(stats.totalContracts)}</DataPoint>
              <DataPoint label="Prowizje">{money(stats.commissions, { currency })}</DataPoint>
              <DataPoint label="Prowizje do wyniku brutto">
                {stats.pnlGross === 0 ? "—" : percent(stats.commissions / Math.abs(stats.pnlGross))}
              </DataPoint>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
