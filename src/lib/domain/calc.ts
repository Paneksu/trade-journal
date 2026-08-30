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

/**
 * Jeden kawalek wyjscia z pozycji. Czesciowe WEJSCIA sa poza zakresem -
 * wejscie jest zawsze jedno, na `TradeInput.entryPrice`.
 */
export type ExitInput = {
  price: number;
  contracts: number;
  time: Date | null;
  /**
   * Kwota z rachunku dla tego kawalka, w centach. Zero jest poprawna
   * wartoscia, wiec sprawdzamy `null`/`undefined`, nie falsy (ADR-016).
   */
  brokerAmount?: number | null;
};

export type TradeInput = {
  instrument: InstrumentSpec;
  direction: Direction;
  contracts: number;
  entryPrice: number;
  /** Pusta tablica = pozycja bez wyjscia (otwarta). Kolejnosc jest kontraktem
   * wywolujacego - `computeTrade` NIE sortuje po czasie. To wywolujacy (akcja
   * zapisu) odpowiada za posortowanie kawalkow chronologicznie, bo od tej
   * kolejnosci zalezy "ostatnie wyjscie" w `scalingR`. */
  exits: ExitInput[];
  stopLoss: number | null;
  takeProfit: number | null;
  mae: number | null;
  mfe: number | null;
  entryTime: Date;
  /**
   * Faktyczny wynik z rachunku brokera dla calego trade'a, w centach. Gdy
   * podany i sa jakiekolwiek wyjscia, bije wszystko inne - i kwoty per
   * kawalek, i siatke tickow (ADR-016). Zero jest poprawna wartoscia - break
   * even u brokera - wiec sprawdzamy `null`, nie falsy.
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
  /** Srednia wazona ceny wyjscia po zamknietych kontraktach, zaokraglona do
   * sensownej precyzji ceny. `null`, gdy pozycja jest otwarta. */
  exitPrice: number | null;
  /** Najpozniejszy niepusty czas wyjscia. `null`, gdy zaden kawalek go nie ma. */
  exitTime: Date | null;
  /** Suma kontraktow po wszystkich kawalkach wyjscia. */
  closedContracts: number;
  /** Liczba kawalkow wyjscia. */
  exitCount: number;
  /** Ile R dala decyzja o skalowaniu wzgledem wyjscia caloscia po cenie
   * ostatniego kawalka. `null` przy mniej niz dwoch wyjsciach albo bez
   * ryzyka zdefiniowanego stopem. */
  scalingR: number | null;
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
  const { instrument: i, direction, contracts, exits } = t;

  const exitCount = exits.length;
  const closedContracts = exits.reduce((sum, e) => sum + e.contracts, 0);

  // Ryzyko: odleglosc do stopa, z PELNEJ pozycji wejsciowej - zdjecie czesci
  // kontraktow po drodze nie zmienia mianownika R. Stop rowny cenie wejscia
  // nie definiuje ryzyka - wtedy R po prostu nie istnieje.
  const rawRiskTicks =
    t.stopLoss === null ? null : Math.abs(Math.round((t.entryPrice - t.stopLoss) / i.tickSize));
  const riskTicks = rawRiskTicks && rawRiskTicks > 0 ? rawRiskTicks : null;
  const riskAmount =
    riskTicks === null ? null : amountFromTicks(riskTicks, i.tickValue, Math.abs(contracts));

  let pnl: number | null = null;
  let ticks: number | null = null;
  let exitPrice: number | null = null;
  let exitTime: Date | null = null;
  let scalingR: number | null = null;

  if (exitCount > 0) {
    // Ticki per kawalek - potrzebne osobno, zeby je wazyc kontraktami i zeby
    // "ostatnie wyjscie" (dla scalingR) mialo swoj pojedynczy ruch.
    const ticksPerExit = exits.map((e) => moveInTicks(direction, t.entryPrice, e.price, i.tickSize));

    /* P&L zaokraglane PER KAWALEK, nie raz na koncu: pnl_i = kwota z brokera
       dla kawalka (jesli podana) albo amountFromTicks tego kawalka; pnl to
       suma pnl_i. Dzieki temu trade z jednym wyjsciem daje CO DO CENTA to
       samo, co dawal stary jednowyjsciowy model - backfill historii jest
       bezstratny. To jest twarde wymaganie, nie preferencja. */
    const pnlPerExit = exits.map((e, idx) =>
      e.brokerAmount != null
        ? e.brokerAmount
        : amountFromTicks(ticksPerExit[idx], i.tickValue, e.contracts),
    );
    const sumPnlPerExit = pnlPerExit.reduce((sum, p) => sum + p, 0);

    // Kwota z brokera na poziomie trade'a bije wszystko (ADR-016). Pelna
    // kolejnosc pierwszenstwa: trade -> kawalek -> siatka tickow.
    const brokerAmount = t.brokerAmount ?? null;
    pnl = brokerAmount !== null ? brokerAmount : sumPnlPerExit;

    // Srednia wazona ruchu w tickach. NIE wolno tego liczyc z usrednionej
    // ceny wyjscia - moveInTicks(entry, avgPrice) daje w ogolnosci INNA
    // liczbe niz srednia wazona pojedynczych ruchow (kazdy kawalek osobno
    // zaokragla sie do pelnego ticku, a to nie jest operacja liniowa), wiec
    // ktos kiedys probowalby to "uproscic" i po cichu zepsulby statystyki.
    ticks =
      closedContracts !== 0
        ? Math.round(
            ticksPerExit.reduce((sum, tk, idx) => sum + tk * exits[idx].contracts, 0) /
              closedContracts,
          )
        : 0;

    // Srednia wazona ceny wyjscia - to podsumowanie dla czlowieka, nie cena
    // zlecenia, wiec nie musi lezec na siatce tickow.
    exitPrice =
      closedContracts !== 0
        ? roundPrice(
            exits.reduce((sum, e) => sum + e.price * e.contracts, 0) / closedContracts,
            priceDecimals(t.entryPrice, i.tickSize),
          )
        : null;

    // Najpozniejszy niepusty czas wyjscia; null, gdy zaden kawalek go nie ma.
    exitTime = exits.reduce<Date | null>((latest, e) => {
      if (e.time === null) return latest;
      if (latest === null || e.time.getTime() > latest.getTime()) return e.time;
      return latest;
    }, null);

    // scalingR: wynik faktyczny minus wynik, jaki dalaby CALA zamknieta
    // czesc wyjeta jednorazowo po cenie ostatniego kawalka. "Ostatnie
    // wyjscie" to ostatni element tablicy `exits` w kolejnosci, w jakiej ja
    // dostajemy - funkcja jej NIE sortuje, kolejnosc jest kontraktem
    // wywolujacego (akcja zapisu ma podac ja juz posortowana po czasie).
    // Liczone WYLACZNIE na siatce tickow, z pominieciem wszystkich kwot
    // brokera (i tej z trade'a, i tych z kawalkow) - miara ocenia decyzje o
    // skalowaniu (kiedy i po ile zdejmowac), a kwoty brokera domieszalyby do
    // niej poslizg i sposob wypelnienia zlecen, ktorych ta miara nie ocenia.
    if (exitCount >= 2 && riskAmount !== null && riskAmount !== 0) {
      const sumTickAmounts = ticksPerExit.reduce(
        (sum, tk, idx) => sum + amountFromTicks(tk, i.tickValue, exits[idx].contracts),
        0,
      );
      const lastTicks = ticksPerExit[ticksPerExit.length - 1];
      const allAtLast = amountFromTicks(lastTicks, i.tickValue, closedContracts);
      scalingR = (sumTickAmounts - allAtLast) / riskAmount;
    }
  }

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
    exitTime === null
      ? null
      : Math.max(0, Math.round((exitTime.getTime() - t.entryTime.getTime()) / 1000));

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
    exitPrice,
    exitTime,
    closedContracts,
    exitCount,
    scalingR,
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
