import { createHmac, hkdfSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BladKonfiguracjiBrokera, brokerSkonfigurowany, skrotKonta, zrodloKluczaKont } from "./klucz";

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

  it("wartosc wzorcowa: HMAC-SHA256(HKDF-SHA256(trim(SESSION_SECRET), sol pusta, info tj-broker-id-v1, 32 B), \"platforma:numer\"); zmiana info, trim albo kodowania wywala test", () => {
    // Oczekiwanie liczone niezaleznie od klucz.ts (wzor: totp.test.ts, klucz glowny z HKDF). Skroty trafiaja do bazy: ich zmiana to zerwanie ciaglosci kont.
    const klucz = Buffer.from(hkdfSync("sha256", Buffer.from(SEKRET.trim(), "utf8"), Buffer.alloc(0), "tj-broker-id-v1", 32));
    const oczekiwany = createHmac("sha256", klucz).update("tradovate:K1", "utf8").digest("hex");
    srodowisko({ sekret: SEKRET });
    expect(skrotKonta("tradovate", "K1").hmac).toBe(oczekiwany);
    // Kontrakt trim: spacje na brzegach SESSION_SECRET nie zmieniaja klucza (D2, audyt HKDF 17.10.2026).
    srodowisko({ sekret: `  ${SEKRET}
` });
    expect(skrotKonta("tradovate", "K1").hmac).toBe(oczekiwany);
    // Numer konta tez jest obcinany; ostatnie 4 znaki bez spacji.
    expect(skrotKonta("tradovate", " K1 ")).toEqual(skrotKonta("tradovate", "K1"));
  });

  it("zrodlo klucza kont: jawna zmienna, SESSION_SECRET albo brak (do ostrzezenia przy starcie)", () => {
    srodowisko({ sekret: SEKRET, klucz: JAWNY });
    expect(zrodloKluczaKont()).toBe("BROKER_ID_HMAC_KEY");
    srodowisko({ sekret: SEKRET });
    expect(zrodloKluczaKont()).toBe("SESSION_SECRET");
    srodowisko({ sekret: "krotki" });
    expect(zrodloKluczaKont()).toBeNull();
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
    expect(() => skrotKonta("tradovate", "K1")).toThrow(/po obcięciu spacji/);
    srodowisko({ sekret: " ".repeat(40) }); // same spacje: po obcieciu pusty sekret
    expect(brokerSkonfigurowany()).toBe(false);
    expect(brokerSkonfigurowany()).toBe(false);
  });
});
