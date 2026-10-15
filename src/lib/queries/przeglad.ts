import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { backtestSessions, instruments, setups, trades, weeklyReviews } from "@/lib/db/schema";
import { timeParts } from "@/lib/domain/calc";
import { wilson } from "@/lib/domain/stats-ci";
import { dodajDni, odczytajPrzeglad } from "@/lib/api-v2/przeglady";
import { dzienHandlowyTeraz } from "@/lib/api-v2/prop-konta";
import { ukryteTrady } from "@/lib/api-v2/ukrycie-wyniku";

/**
 * Przegląd tygodnia i miesiąca (UI v2, etap 3, wzór 5: Mercury Insights). Liczby tygodnia z tej samej funkcji
 * co `GET /api/v2/reviews/weekly/:weekStart` (`odczytajPrzeglad`); tutaj tylko dane do wykresu dni,
 * szczegóły 3 najlepszych i 3 najgorszych oraz podziały miesiąca.
 */

/** Poniedziałek tygodnia, w którym leży `dzien` (ISO). */
export function poniedzialek(dzien: string): string {
  const d = new Date(`${dzien}T00:00:00Z`).getUTCDay();
  return dodajDni(dzien, -((d + 6) % 7));
}

/** Zakres handlu: zamknięte, bez sesji backtestu (dni replayu są historyczne), jak w `metrykiTygodnia`. */
function warunekZakresu(od: string, do_: string) {
  return and(
    eq(trades.status, "closed"),
    gte(trades.tradingDay, od),
    lte(trades.tradingDay, do_),
    or(isNull(trades.backtestSessionId), sql`${backtestSessions.kind} <> 'backtest'`),
  );
}

/** Domyślny tydzień: najnowszy szkic AI czekający na zatwierdzenie; bez niego ostatni tydzień z handlem (najwyżej bieżący). */
export async function domyslnyTydzien(): Promise<string> {
  const dzis = poniedzialek(dzienHandlowyTeraz());
  const [szkic] = await db
    .select({ w: weeklyReviews.weekStart })
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.status, "draft"), lte(weeklyReviews.weekStart, dzis), gte(weeklyReviews.weekStart, dodajDni(dzis, -21))))
    .orderBy(desc(weeklyReviews.weekStart))
    .limit(1);
  if (szkic) return szkic.w;
  const [ostatni] = await db
    .select({ dzien: trades.tradingDay })
    .from(trades)
    .leftJoin(backtestSessions, eq(trades.backtestSessionId, backtestSessions.id))
    .where(and(eq(trades.status, "closed"), or(isNull(trades.backtestSessionId), sql`${backtestSessions.kind} <> 'backtest'`)))
    .orderBy(desc(trades.tradingDay))
    .limit(1);
  if (!ostatni?.dzien) return dzis;
  const t = poniedzialek(ostatni.dzien);
  return t > dzis ? dzis : t;
}

export type TradePrzegladu = {
  id: number;
  dzien: string | null;
  symbol: string;
  kierunek: "long" | "short";
  proces: "A" | "B" | "C" | null;
  r: number | null;
  pnlCents: number;
  setup: string | null;
};

async function tradeyPoId(ids: number[]): Promise<Map<number, TradePrzegladu>> {
  if (ids.length === 0) return new Map();
  const [wiersze, ukryte] = await Promise.all([
    db
      .select({
        id: trades.id,
        dzien: trades.tradingDay,
        symbol: instruments.symbol,
        kierunek: trades.direction,
        proces: trades.processGrade,
        r: trades.rMultiple,
        pnl: trades.pnl,
        setup: setups.name,
      })
      .from(trades)
      .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
      .leftJoin(setups, eq(trades.setupId, setups.id))
      .where(inArray(trades.id, ids)),
    ukryteTrady(db, ids),
  ]);
  return new Map(
    wiersze
      .filter((w) => !ukryte.has(w.id))
      .map((w) => [
        w.id,
        {
          id: w.id,
          dzien: w.dzien,
          symbol: w.symbol,
          kierunek: w.kierunek as "long" | "short",
          proces: (w.proces ?? null) as TradePrzegladu["proces"],
          r: w.r === null ? null : Number(w.r),
          pnlCents: Number(w.pnl ?? 0),
          setup: w.setup ?? null,
        },
      ]),
  );
}

