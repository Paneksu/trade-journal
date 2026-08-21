import { describe, expect, it } from "vitest";

import {
  computeTrade,
  exitPriceForNet,
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
   `tickValue` podajemy w tysiecznych dolara, prowizje w centach.
   Prowizja przyjeta 4,04 USD za kontrakt w obie strony. */
const NQ: InstrumentSpec = {
  tickSize: 0.25,
  tickValue: 5000,
  commissionPerContract: 404,
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
    commission: 808,
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

  it("102 ticki przy 2 kontraktach to 1020 USD brutto", () => {
    expect(w.ticks).toBe(102);
    expect(w.pnlGross).toBe(102_000);
  });

  it("odejmuje prowizje od wyniku brutto", () => {
    expect(w.pnlNet).toBe(101_192);
  });

  it("ryzyko 40 tickow na 2 kontraktach to 400 USD", () => {
    expect(w.riskTicks).toBe(40);
    expect(w.riskAmount).toBe(40_000);
  });

  it("liczy R jako wynik netto podzielony przez ryzyko", () => {
    expect(w.rMultiple).toBeCloseTo(2.5298, 4);
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
      commission: 404,
    }),
  );

  it("liczy strate 40 tickow po 12,50 USD", () => {
    expect(w.ticks).toBe(-40);
    expect(w.pnlGross).toBe(-50_000);
    expect(w.pnlNet).toBe(-50_404);
  });

  it("ryzyko shorta liczy sie od stopa powyzej wejscia", () => {
    expect(w.riskTicks).toBe(20);
    expect(w.riskAmount).toBe(25_000);
  });

  it("R jest ujemne i wieksze co do modulu niz 2, bo stop zostal przekroczony", () => {
    expect(w.rMultiple).toBeCloseTo(-2.016, 3);
  });
});

