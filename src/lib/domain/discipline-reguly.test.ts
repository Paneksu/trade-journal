import { describe, expect, it } from "vitest";

import {
  minutaZTekstu,
  oknoHandluZUstawien,
  wskaznikDyscypliny,
  type DzienDlaDyscypliny,
  type TradeDlaDyscypliny,
} from "./discipline";

let seq = 0;
const tr = (nadpisz: Partial<TradeDlaDyscypliny> = {}): TradeDlaDyscypliny => {
  seq += 1;
  const entry = nadpisz.entryTime ?? new Date(Date.UTC(2026, 9, 14, 13, 30 + seq));
  return {
    id: seq,
    tradingDay: "2026-10-14",
    entryTime: entry,
    momentDecyzji: entry,
    processGrade: "A",
    stopLoss: 100,
    plan: { frozenAt: new Date(entry.getTime() - 60_000), stopLoss: 100 },
    minutaWejscia: 15 * 60 + 35,
    pnlCents: 10_000,
    rMultiple: 1,
    ...nadpisz,
  };
};

const dzien = (d = "2026-10-14", maxTrades: number | null = null, przegladWypelniony = true): DzienDlaDyscypliny => ({ day: d, maxTrades, przegladWypelniony });
const kod = (w: ReturnType<typeof wskaznikDyscypliny>, k: string) => w.naruszenia.find((n) => n.kod === k)!;

describe("wskaznikDyscypliny: naruszenia z danych", () => {
  it("czysty dzien: zero naruszen, 100% procesu A", () => {
    const w = wskaznikDyscypliny({ trades: [tr(), tr()], dni: [dzien()], okno: { odMin: 15 * 60, doMin: 17 * 60 } });
    expect(w.naruszenia.every((n) => n.count === 0)).toBe(true);
    expect(w.udzialA).toBe(1);
    expect(w.tradeIdsZNaruszeniem).toEqual([]);
  });

  it("limit trade'ow: flagowane sa trade'y PONAD limit, w kolejnosci wejsc", () => {
    const t = [tr(), tr(), tr(), tr()];
    const w = wskaznikDyscypliny({ trades: t, dni: [dzien("2026-10-14", 2)], okno: null });
    expect(kod(w, "limit_tradeow").tradeIds).toEqual([t[2].id, t[3].id]);
  });

  it("limit trade'ow liczy sie per dzien", () => {
    const t = [tr({ tradingDay: "2026-10-13" }), tr({ tradingDay: "2026-10-13" }), tr(), tr()];
    const w = wskaznikDyscypliny({ trades: t, dni: [dzien("2026-10-13", 2), dzien("2026-10-14", 2)], okno: null });
    expect(kod(w, "limit_tradeow").count).toBe(0);
  });

  it("poza oknem: granice domkniete, okno przez polnoc, brak okna = brak naruszen", () => {
    const okno = { odMin: 15 * 60, doMin: 17 * 60 };
    const wOkn = tr({ minutaWejscia: 15 * 60 });
    const koniec = tr({ minutaWejscia: 17 * 60 });
    const przed = tr({ minutaWejscia: 14 * 60 + 59 });
    const po = tr({ minutaWejscia: 17 * 60 + 1 });
    const w = wskaznikDyscypliny({ trades: [wOkn, koniec, przed, po], dni: [dzien()], okno });
    expect(kod(w, "poza_oknem").tradeIds.sort()).toEqual([przed.id, po.id].sort());

    const nocne = tr({ minutaWejscia: 1 * 60 });
    const dzienne = tr({ minutaWejscia: 12 * 60 });
    const wn = wskaznikDyscypliny({ trades: [nocne, dzienne], dni: [dzien()], okno: { odMin: 22 * 60, doMin: 2 * 60 } });
    expect(kod(wn, "poza_oknem").tradeIds).toEqual([dzienne.id]);

    expect(kod(wskaznikDyscypliny({ trades: [po], dni: [dzien()], okno: null }), "poza_oknem").count).toBe(0);
    expect(kod(wskaznikDyscypliny({ trades: [tr({ minutaWejscia: null })], dni: [dzien()], okno }), "poza_oknem").count).toBe(0);
  });

  it("brak planu: brak wiersza albo plan zamrozony PO momencie decyzji", () => {
    const bez = tr({ plan: null });
    const entry = new Date(Date.UTC(2026, 9, 14, 14, 0));
    const poFakcie = tr({ entryTime: entry, momentDecyzji: entry, plan: { frozenAt: new Date(entry.getTime() + 1000), stopLoss: 100 } });
    const dobry = tr();
    const w = wskaznikDyscypliny({ trades: [bez, poFakcie, dobry], dni: [dzien()], okno: null });
    expect(kod(w, "brak_planu").tradeIds.sort()).toEqual([bez.id, poFakcie.id].sort());
  });

  it("backtest: plan porownujemy z czasem zegarowym zapisu, nie z historycznym wejsciem", () => {
    const historyczne = new Date(Date.UTC(2023, 2, 14, 14, 0));
    const zapis = new Date(Date.UTC(2026, 9, 14, 20, 0));
    // plan zamrozony dzis o 19:59, wejscie z 2023: bez rozroznienia wyszloby "brak planu" dla kazdego trade'u replayu.
    const t = tr({ entryTime: historyczne, momentDecyzji: zapis, plan: { frozenAt: new Date(zapis.getTime() - 60_000), stopLoss: 100 } });
    expect(kod(wskaznikDyscypliny({ trades: [t], dni: [dzien()], okno: null }), "brak_planu").count).toBe(0);
    // ten sam trade ocenany po entryTime dalby naruszenie:
    const zle = tr({ entryTime: historyczne, momentDecyzji: historyczne, plan: { frozenAt: new Date(zapis.getTime() - 60_000), stopLoss: 100 } });
    expect(kod(wskaznikDyscypliny({ trades: [zle], dni: [dzien()], okno: null }), "brak_planu").count).toBe(1);
  });

  it("ruszony SL: inny SL niz w planie albo usuniety; ten sam (z tolerancja zmiennoprzecinkowa) nie jest naruszeniem", () => {
    const inny = tr({ stopLoss: 99.75 });
    const usuniety = tr({ stopLoss: null });
    const taki = tr({ stopLoss: 100.0000000001 });
    const w = wskaznikDyscypliny({ trades: [inny, usuniety, taki], dni: [dzien()], okno: null });
    expect(kod(w, "ruszony_sl").tradeIds.sort()).toEqual([inny.id, usuniety.id].sort());
  });

  it("trade bez planu nie dostaje dodatkowo 'ruszony SL' (jedno naruszenie na przyczyne)", () => {
    const w = wskaznikDyscypliny({ trades: [tr({ plan: null, stopLoss: 5 })], dni: [dzien()], okno: null });
    expect(kod(w, "brak_planu").count).toBe(1);
    expect(kod(w, "ruszony_sl").count).toBe(0);
  });

  it("koszt naruszen: suma R i P/L tylko trade'ow z naruszeniem, bez powtorzen", () => {
    const zle1 = tr({ plan: null, rMultiple: -1, pnlCents: -10_000 });
    const zle2 = tr({ plan: null, minutaWejscia: 3 * 60, rMultiple: -2, pnlCents: -20_000 });
    const dobry = tr({ rMultiple: 5, pnlCents: 50_000 });
    const w = wskaznikDyscypliny({ trades: [zle1, zle2, dobry], dni: [dzien()], okno: { odMin: 15 * 60, doMin: 17 * 60 } });
    expect(w.tradeIdsZNaruszeniem).toEqual([zle1.id, zle2.id]);
    expect(w.kosztNaruszen).toEqual({ count: 2, sumR: -3, sumPnlCents: -30_000 });
  });
});

