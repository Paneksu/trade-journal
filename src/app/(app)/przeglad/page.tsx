import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleDollarSign } from "lucide-react";

import { FormularzPrzegladu } from "@/components/etap3/formularze";
import { SlupkiR, type Slupek } from "@/components/etap3/slupki-r";
import { Markdown } from "@/components/trade/markdown";
import { Chip, ChipProcesu, LiczbaBohater, NaglowekStrony, Strona } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { dodajDni } from "@/lib/api-v2/przeglady";
import { longDate, money, monthName, percent, pnlClass, rValue, shortDate, tradesCount } from "@/lib/format";
import {
  domyslnyTydzien,
  poniedzialek,
  PROG_KOMORKI_N,
  przegladMiesiaca,
  przegladTygodnia,
  type KomorkaPodzialu,
  type PrzegladTygodniaUi,
  type TradePrzegladu,
} from "@/lib/queries/przeglad";

export const metadata = { title: "Przegląd — Dziennik tradingowy" };

/*
 * Przegląd tygodnia i miesiąca (UI v2, etap 3). Forma ze wzoru 5 (Mercury Insights, Refero 320c6124): przełącznik
 * widoków w segmencie, zakres dat po prawej, duża liczba + „średnio”, słupki z przerywaną linią średniej,
 * pod spodem trzy kolumny wniosków (trzecia na tle, jak wyróżniona karta wzoru). U nas kolumny to proces,
 * nie pieniądze: 3 najlepsze i 3 najgorsze trade'y wg PROCESU oraz koszt gry C i łamania reguł.
 * Marka: liczby w Plex Mono, R przed dolarami, „szkic AI” zawsze podpisany, akcent tylko na akcji.
 */

const DNI = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];
const ROZLICZENIE: Record<string, string> = { kept: "dotrzymane", partial: "częściowo", broken: "złamane" };

function Segment({ aktywny, tydzien, miesiac }: { aktywny: "tydzien" | "miesiac"; tydzien: string; miesiac: string }) {
  const k = (on: boolean) =>
    cx(
      "przejscie inline-flex h-8 items-center rounded-full px-3.5 text-karta focus-visible:outline-2 focus-visible:outline-offset-2",
      on ? "bg-surface-3 text-text" : "text-muted hover:text-text",
    );
  return (
    <nav aria-label="Zakres przeglądu" className="inline-flex rounded-full border border-line p-0.5">
      <Link href={`/przeglad?tydzien=${tydzien}`} aria-current={aktywny === "tydzien" ? "page" : undefined} className={k(aktywny === "tydzien")}>
        Tydzień
      </Link>
      <Link href={`/przeglad?widok=miesiac&miesiac=${miesiac}`} aria-current={aktywny === "miesiac" ? "page" : undefined} className={k(aktywny === "miesiac")}>
        Miesiąc
      </Link>
    </nav>
  );
}

function Zakres({ wstecz, dalej, tekst, etykieta }: { wstecz: string; dalej: string | null; tekst: string; etykieta: string }) {
  const p = "przejscie inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-line p-0.5" role="group" aria-label={etykieta}>
      <Link href={wstecz} className={p} aria-label="Poprzedni okres">
        <ChevronLeft className="size-4" aria-hidden />
      </Link>
      <span className="num px-1.5 text-karta text-text">{tekst}</span>
      {dalej ? (
        <Link href={dalej} className={p} aria-label="Następny okres">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className="inline-flex size-8 items-center justify-center text-line-strong" aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </div>
  );
}

function WierszTradu({ t }: { t: TradePrzegladu }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <Link href={`/trades/${t.id}`} className="przejscie -mx-2 flex min-h-11 items-center gap-3 rounded-[var(--radius-tab)] px-2 py-1.5 hover:bg-surface-2">
        <ChipProcesu ocena={t.proces} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-karta text-text">
            {t.symbol} {t.kierunek === "long" ? "long" : "short"}
          </span>
          <span className="block truncate text-meta text-muted">
            {t.dzien ? `${DNI[new Date(`${t.dzien}T12:00:00Z`).getUTCDay()]} ${shortDate(t.dzien)}` : ""}
            {t.setup ? ` · ${t.setup}` : ""}
          </span>
        </span>
        <span className={cx("num text-karta", pnlClass(t.r))}>{rValue(t.r)}</span>
      </Link>
    </li>
  );
}

