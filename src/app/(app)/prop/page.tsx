import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { KomorkaBufora, ProgOstrzezenia, RODZAJE_KSIEGI, TYPY_DD, wR } from "@/components/etap3/prop-wspolne";
import { Chip, LiczbaBohater, NaglowekStrony, Strona, PustyStan } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { money, moneyShort, percent, pnlClass, shortDate } from "@/lib/format";
import { kontaProp, ksiegaWszystkich, presetyProp } from "@/lib/queries/prop";

export const metadata = { title: "Prop — Dziennik tradingowy" };

/*
 * Prop: konta (UI v2, etap 3). Forma ze wzoru 7a (Mercury Accounts, Refero c7f36c02): zakładki z podkreśleniem,
 * duża liczba z dwiema mniejszymi obok, tabela kont z kolumną „Auto transfer rules” zamienioną na bufory
 * (do DD i limitu dnia) w R i $. Wiersz konta prowadzi do ekranu konta (wzór 7b). Marka: R przed $, Plex Mono,
 * progi 50/75/90 jako pigułki, czerwień dopiero od 90%.
 */

const ZAKLADKI = [
  { klucz: "konta", e: "Konta" },
  { klucz: "presety", e: "Presety firm" },
  { klucz: "ksiega", e: "Księga kosztów" },
] as const;

