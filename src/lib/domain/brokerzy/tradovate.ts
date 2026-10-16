/**
 * Parsery eksportu Tradovate: Orders i Cash History (ADR-034 pkt 2). Format ustalony na PRAWDZIWYCH plikach uzytkownika
 * z 13.10.2026; w repo sa tylko fikstury z identycznymi naglowkami i zmyslonymi wartosciami.
 *
 * Cechy plikow (POTWIERDZONE na probkach):
 *  - wartosci B/S, Status, Type i Cash Change Type maja spacje na poczatku (" Sell", " Filled"): przycinamy;
 *  - kwoty maja przecinek tysiecy w cudzyslowie ("24,995.50"): `liczby.ts`;
 *  - Orders: wiersz to ZLECENIE, nie pojedyncze wypelnienie; cena to avgPrice (srednia wazona calego zlecenia), ilosc to
 *    filledQty, czas wypelnienia to Fill Time. Anulowane zlecenia bez wypelnienia pomijamy;
 *  - Cash History: Commission to oplata za JEDNA strone i nie ma id zlecenia (laczymy z Orders po sekundzie i kontrakcie,
 *    `oplaty.ts`), Trade Paired to wynik BRUTTO pary wejscie-wyjscie;
 *  - czasy w formacie MM/DD/YYYY HH:MM:SS BEZ strefy: czytamy je w strefie podanej przez wolajacego i mowimy to w ostrzezeniu.
 * Modul czysty. Numer konta z pliku nie trafia do `raw`.
 */

import { parsujCzasBrokera } from "./czas";
import { wczytajCsv } from "./csv";
import { FORMATY, normalizujNaglowek, rozpoznajFormat, type OpisFormatu } from "./formaty";
import { parsujCenty, parsujLiczbe } from "./liczby";
import type {
  BladWiersza,
  OstrzezenieParsera,
  RodzajZdarzeniaCash,
  WynikParsowania,
  Wypelnienie,
  ZdarzenieCash,
} from "./typy";

export type OpcjeParsowania = {
  /** Strefa IANA dla czasow bez przesuniecia (ustawienie konta u brokera albo strefa uzytkownika). */
  strefa: string;
  /** "Teraz" do sprawdzenia zakresu dat (testy podaja stale). */
  teraz?: Date;
};

const DATA_MIN = Date.UTC(2000, 0, 1);
const DZIEN_MS = 86_400_000;
const WZORZEC_ID = /^[A-Za-z0-9_-]{1,40}$/;
const WZORZEC_KONTRAKTU = /^[A-Z0-9]{2,12}$/;
const MAKS_BLEDOW_W_RAPORCIE = 50;

const STATUSY_ZAKONCZONE = new Set(["filled", "canceled", "cancelled", "expired", "rejected"]);

type Kontekst = {
  opis: OpisFormatu;
  idx: Map<string, number>;
  naglowek: string[];
  strefa: string;
  teraz: number;
  bledy: BladWiersza[];
  ostrzezenia: OstrzezenieParsera[];
  zBrakiemStrefy: number;
  zZPliku: number;
  niejednoznacznych: number[];
  nieistniejacych: number[];
};

const kol = (k: Kontekst, nazwa: string, komorki: string[]): string => {
  const i = k.idx.get(nazwa);
  return i === undefined ? "" : (komorki[i] ?? "").trim();
};

function blad(k: Kontekst, numer: number, powod: string): void {
  if (k.bledy.length < MAKS_BLEDOW_W_RAPORCIE) k.bledy.push({ numerWiersza: numer, powod });
  else if (k.bledy.length === MAKS_BLEDOW_W_RAPORCIE) k.bledy.push({ numerWiersza: numer, powod: "…kolejne błędy pominięte w raporcie (plik i tak zostanie odrzucony)" });
}

/** Wiersz bez numeru konta (i bez wartosci zawierajacych numer konta). */
function bezKonta(k: Kontekst, komorki: string[], konto: string): Record<string, string> {
  const wynik: Record<string, string> = {};
  k.naglowek.forEach((nazwa, i) => {
    if (normalizujNaglowek(nazwa) === "account") return;
    const w = (komorki[i] ?? "").trim();
    if (w === "") return;
    wynik[nazwa.trim()] = konto !== "" && w.includes(konto) ? w.replaceAll(konto, "[konto]") : w;
  });
  return wynik;
}

