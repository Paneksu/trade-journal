import Link from "next/link";
import { Lock } from "lucide-react";

import { DayNoteForm } from "@/components/calendar/day-note-form";
import { MonthNav } from "@/components/calendar/month-nav";
import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import { MonthGrid } from "@/components/calendar/month-grid";
import { UnitSwitch } from "@/components/layout/toolbar";
import { TradeList } from "@/components/trades/trade-list";
import { Karta } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { requireSession } from "@/lib/auth/guard";
import { ukryteTrady, wejscieTradu } from "@/lib/api-v2/ukrycie-wyniku";
import { db } from "@/lib/db";
import { localDate } from "@/lib/domain/calc";
import { journalCoverage, monthBounds, noTradeBreakdown, reasonName } from "@/lib/domain/day-log";
import { computeStats, dailyPnl } from "@/lib/domain/stats";
import { czyPominiety } from "@/lib/domain/status";
import { getAccounts, getProgi } from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { getNotatkiDnia, getZrzutyDnia } from "@/lib/queries/journal";
import { POLA_KALENDARZA, podpisPol } from "@/lib/trades/podpis-notatki";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { longDate, money, monthName, percent, plural, pnlClass, rValue, tradesCount } from "@/lib/format";

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
  const unit = params.jednostka === "cash" ? "cash" : "r";

  const { from, to } = monthBounds(month);
  const [accounts, monthTrades] = await Promise.all([
    getAccounts(),
    getTrades({ ...EMPTY_FILTERS, from, to }),
  ]);

  const account = accounts[0];
  // Jedna notatka dnia bez konta (r2, 16.10.2026): ta sama, którą piszą rytuał na „Dziś” i AI przez API.
  const notes = await getNotatkiDnia(from, to);
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
  const dayRealne = dayTrades.filter((t) => !czyPominiety(t.status));

  /* Ślepa ocena (blokery review 16.10.2026): dzień z otwartym trade'em z werdyktem AI ma zablokowany panel notatki
     (jak „Po sesji” na Dziś), a zrzuty dnia zrobione po najwcześniejszym wejściu takiego trade'a nie wychodzą.
     Formularza nie dostajemy z pustymi wartościami: zapis nadpisałby ukryte pola. */
  const ukryteDnia = day ? await ukryteTrady(db, dayTrades.map((t) => t.id)) : new Set<number>();
  const wejsciaUkrytych = (await Promise.all([...ukryteDnia].map((id) => wejscieTradu(db, id)))).filter((d): d is Date => d !== null);
  const granicaZrzutow = wejsciaUkrytych.length > 0 ? Math.min(...wejsciaUkrytych.map((d) => d.getTime())) : null;
  const dzienZablokowany = ukryteDnia.size > 0;
  const note = day && !dzienZablokowany ? notes.find((n) => n.day === day) : undefined;
  const dayShots = day ? (await getZrzutyDnia(day)).filter((s) => granicaZrzutow === null || s.createdAt.getTime() <= granicaZrzutow) : [];

  const tradingDays = days.length;
  const winningDays = days.filter((d) => d.pnl > 0).length;

  // Dzien z trade'ami wygrywa z flaga - trade'y sa twardszym dowodem niz znacznik.
  const traded = new Set(days.map((d) => d.day));
  const pauses = notes.filter((n) => n.noTrade && !traded.has(n.day));
  const noTradeDays = pauses.map((n) => ({ day: n.day, reason: reasonName(n.noTradeReason) }));
  const powody = noTradeBreakdown(pauses);

  // Setup byl, ale nie zostal wziety - te dni maja pozostac "pauza" w gridzie,
  // ale zasluguja na dyskretny znacznik (patrz missedDays w MonthGrid).
  const missedDays = [
    ...new Set(
      monthTrades.filter((t) => czyPominiety(t.status)).map((t) => t.tradingDay),
    ),
  ];

  // Zapisany nie wziety setup JEST wpisem do dziennika - dzien z samym "missed"
  // (bez zamknietego trade'a i bez notatki pauzy) ma sie liczyc jako pokryty,
  // a nie karac uzytkownika za uczciwe przyznanie sie do odpuszczonego setupu
  // (recenzja 2026-08-30, znalezisko 6).
  const coveredDays = new Set([...traded, ...missedDays]);

  const coverage = journalCoverage({
    from,
    to,
    today,
    tradedDays: coveredDays,
    noTradeDays: pauses.map((n) => n.day),
  });

  // Kropka notatki: dzień z wpisaną notatką przed albo po sesji (wzór: znacznik wydarzenia w komórce).
  const noteDays = notes.filter((n) => (n.preSession ?? "").trim() || (n.postSession ?? "").trim()).map((n) => n.day);

  const kpi: { klucz: string; etykieta: string; wartosc: string; pod?: string; ton?: string }[] = [
    { klucz: "r", etykieta: "Suma R", wartosc: rValue(stats.sumR), pod: `śr. ${rValue(stats.expectancyR)} · n=${stats.count}`, ton: pnlClass(stats.sumR) },
    { klucz: "wynik", etykieta: "Wynik miesiąca", wartosc: money(stats.pnl, { currency, sign: true }), pod: tradesCount(stats.count), ton: pnlClass(stats.pnl) },
    { klucz: "dni", etykieta: "Dni handlowe", wartosc: String(tradingDays), pod: `${winningDays} na plusie` },
    { klucz: "pauzy", etykieta: "Dni bez transakcji", wartosc: String(pauses.length), pod: powody.length > 0 ? `najczęściej: ${powody[0].label.toLowerCase()}` : "świadome pauzy" },
    { klucz: "skutecznosc", etykieta: "Skuteczność", wartosc: percent(stats.winRate), pod: `${stats.wins} W / ${stats.losses} L / ${stats.be} BE` },
    {
      klucz: "pokrycie",
      etykieta: "Pokrycie dziennika",
      wartosc: percent(coverage.ratio, 0),
      pod: coverage.missing.length === 0 ? `${coverage.covered}/${coverage.expected} dni roboczych` : `${coverage.missing.length} ${plural(coverage.missing.length, "dzień", "dni", "dni")} bez zapisu`,
    },
  ];

  /*
   * UI v2 (etap 4, wzór 11 Missive Calendar; r2): nagłówek z miesiącem i strzałkami wokół „dziś”, zaraz pod nim
   * siatka na całą szerokość treści (bez kontenera 968 px), pod siatką legenda i pasek liczb miesiąca, potem panel dnia.
   */
  return (
    <div className="w-full space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta text-muted">Kalendarz</p>
          <h1 className="text-tytul font-medium tracking-tight text-text first-letter:uppercase">{monthName(month)}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNav month={month} base="/calendar" />
          <UnitSwitch active={unit} />
        </div>
      </header>


      <section aria-label={`Siatka miesiąca: ${monthName(month)}`}>
        <MonthGrid
          month={month}
          days={days}
          noTradeDays={noTradeDays}
          missedDays={missedDays}
          noteDays={noteDays}
          currency={currency}
          unit={unit}
          today={today}
          selected={day}
        />
        <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-meta text-muted">
          <span>Kliknij dzień: trade&apos;y, zrzuty i notatka pod siatką.</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-muted" /> notatka dnia
          </span>
          {missedDays.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full border border-accent" />
              nie wzięty setup {missedDays.length}
            </span>
          )}
          {powody.length > 0 && <span>Powody pauz: {powody.map((p) => `${p.label} ${p.count}`).join(" · ")}</span>}
        </p>
      </section>

      <dl aria-label="Podsumowanie miesiąca" className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-line pb-5 sm:grid-cols-3 lg:grid-cols-6">
        {kpi.map((k) => (
          <div key={k.klucz} data-kpi={k.klucz} className="min-w-0">
            <dt className="text-meta text-muted">{k.etykieta}</dt>
            <dd className={cx("num mt-0.5 text-sekcja", k.ton || "text-text")} data-wartosc>
              {k.wartosc}
            </dd>
            {k.pod && <dd className="text-meta text-muted">{k.pod}</dd>}
          </div>
        ))}
      </dl>

      {day && (
        <section aria-labelledby="dzien-h" className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <Karta
              tytul={
                <span>
                  <span id="dzien-h" className="block text-sekcja text-text first-letter:uppercase">
                    {longDate(day)}
                  </span>
                  <span className="block text-meta text-muted">
                    {dayRealne.length > 0
                      ? `${tradesCount(dayStats.count)} · ${rValue(dayStats.sumR)} · ${money(dayStats.pnl, { currency, sign: true })}${dayStats.be > 0 ? ` · ${dayStats.be} BE` : ""}`
                      : note?.noTrade
                        ? `Dzień bez transakcji${reasonName(note.noTradeReason) ? `: ${reasonName(note.noTradeReason)!.toLowerCase()}` : ""}`
                        : "Brak trade'ów tego dnia."}
                  </span>
                </span>
              }
              akcje={
                <Link
                  href={`/trades/new?dzien=${day}&status=missed`}
                  className="przejscie inline-flex h-8 items-center rounded-full bg-surface-3 px-3.5 text-karta whitespace-nowrap text-text hover:bg-line-strong focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Był setup, nie wziąłem
                </Link>
              }
            >
              <TradeList trades={dayTrades} emptyText="Tego dnia nie było żadnego trade'a." />
            </Karta>

            <Karta tytul="Zrzuty dnia">
              <p className="-mt-2 mb-3 text-meta text-muted">Także dzień bez transakcji ma czego dowodzić.</p>
              <ScreenshotUploader key={day} cel={{ typ: "dzien", day, accountId: null }} shots={dayShots} opis={`dzień ${day}`} />
            </Karta>
          </div>

          {dzienZablokowany ? (
            <section aria-label="Notatka dnia" className="karta flex items-center gap-3 px-5 py-3.5 sm:px-6" data-zablokowany-dzien>
              <Lock size={15} className="shrink-0 text-accent" aria-hidden />
              <p className="text-meta text-muted">
                <span className="text-karta text-text">Notatka dnia</span> · zablokowana, dopóki trade z werdyktem AI jest otwarty.
              </p>
            </section>
          ) : (
            <Karta tytul="Notatka dnia">
              {/* Klucz z dnia: bez niego przejście na inny dzień zostawia w polach starą treść. */}
              <DayNoteForm
                key={day}
                day={day}
                // Wersja = skrót pól formularza (review B1); starszy wpis na koncie liczy się jak brak notatki bez konta.
                wersja={podpisPol(note && note.accountId === null ? note : null, POLA_KALENDARZA)}
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
            </Karta>
          )}
        </section>
      )}
    </div>
  );
}
