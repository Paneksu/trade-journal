import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { DayNoteForm } from "@/components/calendar/day-note-form";
import { MonthGrid } from "@/components/calendar/month-grid";
import { UnitSwitch } from "@/components/layout/toolbar";
import { Kpi, KpiGrid } from "@/components/stats/kpi";
import { TradeList } from "@/components/trades/trade-list";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { dayNotes } from "@/lib/db/schema";
import { localDate } from "@/lib/domain/calc";
import { computeStats, dailyPnl } from "@/lib/domain/stats";
import { getAccounts } from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { longDate, money, monthName, percent, rValue, tradesCount } from "@/lib/format";

export const metadata = { title: "Kalendarz — Dziennik tradingowy" };

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { from: string; to: string } {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ miesiac?: string; dzien?: string; jednostka?: string }>;
}) {
  const settings = await requireSession();
  const params = await searchParams;

  const today = localDate(new Date(), settings.timezone);
  const day = params.dzien ?? null;
  const month = params.miesiac ?? (day ? day.slice(0, 7) : today.slice(0, 7));
  const unit = params.jednostka === "r" ? "r" : "cash";

  const { from, to } = monthBounds(month);
  const [accounts, monthTrades] = await Promise.all([
    getAccounts(),
    getTrades({ ...EMPTY_FILTERS, from, to }),
  ]);

  const account = accounts[0];
  const currency = account?.currency ?? settings.baseCurrency;
  const closed = closedOnly(monthTrades);
  const stats = computeStats(closed);
  const days = dailyPnl(closed);

  const dayTrades = day ? monthTrades.filter((t) => t.tradingDay === day) : [];
  const dayStats = computeStats(closedOnly(dayTrades));

  const [note] = day
    ? await db
        .select()
        .from(dayNotes)
        .where(
          account
            ? and(eq(dayNotes.day, day), eq(dayNotes.accountId, account.id))
            : eq(dayNotes.day, day),
        )
        .limit(1)
    : [];

  const tradingDays = days.length;
  const winningDays = days.filter((d) => d.pnl > 0).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etykieta">Dziennik</p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {monthName(month)}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-line-strong">
            <Link
              href={`/calendar?miesiac=${shiftMonth(month, -1)}`}
              aria-label="Poprzedni miesiąc"
              className="flex h-8 w-8 items-center justify-center bg-surface text-muted hover:bg-surface-2 hover:text-text"
            >
              <ChevronLeft size={16} aria-hidden />
            </Link>
            <Link
              href="/calendar"
              className="flex h-8 items-center border-x border-line-strong bg-surface px-3 text-xs text-muted hover:bg-surface-2 hover:text-text"
            >
              dziś
            </Link>
            <Link
              href={`/calendar?miesiac=${shiftMonth(month, 1)}`}
              aria-label="Następny miesiąc"
              className="flex h-8 w-8 items-center justify-center bg-surface text-muted hover:bg-surface-2 hover:text-text"
            >
              <ChevronRight size={16} aria-hidden />
            </Link>
          </div>
          <UnitSwitch active={unit} />
        </div>
      </header>

      <KpiGrid className="xl:grid-cols-5">
        <Kpi
          label="Wynik miesiąca"
          value={money(stats.pnlNet, { currency, sign: true })}
          sub={tradesCount(stats.count)}
          tone={stats.pnlNet > 0 ? "profit" : stats.pnlNet < 0 ? "loss" : "neutral"}
        />
        <Kpi label="Suma R" value={rValue(stats.sumR)} sub={`śr. ${rValue(stats.expectancyR)}`} />
        <Kpi
          label="Dni handlowe"
          value={tradingDays}
          sub={`${winningDays} na plusie`}
        />
        <Kpi label="Skuteczność" value={percent(stats.winRate)} sub={`${stats.wins} W / ${stats.losses} L`} />
        <Kpi
          label="Maks. obsunięcie"
          value={money(-stats.maxDrawdown, { currency })}
          tone={stats.maxDrawdown > 0 ? "loss" : "neutral"}
        />
      </KpiGrid>

      <Panel title="Wynik dzień po dniu" description="Kliknij dzień, żeby zobaczyć trade'y i notatkę.">
        <MonthGrid month={month} days={days} currency={currency} unit={unit} />
      </Panel>

      {day && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title={longDate(day)}
            description={
              dayTrades.length === 0
                ? "Brak trade'ów tego dnia."
                : `${tradesCount(dayStats.count)} · ${money(dayStats.pnlNet, { currency, sign: true })} · ${rValue(dayStats.sumR)}`
            }
          >
            <TradeList
              trades={dayTrades}
              timezone={settings.timezone}
              emptyText="Tego dnia nie było żadnego trade'a."
            />
          </Panel>

          <Panel title="Notatka dnia">
            <DayNoteForm
              day={day}
              accountId={account?.id ?? null}
              values={{
                preSession: note?.preSession,
                postSession: note?.postSession,
                mood: note?.mood,
                energy: note?.energy,
                dayRating: note?.dayRating,
              }}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
