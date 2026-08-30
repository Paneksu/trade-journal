import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { DeleteDayNoteButton, NoTradeDayForm } from "@/components/backtest/no-trade-days";
import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import { TradeList } from "@/components/trades/trade-list";
import { DataPoint, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { backtestSessions } from "@/lib/db/schema";
import { reasonName } from "@/lib/domain/day-log";
import { computeStats } from "@/lib/domain/stats";
import { czyPominiety } from "@/lib/domain/status";
import { getAccounts, getProgi } from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { getDayScreenshots, getSessionDayNote } from "@/lib/queries/journal";
import { closedOnly, getTrades } from "@/lib/queries/trades";
import { MAX_ZRZUTOW } from "@/lib/screenshots-limit";
import { longDate, money, plural, rValue, tradesCount } from "@/lib/format";

export const metadata = { title: "Dzień sesji — Dziennik tradingowy" };

/**
 * Jeden dzien sesji backtestu - taka sama karta jak karta trade'a (2026-08-29).
 *
 * Wczesniej dzien bez sygnalu byl wylacznie wierszem listy na stronie sesji:
 * zrzuty dalo sie wgrac dopiero po rozwinieciu wpisu, a notatki nie dalo sie
 * poprawic wcale. Dzien odpuszczony swiadomie jest wpisem dziennika dokladnie
 * tak samo jak trade, wiec dostaje wlasny adres, galerie w tym samym ukladzie
 * i formularz, ktory da sie otworzyc ponownie.
 *
 * Strona dziala takze dla dnia, ktory wpisu jeszcze NIE ma - formularz jest
 * wtedy pusty, a wgranie zrzutu samo zaklada notatke (`ensureDayNote`).
 */

export default async function DzienSesjiPage({
  params,
}: {
  params: Promise<{ id: string; data: string }>;
}) {
  const settings = await requireSession();
  const { id, data } = await params;

  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) notFound();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) notFound();

  const [session] = await db
    .select()
    .from(backtestSessions)
    .where(eq(backtestSessions.id, sessionId))
    .limit(1);
  if (!session) notFound();

  const [note, dayTrades, accounts, progi] = await Promise.all([
    getSessionDayNote(sessionId, data),
    getTrades({
      ...EMPTY_FILTERS,
      source: "backtest",
      backtestSession: sessionId,
      from: data,
      to: data,
    }),
    getAccounts(),
    getProgi(),
  ]);

  const shots = await getDayScreenshots(note?.id);
  const currency = accounts[0]?.currency ?? settings.baseCurrency;
  const stats = computeStats(closedOnly(dayTrades), progi);
  const powod = reasonName(note?.noTradeReason ?? null);
  /* Nie wzieta pozycja nie jest dowodem, ze dzien mial sygnal - serwer
     (countSessionTradesOnDay) jej nie liczy przy blokadzie formularza "bez
     sygnalu", wiec klient nie moze go liczyc tez. Ten sam rozjazd co na
     /calendar (patrz dayRealne tam) - bez tego formularz sie nie renderuje,
     a naglowek czyta zdanie, ktore klamie (recenzja 2026-08-30, znalezisko 1). */
  const dayRealne = dayTrades.filter((t) => !czyPominiety(t.status));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="etykieta">
            <Link href="/backtest" className="hover:text-text">
              Backtesting
            </Link>{" "}
            /{" "}
            <Link href={`/backtest/${session.id}`} className="hover:text-text">
              {session.name}
            </Link>{" "}
            / dzień
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {longDate(data)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {dayRealne.length > 0
              ? `${tradesCount(dayRealne.length)} w tym dniu`
              : note
                ? `Dzień bez sygnału${powod ? ` — ${powod.toLowerCase()}` : ""}`
                : "Ten dzień nie ma jeszcze wpisu."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/trades/new?sesja=${session.id}`}
            className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-3 text-xs text-text transition-colors duration-150 hover:border-faint"
          >
            Dodaj trade do sesji
          </Link>
          {note && <DeleteDayNoteButton id={note.id} />}
        </div>
      </header>

      {dayRealne.length > 0 && (
        <div className="panel">
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <DataPoint label="Wynik dnia">
              {money(stats.pnl, { currency, sign: true })}
            </DataPoint>
            <DataPoint label="Suma R">{rValue(stats.sumR)}</DataPoint>
            <DataPoint label="Trade'y">{stats.count}</DataPoint>
            <DataPoint label="Wygrane">
              {`${stats.wins} / ${stats.count}`}
            </DataPoint>
          </div>
        </div>
      )}

      <Panel
        title="Zrzuty dnia"
        description={`${shots.length} z ${MAX_ZRZUTOW}. Wykres, na którym setupu nie było, bywa więcej wart niż zdanie o nim.`}
      >
        {/* Ten sam wariant co karta trade'a: waski pasek, duze kafle. Zrzut
            jest tu trescia wpisu, nie zalacznikiem do formularza. */}
        <ScreenshotUploader
          kompakt
          cel={{ typ: "dzien", day: data, accountId: null, backtestSessionId: session.id }}
          shots={shots}
          opis={`dzień ${data} w sesji ${session.name}`}
        />
      </Panel>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel
          title="Wpis dnia"
          description={
            note
              ? "Zapisany dzień bez sygnału — możesz go poprawić."
              : "Zapisz, dlaczego ten dzień nie dał sygnału."
          }
        >
          {dayRealne.length > 0 ? (
            <p className="px-4 py-6 text-sm text-faint">
              Ta sesja ma tego dnia {plural(dayRealne.length, "trade", "trade'y", "trade'ów")} —
              dzień nie był bez sygnału, więc wpisu się tu nie zakłada.
            </p>
          ) : (
            <NoTradeDayForm
              sessionId={session.id}
              dataFrom={session.dataFrom}
              dataTo={session.dataTo}
              domyslnyDzien={data}
              stalaData
              values={
                note
                  ? { noTradeReason: note.noTradeReason, postSession: note.postSession }
                  : undefined
              }
            />
          )}
        </Panel>

        <Panel title="Trade'y tego dnia">
          <TradeList
            trades={dayTrades}
            emptyText="Sesja nie ma tego dnia żadnego trade'a."
          />
        </Panel>
      </div>
    </div>
  );
}
