import { describe, expect, it } from "vitest";

import { statyZgodnosci, type SprawdzenieRegulyDoStatystyk as S, type Werdykt } from "./zgodnosc";

function s(tradeId: number, ruleId: string, verdict: Werdykt, r: number | null = null, extra: Partial<S> = {}): S {
  return { tradeId, ruleId, ruleText: `tresc ${ruleId}`, verdict, userVerdict: null, rMultiple: r, ...extra };
}

describe("statyZgodnosci", () => {
  it("bez danych: zera i null zamiast dzielenia przez zero", () => {
    const w = statyZgodnosci([]);
    expect(w.reguly).toEqual({ ocenione: 0, zgodne: 0, niezgodne: 0, nieocenione: 0, zgodnoscPct: null });
    expect(w.trady.zgodnoscPct).toBeNull();
    expect(w.poRegule).toEqual([]);
    expect(w.zgodaUzytkownika.zgodaPct).toBeNull();
  });

  it("mianownik to tylko pass + fail; na i unclear ida do nieocenionych", () => {
    const w = statyZgodnosci([
      s(1, "R-1", "pass"),
      s(1, "R-2", "pass"),
      s(1, "R-3", "fail"),
      s(1, "R-4", "na"),
      s(1, "R-5", "unclear"),
    ]);
    expect(w.reguly).toEqual({ ocenione: 3, zgodne: 2, niezgodne: 1, nieocenione: 2, zgodnoscPct: 66.7 });
  });

  it("gdyby na/unclear wchodzily do mianownika, wynik bylby inny (zabezpieczenie przed regresja)", () => {
    const w = statyZgodnosci([s(1, "R-1", "pass"), s(1, "R-2", "na"), s(1, "R-3", "na"), s(1, "R-4", "unclear")]);
    expect(w.reguly.zgodnoscPct).toBe(100);
    expect(w.reguly.nieocenione).toBe(3);
  });

  it("trade jest zgodny, gdy nie ma zadnego fail; trade z samymi na/unclear jest nieoceniony", () => {
    const w = statyZgodnosci(
      [
        s(1, "R-1", "pass"),
        s(1, "R-2", "pass"),
        s(2, "R-1", "pass"),
        s(2, "R-2", "fail"),
        s(3, "R-1", "na"),
        s(3, "R-2", "unclear"),
      ],
      2,
    );
    expect(w.trady).toEqual({ ocenione: 2, zgodne: 1, niezgodne: 1, nieocenione: 3, zgodnoscPct: 50 });
  });

  it("statystyki regul: licznik per regula, srednie R przy dotrzymaniu i zlamaniu, sort po zlamaniach", () => {
    const w = statyZgodnosci([
      s(1, "R-1", "pass", 2),
      s(2, "R-1", "pass", 1),
      s(3, "R-1", "fail", -1),
      s(4, "R-1", "fail", null),
      s(1, "R-2", "fail", 2),
      s(2, "R-2", "fail", -1),
      s(3, "R-2", "fail", -1),
    ]);
    expect(w.poRegule.map((r) => r.ruleId)).toEqual(["R-2", "R-1"]);
    const r1 = w.poRegule.find((r) => r.ruleId === "R-1")!;
    expect(r1.zgodnoscPct).toBe(50);
    expect(r1.sredniaRPrzyDotrzymaniu).toBe(1.5);
    expect(r1.sredniaRPrzyZlamaniu).toBe(-1);
    expect(r1.probaRPrzyZlamaniu).toBe(1); // wiersz bez R nie wchodzi do sredniej
    expect(w.poRegule[0].sredniaRPrzyDotrzymaniu).toBeNull();
  });

  it("zgoda uzytkownika liczy sie tylko z wypowiedzi", () => {
    const w = statyZgodnosci([
      s(1, "R-1", "pass", null, { userVerdict: "agree" }),
      s(1, "R-2", "fail", null, { userVerdict: "disagree" }),
      s(1, "R-3", "pass", null, { userVerdict: "agree" }),
      s(1, "R-4", "pass"),
    ]);
    expect(w.zgodaUzytkownika).toEqual({ wypowiedzi: 3, zgadzaSie: 2, niezgadzaSie: 1, zgodaPct: 66.7 });
  });
});
