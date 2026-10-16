import { describe, expect, it } from "vitest";

import type { InstrumentSpec } from "../calc";
import { dopasuj, OKNO_DOPASOWANIA_S, wOknie, type KandydatDziennika, type TradeBrokeraDoDopasowania } from "./dopasowanie";
import { grupujWszystko, grupujWypelnienia, posortujWypelnienia } from "./grupowanie";
import { przypiszBrutto, przypiszOplaty, rozdzielProporcjonalnie } from "./oplaty";
import { parsujPlikBrokera } from "./tradovate";
import type { Wypelnienie } from "./typy";
import { uzgodnij } from "./uzgodnienie";
import { wynikTraduBrokera } from "./wynik";
import { bajty, CASH, ORDERS, TERAZ } from "@/lib/brokerzy/testowe";

const MNQ: InstrumentSpec = { tickSize: 0.25, tickValue: 500, rthFrom: "09:30", rthTo: "16:00", exchangeTimezone: "America/New_York" };
const NQ: InstrumentSpec = { ...MNQ, tickValue: 5000 };

function fill(id: string, strona: "buy" | "sell", ilosc: number, cena: number, czas: string, kontrakt = "MNQZ6", konto = "K1"): Wypelnienie {
  return { idZrodla: id, konto, kontrakt, strona, ilosc, cena, czas: new Date(czas), zlecenie: id, raw: {}, numerWiersza: 0 };
}

function zFikstur() {
  const o = parsujPlikBrokera(bajty(ORDERS), { strefa: "Europe/Warsaw", teraz: TERAZ });
  const c = parsujPlikBrokera(bajty(CASH), { strefa: "Europe/Warsaw", teraz: TERAZ });
  if (!o.ok || !c.ok) throw new Error("fikstury nie sparsowane");
  return { wypelnienia: o.wypelnienia, zdarzenia: c.zdarzenia };
}

