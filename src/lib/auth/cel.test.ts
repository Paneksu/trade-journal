import { describe, expect, it } from "vitest";

import { celWAplikacji } from "./cel";

describe("cel przekierowania po logowaniu", () => {
  it("zostawia zwykle sciezki w aplikacji", () => {
    expect(celWAplikacji("/")).toBe("/");
    expect(celWAplikacji("/settings/security")).toBe("/settings/security");
    expect(celWAplikacji("/trades?status=open&strona=2")).toBe("/trades?status=open&strona=2");
    expect(celWAplikacji("/calendar?miesiac=2026-10#dzien")).toBe("/calendar?miesiac=2026-10#dzien");
  });

  it.each([
    ["pusty", ""],
    ["bez ukosnika", "settings"],
    ["adres bezwzgledny", "https://evil.com/"],
    ["adres bez schematu", "//evil.com"],
    ["odwrotny ukosnik", "/\\evil.com"],
    ["odwrotny ukosnik w srodku", "/ok\\@evil.com"],
    ["tabulator miedzy ukosnikami", "/\t/evil.com"],
    ["nowa linia miedzy ukosnikami", "/\n/evil.com"],
    ["powrot karetki", "/\r/evil.com"],
    ["znak zerowy", "/\u0000/evil.com"],
    ["schemat javascript", "javascript:alert(1)"],
    ["schemat data", "data:text/html,x"],
  ])("odrzuca: %s", (_nazwa, cel) => {
    expect(celWAplikacji(cel)).toBe("/");
  });

  it("wynik nigdy nie wychodzi poza origin aplikacji, nawet dla dziwnych ciagow", () => {
    const dziwne = ["/%09/evil.com", "/%2F/evil.com", "/.//evil.com", "/..//evil.com", "/@evil.com", "/%5Cevil.com"];
    for (const cel of dziwne) {
      const wynik = celWAplikacji(cel);
      const u = new URL(wynik, "https://dziennik.panekweb.pl");
      expect(u.origin, `${cel} -> ${wynik}`).toBe("https://dziennik.panekweb.pl");
      expect(wynik.startsWith("//"), `${cel} -> ${wynik}`).toBe(false);
    }
  });
});
