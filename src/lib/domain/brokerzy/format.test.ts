import { describe, expect, it } from "vitest";

import { komorkaCsv, liniaCsv, zabezpieczKomorkeCsv } from "./csv-eksport";
import { LIMIT_BAJTOW, LIMIT_KOLUMN, LIMIT_KOMORKI, LIMIT_WIERSZY, wczytajCsv } from "./csv";
import { parsujCzasBrokera } from "./czas";
import { FORMATY, rozpoznajFormat } from "./formaty";
import { klasaKontraktu, rdzenKontraktu } from "./kontrakty";
import { parsujCenty, parsujLiczbe } from "./liczby";
import { bajty, NAGLOWEK_CASH, NAGLOWEK_ORDERS } from "./testowe";

describe("liczby z plikow brokera", () => {
  it("czyta kropke dziesietna i przecinek tysiecy", () => {
    expect(parsujLiczbe("30785.50")).toEqual({ ok: true, wartosc: 30785.5 });
    expect(parsujLiczbe("554,139.00")).toEqual({ ok: true, wartosc: 554139 });
    expect(parsujLiczbe("-4.50")).toEqual({ ok: true, wartosc: -4.5 });
  });

  it("odrzuca przecinek dziesietny i smieci zamiast zgadywac", () => {
    for (const zle of ["4,50", "12,3456", "1.2.3", "abc", "", "1e5", "--1"]) {
      expect(parsujLiczbe(zle).ok, zle).toBe(false);
    }
  });

  it("kwoty na centy bez liczb zmiennoprzecinkowych", () => {
    expect(parsujCenty("-4.50")).toEqual({ ok: true, centy: -450 });
    expect(parsujCenty("24,995.50")).toEqual({ ok: true, centy: 2_499_550 });
    expect(parsujCenty("-450.00")).toEqual({ ok: true, centy: -45_000 });
    expect(parsujCenty("0.1")).toEqual({ ok: true, centy: 10 });
    expect(parsujCenty("1.10")).toEqual({ ok: true, centy: 110 });
    expect(parsujCenty("-0.00")).toEqual({ ok: true, centy: 0 });
    // 19.99 w double to 1998.9999999999998; na napisie wychodzi dokladnie.
    expect(parsujCenty("19.99")).toEqual({ ok: true, centy: 1999 });
  });

  it("kwota z trzecim miejscem po kropce (poza zerami) nie jest w centach", () => {
    expect(parsujCenty("1.005").ok).toBe(false);
    expect(parsujCenty("1.500")).toEqual({ ok: true, centy: 150 });
    expect(parsujCenty("4,50").ok).toBe(false);
  });
});

