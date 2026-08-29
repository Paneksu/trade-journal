import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { MonthGrid } from "@/components/calendar/month-grid";
import { EquityChart, RHistogram } from "@/components/charts/lazy";
import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import { DeleteDayNoteButton, NoTradeDayForm } from "@/components/backtest/no-trade-days";
import { SessionForm } from "@/components/backtest/session-form";
import { DeleteSessionButton } from "@/components/backtest/session-actions";
import { KpiRow } from "@/components/stats/kpi-row";
import { SampleBar } from "@/components/stats/kpi";
import { TradeList } from "@/components/trades/trade-list";
import { DataPoint, Panel } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { backtestSessions } from "@/lib/db/schema";
import { localDate } from "@/lib/domain/calc";
import { journalCoverage, reasonName } from "@/lib/domain/day-log";
import { assessSample } from "@/lib/domain/sample-size";
import { computeStats, dailyPnl, equityCurve, rHistogram } from "@/lib/domain/stats";
import { getAccounts, getInstruments, getProgi, getStrategies } from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import {
  getDayScreenshots,
  getSessionDayNotes,
  screenshotCountsForDayNotes,
} from "@/lib/queries/journal";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { longDate, money, monthName, num, percent, plural, pnlClass, rValue } from "@/lib/format";

export const metadata = { title: "Sesja backtestu — Dziennik tradingowy" };

