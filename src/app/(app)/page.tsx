import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Lock, Plus } from "lucide-react";

import { KontaDnia } from "@/components/dzis/konta-dnia";
import { RachunekDzis } from "@/components/dzis/rachunek";
import { KrzywaR } from "@/components/dzis/krzywa-r";
import { POLA_PO_SESJI, POLA_PRZED_SESJA, podpisPol } from "@/lib/trades/podpis-notatki";
import { ChecklistaRegul, FormularzPoSesji, FormularzPrzedSesja, Rozwijane } from "@/components/dzis/formularze";
import { ChipProcesu, Karta, LiczbaBohater, NaglowekSekcji, NaglowekStrony, PasekZuzycia, Pigulka, Strona } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { maWynik } from "@/lib/domain/status";
import { money, pnlClass, rValue, timeOnly } from "@/lib/format";
import { daneDzis } from "@/lib/queries/dzis";
import { kontaDnia, stanAutomatu, uzgodnioneZRachunku } from "@/lib/queries/broker";
import { procesISetupy } from "@/lib/queries/ui-v2";
import { ObrazZrzutu } from "@/components/screenshots/obraz-zrzutu";

export const metadata = { title: "Dziś — Dziennik tradingowy" };

/*
 * Ekran „Dziś” (UI v2, wzór 1: pulpit Mercury, demo.mercury.com/dashboard, Refero 859b1114).
 * Kolejność ze wzoru (kierunek.md): nagłówek → pigułki akcji → [karta główna z wykresem | karta kont]
 * → 3 karty pomocnicze → sekcja w 2 kartach → księga. Treść z planu fazy 5: rytuał przed sesją, bufory
 * prop wszystkich kont, plan dnia, checklista zatwierdzonych reguł, trade'y dnia, po sesji, „Do decyzji”.
 */

const BIAS: Record<string, string> = { long: "long", short: "short", neutral: "neutralny" };