describe("czas z plikow brokera: strefa jawna", () => {
  it("MM/DD/YYYY HH:MM:SS bez strefy czyta w strefie podanej i mowi, ze strefa nie byla w pliku", () => {
    const w = parsujCzasBrokera("10/13/2026 16:03:12", "Europe/Warsaw");
    expect(w).toMatchObject({ ok: true, zPliku: false });
    if (w.ok) expect(w.czas.toISOString()).toBe("2026-10-13T14:03:12.000Z"); // CEST = UTC+2
    const ny = parsujCzasBrokera("10/13/2026 16:03:12", "America/New_York");
    if (ny.ok) expect(ny.czas.toISOString()).toBe("2026-10-13T20:03:12.000Z"); // EDT = UTC-4
  });

  it("ISO z przesunieciem bierze przesuniecie, nie strefe", () => {
    const w = parsujCzasBrokera("2026-10-13T16:03:12+02:00", "America/New_York");
    expect(w).toMatchObject({ ok: true, zPliku: true });
    if (w.ok) expect(w.czas.toISOString()).toBe("2026-10-13T14:03:12.000Z");
    const z = parsujCzasBrokera("2026-10-13T14:03:12Z", "Asia/Tokyo");
    if (z.ok) expect(z.czas.toISOString()).toBe("2026-10-13T14:03:12.000Z");
  });

  it("zmiana czasu w USA (marzec 2026): godzina, ktorej nie ma, przesuwa sie do przodu z flaga", () => {
    // 8 marca 2026, 02:30 w Nowym Jorku nie istnieje (02:00 -> 03:00).
    const luka = parsujCzasBrokera("03/08/2026 02:30:00", "America/New_York");
    expect(luka).toMatchObject({ ok: true, nieistniejacy: true });
    if (luka.ok) expect(luka.czas.toISOString()).toBe("2026-03-08T07:30:00.000Z"); // = 03:30 EDT
    const przed = parsujCzasBrokera("03/08/2026 01:59:59", "America/New_York");
    if (przed.ok) expect(przed.czas.toISOString()).toBe("2026-03-08T06:59:59.000Z");
    const po = parsujCzasBrokera("03/08/2026 03:00:00", "America/New_York");
    if (po.ok) expect(po.czas.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

  it("zmiana czasu w USA (listopad 2026): godzina powtorzona bierze pierwsze wystapienie, z flaga", () => {
    // 1 listopada 2026, 01:30 w Nowym Jorku wystepuje dwa razy (EDT, potem EST).
    const w = parsujCzasBrokera("11/01/2026 01:30:00", "America/New_York");
    expect(w).toMatchObject({ ok: true, niejednoznaczny: true });
    if (w.ok) expect(w.czas.toISOString()).toBe("2026-11-01T05:30:00.000Z"); // pierwsze, EDT
    const po = parsujCzasBrokera("11/01/2026 02:30:00", "America/New_York");
    expect(po).toMatchObject({ ok: true, niejednoznaczny: false });
    if (po.ok) expect(po.czas.toISOString()).toBe("2026-11-01T07:30:00.000Z");
  });

  it("zmiana czasu w UE (marzec i pazdziernik 2026, Warszawa)", () => {
    const luka = parsujCzasBrokera("03/29/2026 02:30:00", "Europe/Warsaw");
    expect(luka).toMatchObject({ ok: true, nieistniejacy: true });
    if (luka.ok) expect(luka.czas.toISOString()).toBe("2026-03-29T01:30:00.000Z"); // 03:30 CEST
    const powtorka = parsujCzasBrokera("10/25/2026 02:30:00", "Europe/Warsaw");
    expect(powtorka).toMatchObject({ ok: true, niejednoznaczny: true });
    if (powtorka.ok) expect(powtorka.czas.toISOString()).toBe("2026-10-25T00:30:00.000Z"); // pierwsze, CEST
    // Rozne rozbieznosci miedzy USA i UE: 29.03.2026 w USA to juz czas letni, w UE dopiero od 02:00.
    const zwykly = parsujCzasBrokera("03/15/2026 12:00:00", "Europe/Warsaw");
    if (zwykly.ok) expect(zwykly.czas.toISOString()).toBe("2026-03-15T11:00:00.000Z"); // CET = UTC+1
  });

  it("AM/PM, nieistniejace daty i niepoprawne strefy to bledy z powodem", () => {
    const pm = parsujCzasBrokera("10/13/2026 04:03:12 PM", "Europe/Warsaw");
    if (pm.ok) expect(pm.czas.toISOString()).toBe("2026-10-13T14:03:12.000Z");
    expect(parsujCzasBrokera("02/30/2026 10:00:00", "Europe/Warsaw")).toMatchObject({ ok: false });
    expect(parsujCzasBrokera("13/13/2026 10:00:00", "Europe/Warsaw")).toMatchObject({ ok: false });
    expect(parsujCzasBrokera("10/13/2026 10:00:00", "Mars/Olympus")).toMatchObject({ ok: false });
    expect(parsujCzasBrokera("wczoraj", "Europe/Warsaw")).toMatchObject({ ok: false });
    expect(parsujCzasBrokera("", "Europe/Warsaw")).toMatchObject({ ok: false });
  });
});

describe("kontrakty", () => {
  it("rdzen z symbolu kontraktu", () => {
    expect(rdzenKontraktu("NQZ6")).toBe("NQ");
    expect(rdzenKontraktu("MNQZ6")).toBe("MNQ");
    expect(rdzenKontraktu("M2KZ6")).toBe("M2K");
    expect(rdzenKontraktu("6EZ6")).toBe("6E");
    expect(rdzenKontraktu("ZNZ6")).toBe("ZN");
    expect(rdzenKontraktu("GCQ26")).toBe("GC");
    expect(rdzenKontraktu("MNQ")).toBe("MNQ");
    expect(rdzenKontraktu("mnqz6")).toBe("MNQ");
    expect(rdzenKontraktu("")).toBeNull();
    expect(rdzenKontraktu("NQ Z6")).toBeNull();
  });

  it("klasa kontraktu: micro dla znanych kontraktow micro, reszta mini", () => {
    expect(klasaKontraktu("MNQ")).toBe("micro");
    expect(klasaKontraktu("MES")).toBe("micro");
    expect(klasaKontraktu("NQ")).toBe("mini");
    expect(klasaKontraktu("ES")).toBe("mini");
    expect(klasaKontraktu("mgc")).toBe("micro");
  });
});

describe("rozpoznanie formatu po naglowkach", () => {
  it("rozpoznaje Orders i Cash History z prawdziwych naglowkow", () => {
    const orders = rozpoznajFormat(NAGLOWEK_ORDERS.split(","));
    expect(orders).toMatchObject({ ok: true });
    if (orders.ok) expect(orders.format.nazwa).toBe("tradovate_orders");
    const cash = rozpoznajFormat(NAGLOWEK_CASH.split(","));
    if (cash.ok) expect(cash.format.nazwa).toBe("tradovate_cash_history");
    else throw new Error("Cash History nie rozpoznane");
  });

  it("wielkosc liter i biale znaki na brzegach nie przeszkadzaja", () => {
    const wynik = rozpoznajFormat(NAGLOWEK_CASH.split(",").map((k) => ` ${k.toUpperCase()} `));
    expect(wynik).toMatchObject({ ok: true });
  });

  it("nieznany naglowek: odrzucenie z lista obslugiwanych formatow, bez zgadywania", () => {
    const w = rozpoznajFormat(["Data", "Symbol", "Cena"]);
    expect(w).toMatchObject({ ok: false, kod: "unknown_format" });
    if (!w.ok) {
      expect(w.komunikat).toContain("Tradovate: Orders");
      expect(w.komunikat).toContain("Tradovate: Cash History");
      expect(w.komunikat).toContain("Data, Symbol, Cena");
    }
  });

  it("plik z kolumnami dwoch formatow naraz jest odrzucony jako niejednoznaczny", () => {
    const wszystkie = [...new Set(FORMATY.flatMap((f) => f.wymagane))];
    expect(rozpoznajFormat(wszystkie)).toMatchObject({ ok: false, kod: "ambiguous_format" });
  });

  it("brak jednej kolumny wymaganej = nieznany format", () => {
    const bezDelty = NAGLOWEK_CASH.split(",").filter((k) => k !== "Delta");
    expect(rozpoznajFormat(bezDelty)).toMatchObject({ ok: false, kod: "unknown_format" });
  });
});

describe("wczytanie CSV: kodowanie, separator, limity", () => {
  const prosty = `${NAGLOWEK_CASH}\nA,1,10/14/2026 10:00:00,2026-10-14,"1,000.00",1,x,USD,\n`;

  it("UTF-8, UTF-8 z BOM i UTF-16LE z BOM daja to samo", () => {
    const a = wczytajCsv(bajty(prosty));
    const b = wczytajCsv(bajty(`﻿${prosty}`));
    const c = wczytajCsv(new Uint8Array(Buffer.from(`﻿${prosty}`, "utf16le")));
    for (const w of [a, b, c]) expect(w.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(b.naglowek).toEqual(a.naglowek);
      expect(c.wiersze).toEqual(a.wiersze);
      expect(a.wiersze[0].komorki[4]).toBe("1,000.00");
      expect(c.kodowanie).toBe("utf-16le");
    }
  });

  it("separator srednik wykryty z naglowka; przecinek wewnatrz cudzyslowu nie liczy sie", () => {
    const w = wczytajCsv(bajty('a;b;"c,d"\n1;2;3\n'));
    expect(w).toMatchObject({ ok: true, separator: ";" });
    if (w.ok) expect(w.naglowek).toEqual(["a", "b", "c,d"]);
  });

  it("zly UTF-8, UTF-16BE i pusty plik to odrzucenie z kodem", () => {
    expect(wczytajCsv(new Uint8Array([0xff, 0xff, 0x41]))).toMatchObject({ ok: false, kod: "bad_encoding" });
    expect(wczytajCsv(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toMatchObject({ ok: false, kod: "bad_encoding" });
    expect(wczytajCsv(new Uint8Array(0))).toMatchObject({ ok: false, kod: "empty" });
  });

  it("limit 5 MB: odrzucenie calego pliku, nie obciecie", () => {
    const duzy = new Uint8Array(LIMIT_BAJTOW + 1).fill(97);
    const w = wczytajCsv(duzy);
    expect(w).toMatchObject({ ok: false, kod: "too_large" });
    if (!w.ok) expect(w.komunikat).toContain(String(LIMIT_BAJTOW + 1));
  });

  it("limit 20 000 wierszy", () => {
    const wiersze = Array.from({ length: LIMIT_WIERSZY + 1 }, (_, i) => `${i},x`).join("\n");
    expect(wczytajCsv(bajty(`a,b\n${wiersze}\n`))).toMatchObject({ ok: false, kod: "too_many_rows" });
    const rowne = Array.from({ length: LIMIT_WIERSZY }, (_, i) => `${i},x`).join("\n");
    expect(wczytajCsv(bajty(`a,b\n${rowne}\n`))).toMatchObject({ ok: true });
  });

  it("limit 64 kolumn", () => {
    const naglowek = Array.from({ length: LIMIT_KOLUMN + 1 }, (_, i) => `k${i}`).join(",");
    expect(wczytajCsv(bajty(`${naglowek}\n`))).toMatchObject({ ok: false, kod: "too_many_columns" });
  });

  it("limit komorki 1 KB: dokladnie 1024 znaki przechodzi, 1025 odrzuca caly plik", () => {
    expect(wczytajCsv(bajty(`a,b\n${"x".repeat(LIMIT_KOMORKI)},1\n`))).toMatchObject({ ok: true });
    expect(wczytajCsv(bajty(`a,b\n${"x".repeat(LIMIT_KOMORKI + 1)},1\n`))).toMatchObject({ ok: false, kod: "cell_too_long" });
  });

  it("niedomkniety cudzyslow to blad CSV, nie zjedzone pol pliku", () => {
    expect(wczytajCsv(bajty('a,b\n"nie domkniete,2\n3,4\n'))).toMatchObject({ ok: false, kod: "bad_csv" });
  });

  it("puste linie sa pomijane, a wiersze o roznej liczbie kolumn nie wywracaja parsera", () => {
    const w = wczytajCsv(bajty("a,b,c\n\n1,2\n3,4,5\n"));
    expect(w).toMatchObject({ ok: true });
    if (w.ok) expect(w.wiersze.map((x) => x.komorki.length)).toEqual([2, 3]);
  });
});

describe("ucieczka formul w eksporcie CSV (CSV injection)", () => {
  it.each(["=", "+", "-", "@", "\t", "\r"])("komorka tekstowa zaczynajaca sie od %j dostaje apostrof", (znak) => {
    expect(zabezpieczKomorkeCsv(`${znak}SUM(A1)`)).toBe(`'${znak}SUM(A1)`);
  });

  it("zwykly tekst i pusty tekst bez zmian; apostrof tylko na poczatku", () => {
    expect(zabezpieczKomorkeCsv("MNQ")).toBe("MNQ");
    expect(zabezpieczKomorkeCsv("")).toBe("");
    expect(zabezpieczKomorkeCsv("a=b")).toBe("a=b");
    expect(zabezpieczKomorkeCsv(" =1")).toBe(" =1");
  });

  it("liczby (typ number) nie dostaja apostrofu, bo ujemna liczba nie jest formula", () => {
    expect(komorkaCsv(-450)).toBe("-450");
    expect(komorkaCsv("-450")).toBe("'-450");
    expect(komorkaCsv(null)).toBe("");
  });

  it("cytowanie przecinka, cudzyslowu i nowej linii po ucieczce formuly", () => {
    expect(komorkaCsv('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(liniaCsv(["a,b", 3, "-x", null])).toBe('"a,b",3,\'-x,');
  });
});
