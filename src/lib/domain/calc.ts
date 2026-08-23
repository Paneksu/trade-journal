/**
 * Obliczenia pojedynczego trade'a.
 *
 * Modul jest czysty: zadnych zapytan do bazy, zadnych zaleznosci od Next.
 * To jedyne zrodlo prawdy dla wynikow. Kolumny wyliczane w tabeli `trades`
 * sa wylacznie zapisanym wynikiem tych funkcji.
 *
 * Konwencje:
 * - kwoty w centach jako liczby calkowite
 * - ruch ceny liczymy w tickach, bo tylko to jest odporne na blad zmiennoprzecinkowy
 * - ryzyko liczymy z odleglosci do stopa; R liczymy z wyniku (prowizja poza modelem, patrz ADR-010)
 * - kwota z brokera, gdy podana, bije siatke tickow: to rachunek jest faktem,
 *   a model tickowy tylko przyblizeniem (ADR-016)
 */

export type Direction = "long" | "short";

export type MarketSession = "premarket" | "rth" | "afterhours" | "overnight";

export type InstrumentSpec = {
  tickSize: number;
  /**
   * Wartosc jednego ticku na jeden kontrakt w tysiecznych dolara.
   * Nie w centach: ZN ma tick 15,625 USD, co w centach nie jest liczba calkowita.
   * NQ = 5000 (5,00 USD), ES = 12500, ZN = 15625.
   */
  tickValue: number;
  rthFrom: string;
  rthTo: string;
  exchangeTimezone: string;
};

export type TradeInput = {
  instrument: InstrumentSpec;
  direction: Direction;
  contracts: number;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  mae: number | null;
  mfe: number | null;
  entryTime: Date;
  exitTime: Date | null;
  /**
   * Faktyczny wynik z rachunku brokera, w centach. Gdy podany, jest wynikiem
   * trade'a zamiast kwoty policzonej z tickow (ADR-016). Zero jest poprawna
   * wartoscia - break even u brokera - wiec sprawdzamy `null`, nie falsy.
   */
  brokerAmount?: number | null;
};

export type TradeResult = {
  ticks: number | null;
  riskTicks: number | null;
  pnl: number | null;
  riskAmount: number | null;
  rMultiple: number | null;
  maeR: number | null;
  mfeR: number | null;
  durationS: number | null;
  marketSession: MarketSession;
  weekday: number;
  entryHour: number;
  tradingDay: string;
};

/** Ruch ceny w tickach, ze znakiem zgodnym z kierunkiem pozycji. */
export function moveInTicks(
  direction: Direction,
  from: number,
  to: number,
  tickSize: number,
): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 0;
  const delta = direction === "long" ? to - from : from - to;
  return Math.round(delta / tickSize);
}

/* Zamienia ruch w tickach na kwote w centach. Dzielenie przez 10 wynika
   z jednostki `tickValue` (tysieczne dolara); zaokraglamy raz, na koncu. */
function amountFromTicks(ticks: number, tickValue: number, contracts: number): number {
  return Math.round((ticks * tickValue * contracts) / 10);
}

export type ExitForAmountInput = {
  instrument: InstrumentSpec;
  direction: Direction;
  contracts: number;
  entryPrice: number;
  /** Docelowy wynik w centach (moze byc ujemny). */
  target: number;
};

export type ExitForAmount = {
  exitPrice: number;
  ticks: number;
  /** Faktyczny wynik po zaokragleniu do pelnego ticka, w centach. */
  pnl: number;
  /** pnl - target, w centach. Zero = trafione co do centa. */
  diff: number;
};

/** Ile miejsc po przecinku ma sens dla ceny, biorac wieksza precyzje z wejscia albo ticku. */
function priceDecimals(entryPrice: number, tickSize: number): number {
  const of = (n: number) => {
    const text = Math.abs(n).toFixed(10).replace(/0+$/, "");
    const dot = text.indexOf(".");
    return dot === -1 ? 0 : text.length - dot - 1;
  };
  return Math.min(8, Math.max(of(entryPrice), of(tickSize)));
}

