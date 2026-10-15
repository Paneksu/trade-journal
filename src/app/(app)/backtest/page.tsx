import Link from "next/link";

import { SessionForm } from "@/components/backtest/session-form";
import { Chip, Karta, NaglowekStrony, Strona } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { requireSession } from "@/lib/auth/guard";
import { RODZAJ_SESJI_NAZWY } from "@/lib/domain/zrodla";
import { assessSample } from "@/lib/domain/sample-size";
import { computeStats } from "@/lib/domain/stats";
import { getAccounts, getBacktestSessions, getInstruments, getProgi, getStrategies } from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { porownanieZrodel } from "@/lib/queries/statystyki-v2";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { money, num, percent, pnlClass, rValue } from "@/lib/format";

export const metadata = { title: "Backtest — Dziennik tradingowy" };

/*
 * Backtest (UI v2, etap 4). Forma ze wzoru 6 (Missive Analytics „Users”, Refero 30b695eb): tabela w ramie
 * z nagłówkami kolumn, liczba z deltą tuż obok („1 +1”), przełącznik „porównaj z” nad tabelą po prawej.
 * U nas: wiersze = źródła danych (backtest, forward, demo, live) z deltą względem wybranego źródła, a pod
 * spodem ta sama tabela dla sesji. Marka: Plex Mono, „orientacyjnie” przy n < 30, delta w kolorze wyniku.
 */

const STATUS: Record<string, string> = { running: "w toku", finished: "zakończona", abandoned: "porzucona" };
const ZRODLA = ["backtest", "forward", "demo", "live"] as const;
const NAZWY: Record<(typeof ZRODLA)[number], string> = { backtest: "Backtest", forward: "Forward", demo: "Demo", live: "Live" };

function Delta({ v, f, neutralna }: { v: number | null; f: (x: number) => string; neutralna?: boolean }) {
  if (v === null || Math.abs(v) < 1e-9) return <span className="block text-meta text-faint sm:ml-1.5 sm:inline">—</span>;
  return <span className={cx("num block text-meta sm:ml-1.5 sm:inline", neutralna ? "text-muted" : v > 0 ? "text-profit" : "text-loss")}>{f(v)}</span>;
}