export type DzienPrzegladu = { dzien: string; sumaR: number; pnlCents: number; trades: number };

async function dniZakresu(od: string, do_: string): Promise<DzienPrzegladu[]> {
  const wiersze = await db
    .select({ dzien: trades.tradingDay, sumaR: sql<string>`coalesce(sum(${trades.rMultiple}), 0)`, pnl: sql<string>`coalesce(sum(${trades.pnl}), 0)`, n: sql<number>`count(*)::int` })
    .from(trades)
    .leftJoin(backtestSessions, eq(trades.backtestSessionId, backtestSessions.id))
    .where(warunekZakresu(od, do_))
    .groupBy(trades.tradingDay)
    .orderBy(asc(trades.tradingDay));
  return wiersze.filter((w) => w.dzien).map((w) => ({ dzien: w.dzien!, sumaR: Number(w.sumaR), pnlCents: Number(w.pnl), trades: w.n }));
}

export async function przegladTygodnia(weekStart: string) {
  const dane = await odczytajPrzeglad(db, weekStart);
  const m = dane.metrics;
  const ids = [...m.bestAndWorst.best, ...m.bestAndWorst.worst];
  const [szczegoly, dni] = await Promise.all([tradeyPoId(ids), dniZakresu(weekStart, m.weekEnd)]);
  // Pięć dni handlowych tygodnia zawsze na osi (wzór: stałe miesiące na osi, pusty słupek to też informacja).
  const poDniu = new Map(dni.map((d) => [d.dzien, d]));
  const os = [0, 1, 2, 3, 4].map((i) => {
    const dzien = dodajDni(weekStart, i);
    return poDniu.get(dzien) ?? { dzien, sumaR: 0, pnlCents: 0, trades: 0 };
  });
  const weekend = dni.filter((d) => d.dzien > dodajDni(weekStart, 4));
  return {
    ...dane,
    dni: [...os, ...weekend],
    najlepsze: m.bestAndWorst.best.map((id) => szczegoly.get(id)).filter((t): t is TradePrzegladu => !!t),
    najgorsze: m.bestAndWorst.worst.map((id) => szczegoly.get(id)).filter((t): t is TradePrzegladu => !!t),
  };
}

export type PrzegladTygodniaUi = Awaited<ReturnType<typeof przegladTygodnia>>;

/* --- Miesiąc ------------------------------------------------------------------------------- */

/** Komórki z mniejszą liczbą trade'ów są wyszarzone: za mało, żeby z nich wnioskować (próg z MUST, n < 20). */
export const PROG_KOMORKI_N = 20;

export type KomorkaPodzialu = {
  klucz: string;
  etykieta: string;
  n: number;
  sumaR: number;
  sredniaR: number | null;
  winRate: { p: number | null; low: number | null; high: number | null } | null;
  malo: boolean;
};

const DNI_TYGODNIA = ["Niedziela", "Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota"];
const START_SESJI = 9 * 60 + 30;
const KONIEC_SESJI = 16 * 60;

function hhmm(min: number) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** Okno 30 min od otwarcia NY (9:30) w czasie Nowego Jorku; poza sesją RTH osobno. */
function oknoWejscia(entry: Date): { klucz: string; etykieta: string; kolejnosc: number } {
  const t = timeParts(entry, "America/New_York");
  const min = t.hour * 60 + t.minute;
  if (min < START_SESJI || min >= KONIEC_SESJI) return { klucz: "poza", etykieta: "Poza sesją RTH", kolejnosc: 999 };
  const k = Math.floor((min - START_SESJI) / 30);
  const od = START_SESJI + k * 30;
  return { klucz: `o${k}`, etykieta: `${hhmm(od)}–${hhmm(od + 30)}`, kolejnosc: k };
}

