import { describe, expect, it } from "vitest";

import {
  ekwiwalentNqNaKontrakt,
  kwotaUsd,
  lacznaEkspozycjaNq,
  ostrzezenieKontraktow,
  podstawaTrailingu,
  poziomZuzycia,
  stanKonta,
  znaczenieConsistency,
  type TransakcjaKonta,
  type ZasadyKonta,
} from "./prop";

const START = 5_000_000; // 50 000 USD w centach

const zasady = (nadpisz: Partial<ZasadyKonta> = {}): ZasadyKonta => ({
  ddType: "static",
  maxDdCents: 200_000,
  ddLockCents: null,
  dailyLossCents: null,
  profitTargetCents: null,
  consistencyPct: null,
  minDays: null,
  maxContractsMini: null,
  maxContractsMicro: null,
  extra: {},
  ...nadpisz,
});

const t = (dzien: string, pnlCents: number, godzina = 15): TransakcjaKonta => ({
  dzien,
  czas: new Date(`${dzien}T${String(godzina).padStart(2, "0")}:00:00Z`),
  pnlCents,
});

describe("static: prog stoi w miejscu", () => {
  it("bez trade'ow bufor = max DD", () => {
    const s = stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [], dzis: "2026-10-14" });
    expect(s.progDdCents).toBe(START - 200_000);
    expect(s.buforDdCents).toBe(200_000);
    expect(s.zuzycieDd).toBe(0);
    expect(s.ostrzezenia).toEqual([]);
  });

  it("zysk nie podnosi progu: bufor rosnie o zysk", () => {
    const s = stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [t("2026-10-01", 300_000)], dzis: "2026-10-14" });
    expect(s.progDdCents).toBe(START - 200_000);
    expect(s.buforDdCents).toBe(500_000);
    expect(s.zuzycieDd).toBe(0);
  });

  it("strata zmniejsza bufor, prog bez zmian", () => {
    const s = stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [t("2026-10-01", -120_000)], dzis: "2026-10-14" });
    expect(s.buforDdCents).toBe(80_000);
    expect(s.zuzycieDd).toBeCloseTo(0.6, 12);
  });
});

describe("eod trailing: prog rosnie po ZAKONCZONYCH dniach", () => {
  const z = zasady({ ddType: "eod" });

  it("po zysku z poprzedniego dnia prog idzie w gore, bufor liczony od nowego progu", () => {
    const s = stanKonta({
      zasady: z,
      saldoStartCents: START,
      transakcje: [t("2026-10-01", 80_000), t("2026-10-02", -30_000)],
      dzis: "2026-10-03",
    });
    expect(s.podstawaTrailingu).toBe("eod");
    expect(s.szczytCents).toBe(START + 80_000);
    expect(s.progDdCents).toBe(START + 80_000 - 200_000);
    expect(s.buforDdCents).toBe(START + 50_000 - (START + 80_000 - 200_000));
    expect(s.buforDdCents).toBe(170_000);
    expect(s.zuzycieDd).toBeCloseTo(0.15, 12);
  });

  it("biezacy dzien NIE podnosi progu (EOD liczy sie po zamknieciu dnia)", () => {
    const s = stanKonta({ zasady: z, saldoStartCents: START, transakcje: [t("2026-10-14", 100_000)], dzis: "2026-10-14" });
    expect(s.progDdCents).toBe(START - 200_000);
    expect(s.buforDdCents).toBe(300_000);
  });

  it("bez 'dzis' (podglad po sesji) liczy takze ostatni dzien", () => {
    const s = stanKonta({ zasady: z, saldoStartCents: START, transakcje: [t("2026-10-14", 100_000)], dzis: null });
    expect(s.progDdCents).toBe(START + 100_000 - 200_000);
  });

  it("w ramach dnia szczyt chwilowy nie ma znaczenia, liczy sie saldo na koniec dnia", () => {
    const s = stanKonta({
      zasady: z,
      saldoStartCents: START,
      transakcje: [t("2026-10-01", 150_000, 10), t("2026-10-01", -130_000, 14)],
      dzis: "2026-10-02",
    });
    expect(s.szczytCents).toBe(START + 20_000);
  });
});

