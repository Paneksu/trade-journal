import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BladKonfiguracjiBrokera, brokerSkonfigurowany, skrotKonta } from "./klucz";

const SEKRET = "sekret-sesji-do-testu-0123456789abcdef-xyz";
const JAWNY = "A".repeat(43);

function srodowisko(v: { klucz?: string; sekret?: string }) {
  vi.stubEnv("BROKER_ID_HMAC_KEY", v.klucz ?? "");
  vi.stubEnv("SESSION_SECRET", v.sekret ?? "");
}

describe("klucz skrotow kont u brokera", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("bez jawnej zmiennej klucz wynika z SESSION_SECRET (HKDF), jest stabilny i inny niz przy innym sekrecie", () => {
    srodowisko({ sekret: SEKRET });
    const a = skrotKonta("tradovate", "TST00000000001");
    expect(a.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(skrotKonta("tradovate", "TST00000000001")).toEqual(a);
    srodowisko({ sekret: SEKRET + "x" });
    expect(skrotKonta("tradovate", "TST00000000001").hmac).not.toBe(a.hmac);
    expect(brokerSkonfigurowany()).toBe(true);
  });

  it("jawna BROKER_ID_HMAC_KEY ma pierwszenstwo przed SESSION_SECRET", () => {
    srodowisko({ sekret: SEKRET });
    const zSekretu = skrotKonta("tradovate", "K1").hmac;
    srodowisko({ sekret: SEKRET, klucz: JAWNY });
    const zJawnego = skrotKonta("tradovate", "K1").hmac;
    expect(zJawnego).not.toBe(zSekretu);
    srodowisko({ sekret: "inny-sekret-sesji-0123456789abcdef-zzz", klucz: JAWNY });
    expect(skrotKonta("tradovate", "K1").hmac).toBe(zJawnego); // zmiana SESSION_SECRET nie rusza jawnego klucza
  });

  it("bez klucza i bez dlugiego SESSION_SECRET: blad konfiguracji z naprawa, import wylaczony", () => {
    srodowisko({ sekret: "krotki" });
    expect(() => skrotKonta("tradovate", "K1")).toThrow(BladKonfiguracjiBrokera);
    expect(() => skrotKonta("tradovate", "K1")).toThrow(/SESSION_SECRET/);
    expect(brokerSkonfigurowany()).toBe(false);
  });
});
