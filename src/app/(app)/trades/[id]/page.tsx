import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Lock } from "lucide-react";

import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import { Markdown } from "@/components/trade/markdown";
import { ProcesWybor } from "@/components/trade/proces-wybor";
import { AkcjeTradu } from "@/components/trades/trade-actions";
import { OcenaAiPanel, type MetaWerdyktu } from "@/components/trades/ocena-ai-panel";
import { Badge, DataPoint } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { db } from "@/lib/db";
import { szczegolyTradu } from "@/lib/api-v2/trade-szczegoly";
import { KATEGORIA_NAZWY } from "@/lib/domain/kategorie";
import { POWOD_NAZWY } from "@/lib/domain/kierunek";
import { maWynik } from "@/lib/domain/status";
import { SESSION_NAMES, TRADE_STATUS_NAMES, WEEKDAY_NAMES } from "@/lib/domain/types";
import { nazwaZrodla } from "@/lib/domain/zrodla";
import { formatValue } from "@/lib/fields/fields";
import { dateTime, duration, int, longDate, money, num, percent, pnlClass, price, rValue, timeOnly, wynikClass } from "@/lib/format";
import { getFields } from "@/lib/queries/dictionaries";
import { getOceny } from "@/lib/queries/oceny";
import { getScreenshots, getTrade } from "@/lib/queries/trades";
import { MAX_ZRZUTOW } from "@/lib/screenshots-limit";

export const metadata = { title: "Trade — Dziennik tradingowy" };

/*
 * Szczegół trade'a (UI v2, wzór 3: Linear issue, Refero 77d175dd): środek = tytuł, pod nim zakładki
 * (Plan, Werdykt AI, Przebieg, Zrzuty, Proces, Notatka); prawy panel ok. 280 px „Właściwości” =
 * zamrożony plan z kłódką. Zakładka Werdykt AI ze wzoru 3w (parallel.ai „Basis”).
 *
 * Ślepa ocena (MUST 2): wszystko, co może zdradzić wynik, czytamy przez `szczegolyTradu` (ta sama
 * funkcja co `GET /api/v2/trades/:id`). Gdy `resultHidden`, nie pokazujemy wyniku, wyjść, notatki
 * ani zrzutów po wejściu, także z `getTrade`.
 */

const ZAKLADKI = [
  { klucz: "plan", nazwa: "Plan" },
  { klucz: "werdykt", nazwa: "Werdykt AI" },
  { klucz: "przebieg", nazwa: "Przebieg" },
  { klucz: "zrzuty", nazwa: "Zrzuty" },
  { klucz: "proces", nazwa: "Proces" },
  { klucz: "notatka", nazwa: "Notatka" },
] as const;
type Zakladka = (typeof ZAKLADKI)[number]["klucz"];

const POLE_DOPISKU: Record<string, string> = {
  stop_loss: "SL",
  take_profit: "TP",
  contracts: "Kontrakty",
  bias: "Bias",
  invalidation: "Unieważnienie",
  other: "Inne",
};

const ROLE_W_PLANIE = new Set(["plan.thesis", "plan.invalidation", "plan.addendum"]);

function SlowaUzytkownika({ tekst, podpis }: { tekst: string; podpis: string }) {
  return (
    <div>
      <p className="mb-1.5 text-meta text-muted">Słowa użytkownika · {podpis}</p>
      {/* Bajt w bajt: zwykły tekst z zachowaniem nowych linii, bez markdownu (MUST 13). */}
      <blockquote className="border-l-2 border-accent py-0.5 pl-3 text-karta whitespace-pre-wrap text-text">{tekst}</blockquote>
    </div>
  );
}

function Interpretacja({ tekst, model }: { tekst: string; model: string | null }) {
  return (
    <div className="rounded-[var(--radius-tab)] border border-dashed border-line-strong px-4 py-3">
      <p className="mb-1.5 text-meta text-muted">
        interpretacja AI{model ? <span className="num text-faint"> · {model}</span> : null}
      </p>
      <Markdown className="text-meta text-muted [&_*]:text-muted">{tekst}</Markdown>
    </div>
  );
}

function Wlasciwosc({ etykieta, children, liczba = false }: { etykieta: string; children: React.ReactNode; liczba?: boolean }) {
  return (
    <div className="flex min-h-8 items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-meta text-muted">{etykieta}</dt>
      <dd className={cx("min-w-0 text-right text-meta break-words text-text", liczba && "num")}>{children}</dd>
    </div>
  );
}

