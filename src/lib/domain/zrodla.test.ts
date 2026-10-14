import { describe, expect, it } from "vitest";

import { czyRodzajSesji, nazwaZrodla, rodzajSesjiZFormularza, zrodloDanych, zrodloPrzelacznika } from "./zrodla";

describe("zrodla", () => {
  it("plakietka tylko dla trade'ow z API", () => {
    expect(nazwaZrodla("tradingview")).toBe("TradingView");
    expect(nazwaZrodla("fxreplay")).toBe("FX Replay");
    expect(nazwaZrodla("form")).toBeNull();
  });
  it("rodzaj sesji: smiec i brak to backtest", () => {
    expect(czyRodzajSesji("forward")).toBe(true);
    expect(czyRodzajSesji("live")).toBe(false);
    expect(rodzajSesjiZFormularza("forward")).toBe("forward");
    expect(rodzajSesjiZFormularza("cokolwiek")).toBe("backtest");
    expect(rodzajSesjiZFormularza(null)).toBe("backtest");
  });
  it("przelacznik zna forward i mapuje all na wszystko", () => {
    expect(zrodloPrzelacznika("forward")).toBe("forward");
    expect(zrodloPrzelacznika("all")).toBe("wszystko");
    expect(zrodloPrzelacznika("live")).toBe("live");
  });
});

describe("zrodloDanych (wyliczane, bez kolumny)", () => {
  it("trade w sesji bierze rodzaj sesji, niezaleznie od konta", () => {
    expect(zrodloDanych({ rodzajSesji: "backtest", typKonta: "prop" })).toBe("backtest");
    expect(zrodloDanych({ rodzajSesji: "forward", typKonta: "demo" })).toBe("forward");
    expect(zrodloDanych({ rodzajSesji: "forward", typKonta: "live" })).toBe("forward");
  });
  it("poza sesja: demo i paper to demo, live i prop to live", () => {
    expect(zrodloDanych({ rodzajSesji: null, typKonta: "demo" })).toBe("demo");
    expect(zrodloDanych({ rodzajSesji: null, typKonta: "paper" })).toBe("demo");
    expect(zrodloDanych({ rodzajSesji: null, typKonta: "live" })).toBe("live");
    expect(zrodloDanych({ rodzajSesji: null, typKonta: "prop" })).toBe("live");
  });
  it("sesja bez znanego rodzaju (uszkodzone dane) liczy sie jak backtest, nie jak live", () => {
    expect(zrodloDanych({ rodzajSesji: null, wSesji: true, typKonta: "live" })).toBe("backtest");
  });
});