describe("intraday trailing: prog rosnie po kazdym trade'ie", () => {
  it("szczyt z polowy dnia podnosi prog od razu", () => {
    const s = stanKonta({
      zasady: zasady({ ddType: "intraday" }),
      saldoStartCents: START,
      transakcje: [t("2026-10-14", 150_000, 10), t("2026-10-14", -130_000, 14)],
      dzis: "2026-10-14",
    });
    expect(s.podstawaTrailingu).toBe("intraday");
    expect(s.szczytCents).toBe(START + 150_000);
    expect(s.progDdCents).toBe(START + 150_000 - 200_000);
    expect(s.buforDdCents).toBe(START + 20_000 - (START - 50_000));
    expect(s.buforDdCents).toBe(70_000);
    expect(s.uwagi.some((u) => u.includes("Szczyt intraday"))).toBe(true);
  });

  it("ten sam przebieg: EOD ma wiekszy bufor niz intraday (rozni sie podstawa, nie dane)", () => {
    const trades = [t("2026-10-14", 150_000, 10), t("2026-10-14", -130_000, 14)];
    const eod = stanKonta({ zasady: zasady({ ddType: "eod" }), saldoStartCents: START, transakcje: trades, dzis: "2026-10-14" });
    const intra = stanKonta({ zasady: zasady({ ddType: "intraday" }), saldoStartCents: START, transakcje: trades, dzis: "2026-10-14" });
    expect(eod.buforDdCents).toBeGreaterThan(intra.buforDdCents);
  });
});

describe("trailing_to_static: trailing do progu, potem prog stoi", () => {
  // Topstep Combine 50K: max DD 2000 USD, blokada przy zysku 2000 USD -> prog zatrzymuje sie na saldzie startowym.
  const z = zasady({ ddType: "trailing_to_static", maxDdCents: 200_000, ddLockCents: 200_000, extra: { trail_basis: "eod" } });

  it("przed blokada rosnie jak trailing", () => {
    const s = stanKonta({ zasady: z, saldoStartCents: START, transakcje: [t("2026-10-01", 100_000)], dzis: "2026-10-02" });
    expect(s.progDdCents).toBe(START + 100_000 - 200_000);
    expect(s.progZablokowany).toBe(false);
  });

  it("po osiagnieciu zysku blokady prog stoi na saldzie startowym, dalszy zysk go nie rusza", () => {
    const s = stanKonta({
      zasady: z,
      saldoStartCents: START,
      transakcje: [t("2026-10-01", 250_000), t("2026-10-02", 100_000)],
      dzis: "2026-10-03",
    });
    expect(s.progDdCents).toBe(START);
    expect(s.progZablokowany).toBe(true);
    expect(s.buforDdCents).toBe(350_000);
  });

  it("blokada 'start + 100 USD' (Lucid: DD + 100 USD) daje prog = start + 100 USD", () => {
    const lucid = zasady({ ddType: "trailing_to_static", maxDdCents: 300_000, ddLockCents: 310_000, extra: { trail_basis: "eod" } });
    const s = stanKonta({ zasady: lucid, saldoStartCents: 10_000_000, transakcje: [t("2026-10-01", 600_000)], dzis: "2026-10-02" });
    expect(s.progDdCents).toBe(10_000_000 + 10_000);
  });

  it("wymaga zysku blokady (inaczej to nie ten typ)", () => {
    expect(() => stanKonta({ zasady: zasady({ ddType: "trailing_to_static", ddLockCents: null }), saldoStartCents: START, transakcje: [], dzis: null })).toThrow(/wymaga ddLockCents/);
  });

  it("podstawa trailingu z extra.trail_basis; niejednoznaczna = ostrozniej (intraday) z uwaga", () => {
    expect(podstawaTrailingu("trailing_to_static", { trail_basis: "eod" })).toEqual({ podstawa: "eod", pewna: true });
    expect(podstawaTrailingu("trailing_to_static", { trail_basis: "intraday od szczytu equity" })).toEqual({ podstawa: "intraday", pewna: true });
    expect(podstawaTrailingu("trailing_to_static", { trail_basis: "eod lub intraday (wybór przy zakupie evalu)" })).toEqual({ podstawa: "intraday", pewna: false });
    expect(podstawaTrailingu("trailing_to_static", {})).toEqual({ podstawa: "intraday", pewna: false });
    const s = stanKonta({ zasady: zasady({ ddType: "trailing_to_static", ddLockCents: 200_000 }), saldoStartCents: START, transakcje: [], dzis: null });
    expect(s.podstawaPewna).toBe(false);
    expect(s.uwagi.some((u) => u.includes("nie jest jednoznaczna"))).toBe(true);
  });
});

