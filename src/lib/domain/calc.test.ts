import { describe, expect, it } from "vitest";

import {
  computeTrade,
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