function Kolumna({ ikona, tytul, children, wyrozniona }: { ikona: React.ReactNode; tytul: string; children: React.ReactNode; wyrozniona?: boolean }) {
  return (
    <section aria-label={tytul} className={cx("min-w-0 rounded-[var(--radius-panel)] p-4 sm:p-5", wyrozniona ? "bg-panel" : "")}>
      <h2 className="mb-2 flex items-center gap-2 text-karta font-medium text-text">
        {ikona}
        {tytul}
      </h2>
      {children}
    </section>
  );
}

function Siatka({ g }: { g: PrzegladTygodniaUi["metrics"]["grid"] }) {
  const komorka = (nazwa: string, opis: string, k: { count: number; sumR: number }, ton?: string) => (
    <div className={cx("min-h-24 rounded-[var(--radius-tab)] border border-line p-3", ton)}>
      <p className="text-meta text-muted">{nazwa}</p>
      <p className="num mt-1 text-sekcja text-text">{k.count}</p>
      <p className="num text-meta text-muted">
        {rValue(k.sumR)} · {opis}
      </p>
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-2">
        <span />
        <span className="text-center text-meta text-faint">wynik +</span>
        <span className="text-center text-meta text-faint">wynik −</span>
        <span className="self-center text-meta text-faint [writing-mode:vertical-rl] rotate-180">proces A/B</span>
        {komorka("Zasłużony zysk", "powtarzaj", g.goodProcessWin)}
        {komorka("Dobra strata", "nic do naprawy", g.goodProcessLoss)}
        <span className="self-center text-meta text-faint [writing-mode:vertical-rl] rotate-180">proces C</span>
        {komorka("Szczęście", "najgroźniejsze", g.badProcessWin, "border-dashed border-line-strong")}
        {komorka("Zasłużona strata", "lekcja", g.badProcessLoss, "border-dashed")}
      </div>
      {(g.breakEvenGoodProcess.count > 0 || g.breakEvenBadProcess.count > 0 || g.ungraded.count > 0) && (
        <p className="mt-2 text-meta text-muted">
          Poza siatką: BE {g.breakEvenGoodProcess.count + g.breakEvenBadProcess.count}, bez oceny procesu {g.ungraded.count}.
        </p>
      )}
    </div>
  );
}

