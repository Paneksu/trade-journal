import { Ksiega, type WierszKsiegi } from "@/components/trades/ksiega";
import { NaglowekListy } from "@/components/trades/naglowek-listy";
import { LiczbaBohater, Strona } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { wilson } from "@/lib/domain/stats-ci";
import { computeStats } from "@/lib/domain/stats";
import { zrodloPrzelacznika } from "@/lib/domain/zrodla";
import { money, percent, rValue } from "@/lib/format";
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
      <NaglowekListy
        widok="lista"
        zrodlo={zrodloPrzelacznika(filters.source)}
        accounts={accounts}
        instruments={instruments}
        tags={tags}
        fields={fields}
        reguly={reguly}
        aktywneFiltry={activeFilterCount(filters)}
        widoki={views.map((v) => ({ id: v.id, name: v.name, filters: v.filters }))}
      />

      {/* Liczba bohater nad księgą (wzór: saldo z paskiem, Mercury accounts/credit). R przed USD
          (kierunek.md: R zamiast $); każda liczba z n i przedziałem (MUST 5). */}
      {filters.missed === "tylko" ? (
        <p className="text-meta text-faint">
          Pominięte trade&apos;y nie mają wyniku, więc nie wchodzą do podsumowania: filtr pokazuje tylko listę poniżej.
        </p>
      ) : (
        <section aria-labelledby="suma-r" className="max-w-[460px] space-y-2.5">
          <p id="suma-r" className="text-karta text-text">
            Suma R <span className="text-meta text-muted">· n = {stats.count}</span>
          </p>
          <LiczbaBohater tekst={stats.count === 0 ? "0.00R" : rValue(stats.sumR)} />
          {stats.count > 0 && (
            <div
              role="img"
              aria-label={`Zyski ${stats.wins}, break-even ${stats.be}, straty ${stats.losses}`}
              className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
            >
              <span className="h-full bg-profit" style={{ width: `${(stats.wins / stats.count) * 100}%` }} />
              <span className="h-full bg-flat" style={{ width: `${(stats.be / stats.count) * 100}%` }} />
              <span className="h-full bg-loss" style={{ width: `${(stats.losses / stats.count) * 100}%` }} />
            </div>
          )}
          <p className="num text-meta text-muted">
            <span className="text-text">{percent(w.p)}</span> skuteczności
            <span className="hidden sm:inline">
              {w.low !== null && w.high !== null && <> (95%: {Math.round(w.low * 100)}–{Math.round(w.high * 100)})</>}
              {stats.count > 0 && stats.count < 30 && " · orientacyjnie"} · {money(stats.pnl, { currency, sign: true })}
            </span>
          </p>
        </section>
      )}

      <Ksiega wiersze={wiersze} tags={tags} />
    </Strona>
  );
}
