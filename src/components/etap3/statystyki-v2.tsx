import Link from "next/link";

import { cx } from "@/lib/classes";
import { percent, rValue, shortDate } from "@/lib/format";
import type { StatystykaZrodla } from "@/lib/api-v2/statystyki";
import type { StatystykiV2 } from "@/lib/queries/statystyki-v2";

/*
 * Statystyki UI v2 (etap 3). Forma ze wzoru 10 (Missive Analytics, Refero 1c47a246): rząd trzech kafli w jednej
 * ramie z pionowymi podziałkami (liczba + jedna linia porównania pod spodem), dwa szerokie kafle z wykresem
 * liniowym i liczbą pod nim, trzy kolumny rozkładów z kropką, etykietą i liczbą po prawej. U nas pod każdą liczbą
 * n i przedział 95% zamiast „Yesterday”. Marka: Plex Mono, linia stalowa (viz-8), akcent tylko przy „obiecujący”.
 */

const ZRODLA: Record<string, string> = { backtest: "Backtest", forward: "Forward", demo: "Demo", live: "Live" };

function Linia({ wartosci, etykieta, zero = true }: { wartosci: (number | null)[]; etykieta: string; zero?: boolean }) {
  const W = 400;
  const H = 72;
  const liczby = wartosci.filter((v): v is number => v !== null);
  if (liczby.length < 2) return <div className="flex h-[72px] items-center text-meta text-faint">Za mało punktów na wykres.</div>;
  const min = Math.min(...liczby, ...(zero ? [0] : []));
  const max = Math.max(...liczby, ...(zero ? [0] : []));
  const zakres = max - min || 1;
  const x = (i: number) => (i / (wartosci.length - 1)) * W;
  const y = (v: number) => 4 + (1 - (v - min) / zakres) * (H - 8);
  let d = "";
  wartosci.forEach((v, i) => {
    if (v === null) return;
    d += `${d === "" || wartosci[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[72px] w-full" role="img" aria-label={etykieta}>
      {zero && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke="var(--color-viz-8)" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kafel({ tytul, wartosc, pod, ton }: { tytul: string; wartosc: string; pod: React.ReactNode; ton?: string }) {
  return (
    <div className="min-w-0 p-5">
      <p className="text-karta text-text">{tytul}</p>
      <p className={cx("num mt-3 text-liczba font-medium", ton ?? "text-text")}>{wartosc}</p>
      <p className="num mt-1 text-meta text-muted">{pod}</p>
    </div>
  );
}

function przedzial(lo: number | null, hi: number | null, f: (v: number) => string) {
  return lo === null || hi === null ? "przedział: za mało danych" : `95%: ${f(lo)} … ${f(hi)}`;
}

export function KafleStatystyk({ s }: { s: StatystykaZrodla }) {
  const wr = s.winRate;
  const e = s.expectancyR;
  const be = s.breakEvenWinRate;
  const nad = wr.p !== null && be !== null ? wr.p - be : null;
  return (
    <div className="karta grid divide-line max-md:divide-y md:grid-cols-3 md:divide-x" data-kafle-v2>
      <Kafel tytul="Win rate" wartosc={percent(wr.p, 0)} pod={<>n={s.n} · {przedzial(wr.low, wr.high, (v) => percent(v, 0))}</>} />
      <Kafel
        tytul="Oczekiwane R na trade"
        wartosc={rValue(e.mean)}
        pod={
          <>
            {przedzial(e.low, e.high, (v) => rValue(v))}
            {e.orientacyjnie && <span className="ml-1 text-text">· orientacyjnie (n&lt;30)</span>}
          </>
        }
      />
      <Kafel
        tytul="Względem break-even"
        wartosc={nad === null ? "—" : `${nad >= 0 ? "+" : "−"}${Math.abs(nad * 100).toFixed(0)} pp`}
        pod={
          <>
            próg {percent(be, 0)} z Twoich średnich · <span className="text-text">{s.statusNazwa}</span>
          </>
        }
      />
    </div>
  );
}

/** Długi tytuł skracany w kodzie do ok. 2 linii kolumny (bez przycinania CSS, które bramka liczy jako ucięty tekst); pełna treść w podpowiedzi i pod linkiem. */
function skroc(t: string, max = 58): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 12)).trimEnd()}…`;
}

function Lista({ tytul, children, stopka }: { tytul: string; children: React.ReactNode; stopka?: React.ReactNode }) {
  return (
    <section aria-label={tytul} className="min-w-0">
      <h3 className="mb-2 text-karta font-medium text-text">{tytul}</h3>
      <div className="mb-1 h-1 rounded-full bg-surface-3" aria-hidden />
      <ul>{children}</ul>
      {stopka && <div className="mt-2 text-meta text-muted">{stopka}</div>}
    </section>
  );
}

function Wiersz({ etykieta, pelna, wartosc, opis, href, slaby, kropka, slowo }: { etykieta: string; pelna?: string; wartosc: string; opis?: string; href?: string; slaby?: boolean; kropka?: string; slowo?: boolean }) {
  const tresc = (
    <>
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", kropka ?? "bg-muted")} />
      <span className="min-w-0 flex-1 py-2" title={pelna}>
        {pelna && pelna !== etykieta ? (
          <>
            <span aria-hidden>{etykieta}</span>
            <span className="sr-only">{pelna}</span>
          </>
        ) : (
          etykieta
        )}
      </span>
      {opis && <span className="num text-meta text-muted">{opis}</span>}
      <span className={slowo ? "text-meta whitespace-nowrap" : "num w-16 text-right"}>{wartosc}</span>
    </>
  );
  const k = cx("flex min-h-10 items-center gap-3 border-b border-line text-karta", slaby ? "text-muted" : "text-text");
  return <li>{href ? <Link href={href} className={cx(k, "przejscie hover:bg-panel")}>{tresc}</Link> : <div className={k}>{tresc}</div>}</li>;
}

export function SekcjaStatystykV2({ v2, krzywaR, sumaR }: { v2: StatystykiV2; krzywaR: number[]; sumaR: number }) {
  const dysc = v2.dyscyplina;
  const ostatnia = [...dysc].reverse().find((d) => d.udzialA !== null) ?? null;
  const btl = v2.zrodla.backtestToLive;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="karta p-5" aria-label="Krzywa R">
          <p className="text-karta text-text">Krzywa R</p>
          <div className="mt-4">
            <Linia wartosci={krzywaR} etykieta={`Skumulowane R z ${krzywaR.length} trade'ów`} />
          </div>
          <p className="mt-3 text-meta text-muted">Suma</p>
          <p className="num text-sekcja text-text">
            {rValue(sumaR)} <span className="text-meta text-muted">n={krzywaR.length}</span>
          </p>
        </section>
        <section className="karta p-5" aria-label="Dyscyplina">
          <p className="text-karta text-text">Dyscyplina: udział oceny A</p>
          <div className="mt-4">
            <Linia wartosci={dysc.map((d) => d.udzialA)} etykieta="Udział oceny A w ocenionych trade'ach, 12 tygodni" zero={false} />
          </div>
          <p className="mt-3 text-meta text-muted">{ostatnia ? `Tydzień od ${shortDate(ostatnia.tydzien)}` : "Ostatni tydzień"}</p>
          <p className="num text-sekcja text-text">
            {percent(ostatnia?.udzialA ?? null, 0)} <span className="text-meta text-muted">n={ostatnia?.ocenione ?? 0}</span>
          </p>
        </section>
      </div>

      <div className="karta grid gap-8 p-5 md:grid-cols-3">
        <Lista
          tytul="Źródła danych (oczekiwane R)"
          stopka={btl ? <>Między backtestem a live znika <span className="num text-text">{rValue(btl.diffR, false)}</span> na trade{btl.orientacyjnie ? " (orientacyjnie)" : ""}.</> : "„Ile R znika”: potrzebny backtest i live."}
        >
          {(["backtest", "forward", "demo", "live"] as const).map((z) => {
            const s = v2.zrodla.bySource[z];
            return <Wiersz key={z} etykieta={ZRODLA[z]} opis={`n=${s?.n ?? 0}`} wartosc={s ? rValue(s.expectancyR.mean) : "—"} slaby={!s || s.expectancyR.orientacyjnie} />;
          })}
        </Lista>
        <Lista tytul="Setupy (status)">
          {v2.setupy.length === 0 ? (
            <li className="py-2 text-meta text-muted">Brak setupów.</li>
          ) : (
            v2.setupy.map((s) => (
              <Wiersz key={s.slug} href={`/playbook/${s.slug}`} etykieta={s.nazwa} opis={`n=${s.n}`} wartosc={s.status} kropka={s.statusKod === "obiecujacy" || s.statusKod === "potwierdzony" ? "bg-accent" : "bg-muted"} slaby={s.n < 20} slowo />
            ))
          )}
        </Lista>
        <Lista tytul="Hipotezy (zebrane / próg)" stopka={v2.warianty ? v2.warianty.tekst : "Żadnych testowanych wariantów."}>
          {v2.hipotezy.length === 0 ? (
            <li className="py-2 text-meta text-muted">Brak hipotez.</li>
          ) : (
            v2.hipotezy.slice(0, 6).map((h) => <Wiersz key={h.id} href={h.noteId ? `/mozg/notatki/${h.noteId}` : undefined} etykieta={skroc(`${h.kod} ${h.tytul}`)} pelna={`${h.kod} ${h.tytul}`} opis={h.warianty > 0 ? `${h.warianty} war.` : undefined} wartosc={`${h.n}/${h.progN}`} slaby={h.n < h.progN} />)
          )}
        </Lista>
      </div>
    </div>
  );
}