function Rozklad({ g }: { g: PrzegladTygodniaUi["metrics"]["grid"] }) {
  return (
    <ul className="space-y-2.5">
      {(["A", "B", "C"] as const).map((o) => {
        const k = g.distribution[o];
        return (
          <li key={o} className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3">
            <ChipProcesu ocena={o} />
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <div className={cx("h-full rounded-full", o === "C" ? "bg-muted" : "bg-viz-8")} style={{ width: `${Math.round((k.share ?? 0) * 100)}%` }} />
            </div>
            <span className="num text-meta text-text">
              {k.count} · {percent(k.share, 0)} · {rValue(k.sumR)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

async function WidokTygodnia({ tydzien }: { tydzien: string }) {
  const d = await przegladTygodnia(tydzien);
  const m = d.metrics;
  const sumaR = d.dni.reduce((s, x) => s + x.sumaR, 0);
  const pnl = d.dni.reduce((s, x) => s + x.pnlCents, 0);
  const handlowe = d.dni.filter((x) => x.trades > 0);
  const srednia = handlowe.length > 0 ? sumaR / handlowe.length : null;
  const slupki: Slupek[] = d.dni.map((x) => {
    const dzien = DNI[new Date(`${x.dzien}T12:00:00Z`).getUTCDay()];
    return {
      klucz: x.dzien,
      etykieta: `${dzien} ${shortDate(x.dzien)}`,
      wartosc: x.sumaR,
      pusty: x.trades === 0,
      opis: `${dzien} ${shortDate(x.dzien)}: ${x.trades === 0 ? "bez handlu" : `${rValue(x.sumaR)}, ${tradesCount(x.trades)}`}`,
    };
  });
  const r = d.review;
  const kosztC = m.grid.costOfC;
  const kosztRegul = m.discipline.violationCost;
  const poprzednieZob = d.previousReview?.commitment?.text ?? null;

  return (
    <>
      <div className="mt-8 flex flex-wrap items-end gap-x-16 gap-y-4">
        <div>
          <p className="text-karta text-muted">Suma R tygodnia</p>
          <LiczbaBohater tekst={rValue(sumaR)} />
          <p className={cx("num text-meta", pnlClass(pnl))}>{money(pnl, { sign: true })}</p>
        </div>
        <div>
          <p className="text-karta text-muted">Średnio na dzień z handlem</p>
          <p className="num text-sekcja text-text">{rValue(srednia)}</p>
          <p className="text-meta text-muted">
            {tradesCount(m.trades)} w {handlowe.length} {handlowe.length === 1 ? "dniu" : "dniach"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {r?.status === "approved" ? <Chip>zatwierdzony {r.approvedAt ? shortDate(r.approvedAt.slice(0, 10)) : ""}</Chip> : r?.draftMd ? <Chip>szkic AI czeka</Chip> : <Chip>bez szkicu</Chip>}
        </div>
      </div>

      <div className="mt-6">
        <SlupkiR slupki={slupki} srednia={srednia} etykieta={`Wynik w R dzień po dniu, tydzień od ${shortDate(tydzien)}`} opisSredniej={`Średnia na dzień z handlem: ${rValue(srednia)}`} />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Kolumna ikona={<ArrowUpRight className="size-4 text-muted" aria-hidden />} tytul="Najlepszy proces">
          {d.najlepsze.length === 0 ? <p className="text-karta text-muted">Brak ocenionych trade&apos;ów.</p> : <ul>{d.najlepsze.map((t) => <WierszTradu key={t.id} t={t} />)}</ul>}
        </Kolumna>
        <Kolumna ikona={<ArrowDownRight className="size-4 text-muted" aria-hidden />} tytul="Najgorszy proces">
          {d.najgorsze.length === 0 ? <p className="text-karta text-muted">Brak ocenionych trade&apos;ów.</p> : <ul>{d.najgorsze.map((t) => <WierszTradu key={t.id} t={t} />)}</ul>}
        </Kolumna>
        <Kolumna ikona={<CircleDollarSign className="size-4 text-muted" aria-hidden />} tytul="Ile kosztowała gra poza planem" wyrozniona>
          <dl className="space-y-3">
            <div>
              <dt className="text-meta text-muted">Gra C ({tradesCount(kosztC.count)})</dt>
              <dd className="num text-sekcja text-text">
                {rValue(kosztC.sumR)} <span className={cx("text-meta", pnlClass(kosztC.sumPnlCents))}>{money(kosztC.sumPnlCents, { sign: true })}</span>
              </dd>
            </div>
            <div>
              <dt className="text-meta text-muted">Łamanie reguł ({tradesCount(kosztRegul.count)})</dt>
              <dd className="num text-sekcja text-text">
                {rValue(kosztRegul.sumR)} <span className={cx("text-meta", pnlClass(kosztRegul.sumPnlCents))}>{money(kosztRegul.sumPnlCents, { sign: true })}</span>
              </dd>
            </div>
          </dl>
          {m.discipline.violations.some((v) => v.count > 0) && (
            <ul className="mt-3 space-y-1 border-t border-line pt-2" aria-label="Złamane reguły">
              {m.discipline.violations.filter((v) => v.count > 0).map((v) => (
                <li key={v.code} className="flex justify-between gap-3 text-meta text-muted">
                  <span className="min-w-0">{v.title}</span>
                  <span className="num text-text">×{v.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Kolumna>
      </div>
      <p className="mt-3 text-meta text-faint">Najlepsze i najgorsze wg oceny procesu, nie wyniku. Liczby z {m.scope}.</p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <section aria-labelledby="siatka-h">
          <h2 id="siatka-h" className="mb-3 text-sekcja text-text">
            Proces × wynik
          </h2>
          <Siatka g={m.grid} />
        </section>
        <section aria-labelledby="rozklad-h">
          <h2 id="rozklad-h" className="mb-3 text-sekcja text-text">
            Rozkład ocen procesu
          </h2>
          <Rozklad g={m.grid} />
          <p className="num mt-4 text-meta text-muted">Udział A w dyscyplinie: {percent(m.discipline.shareA, 0)}</p>
        </section>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <section aria-labelledby="szkic-h" className="min-w-0">
          <h2 id="szkic-h" className="mb-3 flex items-center gap-2 text-sekcja text-text">
            Szkic przeglądu <Chip>szkic AI</Chip>
          </h2>
          {r?.draftMd ? (
            <div className="karta p-5">
              <Markdown>{r.draftMd}</Markdown>
              {r.asOf && <p className="mt-3 text-meta text-faint">Liczby szkicu z {longDate(r.asOf.slice(0, 10))}. Szkic może się mylić; wnioski piszesz Ty.</p>}
            </div>
          ) : (
            <p className="text-karta text-muted">AI nie przygotowało jeszcze szkicu (PUT /api/v2/reviews/weekly/{tydzien}). Przegląd możesz zatwierdzić i bez niego.</p>
          )}
        </section>
        <section aria-labelledby="zob-h" className="min-w-0">
          <h2 id="zob-h" className="mb-3 text-sekcja text-text">
            {r?.status === "approved" ? "Wnioski i zobowiązanie" : "Zatwierdzenie"}
          </h2>
          {r?.status === "approved" ? (
            <dl className="space-y-4">
              {r.prevCommitmentResult && (
                <div>
                  <dt className="text-meta text-muted">Poprzednie zobowiązanie: {ROZLICZENIE[r.prevCommitmentResult]}</dt>
                  {r.prevResult && <dd className="mt-1 text-karta text-text">{r.prevResult.text}</dd>}
                </div>
              )}
              <div>
                <dt className="text-meta text-muted">Wnioski</dt>
                <dd className="mt-1 whitespace-pre-line text-karta text-text">{r.conclusions?.text ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-meta text-muted">Zobowiązanie na następny tydzień</dt>
                <dd className="mt-1 border-l-2 border-accent pl-3 text-karta text-text">{r.commitment?.text ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <FormularzPrzegladu weekStart={tydzien} poprzednie={d.commitmentToSettle ? poprzednieZob : null} />
          )}
        </section>
      </div>
    </>
  );
}

function Podzial({ tytul, komorki }: { tytul: string; komorki: KomorkaPodzialu[] }) {
  return (
    <section aria-label={tytul} className="min-w-0">
      <h2 className="mb-2 text-karta font-medium text-text">{tytul}</h2>
      <div className="mb-1 h-1 rounded-full bg-surface-3" aria-hidden />
      {komorki.length === 0 ? (
        <p className="py-3 text-meta text-muted">Brak trade&apos;ów z R.</p>
      ) : (
        <ul>
          {komorki.map((k) => (
            <li key={k.klucz} className={cx("flex min-h-10 items-center gap-3 border-b border-line text-karta", k.malo ? "text-faint" : "text-text")} title={k.malo ? `n=${k.n} < ${PROG_KOMORKI_N}: za mało, żeby wnioskować` : undefined}>
              <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", k.malo ? "border border-line-strong" : "bg-muted")} />
              <span className="min-w-0 flex-1 truncate">{k.etykieta}</span>
              <span className="num w-12 text-right text-meta">n={k.n}</span>
              <span className={cx("num w-16 text-right", !k.malo && pnlClass(k.sumaR))}>{rValue(k.sumaR)}</span>
              <span className="num hidden w-24 text-right text-meta sm:inline">{k.winRate?.p != null ? percent(k.winRate.p, 0) : "—"}</span>
              {k.malo && <span className="sr-only">(za mało danych)</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function WidokMiesiaca({ miesiac }: { miesiac: string }) {
  const d = await przegladMiesiaca(miesiac);
  const dni = d.dni.length;
  const srednia = dni > 0 ? d.sumaR / dni : null;
  const slupki: Slupek[] = d.dni.map((x) => ({ klucz: x.dzien, etykieta: shortDate(x.dzien), wartosc: x.sumaR, opis: `${shortDate(x.dzien)}: ${rValue(x.sumaR)}, ${tradesCount(x.trades)}` }));
  return (
    <>
      <div className="mt-8 flex flex-wrap items-end gap-x-16 gap-y-4">
        <div>
          <p className="text-karta text-muted">Suma R miesiąca</p>
          <LiczbaBohater tekst={rValue(d.sumaR)} />
          <p className={cx("num text-meta", pnlClass(d.pnlCents))}>{money(d.pnlCents, { sign: true })}</p>
        </div>
        <div>
          <p className="text-karta text-muted">Średnio na dzień z handlem</p>
          <p className="num text-sekcja text-text">{rValue(srednia)}</p>
          <p className="text-meta text-muted">
            {tradesCount(d.trades)} w {dni} dniach{d.bezR > 0 ? `; ${d.bezR} bez R poza podziałami` : ""}
          </p>
        </div>
      </div>
      <div className="mt-6">
        {slupki.length === 0 ? (
          <p className="text-karta text-muted">Brak zamkniętych trade&apos;ów w tym miesiącu.</p>
        ) : (
          <SlupkiR slupki={slupki} srednia={srednia} etykieta={`Wynik w R dzień po dniu, ${monthName(miesiac)}`} opisSredniej={`Średnia na dzień z handlem: ${rValue(srednia)}`} />
        )}
      </div>
      <p className="mt-8 text-meta text-muted">
        Komórki z n &lt; {PROG_KOMORKI_N} są wyszarzone: za mało trade&apos;ów, żeby z nich wnioskować. Ostatnia kolumna to odsetek wygranych.
      </p>
      <div className="mt-4 grid gap-x-8 gap-y-8 md:grid-cols-2">
        {d.podzialy.map((p) => (
          <Podzial key={p.klucz} tytul={p.tytul} komorki={p.komorki} />
        ))}
      </div>
    </>
  );
}

export default async function PrzegladPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const sp = await searchParams;
  const widok = sp.widok === "miesiac" ? "miesiac" : "tydzien";
  const podanyTydzien = typeof sp.tydzien === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.tydzien) ? poniedzialek(sp.tydzien) : null;
  const tydzien = podanyTydzien ?? (await domyslnyTydzien());
  const miesiac = typeof sp.miesiac === "string" && /^\d{4}-\d{2}$/.test(sp.miesiac) ? sp.miesiac : tydzien.slice(0, 7);
  const dzisTydzien = poniedzialek(new Date().toISOString().slice(0, 10));

  const [rr, mm] = miesiac.split("-").map(Number);
  const mies = (d: number) => {
    const x = new Date(Date.UTC(rr, mm - 1 + d, 1));
    return x.toISOString().slice(0, 7);
  };
  const zakres =
    widok === "tydzien"
      ? {
          wstecz: `/przeglad?tydzien=${dodajDni(tydzien, -7)}`,
          dalej: tydzien < dzisTydzien ? `/przeglad?tydzien=${dodajDni(tydzien, 7)}` : null,
          tekst: `${shortDate(tydzien)} – ${shortDate(dodajDni(tydzien, 6))}`,
        }
      : {
          wstecz: `/przeglad?widok=miesiac&miesiac=${mies(-1)}`,
          dalej: miesiac < dzisTydzien.slice(0, 7) ? `/przeglad?widok=miesiac&miesiac=${mies(1)}` : null,
          tekst: monthName(miesiac),
        };

  return (
    <Strona>
      <NaglowekStrony tytul="Przegląd" podtytul="Proces przed wynikiem: co powtarzać, co kosztowało, jedno zobowiązanie." />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <Segment aktywny={widok} tydzien={tydzien} miesiac={miesiac} />
        <Zakres {...zakres} etykieta={widok === "tydzien" ? "Wybór tygodnia" : "Wybór miesiąca"} />
      </div>
      {widok === "tydzien" ? <WidokTygodnia tydzien={tydzien} /> : <WidokMiesiaca miesiac={miesiac} />}
    </Strona>
  );
}
