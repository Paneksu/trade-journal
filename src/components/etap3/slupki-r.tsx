import { cx } from "@/lib/classes";
import { rValue } from "@/lib/format";

/**
 * Słupki R per dzień z linią średniej (wzór 5, Mercury Insights: słupki miesięcy, przerywana linia
 * „$477K avg.” z etykietą w pigułce przy osi, kropkowana siatka). Bez JS: HTML + CSS, etykiety
 * nie skalują się z wykresem. Barwa stalowa (viz-8), bo akcent jest dla akcji, a zieleń i czerwień
 * dla wyniku pojedynczego trade'a; słupek ujemny ma tę samą barwę z ramką przerywaną.
 */
export type Slupek = { klucz: string; etykieta: string; wartosc: number; opis: string; pusty?: boolean };

function ladnyKrok(zakres: number): number {
  const surowy = zakres / 4;
  const potega = 10 ** Math.floor(Math.log10(surowy));
  const n = surowy / potega;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * potega;
}

export function SlupkiR({ slupki, srednia, opisSredniej, etykieta }: { slupki: Slupek[]; srednia: number | null; opisSredniej: string; etykieta: string }) {
  const wartosci = [0, ...slupki.map((s) => s.wartosc), ...(srednia === null ? [] : [srednia])];
  const krok = ladnyKrok(Math.max(Math.max(...wartosci) - Math.min(...wartosci), 1));
  const gora = Math.max(krok, Math.ceil(Math.max(...wartosci) / krok) * krok);
  const dol = Math.min(0, Math.floor(Math.min(...wartosci) / krok) * krok);
  const zakres = gora - dol;
  const y = (v: number) => ((gora - v) / zakres) * 100;
  const linie: number[] = [];
  for (let v = dol; v <= gora + 1e-9; v += krok) linie.push(Number(v.toFixed(6)));
  const gesto = slupki.length > 12;
  // Etykiety osi: przy 375 najwyżej ok. 5, przy 1440 najwyżej ok. 12 (reszta niewidoczna, słupki zostają).
  const coMob = Math.max(1, Math.ceil(slupki.length / 5));
  const coDesk = Math.max(1, Math.ceil(slupki.length / 12));

  return (
    <figure className="m-0" aria-label={etykieta}>
      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2">
        <div className="relative h-[180px] sm:h-[240px]" aria-hidden>
          {linie.map((v) => (
            <span key={v} className="num absolute right-0 -translate-y-1/2 text-meta text-faint" style={{ top: `${y(v)}%` }}>
              {v === 0 ? "0" : rValue(v, true).replace(".00", "")}
            </span>
          ))}
          {srednia !== null && (
            <span className="num absolute right-0 z-10 -translate-y-1/2 rounded-[var(--radius-tab)] border border-line-strong bg-tresc px-1 text-meta leading-5 text-text" style={{ top: `${y(srednia)}%` }}>
              {rValue(srednia)}
            </span>
          )}
        </div>
        <div className="relative h-[180px] sm:h-[240px]">
          {linie.map((v) => (
            <div
              key={v}
              aria-hidden
              className={cx("absolute inset-x-0 border-t", v === 0 ? "border-line-strong" : "border-dotted border-line")}
              style={{ top: `${y(v)}%` }}
            />
          ))}
          <ol className={cx("absolute inset-0 flex items-stretch", gesto ? "gap-0.5 sm:gap-1" : "gap-3 sm:gap-6")}>
            {slupki.map((s) => {
              const a = y(Math.max(0, s.wartosc));
              const b = y(Math.min(0, s.wartosc));
              return (
                <li key={s.klucz} className="relative flex-1">
                  <span className="sr-only">{s.opis}</span>
                  {!s.pusty && (
                    <div
                      aria-hidden
                      title={s.opis}
                      className={cx(
                        "absolute inset-x-[12%] rounded-[3px]",
                        s.wartosc >= 0
                          ? "bg-[linear-gradient(180deg,var(--color-viz-8)_0%,color-mix(in_oklab,var(--color-viz-8)_35%,transparent)_100%)]"
                          : "border border-dashed border-viz-8 bg-[color-mix(in_oklab,var(--color-viz-8)_18%,transparent)]",
                      )}
                      style={{ top: `${a}%`, height: `max(${b - a}%, 2px)` }}
                    />
                  )}
                </li>
              );
            })}
          </ol>
          {srednia !== null && (
            <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted" style={{ top: `${y(srednia)}%` }}>
              <span className="absolute right-0 -top-5 text-meta text-muted">średnia</span>
            </div>
          )}
        </div>
        <div />
        <ol aria-hidden className={cx("mt-2 flex", gesto ? "gap-0.5 sm:gap-1" : "gap-3 sm:gap-6")}>
          {slupki.map((s, i) => (
            <li key={s.klucz} className={cx("num flex min-w-0 flex-1 justify-center text-meta whitespace-nowrap text-muted", i % coMob !== 0 && "max-sm:invisible", i % coDesk !== 0 && "sm:invisible", i === 0 && "justify-start", i === slupki.length - 1 && "justify-end")}>
              <span>{s.etykieta}</span>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="sr-only">{opisSredniej}</figcaption>
    </figure>
  );
}