describe("wskaznikDyscypliny: proces i przeglady", () => {
  it("udzial A tylko wsrod ocenionych; nieocenione go nie obnizaja", () => {
    const w = wskaznikDyscypliny({
      trades: [tr({ processGrade: "A" }), tr({ processGrade: "B" }), tr({ processGrade: "C" }), tr({ processGrade: null }), tr({ processGrade: "A" })],
      dni: [dzien()],
      okno: null,
    });
    expect(w).toMatchObject({ trades: 5, ocenione: 4, a: 2, b: 1, c: 1 });
    expect(w.udzialA).toBe(0.5);
  });

  it("nic nie ocenione = null, nie 0%", () => {
    expect(wskaznikDyscypliny({ trades: [tr({ processGrade: null })], dni: [dzien()], okno: null }).udzialA).toBeNull();
  });

  it("przeglady dzienne: wymagane to dni z trade'ami, wypelnione wg notatki dnia", () => {
    const w = wskaznikDyscypliny({
      trades: [tr({ tradingDay: "2026-10-13" }), tr({ tradingDay: "2026-10-14" })],
      dni: [dzien("2026-10-13", null, true), dzien("2026-10-14", null, false)],
      okno: null,
      tygodnieWymagane: 1,
      tygodnieZatwierdzone: 0,
    });
    expect(w.przeglady).toEqual({ dniWymagane: 2, dniWypelnione: 1, tygodnieWymagane: 1, tygodnieZatwierdzone: 0 });
  });

  it("dzien z trade'ami bez wpisu w notatkach liczy sie jako niewypelniony", () => {
    const w = wskaznikDyscypliny({ trades: [tr()], dni: [], okno: null });
    expect(w.przeglady.dniWymagane).toBe(1);
    expect(w.przeglady.dniWypelnione).toBe(0);
  });

  it("serie dzienne do wykresu obok equity", () => {
    const w = wskaznikDyscypliny({
      trades: [
        tr({ tradingDay: "2026-10-13", processGrade: "A" }),
        tr({ tradingDay: "2026-10-13", processGrade: "C", plan: null }),
        tr({ tradingDay: "2026-10-14", processGrade: "A" }),
      ],
      dni: [],
      okno: null,
    });
    expect(w.perDzien).toEqual([
      { day: "2026-10-13", trades: 2, ocenione: 2, a: 1, udzialA: 0.5, naruszenia: 1 },
      { day: "2026-10-14", trades: 1, ocenione: 1, a: 1, udzialA: 1, naruszenia: 0 },
    ]);
  });
});

describe("okno handlu z ustawien", () => {
  it("HH:MM -> minuta; smieci -> null", () => {
    expect(minutaZTekstu("09:30")).toBe(570);
    expect(minutaZTekstu("9:05")).toBe(545);
    expect(minutaZTekstu("24:00")).toBeNull();
    expect(minutaZTekstu("12:60")).toBeNull();
    expect(minutaZTekstu("")).toBeNull();
    expect(minutaZTekstu(null)).toBeNull();
    expect(oknoHandluZUstawien("15:00", null)).toBeNull();
    expect(oknoHandluZUstawien("15:00", "17:30")).toEqual({ odMin: 900, doMin: 1050 });
  });
});
