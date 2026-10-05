import { describe, expect, it } from "vitest";

import {
  decyzjaWzgledemMozgu,
  nastepnyWerdykt,
  normalizujWerdyktUzytkownika,
  porownajPlan,
} from "./ocena-ai";

describe("normalizujWerdyktUzytkownika", () => {
  it("przyjmuje agree i disagree, puste i null czyszcza, reszte odrzuca", () => {
    expect(normalizujWerdyktUzytkownika("agree")).toBe("agree");
    expect(normalizujWerdyktUzytkownika("disagree")).toBe("disagree");
    expect(normalizujWerdyktUzytkownika(null)).toBeNull();
    expect(normalizujWerdyktUzytkownika("")).toBeNull();
    expect(normalizujWerdyktUzytkownika("clear")).toBeNull();
    expect(normalizujWerdyktUzytkownika("tak")).toBeUndefined();
    expect(normalizujWerdyktUzytkownika(1)).toBeUndefined();
    expect(normalizujWerdyktUzytkownika({})).toBeUndefined();
  });
});

describe("nastepnyWerdykt", () => {
  it("ten sam przycisk cofa, drugi zmienia, z pustego ustawia", () => {
    expect(nastepnyWerdykt("agree", "agree")).toBeNull();
    expect(nastepnyWerdykt("agree", "disagree")).toBe("disagree");
    expect(nastepnyWerdykt(null, "disagree")).toBe("disagree");
  });
});

describe("porownajPlan", () => {
  it("liczy roznice w tickach i zostawia null, gdy brakuje strony albo ticku", () => {
    const w = porownajPlan(
      { entry: 20000, stopLoss: 19990, takeProfit: "smiec" },
      { entry: 20001, stopLoss: null, takeProfit: 20020 },
      0.25,
    );
    expect(w.map((x) => x.klucz)).toEqual(["entry", "stopLoss", "takeProfit"]);
    expect(w[0]).toMatchObject({ mozg: 20000, uzytkownik: 20001, roznicaTickow: 4 });
    expect(w[1]).toMatchObject({ mozg: 19990, uzytkownik: null, roznicaTickow: null });
    expect(w[2]).toMatchObject({ mozg: null, uzytkownik: 20020, roznicaTickow: null });
    expect(porownajPlan(null, { entry: 1, stopLoss: 1, takeProfit: 1 }, null).every((x) => x.mozg === null)).toBe(true);
    expect(porownajPlan({ entry: 1 }, { entry: 2, stopLoss: null, takeProfit: null }, null)[0].roznicaTickow).toBeNull();
  });
});

describe("decyzjaWzgledemMozgu", () => {
  it("wejdz: zgodna przy wejsciu, odstepstwo przy pominieciu", () => {
    expect(decyzjaWzgledemMozgu("wejdz", "closed").wynik).toBe("zgodna");
    expect(decyzjaWzgledemMozgu("wejdz", "missed").wynik).toBe("odstepstwo");
  });
  it("czekaj i odpusc: odstepstwo przy wejsciu, zgodna przy pominieciu", () => {
    expect(decyzjaWzgledemMozgu("czekaj", "closed").wynik).toBe("odstepstwo");
    expect(decyzjaWzgledemMozgu("odpusc", "open").opis).toContain("odpuścić");
    expect(decyzjaWzgledemMozgu("odpusc", "missed").wynik).toBe("zgodna");
  });
  it("bez werdyktu albo bez wziecia nie ma czego porownac", () => {
    expect(decyzjaWzgledemMozgu(null, "closed").wynik).toBe("brak");
    expect(decyzjaWzgledemMozgu("wejdz", "planned").wynik).toBe("brak");
  });
});