describe("grupowanie wypelnien w trade'y", () => {
  it("jedno wejscie i jedno wyjscie = jeden zamkniety trade", () => {
    const t = grupujWypelnienia([fill("1", "buy", 3, 100, "2026-10-14T10:00:00Z"), fill("2", "sell", 3, 101, "2026-10-14T10:05:00Z")]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ klucz: "1", kierunek: "long", maxIlosc: 3, status: "closed", sredniaCenaWejscia: 100, sredniaCenaWyjscia: 101 });
    expect(t[0].czasWyjscia?.toISOString()).toBe("2026-10-14T10:05:00.000Z");
  });

  it("short: sprzedaz otwiera, kupno zamyka (probka: 9 MNQ 30785,50 -> 30810,50)", () => {
    const [t] = grupujWypelnienia([fill("5", "sell", 9, 30785.5, "2026-10-13T14:03:12Z"), fill("14", "buy", 9, 30810.5, "2026-10-13T14:04:41Z")]);
    expect(t).toMatchObject({ kierunek: "short", maxIlosc: 9, status: "closed" });
  });

  it("czesciowe wyjscia: kazde zmniejszenie pozycji to osobne wyjscie, trade zamyka sie przy powrocie do zera", () => {
    const [t] = grupujWypelnienia([
      fill("1", "sell", 2, 200, "2026-10-14T10:00:00Z"),
      fill("2", "buy", 1, 195, "2026-10-14T10:01:00Z"),
      fill("3", "buy", 1, 190, "2026-10-14T10:02:00Z"),
    ]);
    expect(t.wyjscia.map((w) => [w.ilosc, w.cena])).toEqual([[1, 195], [1, 190]]);
    expect(t.status).toBe("closed");
    expect(t.sredniaCenaWyjscia).toBe(192.5);
  });

  it("dokladanie do pozycji: srednia wazona wejscia, maxIlosc = najwieksza pozycja", () => {
    const [t] = grupujWypelnienia([
      fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z"),
      fill("2", "buy", 3, 102, "2026-10-14T10:01:00Z"),
      fill("3", "sell", 2, 105, "2026-10-14T10:02:00Z"),
      fill("4", "sell", 2, 106, "2026-10-14T10:03:00Z"),
    ]);
    expect(t.sredniaCenaWejscia).toBe(101.5);
    expect(t.maxIlosc).toBe(4);
    expect(t.wejscia).toHaveLength(2);
    expect(t.wyjscia).toHaveLength(2);
  });

  it("odwrocenie jednym wypelnieniem dzieli sie na zamkniecie i otwarcie (sufiks #flip)", () => {
    const t = grupujWypelnienia([fill("1", "buy", 2, 100, "2026-10-14T10:00:00Z"), fill("2", "sell", 5, 101, "2026-10-14T10:01:00Z"), fill("3", "buy", 3, 99, "2026-10-14T10:02:00Z")]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ klucz: "1", kierunek: "long", status: "closed" });
    expect(t[0].wyjscia[0]).toMatchObject({ ilosc: 2, iloscCalegoWypelnienia: 5 });
    expect(t[1]).toMatchObject({ klucz: "2#flip", kierunek: "short", maxIlosc: 3, status: "closed" });
    expect(t[1].wejscia[0]).toMatchObject({ ilosc: 3, iloscCalegoWypelnienia: 5 });
  });

  it("pozycja otwarta na koncu danych to trade open bez czasu wyjscia", () => {
    const [t] = grupujWypelnienia([fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z")]);
    expect(t).toMatchObject({ status: "open", czasWyjscia: null, sredniaCenaWyjscia: null });
  });

  it("remis czasu rozstrzyga id zrodla (liczbowo, nie tekstowo): 9 przed 10", () => {
    const posortowane = posortujWypelnienia([fill("10", "buy", 1, 1, "2026-10-14T10:00:00Z"), fill("9", "buy", 1, 1, "2026-10-14T10:00:00Z")]);
    expect(posortowane.map((f) => f.idZrodla)).toEqual(["9", "10"]);
    const [t] = grupujWypelnienia([fill("10", "sell", 1, 100, "2026-10-14T10:00:00Z"), fill("9", "buy", 1, 100, "2026-10-14T10:00:00Z")]);
    expect(t.klucz).toBe("9");
    expect(t.kierunek).toBe("long");
  });

  it("ponowny import: dodanie wypelnien domykajacych nie zmienia klucza trade'a (zachowuje id i powiazanie)", () => {
    const pierwszy = grupujWypelnienia([fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z")]);
    const pozniej = grupujWypelnienia([fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z"), fill("2", "sell", 1, 101, "2026-10-14T10:05:00Z")]);
    expect(pierwszy[0].klucz).toBe(pozniej[0].klucz);
    expect(pierwszy[0].status).toBe("open");
    expect(pozniej[0].status).toBe("closed");
  });

  it("kontrakty i konta grupuja sie osobno; grupujWypelnienia odmawia mieszanki kontraktow", () => {
    const wszystkie = grupujWszystko([
      fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z", "MNQZ6", "K1"),
      fill("2", "buy", 1, 100, "2026-10-14T10:00:01Z", "NQZ6", "K1"),
      fill("3", "sell", 1, 101, "2026-10-14T10:01:00Z", "MNQZ6", "K2"),
    ]);
    expect(wszystkie).toHaveLength(3);
    expect(wszystkie.every((t) => t.status === "open")).toBe(true);
    expect(() => grupujWypelnienia([fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z", "MNQZ6"), fill("2", "buy", 1, 100, "2026-10-14T10:00:00Z", "NQZ6")])).toThrow(/kilku kontraktów/);
    expect(grupujWypelnienia([])).toEqual([]);
  });

  it("fikstura: cztery trade'y (A zamkniety, B z dwoma wyjsciami, C ze scale-in, D otwarty)", () => {
    const { wypelnienia } = zFikstur();
    const t = grupujWszystko(wypelnienia).sort((a, b) => a.czasWejscia.getTime() - b.czasWejscia.getTime());
    expect(t.map((x) => [x.kontrakt, x.kierunek, x.maxIlosc, x.status, x.wejscia.length, x.wyjscia.length])).toEqual([
      ["MNQZ6", "long", 3, "closed", 1, 1],
      ["NQZ6", "short", 2, "closed", 1, 2],
      ["MNQZ6", "long", 2, "closed", 2, 1],
      ["MNQZ6", "long", 1, "open", 1, 0],
    ]);
    expect(t[2].sredniaCenaWejscia).toBe(20300.5);
  });
});

describe("rozdzial oplat", () => {
  it("rozklad proporcjonalny nie gubi centa", () => {
    expect(rozdzielProporcjonalnie(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(rozdzielProporcjonalnie(450, [9])).toEqual([450]);
    expect(rozdzielProporcjonalnie(5, [1, 4])).toEqual([1, 4]);
    expect(rozdzielProporcjonalnie(7, [1, 1])).toEqual([4, 3]);
    expect(rozdzielProporcjonalnie(10, [])).toEqual([]);
    expect(rozdzielProporcjonalnie(10, [0, 0])).toEqual([10, 0]);
  });

  it("prowizja laczy sie z wypelnieniem po sekundzie i kontrakcie", () => {
    const { wypelnienia, zdarzenia } = zFikstur();
    const { poId, bezWypelnienia } = przypiszOplaty(wypelnienia, zdarzenia);
    expect(poId.get("698000000001")).toBe(150);
    expect(poId.get("698000000003")).toBe(150);
    expect(poId.get("698000000005")).toBe(350);
    expect(poId.get("698000000006")).toBe(175);
    expect(poId.get("698000000010")).toBe(100);
    expect(poId.get("698000000011")).toBe(50);
    expect(bezWypelnienia).toEqual([]);
  });

  it("dwa wypelnienia w tej samej sekundzie dziela prowizje proporcjonalnie do ilosci", () => {
    const f = [fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z"), fill("2", "buy", 3, 100, "2026-10-14T10:00:00.400Z")];
    const z = [{ idZrodla: "c", konto: "K1", rodzaj: "commission" as const, deltaCenty: -200, kontrakt: "MNQZ6", czas: new Date("2026-10-14T10:00:00Z"), raw: {}, numerWiersza: 1 }];
    const { poId } = przypiszOplaty(f, z);
    expect([poId.get("1"), poId.get("2")]).toEqual([50, 150]);
  });

  it("prowizja bez wypelnienia czeka na Orders; inna sekunda albo inny kontrakt nie pasuja", () => {
    const f = [fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z")];
    const zd = (czas: string, kontrakt: string) => ({ idZrodla: czas + kontrakt, konto: "K1", rodzaj: "commission" as const, deltaCenty: -50, kontrakt, czas: new Date(czas), raw: {}, numerWiersza: 1 });
    const w = przypiszOplaty(f, [zd("2026-10-14T10:00:01Z", "MNQZ6"), zd("2026-10-14T10:00:00Z", "NQZ6")]);
    expect(w.poId.size).toBe(0);
    expect(w.bezWypelnienia).toHaveLength(2);
  });

  it("zwrot prowizji (dodatnia kwota) nie robi z oplaty zysku", () => {
    const f = [fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z")];
    const z = [{ idZrodla: "c", konto: "K1", rodzaj: "commission" as const, deltaCenty: 30, kontrakt: "MNQZ6", czas: new Date("2026-10-14T10:00:00Z"), raw: {}, numerWiersza: 1 }];
    expect(przypiszOplaty(f, z).poId.get("1")).toBe(0);
  });
});

describe("wynik brutto z Trade Paired", () => {
  it("fikstura: suma wierszy pary w sekundach wyjsc (jedna, dwie pary w roznych sekundach, dwie w tej samej)", () => {
    const { wypelnienia, zdarzenia } = zFikstur();
    const trade = grupujWszystko(wypelnienia);
    const brutto = przypiszBrutto(trade, zdarzenia);
    const poKluczu = (k: string) => brutto.get(k);
    expect(poKluczu("698000000001")).toMatchObject({ centy: 7350, bezPary: 0 });
    expect(poKluczu("698000000005")).toMatchObject({ centy: 30_000, bezPary: 0 });
    expect(poKluczu("698000000008")).toMatchObject({ centy: 1800, bezPary: 0 });
    expect(poKluczu("698000000011")).toBeUndefined(); // otwarty
  });

  it("brak wiersza pary w sekundzie wyjscia = brak pokrycia (null), wynik wyliczy computeTrade", () => {
    const { wypelnienia, zdarzenia } = zFikstur();
    const bezPary = zdarzenia.filter((z) => !(z.rodzaj === "trade_paired" && z.deltaCenty === 20_000));
    const brutto = przypiszBrutto(grupujWszystko(wypelnienia), bezPary);
    expect(brutto.get("698000000005")).toMatchObject({ centy: null, bezPary: 1 });
  });

  it("dwa trade'y z wyjsciem w tej samej sekundzie: wiersza nie przypisujemy zadnemu", () => {
    // Dwa konta nie wchodza, ale ten sam kontrakt moze miec zamkniecie i otwarcie (odwrocenie) w jednej sekundzie.
    const t = grupujWypelnienia([fill("1", "buy", 1, 100, "2026-10-14T10:00:00Z"), fill("2", "sell", 2, 101, "2026-10-14T10:01:00Z"), fill("3", "buy", 1, 100, "2026-10-14T10:01:00Z")]);
    const z = [{ idZrodla: "p", konto: "K1", rodzaj: "trade_paired" as const, deltaCenty: 100, kontrakt: "MNQZ6", czas: new Date("2026-10-14T10:01:00Z"), raw: {}, numerWiersza: 1 }];
    const wynik = przypiszBrutto(t, z);
    // pierwszy trade ma wyjscie w 10:01:00, a drugi (flip) tez zamyka sie w 10:01:00 -> sekunda wspolna
    expect([...wynik.values()].every((b) => b.centy === null)).toBe(true);
  });
});

describe("wynik trade'a brokera: brutto, oplaty, netto", () => {
  it("liczby z probki: short 9 MNQ, brutto -450,00, oplaty 9,00, netto -459,00", () => {
    const f = [fill("5", "sell", 9, 30785.5, "2026-10-13T14:03:12Z"), fill("14", "buy", 9, 30810.5, "2026-10-13T14:04:41Z")];
    const [trade] = grupujWypelnienia(f);
    const zd = (czas: string, delta: number, rodzaj: "commission" | "trade_paired") => ({ idZrodla: `${rodzaj}${czas}`, konto: "K1", rodzaj, deltaCenty: delta, kontrakt: "MNQZ6", czas: new Date(czas), raw: {}, numerWiersza: 1 });
    const cash = [zd("2026-10-13T14:03:12Z", -450, "commission"), zd("2026-10-13T14:04:41Z", -450, "commission"), zd("2026-10-13T14:04:41Z", -45_000, "trade_paired")];
    const oplaty = przypiszOplaty(f, cash);
    const brutto = przypiszBrutto([trade], cash).get(trade.klucz) ?? null;
    const w = wynikTraduBrokera({ trade, instrument: MNQ, stawkaRtCenty: 100, oplatyZPliku: oplaty.poId, bruttoZPliku: brutto });
    expect(w).toMatchObject({ grossCents: -45_000, grossSource: "broker", feesCents: 900, feeSource: "broker", netCents: -45_900, grossComputedCents: -45_000 });
  });

  it("sam plik Orders (bez Cash History): brutto z cen, oplaty ze stawki", () => {
    const f = [fill("5", "sell", 9, 30785.5, "2026-10-13T14:03:12Z"), fill("14", "buy", 9, 30810.5, "2026-10-13T14:04:41Z")];
    const [trade] = grupujWypelnienia(f);
    const w = wynikTraduBrokera({ trade, instrument: MNQ, stawkaRtCenty: 100, oplatyZPliku: new Map(), bruttoZPliku: null });
    expect(w).toMatchObject({ grossCents: -45_000, grossSource: "computed", feesCents: 900, feeSource: "rate", netCents: -45_900 });
  });

  it("bez stawki i bez Cash History: opłaty nieznane, netto NULL (nie udajemy wyniku)", () => {
    const [trade] = grupujWypelnienia([fill("1", "buy", 1, 100, "2026-10-13T14:03:12Z"), fill("2", "sell", 1, 101, "2026-10-13T14:04:41Z")]);
    const w = wynikTraduBrokera({ trade, instrument: MNQ, stawkaRtCenty: null, oplatyZPliku: new Map(), bruttoZPliku: null });
    expect(w).toMatchObject({ grossSource: "computed", feesCents: null, feeSource: null, netCents: null });
    expect(w.grossCents).toBe(200); // 100 -> 101 = 4 ticki po 0,50 USD = 2,00 USD
  });

  it("opłaty z pliku tylko dla czesci wypelnien: cala pozycja idzie ze stawki, nie mieszamy zrodel", () => {
    const f = [fill("1", "buy", 2, 100, "2026-10-13T14:03:12Z"), fill("2", "sell", 2, 101, "2026-10-13T14:04:41Z")];
    const [trade] = grupujWypelnienia(f);
    const w = wynikTraduBrokera({ trade, instrument: MNQ, stawkaRtCenty: 100, oplatyZPliku: new Map([["1", 100]]), bruttoZPliku: null });
    expect(w).toMatchObject({ feeSource: "rate", feesCents: 200 });
  });

  it("brak instrumentu i brak brutto z pliku: brutto i netto NULL", () => {
    const [trade] = grupujWypelnienia([fill("1", "buy", 1, 100, "2026-10-13T14:03:12Z"), fill("2", "sell", 1, 101, "2026-10-13T14:04:41Z")]);
    const w = wynikTraduBrokera({ trade, instrument: null, stawkaRtCenty: 100, oplatyZPliku: new Map(), bruttoZPliku: null });
    expect(w).toMatchObject({ grossCents: null, netCents: null, feesCents: 100, feeSource: "rate" });
  });

  it("trade otwarty nie ma wyniku", () => {
    const [trade] = grupujWypelnienia([fill("1", "buy", 1, 100, "2026-10-13T14:03:12Z")]);
    expect(wynikTraduBrokera({ trade, instrument: MNQ, stawkaRtCenty: 100, oplatyZPliku: new Map(), bruttoZPliku: null })).toMatchObject({ netCents: null, feesCents: null, grossCents: null });
  });

  it("fikstura end-to-end: A, B i C z Cash History daja netto zgodne z reczna rachunkowka", () => {
    const { wypelnienia, zdarzenia } = zFikstur();
    const trade = grupujWszystko(wypelnienia);
    const oplaty = przypiszOplaty(wypelnienia, zdarzenia);
    const brutto = przypiszBrutto(trade, zdarzenia);
    const wynik = (klucz: string, instrument: InstrumentSpec) => {
      const t = trade.find((x) => x.klucz === klucz)!;
      return wynikTraduBrokera({ trade: t, instrument, stawkaRtCenty: null, oplatyZPliku: oplaty.poId, bruttoZPliku: brutto.get(klucz) ?? null });
    };
    expect(wynik("698000000001", MNQ)).toMatchObject({ grossCents: 7350, feesCents: 300, netCents: 7050, feeSource: "broker", grossSource: "broker" });
    expect(wynik("698000000005", NQ)).toMatchObject({ grossCents: 30_000, feesCents: 700, netCents: 29_300 });
    expect(wynik("698000000008", MNQ)).toMatchObject({ grossCents: 1800, feesCents: 200, netCents: 1600, grossComputedCents: 1800 });
    expect(wynik("698000000011", MNQ)).toMatchObject({ netCents: null });
  });
});

describe("dopasowanie do dziennika", () => {
  const baza = new Date("2026-10-14T13:30:05Z");
  const broker = (id: number, extra: Partial<TradeBrokeraDoDopasowania> = {}): TradeBrokeraDoDopasowania => ({ id, accountId: 1, instrumentId: 7, direction: "long", entryTime: baza, maxQty: 3, ...extra });
  const dz = (id: number, extra: Partial<KandydatDziennika> = {}): KandydatDziennika => ({ id, accountId: 1, instrumentId: 7, direction: "long", entryTime: baza, contracts: 3, ...extra });

  it("okno to +-120 s (stala z ADR-034), granica wlacznie", () => {
    expect(OKNO_DOPASOWANIA_S).toBe(120);
    expect(wOknie(baza, new Date(baza.getTime() + 120_000))).toBe(true);
    expect(wOknie(baza, new Date(baza.getTime() + 121_000))).toBe(false);
    expect(wOknie(baza, new Date(baza.getTime() - 120_000))).toBe(true);
  });

  it("jeden kandydat, ta sama liczba kontraktow = 1:1", () => {
    const [w] = dopasuj([broker(1)], [dz(10, { entryTime: new Date(baza.getTime() + 90_000) })]);
    expect(w).toMatchObject({ stan: "jeden_do_jednego", tradeId: 10, kandydaci: [10], powod: null });
  });

  it("dwoch kandydatow: niejednoznaczne, z lista kandydatow", () => {
    const [w] = dopasuj([broker(1)], [dz(10), dz(11)]);
    expect(w).toMatchObject({ stan: "niejednoznaczne", tradeId: null, kandydaci: [10, 11] });
    expect(w.powod).toContain("2 trade");
  });

  it("jeden kandydat pasuje do dwoch trade'ow brokera: oba niejednoznaczne", () => {
    const w = dopasuj([broker(1), broker(2, { entryTime: new Date(baza.getTime() + 30_000) })], [dz(10)]);
    expect(w.map((x) => x.stan)).toEqual(["niejednoznaczne", "niejednoznaczne"]);
  });

  it("inna liczba kontraktow: niejednoznaczne z opisem liczb", () => {
    const [w] = dopasuj([broker(1)], [dz(10, { contracts: 2 })]);
    expect(w.stan).toBe("niejednoznaczne");
    expect(w.powod).toContain("broker 3, dziennik 2");
  });

  it("poza oknem, inny kierunek, inny instrument albo inne konto: brak kandydata", () => {
    for (const inny of [{ entryTime: new Date(baza.getTime() + 300_000) }, { direction: "short" as const }, { instrumentId: 8 }, { accountId: 2 }]) {
      const [w] = dopasuj([broker(1)], [dz(10, inny)]);
      expect(w, JSON.stringify(inny)).toMatchObject({ stan: "brak", kandydaci: [] });
    }
  });

  it("konto albo instrument brokera nieprzypisane: brak z powodem (automat nie zgaduje)", () => {
    expect(dopasuj([broker(1, { accountId: null })], [dz(10)])[0].powod).toContain("nie jest przypisane");
    expect(dopasuj([broker(1, { instrumentId: null })], [dz(10)])[0].powod).toContain("instrument");
  });

  it("dwa niezalezne trade'y 1:1 w jednym przebiegu", () => {
    const pozniej = new Date(baza.getTime() + 3_600_000);
    const w = dopasuj([broker(1), broker(2, { entryTime: pozniej, maxQty: 1 })], [dz(10), dz(11, { entryTime: pozniej, contracts: 1 })]);
    expect(w.map((x) => [x.stan, x.tradeId])).toEqual([["jeden_do_jednego", 10], ["jeden_do_jednego", 11]]);
  });
});

describe("uzgodnienie wyniku wyliczonego z rzeczywistym", () => {
  it("wynik wyliczony: brak roznicy", () => {
    expect(uzgodnij({ pnl: -45_900, pnlEstimate: -45_900, brokerAmount: null, feesEstimate: 900, feesBroker: null })).toEqual({
      zrodlo: "wyliczony",
      roznicaCenty: null,
      poslizgCenty: null,
      roznicaOplatCenty: null,
    });
  });

  it("z rachunku: roznica = poslizg + roznica oplat", () => {
    // Szacunek: brutto -450,00, oplaty ze stawki 9,00. Rachunek: brutto -452,00 (poslizg 2,00), oplaty 10,50.
    const u = uzgodnij({ pnl: -46_250, pnlEstimate: -45_900, brokerAmount: -46_250, feesEstimate: 900, feesBroker: 1050 });
    expect(u).toEqual({ zrodlo: "z_rachunku", roznicaCenty: -350, poslizgCenty: -200, roznicaOplatCenty: -150 });
    expect((u.poslizgCenty as number) + (u.roznicaOplatCenty as number)).toBe(u.roznicaCenty);
  });

  it("z rachunku bez znanych oplat: sama roznica", () => {
    expect(uzgodnij({ pnl: 1000, pnlEstimate: 900, brokerAmount: 1000, feesEstimate: null, feesBroker: null })).toEqual({ zrodlo: "z_rachunku", roznicaCenty: 100, poslizgCenty: null, roznicaOplatCenty: null });
  });

  it("brak wyniku wyliczonego: nie ma z czym porownac", () => {
    expect(uzgodnij({ pnl: 1000, pnlEstimate: null, brokerAmount: 1000, feesEstimate: null, feesBroker: null }).roznicaCenty).toBeNull();
  });
});

describe("podejrzenie innej strefy czasowej", () => {
  const baza = new Date("2026-10-14T13:30:00Z");
  const h = (n: number) => new Date(baza.getTime() + n * 3_600_000);
  const kandydat = (id: number, entry: Date, contracts = 1): KandydatDziennika => ({ id, accountId: 1, instrumentId: 7, direction: "long", entryTime: entry, contracts });
  const trade = (id: number, entry: Date): TradeBrokeraDoDopasowania => ({ id, accountId: 1, instrumentId: 7, direction: "long", entryTime: entry, maxQty: 1 });

  it("trzy trade'y brokera wszystkie o 6 h za pozno wzgledem dziennika: proponuje -6 h, nie przesuwa sam", async () => {
    const { wykryjPrzesunieciaStrefy } = await import("./dopasowanie");
    const broker = [trade(1, h(6)), trade(2, h(7)), trade(3, h(9))];
    const dziennik = [kandydat(10, h(0)), kandydat(11, h(1)), kandydat(12, h(3))];
    expect(wykryjPrzesunieciaStrefy(broker, dziennik)).toEqual({ godziny: -6, dopasowan: 3, bazowo: 0 });
  });

  it("gdy bez przesuniecia dopasowuje sie tyle samo, nie ostrzega", async () => {
    const { wykryjPrzesunieciaStrefy } = await import("./dopasowanie");
    const broker = [trade(1, h(0)), trade(2, h(1))];
    const dziennik = [kandydat(10, h(0)), kandydat(11, h(1))];
    expect(wykryjPrzesunieciaStrefy(broker, dziennik)).toBeNull();
  });

  it("jedno trafienie to za malo, zeby podejrzewac strefe", async () => {
    const { wykryjPrzesunieciaStrefy } = await import("./dopasowanie");
    expect(wykryjPrzesunieciaStrefy([trade(1, h(6))], [kandydat(10, h(0))])).toBeNull();
  });
});