describe("ostrzezenia 50/75/90% (tylko ostrzezenia, bez blokad)", () => {
  const wDd = (strata: number) =>
    stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [t("2026-10-14", -strata)], dzis: "2026-10-14" });

  it("progi: 49,9% brak, 50% -> 50, 75% -> 75, 90% -> 90, 100% -> 100", () => {
    expect(wDd(99_800).ostrzezenia).toEqual([]);
    expect(wDd(100_000).ostrzezenia.map((o) => o.poziom)).toEqual([50]);
    expect(wDd(149_000).ostrzezenia.map((o) => o.poziom)).toEqual([50]);
    expect(wDd(150_000).ostrzezenia.map((o) => o.poziom)).toEqual([75]);
    expect(wDd(180_000).ostrzezenia.map((o) => o.poziom)).toEqual([90]);
    expect(wDd(200_000).ostrzezenia.map((o) => o.poziom)).toEqual([100]);
    expect(wDd(260_000).ostrzezenia.map((o) => o.poziom)).toEqual([100]);
  });

  it("tekst ostrzezenia ma liczby: wykorzystane %, limit i bufor", () => {
    const o = wDd(150_000).ostrzezenia[0];
    expect(o.kod).toBe("dd");
    expect(o.tekst).toContain("75%");
    expect(o.tekst).toContain("2 000,00 USD");
    expect(o.tekst).toContain("500,00 USD");
  });

  it("dzienny limit straty liczy sie z dzisiejszego wyniku, nie z historii", () => {
    const z = zasady({ dailyLossCents: 100_000 });
    const wczoraj = stanKonta({ zasady: z, saldoStartCents: START, transakcje: [t("2026-10-13", -90_000)], dzis: "2026-10-14" });
    expect(wczoraj.zuzycieDll).toBe(0);
    expect(wczoraj.buforDllCents).toBe(100_000);
    const dzis = stanKonta({ zasady: z, saldoStartCents: START, transakcje: [t("2026-10-14", -75_000)], dzis: "2026-10-14" });
    expect(dzis.zuzycieDll).toBeCloseTo(0.75, 12);
    expect(dzis.ostrzezenia.find((o) => o.kod === "dll")?.poziom).toBe(75);
    expect(dzis.buforDllCents).toBe(25_000);
  });

  it("najblizszy limit to mniejszy z buforow (DD vs DLL)", () => {
    const s = stanKonta({ zasady: zasady({ dailyLossCents: 100_000 }), saldoStartCents: START, transakcje: [t("2026-10-14", -60_000)], dzis: "2026-10-14" });
    expect(s.buforDdCents).toBe(140_000);
    expect(s.buforDllCents).toBe(40_000);
    expect(s.najblizszyLimit).toBe("dll");
    expect(s.buforCents).toBe(40_000);
  });

  it("zysk dnia zwieksza bufor dzienny", () => {
    const s = stanKonta({ zasady: zasady({ dailyLossCents: 100_000 }), saldoStartCents: START, transakcje: [t("2026-10-14", 30_000)], dzis: "2026-10-14" });
    expect(s.buforDllCents).toBe(130_000);
    expect(s.zuzycieDll).toBe(0);
  });

  it("opcjonalny DLL (niewybrany) nie daje bufora, tylko uwage", () => {
    const s = stanKonta({ zasady: zasady({ extra: { dll_optional_usd: 1000 } }), saldoStartCents: START, transakcje: [], dzis: null });
    expect(s.buforDllCents).toBeNull();
    expect(s.uwagi.some((u) => u.includes("opcjonalny"))).toBe(true);
  });

  it("poziomZuzycia: granice domkniete od dolu", () => {
    expect(poziomZuzycia(0.4999)).toBeNull();
    expect(poziomZuzycia(0.5)).toBe(50);
    expect(poziomZuzycia(0.7499)).toBe(50);
    expect(poziomZuzycia(0.75)).toBe(75);
    expect(poziomZuzycia(0.9)).toBe(90);
    expect(poziomZuzycia(1)).toBe(100);
  });
});