export default async function BacktestSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dzien?: string }>;
}) {
  const settings = await requireSession();
  const { id } = await params;
  const { dzien } = await searchParams;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) notFound();

  const [session] = await db
    .select()
    .from(backtestSessions)
    .where(eq(backtestSessions.id, sessionId))
    .limit(1);
  if (!session) notFound();

  const [strategies, instruments, accounts, sessionTrades] = await Promise.all([
    getStrategies(),
    getInstruments(),
    getAccounts(),
    getTrades({ ...EMPTY_FILTERS, source: "backtest", backtestSession: sessionId }),
  ]);

  const currency = accounts[0]?.currency ?? settings.baseCurrency;
  const progi = await getProgi();
  const closed = closedOnly(sessionTrades);
  const stats = computeStats(closed, progi);
  const sample = assessSample(stats.count, session.targetTrades, settings.minSample);

  // Porownanie z realem: te same statystyki dla tej samej strategii w dzienniku.
  const liveTrades = session.strategyId
    ? closedOnly(await getTrades({ ...EMPTY_FILTERS, strategies: [session.strategyId] }))
    : [];
  const liveStats = computeStats(liveTrades, progi);

  const curve = equityCurve(closed, session.startingBalance).map((p) => ({
    index: p.index,
    equity: p.equity,
    equityR: p.equityR,
    drawdown: p.drawdown,
    day: p.time ? localDate(p.time, settings.timezone) : null,
  }));

  const strategy = strategies.find((s) => s.id === session.strategyId);
  const instrument = instruments.find((i) => i.id === session.instrumentId);

  // Dni bez sygnalu: druga polowa prawdy o sesji. Same wejscia mowia, ile razy
  // strategia zagrala, a nie ile dni trzeba bylo przy niej przesiedziec.
  const dayNotes = await getSessionDayNotes(session.id);
  const shotCounts = await screenshotCountsForDayNotes(dayNotes.map((n) => n.id));
  const selectedNote = dzien ? dayNotes.find((n) => n.day === dzien) : undefined;
  const selectedShots = await getDayScreenshots(selectedNote?.id);

  /* Siatki miesiecy: te, w ktorych cokolwiek sie wydarzylo - trade albo dzien
     zapisany jako bez sygnalu. Sesja bez zadnego wpisu pokazuje pierwszy
     miesiac zakresu danych, a gdy i jego brak - biezacy. */
  const days = dailyPnl(closed);
  const zTradow = days.map((d) => d.day.slice(0, 7));
  const zNotatek = dayNotes.map((n) => n.day.slice(0, 7));
  const zdarzenia = [...new Set([...zTradow, ...zNotatek])].sort();
  const miesiace =
    zdarzenia.length > 0
      ? zdarzenia
      : [(session.dataFrom ?? localDate(new Date(), settings.timezone)).slice(0, 7)];

  /* Dzien bez transakcji rysujemy tylko tam, gdzie faktycznie nie bylo trade'a -
     notatka moze wisiec takze na dniu, w ktorym cos jednak zagralo, a wtedy
     wynik jest wazniejszy od adnotacji (tak samo jak na pulpicie). */
  const zTradem = new Set(days.map((d) => d.day));
  const pauzy = dayNotes
    .filter((n) => n.noTrade && !zTradem.has(n.day))
    .map((n) => ({ day: n.day, reason: reasonName(n.noTradeReason) }));

  const tradedDays = new Set(closed.map((t) => t.tradingDay).filter((d): d is string => Boolean(d)));
  const coverage =
    session.dataFrom && session.dataTo
      ? journalCoverage({
          from: session.dataFrom,
          to: session.dataTo,
          tradedDays,
          noTradeDays: dayNotes.map((n) => n.day),
        })
      : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="etykieta">
            <Link href="/backtest" className="hover:text-text">
              Backtesting
            </Link>{" "}
            / sesja
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {session.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {[strategy?.name, instrument?.symbol, session.interval, session.dataFrom && `${session.dataFrom} → ${session.dataTo ?? "…"}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/trades/new?sesja=${session.id}`}
            className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-accent px-3.5 text-sm font-semibold text-bg transition-colors duration-150 hover:bg-accent-strong"
          >
            Dodaj trade do sesji
          </Link>
          <DeleteSessionButton id={session.id} />
        </div>
      </header>

      <div className="panel">
        <SampleBar {...sample} />
      </div>

      <KpiRow stats={stats} currency={currency} />

      {closed.length > 0 && (
        <Panel title="Krzywa kapitału sesji">
          <div className="px-2 py-3">
            <EquityChart points={curve} unit="cash" currency={currency} />
          </div>
        </Panel>
      )}

      {/* Kalendarz sesji (2026-08-29) - ten sam komponent i te same propsy co na
          pulpicie. Sesja backtestu rozklada sie zwykle na kilka miesiecy, wiec
          siatek jest tyle, ile miesiecy ma co pokazac; przy pustej sesji jeden
          miesiac z poczatku zakresu danych, zeby panel nie byl pusta ramka.
          `linkBase` prowadzi kafle do `?dzien=…`, czyli do wyboru dnia, ktory ta
          strona juz obsluguje. */}
      {miesiace.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {miesiace.map((m) => (
            <Panel key={m} title={monthName(m)} description="Wynik dzień po dniu">
              <MonthGrid
                month={m}
                days={days}
                noTradeDays={pauzy}
                currency={currency}
                linkBase={`/backtest/${session.id}`}
              />
            </Panel>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Backtest kontra dziennik"
          description={
            session.strategyId
              ? `Ta sama strategia (${strategy?.name}) w realnym handlu`
              : "Przypisz sesji strategię, żeby porównać ją z realnym handlem."
          }
        >
          {session.strategyId ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="etykieta px-4 py-2 text-left">Miara</th>
                    <th className="etykieta px-4 py-2 text-right">Backtest</th>
                    <th className="etykieta px-4 py-2 text-right">Realnie</th>
                    <th className="etykieta px-4 py-2 text-right">Różnica</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Trade'y",
                      a: stats.count,
                      b: liveStats.count,
                      format: (w: number | null) => (w === null ? "—" : String(w)),
                      diff: false,
                    },
                    {
                      label: "Oczekiwana wartość",
                      a: stats.expectancyR,
                      b: liveStats.expectancyR,
                      format: (w: number | null) => rValue(w),
                      diff: true,
                    },
                    {
                      label: "Skuteczność",
                      a: stats.winRate,
                      b: liveStats.winRate,
                      format: (w: number | null) => percent(w),
                      diff: false,
                    },
                    {
                      label: "Profit factor",
                      a: stats.profitFactor,
                      b: liveStats.profitFactor,
                      format: (w: number | null) => (w === null ? "—" : num(w, 2)),
                      diff: false,
                    },
                    {
                      label: "Średni czas",
                      a: stats.avgDurationS === null ? null : stats.avgDurationS / 60,
                      b: liveStats.avgDurationS === null ? null : liveStats.avgDurationS / 60,
                      format: (w: number | null) => (w === null ? "—" : `${Math.round(w)} min`),
                      diff: false,
                    },
                  ].map((row) => {
                    const difference =
                      row.diff && row.a !== null && row.b !== null ? row.b - row.a : null;
                    return (
                      <tr key={row.label} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 text-muted">{row.label}</td>
                        <td className="liczba px-4 py-2 text-right text-text">
                          {row.format(row.a as number | null)}
                        </td>
                        <td className="liczba px-4 py-2 text-right text-text">
                          {liveStats.count === 0 ? "—" : row.format(row.b as number | null)}
                        </td>
                        <td className={cx("liczba px-4 py-2 text-right", pnlClass(difference))}>
                          {difference === null ? "—" : rValue(difference)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {liveStats.count > 0 && stats.expectancyR !== null && liveStats.expectancyR !== null && (
                <p className="px-4 py-3 text-xs text-faint">
                  {liveStats.expectancyR < stats.expectancyR - 0.2
                    ? "Realny handel wypada wyraźnie gorzej niż symulacja. Zwykle winne są poślizgi, gorsze wejścia albo trade'y spoza planu."
                    : "Realny handel trzyma się blisko symulacji."}
                </p>
              )}
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-faint">
              Bez przypisanej strategii nie ma czego z czym porównać.
            </p>
          )}
        </Panel>

        <Panel title="Rozkład wyników">
          <div className="px-2 py-3">
            <RHistogram data={rHistogram(closed)} />
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-line p-4">
            <DataPoint label="Saldo startowe">
              {money(session.startingBalance, { currency })}
            </DataPoint>
            <DataPoint label="Ryzyko na trade">
              {money(session.riskPerTrade, { currency })}
            </DataPoint>
          </div>
        </Panel>
      </div>

      <Panel title="Trade'y sesji" description={`${sessionTrades.length} wpisów`}>
        <TradeList
          trades={sessionTrades}
          timezone={settings.timezone}
          emptyText="Sesja nie ma jeszcze żadnego trade'a."
        />
      </Panel>

      <Panel
        title="Dni bez sygnału"
        description={
          coverage
            ? `${dayNotes.length} ${plural(dayNotes.length, "dzień", "dni", "dni")} · pokrycie zakresu danych ${percent(coverage.ratio, 0)} (${coverage.covered}/${coverage.expected} dni roboczych)`
            : "Uzupełnij zakres danych sesji, żeby policzyć pokrycie."
        }
      >
        {/* Dzien klikniety w kalendarzu, ktory nie ma jeszcze wpisu, wchodzi do
            formularza od razu - inaczej kliknieciu w kafel nic by nie
            odpowiadalo. `key`, bo `defaultValue` klienta nie odswieza sie samo
            po zmianie parametru adresu. */}
        {dzien && !selectedNote && !zTradem.has(dzien) && (
          <p className="border-b border-line px-4 pt-3 text-xs text-faint">
            {longDate(dzien)} nie ma jeszcze wpisu — uzupełnij go poniżej.
          </p>
        )}
        <NoTradeDayForm
          key={dzien ?? "nowy"}
          sessionId={session.id}
          dataFrom={session.dataFrom}
          dataTo={session.dataTo}
          domyslnyDzien={selectedNote ? null : dzien}
        />

        {dayNotes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-faint">
            Żaden dzień bez sygnału nie jest jeszcze zapisany. Bez nich wynik sesji mówi,
            ile strategia zarobiła, ale nie ile czekania kosztowała.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {dayNotes.map((n) => {
              const wybrany = n.id === selectedNote?.id;
              const powod = reasonName(n.noTradeReason);
              const ile = shotCounts.get(n.id) ?? 0;

              return (
                <li key={n.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={wybrany ? `/backtest/${session.id}` : `/backtest/${session.id}?dzien=${n.day}`}
                        className="liczba text-sm font-medium text-text hover:text-accent"
                      >
                        {longDate(n.day)}
                      </Link>
                      <p className="mt-0.5 text-xs text-faint">
                        {[powod, ile > 0 ? `${ile} ${plural(ile, "zrzut", "zrzuty", "zrzutów")}` : null]
                          .filter(Boolean)
                          .join(" · ") || "bez powodu"}
                      </p>
                    </div>
                    {wybrany && <DeleteDayNoteButton id={n.id} />}
                  </div>

                  {n.postSession && (
                    <p className="mt-2 text-sm whitespace-pre-line text-muted">{n.postSession}</p>
                  )}

                  {wybrany && (
                    <div className="mt-2 rounded-[var(--radius-control)] border border-line">
                      <ScreenshotUploader
                        key={n.day}
                        cel={{
                          typ: "dzien",
                          day: n.day,
                          accountId: null,
                          backtestSessionId: session.id,
                        }}
                        shots={selectedShots}
                        opis={`dzień ${n.day}`}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Założenia i wnioski">
        <SessionForm
          strategies={strategies}
          instruments={instruments}
          values={{
            id: session.id,
            name: session.name,
            strategyId: session.strategyId,
            instrumentId: session.instrumentId,
            interval: session.interval,
            dataFrom: session.dataFrom,
            dataTo: session.dataTo,
            startingBalance: session.startingBalance,
            riskPerTrade: session.riskPerTrade,
            targetTrades: session.targetTrades,
            status: session.status,
            assumptions: session.assumptions,
            conclusions: session.conclusions,
          }}
        />
      </Panel>
    </div>
  );
}
