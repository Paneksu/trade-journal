import { Plus } from "lucide-react";

import { FilterBar } from "@/components/trades/filter-bar";
import { Ksiega, type WierszKsiegi } from "@/components/trades/ksiega";
import { SavedViews } from "@/components/trades/saved-views";
import { SourceSwitch, WidokSwitch } from "@/components/layout/toolbar";
import { NaglowekStrony, Pigulka, Strona } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { wilson } from "@/lib/domain/stats-ci";
import { computeStats } from "@/lib/domain/stats";
import { zrodloPrzelacznika } from "@/lib/domain/zrodla";
import { money, percent, pnlClass, rValue } from "@/lib/format";
import { getAccounts, getFields, getInstruments, getProgi, getSavedViews, getTags } from "@/lib/queries/dictionaries";
import { activeFilterCount, parseFilters } from "@/lib/queries/filters";
import { getRegulyOcen } from "@/lib/queries/oceny";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { procesISetupy } from "@/lib/queries/ui-v2";

export const metadata = { title: "Trade'y — Dziennik tradingowy" };

/*
 * Lista trade'ów (UI v2, wzór 2a/2b: lista Linear + księga i szuflada Mercury transactions).
 * Kolejność ze wzoru Mercury transactions: tytuł → rząd kontrolek (filtry, źródło, widok) → trzy liczby
 * podsumowania → księga. Liczby zawsze z n, skuteczność z przedziałem Wilsona 95% (MUST 5).
 */

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const settings = await requireSession();
  const params = await searchParams;
  const filters = parseFilters(params);

  const [accounts, instruments, tags, fields, views, trades, reguly] = await Promise.all([
    getAccounts(),
    getInstruments(),
    getTags(),
    getFields(),
    getSavedViews(),
    getTrades(filters),
    getRegulyOcen(),
  ]);

  const progi = await getProgi();
  const info = await procesISetupy(trades.map((t) => t.id));
  // Ślepa ocena: trade z ukrytym wynikiem nie wchodzi do sum na tym ekranie (i tak jest otwarty).
  const zamkniete = closedOnly(trades).filter((t) => !info.get(t.id)?.ukryty);
  const stats = computeStats(zamkniete, progi);
  const w = wilson(stats.wins, stats.count);
  const currency = accounts[0]?.currency ?? settings.baseCurrency;

  const wiersze: WierszKsiegi[] = trades.map((t) => {
    const i = info.get(t.id);
    return {
      id: t.id,
      dzien: t.tradingDay,
      wejscie: t.entryTime.toISOString(),
      strefa: t.exchangeTimezone,
      symbol: t.instrumentSymbol,
      kierunek: t.direction,
      kontrakty: t.contracts,
      status: t.status,
      pnl: t.pnl,
      r: t.rMultiple,
      waluta: t.currency,
      setup: i?.setup ?? null,
      proces: i?.proces ?? null,
      ukryty: i?.ukryty ?? false,
      zrzuty: t.screenshotCount,
      wynik: t.wynik,
    };
  });

  return (
    <Strona className="space-y-6">
      <NaglowekStrony
        tytul="Trade'y"
        akcje={
          <Pigulka href="/trades/new" glowna>
            <Plus size={15} aria-hidden /> Nowy trade
          </Pigulka>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <WidokSwitch active="lista" />
        <SourceSwitch active={zrodloPrzelacznika(filters.source)} />
      </div>

      <div className="panel overflow-hidden">
        <FilterBar
          accounts={accounts}
          instruments={instruments}
          tags={tags}
          fields={fields}
          reguly={reguly}
          activeCount={activeFilterCount(filters)}
          embedded
        />
        <SavedViews views={views.map((v) => ({ id: v.id, name: v.name, filters: v.filters }))} />
      </div>

      {/* Trzy liczby nad księgą (wzór: Net change / Money in / Money out). */}
      {filters.missed === "tylko" ? (
        <p className="text-meta text-faint">
          Pominięte trade&apos;y nie mają wyniku, więc nie wchodzą do podsumowania: filtr pokazuje tylko listę poniżej.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
          <div>
            <dt className="text-meta text-muted">Wynik netto</dt>
            <dd className={cx("num mt-0.5 text-sekcja", pnlClass(stats.pnl))}>{money(stats.pnl, { currency, sign: true })}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted">Suma R</dt>
            <dd className={cx("num mt-0.5 text-sekcja", pnlClass(stats.sumR))}>{rValue(stats.sumR)}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted">Skuteczność</dt>
            <dd className="num mt-0.5 text-sekcja text-text">
              {percent(w.p)}
              <span className="ml-1.5 text-meta text-faint">
                {w.low === null || w.high === null ? "" : `95%: ${Math.round(w.low * 100)}–${Math.round(w.high * 100)}`}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-meta text-muted">Zamknięte</dt>
            <dd className="num mt-0.5 text-sekcja text-text">
              n = {stats.count}
              {stats.count > 0 && stats.count < 30 && <span className="ml-1.5 text-meta text-faint">orientacyjnie</span>}
            </dd>
          </div>
        </dl>
      )}

      <Ksiega wiersze={wiersze} tags={tags} />
    </Strona>
  );
}
