import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* --------------------------------------------------------------------------
   Jednostki i konwencje
   - kwoty: liczby calkowite w centach (bigint), nigdy zmiennoprzecinkowe
   - ceny:  numeric(18,8) - wystarcza dla kazdego kontraktu futures
   - czas:  timestamptz, prezentacja w strefie z tabeli `settings`
   -------------------------------------------------------------------------- */

export const directionEnum = pgEnum("direction", ["long", "short"]);
export const tradeStatusEnum = pgEnum("trade_status", [
  "planned",
  "open",
  "closed",
  "cancelled",
  "missed",
]);
export const accountTypeEnum = pgEnum("account_type", ["live", "demo", "prop", "paper"]);
export const fieldTypeEnum = pgEnum("field_type", [
  "text",
  "number",
  "select",
  "multiselect",
  "bool",
  "date",
  "rating",
]);
export const fieldScopeEnum = pgEnum("field_scope", ["trade", "backtest", "both"]);
export const sessionStatusEnum = pgEnum("session_status", ["running", "finished", "abandoned"]);
/* Powod, dla ktorego trafiony kierunek nie zamienil sie w zysk (ADR-018).
   Wartosci musza sie zgadzac z POWODY w lib/domain/kierunek.ts. */
export const badExecutionReasonEnum = pgEnum("bad_execution_reason", [
  "unnecessary_be",
  "unnecessary_sl",
  "early_exit",
]);
export const marketSessionEnum = pgEnum("market_session", [
  "premarket",
  "rth",
  "afterhours",
  "overnight",
]);
export const noTradeReasonEnum = pgEnum("no_trade_reason", [
  "no_setup",
  "outside_hours",
  "market_conditions",
  "day_off",
  "planned_break",
  "personal",
  "other",
]);

/* --- Konta ---------------------------------------------------------------- */