export default async function TradePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId)) notFound();

  const trade = await getTrade(tradeId);
  if (!trade) notFound();

  const [s, wszystkieZrzuty, fields, oceny] = await Promise.all([szczegolyTradu(db, tradeId), getScreenshots(tradeId), getFields(), getOceny(tradeId)]);
  if (!s) notFound();
  const ukryty = s.resultHidden;
  const plan = s.plan;

  // Te same zrzuty, które wydaje API (bez zrobionych po wejściu przy ukrytym wyniku).
  const widoczneId = new Set(s.screenshots.map((z) => z.id));
  const zrzutyMeta = new Map(s.screenshots.map((z) => [z.id, z]));
  const shots = wszystkieZrzuty
    .filter((z) => widoczneId.has(z.id))
    .map((z) => {
      const m = zrzutyMeta.get(z.id);
      const czas = m?.capturedAt ? timeOnly(m.capturedAt, trade.exchangeTimezone) : null;
      return { ...z, pochodzenie: [m?.origin, czas].filter(Boolean).join(" · ") || null };
    });
  const widoczneOceny = oceny.filter((o) => s.reviews.some((r) => r.id === o.id));
  const meta = new Map<number, MetaWerdyktu>(
    s.reviews.map((r) => [r.id, { asOf: r.asOf, evidenceHash: r.evidenceHash, rulesetVersion: r.rulesetVersion, lookAhead: r.lookAhead?.moglZnacDzien ?? null, model: r.model }]),
  );

  const maPanelOceny = widoczneOceny.length > 0 || trade.source !== "form";
  // Domyślna zakładka: najwięcej mówiąca dla tego trade'a (plan, potem werdykt, potem przebieg).
  const domyslna: Zakladka = plan ? "plan" : maPanelOceny ? "werdykt" : "przebieg";
  const surowa = typeof sp.zakladka === "string" ? sp.zakladka : null;
  const aktywna: Zakladka = ZAKLADKI.some((z) => z.klucz === surowa) ? (surowa as Zakladka) : domyslna;

  const zrodlo = nazwaZrodla(trade.source);
  const pokazWynik = maWynik(trade.status) && !ukryty;
  const czesciowoZamkniete = trade.status === "open" && trade.exitCount > 0 && !ukryty;
  const filled = fields.filter((f) => trade.custom?.[f.key] !== undefined);
  const slowaNotatki = s.userWords.filter((w) => !ROLE_W_PLANIE.has(w.role ?? ""));
  const dobryProces = s.trade.processGrade === "A" || s.trade.processGrade === "B";
  const sumaKontraktowWyjsc = trade.exits.reduce((a, e) => a + e.contracts, 0);

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      {trade.status === "missed" && (
        <div className="mb-4 rounded-[var(--radius-tab)] border-l-2 border-accent bg-accent-dim px-3 py-2 text-meta text-accent-strong">
          Trade nie wzięty — wynik hipotetyczny, poza statystykami.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-6">
          {/* Okruszki jak pasek wzoru (Linear: projekt › REF-5). */}
          {/* Na telefonie okruszki i linia statusu znikają: dolny pasek prowadzi do listy, a status jest we Właściwościach. */}
          <nav aria-label="Okruszki" className="hidden flex-wrap items-center gap-1 text-meta text-muted sm:flex">
            <Link href="/trades" className="przejscie hover:text-text">
              Trade&apos;y
            </Link>
            <ChevronRight size={13} aria-hidden className="text-faint" />
            <span className="num text-text">#{trade.id}</span>
            <span className="text-faint">·</span>
            <Link
              href={trade.backtestSessionId ? `/backtest/${trade.backtestSessionId}?dzien=${trade.tradingDay}` : `/calendar?dzien=${trade.tradingDay}`}
              className="przejscie hover:text-text"
            >
              {longDate(trade.tradingDay)}
            </Link>
          </nav>

          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-tytul font-medium tracking-tight text-text">
                <span className="num">{trade.instrumentSymbol}</span>
                <span className="text-muted">{trade.direction}</span>
                <span className="num text-sekcja text-faint">×{num(trade.contracts, 0)}</span>
              </h1>
              <div className="flex items-center gap-2">
                <AkcjeTradu id={trade.id} />
              </div>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {ukryty ? (
                <p className="flex items-center gap-2 text-karta text-muted">
                  <Lock size={16} className="text-accent" aria-hidden /> {s.resultHiddenReason}
                </p>
              ) : (
                <>
                  {/* R przed USD (kierunek.md, „R zamiast $”): R jako liczba bohater, dolary drugorzędnie.
                      Trade bez stopa nie ma R, wtedy liczbą główną zostaje kwota. */}
                  {(pokazWynik || czesciowoZamkniete) && trade.rMultiple !== null ? (
                    <p className={cx("num text-liczba font-medium", pnlClass(trade.rMultiple))}>{rValue(trade.rMultiple)}</p>
                  ) : null}
                  <p
                    className={cx(
                      "num",
                      (pokazWynik || czesciowoZamkniete) && trade.rMultiple !== null
                        ? "text-sekcja text-muted"
                        : cx("text-liczba font-medium", pokazWynik ? wynikClass(trade.wynik) : czesciowoZamkniete ? pnlClass(trade.pnl) : "text-muted"),
                    )}
                  >
                    {pokazWynik || czesciowoZamkniete ? money(trade.pnl, { currency: trade.currency, sign: true }) : TRADE_STATUS_NAMES[trade.status]}
                    {pokazWynik && trade.wynik === "be" && <span className="ml-1 text-meta opacity-70">BE</span>}
                    {trade.status === "missed" && <span className="ml-1.5 text-grupa font-semibold tracking-wide text-accent uppercase">hipot.</span>}
                    {czesciowoZamkniete && <span className="ml-1.5 text-grupa font-semibold tracking-wide text-accent uppercase">częściowo</span>}
                  </p>
                </>
              )}
            </div>

            <p className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted sm:flex">
              <span>Status: {TRADE_STATUS_NAMES[trade.status]}</span>
              {zrodlo && <Badge title={trade.externalRef ? `Klucz zewnętrzny: ${trade.externalRef}` : undefined}>{zrodlo}</Badge>}
              {trade.kategoria && !trade.backtestSessionId && <Badge title="Kategoria wynika z konta">{KATEGORIA_NAZWY[trade.kategoria]}</Badge>}
              {trade.backtestSessionName && (
                <span className="text-accent-strong">
                  Trade z sesji {trade.sessionKind === "forward" ? "forward testu" : "backtestu"}: {trade.backtestSessionName}
                </span>
              )}
            </p>
          </header>

          {/* Zakładki pod tytułem (kierunek.md, wzór 3). Linki z parametrem: każdy stan ma własny adres. */}
          {/* Na telefonie zakładki przewijają się w bok; wygaszona prawa krawędź sygnalizuje, że jest ich więcej. */}
          <nav
            aria-label="Zakładki trade'a"
            data-przyciecie-zamierzone
            className="-mx-1 overflow-x-auto border-b border-line pb-2 [mask-image:linear-gradient(to_right,black_80%,transparent)] sm:[mask-image:none]"
          >
            <ul className="flex min-w-max gap-1 px-1">
              {ZAKLADKI.map((z) => {
                const jest = z.klucz === aktywna;
                return (
                  <li key={z.klucz}>
                    <Link
                      href={`/trades/${trade.id}?zakladka=${z.klucz}`}
                      scroll={false}
                      aria-current={jest ? "page" : undefined}
                      className={cx(
                        "przejscie inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-tab)] px-3 text-karta",
                        jest ? "bg-accent-dim text-accent-strong" : "text-muted hover:bg-surface-2 hover:text-text",
                      )}
                    >
                      {z.nazwa}
                      {z.klucz === "zrzuty" && <span className="num text-meta opacity-80">{shots.length}</span>}
                      {z.klucz === "werdykt" && widoczneOceny.length > 0 && <span className="num text-meta opacity-80">{widoczneOceny.length}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {aktywna === "plan" && (
            <section aria-label="Plan" className="space-y-6">
              {!plan ? (
                <div className="karta p-6">
                  <p className="text-karta text-text">Ten trade nie ma zamrożonego planu.</p>
                  <p className="mt-1 text-meta text-muted">
                    Plan zamraża się przed wejściem (AI w rytuale albo <span className="num">tj</span>). Poziomy wpisane przy trade&apos;ie: wejście{" "}
                    <span className="num text-text">{price(trade.entryPrice, trade.tickSize)}</span>, SL{" "}
                    <span className="num text-text">{price(trade.stopLoss, trade.tickSize)}</span>, TP{" "}
                    <span className="num text-text">{price(trade.takeProfit, trade.tickSize)}</span>.
                  </p>
                </div>
              ) : (
                <>
                  {plan.thesis ? (
                    <SlowaUzytkownika tekst={plan.thesis.text} podpis="teza" />
                  ) : (
                    <p className="text-meta text-faint">Plan bez zapisanej tezy.</p>
                  )}
                  {plan.invalidation && <SlowaUzytkownika tekst={plan.invalidation.text} podpis="unieważnienie" />}

                  <div>
                    <h2 className="mb-3 text-karta text-text">Dopiski</h2>
                    <ol className="relative space-y-4 border-l border-line pl-5">
                      <li className="relative">
                        <span className="absolute top-1.5 -left-[25px] flex h-2.5 w-2.5 items-center justify-center rounded-full bg-accent" aria-hidden />
                        <p className="text-meta text-muted">
                          <span className="num text-text">{timeOnly(plan.frozenAt, trade.exchangeTimezone)}</span> · plan zamrożony
                        </p>
                      </li>
                      {plan.addenda.map((a) => (
                        <li key={a.id} className="relative">
                          <span className="absolute top-1.5 -left-[24px] h-2 w-2 rounded-full bg-line-strong" aria-hidden />
                          <p className="text-meta text-muted">
                            <span className="num text-text">{timeOnly(a.createdAt, trade.exchangeTimezone)}</span>
                            {a.field && (
                              <>
                                {" "}
                                · {POLE_DOPISKU[a.field] ?? a.field}
                                {a.newValue !== null && <span className="num text-text"> → {Number.isFinite(Number(a.newValue)) ? price(Number(a.newValue), trade.tickSize) : String(a.newValue)}</span>}
                              </>
                            )}
                          </p>
                          {a.words && <p className="mt-1 border-l-2 border-accent pl-3 text-karta whitespace-pre-wrap text-text">{a.words.text}</p>}
                        </li>
                      ))}
                      {plan.addenda.length === 0 && <li className="text-meta text-faint">Bez dopisków. Plan został taki, jak zamrożony.</li>}
                    </ol>
                  </div>
                </>
              )}
              {/* Zrzut użytkownika przy wejściu (styl obrazu marki): wypełnia pustkę pod osią dopisków
                  i od razu pokazuje wykres. Te same zrzuty co API, czyli przy ukrytym wyniku tylko sprzed wejścia. */}
              {shots[0] && (
                <figure className="m-0">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <figcaption className="text-karta text-text">
                      Wykres <span className="num text-meta text-muted">{shots[0].interval ?? ""} {shots[0].pochodzenie ? `· ${shots[0].pochodzenie}` : ""}</span>
                    </figcaption>
                    <Link href={`/trades/${trade.id}?zakladka=zrzuty`} scroll={false} className="przejscie inline-flex items-center gap-0.5 text-meta text-muted hover:text-text">
                      Wszystkie zrzuty ({shots.length}) <ChevronRight size={14} aria-hidden />
                    </Link>
                  </div>
                  <Link href={`/trades/${trade.id}?zakladka=zrzuty`} scroll={false} className="block overflow-hidden rounded-[var(--radius-panel)] border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element -- plik za sesją, poza next/image */}
                    <img
                      src={`/api/screenshots/${shots[0].file}`}
                      alt={`Zrzut wykresu ${shots[0].interval ?? ""} trade'a #${trade.id}`}
                      width={shots[0].width ?? undefined}
                      height={shots[0].height ?? undefined}
                      className="block aspect-[16/9] w-full object-cover"
                    />
                  </Link>
                </figure>
              )}
            </section>
          )}

          {aktywna === "werdykt" &&
            (maPanelOceny ? (
              <OcenaAiPanel trade={trade} oceny={widoczneOceny} meta={meta} wynikUkryty={ukryty} />
            ) : (
              <div className="karta p-6 text-meta text-faint">Trade wpisany ręcznie, bez oceny AI.</div>
            ))}

          {aktywna === "przebieg" && (
            <section aria-label="Przebieg" className="space-y-6">
              <div className="karta">
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 p-5 sm:grid-cols-4 sm:p-6">
                  {/* Czas giełdy instrumentu (ADR-022). */}
                  <DataPoint label="Wejście">{dateTime(trade.entryTime, trade.exchangeTimezone)}</DataPoint>
                  <DataPoint label="Cena wejścia">{price(trade.entryPrice, trade.tickSize)}</DataPoint>
                  <DataPoint label={trade.exitCount > 1 ? "Ostatnie wyjście" : "Wyjście"}>{ukryty ? "ukryte" : dateTime(trade.exitTime, trade.exchangeTimezone)}</DataPoint>
                  <DataPoint label={trade.exitCount > 1 ? "Średnia cena wyjścia" : "Cena wyjścia"}>{ukryty ? "ukryta" : price(trade.exitPrice, trade.tickSize)}</DataPoint>
                  <DataPoint label="Stop loss">{price(trade.stopLoss, trade.tickSize)}</DataPoint>
                  <DataPoint label="Take profit">{price(trade.takeProfit, trade.tickSize)}</DataPoint>
                  <DataPoint label="Ryzyko">{money(trade.riskAmount, { currency: trade.currency })}</DataPoint>
                  <DataPoint label="Ticki ryzyka">{int(trade.riskTicks)}</DataPoint>
                  {!ukryty && (
                    <>
                      <DataPoint label="Ticki" valueClassName={pnlClass(trade.ticks)}>
                        {int(trade.ticks)}
                      </DataPoint>
                      <DataPoint label="Czas trzymania">{duration(trade.durationS)}</DataPoint>
                      <DataPoint label="MAE">{trade.mae ? `${price(trade.mae, trade.tickSize)} (${rValue(trade.maeR, false)})` : "—"}</DataPoint>
                      <DataPoint label="MFE">{trade.mfe ? `${price(trade.mfe, trade.tickSize)} (${rValue(trade.mfeR, false)})` : "—"}</DataPoint>
                    </>
                  )}
                  <DataPoint label="Sesja">{trade.marketSession ? SESSION_NAMES[trade.marketSession] : "—"}</DataPoint>
                  <DataPoint label="Dzień">{trade.weekday === null ? "—" : WEEKDAY_NAMES[trade.weekday]}</DataPoint>
                  {!ukryty && trade.exitCount > 1 && (
                    <DataPoint label="Wpływ skalowania" valueClassName={pnlClass(trade.scalingR)}>
                      {rValue(trade.scalingR)}
                    </DataPoint>
                  )}
                </div>
                {!ukryty && trade.kierunekTrafiony !== null && (
                  <div className="grid grid-cols-2 gap-4 border-t border-line p-5 sm:grid-cols-4 sm:p-6">
                    <DataPoint label="Kierunek">
                      <span className={trade.kierunekTrafiony ? "text-profit" : "text-loss"}>{trade.kierunekTrafiony ? "trafiony" : "chybiony"}</span>
                    </DataPoint>
                    <DataPoint label="Powód">{trade.badExecutionReason === null ? "—" : POWOD_NAZWY[trade.badExecutionReason]}</DataPoint>
                    <DataPoint label="Potencjał">{rValue(trade.potentialR)}</DataPoint>
                    <DataPoint label="Utracone R">
                      {trade.potentialR === null ? "—" : rValue(Math.max(0, trade.potentialR - (trade.rMultiple ?? 0)), false)}
                    </DataPoint>
                  </div>
                )}
              </div>

              {!ukryty && trade.exits.length > 0 && (
                <div>
                  <h2 className="mb-2 text-karta text-text">
                    Wyjścia <span className="text-meta text-muted">{trade.exitCount > 1 ? `${trade.exitCount} wyjść z pozycji, po kolei.` : "Jedno wyjście z pozycji."}</span>
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-meta">
                      <thead>
                        <tr className="border-b border-line text-muted">
                          <th scope="col" className="py-2 pr-3 text-left font-normal">Czas</th>
                          <th scope="col" className="py-2 pr-3 text-left font-normal">Cena</th>
                          <th scope="col" className="py-2 pr-3 text-right font-normal">Kontrakty</th>
                          <th scope="col" className="py-2 pr-3 text-right font-normal">Udział</th>
                          <th scope="col" className="py-2 pr-3 text-right font-normal">Ticki</th>
                          <th scope="col" className="py-2 pr-3 text-right font-normal">Wynik</th>
                          <th scope="col" className="py-2 pr-3 text-right font-normal">R</th>
                          <th scope="col" className="py-2 text-left font-normal">Notatka</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trade.exits.map((e) => (
                          <tr key={e.id} className="h-11 border-b border-line">
                            <td className="num pr-3 whitespace-nowrap">{dateTime(e.exitTime, trade.exchangeTimezone)}</td>
                            <td className="num pr-3">{price(e.exitPrice, trade.tickSize)}</td>
                            <td className="num pr-3 text-right">{num(e.contracts, 0)}</td>
                            <td className="num pr-3 text-right text-muted">{trade.contracts > 0 ? percent(e.contracts / trade.contracts, 0) : "—"}</td>
                            <td className={cx("num pr-3 text-right", pnlClass(e.ticks))}>{e.ticks === null ? "—" : int(e.ticks)}</td>
                            <td className={cx("num pr-3 text-right", pnlClass(e.pnl))}>{money(e.pnl, { currency: trade.currency, sign: true })}</td>
                            <td className={cx("num pr-3 text-right", pnlClass(e.rMultiple))}>{rValue(e.rMultiple)}</td>
                            <td className="text-muted">
                              {e.note ?? "—"}
                              {e.brokerAmount !== null && <span className="ml-1.5 text-faint">({money(e.brokerAmount, { currency: trade.currency })})</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {trade.exits.length > 1 && (
                        <tfoot>
                          <tr className="h-11 border-t border-line-strong">
                            <td className="pr-3 font-medium text-text" colSpan={2}>
                              Suma
                            </td>
                            <td className="num pr-3 text-right font-medium text-text">{num(sumaKontraktowWyjsc, 0)}</td>
                            <td />
                            <td />
                            {/* Suma bierze wynik i R z trade'a (computeTrade), nie z dodawania kolumn. */}
                            <td className={cx("num pr-3 text-right font-medium", pnlClass(trade.pnl))}>{money(trade.pnl, { currency: trade.currency, sign: true })}</td>
                            <td className={cx("num pr-3 text-right font-medium", pnlClass(trade.rMultiple))}>{rValue(trade.rMultiple)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {aktywna === "zrzuty" && (
            <section aria-label="Zrzuty" className="space-y-3">
              <p className="text-meta text-muted">
                {shots.length} z {MAX_ZRZUTOW}. Interwał w lewym dolnym rogu, pochodzenie i godzina w lewym górnym.
                {ukryty && " Zrzuty zrobione po wejściu są ukryte do zamknięcia."}
              </p>
              <ScreenshotUploader kompakt cel={{ typ: "trade", tradeId: trade.id }} shots={shots} opis={`${trade.instrumentSymbol}, ${trade.tradingDay}`} />
            </section>
          )}

          {aktywna === "proces" && (
            <section aria-label="Proces" className="space-y-6">
              <div>
                <h2 className="text-karta text-text">Ocena procesu</h2>
                <p className="mt-1 mb-4 text-meta text-muted">Osobno od wyniku: czy trade był wykonany według reguł. Wolno ją wystawić przed zamknięciem.</p>
                <ProcesWybor tradeId={trade.id} poczatkowa={s.trade.processGrade} />
              </div>
              {s.trade.processGrade && pokazWynik && trade.wynik !== "be" && (
                <div className="karta p-5 sm:p-6">
                  <p className="text-meta text-muted">Siatka proces × wynik</p>
                  <p className="mt-1 text-sekcja text-text">
                    {dobryProces
                      ? trade.wynik === "zysk"
                        ? "Zasłużony zysk"
                        : "Dobra strata"
                      : trade.wynik === "zysk"
                        ? "Szczęście"
                        : "Zasłużona strata"}
                  </p>
                  <p className="mt-1 text-meta text-muted">
                    Proces <span className="num text-text">{s.trade.processGrade}</span> i wynik <span className={cx("num", pnlClass(trade.rMultiple))}>{rValue(trade.rMultiple)}</span>.
                  </p>
                </div>
              )}
            </section>
          )}

          {aktywna === "notatka" && (
            <section aria-label="Notatka" className="space-y-6">
              {ukryty ? (
                <p className="flex items-center gap-2 text-meta text-muted">
                  <Lock size={14} className="text-accent" aria-hidden /> Notatki napisane po wejściu są ukryte do zamknięcia trade&apos;a.
                </p>
              ) : null}
              {trade.note && !ukryty && <SlowaUzytkownika tekst={trade.note} podpis="notatka trade'a" />}
              {trade.moodNote && !ukryty && <SlowaUzytkownika tekst={trade.moodNote} podpis="samopoczucie" />}
              {slowaNotatki.map((w) => (
                <div key={w.id} className="space-y-3">
                  <SlowaUzytkownika tekst={w.text} podpis={`${w.source} · ${dateTime(w.capturedAt, trade.exchangeTimezone)}`} />
                  {w.aiInterpretation && <Interpretacja tekst={w.aiInterpretation} model={w.interpretationModel} />}
                </div>
              ))}
              {!trade.note && slowaNotatki.length === 0 && !ukryty && <p className="text-meta text-faint">Bez notatki.</p>}
            </section>
          )}
        </div>

        {/* Prawy panel „Właściwości” (wzór 3: Linear Properties ok. 280 px) = zamrożony plan. */}
        <aside aria-label="Właściwości" className="karta h-fit space-y-5 p-5 lg:sticky lg:top-20">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-meta text-muted">Plan</h2>
              {plan ? (
                <span className="inline-flex items-center gap-1 text-meta text-accent-strong" title={`Zamrożony ${dateTime(plan.frozenAt, trade.exchangeTimezone)}`}>
                  <Lock size={13} aria-hidden /> zamrożony <span className="num">{timeOnly(plan.frozenAt, trade.exchangeTimezone)}</span>
                </span>
              ) : (
                <span className="text-meta text-faint">brak planu</span>
              )}
            </div>
            <dl className="divide-y divide-line">
              <Wlasciwosc etykieta="Setup">
                {plan?.setup ? (
                  <>
                    {plan.setup.name}
                    {plan.setup.version !== null && <span className="text-muted"> v{plan.setup.version}</span>}
                  </>
                ) : (
                  "—"
                )}
              </Wlasciwosc>
              <Wlasciwosc etykieta="Bias">{plan?.bias ?? "—"}</Wlasciwosc>
              <Wlasciwosc etykieta="Wejście" liczba>{price(plan?.entryPrice ?? trade.entryPrice, trade.tickSize)}</Wlasciwosc>
              <Wlasciwosc etykieta="SL" liczba>{price(plan?.stopLoss ?? trade.stopLoss, trade.tickSize)}</Wlasciwosc>
              <Wlasciwosc etykieta="TP" liczba>{price(plan?.takeProfit ?? trade.takeProfit, trade.tickSize)}</Wlasciwosc>
              <Wlasciwosc etykieta="Ryzyko" liczba>{money(plan?.riskCents ?? trade.riskAmount, { currency: trade.currency })}</Wlasciwosc>
              <Wlasciwosc etykieta="Kontrakty" liczba>{num(plan?.contracts ?? trade.contracts, 0)}</Wlasciwosc>
              {plan && <Wlasciwosc etykieta="Wersja reguł" liczba>{plan.rulesetVersion}</Wlasciwosc>}
            </dl>
          </div>

          <div className="border-t border-line pt-4">
            <h2 className="mb-2 text-meta text-muted">Trade</h2>
            <dl className="divide-y divide-line">
              <Wlasciwosc etykieta="Konto">{trade.accountName}</Wlasciwosc>
              <Wlasciwosc etykieta="Źródło danych">{s.trade.dataSource}</Wlasciwosc>
              <Wlasciwosc etykieta="Proces">{s.trade.processGrade ?? "—"}</Wlasciwosc>
              <Wlasciwosc etykieta="Gotowość" liczba>{trade.readiness === null ? "—" : `${trade.readiness}/10`}</Wlasciwosc>
              {trade.strategyName && <Wlasciwosc etykieta="Strategia">{trade.strategyName}</Wlasciwosc>}
              {trade.executionRating !== null && <Wlasciwosc etykieta="Ocena wykonania" liczba>{trade.executionRating}/5</Wlasciwosc>}
              {filled.map((f) => (
                <Wlasciwosc key={f.key} etykieta={f.label}>
                  {formatValue(f, trade.custom?.[f.key])}
                </Wlasciwosc>
              ))}
            </dl>
          </div>

          {trade.tags.length > 0 && (
            <div className="border-t border-line pt-4">
              <h2 className="mb-2 text-meta text-muted">Tagi</h2>
              <div className="flex flex-wrap gap-1.5">
                {/* `assignmentId`, nie `id`: tag powtorzony na kilku interwalach to kilka chipow (ADR-017). */}
                {trade.tags.map((t) => (
                  <Badge key={t.assignmentId} color={t.color} title={t.interval ? `${t.category} · ${t.interval}` : t.category}>
                    {t.name}
                    {t.interval && <span className="opacity-80"> {t.interval}</span>}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