function Zakladki({ aktywna }: { aktywna: string }) {
  return (
    <nav aria-label="Widoki prop" className="mt-5 flex gap-6 overflow-x-auto border-b border-line">
      {ZAKLADKI.map((z) => (
        <Link
          key={z.klucz}
          href={z.klucz === "konta" ? "/prop" : `/prop?widok=${z.klucz}`}
          aria-current={aktywna === z.klucz ? "page" : undefined}
          className={cx(
            "przejscie -mb-px border-b-2 py-2.5 text-karta whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2",
            aktywna === z.klucz ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {z.e}
        </Link>
      ))}
    </nav>
  );
}

async function WidokKont() {
  const d = await kontaProp();
  const ksiega = d.konta.reduce((s, k) => s + (k.ksiega?.netCents ?? 0), 0);
  const koszty = d.konta.reduce((s, k) => s + (k.ksiega?.costsCents ?? 0), 0);
  return (
    <>
      <div className="mt-8 flex flex-wrap items-end gap-x-14 gap-y-4">
        <div>
          <p className="text-karta text-muted">Zwrot netto z prop</p>
          <LiczbaBohater tekst={money(ksiega, { sign: true })} />
        </div>
        <div>
          <p className="text-meta text-muted">Koszty evali, resetów, aktywacji</p>
          <p className="num text-karta text-text">{money(koszty)}</p>
        </div>
        <div>
          <p className="text-meta text-muted">Ekspozycja teraz (ekwiwalent NQ)</p>
          <p className="num text-karta text-text">{d.exposureNq.total.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}</p>
        </div>
      </div>

      {d.konta.length === 0 ? (
        <p className="mt-8 text-karta text-muted">
          Brak kont prop. Dodaj konto typu prop w{" "}
          <Link href="/settings/accounts" className="przejscie underline underline-offset-2 hover:text-text">
            ustawieniach
          </Link>
          .
        </p>
      ) : (
        <div className="mt-8">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_7rem_minmax(0,1fr)_minmax(0,1fr)_8rem_1.25rem] gap-x-5 border-b border-line pb-2 text-meta text-muted md:grid">
            <span>Konto</span>
            <span className="text-right">Saldo</span>
            <span>Bufor do DD</span>
            <span>Limit dnia</span>
            <span className="text-right">Gdy trafi SL</span>
            <span />
          </div>
          <ul>
            {d.konta.map((k) => {
              if ("error" in k) {
                return (
                  <li key={k.accountId} className="border-b border-line">
                    <Link href={`/prop/${k.accountId}`} className="przejscie flex min-h-16 items-center gap-3 py-3 hover:bg-panel">
                      <span className="min-w-0 flex-1">
                        <span className="block text-karta text-text">{k.accountName}</span>
                        <span className="block text-meta text-muted">Bez reguł na dziś: przypnij preset, żeby liczyć bufory.</span>
                      </span>
                      <ChevronRight className="size-4 text-faint" aria-hidden />
                    </Link>
                  </li>
                );
              }
              const s = k.state;
              const ryzyko = s.ifStopHit?.riskCents ?? null;
              const poziom = s.warnings.reduce<number>((m, w) => Math.max(m, w.level), 0);
              const poSl = s.ifStopHit;
              return (
                <li key={k.accountId} className="border-b border-line" data-konto={k.accountId}>
                  <Link
                    href={`/prop/${k.accountId}`}
                    className="przejscie -mx-3 grid grid-cols-2 items-center gap-x-5 gap-y-3 rounded-[var(--radius-tab)] px-3 py-4 hover:bg-panel md:grid-cols-[minmax(0,1.5fr)_7rem_minmax(0,1fr)_minmax(0,1fr)_8rem_1.25rem]"
                  >
                    <span className="col-span-2 min-w-0 md:col-span-1">
                      <span className="flex flex-wrap items-center gap-2 text-karta text-text">
                        {k.accountName}
                        <ProgOstrzezenia poziom={poziom} />
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted">
                        {k.preset ? `${k.preset.firm} · ${k.preset.program}` : "reguły ręczne"} · DD {TYPY_DD[k.rulesUsed.ddType] ?? k.rulesUsed.ddType}
                        {!k.rulesConfirmed && <Chip className="h-5 border-dashed">reguły niepotwierdzone</Chip>}
                      </span>
                    </span>
                    <span className="num text-karta text-text md:text-right">
                      <span className="mr-2 text-meta text-muted md:hidden">Saldo</span>
                      {money(s.balanceCents, { currency: k.currency, decimals: 0 })}
                    </span>
                    <span className="num text-right text-karta md:hidden">
                      <span className="mr-2 text-meta text-muted">Po SL</span>
                      {poSl ? `${poSl.bufferInR.toFixed(1)}R` : "—"}
                    </span>
                    <span className="min-w-0">
                      <span className="mb-1 block text-meta text-muted md:hidden">Bufor do DD</span>
                      <KomorkaBufora etykieta={`${k.accountName}: zużycie DD`} buforCents={s.drawdownBufferCents} zuzycie={s.drawdownUsed} ryzykoCents={ryzyko} waluta={k.currency} />
                    </span>
                    <span className="min-w-0">
                      <span className="mb-1 block text-meta text-muted md:hidden">Limit dnia</span>
                      <KomorkaBufora etykieta={`${k.accountName}: zużycie limitu dnia`} buforCents={s.dailyLossBufferCents} zuzycie={s.dailyLossUsed} ryzykoCents={ryzyko} waluta={k.currency} />
                    </span>
                    <span className="hidden text-right md:block">
                      <span className={cx("num block text-karta", poSl?.exceedsLimit ? "text-loss" : "text-text")}>{poSl ? `${poSl.bufferInR.toFixed(1)}R` : "—"}</span>
                      <span className="num block text-meta text-muted">{poSl ? `przy ${money(poSl.riskCents, { currency: k.currency, decimals: 0 })}` : "bez ryzyka"}</span>
                    </span>
                    <ChevronRight className="hidden size-4 text-faint md:block" aria-hidden />
                    {s.consistency && (
                      <span className="col-span-2 text-meta text-muted md:col-span-5 md:col-start-1">
                        Consistency (limit {s.consistency.pct}%): {s.consistency.share === null ? "jeszcze bez zysku" : <>największy dzień to <span className={cx("num", s.consistency.violated ? "text-loss" : "text-text")}>{percent(s.consistency.share, 0)}</span> zysku</>}
                        {s.consistency.remainingTodayCents !== null && s.consistency.remainingTodayCents !== undefined && (
                          <> · dziś zostało {wR(s.consistency.remainingTodayCents, ryzyko) ?? money(s.consistency.remainingTodayCents, { currency: k.currency, decimals: 0 })}</>
                        )}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-meta text-faint">
            Dzień handlowy {shortDate(d.dzis)} (NY). „Gdy trafi SL” liczy bufor po stracie jednego R przy ryzyku z planu albo domyślnym konta.
          </p>
        </div>
      )}
    </>
  );
}

async function WidokPresetow() {
  const { presets } = await presetyProp();
  const firmy = [...new Set(presets.map((p) => p.firm))];
  const doWer = presets.filter((p) => p.needsVerification).length;
  return (
    <>
      <p className="mt-6 text-karta text-muted">
        {presets.length} presetów, z tego {doWer} do weryfikacji z regulaminem. Wiek to dni od odczytu regulaminu; regulaminy zmieniają się co kilka miesięcy.
      </p>
      <div className="mt-6 space-y-8">
        {firmy.map((f) => (
          <section key={f} aria-label={f}>
            <h2 className="mb-2 text-sekcja text-text">{f}</h2>
            <div>
              <table className="w-full text-karta">
                <thead>
                  <tr className="border-b border-line text-left text-meta text-muted">
                    <th className="py-2 pr-3 font-normal">Program</th>
                    <th className="py-2 pr-3 text-right font-normal">Konto</th>
                    <th className="py-2 pr-3 font-normal">DD</th>
                    <th className="hidden py-2 pr-3 text-right font-normal sm:table-cell">Limit dnia</th>
                    <th className="hidden py-2 pr-3 text-right font-normal sm:table-cell">Cel</th>
                    <th className="py-2 text-right font-normal">Wiek</th>
                  </tr>
                </thead>
                <tbody>
                  {presets
                    .filter((p) => p.firm === f)
                    .map((p) => (
                      <tr key={p.id} className="border-b border-line">
                        <td className="py-2.5 pr-3 text-text [overflow-wrap:anywhere]">
                          {p.program} <span className="text-muted">· {p.phase}</span>
                          {p.needsVerification && <Chip className="mt-1 ml-0 flex w-fit h-5 border-dashed">do weryfikacji</Chip>}
                        </td>
                        <td className="num py-2.5 pr-3 text-right whitespace-nowrap">{moneyShort(p.accountSizeCents)}</td>
                        <td className="py-2.5 pr-3">
                          <span className="num block whitespace-nowrap">{money(p.maxDdCents, { decimals: 0 })}</span>
                          <span className="block text-meta text-muted">{TYPY_DD[p.ddType] ?? p.ddType}</span>
                        </td>
                        <td className="num hidden py-2.5 pr-3 text-right sm:table-cell">{money(p.dailyLossCents, { decimals: 0 })}</td>
                        <td className="num hidden py-2.5 pr-3 text-right sm:table-cell">{money(p.profitTargetCents, { decimals: 0 })}</td>
                        <td className="py-2.5 text-right">
                          <span className="num whitespace-nowrap text-muted">{p.ageDays} dni</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

async function WidokKsiegi() {
  const k = await ksiegaWszystkich();
  return (
    <>
      <div className="mt-8 flex flex-wrap items-end gap-x-14 gap-y-4">
        <div>
          <p className="text-karta text-muted">Zwrot netto</p>
          <LiczbaBohater tekst={money(k.nettoCents, { sign: true })} />
        </div>
        <div>
          <p className="text-meta text-muted">Koszty</p>
          <p className="num text-karta text-text">{money(k.kosztyCents)}</p>
        </div>
        <div>
          <p className="text-meta text-muted">Wypłaty i zwroty</p>
          <p className="num text-karta text-text">{money(k.wplywyCents)}</p>
        </div>
      </div>
      {k.wpisy.length === 0 ? (
        <PustyStan className="mt-8" tytul="Księga jest pusta." opis="Opłaty za evale, resety i wypłaty dopisujesz na ekranie konta; wtedy zobaczysz realny zwrot." akcja={{ href: "/prop", etykieta: "Wybierz konto" }} />
      ) : (
        <table className="mt-8 w-full text-karta">
          <thead>
            <tr className="border-b border-line text-left text-meta text-muted">
              <th className="py-2 pr-3 font-normal">Data</th>
              <th className="py-2 pr-3 font-normal">Opis</th>
              <th className="py-2 text-right font-normal">Kwota</th>
            </tr>
          </thead>
          <tbody>
            {k.wpisy.map((w) => (
              <tr key={w.id} className="border-b border-line">
                <td className="num py-3 pr-3 align-top text-muted">{shortDate(w.occurredOn)}</td>
                <td className="py-3 pr-3">
                  <Link href={`/prop/${w.accountId}`} className="przejscie text-text hover:underline">
                    {RODZAJE_KSIEGI[w.kind] ?? w.kind}
                  </Link>
                  <span className="block text-meta text-muted">
                    {w.konto}
                    {w.note ? ` · ${w.note}` : ""}
                  </span>
                </td>
                <td className={cx("num py-3 text-right align-top", pnlClass(w.amountCents))}>{money(w.amountCents, { sign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export default async function PropPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const sp = await searchParams;
  const widok = sp.widok === "presety" || sp.widok === "ksiega" ? sp.widok : "konta";
  return (
    <Strona>
      <NaglowekStrony tytul="Prop" podtytul="Ile zostało do limitów, ile kosztują evale, ile wraca w wypłatach." />
      <Zakladki aktywna={widok} />
      {widok === "konta" ? <WidokKont /> : widok === "presety" ? <WidokPresetow /> : <WidokKsiegi />}
    </Strona>
  );
}
