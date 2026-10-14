import { describe, expect, it } from "vitest";

import { najlepszeINajgorsze, siatkaProcesu, type TradeDoSiatki } from "./process-grid";

let seq = 0;
const tr = (processGrade: TradeDoSiatki["processGrade"], wynik: TradeDoSiatki["wynik"], rMultiple: number | null, godzina = 10): TradeDoSiatki => {
  seq += 1;
  return {
    id: seq,
    entryTime: new Date(Date.UTC(2026, 9, 14, godzina, seq % 60)),
    processGrade,
    wynik,
    rMultiple,
    pnlCents: rMultiple === null ? 0 : Math.round(rMultiple * 10_000),
  };
};

describe("siatkaProcesu: 2x2", () => {
  const trades = [
    tr("A", "zysk", 2),
    tr("A", "zysk", 1.5),
    tr("B", "strata", -1), // dobra strata
    tr("A", "strata", -1), // dobra strata
    tr("C", "zysk", 3), // szczescie
    tr("C", "strata", -1),
    tr("C", "strata", -1.2),
    tr("B", "be", 0),
    tr("C", "be", 0.02),
    tr(null, "zysk", 1),
  ];
  const s = siatkaProcesu(trades);

  it("dobry proces = A i B: zasluzony zysk i dobra strata", () => {
    expect(s.zasluzonyZysk.count).toBe(2);
    expect(s.zasluzonyZysk.sumR).toBeCloseTo(3.5, 12);
    expect(s.dobraStrata.count).toBe(2);
    expect(s.dobraStrata.avgR).toBeCloseTo(-1, 12);
  });

  it("zly proces = C: szczescie (zysk) i zasluzona strata", () => {
    expect(s.szczescie.count).toBe(1);
    expect(s.szczescie.sumR).toBe(3);
    expect(s.zasluzonaStrata.count).toBe(2);
    expect(s.zasluzonaStrata.sumR).toBeCloseTo(-2.2, 12);
  });

  it("BE ma wlasne komorki, a nieocenione nie wchodza do siatki", () => {
    expect(s.beDobryProces.count).toBe(1);
    expect(s.beZlyProces.count).toBe(1);
    expect(s.nieocenione.count).toBe(1);
    expect(s.ocenione).toBe(9);
    const wSiatce =
      s.zasluzonyZysk.count + s.dobraStrata.count + s.szczescie.count + s.zasluzonaStrata.count + s.beDobryProces.count + s.beZlyProces.count;
    expect(wSiatce).toBe(s.ocenione);
  });

  it("rozklad A/B/C z udzialami i koszt gry C w R i $", () => {
    expect(s.rozklad.A.count).toBe(3);
    expect(s.rozklad.B.count).toBe(2);
    expect(s.rozklad.C.count).toBe(4);
    expect(s.rozklad.C.udzial).toBeCloseTo(4 / 9, 12);
    expect(s.kosztGryC.count).toBe(4);
    expect(s.kosztGryC.sumR).toBeCloseTo(3 - 1 - 1.2 + 0.02, 12);
    expect(s.kosztGryC.sumPnlCents).toBe(30_000 - 10_000 - 12_000 + 200);
  });

  it("dobryProces tylko A: B przechodzi na strone zlego procesu", () => {
    const wezsza = siatkaProcesu(trades, ["A"]);
    expect(wezsza.dobraStrata.count).toBe(1);
    expect(wezsza.zasluzonaStrata.count).toBe(3);
    expect(wezsza.beZlyProces.count).toBe(2);
  });

  it("trade bez R liczy sie do liczby, nie do sredniej R", () => {
    const x = siatkaProcesu([tr("A", "zysk", 2), tr("A", "zysk", null)]);
    expect(x.zasluzonyZysk.count).toBe(2);
    expect(x.zasluzonyZysk.countR).toBe(1);
    expect(x.zasluzonyZysk.avgR).toBe(2);
  });

  it("pusta lista: zera i null, bez dzielenia przez zero", () => {
    const x = siatkaProcesu([]);
    expect(x.ocenione).toBe(0);
    expect(x.rozklad.A.udzial).toBeNull();
    expect(x.zasluzonyZysk.avgR).toBeNull();
    expect(x.kosztGryC).toEqual({ count: 0, sumR: 0, sumPnlCents: 0 });
  });
});

describe("najlepszeINajgorsze wg procesu, nie wyniku", () => {
  it("3 najlepsze to A, 3 najgorsze to C; wynik nie rozstrzyga", () => {
    const trades = [
      tr("C", "zysk", 5, 9), // C z wielkim zyskiem nadal jest najgorszy procesowo
      tr("A", "strata", -3, 10),
      tr("A", "zysk", 1, 11),
      tr("B", "zysk", 1, 12),
      tr("C", "strata", -1, 13),
      tr("A", "strata", -1, 14),
      tr("B", "strata", -1, 15),
      tr("C", "strata", -1, 16),
    ];
    const { najlepsze, najgorsze } = najlepszeINajgorsze(trades, 3);
    const grade = (id: number) => trades.find((t) => t.id === id)!.processGrade;
    expect(najlepsze.map(grade)).toEqual(["A", "A", "A"]);
    expect(najgorsze.map(grade)).toEqual(["C", "C", "C"]);
    expect(new Set([...najlepsze, ...najgorsze]).size).toBe(6);
  });

  it("remis rozstrzyga czas wejscia, a nie R", () => {
    const wczesny = tr("A", "strata", -5, 9);
    const pozny = tr("A", "zysk", 5, 15);
    const { najlepsze } = najlepszeINajgorsze([pozny, wczesny], 1);
    expect(najlepsze).toEqual([wczesny.id]);
  });

  it("nieocenione sie nie licza; przy 3 ocenionych listy sie nie pokrywaja", () => {
    const a = tr("A", "zysk", 1);
    const b = tr("B", "zysk", 1);
    const c = tr("C", "zysk", 1);
    const wynik = najlepszeINajgorsze([tr(null, "zysk", 9), a, b, c], 3);
    expect(wynik.najlepsze).toEqual([a.id, b.id]);
    expect(wynik.najgorsze).toEqual([c.id]);
  });

  it("brak ocenionych = puste listy", () => {
    expect(najlepszeINajgorsze([tr(null, "zysk", 1)])).toEqual({ najlepsze: [], najgorsze: [] });
  });
});
