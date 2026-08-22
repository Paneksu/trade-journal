import { describe, expect, it } from "vitest";

import { bladLimitu, MAX_ZRZUTOW } from "./screenshots-limit";

/*
 * Limit liczony jest w dwoch miejscach - w przegladarce i na serwerze - wiec
 * rachunek musi byc jeden. Test pilnuje przede wszystkim tego, ze paczka
 * przekraczajaca limit jest odrzucana w calosci i ze uzytkownik dostaje
 * liczbe wolnych miejsc, a nie samo "nie da sie".
 */

describe("bladLimitu", () => {
  it("przepuszcza paczke rowna limitowi", () => {
    expect(bladLimitu(0, MAX_ZRZUTOW)).toBeNull();
  });

  it("przepuszcza dokladne dopelnienie do limitu", () => {
    expect(bladLimitu(6, 2)).toBeNull();
  });

  it("odrzuca paczke o jedno za duza", () => {
    expect(bladLimitu(0, MAX_ZRZUTOW + 1)).not.toBeNull();
  });

  it("podaje, ile miejsc zostalo", () => {
    const blad = bladLimitu(6, 5);
    expect(blad).toContain("jeszcze 2");
    expect(blad).toContain("już 6");
  });

  it("przy komplecie prosi o usuniecie, a nie o mniejsza paczke", () => {
    const blad = bladLimitu(MAX_ZRZUTOW, 1);
    expect(blad).toContain("Usuń");
    expect(blad).not.toContain("jeszcze");
  });

  it("nie glupieje, gdy w bazie jest wiecej niz limit", () => {
    expect(bladLimitu(MAX_ZRZUTOW + 3, 1)).toContain("Usuń");
  });
});
