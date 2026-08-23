import { describe, expect, it } from "vitest";

import {
  computeTrade,
  exitPriceForAmount,
  fromLocalInput,
  marketHour,
  marketSession,
  moveInTicks,
  toLocalInput,
  tradingDay,
  type InstrumentSpec,
  type TradeInput,
} from "./calc";

/* Realne parametry kontraktow CME uzyte we wszystkich przykladach ponizej.
   NQ: tick 0.25 pkt = 5,00 USD; ES: tick 0.25 pkt = 12,50 USD.
   `tickValue` podajemy w tysiecznych dolara. */
const NQ: InstrumentSpec = {
  tickSize: 0.25,
  tickValue: 5000,
  rthFrom: "09:30",
  rthTo: "16:00",
  exchangeTimezone: "America/New_York",
};

const ES: InstrumentSpec = { ...NQ, tickValue: 12500 };

/* ZN: tick 1/64 pkt = 15,625 USD - tysieczne dolara nie dziela sie rowno
   przez 10, wiec to dobry przypadek na sprawdzenie, ze nic sie nie gubi. */
const ZN: InstrumentSpec = { ...NQ, tickSize: 0.015625, tickValue: 15625 };

function input(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    instrument: NQ,
    direction: "long",
    contracts: 2,
    entryPrice: 20000,
    exitPrice: 20025.5,
    stopLoss: 19990,
    takeProfit: null,
    mae: null,
    mfe: null,
    entryTime: new Date("2026-03-10T14:30:00Z"),
    exitTime: new Date("2026-03-10T15:12:30Z"),
    ...overrides,
  };
}

describe("moveInTicks", () => {
  it("liczy ruch longa jako roznice w gore", () => {
    expect(moveInTicks("long", 20000, 20025.5, 0.25)).toBe(102);
  });

  it("liczy ruch shorta odwrotnie", () => {
    expect(moveInTicks("short", 5000, 5010, 0.25)).toBe(-40);
  });

  it("zaokragla blad zmiennoprzecinkowy do pelnego ticku", () => {
    // 0.1 + 0.2 !== 0.3 w arytmetyce zmiennoprzecinkowej.
    expect(moveInTicks("long", 1.1, 1.4, 0.1)).toBe(3);
  });

  it("zwraca zero, gdy ceny sa rowne", () => {
    expect(moveInTicks("long", 20000, 20000, 0.25)).toBe(0);
  });
});

describe("computeTrade - trade zyskowny na NQ", () => {
  const w = computeTrade(input());

  it("102 ticki przy 2 kontraktach to 1020 USD", () => {
    expect(w.ticks).toBe(102);
    expect(w.pnl).toBe(102_000);
  });

  it("ryzyko 40 tickow na 2 kontraktach to 400 USD", () => {
    expect(w.riskTicks).toBe(40);
    expect(w.riskAmount).toBe(40_000);
  });

  it("liczy R jako wynik podzielony przez ryzyko", () => {
    expect(w.rMultiple).toBeCloseTo(2.55, 4);
  });

  it("liczy czas trwania w sekundach", () => {
    expect(w.durationS).toBe(2550);
  });
});

describe("computeTrade - trade stratny na ES po stronie short", () => {
  const w = computeTrade(
    input({
      instrument: ES,
      direction: "short",
      contracts: 1,
      entryPrice: 5000,
      exitPrice: 5010,
      stopLoss: 5005,
    }),
  );

  it("liczy strate 40 tickow po 12,50 USD", () => {
    expect(w.ticks).toBe(-40);
    expect(w.pnl).toBe(-50_000);
  });

  it("ryzyko shorta liczy sie od stopa powyzej wejscia", () => {
    expect(w.riskTicks).toBe(20);
    expect(w.riskAmount).toBe(25_000);
  });

  it("R jest ujemne i rowne dokladnie -2, bo stop zostal przekroczony dwukrotnie", () => {
    expect(w.rMultiple).toBeCloseTo(-2, 4);
  });
});