describe("computeTrade - przypadki brzegowe", () => {
  it("bez stopa nie liczy R ani ryzyka", () => {
    const w = computeTrade(input({ stopLoss: null }));
    expect(w.riskAmount).toBeNull();
    expect(w.rMultiple).toBeNull();
    expect(w.pnlNet).toBe(101_192);
  });

  it("stop rowny cenie wejscia nie daje dzielenia przez zero", () => {
    const w = computeTrade(input({ stopLoss: 20000 }));
    expect(w.riskAmount).toBeNull();
    expect(w.rMultiple).toBeNull();
  });

  it("trade otwarty nie ma wyniku, ale ma policzone ryzyko", () => {
    const w = computeTrade(input({ exitPrice: null, exitTime: null }));
    expect(w.pnlNet).toBeNull();
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
    const w = computeTrade(input({ contracts: 0.5, commission: 202 }));
    expect(w.pnlGross).toBe(25_500);
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

describe("exitPriceForNet", () => {
  it("long na NQ, kwota rowna na tick - wraca przez computeTrade co do centa", () => {
    const r = exitPriceForNet({
      instrument: NQ,
      direction: "long",
      contracts: 2,
      entryPrice: 20000,
      targetNet: 99_192,
      commission: 808,
    });
    expect(r).not.toBeNull();
    expect(r!.exitPrice).toBe(20025);
    expect(r!.ticks).toBe(100);
    expect(r!.diff).toBe(0);

    const w = computeTrade(
      input({ contracts: 2, entryPrice: 20000, exitPrice: r!.exitPrice, commission: 808 }),
    );
    expect(w.pnlNet).toBe(99_192);
    expect(w.pnlNet).toBe(r!.pnlNet);
  });

  it("short na ES - cena wychodzi ponizej wejscia, znak sie zgadza", () => {
    const r = exitPriceForNet({
      instrument: ES,
      direction: "short",
      contracts: 1,
      entryPrice: 5000,
      targetNet: 24_596,
      commission: 404,
    });
    expect(r).not.toBeNull();
    expect(r!.exitPrice).toBeLessThan(5000);
    expect(r!.ticks).toBeGreaterThan(0);
    expect(r!.pnlNet).toBeGreaterThan(0);
  });

  it("strata - targetNet ujemny daje cene po przeciwnej stronie wejscia", () => {
    const r = exitPriceForNet({
      instrument: NQ,
      direction: "long",
      contracts: 1,
      entryPrice: 20000,
      targetNet: -50_000,
      commission: 404,
    });
    expect(r).not.toBeNull();
    expect(r!.exitPrice).toBeLessThan(20000);
    expect(r!.ticks).toBeLessThan(0);
    expect(r!.pnlNet).toBeLessThan(0);
  });

  it("zaokraglenie - kwota miedzy tickami daje diff != 0, ale pnlNet zgadza sie z computeTrade", () => {
    const r = exitPriceForNet({
      instrument: NQ,
      direction: "long",
      contracts: 2,
      entryPrice: 20000,
      targetNet: 99_300,
      commission: 808,
    });
    expect(r).not.toBeNull();
    expect(r!.diff).not.toBe(0);

    const w = computeTrade(
      input({ contracts: 2, entryPrice: 20000, exitPrice: r!.exitPrice, commission: 808 }),
    );
    expect(w.pnlNet).toBe(r!.pnlNet);
  });

  it("prowizja - wyjscie na zero laduje na najblizszym ticku, nie zawsze na pokrywajacym", () => {
    const zerowy = (commission: number) =>
      exitPriceForNet({
        instrument: NQ,
        direction: "long",
        contracts: 1,
        entryPrice: 20000,
        targetNet: 0,
        commission,
      });

    // 4,04 USD to wiecej niz pol ticka (tick NQ = 5 USD), wiec cena idzie o tick w gore.
    const pokryta = zerowy(404);
    expect(pokryta!.ticks).toBe(1);
    expect(pokryta!.exitPrice).toBe(20000.25);
    expect(pokryta!.diff).toBe(96);

    // 2,00 USD to mniej niz pol ticka - najblizszy tick to zero, wiec prowizja
    // zostaje niepokryta i `diff` musi to pokazac. Zaokraglamy do najblizszego
    // ticka, a nie w strone pokrycia kosztu.
    const niepokryta = zerowy(200);
    expect(niepokryta!.ticks).toBe(0);
    expect(niepokryta!.exitPrice).toBe(20000);
    expect(niepokryta!.pnlNet).toBe(-200);
    expect(niepokryta!.diff).toBe(-200);
  });

  it("przypadki brzegowe zwracaja null", () => {
    const base = {
      instrument: NQ,
      direction: "long" as const,
      entryPrice: 20000,
      targetNet: 1000,
      commission: 0,
    };
    expect(exitPriceForNet({ ...base, contracts: 0 })).toBeNull();
    expect(exitPriceForNet({ ...base, contracts: 1, instrument: { ...NQ, tickSize: 0 } })).toBeNull();
    expect(exitPriceForNet({ ...base, contracts: 1, instrument: { ...NQ, tickValue: 0 } })).toBeNull();
    expect(exitPriceForNet({ ...base, contracts: NaN })).toBeNull();
    expect(exitPriceForNet({ ...base, contracts: 1, targetNet: NaN })).toBeNull();
  });

  it("ZN (tick 15,625 USD) - liczba tickow parzysta wychodzi rowno", () => {
    const r = exitPriceForNet({
      instrument: ZN,
      direction: "long",
      contracts: 4,
      entryPrice: 110,
      targetNet: 310_884,
      commission: 1_616,
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
    const r = exitPriceForNet({
      instrument: ZN,
      direction: "long",
      contracts: 1,
      entryPrice: 110,
      targetNet: 1_562,
      commission: 0,
    });
    expect(r).not.toBeNull();
    expect(r!.ticks).toBe(1);
    expect(r!.pnlNet).toBe(1_563);
    expect(r!.diff).toBe(1);

    // Klucz: ta sama liczba wychodzi z modulu, ktory zapisuje trade'a.
    const w = computeTrade(
      input({
        instrument: ZN,
        contracts: 1,
        entryPrice: 110,
        exitPrice: r!.exitPrice,
        commission: 0,
      }),
    );
    expect(w.pnlNet).toBe(r!.pnlNet);
  });

  it("wyliczona cena zawsze wraca przez computeTrade z tym samym wynikiem", () => {
    /* Gwarancja, na ktorej wisi cala funkcja: cokolwiek wstawimy do pola ceny,
       zapis policzy z tego dokladnie to `pnlNet`, ktore obiecalismy w podgladzie.
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
            const r = exitPriceForNet({
              instrument: spec,
              direction,
              contracts,
              entryPrice: entry,
              targetNet: kwota,
              commission: 404 * contracts,
            });
            expect(r, `${nazwa} ${direction} ${contracts} ${kwota}`).not.toBeNull();
            const w = computeTrade(
              input({
                instrument: spec,
                direction,
                contracts,
                entryPrice: entry,
                exitPrice: r!.exitPrice,
                commission: 404 * contracts,
              }),
            );
            expect(w.pnlNet, `${nazwa} ${direction} ${contracts} ${kwota}`).toBe(r!.pnlNet);
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
