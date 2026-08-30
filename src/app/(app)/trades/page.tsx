import Link from "next/link";

import { FilterBar } from "@/components/trades/filter-bar";
import { SavedViews } from "@/components/trades/saved-views";
import { TradesTable } from "@/components/trades/trades-table";
import { KpiRow } from "@/components/stats/kpi-row";
import { SourceSwitch } from "@/components/layout/toolbar";
import { requireSession } from "@/lib/auth/guard";
import { computeStats } from "@/lib/domain/stats";
import {
  getAccounts,
  getFields,
  getInstruments,
  getProgi,
  getSavedViews,
  getTags,
} from "@/lib/queries/dictionaries";
import { activeFilterCount, parseFilters } from "@/lib/queries/filters";
import { closedOnly, getTrades } from "@/lib/queries/trades";

export const metadata = { title: "Trade'y — Dziennik tradingowy" };

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const settings = await requireSession();
  const params = await searchParams;
  const filters = parseFilters(params);

  const [accounts, instruments, tags, fields, views, trades] = await Promise.all([
    getAccounts(),
    getInstruments(),
    getTags(),
    getFields(),
    getSavedViews(),
    getTrades(filters),
  ]);

  const progi = await getProgi();
  const stats = computeStats(closedOnly(trades), progi);
  const currency = accounts[0]?.currency ?? settings.baseCurrency;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etykieta">Dziennik</p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">Trade&apos;y</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceSwitch active={params.zrodlo === "backtest" ? "backtest" : params.zrodlo === "wszystko" ? "wszystko" : "live"} />
          <Link
            href="/trades/new"
            className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-accent px-3.5 text-sm font-semibold text-bg transition-colors duration-150 hover:bg-accent-strong"
          >
            Nowy trade
          </Link>
        </div>
      </header>

      <div className="panel">
        <FilterBar
          accounts={accounts}
          instruments={instruments}
          tags={tags}
          fields={fields}
          activeCount={activeFilterCount(filters)}
          embedded
        />
        <SavedViews
          views={views.map((v) => ({ id: v.id, name: v.name, filters: v.filters }))}
        />
      </div>

      {filters.missed === "tylko" ? (
        // Rzad KPI liczy tylko trade'y zamkniete (closedOnly) - przy filtrze
        // "nie wziete: tylko te" dalby "0 trade'ow, skutecznosc 0,0%" tuz nad
        // tabela pokazujaca kilkanascie wierszy. Semantycznie poprawne, ale
        // czyta sie jak zepsuta strona (recenzja 2026-08-30, znalezisko 4) -
        // wiec zamiast siedmiu pustych kafli, jedno zdanie wprost.
        <p className="panel px-4 py-3 text-sm text-faint">
          Pominięte trade&apos;y nie mają wyniku, więc nie wchodzą do statystyk powyżej — filtr
          pokazuje tylko listę poniżej.
        </p>
      ) : (
        <KpiRow stats={stats} currency={currency} />
      )}

      <div className="panel">
        <TradesTable
          trades={trades}
          fields={fields}
          tags={tags}
          currency={currency}
        />
      </div>
    </div>
  );
}