function czas(k: Kontekst, numer: number, tekst: string, nazwaPola: string): Date | null {
  const w = parsujCzasBrokera(tekst, k.strefa);
  if (!w.ok) {
    blad(k, numer, `pole ${nazwaPola}: ${w.powod}`);
    return null;
  }
  const ms = w.czas.getTime();
  if (ms < DATA_MIN || ms > k.teraz + DZIEN_MS) {
    blad(k, numer, `pole ${nazwaPola}: czas ${w.czas.toISOString()} jest poza zakresem (od 2000-01-01 do jutra)`);
    return null;
  }
  if (w.zPliku) k.zZPliku += 1;
  else k.zBrakiemStrefy += 1;
  if (w.niejednoznaczny) k.niejednoznacznych.push(numer);
  if (w.nieistniejacy) k.nieistniejacych.push(numer);
  return w.czas;
}

function ostrzezeniaCzasu(k: Kontekst): void {
  if (k.niejednoznacznych.length > 0) {
    k.ostrzezenia.push({
      code: "czas_niejednoznaczny",
      message: `${k.niejednoznacznych.length} wierszy ma godzinę, która w strefie ${k.strefa} wystąpiła dwa razy (zmiana czasu jesienią; wiersze: ${k.niejednoznacznych.slice(0, 5).join(", ")}). Przyjęto pierwsze wystąpienie (czas letni).`,
    });
  }
  if (k.nieistniejacych.length > 0) {
    k.ostrzezenia.push({
      code: "czas_nieistniejacy",
      message: `${k.nieistniejacych.length} wierszy ma godzinę, której w strefie ${k.strefa} nie było (zmiana czasu wiosną; wiersze: ${k.nieistniejacych.slice(0, 5).join(", ")}). Przesunięto ją do przodu o godzinę.`,
    });
  }
}

function przygotuj(opis: OpisFormatu, idx: Map<string, number>, naglowek: string[], o: OpcjeParsowania): Kontekst {
  return {
    opis,
    idx,
    naglowek,
    strefa: o.strefa,
    teraz: (o.teraz ?? new Date()).getTime(),
    bledy: [],
    ostrzezenia: [],
    zBrakiemStrefy: 0,
    zZPliku: 0,
    niejednoznacznych: [],
    nieistniejacych: [],
  };
}

type Wiersz = { numer: number; komorki: string[] };

/* ---------------------------------------------------------------- Orders */

