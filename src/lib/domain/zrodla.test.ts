import { describe, expect, it } from "vitest";

import { czyRodzajSesji, nazwaZrodla, rodzajSesjiZFormularza, zrodloPrzelacznika } from "./zrodla";

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
