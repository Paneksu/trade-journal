import { describe, expect, it } from "vitest";

import {
  bramkaN,
  czyImportZSejfu,
  MIN_PROG_N_API,
  maOczekujacaPropozycje,
  nastepnyKodHipotezy,
  nastepnyKodReguly,
  originEfektywny,
  statusReguly,
  type WersjaDoStatusu,
} from "./reguly";

const w = (version: number, status: WersjaDoStatusu["status"]): WersjaDoStatusu => ({ version, status });

describe("statusReguly (wyliczany z wersji)", () => {
  it("sama propozycja = proponowana", () => {
    expect(statusReguly([w(1, "proposed")], false)).toBe("proposed");
  });

  it("zatwierdzona wersja = aktywna, nawet gdy czeka nowa propozycja", () => {
    const wersje = [w(2, "proposed"), w(1, "approved")];
    expect(statusReguly(wersje, false)).toBe("active");
    expect(maOczekujacaPropozycje(wersje)).toBe(true);
  });

  it("wycofanie wygrywa ze wszystkim", () => {
    expect(statusReguly([w(1, "approved")], true)).toBe("retired");
  });

  it("same odrzucone / zastąpione bez zatwierdzonej = odrzucona", () => {
    expect(statusReguly([w(1, "rejected")], false)).toBe("rejected");
    expect(statusReguly([], false)).toBe("rejected");
  });
});

describe("kody", () => {
  it("następny kod reguły bierze najwyższy numer, min. 3 cyfry", () => {
    expect(nastepnyKodReguly([])).toBe("R-001");
    expect(nastepnyKodReguly(["R-004", "R-007", "R-010"])).toBe("R-011");
    expect(nastepnyKodReguly(["R-999"])).toBe("R-1000");
    expect(nastepnyKodReguly(["x", "R-12"])).toBe("R-001");
  });

  it("następny kod hipotezy", () => {
    expect(nastepnyKodHipotezy(["H-001", "H-005"])).toBe("H-006");
  });
});

describe("bramkaN: poniżej progu AI nie proponuje reguły", () => {
  it("AI poniżej progu odpada z faktycznymi liczbami w komunikacie", () => {
    const wynik = bramkaN("ai", 12, 20);
    expect(wynik.ok).toBe(false);
    if (!wynik.ok) expect(wynik.powod).toContain("n = 12");
    if (!wynik.ok) expect(wynik.powod).toContain("20");
  });

  it("AI na progu albo powyżej przechodzi", () => {
    expect(bramkaN("ai", 20, 20)).toEqual({ ok: true });
    expect(bramkaN("ai", 41, 20)).toEqual({ ok: true });
  });

  it("AI bez hipotezy odpada", () => {
    expect(bramkaN("ai", null, null).ok).toBe(false);
  });

  it("mentor i import z sejfu nie mają progu (Słowa użytkownika 14.10.2026: «Bez progu, podpisane n=0»)", () => {
    expect(bramkaN("mentor", 0, 20)).toEqual({ ok: true });
    expect(bramkaN("mentor", null, null)).toEqual({ ok: true });
    expect(bramkaN("vault-import", null, null)).toEqual({ ok: true });
  });
});

describe("originEfektywny: import z sejfu poznaje się po kluczu «vault:»", () => {
  it("vault-import z kluczem vault: zostaje importem", () => {
    expect(originEfektywny("vault-import", "vault:Reguly/R-007.md")).toBe("vault-import");
    expect(czyImportZSejfu("vault-import", "vault:Reguly/R-007.md")).toBe(true);
  });

  it("vault-import bez klucza albo z cudzym kluczem jest traktowany jak ai (decyzja 15.10.2026)", () => {
    for (const ref of [undefined, null, "", "vault:", "inny:klucz", "VAULT:x", "xvault:y"]) {
      expect(originEfektywny("vault-import", ref), String(ref)).toBe("ai");
      expect(czyImportZSejfu("vault-import", ref), String(ref)).toBe(false);
    }
  });

  it("ai i mentor zostają, jakie były; klucz vault: nie czyni z nich importu", () => {
    expect(originEfektywny("ai", "vault:x")).toBe("ai");
    expect(originEfektywny("mentor", "vault:x")).toBe("mentor");
    expect(czyImportZSejfu("mentor", "vault:x")).toBe(false);
  });

  it("najniższy próg n przez API to 20", () => {
    expect(MIN_PROG_N_API).toBe(20);
  });
});
