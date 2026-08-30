import Link from "next/link";

import { DayNoteForm } from "@/components/calendar/day-note-form";
import { MonthNav } from "@/components/calendar/month-nav";
import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import { MonthGrid } from "@/components/calendar/month-grid";
import { UnitSwitch } from "@/components/layout/toolbar";
import { Kpi, KpiGrid } from "@/components/stats/kpi";
import { TradeList } from "@/components/trades/trade-list";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { localDate } from "@/lib/domain/calc";
import { journalCoverage, monthBounds, noTradeBreakdown, reasonName } from "@/lib/domain/day-log";
import { computeStats, dailyPnl } from "@/lib/domain/stats";
import { czyPominiety, type StatusTrade } from "@/lib/domain/status";
import { getAccounts, getProgi } from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { getDayNotes, getDayScreenshots } from "@/lib/queries/journal";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { longDate, money, monthName, percent, plural, rValue, tradesCount } from "@/lib/format";

export const metadata = { title: "Kalendarz — Dziennik tradingowy" };

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
  const notes = await getDayNotes(from, to, account?.id);
  const currency = account?.currency ?? settings.baseCurrency;
  const progi = await getProgi();
  const closed = closedOnly(monthTrades);
  const stats = computeStats(closed, progi);
  const days = dailyPnl(closed);

  const dayTrades = day ? monthTrades.filter((t) => t.tradingDay === day) : [];
  const dayStats = computeStats(closedOnly(dayTrades), progi);
  /* Nie wzieta pozycja nie jest dowodem, ze dzien byl handlowy - serwer
     (countTradesOnDay) jej nie liczy przy blokadzie checkboxa "bez transakcji",
     wiec klient nie moze go liczyc tez. Bez tego wyszarzalby checkbox, ktorego
     serwer by nie zablokowal - rozjazd bez komunikatu bledu. `dayTrades` (z
     pominietymi) zostaje bez zmian dla TradeList - lista dnia ma je pokazywac. */
  const dayRealne = dayTrades.filter((t) => !czyPominiety(t.status as StatusTrade));

  const note = day ? notes.find((n) => n.day === day) : undefined;
  const dayShots = day ? await getDayScreenshots(note?.id) : [];

  const tradingDays = days.length;
  const winningDays = days.filter((d) => d.pnl > 0).length;

  // Dzien z trade'ami wygrywa z flaga - trade'y sa twardszym dowodem niz znacznik.
  const traded = new Set(days.map((d) => d.day));
  const pauses = notes.filter((n) => n.noTrade && !traded.has(n.day));
  const noTradeDays = pauses.map((n) => ({ day: n.day, reason: reasonName(n.noTradeReason) }));
  const powody = noTradeBreakdown(pauses);

  // Setup byl, ale nie zostal wzięty - te dni maja pozostac "pauza" w gridzie,
  // ale zasluguja na dyskretny znacznik (patrz missedDays w MonthGrid).
  const missedDays = [
    ...new Set(
      monthTrades.filter((t) => czyPominiety(t.status as StatusTrade)).map((t) => t.tradingDay),
    ),
  ];

  const coverage = journalCoverage({
    from,
    to,
    today,
    tradedDays: traded,
    noTradeDays: pauses.map((n) => n.day),
  });

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
          <MonthNav month={month} base="/calendar" />
          <UnitSwitch active={unit} />
        </div>
      </header>

      <KpiGrid className="xl:grid-cols-4">
        <Kpi
          label="Wynik miesiąca"
          value={money(stats.pnl, { currency, sign: true })}
          sub={tradesCount(stats.count)}
          tone={stats.pnl > 0 ? "profit" : stats.pnl < 0 ? "loss" : "neutral"}
        />
        <Kpi label="Suma R" value={rValue(stats.sumR)} sub={`śr. ${rValue(stats.expectancyR)}`} />
        <Kpi
          label="Dni handlowe"
          value={tradingDays}
          sub={`${winningDays} na plusie`}
        />
        <Kpi
          label="Dni bez transakcji"
          value={pauses.length}
          sub={powody.length > 0 ? `najczęściej: ${powody[0].label.toLowerCase()}` : "świadome pauzy"}
        />
        <Kpi
          label="Skuteczność"
          value={percent(stats.winRate)}
          sub={`${stats.wins} W / ${stats.losses} L / ${stats.be} BE`}
        />
        <Kpi
          label="Maks. obsunięcie"
          value={money(-stats.maxDrawdown, { currency })}
          tone={stats.maxDrawdown > 0 ? "loss" : "neutral"}
        />
        <Kpi
          label="Pokrycie dziennika"
          value={percent(coverage.ratio, 0)}
          sub={
            coverage.missing.length === 0
              ? `${coverage.covered}/${coverage.expected} dni roboczych`
              : `${coverage.missing.length} ${plural(coverage.missing.length, "dzień", "dni", "dni")} bez zapisu`
          }
        />
      </KpiGrid>

      <Panel title="Wynik dzień po dniu" description="Kliknij dzień, żeby zobaczyć trade'y i notatkę.">
        <MonthGrid
          month={month}
          days={days}
          noTradeDays={noTradeDays}
          missedDays={missedDays}
          currency={currency}
          unit={unit}
        />
        {(powody.length > 0 || missedDays.length > 0) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-muted">
            {powody.length > 0 && (
              <span>
                <span className="etykieta mr-2">Powody pauz</span>
                {powody.map((p) => `${p.label} ${p.count}`).join(" · ")}
              </span>
            )}
            {missedDays.length > 0 && (
              // Znaczenie kropki na kaflu zylo dotad tylko w `title` i
              // `sr-only` - bez wpisu w legendzie nie da sie go odczytac bez
              // najechania (recenzja 2026-08-30, znalezisko 12).
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                nie wzięty setup {missedDays.length}
              </span>
            )}
          </p>
        )}
      </Panel>

      {day && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <Panel
              title={longDate(day)}
              description={
                dayRealne.length > 0
                  ? `${tradesCount(dayStats.count)} · ${money(dayStats.pnl, { currency, sign: true })} · ${rValue(dayStats.sumR)}${dayStats.be > 0 ? ` · ${dayStats.be} BE` : ""}`
                  : note?.noTrade
                    ? `Dzień bez transakcji${reasonName(note.noTradeReason) ? ` — ${reasonName(note.noTradeReason)!.toLowerCase()}` : ""}`
                    : "Brak trade'ów tego dnia."
              }
              actions={
                // Byl 120x16px tekstem z podkresleniem na hover - ponizej
                // minimalnego celu dotykowego 24x24 z WCAG 2.2 AA (2.5.8) i
                // czytal sie jak etykieta stanu, nie akcja (recenzja
                // 2026-08-30, znalezisko 13). Ramka i tlo daja mu forme
                // przycisku, h-7 (28px) daje cel dotykowy z zapasem.
                <Link
                  href={`/trades/new?dzien=${day}&status=missed`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-2.5 text-xs text-text transition-colors duration-150 hover:border-accent hover:text-accent"
                >
                  Był setup, nie wziąłem
                </Link>
              }
            >
              <TradeList
                trades={dayTrades}
                    emptyText="Tego dnia nie było żadnego trade'a."
              />
            </Panel>

            <Panel title="Zrzuty dnia" description="Także dzień bez transakcji ma czego dowodzić.">
              <ScreenshotUploader
                key={day}
                cel={{ typ: "dzien", day, accountId: account?.id ?? null }}
                shots={dayShots}
                opis={`dzień ${day}`}
              />
            </Panel>
          </div>

          <Panel title="Notatka dnia">
            {/* Klucz z dnia: bez niego przejscie na inny dzien zostawia w polach stara tresc. */}
            <DayNoteForm
              key={day}
              day={day}
              accountId={account?.id ?? null}
              hasTrades={dayRealne.length > 0}
              values={{
                preSession: note?.preSession,
                postSession: note?.postSession,
                mood: note?.mood,
                energy: note?.energy,
                dayRating: note?.dayRating,
                noTrade: note?.noTrade,
                noTradeReason: note?.noTradeReason,
              }}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