/** Domyka blad zmiennoprzecinkowy ceny do sensownej liczby miejsc po przecinku. */
function roundPrice(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Odwrotnosc `amountFromTicks`: z docelowego wyniku wylicza cene wyjscia,
 * zaokraglajac ruch do pelnego ticka instrumentu. `pnl` liczy tym samym
 * `amountFromTicks`, co `computeTrade` - nie wlasnym wzorem obok niego.
 * Zrodlem prawdy dla zapisu pozostaje `computeTrade`; ta funkcja tylko
 * podpowiada cene do pola formularza.
 */
export function exitPriceForAmount(t: ExitForAmountInput): ExitForAmount | null {
  const { instrument: i, direction, contracts, entryPrice, target } = t;
  if (!Number.isFinite(contracts) || contracts <= 0) return null;
  if (!Number.isFinite(i.tickSize) || i.tickSize <= 0) return null;
  if (!Number.isFinite(i.tickValue) || i.tickValue <= 0) return null;
  if (!Number.isFinite(entryPrice) || !Number.isFinite(target)) {
    return null;
  }

  // `|| 0` gasi minus zero: Math.round(-0.2) daje -0, ktore wyswietliloby sie
  // w interfejsie jako "-0" i rozjechalo z zerem zwracanym przez computeTrade.
  const ticks = Math.round((target * 10) / (i.tickValue * contracts)) || 0;
  const rawExit = direction === "long" ? entryPrice + ticks * i.tickSize : entryPrice - ticks * i.tickSize;
  const exitPrice = roundPrice(rawExit, priceDecimals(entryPrice, i.tickSize));

  const pnl = amountFromTicks(ticks, i.tickValue, contracts);
  const diff = pnl - target;

  return { exitPrice, ticks, pnl, diff };
}

type TimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** Rozklada moment czasu na czesci w podanej strefie (obsluguje zmiany czasu). */
export function timeParts(moment: Date, timezone: string): TimeParts {
  const parts = formatter(timezone).formatToParts(moment);
  const get = (typ: Intl.DateTimeFormatPartTypes) => parts.find((c) => c.type === typ)?.value ?? "";
  const hour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Intl potrafi zwrocic 24 zamiast 0 dla polnocy.
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    weekday: Math.max(0, DAYS.indexOf(get("weekday"))),
  };
}

export function marketHour(moment: Date, timezone: string): number {
  return timeParts(moment, timezone).hour;
}

function minutesFromMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Sesja rynkowa wedlug godzin gieldy:
 * premarket = od 04:00 do otwarcia, rth = sesja glowna,
 * afterhours = od zamkniecia do 20:00, reszta = overnight.
 */
export function marketSession(moment: Date, instrument: InstrumentSpec): MarketSession {
  const { hour, minute } = timeParts(moment, instrument.exchangeTimezone);
  const now = hour * 60 + minute;
  const open = minutesFromMidnight(instrument.rthFrom);
  const close = minutesFromMidnight(instrument.rthTo);
  if (now >= open && now < close) return "rth";
  if (now >= 4 * 60 && now < open) return "premarket";
  if (now >= close && now < 20 * 60) return "afterhours";
  return "overnight";
}

/**
 * Dzien handlowy w rozumieniu CME: sesja otwiera sie o 18:00 czasu gieldy
 * i nalezy juz do nastepnej daty kalendarzowej.
 */
export function tradingDay(moment: Date, timezone: string): string {
  const { year, month, day, hour } = timeParts(moment, timezone);
  const base = Date.UTC(year, month - 1, day);
  const shift = hour >= 18 ? 86_400_000 : 0;
  return new Date(base + shift).toISOString().slice(0, 10);
}

