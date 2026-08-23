import Link from "next/link";

import { SessionForm } from "@/components/backtest/session-form";
import { EmptyState, Panel } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { requireSession } from "@/lib/auth/guard";
import { assessSample } from "@/lib/domain/sample-size";
import { computeStats } from "@/lib/domain/stats";
import {
  getAccounts,
  getBacktestSessions,
  getInstruments,
  getProgi,
  getStrategies,
} from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { money, num, percent, pnlClass, rValue, tradesCount } from "@/lib/format";

export const metadata = { title: "Backtesting — Dziennik tradingowy" };

const STATUS_LABELS: Record<string, string> = {
  running: "w toku",
  finished: "zakończona",
  abandoned: "porzucona",
};

export default async function BacktestPage() {
  const settings = await requireSession();

  const [sessions, strategies, instruments, accounts, allBacktestTrades] = await Promise.all([
    getBacktestSessions(),
    getStrategies(),
    getInstruments(),
    getAccounts(),
    getTrades({ ...EMPTY_FILTERS, source: "backtest" }),
  ]);

  const currency = accounts[0]?.currency ?? settings.baseCurrency;
  const closed = closedOnly(allBacktestTrades);
  const progi = await getProgi();

  return (
    <div className="space-y-4">
      <header>
        <p className="etykieta">Symulacje</p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">Backtesting</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Każda sesja ma własne założenia, własną próbkę i własne statystyki. Trade&apos;y z sesji
          nigdy nie mieszają się z dziennikiem realnym — chyba że sam włączysz widok
          &bdquo;razem&rdquo;.
        </p>
      </header>

      <Panel title="Nowa sesja">
        <SessionForm strategies={strategies} instruments={instruments} compact />
      </Panel>

      {sessions.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nie masz jeszcze żadnej sesji backtestu"
            description="Zacznij od zapisania założeń: strategia, instrument, interwał i zakres danych. Dopiero potem wbijaj trade'y."
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sessions.map((s) => {
            const sessionTrades = closed.filter((t) => t.backtestSessionId === s.id);
            const stats = computeStats(sessionTrades, progi);
            const sample = assessSample(stats.count, s.targetTrades, settings.minSample);

            return (
              <Link key={s.id} href={`/backtest/${s.id}`} className="block">
                <Panel
                  className="h-full transition-colors duration-150 hover:border-line-strong"
                  title={s.name}
                  description={[
                    strategies.find((x) => x.id === s.strategyId)?.name,
                    instruments.find((x) => x.id === s.instrumentId)?.symbol,
                    s.interval,
                    STATUS_LABELS[s.status],
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  <div className="grid grid-cols-4 gap-3 px-4 py-3">
                    <div>
                      <p className="etykieta">Wynik</p>
                      <p className={cx("liczba mt-0.5 text-sm font-medium", pnlClass(stats.pnl))}>
                        {money(stats.pnl, { currency, sign: true })}
                      </p>
                    </div>
                    <div>
                      <p className="etykieta">Śr. R</p>
                      <p className={cx("liczba mt-0.5 text-sm", pnlClass(stats.expectancyR))}>
                        {rValue(stats.expectancyR)}
                      </p>
                    </div>
                    <div>
                      <p className="etykieta">Skuteczność</p>
                      <p className="liczba mt-0.5 text-sm text-muted">{percent(stats.winRate)}</p>
                    </div>
                    <div>
                      <p className="etykieta">Profit factor</p>
                      <p className="liczba mt-0.5 text-sm text-muted">
                        {stats.profitFactor === null ? "—" : num(stats.profitFactor, 2)}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-line px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-xs text-faint">{sample.message}</p>
                      <p className="liczba shrink-0 text-xs text-faint">
                        {tradesCount(stats.count)}
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={cx(
                          "h-full rounded-full",
                          sample.status === "too_small"
                            ? "bg-loss"
                            : sample.status === "preliminary"
                              ? "bg-accent"
                              : "bg-profit",
                        )}
                        style={{ width: `${sample.percent}%` }}
                      />
                    </div>
                  </div>
                </Panel>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