export const accounts = pgTable("accounts", {
  id: serial().primaryKey(),
  name: text().notNull(),
  currency: text().notNull().default("USD"),
  startingBalance: bigint({ mode: "number" }).notNull().default(0),
  type: accountTypeEnum().notNull().default("live"),
  defaultRiskPct: numeric({ precision: 6, scale: 3 }),
  defaultRiskAmount: bigint({ mode: "number" }),
  description: text(),
  archived: boolean().notNull().default(false),
  sortOrder: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/* --- Instrumenty ---------------------------------------------------------- */

export const instruments = pgTable(
  "instruments",
  {
    id: serial().primaryKey(),
    symbol: text().notNull(),
    name: text().notNull(),
    exchange: text(),
    // Wielkosc ticku w jednostkach ceny, np. 0.25 dla NQ.
    tickSize: numeric({ precision: 18, scale: 8 }).notNull(),
    // Wartosc jednego ticku na kontrakt w tysiecznych dolara: NQ = 5000 (5,00 USD),
    // ZN = 15625 (15,625 USD). W centach ZN nie bylby liczba calkowita.
    tickValue: bigint({ mode: "number" }).notNull(),
    currency: text().notNull().default("USD"),
    // Godziny sesji glownej w strefie gieldy, format HH:MM.
    rthFrom: text().notNull().default("09:30"),
    rthTo: text().notNull().default("16:00"),
    exchangeTimezone: text().notNull().default("America/New_York"),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [uniqueIndex("instruments_symbol_idx").on(t.symbol)],
);

/* --- Strategie ------------------------------------------------------------ */

export const strategies = pgTable("strategies", {
  id: serial().primaryKey(),
  name: text().notNull(),
  description: text(),
  // Lista zasad wejscia jako checklista: [{ id, text }]
  rules: jsonb().$type<{ id: string; text: string }[]>().notNull().default([]),
  instrumentId: integer().references(() => instruments.id, { onDelete: "set null" }),
  active: boolean().notNull().default(true),
  color: text().notNull().default("#e8a44c"),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/* --- Sesje backtestu ------------------------------------------------------ */

export const backtestSessions = pgTable("backtest_sessions", {
  id: serial().primaryKey(),
  name: text().notNull(),
  strategyId: integer().references(() => strategies.id, { onDelete: "set null" }),
  instrumentId: integer().references(() => instruments.id, { onDelete: "set null" }),
  interval: text(),
  dataFrom: date(),
  dataTo: date(),
  startingBalance: bigint({ mode: "number" }).notNull().default(0),
  riskPerTrade: bigint({ mode: "number" }),
  targetTrades: integer().notNull().default(100),
  status: sessionStatusEnum().notNull().default("running"),
  assumptions: text(),
  conclusions: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/* --- Tagi ----------------------------------------------------------------- */

export const tagCategories = pgTable(
  "tag_categories",
  {
    id: serial().primaryKey(),
    name: text().notNull(),
    /* Klucz jest identyfikatorem wymiaru statystyk ("tag:<key>"), wiec musi byc
       unikalny - dwie kategorie o tym samym kluczu rozwalilyby grupowanie po
       cichu, bez zadnego bledu (ADR-017). */
    key: text().notNull(),
    description: text(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [uniqueIndex("tag_categories_key_idx").on(t.key)],
);

export const tags = pgTable(
  "tags",
  {
    id: serial().primaryKey(),
    categoryId: integer()
      .notNull()
      .references(() => tagCategories.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull().default("#8fa3b8"),
    sortOrder: integer().notNull().default(0),
    archived: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("tags_category_name_idx").on(t.categoryId, t.name)],
);

/* --- Pola wlasne ---------------------------------------------------------- */

export const customFields = pgTable(
  "custom_fields",
  {
    id: serial().primaryKey(),
    key: text().notNull(),
    label: text().notNull(),
    type: fieldTypeEnum().notNull(),
    // Slownik stalych wartosci dla select/multiselect: [{ value, color }]
    options: jsonb().$type<{ value: string; color?: string }[]>().notNull().default([]),
    min: numeric({ precision: 18, scale: 6 }),
    max: numeric({ precision: 18, scale: 6 }),
    unit: text(),
    hint: text(),
    required: boolean().notNull().default(false),
    inTable: boolean().notNull().default(false),
    inStats: boolean().notNull().default(true),
    scope: fieldScopeEnum().notNull().default("both"),
    sortOrder: integer().notNull().default(0),
    archived: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("custom_fields_key_idx").on(t.key)],
);

/* --- Trade'y -------------------------------------------------------------- */

export const trades = pgTable(
  "trades",
  {
    id: serial().primaryKey(),
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    instrumentId: integer()
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    strategyId: integer().references(() => strategies.id, { onDelete: "set null" }),
    // NULL = trade realny; wartosc = trade nalezacy do sesji backtestu.
    backtestSessionId: integer().references(() => backtestSessions.id, { onDelete: "cascade" }),

    direction: directionEnum().notNull(),
    status: tradeStatusEnum().notNull().default("closed"),

    entryTime: timestamp({ withTimezone: true }).notNull(),
    entryPrice: numeric({ precision: 18, scale: 8 }).notNull(),
    exitTime: timestamp({ withTimezone: true }),
    exitPrice: numeric({ precision: 18, scale: 8 }),
    contracts: numeric({ precision: 14, scale: 4 }).notNull(),

    stopLoss: numeric({ precision: 18, scale: 8 }),
    takeProfit: numeric({ precision: 18, scale: 8 }),
    mae: numeric({ precision: 18, scale: 8 }),
    mfe: numeric({ precision: 18, scale: 8 }),

    note: text(),

    /* --- Samopoczucie i gotowosc (2026-08-29) ------------------------------
       Zastapily pole wlasne "nastroj" (lista czterech nastrojow do wyboru).
       Powod od uzytkownika: nastroj nie miesci sie w liscie, a to, co warto
       porownywac z wynikiem, to POZIOM gotowosci na dany dzien. Stad opis
       wlasnymi slowami plus jedna liczba, ktora da sie grupowac. */
    moodNote: text(),
    /** Gotowosc psychiczna na dany dzien, 1-10. NULL = nie oceniono. */
    readiness: smallint(),

    /* Ponizsze trzy nie sa juz wypelniane przez formularz (2026-08-29):
       "Ocena wykonania", "Strategia" i checklista zniknely z trade'a. Kolumny
       ZOSTAJA, bo historia ma sie nie zgubic - kasowanie danych za zmiane w
       interfejsie bylo by nieodwracalne. Nowe trade'y maja tu NULL i pustki. */
    executionRating: smallint(),
    // Odhaczone punkty checklisty strategii: ["id-zasady", ...]
    rulesMet: jsonb().$type<string[]>().notNull().default([]),
    custom: jsonb().$type<Record<string, unknown>>().notNull().default({}),

    /* Kolumny wyliczane w `lib/domain/calc.ts` i zapisywane przy kazdym zapisie.
       Denormalizacja swiadoma: statystyki, sortowanie i filtry musza dzialac
       bez przeliczania calej historii. Zrodlem prawdy jest modul obliczen. */
    ticks: integer(),
    riskTicks: integer(),
    pnl: bigint({ mode: "number" }),
    riskAmount: bigint({ mode: "number" }),
    rMultiple: numeric({ precision: 12, scale: 4 }),
    maeR: numeric({ precision: 12, scale: 4 }),
    mfeR: numeric({ precision: 12, scale: 4 }),
    durationS: integer(),
    marketSession: marketSessionEnum(),
    weekday: smallint(),
    entryHour: smallint(),
    tradingDay: date(),

    /* Kwota z rachunku brokera w centach - wpisana recznie, nie wyliczona.
       Gdy nie jest NULL, `pnl` jest jej kopia (ADR-016). Trzymamy ja osobno,
       zeby dalo sie odroznic wynik z rachunku od wyniku z siatki tickow
       i zeby formularz w edycji wracal z wypelnionym polem. */
    brokerAmount: bigint({ mode: "number" }),

    /* --- Kierunek a egzekucja (ADR-018) -----------------------------------
       Trzy stany, nie dwa: `null` znaczy "nieocenione", `false` - "kierunek
       chybiony". Przy wygranej wszystkie trzy pola zostaja puste, bo
       "zysk => kierunek trafiony" wyprowadza lib/domain/kierunek.ts. Zapisanie
       tego wprost bylo by denormalizacja, ktora sklamie po zmianie progu BE
       w ustawieniach (ADR-011). */
    directionCorrect: boolean(),
    badExecutionReason: badExecutionReasonEnum(),
    /* Zasieg calego zagrania w R - NIE to samo co `mfeR`, ktore mierzy ruch
       wylacznie w trakcie trwania pozycji. Roznica `potentialR - rMultiple`
       jest miara tego, ile kosztuje egzekucja. */
    potentialR: numeric({ precision: 12, scale: 4 }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* Powod i potencjal maja sens wylacznie przy trafionym kierunku. Formularz
       normalizuje to wczesniej (normalizujKierunek), wiec ten warunek jest
       siatka bezpieczenstwa, a nie sciezka, ktora uzytkownik ma zobaczyc. */
    check(
      "trades_kierunek",
      sql`(${t.badExecutionReason} is null and ${t.potentialR} is null) or ${t.directionCorrect} is true`,
    ),
    /* Suwak w formularzu ma min/max, ale walidacja w przegladarce nie jest
       zabezpieczeniem - prog musi byc powtorzony tutaj (2026-08-29). */
    check(
      "trades_readiness",
      sql`${t.readiness} is null or (${t.readiness} between 1 and 10)`,
    ),
    index("trades_direction_correct_idx")
      .on(t.directionCorrect)
      .where(sql`${t.directionCorrect} is not null`),
    index("trades_entry_idx").on(t.entryTime),
    index("trades_account_idx").on(t.accountId),
    index("trades_session_idx").on(t.backtestSessionId),
    index("trades_trading_day_idx").on(t.tradingDay),
    index("trades_custom_idx").using("gin", t.custom),
  ],
);

export const tradeTags = pgTable(
  "trade_tags",
  {
    /* Klucz glowny dochodzi dopiero w ADR-017. Wczesniej para (trade_id, tag_id)
       jednoznacznie wskazywala wiersz; teraz ten sam tag moze wisiec na trade'cie
       kilka razy, wiec interfejs potrzebuje stabilnego identyfikatora
       przypisania - inaczej React dostaje powtorzony `key` przy chipach. */
    id: serial().primaryKey(),
    tradeId: integer()
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    tagId: integer()
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    // Interwal nalezy do przypisania, nie do tagu - jeden tag "wybicie" moze
    // opisywac wejscie z 5m i z 1h (patrz ADR-013). `text`, nie enum: lista
    // dozwolonych wartosci zyje w kodzie (lib/domain/interwaly.ts), a dolozenie
    // np. "2h" nie ma wymagac migracji schematu.
    //
    // Z interwalu wyprowadzamy tez warstwe HTF/LTF (ADR-017) - to NIE jest
    // osobna kategoria tagow ani osobna kolumna.
    interval: text(),
  },
  (t) => [
    /* `unique().nullsNotDistinct()`, nie `uniqueIndex()`: drizzle 0.45 ma
       nullsNotDistinct wylacznie na ograniczeniu, nie na indeksie. Bez tego
       modyfikatora wiersz z pustym interwalem dalby sie wstawic dowolna liczbe
       razy, a `onConflictDoNothing` w saveTrade przestalby czegokolwiek
       pilnowac. */
    unique("trade_tags_uq").on(t.tradeId, t.tagId, t.interval).nullsNotDistinct(),
    index("trade_tags_tag_idx").on(t.tagId),
  ],
);

export const screenshots = pgTable(
  "screenshots",
  {
    id: serial().primaryKey(),
    // Zrzut wisi albo pod trade'em, albo pod dniem dziennika - nigdy pod obojgiem
    // i nigdy pod niczym. Pilnuje tego warunek `screenshots_owner`.
    tradeId: integer().references(() => trades.id, { onDelete: "cascade" }),
    dayNoteId: integer().references(() => dayNotes.id, { onDelete: "cascade" }),
    // Zrzuty tworza jedna liste w kolejnosci wgrywania (ADR-009). Podzial na
    // "przed" i "po" zniknal - przy trzecim zdjeciu etykieta i tak klamala.
    file: text().notNull(),
    thumbnail: text(),
    caption: text(),
    width: integer(),
    height: integer(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Interwal, z jakiego pochodzi ten konkretny obraz - nie do mylenia z
    // "trade_tags"."interval" (ADR-013), ktory opisuje setup tagu. Jeden
    // trade miewa zrzuty z kilku interwalow naraz, wiec te dwie rzeczy nie
    // dadza sie utozsamic (ADR-015). `text`, nie enum, z tego samego powodu
    // co przy tagach: lista zyje w lib/domain/interwaly.ts.
    interval: text(),
  },
  (t) => [
    index("screenshots_trade_idx").on(t.tradeId),
    index("screenshots_day_note_idx").on(t.dayNoteId),
    check(
      "screenshots_owner",
      sql`(${t.tradeId} is null) != (${t.dayNoteId} is null)`,
    ),
  ],
);

/* --- Dziennik dnia -------------------------------------------------------- */

export const dayNotes = pgTable(
  "day_notes",
  {
    id: serial().primaryKey(),
    day: date().notNull(),
    accountId: integer().references(() => accounts.id, { onDelete: "cascade" }),
    // Wpis nalezy albo do dziennika (konto), albo do sesji backtestu.
    // W backtescie dzien bez sygnalu jest czescia badania, nie luka w nim.
    backtestSessionId: integer().references(() => backtestSessions.id, {
      onDelete: "cascade",
    }),
    preSession: text(),
    postSession: text(),
    mood: smallint(),
    energy: smallint(),
    dayRating: smallint(),
    // Dzien swiadomie odpuszczony. Bez tego znacznika dzien bez trade'ow
    // niczym nie rozni sie od dnia, o ktorym zapomnialem.
    noTrade: boolean().notNull().default(false),
    noTradeReason: noTradeReasonEnum(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Trzy rozlaczne przestrzenie nazw dla jednego dnia: dziennik z kontem,
    // dziennik bez konta i sesja backtestu. W Postgresie NULL != NULL,
    // wiec kazdy przypadek z NULL-em potrzebuje wlasnego czesciowego indeksu.
    uniqueIndex("day_notes_idx")
      .on(t.day, t.accountId)
      .where(sql`${t.backtestSessionId} is null`),
    uniqueIndex("day_notes_no_account_idx")
      .on(t.day)
      .where(sql`${t.accountId} is null and ${t.backtestSessionId} is null`),
    uniqueIndex("day_notes_session_idx")
      .on(t.day, t.backtestSessionId)
      .where(sql`${t.backtestSessionId} is not null`),
  ],
);

/* --- Zapisane widoki tabeli ----------------------------------------------- */

export const savedViews = pgTable("saved_views", {
  id: serial().primaryKey(),
  name: text().notNull(),
  filters: jsonb().$type<Record<string, string>>().notNull().default({}),
  columns: jsonb().$type<string[]>().notNull().default([]),
  isDefault: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/* --- Ustawienia (jeden wiersz) -------------------------------------------- */

export const settings = pgTable("settings", {
  id: integer().primaryKey().default(1),
  passwordHash: text(),
  sessionVersion: integer().notNull().default(1),
  baseCurrency: text().notNull().default("USD"),
  timezone: text().notNull().default("Europe/Warsaw"),
  defaultRisk: bigint({ mode: "number" }).notNull().default(10000),
  minSample: integer().notNull().default(15),
  tradingHoursFrom: text(),
  tradingHoursTo: text(),
  /* Prog BE (wynik "na zero") - patrz ADR-011. Liczby calkowite, nie numeric:
     TS liczylby `progRMille / 1000 * risk` w double, Postgres w numeric - na
     samej granicy przedzialu obie strony moglyby dac inna odpowiedz. Na
     liczbach calkowitych `round(progRMille * risk / 1000)` jest identyczne
     po obu stronach (patrz lib/domain/outcome.ts). */
  beProgRMille: integer().notNull().default(100), // 100 = 0,100 R
  beProgNaKontrakt: bigint({ mode: "number" }).notNull().default(200), // centy = 2,00 USD
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type Instrument = typeof instruments.$inferSelect;
export type Strategy = typeof strategies.$inferSelect;
export type BacktestSession = typeof backtestSessions.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type TagCategory = typeof tagCategories.$inferSelect;
export type CustomFieldRow = typeof customFields.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type Screenshot = typeof screenshots.$inferSelect;
export type DayNote = typeof dayNotes.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type Settings = typeof settings.$inferSelect;