export function computeTrade(t: TradeInput): TradeResult {
  const { instrument: i, direction, contracts } = t;

  const ticks =
    t.exitPrice === null ? null : moveInTicks(direction, t.entryPrice, t.exitPrice, i.tickSize);

  /* Kwota z brokera wygrywa z siatka tickow (ADR-016): tick NQ ma 5 USD, wiec
     wynik 116 USD nie lezy na siatce, a to on jest prawda o rachunku. Ticki
     zostaja policzone z ceny - opisuja ruch, nie pieniadze. Brak ceny wyjscia
     to pozycja otwarta i zaden wynik, nawet z podana kwota. */
  const brokerAmount = t.brokerAmount ?? null;
  const pnl =
    ticks === null
      ? null
      : brokerAmount !== null
        ? brokerAmount
        : amountFromTicks(ticks, i.tickValue, contracts);

  // Ryzyko: odleglosc do stopa. Stop rowny cenie wejscia nie definiuje ryzyka -
  // wtedy R po prostu nie istnieje.
  const rawRiskTicks =
    t.stopLoss === null ? null : Math.abs(Math.round((t.entryPrice - t.stopLoss) / i.tickSize));
  const riskTicks = rawRiskTicks && rawRiskTicks > 0 ? rawRiskTicks : null;
  const riskAmount =
    riskTicks === null ? null : amountFromTicks(riskTicks, i.tickValue, Math.abs(contracts));

  const rMultiple =
    pnl === null || riskAmount === null || riskAmount === 0 ? null : pnl / riskAmount;

  // MAE liczymy jako ruch przeciwny do pozycji, MFE jako ruch zgodny.
  const maeR =
    t.mae === null || t.mae === undefined || riskTicks === null
      ? null
      : Math.abs(moveInTicks(direction, t.entryPrice, t.mae, i.tickSize)) / riskTicks;
  const mfeR =
    t.mfe === null || t.mfe === undefined || riskTicks === null
      ? null
      : moveInTicks(direction, t.entryPrice, t.mfe, i.tickSize) / riskTicks;

  const durationS =
    t.exitTime === null
      ? null
      : Math.max(0, Math.round((t.exitTime.getTime() - t.entryTime.getTime()) / 1000));

  const parts = timeParts(t.entryTime, i.exchangeTimezone);

  return {
    ticks,
    riskTicks,
    pnl,
    riskAmount,
    rMultiple,
    maeR,
    mfeR,
    durationS,
    marketSession: marketSession(t.entryTime, i),
    weekday: parts.weekday,
    entryHour: parts.hour,
    tradingDay: tradingDay(t.entryTime, i.exchangeTimezone),
  };
}

/** Przesuniecie strefy wzgledem UTC w danym momencie, w milisekundach. */
function timezoneOffset(moment: Date, timezone: string): number {
  const c = timeParts(moment, timezone);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, 0, 0);
  const withoutSeconds = Math.floor(moment.getTime() / 60_000) * 60_000;
  return asUtc - withoutSeconds;
}

/**
 * Zamienia zapis z pola `datetime-local` ("2026-03-10T15:30") na moment w czasie,
 * czytajac go jako godzine w podanej strefie. Dwa przebiegi, bo przy zmianie
 * czasu przesuniecie zalezy od wyniku.
 */
export function fromLocalInput(value: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, year, month, day, hour, minute] = m.map(Number) as unknown as number[];
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  let result = guess - timezoneOffset(new Date(guess), timezone);
  result = guess - timezoneOffset(new Date(result), timezone);
  return new Date(result);
}

/** Odwrotnosc: moment w czasie na wartosc dla pola `datetime-local`. */
export function toLocalInput(moment: Date | null, timezone: string): string {
  if (!moment) return "";
  const c = timeParts(moment, timezone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${c.year}-${two(c.month)}-${two(c.day)}T${two(c.hour)}:${two(c.minute)}`;
}

/** Data kalendarzowa w podanej strefie, format YYYY-MM-DD. */
export function localDate(moment: Date, timezone: string): string {
  const c = timeParts(moment, timezone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${c.year}-${two(c.month)}-${two(c.day)}`;
}
