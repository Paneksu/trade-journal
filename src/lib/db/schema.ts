import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
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

export const accounts = pgTable(
  "accounts",
  {
  id: serial().primaryKey(),
  name: text().notNull(),
  currency: text().notNull().default("USD"),
  startingBalance: bigint({ mode: "number" }).notNull().default(0),
  type: accountTypeEnum().notNull().default("live"),
  defaultRiskPct: numeric({ precision: 6, scale: 3 }),
  defaultRiskAmount: bigint({ mode: "number" }),
  description: text(),
  /* Faza konta prop: "eval" (challenge) albo "funded". NULL dla kont innych niz prop
     i dla prop, ktorego fazy jeszcze nie podano. CHECK w migracji 0015 pilnuje, zeby
     faza nie wisiala przy koncie innym niz prop (ADR-027). */
  propPhase: text().$type<"eval" | "funded">(),
  archived: boolean().notNull().default(false),
  sortOrder: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Lustro CHECK-a z migracji 0015: faza tylko przy koncie prop.
    check(
      "accounts_prop_phase",
      sql`${t.propPhase} is null or (${t.propPhase} in ('eval', 'funded') and ${t.type}::text = 'prop')`,
    ),
  ],
);

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

export const backtestSessions = pgTable(
  "backtest_sessions",
  {
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
    /* "backtest" (historyczny replay) albo "forward" (test na biezacych danych).
       Oba siedza w tej samej tabeli i rozni je ta kolumna (ADR-027). */
    kind: text().$type<"backtest" | "forward">().notNull().default("backtest"),
    /* Klucz sesji FX Replay ("fxr:<id>") - API zaklada albo odnajduje sesje po nim. */
    externalRef: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("backtest_sessions_kind", sql`${t.kind} in ('backtest', 'forward')`),
    uniqueIndex("backtest_sessions_external_ref_idx")
      .on(t.externalRef)
      .where(sql`${t.externalRef} is not null`),
  ],
);

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
    /* --- Wyjscia czesciowe (2026-08-30) ------------------------------------
       Trade moze miec wiele wyjsc w tabeli `trade_exits` (ETAP 1 planu
       skalowania z pozycji). Ponizsze dwie kolumny ZOSTAJA, ale zmieniaja
       status: przestaja byc zrodlem prawdy o wyjsciu i staja sie polami
       POCHODNYMI - `exitPrice` to srednia wazona kontraktami cen ze wszystkich
       wierszy `trade_exits`, `exitTime` to czas OSTATNIEGO wyjscia. Wypelnia
       je akcja zapisu przy kazdej zmianie wyjsc, nie licz ich tutaj w bazie.
       Nie kasowac i nie traktowac jako niezaleznego zrodla - historyczne
       trade'y sprzed tej zmiany maja tu jedyny zapis, backfillowany 1:1 do
       `trade_exits` w migracji 0014. */
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

    /* --- Wyjscia czesciowe (2026-08-30) ------------------------------------
       Suma i licznik pochodzace z `trade_exits` - denormalizacja swiadoma,
       z tego samego powodu co `ticks`/`pnl` wyzej: filtry i statystyki nie
       moga za kazdym razem doliczac wszystkich wierszy potomnych. Wypelnia je
       akcja zapisu, nie trigger.
       SWIADOMIE bez CHECK-a "closed_contracts == contracts": Postgres nie
       wyrazi warunku miedzy tabelami (suma z trade_exits vs trades.contracts),
       a i tak walidacja musi siedziec w akcji zapisu, zeby uzytkownik dostal
       polski komunikat zamiast surowego bledu bazy - ta sama zasada, co przy
       normalizujKierunek w lib/domain/kierunek.ts. */
    closedContracts: numeric({ precision: 14, scale: 4 }).notNull().default("0"),
    exitCount: smallint().notNull().default(0),
    /* Wplyw skalowania na wynik w R - dodatni gdy czesciowe wyjscia poprawily
       R wzgledem hipotetycznego jednego wyjscia, ujemny gdy pogorszyly.
       NULL dla calej historii sprzed tej migracji: kazdy stary trade ma
       dokladnie jedno wyjscie, wiec miara "wplyw skalowania" nie ma tam
       znaczenia - to poprawny stan, nie brak danych. */
    scalingR: numeric({ precision: 12, scale: 4 }),

    /* --- Synchronizacja przez API (2026-10-05, ADR-026) --------------------
       `source` mowi, skad wpis przyszedl; `externalRef` ("tv:<id>", "fxr:<id>")
       jest kluczem idempotencji. `ingestedAt` to chwila ostatniego zapisu przez
       API: gdy `updatedAt` jest pozniejszy, uzytkownik poprawial wpis w
       aplikacji i API nie ma prawa go nadpisac (wynik "conflict"). Edycja przez
       formularz NIE dotyka tych czterech kolumn. */
    source: text().$type<"form" | "tradingview" | "fxreplay">().notNull().default("form"),
    externalRef: text(),
    ingestedAt: timestamp({ withTimezone: true }),
    sourceSnapshot: jsonb().$type<Record<string, unknown>>(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trades_external_ref_idx")
      .on(t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    check("trades_source", sql`${t.source} in ('form', 'tradingview', 'fxreplay')`),
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
    /* Czesciowy indeks - interesuje nas tylko podzbior trade'ow ze
       skalowaniem, reszta (wiekszosc historii) go nie potrzebuje. */
    index("trades_skalowanie_idx")
      .on(t.exitCount)
      .where(sql`${t.exitCount} > 1`),
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
    /* Kto wgral zrzut: "manual" (uzytkownik) albo klient API. API zastepuje przy
       ponownym wyslaniu wylacznie zrzuty swojego pochodzenia i nigdy nie rusza
       recznych (ADR-026). */
    origin: text().$type<"manual" | "tradingview" | "fxreplay">().notNull().default("manual"),
    /* --- v2 (migracja 0018, ADR-029) --------------------------------------
       Zrzut moze wisiec tez pod notatka (np. przyklad pojecia ICT). Kasowana
       notatka zabiera swoje zrzuty. */
    noteId: integer().references(() => notes.id, { onDelete: "cascade" }),
    /* SHA-256 bajtow pliku WGRANEGO (przed konwersja sharp -> WebP): dowod do
       evidence_hash. Stare wiersze: NULL. */
    sha256: text(),
    capturedAt: timestamp({ withTimezone: true }),
    /* Symbol, interwal i zakres z `tj shot`. */
    chartState: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    check("screenshots_origin", sql`${t.origin} in ('manual', 'tradingview', 'fxreplay')`),
    index("screenshots_trade_idx").on(t.tradeId),
    index("screenshots_day_note_idx").on(t.dayNoteId),
    index("screenshots_note_idx")
      .on(t.noteId)
      .where(sql`${t.noteId} is not null`),
    check("screenshots_sha256", sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
    // Dokladnie jedno z trzech (migracja 0018; wczesniej: jedno z dwoch).
    check(
      "screenshots_owner",
      sql`num_nonnulls(${t.tradeId}, ${t.dayNoteId}, ${t.noteId}) = 1`,
    ),
  ],
);

/* --- Wyjscia czesciowe (ETAP 1 planu skalowania z pozycji, 2026-08-30) ---- */

export const tradeExits = pgTable(
  "trade_exits",
  {
    id: serial().primaryKey(),
    tradeId: integer()
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    // Kolejnosc wyjsc w ramach jednego trade'a (ADR-009, wzorzec ze
    // `screenshots`): sortowanie po (sort_order, id), nie po czasie - wyjscie
    // moze nie miec exit_time (patrz nizej).
    sortOrder: integer().notNull().default(0),
    /* NULLABLE, celowo: historyczne trade'y maja `exit_price` bez
       `exit_time` (formularz nigdy nie wymagal czasu wyjscia), a backfill w
       migracji 0014 kopiuje te wiersze 1:1 do `trade_exits`. Gdyby ta kolumna
       byla NOT NULL, backfill padlby na kazdym takim trade'cie. */
    exitTime: timestamp({ withTimezone: true }),
    exitPrice: numeric({ precision: 18, scale: 8 }).notNull(),
    // Ulamki dozwolone, tak jak w trades.contracts (kontrakty czastkowe na
    // niektorych rachunkach/instrumentach).
    contracts: numeric({ precision: 14, scale: 4 }).notNull(),
    // Kwota z rachunku brokera w centach DLA TEGO KAWALKA. NULL gdy
    // uzytkownik nie wpisal jej recznie. Kwota na poziomie calego trade'a
    // (trades.brokerAmount) zostaje osobno i NIE jest suma tych wierszy -
    // backfill w 0014 celowo jej tu nie kopiuje, zeby sie nie podwoila.
    brokerAmount: bigint({ mode: "number" }),
    // Np. "TP1", "runner" - opisowa etykieta kawalka, nie enum.
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("trade_exits_trade_idx").on(t.tradeId),
    check("trade_exits_kontrakty", sql`${t.contracts} > 0`),
  ],
);

/* --- Ocena trade'a przez AI (ADR-026, ADR-028) ----------------------------- */

export type PlanMozgu = {
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  interwalWejscia?: string;
  interwalyKontekstu?: string[];
  [klucz: string]: unknown;
};

export const tradeReviews = pgTable(
  "trade_reviews",
  {
    id: serial().primaryKey(),
    tradeId: integer()
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    setupType: text(),
    summaryMd: text(),
    lesson: text(),
    /* "chart" - ocena z wykresu na moment decyzji (bez wiedzy o wyniku);
       "history" - ocena po fakcie. Jedna ocena na podstawe: ponowne wyslanie
       podmienia zamiast mnozyc wiersze. */
    basis: text().$type<"chart" | "history">().notNull(),
    brainVerdict: text().$type<"wejdz" | "czekaj" | "odpusc">(),
    brainPlan: jsonb().$type<PlanMozgu>(),
    /* Wersja mozgu (hash commita w repo mozgu), nie wersja aplikacji. */
    brainVersion: text(),
    /* Ostatnia swieca, jaka ocena mogla widziec. Wszystko po tej chwili jest
       dla niej przyszloscia - ten znacznik czyni "zero zagladania" sprawdzalnym. */
    evidenceCutoff: timestamp({ withTimezone: true }),
    model: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("trade_reviews_trade_basis_uq").on(t.tradeId, t.basis),
    check("trade_reviews_basis", sql`${t.basis} in ('chart', 'history')`),
    check(
      "trade_reviews_verdict",
      sql`${t.brainVerdict} is null or ${t.brainVerdict} in ('wejdz', 'czekaj', 'odpusc')`,
    ),
  ],
);

export const tradeRuleChecks = pgTable(
  "trade_rule_checks",
  {
    id: serial().primaryKey(),
    reviewId: integer()
      .notNull()
      .references(() => tradeReviews.id, { onDelete: "cascade" }),
    ruleId: text().notNull(),
    /* Kopia tresci reguly z chwili oceny - regula w mozgu moze sie zmienic,
       a ocena ma dalej mowic o tym, co faktycznie sprawdzono. */
    ruleText: text().notNull(),
    verdict: text().$type<"pass" | "fail" | "na" | "unclear">().notNull(),
    evidence: text(),
    /* Zdanie uzytkownika o ocenie AI. NULL = jeszcze sie nie wypowiedzial. */
    userVerdict: text().$type<"agree" | "disagree">(),
  },
  (t) => [
    unique("trade_rule_checks_review_rule_uq").on(t.reviewId, t.ruleId),
    index("trade_rule_checks_rule_idx").on(t.ruleId),
    check("trade_rule_checks_verdict", sql`${t.verdict} in ('pass', 'fail', 'na', 'unclear')`),
    check(
      "trade_rule_checks_user_verdict",
      sql`${t.userVerdict} is null or ${t.userVerdict} in ('agree', 'disagree')`,
    ),
  ],
);

/* Czego klient ma nie wysylac ponownie: wpisy swiadomie pominiete przez klienta
   i nagrobki trade'ow skasowanych w aplikacji. Bez nagrobka kolejna synchronizacja
   wskrzesilaby kazdy trade, ktory uzytkownik usunal. */
export const ingestSkips = pgTable(
  "ingest_skips",
  {
    id: serial().primaryKey(),
    externalRef: text().notNull(),
    reason: text().$type<"client" | "deleted">().notNull().default("client"),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ingest_skips_ref_uq").on(t.externalRef),
    check("ingest_skips_reason", sql`${t.reason} in ('client', 'deleted')`),
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

export const settings = pgTable(
  "settings",
  {
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
  /* Drugi skladnik logowania (ADR-031, migracja 0016). Sekret zaszyfrowany
     AES-256-GCM kluczem z TOTP_ENC_KEY; NULL = 2FA wylaczone. */
  totpSecretEnc: text(),
  totpEnabledAt: timestamp({ withTimezone: true }),
  /* Numer ostatnio przyjetego kroku 30 s: kod z tego samego albo starszego kroku to powtorka. */
  totpLastStep: bigint({ mode: "number" }),
  /* Numer zestawu regul (migracja 0018, ADR-033). Podbija go wylacznie akcja
     zatwierdzenia w UI, w tej samej transakcji co zmiana statusu wersji reguly. */
  rulesetVersion: integer().notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("settings_totp_zgodne", sql`(${t.totpSecretEnc} is null) = (${t.totpEnabledAt} is null)`),
  check("settings_totp_krok", sql`${t.totpSecretEnc} is not null or ${t.totpLastStep} is null`),
  check("settings_ruleset_version", sql`${t.rulesetVersion} >= 0`),
]);

/* --- Kody zapasowe 2FA (migracja 0016) ---------------------------------------
   W bazie HMAC-SHA256 kodu, nigdy sam kod. Nowa paczka kasuje stara. */

export const authBackupCodes = pgTable(
  "auth_backup_codes",
  {
    id: serial().primaryKey(),
    codeHmac: text().notNull().unique("auth_backup_codes_code_hmac_unique"),
    batch: integer().notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("auth_backup_codes_hmac_format", sql`${t.codeHmac} ~ '^[0-9a-f]{64}$'`),
    index("auth_backup_codes_batch_idx").on(t.batch).where(sql`${t.usedAt} is null`),
  ],
);

/* --- Dziennik zdarzen bezpieczenstwa (migracja 0016) --------------------------
   Tylko dopisywanie: trigger tj_forbid_update odrzuca kazdy UPDATE. */

export const AUTH_EVENT_KINDS = [
  "login_ok",
  "login_fail",
  "totp_ok",
  "totp_fail",
  "backup_code_used",
  "sudo",
  "totp_enabled",
  "totp_disabled",
  "backup_codes_regenerated",
  "password_changed",
  "device_requested",
  "device_approved",
  "device_denied",
  "token_created",
  "token_revoked",
  "logout_all",
] as const;
export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number];

export const authEvents = pgTable(
  "auth_events",
  {
    id: serial().primaryKey(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    kind: text().$type<AuthEventKind>().notNull(),
    ip: text(),
    userAgent: text(),
    /* FK do api_tokens dodaje migracja 0019 (0016 powstalo bez tabeli tokenow, 0017 juz po niej).
       NO ACTION: tokenow sie nie kasuje, tylko uniewaznia, a ten dziennik jest tylko do dopisywania. */
    tokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
    detail: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    check(
      "auth_events_kind",
      sql.raw(`"kind" in (${AUTH_EVENT_KINDS.map((k) => `'${k}'`).join(", ")})`),
    ),
    index("auth_events_at_idx").on(t.at.desc()),
    index("auth_events_kind_at_idx").on(t.kind, t.at.desc()),
    index("auth_events_token_idx").on(t.tokenId).where(sql`${t.tokenId} is not null`),
  ],
);

/* ==========================================================================
   v2: tokeny API i notatki (migracje 0017 i 0018, docs/v2/model-danych.md)
   Migracje pisane recznie; ten plik jest ich lustrem (kolumny, CHECK-i, indeksy).
   Nie da sie tu wyrazic funkcji ani triggerow (f_unaccent, tj_guard_columns,
   tj_require_ui_actor, tj_user_words_hash, tj_note_revision, tj_rule_version_gate)
   - o nich mowi test src/lib/db/migracje-v2.db.test.ts.
   ========================================================================== */

/* tsvector w kolumnach generowanych. Baza liczy je sama (GENERATED ALWAYS ... STORED),
   wiec drizzle nie wstawia ich przy INSERT; wyrazenie ponizej jest tylko opisem. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export type ApiScope = "read" | "write" | "propose" | "import";
export type Origin = "user" | "ai" | "mentor" | "vault-import";

/* --- Tokeny urzadzen (0017, ADR-030) -------------------------------------- */

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: serial().primaryKey(),
    name: text().notNull(),
    // 8 znakow: wyszukanie wiersza i pokazanie w UI. Sekretu nie zapisujemy.
    prefix: text().notNull(),
    // SHA-256 calego tokenu (tj_<prefix>_<sekret>), hex.
    tokenSha256: text().notNull(),
    // Zakresu "approve" nie ma i CHECK nie pozwoli go dopisac bez migracji.
    scopes: text().array().$type<ApiScope[]>().notNull(),
    createdVia: text().$type<"device_code" | "ui">().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Zapis najwyzej raz na minute (UPDATE ... WHERE last_used_at < now() - 1 min).
    lastUsedAt: timestamp({ withTimezone: true }),
    lastUsedIp: text(),
    // NULL = bez terminu.
    expiresAt: timestamp({ withTimezone: true }),
    // Tokenow sie nie kasuje, tylko uniewaznia: wskazuja na nie tabele niezmienne.
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: text(),
  },
  (t) => [
    check("api_tokens_name", sql`length(${t.name}) between 1 and 80`),
    check("api_tokens_prefix", sql`${t.prefix} ~ '^[a-z0-9]{8}$'`),
    check("api_tokens_sha256", sql`${t.tokenSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "api_tokens_scopes",
      sql`cardinality(${t.scopes}) between 1 and 4 and ${t.scopes} <@ array['read', 'write', 'propose', 'import']`,
    ),
    check("api_tokens_created_via", sql`${t.createdVia} in ('device_code', 'ui')`),
    unique("api_tokens_prefix_uq").on(t.prefix),
    unique("api_tokens_sha256_uq").on(t.tokenSha256),
  ],
);

export const deviceCodes = pgTable(
  "device_codes",
  {
    id: serial().primaryKey(),
    deviceCodeSha256: text().notNull(),
    // 8 spolglosek z listy bez mylacych liter, np. BCDF-GHJK.
    userCode: text().notNull(),
    clientName: text().notNull(),
    clientIp: text(),
    requestedScopes: text().array().$type<ApiScope[]>().notNull(),
    grantedScopes: text().array().$type<ApiScope[]>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // created_at + 10 min (liczy API).
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastPolledAt: timestamp({ withTimezone: true }),
    approvedAt: timestamp({ withTimezone: true }),
    deniedAt: timestamp({ withTimezone: true }),
    // Token powstaje przy odpytaniu PO zatwierdzeniu: jawny token nie lezy w bazie.
    tokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
    consumedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("device_codes_sha256", sql`${t.deviceCodeSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "device_codes_user_code",
      sql`${t.userCode} ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$'`,
    ),
    check("device_codes_client_name", sql`length(${t.clientName}) between 1 and 80`),
    check(
      "device_codes_requested_scopes",
      sql`${t.requestedScopes} <@ array['read', 'write', 'propose']`,
    ),
    check(
      "device_codes_granted_scopes",
      sql`${t.grantedScopes} is null or ${t.grantedScopes} <@ ${t.requestedScopes}`,
    ),
    check("device_codes_decision", sql`${t.approvedAt} is null or ${t.deniedAt} is null`),
    check(
      "device_codes_granted_when_approved",
      sql`(${t.approvedAt} is null) = (${t.grantedScopes} is null)`,
    ),
    check(
      "device_codes_consumed",
      sql`${t.consumedAt} is null or (${t.approvedAt} is not null and ${t.tokenId} is not null)`,
    ),
    unique("device_codes_sha256_uq").on(t.deviceCodeSha256),
    unique("device_codes_user_code_uq").on(t.userCode),
  ],
);

/* --- Notatki (0018, ADR-029) ------------------------------------------------ */

export type NoteKind =
  | "system"
  | "concept"
  | "rule"
  | "decision_proc"
  | "trade_note"
  | "session"
  | "hypothesis"
  | "mistake"
  | "strength"
  | "brain_decision"
  | "learning"
  | "profile"
  | "strategy"
  | "setup";

export const notes = pgTable(
  "notes",
  {
    id: serial().primaryKey(),
    kind: text().$type<NoteKind>().notNull(),
    // ASCII z tytulu, do adresow.
    slug: text().notNull(),
    title: text().notNull(),
    bodyMd: text().notNull().default(""),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    origin: text().$type<Origin>().notNull().default("user"),
    // SET NULL: notatka przezywa skasowanie trade'u / sesji. notes nie jest niezmienna.
    tradeId: integer().references(() => trades.id, { onDelete: "set null" }),
    backtestSessionId: integer().references(() => backtestSessions.id, {
      onDelete: "set null",
    }),
    day: date(),
    // 'vault:<sciezka>' (import), 'mentor:<video_id>'.
    externalRef: text(),
    /* sha256(body_md w bajtach UTF-8) - liczy trigger tj_note_revision. Domyslny ""
       tylko po to, by INSERT mogl go pominac (CHECK odrzuci pusty ciag, gdyby
       trigger nie dzialal). */
    contentHash: text().notNull().default(""),
    // If-Match; podbija trigger przy zmianie title / body_md / meta.
    rev: integer().notNull().default(1),
    archivedAt: timestamp({ withTimezone: true }),
    createdByTokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Generowana przez baze; unaccent + konfiguracja 'simple' (ADR-029).
    search: tsvector().generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', public.f_unaccent("title")), 'A') || setweight(to_tsvector('simple', public.f_unaccent("body_md")), 'B')`,
    ),
  },
  (t) => [
    check(
      "notes_kind",
      sql`${t.kind} in ('system', 'concept', 'rule', 'decision_proc', 'trade_note', 'session', 'hypothesis', 'mistake', 'strength', 'brain_decision', 'learning', 'profile', 'strategy', 'setup')`,
    ),
    check("notes_slug", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,119}$'`),
    check("notes_title", sql`length(${t.title}) between 1 and 200`),
    check("notes_origin", sql`${t.origin} in ('user', 'ai', 'mentor', 'vault-import')`),
    check("notes_content_hash", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check("notes_rev", sql`${t.rev} >= 1`),
    unique("notes_slug_uq").on(t.slug),
    uniqueIndex("notes_external_ref_idx")
      .on(t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    // [[Tytul]] rozwiazuje sie po tytule jak w Obsidianie.
    uniqueIndex("notes_title_norm_idx").on(sql`(lower(public.f_unaccent(${t.title})))`),
    index("notes_search_idx").using("gin", t.search),
    index("notes_title_trgm_idx").using(
      "gin",
      sql`(lower(public.f_unaccent(${t.title}))) gin_trgm_ops`,
    ),
    index("notes_body_trgm_idx").using(
      "gin",
      sql`(lower(public.f_unaccent(${t.bodyMd}))) gin_trgm_ops`,
    ),
    index("notes_kind_idx").on(t.kind),
    index("notes_trade_idx")
      .on(t.tradeId)
      .where(sql`${t.tradeId} is not null`),
    index("notes_day_idx")
      .on(t.day)
      .where(sql`${t.day} is not null`),
    index("notes_session_idx")
      .on(t.backtestSessionId)
      .where(sql`${t.backtestSessionId} is not null`),
  ],
);

/* Historia tresci, tylko dopisywanie (trigger tj_forbid_update). Wiersze wstawia
   trigger tj_note_revision na notes, nie kod aplikacji. */
export const noteRevisions = pgTable(
  "note_revisions",
  {
    id: serial().primaryKey(),
    noteId: integer()
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    // Numer rewizji zachowanej w tym wierszu (OLD.rev w chwili zmiany).
    rev: integer().notNull(),
    title: text().notNull(),
    bodyMd: text().notNull(),
    meta: jsonb().$type<Record<string, unknown>>().notNull(),
    contentHash: text().notNull(),
    // Aktor transakcji, ktora zastapila te tresc nowa.
    actor: text().notNull(),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("note_revisions_content_hash", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    unique("note_revisions_note_rev_uq").on(t.noteId, t.rev),
  ],
);

export const noteLinks = pgTable(
  "note_links",
  {
    id: serial().primaryKey(),
    fromNoteId: integer()
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    // Surowa tresc [[...]] bez aliasu po "|".
    target: text().notNull(),
    // NULL = notatki jeszcze nie ma; dowiazuje sie, gdy powstanie.
    toNoteId: integer().references(() => notes.id, { onDelete: "set null" }),
  },
  (t) => [
    check("note_links_target", sql`length(${t.target}) > 0`),
    unique("note_links_from_target_uq").on(t.fromNoteId, t.target),
    index("note_links_to_idx").on(t.toNoteId),
    index("note_links_unresolved_idx")
      .on(sql`(lower(public.f_unaccent(${t.target})))`)
      .where(sql`${t.toNoteId} is null`),
  ],
);

/* Slowa uzytkownika doslownie. Niezmienne poza interpretacja AI (trigger
   tj_guard_columns); skrot i dlugosc liczy trigger tj_user_words_hash. */
export const userWords = pgTable(
  "user_words",
  {
    id: serial().primaryKey(),
    // Bajt w bajt: bez trim, bez NFC, bez zamiany CRLF.
    text: text().notNull(),
    sha256: text().notNull().default(""),
    byteLen: integer().notNull().default(0),
    source: text().$type<"chat" | "note" | "chart" | "ui" | "mobile" | "vault-import">().notNull(),
    // Czym jest ten tekst: 'trade.note', 'plan.thesis', 'correction', ... (lista w kodzie).
    role: text(),
    tradeId: integer().references(() => trades.id, { onDelete: "cascade" }),
    noteId: integer().references(() => notes.id, { onDelete: "cascade" }),
    backtestSessionId: integer().references(() => backtestSessions.id, { onDelete: "cascade" }),
    day: date(),
    // Kiedy uzytkownik to napisal (z klienta).
    capturedAt: timestamp({ withTimezone: true }).notNull(),
    // Jedyna zmienna tresc wiersza; w UI zawsze "interpretacja AI".
    aiInterpretation: text(),
    interpretationModel: text(),
    interpretationAt: timestamp({ withTimezone: true }),
    // NO ACTION, nigdy SET NULL: to tabela niezmienna.
    supersedesId: integer().references((): AnyPgColumn => userWords.id, {
      onDelete: "no action",
    }),
    createdByTokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    search: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', public.f_unaccent("text"))`),
  },
  (t) => [
    check("user_words_text", sql`length(${t.text}) > 0`),
    check("user_words_sha256", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("user_words_byte_len", sql`${t.byteLen} > 0`),
    check(
      "user_words_source",
      sql`${t.source} in ('chat', 'note', 'chart', 'ui', 'mobile', 'vault-import')`,
    ),
    index("user_words_search_idx").using("gin", t.search),
    index("user_words_trade_idx")
      .on(t.tradeId)
      .where(sql`${t.tradeId} is not null`),
    index("user_words_note_idx")
      .on(t.noteId)
      .where(sql`${t.noteId} is not null`),
    index("user_words_session_idx")
      .on(t.backtestSessionId)
      .where(sql`${t.backtestSessionId} is not null`),
    index("user_words_day_idx")
      .on(t.day)
      .where(sql`${t.day} is not null`),
    // Jedna poprawka na wersje.
    uniqueIndex("user_words_supersedes_idx")
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} is not null`),
  ],
);

export const hypotheses = pgTable(
  "hypotheses",
  {
    id: serial().primaryKey(),
    code: text().notNull(),
    // RESTRICT: hipotezy nie da sie osierocic skasowaniem notatki.
    noteId: integer()
      .notNull()
      .references(() => notes.id, { onDelete: "restrict" }),
    // Decyzja czlowieka (trigger tj_require_ui_actor). Faza i status statystyczny sa wyliczane.
    decision: text()
      .$type<"active" | "confirmed" | "rejected" | "abandoned">()
      .notNull()
      .default("active"),
    progN: integer().notNull().default(20),
    thresholds: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // n z sejfu sprzed aplikacji.
    nImported: integer().notNull().default(0),
    declaredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("hypotheses_code", sql`${t.code} ~ '^H-[0-9]{3,}$'`),
    check(
      "hypotheses_decision",
      sql`${t.decision} in ('active', 'confirmed', 'rejected', 'abandoned')`,
    ),
    check("hypotheses_prog_n", sql`${t.progN} >= 1`),
    check("hypotheses_n_imported", sql`${t.nImported} >= 0`),
    unique("hypotheses_code_uq").on(t.code),
    unique("hypotheses_note_uq").on(t.noteId),
  ],
);

export const rules = pgTable(
  "rules",
  {
    id: serial().primaryKey(),
    code: text().notNull(),
    noteId: integer()
      .notNull()
      .references(() => notes.id, { onDelete: "restrict" }),
    // Twarda regula -> wskaznik dyscypliny.
    hard: boolean().notNull().default(false),
    retiredAt: timestamp({ withTimezone: true }),
    retiredInRuleset: integer(),
    retiredReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("rules_code", sql`${t.code} ~ '^R-[0-9]{3,}$'`),
    check("rules_retired", sql`(${t.retiredAt} is null) = (${t.retiredInRuleset} is null)`),
    unique("rules_code_uq").on(t.code),
    unique("rules_note_uq").on(t.noteId),
  ],
);

export const ruleVersions = pgTable(
  "rule_versions",
  {
    id: serial().primaryKey(),
    ruleId: integer()
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    textMd: text().notNull(),
    status: text().$type<"proposed" | "approved" | "rejected" | "superseded">().notNull(),
    origin: text().$type<Origin>().notNull(),
    // Najsilniejszy kontrargument (MUST 10).
    counterargument: text(),
    // Trade'y, swiece, zrzuty, poziom dowodu, n.
    evidence: jsonb().$type<Record<string, unknown>>(),
    // Podstawa propozycji AI. RESTRICT, nie SET NULL (tabela niezmienna).
    hypothesisId: integer().references(() => hypotheses.id, { onDelete: "restrict" }),
    // Numer zestawu nadany przy zatwierdzeniu.
    rulesetVersion: integer(),
    proposedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
    supersededAt: timestamp({ withTimezone: true }),
    createdByTokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
  },
  (t) => [
    check("rule_versions_version", sql`${t.version} >= 1`),
    check("rule_versions_text", sql`length(${t.textMd}) > 0`),
    check(
      "rule_versions_status",
      sql`${t.status} in ('proposed', 'approved', 'rejected', 'superseded')`,
    ),
    check("rule_versions_origin", sql`${t.origin} in ('user', 'ai', 'mentor', 'vault-import')`),
    check(
      "rule_versions_ai_proof",
      sql`${t.origin} <> 'ai' or (${t.counterargument} is not null and length(${t.counterargument}) > 0 and ${t.evidence} is not null and ${t.hypothesisId} is not null)`,
    ),
    check(
      "rule_versions_mentor_proof",
      sql`${t.origin} <> 'mentor' or ${t.evidence} is not null`,
    ),
    check(
      "rule_versions_ruleset",
      sql`(${t.status} in ('approved', 'superseded')) = (${t.rulesetVersion} is not null)`,
    ),
    unique("rule_versions_rule_version_uq").on(t.ruleId, t.version),
    // Jedna obowiazujaca wersja i jedna propozycja naraz na regule.
    uniqueIndex("rule_versions_approved_idx")
      .on(t.ruleId)
      .where(sql`${t.status} = 'approved'`),
    uniqueIndex("rule_versions_proposed_idx")
      .on(t.ruleId)
      .where(sql`${t.status} = 'proposed'`),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type Instrument = typeof instruments.$inferSelect;
export type Strategy = typeof strategies.$inferSelect;
export type BacktestSession = typeof backtestSessions.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type TagCategory = typeof tagCategories.$inferSelect;
export type CustomFieldRow = typeof customFields.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type Screenshot = typeof screenshots.$inferSelect;
export type TradeExit = typeof tradeExits.$inferSelect;
export type AuthEvent = typeof authEvents.$inferSelect;
export type DayNote = typeof dayNotes.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type TradeReview = typeof tradeReviews.$inferSelect;
export type TradeRuleCheck = typeof tradeRuleChecks.$inferSelect;
export type IngestSkip = typeof ingestSkips.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type DeviceCode = typeof deviceCodes.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type NoteRevision = typeof noteRevisions.$inferSelect;
export type NoteLink = typeof noteLinks.$inferSelect;
export type UserWords = typeof userWords.$inferSelect;
export type Hypothesis = typeof hypotheses.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type RuleVersion = typeof ruleVersions.$inferSelect;