export function parsujTradovateOrders(
  naglowek: string[],
  wiersze: Wiersz[],
  idx: Map<string, number>,
  o: OpcjeParsowania,
): { wypelnienia: Wypelnienie[]; pominiete: number; k: Kontekst } {
  const k = przygotuj(FORMATY[0], idx, naglowek, o);
  const wypelnienia: Wypelnienie[] = [];
  const widziane = new Map<string, string>();
  let pominiete = 0;
  let wToku = 0;

  for (const w of wiersze) {
    const konto = kol(k, "account", w.komorki);
    const id = kol(k, "orderid", w.komorki);
    const status = kol(k, "status", w.komorki).toLowerCase();
    const iloscTekst = kol(k, "filledqty", w.komorki) || kol(k, "filled qty", w.komorki);

    // Zlecenie bez wypelnienia (anulowane, odrzucone) nie jest transakcja.
    if (iloscTekst === "" || Number(iloscTekst.replaceAll(",", "")) === 0) {
      pominiete += 1;
      continue;
    }
    if (!STATUSY_ZAKONCZONE.has(status)) {
      wToku += 1;
      pominiete += 1;
      continue;
    }

    const bledyPrzed = k.bledy.length;
    if (konto === "") blad(k, w.numer, "pole Account: puste");
    if (!WZORZEC_ID.test(id)) blad(k, w.numer, `pole orderId: »${id.slice(0, 40)}« nie jest identyfikatorem (litery, cyfry, - i _, do 40 znaków)`);
    const kontrakt = kol(k, "contract", w.komorki).toUpperCase();
    if (!WZORZEC_KONTRAKTU.test(kontrakt)) blad(k, w.numer, `pole Contract: »${kontrakt.slice(0, 40)}« nie jest symbolem kontraktu (np. MNQZ6)`);
    const stronaTekst = kol(k, "b/s", w.komorki).toLowerCase();
    const strona = stronaTekst === "buy" ? "buy" : stronaTekst === "sell" ? "sell" : null;
    if (strona === null) blad(k, w.numer, `pole B/S: »${stronaTekst.slice(0, 20)}« to nie Buy ani Sell`);

    const ilosc = parsujLiczbe(iloscTekst);
    if (!ilosc.ok) blad(k, w.numer, `pole filledQty: ${ilosc.powod}`);
    else if (ilosc.wartosc <= 0 || ilosc.wartosc > 1_000_000) blad(k, w.numer, `pole filledQty: ${ilosc.wartosc} musi być większe od zera i nie większe niż 1000000`);
    const cenaTekst = kol(k, "avgprice", w.komorki) || kol(k, "avg fill price", w.komorki);
    const cena = parsujLiczbe(cenaTekst);
    if (!cena.ok) blad(k, w.numer, `pole avgPrice: ${cena.powod}`);
    else if (cena.wartosc <= 0 || cena.wartosc > 1e9) blad(k, w.numer, `pole avgPrice: ${cena.wartosc} musi być większe od zera`);
    const czasWypelnienia = czas(k, w.numer, kol(k, "fill time", w.komorki), "Fill Time");

    if (k.bledy.length > bledyPrzed || strona === null || !ilosc.ok || !cena.ok || czasWypelnienia === null) continue;

    const klucz = `${konto}|${id}`;
    const surowy = JSON.stringify(w.komorki.map((c) => c.trim()));
    const poprzedni = widziane.get(klucz);
    if (poprzedni !== undefined) {
      if (poprzedni === surowy) {
        pominiete += 1;
        k.ostrzezenia.push({ code: "powtorzony_wiersz", message: `Wiersz ${w.numer} powtarza zlecenie ${id} z wcześniejszego wiersza (identyczny): pominięto.` });
      } else {
        blad(k, w.numer, `zlecenie ${id} występuje drugi raz w pliku z innymi wartościami`);
      }
      continue;
    }
    widziane.set(klucz, surowy);

    wypelnienia.push({
      idZrodla: id,
      konto,
      kontrakt,
      strona,
      ilosc: ilosc.wartosc,
      cena: cena.wartosc,
      czas: czasWypelnienia,
      zlecenie: id,
      raw: bezKonta(k, w.komorki, konto),
      numerWiersza: w.numer,
    });
  }
  if (wToku > 0) {
    k.ostrzezenia.push({ code: "zlecenia_w_toku", message: `${wToku} zleceń ma status inny niż zakończony (np. w toku) i częściowe wypełnienie: pominięto je. Wyeksportuj raport po zakończeniu sesji.` });
  }
  ostrzezeniaCzasu(k);
  return { wypelnienia, pominiete, k };
}

/* ---------------------------------------------------------- Cash History */

export function rodzajZdarzeniaCash(typ: string): RodzajZdarzeniaCash {
  const t = typ.trim().toLowerCase();
  if (t === "commission") return "commission";
  if (t === "trade paired") return "trade_paired";
  if (t === "fund transaction") return "deposit";
  if (/\bfee\b/.test(t)) return "fee";
  return "other";
}

