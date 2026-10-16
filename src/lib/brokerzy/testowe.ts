/**
 * Pomocniki WYLACZNIE do testow: wczytanie fikstur i budowanie plikow w pamieci. Fikstury maja identyczne naglowki jak
 * prawdziwe eksporty Tradovate, ale zmyslone wartosci (konto TST...). Nie importowac z kodu produkcyjnego.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const KATALOG_FIKSTUR = path.join(__dirname, "..", "domain", "brokerzy", "fixtures");

export const wczytajFiksture = (nazwa: string): string => readFileSync(path.join(KATALOG_FIKSTUR, nazwa), "utf8");
export const bajty = (tekst: string): Uint8Array => new TextEncoder().encode(tekst);

export const ORDERS = wczytajFiksture("tradovate-orders.csv");
export const CASH = wczytajFiksture("tradovate-cash-history.csv");
export const NAGLOWEK_ORDERS = ORDERS.split("\n")[0];
export const NAGLOWEK_CASH = CASH.split("\n")[0];

/** Stale »teraz« z zakresem pokrywajacym czasy fikstur (14.10.2026). */
export const TERAZ = new Date("2026-10-16T12:00:00Z");

type ZlecenieProbki = { id: string; strona: "Buy" | "Sell"; cena: string; ilosc: number; czas: string; kontrakt?: string; konto?: string; status?: string };

/** Wiersz Orders o dokladnie takich kolumnach jak w prawdziwym pliku (zmyslone wartosci). */
export function wierszOrders(z: ZlecenieProbki): string {
  const konto = z.konto ?? "TST00000000002";
  const kontrakt = z.kontrakt ?? "MNQZ6";
  const status = z.status ?? "Filled";
  const wyp = status === "Filled";
  const dataKrotka = `${z.czas.slice(0, 6)}${z.czas.slice(8, 10)}`;
  return [
    z.id, konto, z.id, ` ${z.strona}`, kontrakt, kontrakt.replace(/[A-Z]\d$/, ""), "Opis", wyp ? z.cena : "", wyp ? String(z.ilosc) : "", wyp ? z.czas : "",
    z.id, ` ${status}`, "-2", "0", "0.25", "", z.id, z.czas, dataKrotka, String(z.ilosc), "Tradingview", " Market", "", "", "", "",
    wyp ? String(z.ilosc) : "", wyp ? Number(z.cena).toFixed(2) : "", wyp ? z.cena : "", "", wyp ? '"1,000.00"' : "", "USD",
  ].join(",");
}

export const plikOrders = (wiersze: ZlecenieProbki[]): string => [NAGLOWEK_ORDERS, ...wiersze.map(wierszOrders)].join("\n") + "\n";

export function wierszCash(o: { id: string; czas: string; delta: string; typ: string; kontrakt?: string; konto?: string; waluta?: string }): string {
  const data = `${o.czas.slice(6, 10)}-${o.czas.slice(0, 2)}-${o.czas.slice(3, 5)}`;
  return [o.konto ?? "TST00000000002", o.id, o.czas, data, o.delta, '"1,000.00"', ` ${o.typ}`, o.waluta ?? "USD", o.kontrakt ?? ""].join(",");
}

export const plikCash = (wiersze: Parameters<typeof wierszCash>[0][]): string => [NAGLOWEK_CASH, ...wiersze.map(wierszCash)].join("\n") + "\n";
