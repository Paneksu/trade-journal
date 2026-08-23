/**
 * Dane poczatkowe: katalog kontraktow, kategorie tagow i przykladowe pola wlasne.
 * Wszystko jest pozniej edytowalne w ustawieniach - to tylko punkt startu,
 * zeby pierwszy trade dalo sie wpisac bez konfigurowania czegokolwiek.
 *
 * `tickValue` w tysiecznych dolara.
 */

export type InstrumentSeed = {
  symbol: string;
  name: string;
  exchange: string;
  tickSize: string;
  tickValue: number;
  rthFrom: string;
  rthTo: string;
  sortOrder: number;
};

export const INSTRUMENTS: InstrumentSeed[] = [
  // Indeksy
  { symbol: "ES", name: "E-mini S&P 500", exchange: "CME", tickSize: "0.25", tickValue: 12500, rthFrom: "09:30", rthTo: "16:00", sortOrder: 10 },
  { symbol: "MES", name: "Micro E-mini S&P 500", exchange: "CME", tickSize: "0.25", tickValue: 1250, rthFrom: "09:30", rthTo: "16:00", sortOrder: 11 },
  { symbol: "NQ", name: "E-mini Nasdaq 100", exchange: "CME", tickSize: "0.25", tickValue: 5000, rthFrom: "09:30", rthTo: "16:00", sortOrder: 20 },
  { symbol: "MNQ", name: "Micro E-mini Nasdaq 100", exchange: "CME", tickSize: "0.25", tickValue: 500, rthFrom: "09:30", rthTo: "16:00", sortOrder: 21 },
  { symbol: "YM", name: "E-mini Dow", exchange: "CBOT", tickSize: "1", tickValue: 5000, rthFrom: "09:30", rthTo: "16:00", sortOrder: 30 },
  { symbol: "MYM", name: "Micro E-mini Dow", exchange: "CBOT", tickSize: "1", tickValue: 500, rthFrom: "09:30", rthTo: "16:00", sortOrder: 31 },
  { symbol: "RTY", name: "E-mini Russell 2000", exchange: "CME", tickSize: "0.1", tickValue: 5000, rthFrom: "09:30", rthTo: "16:00", sortOrder: 40 },
  { symbol: "M2K", name: "Micro E-mini Russell 2000", exchange: "CME", tickSize: "0.1", tickValue: 500, rthFrom: "09:30", rthTo: "16:00", sortOrder: 41 },

  // Energia
  { symbol: "CL", name: "Ropa WTI", exchange: "NYMEX", tickSize: "0.01", tickValue: 10000, rthFrom: "09:00", rthTo: "14:30", sortOrder: 50 },
  { symbol: "MCL", name: "Micro ropa WTI", exchange: "NYMEX", tickSize: "0.01", tickValue: 1000, rthFrom: "09:00", rthTo: "14:30", sortOrder: 51 },
  { symbol: "NG", name: "Gaz ziemny", exchange: "NYMEX", tickSize: "0.001", tickValue: 10000, rthFrom: "09:00", rthTo: "14:30", sortOrder: 60 },

  // Metale
  { symbol: "GC", name: "Złoto", exchange: "COMEX", tickSize: "0.1", tickValue: 10000, rthFrom: "08:20", rthTo: "13:30", sortOrder: 70 },
  { symbol: "MGC", name: "Micro złoto", exchange: "COMEX", tickSize: "0.1", tickValue: 1000, rthFrom: "08:20", rthTo: "13:30", sortOrder: 71 },
  { symbol: "SI", name: "Srebro", exchange: "COMEX", tickSize: "0.005", tickValue: 25000, rthFrom: "08:25", rthTo: "13:25", sortOrder: 80 },
  { symbol: "HG", name: "Miedź", exchange: "COMEX", tickSize: "0.0005", tickValue: 12500, rthFrom: "08:10", rthTo: "13:00", sortOrder: 81 },

  // Stopy procentowe
  { symbol: "ZB", name: "Obligacje 30-letnie", exchange: "CBOT", tickSize: "0.03125", tickValue: 31250, rthFrom: "08:20", rthTo: "15:00", sortOrder: 90 },
  { symbol: "ZN", name: "Obligacje 10-letnie", exchange: "CBOT", tickSize: "0.015625", tickValue: 15625, rthFrom: "08:20", rthTo: "15:00", sortOrder: 91 },

  // Waluty
  { symbol: "6E", name: "Euro FX", exchange: "CME", tickSize: "0.00005", tickValue: 6250, rthFrom: "08:20", rthTo: "15:00", sortOrder: 100 },
  { symbol: "6B", name: "Funt brytyjski", exchange: "CME", tickSize: "0.0001", tickValue: 6250, rthFrom: "08:20", rthTo: "15:00", sortOrder: 101 },
  { symbol: "6J", name: "Jen japoński", exchange: "CME", tickSize: "0.0000005", tickValue: 6250, rthFrom: "08:20", rthTo: "15:00", sortOrder: 102 },
  { symbol: "6A", name: "Dolar australijski", exchange: "CME", tickSize: "0.0001", tickValue: 10000, rthFrom: "08:20", rthTo: "15:00", sortOrder: 103 },

  // Rolne
  { symbol: "ZC", name: "Kukurydza", exchange: "CBOT", tickSize: "0.25", tickValue: 12500, rthFrom: "09:30", rthTo: "14:20", sortOrder: 110 },
  { symbol: "ZS", name: "Soja", exchange: "CBOT", tickSize: "0.25", tickValue: 12500, rthFrom: "09:30", rthTo: "14:20", sortOrder: 111 },
];

