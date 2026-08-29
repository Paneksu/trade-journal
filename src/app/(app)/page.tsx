import Link from "next/link";

import { EquityChart, RHistogram } from "@/components/charts/lazy";
import { MonthGrid } from "@/components/calendar/month-grid";
import { DisciplinePanel } from "@/components/stats/discipline-panel";
import { EdgeFinderPanel } from "@/components/stats/edge-finder-panel";
import { KpiRow } from "@/components/stats/kpi-row";
import { TradeList } from "@/components/trades/trade-list";
import { EmptyState, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { localDate } from "@/lib/domain/calc";
import { monthBounds, reasonName } from "@/lib/domain/day-log";
import { scoreDiscipline } from "@/lib/domain/discipline";
import { findEdges } from "@/lib/domain/edge-finder";
import { dimension, dimensionsForFields, dimensionsForTags } from "@/lib/domain/grouping";
import { computeStats, dailyPnl, equityCurve, rHistogram } from "@/lib/domain/stats";
import { getAccounts, getFields, getProgi, getTagCategories } from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { getDayNotes } from "@/lib/queries/journal";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { monthName } from "@/lib/format";
import { DateRangeSwitch, UnitSwitch } from "@/components/layout/toolbar";

export const metadata = { title: "Pulpit — Dziennik tradingowy" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const settings = await requireSession();
  const params = await searchParams;

  const range = typeof params.zakres === "string" ? params.zakres : "90";
  const unit = params.jednostka === "r" ? "r" : "cash";

  const now = new Date();
  const today = localDate(now, settings.timezone);
  const from =
    range === "wszystko"
      ? null
      : localDate(new Date(now.getTime() - Number(range) * 86_400_000), settings.timezone);

  const [accounts, fields, tagCategories] = await Promise.all([
    getAccounts(),
    getFields(),
    getTagCategories(),
  ]);

  const trades = await getTrades({ ...EMPTY_FILTERS, from });
  const progi = await getProgi();
  const closed = closedOnly(trades);
  const stats = computeStats(closed, progi);

  const account = accounts.find((k) => !k.archived) ?? accounts[0];
  const currency = account?.currency ?? settings.baseCurrency;
  const startingBalance = account?.startingBalance ?? 0;

  const curve = equityCurve(closed, startingBalance).map((p) => ({
    index: p.index,
    equity: p.equity,
    equityR: p.equityR,
    drawdown: p.drawdown,
    day: p.time ? localDate(p.time, settings.timezone) : null,
  }));

  const days = dailyPnl(closed);
  const month = today.slice(0, 7);

  // Ta sama siatka co w kalendarzu, wiec i te same dni bez transakcji.
  const traded = new Set(days.map((d) => d.day));
  const bounds = monthBounds(month);
  const noTradeDays = (await getDayNotes(bounds.from, bounds.to, account?.id))
    .filter((n) => n.noTrade && !traded.has(n.day))
    .map((n) => ({ day: n.day, reason: reasonName(n.noTradeReason) }));

  const dimensions = [
    dimension("instrument"),
    dimension("session"),
    dimension("weekday"),
    dimension("direction"),
    dimension("duration"),
    ...dimensionsForTags(tagCategories),
    ...dimensionsForFields(fields),
  ];
  const edges = findEdges(closed, dimensions, {
    progi,
    minSample: settings.minSample,
    maxResults: 5,
  });
  const discipline = scoreDiscipline(closed);

  if (trades.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <Panel title="Dziennik jest pusty">
          <EmptyState
            title="Nie ma jeszcze żadnego trade'a"
            description="Wpisz pierwszy trade, a pulpit zacznie liczyć statystyki. Katalog kontraktów futures i podstawowe tagi są już gotowe — nic nie musisz konfigurować."
            action={
              <Link
                href="/trades/new"
                className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-bg"
              >
                Dodaj pierwszy trade
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etykieta">Pulpit</p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {range === "wszystko" ? "Cała historia" : `Ostatnie ${range} dni`}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeSwitch active={range} />
          <UnitSwitch active={unit} />
        </div>
      </header>

      <KpiRow stats={stats} currency={currency} />

      <Panel
        title="Krzywa kapitału"
        description={`Start ${account?.name ?? "konta"} · ${closed.length} zamkniętych trade'ów`}
      >
        <div className="px-2 py-3">
          <EquityChart points={curve} unit={unit} currency={currency} />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={monthName(month)} description="Wynik dzień po dniu">
          <MonthGrid
            month={month}
            days={days}
            noTradeDays={noTradeDays}
            currency={currency}
            unit={unit}
          />
        </Panel>

        <Panel title="Rozkład wyników" description="Ile trade'ów kończy się jakim R">
          <div className="px-2 py-3">
            <RHistogram data={rHistogram(closed)} />
          </div>
        </Panel>
      </div>

      <EdgeFinderPanel result={edges} currency={currency} minSample={settings.minSample} />

      <div className="grid gap-4 xl:grid-cols-2">
        <DisciplinePanel result={discipline} />

        <Panel
          title="Ostatnie trade'y"
          actions={
            <Link href="/trades" className="text-xs text-accent hover:underline">
              wszystkie →
            </Link>
          }
        >
          <TradeList trades={trades.slice(0, 8)} />
        </Panel>
      </div>
    </div>
  );
}