function zbuduj(grupy: Map<string, { etykieta: string; kolejnosc: number; r: number[]; wygrane: number }>): KomorkaPodzialu[] {
  return [...grupy.entries()]
    .sort((a, b) => a[1].kolejnosc - b[1].kolejnosc || a[1].etykieta.localeCompare(b[1].etykieta, "pl"))
    .map(([klucz, g]) => {
      const n = g.r.length;
      const sumaR = g.r.reduce((s, x) => s + x, 0);
      const w = n > 0 ? wilson(g.wygrane, n) : null;
      return {
        klucz,
        etykieta: g.etykieta,
        n,
        sumaR,
        sredniaR: n > 0 ? sumaR / n : null,
        winRate: w ? { p: w.p, low: w.low, high: w.high } : null,
        malo: n < PROG_KOMORKI_N,
      };
    });
}

export async function przegladMiesiaca(miesiac: string) {
  const od = `${miesiac}-01`;
  const [r, m] = miesiac.split("-").map(Number);
  const do_ = new Date(Date.UTC(r, m, 0)).toISOString().slice(0, 10);
  const wiersze = await db
    .select({
      id: trades.id,
      dzien: trades.tradingDay,
      entry: trades.entryTime,
      kierunek: trades.direction,
      r: trades.rMultiple,
      pnl: trades.pnl,
      setup: setups.name,
    })
    .from(trades)
    .leftJoin(backtestSessions, eq(trades.backtestSessionId, backtestSessions.id))
    .leftJoin(setups, eq(trades.setupId, setups.id))
    .where(warunekZakresu(od, do_))
    .orderBy(asc(trades.entryTime));

  type Grupa = { etykieta: string; kolejnosc: number; r: number[]; wygrane: number };
  const kierunek = new Map<string, Grupa>();
  const okno = new Map<string, Grupa>();
  const dzien = new Map<string, Grupa>();
  const setup = new Map<string, Grupa>();
  const dodaj = (mapa: Map<string, Grupa>, klucz: string, etykieta: string, kolejnosc: number, rr: number) => {
    const g = mapa.get(klucz) ?? { etykieta, kolejnosc, r: [], wygrane: 0 };
    g.r.push(rr);
    if (rr > 0) g.wygrane += 1;
    mapa.set(klucz, g);
  };
  let bezR = 0;
  for (const w of wiersze) {
    if (w.r === null) {
      bezR += 1;
      continue;
    }
    const rr = Number(w.r);
    dodaj(kierunek, w.kierunek, w.kierunek === "long" ? "Long" : "Short", w.kierunek === "long" ? 0 : 1, rr);
    const o = oknoWejscia(w.entry);
    dodaj(okno, o.klucz, o.etykieta, o.kolejnosc, rr);
    if (w.dzien) {
      const d = new Date(`${w.dzien}T00:00:00Z`).getUTCDay();
      dodaj(dzien, String(d), DNI_TYGODNIA[d], (d + 6) % 7, rr);
    }
    dodaj(setup, w.setup ?? "—", w.setup ?? "Bez setupu", w.setup ? 0 : 1, rr);
  }
  const dni = await dniZakresu(od, do_);
  const zR = wiersze.filter((w) => w.r !== null).map((w) => Number(w.r));
  return {
    miesiac,
    od,
    do: do_,
    trades: wiersze.length,
    bezR,
    sumaR: zR.reduce((s, x) => s + x, 0),
    pnlCents: wiersze.reduce((s, w) => s + Number(w.pnl ?? 0), 0),
    dni,
    podzialy: [
      { klucz: "kierunek", tytul: "Long i short", komorki: zbuduj(kierunek) },
      { klucz: "okno", tytul: "Okno wejścia (czas NY, co 30 min)", komorki: zbuduj(okno) },
      { klucz: "dzien", tytul: "Dzień tygodnia", komorki: zbuduj(dzien) },
      { klucz: "setup", tytul: "Setup", komorki: zbuduj(setup) },
    ],
  };
}

export type PrzegladMiesiacaUi = Awaited<ReturnType<typeof przegladMiesiaca>>;