export default async function BacktestPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const settings = await requireSession();
  const sp = await searchParams;
  const wzgledem = (ZRODLA as readonly string[]).includes(String(sp.porownaj)) ? (sp.porownaj as (typeof ZRODLA)[number]) : "live";

  const [sessions, strategies, instruments, accounts, allBacktestTrades, zrodla] = await Promise.all([
    getBacktestSessions(),
    getStrategies(),
    getInstruments(),
    getAccounts(),
    getTrades({ ...EMPTY_FILTERS, source: "sessions" }),
    porownanieZrodel(),
  ]);
  const currency = accounts[0]?.currency ?? settings.baseCurrency;
  const closed = closedOnly(allBacktestTrades);
  const progi = await getProgi();
  const ref = zrodla.bySource[wzgledem];

  return (
    <Strona className="space-y-8">
      <NaglowekStrony
        tytul="Backtest"
        podtytul="Każda sesja ma własne założenia i własną próbkę. Trade'y z sesji nie mieszają się z dziennikiem realnym, chyba że włączysz widok „razem”."
      />

      <Karta className="p-0 sm:p-0">
        <SessionForm strategies={strategies} instruments={instruments} compact />
      </Karta>

      <section aria-labelledby="zrodla-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="zrodla-h" className="text-sekcja text-text">
            Porównanie źródeł
          </h2>
          <nav aria-label="Porównaj z" className="flex flex-wrap items-center gap-1 text-karta">
            <span className="mr-1 text-meta text-muted">porównaj z</span>
            {ZRODLA.map((z) => (
              <Link
                key={z}
                href={z === "live" ? "/backtest" : `/backtest?porownaj=${z}`}
                aria-current={wzgledem === z ? "true" : undefined}
                className={cx(
                  "przejscie inline-flex h-8 items-center rounded-full px-3 focus-visible:outline-2 focus-visible:outline-offset-2",
                  wzgledem === z ? "bg-surface-3 text-text" : "text-muted hover:text-text",
                )}
              >
                {NAZWY[z]}
              </Link>
            ))}
          </nav>
        </div>
        <div className="karta">
          <table className="w-full text-karta" data-tabela-zrodel>
            <caption className="sr-only">Statystyki źródeł danych z deltą względem: {NAZWY[wzgledem]}</caption>
            <thead>
              <tr className="border-b border-line text-left text-meta text-muted">
                <th className="py-2.5 pr-3 pl-4 font-normal">Źródło</th>
                <th className="py-2.5 pr-3 font-normal">n</th>
                <th className="py-2.5 pr-3 font-normal">Win rate</th>
                <th className="py-2.5 pr-3 font-normal">Oczekiwane R</th>
                <th className="hidden py-2.5 pr-4 font-normal md:table-cell">Przedział 95% (R)</th>
              </tr>
            </thead>
            <tbody>
              {ZRODLA.map((z) => {
                const s = zrodla.bySource[z];
                const inny = z !== wzgledem && ref && s;
                return (
                  <tr key={z} className="border-b border-line last:border-b-0" data-zrodlo={z}>
                    <td className="py-3 pr-3 pl-4 text-text">
                      {NAZWY[z]}
                      {s?.expectancyR.orientacyjnie && <span className="block text-meta text-muted">orientacyjnie</span>}
                    </td>
                    <td className="num py-3 pr-3 text-text">
                      {s?.n ?? 0}
                      {inny && <Delta neutralna v={s.n - ref.n} f={(x) => `${x > 0 ? "+" : "−"}${Math.abs(x)}`} />}
                    </td>
                    <td className="num py-3 pr-3 text-text sm:whitespace-nowrap">
                      {s ? percent(s.winRate.p, 0) : "—"}
                      {inny && s.winRate.p !== null && ref.winRate.p !== null && (
                        <Delta v={s.winRate.p - ref.winRate.p} f={(x) => `${x > 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(0)} pp`} />
                      )}
                    </td>
                    <td className="num py-3 pr-3 text-text sm:whitespace-nowrap">
                      {s ? rValue(s.expectancyR.mean) : "—"}
                      {inny && s.expectancyR.mean !== null && ref.expectancyR.mean !== null && <Delta v={s.expectancyR.mean - ref.expectancyR.mean} f={(x) => rValue(x)} />}
                    </td>
                    <td className="num hidden py-3 pr-4 text-muted md:table-cell">
                      {s && s.expectancyR.low !== null && s.expectancyR.high !== null ? `${rValue(s.expectancyR.low)} … ${rValue(s.expectancyR.high)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-meta text-muted">
          {zrodla.backtestToLive
            ? `Między backtestem a live znika ${rValue(zrodla.backtestToLive.diffR, false)} na trade${zrodla.backtestToLive.orientacyjnie ? " (orientacyjnie)" : ""}.`
            : "„Ile R znika” policzymy, gdy będą trade'y z backtestu i z live."}{" "}
          Delta przy liczbie: różnica względem źródła „{NAZWY[wzgledem]}”.
        </p>
      </section>

      <section aria-labelledby="sesje-h">
        <h2 id="sesje-h" className="mb-3 text-sekcja text-text">
          Sesje <span className="num text-muted">{sessions.length}</span>
        </h2>
        {sessions.length === 0 ? (
          <p className="text-karta text-muted">Nie masz jeszcze żadnej sesji. Zacznij od założeń: strategia, instrument, interwał i zakres danych; trade&apos;y dopiero potem.</p>
        ) : (
          <ul className="karta divide-y divide-line">
            {sessions.map((s) => {
              const st = computeStats(
                closed.filter((t) => t.backtestSessionId === s.id),
                progi,
              );
              const proba = assessSample(st.count, s.targetTrades, settings.minSample);
              return (
                <li key={s.id}>
                  <Link
                    href={`/backtest/${s.id}`}
                    className="przejscie grid gap-x-5 gap-y-2 px-4 py-3.5 hover:bg-surface-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_5.5rem_5.5rem_5rem] sm:items-center"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-karta text-text">
                        {s.name}
                        <Chip title="Rodzaj sesji">{RODZAJ_SESJI_NAZWY[s.kind]}</Chip>
                      </span>
                      <span className="block text-meta text-muted">
                        {[strategies.find((x) => x.id === s.strategyId)?.name, instruments.find((x) => x.id === s.instrumentId)?.symbol, s.interval, STATUS[s.status]]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="num flex justify-between text-meta text-muted">
                        <span>
                          {st.count} z {s.targetTrades}
                        </span>
                        <span>{proba.percent}%</span>
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                        <span className={cx("block h-full rounded-full", proba.status === "too_small" ? "bg-muted" : "bg-viz-8")} style={{ width: `${proba.percent}%` }} />
                      </span>
                      <span className="sr-only">{proba.message}</span>
                    </span>
                    <span className={cx("num text-karta sm:text-right", pnlClass(st.sumR))}>
                      <span className="mr-2 text-meta text-muted sm:hidden">Suma R</span>
                      {rValue(st.sumR)}
                    </span>
                    <span className="num text-karta text-text sm:text-right">
                      <span className="mr-2 text-meta text-muted sm:hidden">Win rate</span>
                      {percent(st.winRate, 0)}
                    </span>
                    <span className="num text-meta text-muted sm:text-right">
                      PF {st.profitFactor === null ? "—" : num(st.profitFactor, 2)}
                      <span className={cx("block", pnlClass(st.pnl))}>{money(st.pnl, { currency, sign: true, decimals: 0 })}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Strona>
  );
}