// Kategoria "timeframe" zniknela (ADR-013) - interwal jest teraz atrybutem
// kazdego przypisania tagu, nie osobnym tagiem. Patrz lib/domain/interwaly.ts
// i migracja drizzle/0007_interwal_przy_tagu.sql.
//
// Kategoria "market" (warunki rynkowe) zniknela w ADR-017, a dawny "setup"
// stal sie "confluence": tagi opisuja przeslanki wejscia, nie nazwe zagrania.
// Podzial na HTF i LTF wynika z interwalu przypisania, wiec nie ma tu i nie ma
// byc osobnych kategorii na warstwy. Patrz drizzle/0010_konfluencje.sql.
export const TAG_CATEGORIES = [
  {
    key: "confluence",
    name: "Konfluencje",
    description:
      "Przesłanki, które złożyły się na wejście. Interwał wybierasz osobno dla każdej — z niego wynika podział na HTF i LTF.",
    sortOrder: 10,
  },
  {
    key: "setup",
    name: "Setup",
    description: "Nazwa całego zagrania, np. „Silver Bullet”. Bez interwału.",
    sortOrder: 20,
  },
  { key: "mistake", name: "Błąd", description: "Co poszło nie tak po Twojej stronie.", sortOrder: 30 },
];

// Kategoria "setup" celowo zostaje pusta: nikt poza uzytkownikiem nie wie,
// jak on nazywa swoje zagrania, a zasiew podpowiadajacy cudze nazwy tylko
// zasmieca liste.
export const TAGS: { category: string; name: string; color: string }[] = [
  { category: "confluence", name: "wybicie", color: "#e8a44c" },
  { category: "confluence", name: "powrót do średniej", color: "#5aa9e6" },
  { category: "confluence", name: "kontynuacja trendu", color: "#46c08b" },
  { category: "confluence", name: "odwrócenie", color: "#b98ce0" },
  { category: "confluence", name: "otwarcie sesji", color: "#4fd1c5" },

  { category: "mistake", name: "wejście za wcześnie", color: "#e5654f" },
  { category: "mistake", name: "wejście za późno", color: "#e5654f" },
  { category: "mistake", name: "przesunięty stop", color: "#e5654f" },
  { category: "mistake", name: "za wczesne wyjście", color: "#e5654f" },
  { category: "mistake", name: "brak planu", color: "#e5654f" },
  { category: "mistake", name: "za duża pozycja", color: "#e5654f" },
];

export const CUSTOM_FIELDS = [
  {
    key: "nastroj",
    label: "Nastrój przed wejściem",
    type: "select" as const,
    options: [
      { value: "spokój", color: "#46c08b" },
      { value: "niecierpliwość", color: "#e8a44c" },
      { value: "presja", color: "#e5654f" },
      { value: "znudzenie", color: "#8fa3b8" },
    ],
    required: false,
    inTable: true,
    inStats: true,
    sortOrder: 10,
  },
  {
    key: "jakosc_wejscia",
    label: "Jakość wejścia",
    type: "rating" as const,
    options: [],
    required: false,
    inTable: false,
    inStats: true,
    sortOrder: 20,
  },
  {
    key: "plan_zrealizowany",
    label: "Trade zgodny z planem",
    type: "bool" as const,
    options: [],
    required: false,
    inTable: true,
    inStats: true,
    sortOrder: 30,
  },
];