describe("computeTrade - przypadki brzegowe", () => {
  it("bez stopa nie liczy R ani ryzyka", () => {
    const w = computeTrade(input({ stopLoss: null }));
    expect(w.riskAmount).toBeNull();
    expect(w.rMultiple).toBeNull();
    expect(w.pnl).toBe(102_000);
  });

  it("stop rowny cenie wejscia nie daje dzielenia przez zero", () => {
    const w = computeTrade(input({ stopLoss: 20000 }));
    expect(w.riskAmount).toBeNull();
    expect(w.rMultiple).toBeNull();
  });

  it("trade otwarty nie ma wyniku, ale ma policzone ryzyko", () => {
    const w = computeTrade(input({ exitPrice: null, exitTime: null }));
    expect(w.pnl).toBeNull();
    expect(w.rMultiple).toBeNull();
    expect(w.durationS).toBeNull();
    expect(w.riskAmount).toBe(40_000);
  });

  it("przelicza MAE i MFE na wielokrotnosc ryzyka", () => {
    const w = computeTrade(input({ mae: 19995, mfe: 20030 }));
    expect(w.maeR).toBeCloseTo(0.5, 4);
    expect(w.mfeR).toBeCloseTo(3, 4);
  });

  it("MAE po zlej stronie wejscia dla shorta liczy sie w gore", () => {
    const w = computeTrade(
      input({
        direction: "short",
        entryPrice: 20000,
        exitPrice: 19950,
        stopLoss: 20010,
        mae: 20005,
        mfe: 19940,
      }),
    );
    // ryzyko: 40 tickow; MAE 5 pkt = 20 tickow w gore = 0,5R
    expect(w.maeR).toBeCloseTo(0.5, 4);
    // MFE 60 pkt = 240 tickow w dol = 6R
    expect(w.mfeR).toBeCloseTo(6, 4);
  });

  it("zaokragla wynik do pelnych centow przy ulamkowej liczbie kontraktow", () => {
    const w = computeTrade(input({ contracts: 0.5 }));
    expect(w.pnl).toBe(25_500);
  });
});

describe("czas rynkowy", () => {
  it("godzina liczona jest w strefie gieldy, nie lokalnej", () => {
    // 14:30 UTC = 10:30 w Nowym Jorku (czas letni)
    expect(marketHour(new Date("2026-03-10T14:30:00Z"), "America/New_York")).toBe(10);
  });

  it("rozpoznaje sesje glowna", () => {
    expect(marketSession(new Date("2026-03-10T14:30:00Z"), NQ)).toBe("rth");
  });

  it("rozpoznaje sesje przedrynkowa", () => {
    // 12:00 UTC = 08:00 ET
    expect(marketSession(new Date("2026-03-10T12:00:00Z"), NQ)).toBe("premarket");
  });

  it("rozpoznaje sesje powyrynkowa", () => {
    // 21:00 UTC = 17:00 ET
    expect(marketSession(new Date("2026-03-10T21:00:00Z"), NQ)).toBe("afterhours");
  });

  it("rozpoznaje sesje nocna", () => {
    // 03:00 UTC = 23:00 ET dnia poprzedniego
    expect(marketSession(new Date("2026-03-11T03:00:00Z"), NQ)).toBe("overnight");
  });

  it("po 18:00 czasu gieldy zaczyna sie nastepny dzien handlowy", () => {
    // 22:30 UTC = 18:30 ET, czyli otwarcie sesji na kolejny dzien
    expect(tradingDay(new Date("2026-03-10T22:30:00Z"), "America/New_York")).toBe("2026-03-11");
  });

  it("w ciagu dnia data handlowa jest zwykla data gieldowa", () => {
    expect(tradingDay(new Date("2026-03-10T14:30:00Z"), "America/New_York")).toBe("2026-03-10");
  });
});