describe("bufor 'gdy trafi SL' w $ i w R", () => {
  it("bufor 500 USD, ryzyko 600 USD: SL przekroczylby limit", () => {
    const s = stanKonta({
      zasady: zasady(),
      saldoStartCents: START,
      transakcje: [t("2026-10-14", -150_000)],
      dzis: "2026-10-14",
      ryzykoPlanuCents: 60_000,
    });
    expect(s.buforDdCents).toBe(50_000);
    expect(s.poSl).not.toBeNull();
    expect(s.poSl!.buforDdPoSlCents).toBe(-10_000);
    expect(s.poSl!.przekroczy).toBe(true);
    expect(s.poSl!.buforWR).toBeCloseTo(50_000 / 60_000, 12);
    const o = s.ostrzezenia.find((x) => x.kod === "po_sl_dd");
    expect(o?.poziom).toBe(100);
    expect(o?.tekst).toContain("przekroczysz limit drawdownu");
  });

  it("bufor w R: 2000 USD przy ryzyku 250 USD to 8 R", () => {
    const s = stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [], dzis: "2026-10-14", ryzykoPlanuCents: 25_000 });
    expect(s.poSl!.buforDdWR).toBe(8);
    expect(s.poSl!.buforWR).toBe(8);
    expect(s.poSl!.przekroczy).toBe(false);
    expect(s.poSl!.buforDdPoSlCents).toBe(175_000);
    expect(s.ostrzezenia).toEqual([]);
  });

  it("po SL mozna wejsc na prog 75% mimo braku ostrzezenia teraz", () => {
    const s = stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [t("2026-10-14", -100_000)], dzis: "2026-10-14", ryzykoPlanuCents: 50_000 });
    expect(s.ostrzezenia.map((o) => `${o.kod}:${o.poziom}`)).toEqual(["dd:50", "po_sl_dd:75"]);
  });

  it("DLL po SL: bufor dzienny pomniejszony o ryzyko, w R", () => {
    const s = stanKonta({
      zasady: zasady({ dailyLossCents: 100_000 }),
      saldoStartCents: START,
      transakcje: [t("2026-10-14", -70_000)],
      dzis: "2026-10-14",
      ryzykoPlanuCents: 40_000,
    });
    expect(s.poSl!.buforDllPoSlCents).toBe(-10_000);
    expect(s.poSl!.przekroczy).toBe(true);
    expect(s.poSl!.buforDllWR).toBeCloseTo(30_000 / 40_000, 12);
    expect(s.ostrzezenia.some((o) => o.kod === "po_sl_dll" && o.poziom === 100)).toBe(true);
  });

  it("ryzyko musi byc dodatnia liczba calkowita w centach", () => {
    expect(() => stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [], dzis: null, ryzykoPlanuCents: 0 })).toThrow(/ryzykoPlanuCents/);
    expect(() => stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [], dzis: null, ryzykoPlanuCents: 12.5 })).toThrow(/z computeTrade, jest 12.5/);
  });
});

