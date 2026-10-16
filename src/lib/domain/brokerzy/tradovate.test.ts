import { describe, expect, it } from "vitest";

import { parsujPlikBrokera, rodzajZdarzeniaCash } from "./tradovate";
import { bajty, CASH, NAGLOWEK_CASH, NAGLOWEK_ORDERS, ORDERS, plikCash, plikOrders, TERAZ, wierszCash, wierszOrders } from "@/lib/brokerzy/testowe";

const opcje = { strefa: "Europe/Warsaw", teraz: TERAZ };

function parsuj(tekst: string, strefa = "Europe/Warsaw") {
  const w = parsujPlikBrokera(bajty(tekst), { strefa, teraz: TERAZ });
  if (!w.ok) throw new Error(`parsowanie nieudane: ${w.kod}: ${w.komunikat}`);
  return w;
}

describe("Tradovate Orders: fikstura z prawdziwymi naglowkami", () => {
  const w = parsuj(ORDERS);

  it("rozpoznaje format i bierze tylko wypelnione zlecenia (anulowane pomija)", () => {
    expect(w.format).toBe("tradovate_orders");
    expect(w.wierszy).toBe(10);
    expect(w.wypelnienia).toHaveLength(9);
    expect(w.pominiete).toBe(1);
    expect(w.bledy).toEqual([]);
  });

  it("przycina spacje na poczatku (B/S, Status), czyta cene, ilosc i czas wypelnienia w jawnej strefie", () => {
    const pierwsze = w.wypelnienia[0];
    expect(pierwsze).toMatchObject({ idZrodla: "698000000001", kontrakt: "MNQZ6", strona: "buy", ilosc: 3, cena: 20100.25 });
    expect(pierwsze.czas.toISOString()).toBe("2026-10-14T13:30:05.000Z"); // 15:30:05 w Warszawie (CEST)
    const sprzedaz = w.wypelnienia.find((x) => x.idZrodla === "698000000003");
    expect(sprzedaz).toMatchObject({ strona: "sell", cena: 20112.5 });
  });

  it("strefa z ustawien zmienia moment, a plik bez przesuniecia dostaje flage (ostrzezenie w podgladzie)", () => {
    expect(w.czasBezStrefy).toBe(true);
    const ny = parsuj(ORDERS, "America/New_York");
    expect(ny.wypelnienia[0].czas.toISOString()).toBe("2026-10-14T19:30:05.000Z");
  });

  it("raw nie zawiera numeru konta ani kolumny Account", () => {
    for (const f of w.wypelnienia) {
      expect(Object.keys(f.raw)).not.toContain("Account");
      expect(JSON.stringify(f.raw)).not.toContain("TST000");
      expect(f.konto).toBe("TST00000000001");
    }
    expect(w.wypelnienia[0].raw).toMatchObject({ "B/S": "Buy", Status: "Filled", Contract: "MNQZ6", Text: "Tradingview" });
  });

  it("przecinek tysiecy w cudzyslowie nie psuje kolumn", () => {
    expect(w.wypelnienia[0].raw["Notional Value"]).toBe("120,601.50");
  });

  it("parsowanie jest deterministyczne (ten sam plik = te same wypelnienia)", () => {
    expect(parsuj(ORDERS).wypelnienia.map((f) => [f.idZrodla, f.czas.getTime()])).toEqual(w.wypelnienia.map((f) => [f.idZrodla, f.czas.getTime()]));
  });
});

