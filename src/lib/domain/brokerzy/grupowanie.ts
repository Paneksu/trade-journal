/**
 * Grupowanie wypelnien w trade'y brokera (ADR-034 pkt 2). Czyste funkcje.
 *
 * Reguly (per konto u brokera i kontrakt, po czasie, remis po id zrodla):
 *  - trade = wyjscie pozycji netto z zera do powrotu do zera;
 *  - dokladanie do pozycji (scale-in) = srednia wazona cena wejscia, `maxQty` = najwieksza pozycja;
 *  - kazde zmniejszenie pozycji to osobne wyjscie (czesciowe wyjscia, ADR-025);
 *  - odwrocenie jednym wypelnieniem jest dzielone na zamkniecie i otwarcie (sufiks `#flip` w kluczu nowego trade'a);
 *  - pozycja otwarta na koncu danych to trade `open`; domyka go kolejny import.
 * Identyfikator trade'a (`klucz`) = id pierwszego wypelnienia wejscia (+ `#flip`), wiec ponowny albo zachodzacy import
 * zachowuje id i powiazanie trade'a brokera z trade'em dziennika.
 */

import type { Wypelnienie } from "./typy";

export type UdzialWypelnienia = {
  idZrodla: string;
  /** Ile z tego wypelnienia przypada na ten trade (przy odwroceniu jedno wypelnienie dzieli sie na dwa trade'y). */
  ilosc: number;
  /** Ile z calego wypelnienia (do podzialu oplat). */
  iloscCalegoWypelnienia: number;
  cena: number;
  czas: Date;
};

export type TradeZGrupowania = {
  /** Stabilny klucz: id pierwszego wypelnienia wejscia (+ `#flip` przy trade'ie otwartym odwroceniem). */
  klucz: string;
  kontrakt: string;
  kierunek: "long" | "short";
  maxIlosc: number;
  wejscia: UdzialWypelnienia[];
  wyjscia: UdzialWypelnienia[];
  sredniaCenaWejscia: number;
  sredniaCenaWyjscia: number | null;
  czasWejscia: Date;
  czasWyjscia: Date | null;
  status: "open" | "closed";
};