export function parsujTradovateCash(
  naglowek: string[],
  wiersze: Wiersz[],
  idx: Map<string, number>,
  o: OpcjeParsowania,
): { zdarzenia: ZdarzenieCash[]; pominiete: number; k: Kontekst } {
  const k = przygotuj(FORMATY[1], idx, naglowek, o);
  const zdarzenia: ZdarzenieCash[] = [];
  const widziane = new Map<string, string>();
  let pominiete = 0;
  const nieznane = new Map<string, number>();

  for (const w of wiersze) {
    const bledyPrzed = k.bledy.length;
    const konto = kol(k, "account", w.komorki);
    const id = kol(k, "transaction id", w.komorki);
    if (konto === "") blad(k, w.numer, "pole Account: puste");
    if (!WZORZEC_ID.test(id)) blad(k, w.numer, `pole Transaction ID: »${id.slice(0, 40)}« nie jest identyfikatorem`);
    const typ = kol(k, "cash change type", w.komorki);
    if (typ === "") blad(k, w.numer, "pole Cash Change Type: puste");
    const waluta = kol(k, "currency", w.komorki).toUpperCase();
    if (waluta !== "USD") blad(k, w.numer, `pole Currency: »${waluta.slice(0, 10)}« (obsługujemy tylko USD; konto w innej walucie wymaga przeliczenia)`);
    const delta = parsujCenty(kol(k, "delta", w.komorki));
    if (!delta.ok) blad(k, w.numer, `pole Delta: ${delta.powod}`);
    const kontraktTekst = kol(k, "contract", w.komorki).toUpperCase();
    if (kontraktTekst !== "" && !WZORZEC_KONTRAKTU.test(kontraktTekst)) blad(k, w.numer, `pole Contract: »${kontraktTekst.slice(0, 40)}« nie jest symbolem kontraktu`);
    const kiedy = czas(k, w.numer, kol(k, "timestamp", w.komorki), "Timestamp");
    if (k.bledy.length > bledyPrzed || !delta.ok || kiedy === null) continue;

    const rodzaj = rodzajZdarzeniaCash(typ);
    if (rodzaj === "other") nieznane.set(typ, (nieznane.get(typ) ?? 0) + 1);
    const klucz = `${konto}|${id}`;
    const surowy = JSON.stringify(w.komorki.map((c) => c.trim()));
    const poprzedni = widziane.get(klucz);
    if (poprzedni !== undefined) {
      if (poprzedni === surowy) {
        pominiete += 1;
      } else {
        blad(k, w.numer, `transakcja ${id} występuje drugi raz w pliku z innymi wartościami`);
      }
      continue;
    }
    widziane.set(klucz, surowy);
    zdarzenia.push({
      idZrodla: id,
      konto,
      rodzaj,
      deltaCenty: delta.centy,
      kontrakt: kontraktTekst === "" ? null : kontraktTekst,
      czas: kiedy,
      raw: bezKonta(k, w.komorki, konto),
      numerWiersza: w.numer,
    });
  }
  if (nieznane.size > 0) {
    k.ostrzezenia.push({
      code: "nieznany_typ_cash",
      message: `Cash History ma typy transakcji, których nie liczymy do wyniku: ${[...nieznane].map(([t, n]) => `»${t.slice(0, 40)}« (${n})`).join(", ")}. Zapisano je bez wpływu na opłaty i wynik brutto.`,
    });
  }
  ostrzezeniaCzasu(k);
  return { zdarzenia, pominiete, k };
}

/* ------------------------------------------------------ wejscie z bajtow */

/**
 * Cala droga od bajtow pliku do znormalizowanych danych: CSV (limity), rozpoznanie po naglowkach, parser formatu.
 * Nie zapisuje niczego i nie wola bazy. Blad wiersza nie przerywa parsowania (zbieramy je do raportu podgladu);
 * decyzja, czy plik z bledami wolno zastosowac, nalezy do wolajacego (UI: swiadome pominiecie; automat: odrzucenie).
 */
export function parsujPlikBrokera(bajty: Uint8Array, o: OpcjeParsowania): WynikParsowania {
  const csv = wczytajCsv(bajty);
  if (!csv.ok) return { ok: false, kod: csv.kod, komunikat: csv.komunikat };
  const rozpoznanie = rozpoznajFormat(csv.naglowek);
  if (!rozpoznanie.ok) return { ok: false, kod: rozpoznanie.kod, komunikat: rozpoznanie.komunikat };
  const { format, indeksy } = rozpoznanie;

  if (format.nazwa === "tradovate_orders") {
    const { wypelnienia, pominiete, k } = parsujTradovateOrders(csv.naglowek, csv.wiersze, indeksy, o);
    return {
      ok: true,
      format: format.nazwa,
      wypelnienia,
      zdarzenia: [],
      pominiete,
      bledy: k.bledy,
      ostrzezenia: k.ostrzezenia,
      wierszy: csv.wiersze.length,
      czasBezStrefy: k.zBrakiemStrefy > 0 && k.zZPliku === 0,
    };
  }
  const { zdarzenia, pominiete, k } = parsujTradovateCash(csv.naglowek, csv.wiersze, indeksy, o);
  return {
    ok: true,
    format: format.nazwa,
    wypelnienia: [],
    zdarzenia,
    pominiete,
    bledy: k.bledy,
    ostrzezenia: k.ostrzezenia,
    wierszy: csv.wiersze.length,
    czasBezStrefy: k.zBrakiemStrefy > 0 && k.zZPliku === 0,
  };
}