describe("Tradovate Cash History: fikstura z prawdziwymi naglowkami", () => {
  const w = parsuj(CASH);

  it("rozpoznaje format i czyta kwoty ze znakiem w centach", () => {
    expect(w.format).toBe("tradovate_cash_history");
    expect(w.zdarzenia).toHaveLength(15);
    expect(w.bledy).toEqual([]);
    const prowizja = w.zdarzenia.find((z) => z.idZrodla === "699000000002");
    expect(prowizja).toMatchObject({ rodzaj: "commission", deltaCenty: -150, kontrakt: "MNQZ6" });
    const wplata = w.zdarzenia.find((z) => z.rodzaj === "deposit");
    expect(wplata).toMatchObject({ deltaCenty: 2_500_000, kontrakt: null });
    const para = w.zdarzenia.find((z) => z.idZrodla === "699000000009");
    expect(para).toMatchObject({ rodzaj: "trade_paired", deltaCenty: 20_000 });
  });

  it("typy transakcji: Commission, Trade Paired, Fund Transaction, oplaty gieldowe i nieznane", () => {
    expect(rodzajZdarzeniaCash(" Commission")).toBe("commission");
    expect(rodzajZdarzeniaCash(" Trade Paired")).toBe("trade_paired");
    expect(rodzajZdarzeniaCash(" Fund Transaction")).toBe("deposit");
    expect(rodzajZdarzeniaCash("Exchange Fee")).toBe("fee");
    expect(rodzajZdarzeniaCash("Withdrawal")).toBe("other");
  });

  it("nieznany typ jest zapisany, ale z ostrzezeniem (nie liczy sie do wyniku)", () => {
    const p = parsuj(plikCash([{ id: "1", czas: "10/14/2026 10:00:00", delta: "-5.00", typ: "Platform Subscription" }]));
    expect(p.ostrzezenia.map((o) => o.code)).toContain("nieznany_typ_cash");
    expect(p.zdarzenia[0].rodzaj).toBe("other");
  });
});

describe("liczby z probki uzytkownika w fiksturze: short 9 MNQ 30785,50 -> 30810,50", () => {
  const orders = plikOrders([
    { id: "698100000005", strona: "Sell", cena: "30785.5", ilosc: 9, czas: "10/13/2026 16:03:12" },
    { id: "698100000014", strona: "Buy", cena: "30810.5", ilosc: 9, czas: "10/13/2026 16:04:41" },
  ]);
  const cash = plikCash([
    { id: "1", czas: "10/13/2026 16:03:12", delta: "-4.50", typ: "Commission", kontrakt: "MNQZ6" },
    { id: "2", czas: "10/13/2026 16:04:41", delta: "-4.50", typ: "Commission", kontrakt: "MNQZ6" },
    { id: "3", czas: "10/13/2026 16:04:41", delta: "-450.00", typ: "Trade Paired", kontrakt: "MNQZ6" },
  ]);

  it("parsuje oba pliki do znormalizowanych danych", () => {
    const o = parsuj(orders);
    const c = parsuj(cash);
    expect(o.wypelnienia.map((f) => [f.strona, f.ilosc, f.cena])).toEqual([["sell", 9, 30785.5], ["buy", 9, 30810.5]]);
    expect(c.zdarzenia.map((z) => z.deltaCenty)).toEqual([-450, -450, -45_000]);
  });
});

