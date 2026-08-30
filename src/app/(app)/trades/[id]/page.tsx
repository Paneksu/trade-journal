import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteTradeButton } from "@/components/trades/trade-actions";
import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import { Badge, DataPoint, Panel } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { requireSession } from "@/lib/auth/guard";
import { POWOD_NAZWY } from "@/lib/domain/kierunek";
import { maWynik } from "@/lib/domain/status";
import { SESSION_NAMES, TRADE_STATUS_NAMES, WEEKDAY_NAMES } from "@/lib/domain/types";
import { formatValue } from "@/lib/fields/fields";
import { getFields } from "@/lib/queries/dictionaries";
import { getScreenshots, getTrade } from "@/lib/queries/trades";
import { MAX_ZRZUTOW } from "@/lib/screenshots-limit";
import {
  dateTime,
  duration,
  int,
  longDate,
  money,
  num,
  percent,
  pnlClass,
  price,
  rValue,
  wynikClass,
} from "@/lib/format";

export const metadata = { title: "Trade — Dziennik tradingowy" };

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId)) notFound();

  const trade = await getTrade(tradeId);
  if (!trade) notFound();

  const [shots, fields] = await Promise.all([getScreenshots(tradeId), getFields()]);

  /* Pola wlasne pokazujemy tylko te, ktore ten trade ma wypelnione. Definicje
     "nastroj", "jakosc_wejscia" i "plan_zrealizowany" zniknely 2026-08-29,
     wiec stare wartosci zostaly w JSONB, ale nie maja juz czego opisac -
     `getFields()` ich nie zwraca i tu sie nie pojawia. */
  const filled = fields.filter((f) => trade.custom?.[f.key] !== undefined);

  const pokazWynik = maWynik(trade.status);
  /* Pozycja czesciowo zamknieta: "open" z co najmniej jednym wyjsciem ma juz
     zrealizowany kawalek wyniku, ale `maWynik` celowo go nie pokazuje - status
     "open" nie ma policzalnego KONCOWEGO wyniku. Tutaj chodzi o co innego:
     pokazac to, co juz zrealizowane, z etykieta mowiaca wprost, ze to nie
     jest wynik zamknietego trade'a. */
  const czesciowoZamkniete = trade.status === "open" && trade.exitCount > 0;

  const sumaKontraktowWyjsc = trade.exits.reduce((s, e) => s + e.contracts, 0);
  /* Wiersz sumy bierze wynik i R z trade'a, NIE z sumowania kolumn wyzej.
     Dwa powody. R kawalka jest liczone wzgledem ryzyka proporcjonalnego do
     jego wielkosci, wiec suma kolumny bez wazenia udzialem daje liczbe
     zawyzona (dwa kawalki po +5R i +1R przy trade'cie +3R). A `pnl` kawalka
     nie zna kwoty z rachunku podanej dla calego trade'a (ADR-016), wiec
     suma kolumny rozjechalaby sie z kwota w naglowku strony. Zrodlem prawdy
     jest `computeTrade`, nie dodawanie w widoku. */
  const sumaPnlWyjsc = trade.pnl;
  const sumaRWyjsc = trade.rMultiple;

  return (
    <div className="space-y-4">
      {trade.status === "missed" && (
        <div className="border-l-2 border-accent bg-accent-dim px-3 py-2 text-sm text-accent-strong">
          Trade nie wzięty — wynik hipotetyczny, poza statystykami.
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="etykieta">
            <Link href="/trades" className="hover:text-text">
              Trade&apos;y
            </Link>{" "}
            / #{trade.id} ·{" "}
            {/* Skrot do calego dnia - z kalendarza da sie wejsc w trade, z trade'a nie dalo sie wyjsc. */}
            <Link
              href={
                trade.backtestSessionId
                  ? `/backtest/${trade.backtestSessionId}?dzien=${trade.tradingDay}`
                  : `/calendar?dzien=${trade.tradingDay}`
              }
              className="hover:text-text"
            >
              {longDate(trade.tradingDay)}
            </Link>
          </p>
          <h1 className="mt-1 flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-xl font-semibold text-text sm:text-2xl">
              {trade.instrumentSymbol}
            </span>
            <span
              className={cx(
                "text-sm font-semibold uppercase",
                trade.direction === "long" ? "text-profit" : "text-loss",
              )}
            >
              {trade.direction}
            </span>
            <span className="text-sm text-faint">{num(trade.contracts, 0)} kontr.</span>
            <span
              className={cx(
                "liczba text-xl font-semibold",
                pokazWynik ? wynikClass(trade.wynik) : czesciowoZamkniete ? pnlClass(trade.pnl) : undefined,
              )}
            >
              {pokazWynik
                ? money(trade.pnl, { currency: trade.currency, sign: true })
                : czesciowoZamkniete
                  ? money(trade.pnl, { currency: trade.currency, sign: true })
                  : TRADE_STATUS_NAMES[trade.status]}
              {pokazWynik && trade.wynik === "be" && (
                <span className="ml-1 text-sm opacity-70">BE</span>
              )}
              {trade.status === "missed" && (
                <span className="ml-1 text-xs font-semibold uppercase tracking-wide text-accent">
                  hipot.
                </span>
              )}
              {czesciowoZamkniete && (
                <span className="ml-1 text-xs font-semibold uppercase tracking-wide text-accent">
                  częściowo
                </span>
              )}
            </span>
            <span className={cx("liczba text-sm", pnlClass(trade.rMultiple))}>
              {rValue(trade.rMultiple)}
            </span>
          </h1>
          {trade.backtestSessionName && (
            <p className="mt-1 text-xs text-accent">
              Trade z sesji backtestu: {trade.backtestSessionName}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/trades/${trade.id}/edit`}
            className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-3 text-xs text-text transition-colors duration-150 hover:border-faint"
          >
            Edytuj
          </Link>
          <DeleteTradeButton id={trade.id} />
        </div>
      </header>

      <Panel
        title="Zrzuty wykresu"
        description={`${shots.length} z ${MAX_ZRZUTOW}. Kliknij, żeby powiększyć.`}
      >
        {/* Kompaktowo (2026-08-29): na karcie trade'a tresc niosa zdjecia, nie
            ramka do wklejania. Ctrl+V dziala na calym dokumencie, wiec duza
            strefa i tak nie byla droga, ktora ktokolwiek chodzil. */}
        <ScreenshotUploader
          kompakt
          cel={{ typ: "trade", tradeId: trade.id }}
          shots={shots}
          opis={`${trade.instrumentSymbol}, ${trade.tradingDay}`}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Przebieg" className="xl:col-span-2">
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            {/* Czas gieldy instrumentu (ADR-022) - w tej samej strefie, w
                ktorej sie go wpisuje. */}
            <DataPoint label="Wejście">{dateTime(trade.entryTime, trade.exchangeTimezone)}</DataPoint>
            <DataPoint label="Cena wejścia">{price(trade.entryPrice, trade.tickSize)}</DataPoint>
            {/* Przy wiecej niz jednym wyjsciu `exitTime`/`exitPrice` to juz nie
                pojedynczy fakt, tylko ostatni moment i srednia wazona - etykieta
                musi to mowic wprost, inaczej sugeruje jedno wyjscie z pozycji. */}
            <DataPoint label={trade.exitCount > 1 ? "Ostatnie wyjście" : "Wyjście"}>
              {dateTime(trade.exitTime, trade.exchangeTimezone)}
            </DataPoint>
            <DataPoint label={trade.exitCount > 1 ? "Średnia cena wyjścia" : "Cena wyjścia"}>
              {price(trade.exitPrice, trade.tickSize)}
            </DataPoint>

            <DataPoint label="Stop loss">{price(trade.stopLoss, trade.tickSize)}</DataPoint>
            <DataPoint label="Take profit">{price(trade.takeProfit, trade.tickSize)}</DataPoint>
            <DataPoint label="Ryzyko">
              {money(trade.riskAmount, { currency: trade.currency })}
            </DataPoint>
            <DataPoint label="Ticki ryzyka">{int(trade.riskTicks)}</DataPoint>

            <DataPoint label="Ticki" valueClassName={pnlClass(trade.ticks)}>
              {int(trade.ticks)}
            </DataPoint>
            <DataPoint label="Czas trzymania">{duration(trade.durationS)}</DataPoint>

            <DataPoint label="MAE">
              {trade.mae ? `${price(trade.mae, trade.tickSize)} (${rValue(trade.maeR, false)})` : "—"}
            </DataPoint>
            <DataPoint label="MFE">
              {trade.mfe ? `${price(trade.mfe, trade.tickSize)} (${rValue(trade.mfeR, false)})` : "—"}
            </DataPoint>
            <DataPoint label="Sesja">
              {trade.marketSession ? SESSION_NAMES[trade.marketSession] : "—"}
            </DataPoint>
            <DataPoint label="Dzień">
              {trade.weekday === null ? "—" : WEEKDAY_NAMES[trade.weekday]}
            </DataPoint>
            {trade.exitCount > 1 && (
              <DataPoint label="Wpływ skalowania" valueClassName={pnlClass(trade.scalingR)}>
                {rValue(trade.scalingR)}
              </DataPoint>
            )}
          </div>

          {/* Kierunek a egzekucja (ADR-018) - osobny wiersz, bo to ocena
              zagrania, a nie kolejna liczba z rachunku. Pokazujemy tylko wtedy,
              gdy jest co pokazac. */}
          {trade.kierunekTrafiony !== null && (
            <div className="grid grid-cols-2 gap-4 border-t border-line p-4 sm:grid-cols-4">
              <DataPoint label="Kierunek">
                <span className={trade.kierunekTrafiony ? "text-profit" : "text-loss"}>
                  {trade.kierunekTrafiony ? "trafiony" : "chybiony"}
                </span>
              </DataPoint>
              <DataPoint label="Powód">
                {trade.badExecutionReason === null
                  ? "—"
                  : POWOD_NAZWY[trade.badExecutionReason]}
              </DataPoint>
              <DataPoint label="Potencjał">{rValue(trade.potentialR)}</DataPoint>
              <DataPoint label="Utracone R">
                {trade.potentialR === null
                  ? "—"
                  : rValue(Math.max(0, trade.potentialR - (trade.rMultiple ?? 0)), false)}
              </DataPoint>
            </div>
          )}
        </Panel>

        <Panel title="Opis">
          <div className="space-y-4 p-4">
            <div>
              <p className="etykieta">Konto</p>
              <p className="mt-0.5 text-sm text-text">{trade.accountName}</p>
            </div>
            {/* Strategia zniknela z formularza 2026-08-29 (typ zagrania opisuje
                teraz tag "Styl wejścia"), ale stare trade'y ja maja - wiec
                pokazujemy ja wtedy i tylko wtedy. */}
            {trade.strategyName && (
              <div>
                <p className="etykieta">Strategia</p>
                <p className="mt-0.5 text-sm text-text">{trade.strategyName}</p>
              </div>
            )}
            {trade.tags.length > 0 && (
              <div>
                <p className="etykieta mb-1.5">Tagi</p>
                <div className="flex flex-wrap gap-1.5">
                  {/* `assignmentId`, nie `id` - tag powtorzony na kilku
                      interwalach to kilka chipow (ADR-017). */}
                  {trade.tags.map((t) => (
                    <Badge
                      key={t.assignmentId}
                      color={t.color}
                      title={t.interval ? `${t.category} · ${t.interval}` : t.category}
                    >
                      {t.name}
                      {/* 0.8, nie 0.6 - ta sama poprawka co na kaflu galerii,
                          gdzie przezroczystosc zbijala dopisek interwalu do
                          3,35:1. Ta strona nie jest w EKRANACH z audytu axe,
                          wiec nikt by tego tutaj nie zlapal. */}
                      {t.interval && <span className="opacity-80"> {t.interval}</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {filled.length > 0 && (
              <div className="space-y-2">
                {filled.map((f) => (
                  <div key={f.key}>
                    <p className="etykieta">{f.label}</p>
                    <p className="mt-0.5 text-sm text-text">
                      {formatValue(f, trade.custom?.[f.key])}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div>
              <p className="etykieta">Gotowość</p>
              <p className="mt-0.5 text-sm text-text">
                {trade.readiness === null ? "nie oceniono" : `${trade.readiness}/10`}
              </p>
              {trade.moodNote && (
                <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{trade.moodNote}</p>
              )}
            </div>
            {trade.executionRating !== null && (
              <div>
                <p className="etykieta">Ocena wykonania (archiwalna)</p>
                <p className="mt-0.5 text-sm text-text">{trade.executionRating}/5</p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Notatka">
        {trade.note ? (
          <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-text">
            {trade.note}
          </p>
        ) : (
          <p className="px-4 py-6 text-sm text-faint">Bez notatki.</p>
        )}
      </Panel>

      {trade.exits.length > 0 && (
        <Panel
          title="Wyjścia"
          description={
            trade.exitCount > 1
              ? `${trade.exitCount} wyjść z pozycji, po kolei.`
              : "Jedno wyjście z pozycji."
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="etykieta px-3 py-2 text-left">Czas</th>
                  <th scope="col" className="etykieta px-3 py-2 text-left">Cena</th>
                  <th scope="col" className="etykieta px-3 py-2 text-right">Kontrakty</th>
                  <th scope="col" className="etykieta px-3 py-2 text-right">Udział</th>
                  <th scope="col" className="etykieta px-3 py-2 text-right">Ticki</th>
                  <th scope="col" className="etykieta px-3 py-2 text-right">Wynik</th>
                  <th scope="col" className="etykieta px-3 py-2 text-right">R</th>
                  <th scope="col" className="etykieta px-3 py-2 text-left">Notatka</th>
                </tr>
              </thead>
              <tbody>
                {trade.exits.map((e) => (
                  <tr key={e.id} className="border-b border-line">
                    <td className="liczba px-3 py-2 whitespace-nowrap">
                      {dateTime(e.exitTime, trade.exchangeTimezone)}
                    </td>
                    <td className="liczba px-3 py-2">{price(e.exitPrice, trade.tickSize)}</td>
                    <td className="liczba px-3 py-2 text-right">{num(e.contracts, 0)}</td>
                    <td className="liczba px-3 py-2 text-right text-muted">
                      {trade.contracts > 0 ? percent(e.contracts / trade.contracts, 0) : "—"}
                    </td>
                    <td className={cx("liczba px-3 py-2 text-right", pnlClass(e.ticks))}>
                      {e.ticks === null ? "—" : int(e.ticks)}
                    </td>
                    <td className={cx("liczba px-3 py-2 text-right", pnlClass(e.pnl))}>
                      {money(e.pnl, { currency: trade.currency, sign: true })}
                    </td>
                    <td className={cx("liczba px-3 py-2 text-right", pnlClass(e.rMultiple))}>
                      {rValue(e.rMultiple)}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {e.note ?? "—"}
                      {/* Kwota z rachunku brokera TEGO kawalka - tylko gdy jest ustawiona. */}
                      {e.brokerAmount !== null && (
                        <span className="ml-1.5 text-xs text-faint">
                          ({money(e.brokerAmount, { currency: trade.currency })})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {trade.exits.length > 1 && (
                <tfoot>
                  <tr className="border-t border-line-strong">
                    <td className="px-3 py-2 font-medium text-text" colSpan={2}>
                      Suma
                    </td>
                    <td className="liczba px-3 py-2 text-right font-medium text-text">
                      {num(sumaKontraktowWyjsc, 0)}
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className={cx("liczba px-3 py-2 text-right font-medium", pnlClass(sumaPnlWyjsc))}>
                      {money(sumaPnlWyjsc, { currency: trade.currency, sign: true })}
                    </td>
                    <td className={cx("liczba px-3 py-2 text-right font-medium", pnlClass(sumaRWyjsc))}>
                      {rValue(sumaRWyjsc)}
                    </td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Panel>
      )}

      {/* Panele "Checklista strategii" i "Ten trade na tle strategii" zniknely
          stad 2026-08-29 razem ze strategia w formularzu - bez przypisania
          strategii nie ma z czym porownywac ani czego odhaczac. */}
    </div>
  );
}