describe("exitPriceForAmount", () => {
  it("long na NQ, kwota rowna na tick - wraca przez computeTrade co do centa", () => {
    const r = exitPriceForAmount({
      instrument: NQ,
      direction: "long",
      contracts: 2,
      entryPrice: 20000,
      target: 100_000,
    });
    expect(r).not.toBeNull();
    expect(r!.exitPrice).toBe(20025);
    expect(r!.ticks).toBe(100);
    expect(r!.diff).toBe(0);

    const w = computeTrade(input({ contracts: 2, entryPrice: 20000, exitPrice: r!.exitPrice }));
    expect(w.pnl).toBe(100_000);
    expect(w.pnl).toBe(r!.pnl);
  });

  it("short na ES - cena wychodzi ponizej wejscia, znak sie zgadza", () => {
    const r = exitPriceForAmount({
      instrument: ES,
      direction: "short",
      contracts: 1,
      entryPrice: 5000,
      target: 25_000,
    });
    expect(r).not.toBeNull();
    expect(r!.exitPrice).toBeLessThan(5000);
    expect(r!.ticks).toBeGreaterThan(0);
    expect(r!.pnl).toBeGreaterThan(0);
  });

  it("strata - target ujemny daje cene po przeciwnej stronie wejscia", () => {
    const r = exitPriceForAmount({
      instrument: NQ,
      direction: "long",
      contracts: 1,
      entryPrice: 20000,
      target: -50_000,
    });
    expect(r).not.toBeNull();
    expect(r!.exitPrice).toBeLessThan(20000);
    expect(r!.ticks).toBeLessThan(0);
    expect(r!.pnl).toBeLessThan(0);
  });

  it("zaokraglenie - kwota miedzy tickami daje diff != 0, ale pnl zgadza sie z computeTrade", () => {
    const r = exitPriceForAmount({
      instrument: NQ,
      direction: "long",
      contracts: 2,
      entryPrice: 20000,
      target: 100_108,
    });
    expect(r).not.toBeNull();
    expect(r!.diff).not.toBe(0);

    const w = computeTrade(input({ contracts: 2, entryPrice: 20000, exitPrice: r!.exitPrice }));
    expect(w.pnl).toBe(r!.pnl);
  });

  it("przypadki brzegowe zwracaja null", () => {
    const base = {
      instrument: NQ,
      direction: "long" as const,
      entryPrice: 20000,
      target: 1000,
    };
    expect(exitPriceForAmount({ ...base, contracts: 0 })).toBeNull();
    expect(exitPriceForAmount({ ...base, contracts: 1, instrument: { ...NQ, tickSize: 0 } })).toBeNull();
    expect(exitPriceForAmount({ ...base, contracts: 1, instrument: { ...NQ, tickValue: 0 } })).toBeNull();
    expect(exitPriceForAmount({ ...base, contracts: NaN })).toBeNull();
    expect(exitPriceForAmount({ ...base, contracts: 1, target: NaN })).toBeNull();
  });

  it("ZN (tick 15,625 USD) - liczba tickow parzysta wychodzi rowno", () => {
    const r = exitPriceForAmount({
      instrument: ZN,
      direction: "long",
      contracts: 4,
      entryPrice: 110,
      target: 312_500,
    });
    expect(r).not.toBeNull();
    expect(r!.exitPrice).toBe(110.78125);
    expect(r!.ticks).toBe(50);
    expect(r!.diff).toBe(0);
  });

  it("ZN - nieparzysta liczba tickow gubi pol centa, ale zgodnie z computeTrade", () => {
    // Tick ZN to 15,625 USD = 1562,5 centa. Na jednym kontrakcie i nieparzystej
    // liczbie tickow polowka centa musi gdzies pojsc - `amountFromTicks`
    // zaokragla ja w gore i `diff` to uczciwie pokazuje.
    const r = exitPriceForAmount({
      instrument: ZN,
      direction: "long",
      contracts: 1,
      entryPrice: 110,
      target: 1_562,
    });
    expect(r).not.toBeNull();
    expect(r!.ticks).toBe(1);
    expect(r!.pnl).toBe(1_563);
    expect(r!.diff).toBe(1);

    // Klucz: ta sama liczba wychodzi z modulu, ktory zapisuje trade'a.
    const w = computeTrade(
      input({
        instrument: ZN,
        contracts: 1,
        entryPrice: 110,
        exitPrice: r!.exitPrice,
      }),
    );
    expect(w.pnl).toBe(r!.pnl);
  });

  it("wyliczona cena zawsze wraca przez computeTrade z tym samym wynikiem", () => {
    /* Gwarancja, na ktorej wisi cala funkcja: cokolwiek wstawimy do pola ceny,
       zapis policzy z tego dokladnie to `pnl`, ktore obiecalismy w podgladzie.
       Zamiast deklarowac to w komentarzu, przechodzimy siatke przypadkow -
       takze z cena wejscia spoza siatki tickow. */
    const instrumenty: [string, InstrumentSpec, number][] = [
      ["NQ", NQ, 20000.1],
      ["ES", ES, 5000],
      ["ZN", ZN, 110.203125],
    ];
    for (const [nazwa, spec, entry] of instrumenty) {
      for (const direction of ["long", "short"] as const) {
        for (const contracts of [1, 3]) {
          for (let kwota = -50_000; kwota <= 50_000; kwota += 1_137) {
            const r = exitPriceForAmount({
              instrument: spec,
              direction,
              contracts,
              entryPrice: entry,
              target: kwota,
            });
            expect(r, `${nazwa} ${direction} ${contracts} ${kwota}`).not.toBeNull();
            const w = computeTrade(
              input({
                instrument: spec,
                direction,
                contracts,
                entryPrice: entry,
                exitPrice: r!.exitPrice,
              }),
            );
            expect(w.pnl, `${nazwa} ${direction} ${contracts} ${kwota}`).toBe(r!.pnl);
            expect(w.ticks, `${nazwa} ${direction} ${contracts} ${kwota}`).toBe(r!.ticks);
          }
        }
      }
    }
  });
});

describe("czas lokalny", () => {
  it("czyta godzine z formularza jako czas w strefie uzytkownika", () => {
    // 15:30 w Warszawie zima to 14:30 UTC
    expect(fromLocalInput("2026-01-15T15:30", "Europe/Warsaw")?.toISOString()).toBe(
      "2026-01-15T14:30:00.000Z",
    );
  });

  it("uwzglednia czas letni", () => {
    // 15:30 w Warszawie latem to 13:30 UTC
    expect(fromLocalInput("2026-07-15T15:30", "Europe/Warsaw")?.toISOString()).toBe(
      "2026-07-15T13:30:00.000Z",
    );
  });

  it("odwraca konwersje bez straty", () => {
    const moment = fromLocalInput("2026-07-15T15:30", "Europe/Warsaw");
    expect(toLocalInput(moment, "Europe/Warsaw")).toBe("2026-07-15T15:30");
  });

  it("odrzuca smieci", () => {
    expect(fromLocalInput("cokolwiek", "Europe/Warsaw")).toBeNull();
  });
});