describe("Tradovate: wiersze bledne, powtorzone i graniczne", () => {
  it("kazdy blad ma numer wiersza i powod; plik nie jest po cichu poprawiany", () => {
    const tekst = plikOrders([
      { id: "10", strona: "Buy", cena: "100", ilosc: 1, czas: "10/14/2026 10:00:00" },
      { id: "11", strona: "Buy", cena: "-5", ilosc: 1, czas: "10/14/2026 10:00:00" },
      { id: "12", strona: "Buy", cena: "100", ilosc: 1, czas: "10/14/2026 25:00:00" },
      { id: "13", strona: "Buy", cena: "abc", ilosc: 1, czas: "10/14/2026 10:00:00" },
      { id: "14", strona: "Buy", cena: "100", ilosc: 1, czas: "10/14/2036 10:00:00" },
    ]);
    const w = parsuj(tekst);
    expect(w.wypelnienia.map((f) => f.idZrodla)).toEqual(["10"]);
    expect(w.bledy.map((b) => b.numerWiersza)).toEqual([3, 4, 5, 6]);
    expect(w.bledy[0].powod).toContain("avgPrice");
    expect(w.bledy[1].powod).toContain("Fill Time");
    expect(w.bledy[2].powod).toContain("avgPrice");
    expect(w.bledy[3].powod).toContain("poza zakresem");
  });

  it("zla strona, pusty kontrakt i zly id sa bledami", () => {
    const wiersz = wierszOrders({ id: "20", strona: "Buy", cena: "100", ilosc: 1, czas: "10/14/2026 10:00:00" });
    const zlaStrona = wiersz.replace(" Buy", " Hold");
    const w = parsuj(`${NAGLOWEK_ORDERS}\n${zlaStrona}\n`);
    expect(w.bledy[0].powod).toContain("B/S");
    const zlyId = parsuj(plikOrders([{ id: "id ze spacja", strona: "Buy", cena: "100", ilosc: 1, czas: "10/14/2026 10:00:00" }]));
    expect(zlyId.bledy[0].powod).toContain("orderId");
  });

  it("ilosc zero albo ujemna: zero to zlecenie bez wypelnienia, ujemna to blad", () => {
    const wiersz = (ilosc: string) => wierszOrders({ id: "30", strona: "Buy", cena: "100", ilosc: 1, czas: "10/14/2026 10:00:00" }).replace(",1,10/14/2026 10:00:00,", `,${ilosc},10/14/2026 10:00:00,`);
    expect(parsuj(`${NAGLOWEK_ORDERS}\n${wiersz("0")}\n`).wypelnienia).toHaveLength(0);
    expect(parsuj(`${NAGLOWEK_ORDERS}\n${wiersz("-2")}\n`).bledy[0].powod).toContain("filledQty");
  });

  it("identyczny powtorzony wiersz jest pominiety z ostrzezeniem, a ten sam id z innymi wartosciami to blad", () => {
    const a = { id: "40", strona: "Buy" as const, cena: "100", ilosc: 1, czas: "10/14/2026 10:00:00" };
    const dup = parsuj(plikOrders([a, a]));
    expect(dup.wypelnienia).toHaveLength(1);
    expect(dup.ostrzezenia.map((o) => o.code)).toContain("powtorzony_wiersz");
    const inny = parsuj(plikOrders([a, { ...a, cena: "101" }]));
    expect(inny.bledy[0].powod).toContain("drugi raz");
  });

  it("zlecenie w toku z czesciowym wypelnieniem jest pominiete z ostrzezeniem", () => {
    const wiersz = wierszOrders({ id: "50", strona: "Buy", cena: "100", ilosc: 2, czas: "10/14/2026 10:00:00" }).replace(" Filled", " Working");
    const w = parsuj(`${NAGLOWEK_ORDERS}
${wiersz}
`);
    expect(w.wypelnienia).toHaveLength(0);
    expect(w.ostrzezenia.map((o) => o.code)).toContain("zlecenia_w_toku");
  });

  it("Cash History: waluta inna niz USD, zla kwota i zly czas to bledy", () => {
    const w = parsuj(
      plikCash([
        { id: "1", czas: "10/14/2026 10:00:00", delta: "-1.00", typ: "Commission", kontrakt: "MNQZ6", waluta: "EUR" },
        { id: "2", czas: "10/14/2026 10:00:00", delta: '"4,50"', typ: "Commission", kontrakt: "MNQZ6" },
        { id: "3", czas: "teraz", delta: "-1.00", typ: "Commission", kontrakt: "MNQZ6" },
        { id: "4", czas: "10/14/2026 10:00:00", delta: "-1.00", typ: "Commission", kontrakt: "MNQZ6" },
      ]),
    );
    expect(w.zdarzenia.map((z) => z.idZrodla)).toEqual(["4"]);
    expect(w.bledy.map((b) => b.powod)).toEqual([
      expect.stringContaining("Currency"),
      expect.stringContaining("Delta"),
      expect.stringContaining("Timestamp"),
    ]);
  });

  it("nieznany naglowek i pusty plik to odrzucenie calego pliku", () => {
    expect(parsujPlikBrokera(bajty("a,b\n1,2\n"), opcje)).toMatchObject({ ok: false, kod: "unknown_format" });
    expect(parsujPlikBrokera(bajty(""), opcje)).toMatchObject({ ok: false, kod: "empty" });
  });

  it("zakresy dat: przed 2000 i dalej niz jutro to bledy", () => {
    const w = parsuj(
      plikOrders([
        { id: "60", strona: "Buy", cena: "100", ilosc: 1, czas: "01/01/1999 10:00:00" },
        { id: "61", strona: "Buy", cena: "100", ilosc: 1, czas: "10/20/2026 10:00:00" },
        { id: "62", strona: "Buy", cena: "100", ilosc: 1, czas: "10/17/2026 10:00:00" },
      ]),
    );
    expect(w.wypelnienia.map((f) => f.idZrodla)).toEqual(["62"]);
    expect(w.bledy).toHaveLength(2);
  });

  it("Orders i Cash History w jednym pliku nie zdarza sie: kazdy format rozpoznawany osobno", () => {
    expect(NAGLOWEK_ORDERS).not.toBe(NAGLOWEK_CASH);
    expect(wierszCash({ id: "1", czas: "10/14/2026 10:00:00", delta: "-1.00", typ: "Commission" })).toContain("Commission");
  });
});