function dataDlugaZDniem(dzien: string): string {
  const d = new Date(`${dzien}T12:00:00Z`);
  const t = new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(d);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function procent(x: number | null | undefined): string {
  return x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`;
}

function KartaPomocnicza({
  tytul,
  liczby,
  link,
  children,
}: {
  tytul: string;
  liczby: [string, string][];
  link: { href: string; tekst: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-label={tytul} className="karta flex flex-col p-5 sm:p-6">
      <p className="text-karta text-text">{tytul}</p>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {liczby.map(([etykieta, wartosc]) => (
          <div key={etykieta} className="min-w-0">
            <dt className="text-meta text-muted">{etykieta}</dt>
            <dd className="num mt-0.5 text-karta text-text">{wartosc}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 border-t border-line pt-4">{children}</div>
      <div className="mt-auto flex justify-end pt-4">
        <Link href={link.href} className="przejscie inline-flex items-center gap-0.5 text-karta text-muted hover:text-text">
          {link.tekst} <ChevronRight size={15} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export default async function DzisPage() {
  const settings = await requireSession();
  const d = await daneDzis();
  const [dniaKonta, rachunekUzgodnione, automat] = await Promise.all([kontaDnia(d.dzis), uzgodnioneZRachunku(5, 30), stanAutomatu()]);
  const notatka = d.dzien.dayNote;
  const procesy = await procesISetupy(d.tradeyDnia.map((t) => t.id));
  const lacznieDecyzji = d.doDecyzji.reguly + d.doDecyzji.setupy + d.doDecyzji.sugestie + d.doDecyzji.prop;
  const kontaProp = d.prop.accounts;
  const limitTradow = notatka?.maxTrades ?? null;
  const wzietych = d.tradeyDnia.filter((t) => t.status !== "missed").length;
  const waluta = d.tradeyDnia[0]?.currency ?? settings.baseCurrency;

  return (
    <Strona className="space-y-6">
      <NaglowekStrony tytul="Dziś" podtytul={`${dataDlugaZDniem(d.dzis)} · dzień handlowy NY`} />

      {/* Pigułki akcji pod nagłówkiem (wzór: Send / Transfer / Deposit …). Akcent tylko na głównej. */}
      <nav aria-label="Akcje dnia" data-przyciecie-zamierzone className="-mx-4 -mt-1 flex gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,black_82%,transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:[mask-image:none]">
        <Pigulka href="#przed-sesja" glowna>
          Przed sesją
        </Pigulka>
        <Pigulka href="#po-sesji">Po sesji</Pigulka>
        <Pigulka href="/trades/new">
          <Plus size={15} aria-hidden /> Nowy trade
        </Pigulka>
        <Pigulka href="/decyzje">
          Do decyzji <span className="num text-muted">{lacznieDecyzji}</span>
        </Pigulka>
      </nav>

      {/* Rząd 1: karta główna | karta kont (wzór: 472 + 24 + 472). */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="wynik-dnia" className="karta flex flex-col overflow-hidden">
          <div className="p-5 pb-3 sm:p-6 sm:pb-3">
            <p id="wynik-dnia" className="text-karta text-text">
              Wynik dnia
            </p>
            {/* Liczba jak saldo we wzorze: biała, znak niesie kierunek. Liczy tylko zamknięte trade'y dnia;
                otwarty trade z werdyktem nie ma wyniku i nic tu nie zdradza (ślepa ocena). */}
            <LiczbaBohater tekst={d.zamknieteDnia === 0 ? "0.00R" : rValue(d.rDnia)} className="mt-0.5" />
            {d.ukryte.size > 0 && (
              <p className="mt-1 flex items-center gap-1.5 text-meta text-muted">
                <Lock size={13} className="text-accent" aria-hidden />
                {d.ukryte.size === 1
                  ? "1 otwarty trade z werdyktem AI: wynik po zamknięciu"
                  : `${d.ukryte.size} otwarte trade'y z werdyktem AI: wynik po zamknięciu`}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-meta">
              <span className="text-muted">
                Ostatnie 30 dni: <span className={cx("num", pnlClass(d.sumaR30))}>{rValue(d.sumaR30)}</span>
              </span>
              <span className="num flex items-center gap-3 text-muted">
                <span className="flex items-center gap-0.5">
                  <ArrowUpRight size={14} className="text-profit" aria-hidden />
                  <span className="sr-only">dni na plusie: </span>
                  {rValue(d.zyskR30, false)}
                </span>
                <span className="flex items-center gap-0.5">
                  <ArrowDownRight size={14} className="text-loss" aria-hidden />
                  <span className="sr-only">dni na minusie: </span>
                  {rValue(d.stratyR30)}
                </span>
              </span>
            </div>
          </div>
          <div className="mt-auto">
            <KrzywaR punkty={d.krzywa} />
          </div>
        </section>

        <Karta
          tytul="Konta prop"
          className="flex flex-col"
          akcje={
            <Link href="/settings/accounts" className="przejscie inline-flex items-center gap-0.5 text-meta text-muted hover:text-text">
              Wszystkie <ChevronRight size={14} aria-hidden />
            </Link>
          }
        >
          {kontaProp.length === 0 ? (
            <p className="text-meta text-faint">
              Brak aktywnych kont prop.{" "}
              <Link href="/settings/accounts" className="przejscie text-muted underline underline-offset-2 hover:text-text">
                Dodaj konto w ustawieniach
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {kontaProp.map((k) => {
                if ("error" in k) {
                  return (
                    <li key={k.accountId} className="text-meta">
                      <p className="text-karta text-text">{k.accountName}</p>
                      <p className="text-faint">Bez reguł prop na dziś: przypnij preset, żeby liczyć bufory.</p>
                    </li>
                  );
                }
                const s = k.state;
                const poSl = s.ifStopHit;
                const zuzycie = Math.max(s.drawdownUsed ?? 0, s.dailyLossUsed ?? 0);
                const ostrzezenie = s.warnings.reduce<number>((m, w) => Math.max(m, w.level), 0);
                return (
                  <li key={k.accountId}>
                    {/* R przed USD (kierunek.md: R zamiast $): bufor w R jako liczba wiersza, dolary drugorzędnie. */}
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 text-karta text-text">
                        {k.accountName}
                        {!k.rulesConfirmed && (
                          <span className="ml-2 text-meta text-muted" title={k.rulesNote ?? undefined}>
                            reguły niepotwierdzone
                          </span>
                        )}
                      </p>
                      <p className="num shrink-0 text-karta text-text">
                        {poSl ? `${poSl.drawdownBufferInR.toFixed(1)}R` : money(s.bufferCents, { currency: k.currency, decimals: 0 })}
                      </p>
                    </div>
                    <div className="mt-1.5">
                      <PasekZuzycia zuzycie={zuzycie} etykieta={`${k.accountName}: zużycie limitu`} />
                    </div>
                    {/* Dwa stałe wiersze (bez łamania w środku przy 375 px). */}
                    <p className="num mt-1.5 text-meta whitespace-nowrap text-muted">
                      {money(s.bufferCents, { currency: k.currency, decimals: 0 })} do {s.nearestLimit === "dll" ? "limitu dnia" : "DD"} · zużyte {procent(zuzycie)}
                    </p>
                    <p className="num text-meta whitespace-nowrap text-muted">
                      {poSl ? <>po SL {poSl.bufferInR.toFixed(1)}R</> : "bez ryzyka domyślnego"}
                      {ostrzezenie >= 50 && <> · próg {ostrzezenie}%</>}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {kontaProp.length > 0 && (
            <dl className="mt-auto grid grid-cols-2 gap-x-4 border-t border-line pt-4 text-meta">
              <div className="pt-0">
                <dt className="text-muted">Ekspozycja NQ</dt>
                <dd className="num mt-0.5 text-karta text-text">{d.prop.exposureNq.total.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}</dd>
              </div>
              <div>
                <dt className="text-muted">Zwrot netto (koszty i wypłaty)</dt>
                <dd className="num mt-0.5 text-karta text-text">{money(d.ksiega.nettoCents, { sign: true, decimals: 0 })}</dd>
              </div>
            </dl>
          )}
        </Karta>
      </div>

      {/* Rząd 2: 3 karty pomocnicze z jedną strukturą (wzór: Credit Card / Bill Pay / Invoicing Mercury):
          nagłówek, para liczb, linia, treść, link na dole. Link przy dolnej krawędzi, więc karty równej
          wysokości nie mają pustej połowy (bramka etapu 1, runda 3). */}
      <div className="grid gap-6 md:grid-cols-3">
        <KartaPomocnicza
          tytul="Plan dnia"
          liczby={[
            ["Bias", notatka?.bias ? BIAS[notatka.bias] : "—"],
            ["Trade'y", `${wzietych} / ${limitTradow ?? "—"}`],
            ["Sen · energia", `${notatka?.sleep ?? "—"} · ${notatka?.energy ?? "—"}`],
          ]}
          link={{ href: "#przed-sesja", tekst: "Rytuał" }}
        >
          <p className="text-meta text-muted">Unieważnienie</p>
          {d.uniewaznienie ? (
            <blockquote className="mt-1 border-l-2 border-accent pl-3 text-meta whitespace-pre-wrap text-text">{d.uniewaznienie.text}</blockquote>
          ) : (
            <p className="mt-1 text-meta text-faint">Nie wpisane.</p>
          )}
        </KartaPomocnicza>

        <KartaPomocnicza
          tytul="Reguły"
          liczby={[
            ["Aktywne", String(d.reguly.length)],
            ["Twarde", String(d.reguly.filter((r) => r.hard).length)],
            ["Wersja", String(d.rulesVersion)],
          ]}
          link={{ href: "/decyzje", tekst: "Propozycje" }}
        >
          {d.reguly.length === 0 ? (
            <p className="text-meta text-faint">Nie masz jeszcze zatwierdzonych reguł.</p>
          ) : (
            <ChecklistaRegul dzien={d.dzis} reguly={d.reguly.map((r) => ({ code: r.code, title: r.title, hard: r.hard }))} />
          )}
        </KartaPomocnicza>

        <KartaPomocnicza
          tytul="Do decyzji"
          liczby={[
            ["Oczekuje", String(lacznieDecyzji)],
            ["Sugestie AI", String(d.doDecyzji.sugestie)],
            ["Konta prop", String(d.doDecyzji.prop)],
          ]}
          link={{ href: "/decyzje", tekst: "Otwórz" }}
        >
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-meta">
            {(
              [
                ["Reguły", d.doDecyzji.reguly],
                ["Setupy", d.doDecyzji.setupy],
              ] as const
            ).map(([nazwa, ile]) => (
              <div key={nazwa} className="flex justify-between gap-2">
                <dt className="text-muted">{nazwa}</dt>
                <dd className="num text-text">{ile}</dd>
              </div>
            ))}
          </dl>
        </KartaPomocnicza>
      </div>

      <Karta tytul="Rachunek" id="rachunek" akcje={<Link href="/prop/polaczenia" className="przejscie inline-flex items-center gap-0.5 text-meta text-muted hover:text-text">Połączenia <ChevronRight size={14} aria-hidden /></Link>}>
        <RachunekDzis
          automat={{ skonfigurowane: automat.skonfigurowane, aktywnyToken: automat.tokeny.some((t) => !t.revoked && !t.expired) }}
          wiersze={rachunekUzgodnione}
          strefa={settings.timezone ?? "Europe/Warsaw"}
        />
      </Karta>

      {/* Sekcja „Sesja” w 2 kartach (wzór: Money movement, Money in | Money out). */}
      <div className="space-y-4 pt-5">
        <NaglowekSekcji>Sesja</NaglowekSekcji>
        {/* Gdy „Po sesji” jest zablokowane (ślepa ocena), zwija się do paska, a „Przed sesją” bierze całą
            szerokość w dwóch kolumnach: bez pustej połowy karty (bramka etapu 1, runda 2). */}
        <div className={cx("grid gap-6", !d.dzien.resultHidden && "lg:grid-cols-2")}>
          <Karta id="przed-sesja" tytul="Przed sesją">
            <KontaDnia dzien={d.dzis} konta={dniaKonta.konta} wczoraj={dniaKonta.wczoraj} />
            <Rozwijane etykieta="Uzupełnij rytuał">
            <FormularzPrzedSesja
              dzien={d.dzis}
              wersja={podpisPol(notatka, POLA_PRZED_SESJA)}
              bias={notatka?.bias ?? null}
              maxTrades={notatka?.maxTrades ?? null}
              sleep={notatka?.sleep ?? null}
              energy={notatka?.energy ?? null}
              preSession={notatka?.preSession ?? null}
              uniewaznienie={d.uniewaznienie?.text ?? null}
              szeroki={d.dzien.resultHidden}
            />
            </Rozwijane>
          </Karta>
          {d.dzien.resultHidden ? (
            <section id="po-sesji" aria-label="Po sesji" className="karta flex scroll-mt-20 items-center gap-3 px-5 py-3.5 sm:px-6">
              <Lock size={15} className="shrink-0 text-accent" aria-hidden />
              <p className="text-meta text-muted">
                <span className="text-karta text-text">Po sesji</span> · zablokowane, dopóki trade z werdyktem AI jest otwarty.
              </p>
            </section>
          ) : (
            <Karta id="po-sesji" tytul="Po sesji">
              <FormularzPoSesji dzien={d.dzis} wersja={podpisPol(notatka, POLA_PO_SESJI)} postSession={notatka?.postSession ?? null} dayRating={notatka?.dayRating ?? null} mood={notatka?.mood ?? null} />
            </Karta>
          )}
        </div>
      </div>

      {/* Księga dnia (wzór: Transactions na pulpicie Mercury, wiersz 51 px). */}
      <section aria-labelledby="tradey-dnia" className="space-y-3 pt-5">
        <NaglowekSekcji
          id="tradey-dnia"
          akcje={
            <Link href={`/trades?od=${d.dzis}&do=${d.dzis}`} className="przejscie inline-flex items-center gap-0.5 text-karta text-muted hover:text-text">
              Wszystkie <ChevronRight size={15} aria-hidden />
            </Link>
          }
        >
          Trade&apos;y dnia
        </NaglowekSekcji>
        {d.tradeyDnia.length === 0 ? (
          <p className="karta px-6 py-8 text-meta text-faint">Dziś jeszcze bez trade&apos;ów.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-karta sm:min-w-[560px]">
              <thead>
                <tr className="border-b border-line text-left text-meta text-muted">
                  <th scope="col" className="hidden w-[76px] py-2 pr-4 font-normal sm:table-cell">
                    <span className="sr-only">Zrzut</span>
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">Godzina</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Trade</th>
                  <th scope="col" className="hidden py-2 pr-4 font-normal sm:table-cell">Setup</th>
                  <th scope="col" className="hidden py-2 pr-4 font-normal sm:table-cell">Proces</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">R</th>
                  <th scope="col" className="hidden py-2 text-right font-normal sm:table-cell">USD</th>
                </tr>
              </thead>
              <tbody>
                {d.tradeyDnia.map((t) => {
                  const ukryty = d.ukryte.has(t.id);
                  const info = procesy.get(t.id);
                  return (
                    <tr key={t.id} className="przejscie h-[51px] border-b border-line hover:bg-panel">
                      <td className="hidden py-2 pr-4 sm:table-cell">
                        {/* Miniatura zrzutu użytkownika (styl obrazu marki). Przy ukrytym wyniku nie pokazujemy: zrzut mógł powstać po wejściu. */}
                        {t.firstShot && !ukryty ? (
                           
                          <ObrazZrzutu
                            src={`/api/screenshots/${t.firstShot.thumbnail ?? t.firstShot.file}`}
                            alt={`Zrzut ${t.instrumentSymbol} ${timeOnly(t.entryTime, t.exchangeTimezone)}`}
                            className="h-9 w-16 rounded-[6px] border border-line object-cover"
                          />
                        ) : (
                          <span className="flex h-9 w-16 items-center justify-center rounded-[6px] border border-dashed border-line text-faint">
                            {ukryty ? <Lock size={13} aria-label="zrzut ukryty do zamknięcia" /> : <span className="text-grupa">brak</span>}
                          </span>
                        )}
                      </td>
                      <td className="num py-2 pr-4 text-muted">{timeOnly(t.entryTime, t.exchangeTimezone)}</td>
                      <td className="py-2 pr-4">
                        <Link href={`/trades/${t.id}`} className="przejscie text-text hover:text-accent">
                          <span className="num">{t.instrumentSymbol}</span>{" "}
                          <span className="text-muted">{t.direction}</span>
                        </Link>
                      </td>
                      <td className="hidden py-2 pr-4 text-meta text-muted sm:table-cell">{info?.setup ?? "—"}</td>
                      <td className="hidden py-2 pr-4 sm:table-cell">
                        <ChipProcesu ocena={info?.proces ?? null} />
                      </td>
                      <td className={cx("num py-2 pr-4 text-right", !ukryty && pnlClass(t.rMultiple))}>
                        {ukryty ? <Lock size={14} className="ml-auto text-accent" aria-label="wynik ukryty do zamknięcia" /> : maWynik(t.status) ? rValue(t.rMultiple) : "otwarty"}
                      </td>
                      <td className="num hidden py-2 text-right text-meta text-muted sm:table-cell">
                        {ukryty || !maWynik(t.status) ? "—" : money(t.pnl, { currency: waluta, sign: true })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Strona>
  );
}