/** Porownanie id zrodla: liczbowe, gdy oba sa liczbami calkowitymi (Tradovate), inaczej tekstowe. */
function porownajId(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function posortujWypelnienia<T extends { czas: Date; idZrodla: string }>(wypelnienia: T[]): T[] {
  return [...wypelnienia].sort((a, b) => a.czas.getTime() - b.czas.getTime() || porownajId(a.idZrodla, b.idZrodla));
}

const EPS = 1e-9;

function srednia(czesci: UdzialWypelnienia[]): number {
  const suma = czesci.reduce((s, c) => s + c.ilosc, 0);
  return suma === 0 ? 0 : czesci.reduce((s, c) => s + c.cena * c.ilosc, 0) / suma;
}

type Budowany = {
  klucz: string;
  kierunek: "long" | "short";
  wejscia: UdzialWypelnienia[];
  wyjscia: UdzialWypelnienia[];
  pozycja: number;
  maxIlosc: number;
};

/**
 * Grupuje wypelnienia JEDNEGO konta i JEDNEGO kontraktu. Wolajacy dba, zeby zaczynac od pozycji plaskiej
 * (patrz okno przeliczania w serwisie importu) i nie mieszac kont ani kontraktow.
 */
function zbuduj(b: Budowany, kontrakt: string, zamkniety: boolean): TradeZGrupowania {
  return {
    klucz: b.klucz,
    kontrakt,
    kierunek: b.kierunek,
    maxIlosc: b.maxIlosc,
    wejscia: b.wejscia,
    wyjscia: b.wyjscia,
    sredniaCenaWejscia: srednia(b.wejscia),
    sredniaCenaWyjscia: b.wyjscia.length === 0 ? null : srednia(b.wyjscia),
    czasWejscia: b.wejscia[0].czas,
    czasWyjscia: zamkniety ? b.wyjscia[b.wyjscia.length - 1].czas : null,
    status: zamkniety ? "closed" : "open",
  };
}

function otworz(w: Wypelnienie, ilosc: number, flip: boolean): Budowany {
  const znak = w.strona === "buy" ? 1 : -1;
  return {
    klucz: flip ? `${w.idZrodla}#flip` : w.idZrodla,
    kierunek: znak === 1 ? "long" : "short",
    wejscia: [{ idZrodla: w.idZrodla, ilosc, iloscCalegoWypelnienia: w.ilosc, cena: w.cena, czas: w.czas }],
    wyjscia: [],
    pozycja: znak * ilosc,
    maxIlosc: ilosc,
  };
}

/**
 * Grupuje wypelnienia JEDNEGO konta i JEDNEGO kontraktu. Wolajacy dba, zeby zaczynac od pozycji plaskiej
 * (patrz okno przeliczania w serwisie importu) i nie mieszac kont ani kontraktow.
 */
export function grupujWypelnienia(wypelnienia: Wypelnienie[]): TradeZGrupowania[] {
  const kontrakty = new Set(wypelnienia.map((w) => w.kontrakt));
  if (kontrakty.size > 1) throw new Error(`grupujWypelnienia: wypełnienia z kilku kontraktów (${[...kontrakty].join(", ")}); grupuj osobno każdy kontrakt`);
  const kontrakt = wypelnienia[0]?.kontrakt ?? "";

  const wynik: TradeZGrupowania[] = [];
  let biezacy: Budowany | null = null;

  for (const w of posortujWypelnienia(wypelnienia)) {
    const znak = w.strona === "buy" ? 1 : -1;
    if (biezacy === null) {
      biezacy = otworz(w, w.ilosc, false);
      continue;
    }
    const kierunekZnak = biezacy.kierunek === "long" ? 1 : -1;
    if (znak === kierunekZnak) {
      biezacy.wejscia.push({ idZrodla: w.idZrodla, ilosc: w.ilosc, iloscCalegoWypelnienia: w.ilosc, cena: w.cena, czas: w.czas });
      biezacy.pozycja += znak * w.ilosc;
      biezacy.maxIlosc = Math.max(biezacy.maxIlosc, Math.abs(biezacy.pozycja));
      continue;
    }
    // Zmniejszenie pozycji: zamkniecie czesciowe, calkowite albo odwrocenie.
    const doZamkniecia = Math.min(Math.abs(biezacy.pozycja), w.ilosc);
    biezacy.wyjscia.push({ idZrodla: w.idZrodla, ilosc: doZamkniecia, iloscCalegoWypelnienia: w.ilosc, cena: w.cena, czas: w.czas });
    biezacy.pozycja += znak * doZamkniecia;
    if (Math.abs(biezacy.pozycja) < EPS) {
      wynik.push(zbuduj(biezacy, kontrakt, true));
      const reszta = w.ilosc - doZamkniecia;
      biezacy = reszta > EPS ? otworz(w, reszta, true) : null;
    }
  }
  if (biezacy !== null) wynik.push(zbuduj(biezacy, kontrakt, false));
  return wynik;
}

/** Grupuje wypelnienia wielu kont i kontraktow: osobno kazda para (konto, kontrakt). Zwraca trade'y z kontem. */
export function grupujWszystko(wypelnienia: Wypelnienie[]): (TradeZGrupowania & { konto: string })[] {
  const grupy = new Map<string, Wypelnienie[]>();
  for (const w of wypelnienia) {
    const klucz = `${w.konto}\u0000${w.kontrakt}`;
    const g = grupy.get(klucz);
    if (g) g.push(w);
    else grupy.set(klucz, [w]);
  }
  const wynik: (TradeZGrupowania & { konto: string })[] = [];
  for (const g of grupy.values()) {
    for (const t of grupujWypelnienia(g)) wynik.push({ ...t, konto: g[0].konto });
  }
  return wynik;
}
