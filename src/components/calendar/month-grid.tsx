import Link from "next/link";

import { cx } from "@/lib/classes";
import { moneyShort, rValue } from "@/lib/format";

/**
 * Miesiąc jako siatka (UI v2, etap 4, wzór 11: Missive Calendar, Refero dca15c76). Forma ze wzoru: siatka 7 kolumn
 * z liniami 1 px bez odstępów, numer dnia u góry na środku, kolumny weekendu o stopień ciemniejsze, dni spoza
 * miesiąca przygaszone, dziś w kółku (u nas akcent zamiast czerwieni wzoru: czerwień = strata, ledger kierunek.md).
 * W komórce zamiast wydarzeń: wynik dnia (R domyślnie), liczba trade'ów, „bez transakcji” z powodem, kropka notatki
 * i kropka nie wziętego setupu. Tydzień od poniedziałku.
 */

export type DayResult = { day: string; pnl: number; count: number; r: number };

/** Dzień świadomie odpuszczony: bez wyniku, ale z zapisem. */
export type NoTradeDay = { day: string; reason: string | null };

const NAGLOWKI = [
  ["Pn", "Poniedziałek"],
  ["Wt", "Wtorek"],
  ["Śr", "Środa"],
  ["Cz", "Czwartek"],
  ["Pt", "Piątek"],
  ["Sb", "Sobota"],
  ["Nd", "Niedziela"],
] as const;

function dniMiesiaca(month: string): string[] {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Poniedziałek = 0, niedziela = 6. */
function dzienTygodnia(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function przesun(day: string, dni: number): string {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + dni * 86_400_000).toISOString().slice(0, 10);
}

/** Krótki zapis R na telefon: „+1.2”, „−0.6” (jednostka w nagłówku siatki). */
function rKrotko(r: number): string {
  const t = Math.abs(r).toFixed(1);
  return r > 0 ? `+${t}` : r < 0 ? `−${t}` : "0.0";
}

export function MonthGrid({
  month,
  days,
  noTradeDays = [],
  missedDays = [],
  noteDays = [],
  currency,
  unit = "r",
  linkBase = "/calendar",
  linkDnia,
  today,
  selected,
}: {
  month: string;
  days: DayResult[];
  noTradeDays?: NoTradeDay[];
  /** Dni, na których leży trade `missed` (setup był, nie wzięto go). */
  missedDays?: string[];
  /** Dni z notatką dnia (kropka jak znacznik wydarzenia we wzorze). */
  noteDays?: string[];
  currency: string;
  unit?: "cash" | "r";
  linkBase?: string;
  /** Własny adres kafla. Kalendarz sesji backtestu prowadzi do STRONY dnia, a nie do `?dzien=` (2026-08-29). */
  linkDnia?: (day: string) => string;
  today?: string;
  selected?: string | null;
}) {
  const wynik = new Map(days.map((d) => [d.day, d]));
  const pauzy = new Map(noTradeDays.map((d) => [d.day, d]));
  const pominiete = new Set(missedDays);
  const notatki = new Set(noteDays);
  const wszystkie = dniMiesiaca(month);
  const przed = wszystkie.length ? dzienTygodnia(wszystkie[0]) : 0;
  const po = (7 - ((przed + wszystkie.length) % 7)) % 7;
  const komorki = [
    ...Array.from({ length: przed }, (_, i) => ({ day: przesun(wszystkie[0], i - przed), obcy: true })),
    ...wszystkie.map((day) => ({ day, obcy: false })),
    ...Array.from({ length: po }, (_, i) => ({ day: przesun(wszystkie[wszystkie.length - 1], i + 1), obcy: true })),
  ];

  return (
    <div className="border-t border-l border-line" data-siatka-miesiaca>
      <div className="grid grid-cols-7" aria-hidden>
        {NAGLOWKI.map(([k, pelna], i) => (
          <div key={k} title={pelna} className={cx("border-r border-b border-line py-1.5 text-center text-meta text-muted", i >= 5 && "bg-bg/40")}>
            {k}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {komorki.map(({ day, obcy }) => {
          const kolumna = dzienTygodnia(day);
          const weekend = kolumna >= 5;
          const numer = Number(day.slice(-2));
          const dzis = day === today;
          if (obcy) {
            return (
              <div key={day} aria-hidden className={cx("min-h-14 border-r border-b border-line p-1 text-center sm:min-h-28", weekend && "bg-bg/40")}>
                <span className="num text-meta text-faint">{numer}</span>
              </div>
            );
          }
          const r = wynik.get(day);
          const pauza = r ? undefined : pauzy.get(day);
          const missed = pominiete.has(day);
          const notatka = notatki.has(day);
          const wartosc = r ? (unit === "cash" ? r.pnl : r.r) : 0;
          const opis =
            [
              pauza ? (pauza.reason ? `Dzień bez transakcji: ${pauza.reason.toLowerCase()}` : "Dzień bez transakcji") : null,
              missed ? "1 trade nie wzięty" : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined;
          return (
            <Link
              key={day}
              href={linkDnia ? linkDnia(day) : `${linkBase}?dzien=${day}`}
              title={opis}
              aria-current={selected === day ? "date" : undefined}
              className={cx(
                "przejscie relative flex min-h-14 flex-col items-center gap-0.5 border-r border-b border-line px-0.5 pt-1 pb-1.5 hover:bg-surface-2 sm:min-h-28 sm:px-1.5",
                "focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2",
                weekend && "bg-bg/40",
                selected === day && "bg-surface-2 ring-1 ring-inset ring-line-strong",
              )}
            >
              <span
                className={cx(
                  "num inline-flex size-6 items-center justify-center rounded-full text-meta",
                  dzis ? "bg-accent font-medium text-bg" : r || pauza ? "text-text" : "text-muted",
                )}
              >
                {numer}
                {dzis && <span className="sr-only"> (dziś)</span>}
              </span>
              {r && (
                <>
                  <span className={cx("num text-meta leading-tight font-medium whitespace-nowrap", wartosc > 0 ? "text-profit" : wartosc < 0 ? "text-loss" : "text-muted")}>
                    <span className="sm:hidden">{unit === "cash" ? moneyShort(r.pnl, currency) : rKrotko(r.r)}</span>
                    <span className="hidden sm:inline">{unit === "cash" ? moneyShort(r.pnl, currency) : rValue(r.r)}</span>
                  </span>
                  <span className="num text-meta leading-tight text-muted">
                    {r.count}
                    <span className="hidden sm:inline"> {r.count === 1 ? "trade" : "trade'y"}</span>
                    <span className="sr-only sm:hidden"> trade</span>
                  </span>
                </>
              )}
              {pauza && (
                <>
                  <span className="text-meta leading-tight text-muted sm:hidden">pauza</span>
                  <span className="hidden text-center text-meta leading-tight text-muted sm:block">bez transakcji</span>
                  {pauza.reason && <span className="hidden text-center text-meta leading-tight text-faint sm:block">{pauza.reason}</span>}
                </>
              )}
              {(notatka || missed) && (
                <span className="mt-auto flex items-center gap-1" aria-hidden>
                  {notatka && <span className="size-1.5 rounded-full bg-muted" />}
                  {missed && <span className="size-1.5 rounded-full border border-accent" />}
                </span>
              )}
              {notatka && <span className="sr-only">notatka dnia</span>}
              {missed && <span className="sr-only">1 trade nie wzięty</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
