/**
 * Dzien jako jednostka dziennika, nie tylko trade.
 *
 * Dzien swiadomie odpuszczony jest zapisem tak samo waznym jak trade: mowi,
 * ze bylem przy biurku i nie znalazlem powodu do wejscia. Dzien pominiety
 * milczkiem nie mowi nic. Ten modul liczy roznice miedzy jednym a drugim.
 *
 * Modul jest czysty - zadnego importu z bazy ani z Nexta.
 */

export const NO_TRADE_REASONS = [
  { code: "no_setup", label: "Brak setupu" },
  { code: "outside_hours", label: "Poza godzinami handlu" },
  { code: "market_conditions", label: "Warunki rynkowe" },
  { code: "day_off", label: "Dzień wolny" },
  { code: "planned_break", label: "Zaplanowana pauza" },
  { code: "personal", label: "Powód osobisty" },
  { code: "other", label: "Inny" },
] as const;

export type NoTradeReason = (typeof NO_TRADE_REASONS)[number]["code"];

export const NO_TRADE_REASON_NAMES: Record<NoTradeReason, string> = Object.fromEntries(
  NO_TRADE_REASONS.map((r) => [r.code, r.label]),
) as Record<NoTradeReason, string>;

export function isNoTradeReason(value: unknown): value is NoTradeReason {
  return typeof value === "string" && value in NO_TRADE_REASON_NAMES;
}

/** Etykieta powodu; nieznany kod nie wywraca widoku, tylko znika. */
export function reasonName(code: string | null | undefined): string | null {
  return isNoTradeReason(code) ? NO_TRADE_REASON_NAMES[code] : null;
}

export type DayFlag = { day: string; noTrade: boolean; noTradeReason: string | null };

/* --- Kalendarz ------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/** Poniedzialek = 0, niedziela = 6. */
function weekdayIndex(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function addDays(day: string, by: number): string {
  const d = new Date(new Date(`${day}T12:00:00Z`).getTime() + by * DAY_MS);
  return d.toISOString().slice(0, 10);
}

/** Pierwszy i ostatni dzien miesiaca w formacie YYYY-MM-DD. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * Dni robocze w zakresie, obciete do `today` wlacznie.
 * Przyszlosc nie jest luka w dzienniku, wiec nie wchodzi do mianownika.
 * Swieta nie sa modelowane - dzien wolny oznacza sie recznie powodem `day_off`.
 */
export function businessDays(from: string, to: string, today?: string | null): string[] {
  const last = today && today < to ? today : to;
  if (last < from) return [];

  const out: string[] = [];
  for (let day = from; day <= last; day = addDays(day, 1)) {
    if (weekdayIndex(day) < 5) out.push(day);
  }
  return out;
}

export type Coverage = {
  expected: number;
  covered: number;
  ratio: number | null;
  missing: string[];
};

/**
 * Pokrycie dziennika: ile dni roboczych zakresu ma jakikolwiek zapis -
 * trade albo swiadome "bez transakcji". Reszta to dziury w prowadzeniu dziennika.
 */
export function journalCoverage({
  from,
  to,
  today,
  tradedDays,
  noTradeDays,
}: {
  from: string;
  to: string;
  today?: string | null;
  tradedDays: Iterable<string>;
  noTradeDays: Iterable<string>;
}): Coverage {
  const recorded = new Set<string>([...tradedDays, ...noTradeDays]);
  const expectedDays = businessDays(from, to, today);
  const missing = expectedDays.filter((d) => !recorded.has(d));
  const expected = expectedDays.length;
  const covered = expected - missing.length;

  return {
    expected,
    covered,
    // Zakres bez dni roboczych nie ma pokrycia - null, nigdy zero.
    ratio: expected === 0 ? null : covered / expected,
    missing,
  };
}

/** Rozbicie powodow, malejaco. Remis rozstrzyga kolejnosc z listy powodow. */
export function noTradeBreakdown(
  flags: DayFlag[],
): { code: NoTradeReason; label: string; count: number }[] {
  const counts = new Map<NoTradeReason, number>();
  for (const f of flags) {
    if (!f.noTrade || !isNoTradeReason(f.noTradeReason)) continue;
    counts.set(f.noTradeReason, (counts.get(f.noTradeReason) ?? 0) + 1);
  }

  return NO_TRADE_REASONS.filter((r) => counts.has(r.code))
    .map((r) => ({ code: r.code, label: r.label, count: counts.get(r.code)! }))
    .sort((a, b) => b.count - a.count);
}