describe("consistency: trzy znaczenia podstawy i trzy skutki", () => {
  it("rozpoznaje podstawe i skutek z opisow presetow", () => {
    expect(znaczenieConsistency({ consistency_basis: "best_day/total_profit", consistency_effect: "raise_target (cel = najlepszy dzień/0,55), nie oblewa" })).toEqual({ podstawa: "total", skutek: "raise_target", pewne: true });
    expect(znaczenieConsistency({ consistency_basis: "żaden dzień >= 50% CELU zysku", consistency_effect: "fail (pass wymaga <= 50%)" })).toEqual({ podstawa: "goal", skutek: "fail", pewne: true });
    expect(znaczenieConsistency({ consistency_basis: "największy dzień/zysk w cyklu wypłaty; 40% dla kont od 2025-11-28", consistency_effect: "block_payout" })).toEqual({ podstawa: "cycle", skutek: "block_payout", pewne: true });
    expect(znaczenieConsistency({ consistency_basis: "największy dzień/zysk netto od ostatniego żądania wypłaty < 40%", consistency_effect: "block_payout" }).podstawa).toBe("cycle");
    expect(znaczenieConsistency({ consistency_basis: "największy dzień/łączny zysk netto, reset po wypłacie" }).podstawa).toBe("cycle");
    expect(znaczenieConsistency({ consistency_basis: "największy dzień/łączny zysk" }).podstawa).toBe("total");
    expect(znaczenieConsistency({ consistency_effect: "nie oblewa, handluj dalej" }).skutek).toBe("brak");
  });

  it("brak opisu = niepewne, domyslnie lacznie / nieznany", () => {
    expect(znaczenieConsistency({})).toEqual({ podstawa: "total", skutek: "nieznany", pewne: false });
  });

  it("jawne pola uzytkownika wygrywaja z opisem presetu", () => {
    const w = znaczenieConsistency({ consistency_basis: "największy dzień/łączny zysk", consistency_effect: "fail", consistency_basis_kind: "goal", consistency_effect_kind: "block_payout" });
    expect(w).toEqual({ podstawa: "goal", skutek: "block_payout", pewne: true });
  });

  const tot = zasady({ consistencyPct: 55, extra: { consistency_basis: "best_day/total_profit", consistency_effect: "raise_target (cel...)" }, profitTargetCents: 300_000 });

  it("laczny zysk: najlepszy dzien 100 z 200 = 50% < 55%, na granicy, cel podniesiony do 100/0,55", () => {
    const s = stanKonta({ zasady: tot, saldoStartCents: START, transakcje: [t("2026-10-01", 10_000), t("2026-10-02", 5_000), t("2026-10-03", 5_000)], dzis: "2026-10-04" });
    const c = s.consistency!;
    expect(c.udzial).toBeCloseTo(0.5, 12);
    expect(c.naruszona).toBe(false);
    expect(c.naGranicy).toBe(true);
    expect(c.skutek).toBe("raise_target");
    expect(c.wymaganyCelCents).toBe(Math.ceil(10_000 / 0.55));
    expect(s.ostrzezenia.find((o) => o.kod === "consistency")?.poziom).toBe(90);
  });

  it("laczny zysk: 20 z 30 = 66,7% > 55% to naruszenie", () => {
    const s = stanKonta({ zasady: tot, saldoStartCents: START, transakcje: [t("2026-10-01", 20_000), t("2026-10-02", 5_000), t("2026-10-03", 5_000)], dzis: "2026-10-04" });
    expect(s.consistency!.naruszona).toBe(true);
    expect(s.ostrzezenia.find((o) => o.kod === "consistency")?.poziom).toBe(100);
    expect(s.ostrzezenia.find((o) => o.kod === "consistency")?.tekst).toContain("podnosi cel zysku");
  });

  it("zysk laczny netto: strata obniza mianownik", () => {
    const s = stanKonta({ zasady: tot, saldoStartCents: START, transakcje: [t("2026-10-01", 20_000), t("2026-10-02", -10_000)], dzis: "2026-10-04" });
    expect(s.consistency!.mianownikCents).toBe(10_000);
    expect(s.consistency!.udzial).toBe(2);
  });

  it("bez zysku (zysk netto <= 0) udzial jest null, nie dzielenie przez zero", () => {
    const s = stanKonta({ zasady: tot, saldoStartCents: START, transakcje: [t("2026-10-01", -5_000)], dzis: "2026-10-02" });
    expect(s.consistency!.udzial).toBeNull();
    expect(s.consistency!.naruszona).toBe(false);
  });

  it("podstawa 'cel' (Take Profit Trader): najlepszy dzien wzgledem CELU, nie zysku", () => {
    const tpt = zasady({ consistencyPct: 50, profitTargetCents: 300_000, extra: { consistency_basis: "żaden dzień >= 50% CELU zysku", consistency_effect: "fail (tylko eval)" } });
    const s = stanKonta({ zasady: tpt, saldoStartCents: START, transakcje: [t("2026-10-01", 160_000), t("2026-10-02", 10_000)], dzis: "2026-10-03" });
    expect(s.consistency!.podstawa).toBe("goal");
    expect(s.consistency!.mianownikCents).toBe(300_000);
    expect(s.consistency!.udzial).toBeCloseTo(160_000 / 300_000, 12);
    expect(s.consistency!.naruszona).toBe(true);
    // Przy zysku lacznym 170 000 ten sam dzien dalby 94% - inny wynik, bo inna podstawa.
  });

  it("podstawa 'cykl': dni do ostatniej wyplaty sie nie licza", () => {
    const lucid = zasady({ consistencyPct: 40, extra: { consistency_basis: "największy dzień/zysk w cyklu wypłaty", consistency_effect: "block_payout" } });
    const trades = [t("2026-09-20", 500_000), t("2026-10-05", 30_000), t("2026-10-06", 30_000), t("2026-10-07", 30_000)];
    const bezWyplaty = stanKonta({ zasady: lucid, saldoStartCents: START, transakcje: trades, dzis: "2026-10-08" });
    expect(bezWyplaty.consistency!.naruszona).toBe(true);
    const poWyplacie = stanKonta({ zasady: lucid, saldoStartCents: START, transakcje: trades, dzis: "2026-10-08", ostatniaWyplata: "2026-10-01" });
    expect(poWyplacie.consistency!.mianownikCents).toBe(90_000);
    expect(poWyplacie.consistency!.udzial).toBeCloseTo(1 / 3, 12);
    expect(poWyplacie.consistency!.naruszona).toBe(false);
  });

  it("zostalo dzis: ile mozna jeszcze zarobic, zeby dzien nie zlamal zasady (40%: p <= 2/3 reszty)", () => {
    const z = zasady({ consistencyPct: 40, extra: { consistency_basis: "największy dzień/łączny zysk", consistency_effect: "block_payout" } });
    const s = stanKonta({ zasady: z, saldoStartCents: START, transakcje: [t("2026-10-01", 60_000), t("2026-10-02", 60_000), t("2026-10-14", 30_000)], dzis: "2026-10-14" });
    // reszta = 120 000, dozwolone p <= 0,4/0,6 * 120 000 = 80 000, dzis 30 000, zostalo 50 000
    expect(s.consistency!.zostaloDzisCents).toBe(50_000);
    const przekroczone = stanKonta({ zasady: z, saldoStartCents: START, transakcje: [t("2026-10-01", 60_000), t("2026-10-14", 90_000)], dzis: "2026-10-14" });
    expect(przekroczone.consistency!.zostaloDzisCents).toBeLessThan(0);
    expect(przekroczone.consistency!.naruszona).toBe(true);
  });

  it("brak consistency w regulach = brak sekcji", () => {
    expect(stanKonta({ zasady: zasady(), saldoStartCents: START, transakcje: [], dzis: null }).consistency).toBeNull();
  });

  it("niepewne znaczenie daje uwage", () => {
    const s = stanKonta({ zasady: zasady({ consistencyPct: 30 }), saldoStartCents: START, transakcje: [t("2026-10-01", 1000)], dzis: "2026-10-02" });
    expect(s.uwagi.some((u) => u.includes("consistency nie jest jednoznaczne"))).toBe(true);
  });
});

