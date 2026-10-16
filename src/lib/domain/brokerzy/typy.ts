/**
 * Typy znormalizowanych danych brokera (ADR-034 pkt 2): kazdy parser zwraca wypelnienia (fills) i zdarzenia gotowkowe,
 * a dalej wszystko (grupowanie, dopasowanie, opłaty) jest wspólne dla wszystkich zrodel.
 * Moduly w tym katalogu sa czyste: bez bazy, bez Next, bez `server-only`.
 */

export type PlatformaPliku = "tradovate" | "tradingview" | "topstepx" | "rithmic" | "ninjatrader" | "generic";

export type NazwaFormatu = "tradovate_orders" | "tradovate_cash_history";

/** Jedno wypelnienie. `konto` to SUROWY numer konta z pliku: warstwa serwera zamienia go na HMAC i nie zapisuje jawnie. */
export type Wypelnienie = {
  /** Id w zrodle (Tradovate: orderId). Wchodzi do `external_ref`, wiec musi byc stabilne miedzy eksportami. */
  idZrodla: string;
  konto: string;
  /** Pelny symbol kontraktu u brokera, np. MNQZ6. */
  kontrakt: string;
  strona: "buy" | "sell";
  ilosc: number;
  cena: number;
  czas: Date;
  zlecenie: string | null;
  /** Sparsowany wiersz BEZ numeru konta (wartosci zawierajace numer konta sa zastapione). */
  raw: Record<string, string>;
  numerWiersza: number;
};

export type RodzajZdarzeniaCash = "commission" | "fee" | "trade_paired" | "deposit" | "other";

/** Zdarzenie z Cash History: kwota ze znakiem (koszt < 0). */
export type ZdarzenieCash = {
  idZrodla: string;
  konto: string;
  rodzaj: RodzajZdarzeniaCash;
  deltaCenty: number;
  kontrakt: string | null;
  czas: Date;
  raw: Record<string, string>;
  numerWiersza: number;
};

export type BladWiersza = { numerWiersza: number; powod: string };

export type OstrzezenieParsera = { code: string; message: string };

export type WynikParsowania =
  | {
      ok: true;
      format: NazwaFormatu;
      wypelnienia: Wypelnienie[];
      zdarzenia: ZdarzenieCash[];
      /** Wiersze pominiete swiadomie (np. anulowane zlecenia bez wypelnienia, powtorzone wiersze). */
      pominiete: number;
      bledy: BladWiersza[];
      ostrzezenia: OstrzezenieParsera[];
      /** Wierszy danych w pliku (bez naglowka). */
      wierszy: number;
      /** Prawda, gdy zadna komórka czasu w pliku nie miala przesuniecia strefy (czytamy je w strefie z ustawien). */
      czasBezStrefy: boolean;
    }
  | { ok: false; kod: string; komunikat: string };