describe("cel zysku i minimalna liczba dni", () => {
  it("brakuje do celu, dni handlowe vs minimum", () => {
    const s = stanKonta({
      zasady: zasady({ profitTargetCents: 300_000, minDays: 5 }),
      saldoStartCents: START,
      transakcje: [t("2026-10-01", 100_000), t("2026-10-01", 20_000), t("2026-10-02", 30_000)],
      dzis: "2026-10-03",
    });
    expect(s.cel).toEqual({ zyskCents: 150_000, celCents: 300_000, brakCents: 150_000, osiagniety: false });
    expect(s.dniHandlowe).toBe(2);
    expect(s.minDni).toEqual({ wymagane: 5, mamy: 2, spelnione: false });
  });
});

describe("walidacja wejscia", () => {
  it("odrzuca maxDd <= 0, niecalkowite centy i nieznany typ z komunikatem z wartoscia", () => {
    expect(() => stanKonta({ zasady: zasady({ maxDdCents: 0 }), saldoStartCents: START, transakcje: [], dzis: null })).toThrow(/maxDdCents.*jest 0/);
    expect(() => stanKonta({ zasady: zasady({ dailyLossCents: 10.5 }), saldoStartCents: START, transakcje: [], dzis: null })).toThrow(/dailyLossCents.*10.5/);
    expect(() => stanKonta({ zasady: zasady({ ddType: "weird" as never }), saldoStartCents: START, transakcje: [], dzis: null })).toThrow(/»weird« nieznany/);
    expect(() => stanKonta({ zasady: zasady(), saldoStartCents: 1.5, transakcje: [], dzis: null })).toThrow(/saldoStartCents/);
  });

  it("kolejnosc trade'ow w ramach dnia: wedlug czasu, nie wedlug kolejnosci na liscie", () => {
    const rosnaco = [t("2026-10-14", 150_000, 10), t("2026-10-14", -130_000, 14)];
    const odwrotnie = [...rosnaco].reverse();
    const a = stanKonta({ zasady: zasady({ ddType: "intraday" }), saldoStartCents: START, transakcje: rosnaco, dzis: "2026-10-14" });
    const b = stanKonta({ zasady: zasady({ ddType: "intraday" }), saldoStartCents: START, transakcje: odwrotnie, dzis: "2026-10-14" });
    expect(b.szczytCents).toBe(a.szczytCents);
  });
});

describe("laczna ekspozycja NQ na kontach", () => {
  it("rozpoznaje NQ, MNQ i symbole z platform", () => {
    expect(ekwiwalentNqNaKontrakt("NQ")).toBe(1);
    expect(ekwiwalentNqNaKontrakt("mnq")).toBe(0.1);
    expect(ekwiwalentNqNaKontrakt("NQ1!")).toBe(1);
    expect(ekwiwalentNqNaKontrakt("MNQ1!")).toBe(0.1);
    expect(ekwiwalentNqNaKontrakt("NQZ6")).toBe(1);
    expect(ekwiwalentNqNaKontrakt("MNQH2026")).toBe(0.1);
    expect(ekwiwalentNqNaKontrakt("ES")).toBeNull();
    expect(ekwiwalentNqNaKontrakt("NQX")).toBeNull();
  });

  it("jedna decyzja na piec kont = piec razy wieksza ekspozycja; micro to 0,1 mini", () => {
    const e = lacznaEkspozycjaNq([
      { accountId: 1, symbol: "NQ", contracts: 2 },
      { accountId: 2, symbol: "NQ", contracts: 2 },
      { accountId: 3, symbol: "MNQ", contracts: 5 },
      { accountId: 3, symbol: "MNQ", contracts: 5 },
      { accountId: 4, symbol: "ES", contracts: 3 },
    ]);
    expect(e.lacznie).toBeCloseTo(5, 9);
    expect(e.perKonto).toEqual([
      { accountId: 1, ekwiwalentNq: 2, kontraktyNq: 2, kontraktyMnq: 0 },
      { accountId: 2, ekwiwalentNq: 2, kontraktyNq: 2, kontraktyMnq: 0 },
      { accountId: 3, ekwiwalentNq: 1, kontraktyNq: 0, kontraktyMnq: 10 },
    ]);
    expect(e.pominiete).toEqual(["ES"]);
  });

  it("brak pozycji = zero", () => {
    expect(lacznaEkspozycjaNq([])).toEqual({ lacznie: 0, perKonto: [], pominiete: [] });
  });

  it("limit kontraktow z regul konta: ostrzezenie tylko po przekroczeniu", () => {
    const r = { maxContractsMini: 5, maxContractsMicro: 50 };
    expect(ostrzezenieKontraktow(r, 5, 0)).toBeNull();
    expect(ostrzezenieKontraktow(r, 6, 0)?.tekst).toContain("6 przy limicie 5");
    expect(ostrzezenieKontraktow(r, 0, 51)?.tekst).toContain("micro");
    expect(ostrzezenieKontraktow({ maxContractsMini: null, maxContractsMicro: null }, 99, 99)).toBeNull();
  });
});

describe("kwotaUsd", () => {
  it("formatuje centy", () => {
    expect(kwotaUsd(0)).toBe("0,00 USD");
    expect(kwotaUsd(5)).toBe("0,05 USD");
    expect(kwotaUsd(1234567)).toBe("12 345,67 USD");
    expect(kwotaUsd(-250_000)).toBe("-2 500,00 USD");
  });
});
