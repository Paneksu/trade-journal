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
  primaryKey,
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

/* tsvector w kolumnach generowanych. Baza liczy je sama (GENERATED ALWAYS ... STORED),
   wiec drizzle nie wstawia ich przy INSERT; wyrazenie ponizej jest tylko opisem.
   Zdefiniowany na gorze pliku, bo uzywa go juz tabela trades (kolumna search, 0020). */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

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
  /* Stawka oplat za kontrakt w obie strony (round turn: prowizja + gielda + NFA), w centach, osobno dla mini i micro
     (migracja 0030, ADR-034). Dla kont prop obowiazuje stawka z reguly (prop_rules); tu stawka kont innych niz prop. */
  feeRtMiniCents: bigint({ mode: "number" }),
  feeRtMicroCents: bigint({ mode: "number" }),
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
    check("accounts_fee_mini", sql`${t.feeRtMiniCents} is null or ${t.feeRtMiniCents} >= 0`),
    check("accounts_fee_micro", sql`${t.feeRtMicroCents} is null or ${t.feeRtMicroCents} >= 0`),
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
    /* Klasa kontraktu dla stawki oplat (migracja 0030, ADR-034): mini / micro. NULL = nieznana, wtedy brak stawki. */
    sizeClass: text().$type<"mini" | "micro">(),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex("instruments_symbol_idx").on(t.symbol),
    check("instruments_size_class", sql`${t.sizeClass} is null or ${t.sizeClass} in ('mini', 'micro')`),
  ],
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

    /* --- Wynik netto (migracja 0030, ADR-034) -----------------------------
       `pnl` jest NETTO: po oplatach. `fees` = stawka x zamkniete kontrakty albo suma z rachunku (centy);
       NULL = oplaty nieznane (historia sprzed 0030 albo brak stawki), nie "zero". `pnlEstimate` = wynik z cen
       trade'a minus oplaty (wynik wyliczony). "Wyliczony" vs "z rachunku" wynika z `brokerAmount IS NULL`. */
    fees: bigint({ mode: "number" }),
    pnlEstimate: bigint({ mode: "number" }),

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
    source: text().$type<"form" | "tradingview" | "fxreplay" | "broker">().notNull().default("form"),
    externalRef: text(),
    ingestedAt: timestamp({ withTimezone: true }),
    sourceSnapshot: jsonb().$type<Record<string, unknown>>(),

    /* --- Proces i playbook (migracja 0020, ADR-033) ------------------------
       Ocena PROCESU A/B/C jest osobna od wyniku; NULL = nieocenione. Zapisuje ja UI albo
       zatwierdzona sugestia AI. Kolumny data_source NIE MA: zrodlo danych (backtest / forward /
       demo / live) jest wyliczane z sesji i typu konta (Slowa uzytkownika 14.10.2026). */
    processGrade: text().$type<"A" | "B" | "C">(),
    processGradedAt: timestamp({ withTimezone: true }),
    // SET NULL: trade przezywa skasowanie setupu; wersja w chwili decyzji, zapisywana raz.
    setupId: integer().references((): AnyPgColumn => setups.id, { onDelete: "set null" }),
    setupVersionId: integer().references((): AnyPgColumn => setupVersions.id, { onDelete: "set null" }),
    // Zestaw regul w chwili wejscia; NULL dla historii sprzed v2.
    rulesetVersion: integer(),
    // Metodyka R15: trade z replayu, trader rozpoznal dzien.
    dayKnown: boolean().notNull().default(false),
    // Ctrl+K: notatka i opis samopoczucia. Liczy baza; nie ma jej w INSERT.
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('simple', public.f_unaccent(coalesce("note", '') || ' ' || coalesce("mood_note", '')))`,
    ),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trades_external_ref_idx")
      .on(t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    check("trades_source", sql`${t.source} in ('form', 'tradingview', 'fxreplay', 'broker')`),
    check("trades_broker_ref", sql`${t.source} <> 'broker' or ${t.externalRef} ~ '^brk:'`),
    check("trades_fees", sql`${t.fees} is null or ${t.fees} >= 0`),
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
    check(
      "trades_process_grade",
      sql`${t.processGrade} is null or ${t.processGrade} in ('A', 'B', 'C')`,
    ),
    check("trades_process_graded", sql`(${t.processGrade} is null) = (${t.processGradedAt} is null)`),
    check("trades_ruleset_version", sql`${t.rulesetVersion} is null or ${t.rulesetVersion} >= 0`),
    index("trades_search_idx").using("gin", t.search),
    index("trades_setup_idx")
      .on(t.setupId)
      .where(sql`${t.setupId} is not null`),
    index("trades_setup_version_idx")
      .on(t.setupVersionId)
      .where(sql`${t.setupVersionId} is not null`),
    index("trades_process_grade_idx")
      .on(t.processGrade)
      .where(sql`${t.processGrade} is not null`),
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
    // 'ai' tylko po zatwierdzeniu sugestii w ai_suggestions (migracja 0020).
    origin: text().$type<"user" | "ai">().notNull().default("user"),
  },
  (t) => [
    check("trade_tags_origin", sql`${t.origin} in ('user', 'ai')`),
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
    /* --- Werdykt niezmienny (migracja 0021, ADR-033) ------------------------
       Werdykt z `asOf` jest niezmienny (trigger tj_guard_columns WHEN as_of IS NOT NULL);
       korekta uzytkownika to NOWY wiersz kind = 'user_override', ktory wskazuje werdykt AI. */
    kind: text().$type<"ai" | "user_override">().notNull().default("ai"),
    // NO ACTION: werdykt z korekta nie da sie skasowac osobno (kasowanie trade'u kasuje oba naraz).
    overridesReviewId: integer().references((): AnyPgColumn => tradeReviews.id, {
      onDelete: "no action",
    }),
    // Czas ZEGAROWY wydania werdyktu (evidenceCutoff to czas RYNKOWY ostatniej swiecy).
    asOf: timestamp({ withTimezone: true }),
    // SHA-256 kanonicznego JSON-a dowodow i sam manifest (swiece, sha256 zrzutow).
    evidenceHash: text(),
    evidenceManifest: jsonb().$type<unknown>(),
    // Zestaw regul, wzgledem ktorego oceniono (zastepuje brainVersion w nowych wierszach).
    rulesetVersion: integer(),
    createdByTokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
  },
  (t) => [
    /* Jeden werdykt AI na (trade, podstawa); korekty uzytkownika sie nie licza. Unikat CZESCIOWY:
       ON CONFLICT musi powtorzyc warunek (drizzle: targetWhere `kind = 'ai'`). */
    uniqueIndex("trade_reviews_trade_basis_uq")
      .on(t.tradeId, t.basis)
      .where(sql`${t.kind} = 'ai'`),
    // Kaskada z kasowania trade'u (czesciowy unikat jej nie obsluzy).
    index("trade_reviews_trade_idx").on(t.tradeId),
    index("trade_reviews_overrides_idx")
      .on(t.overridesReviewId)
      .where(sql`${t.overridesReviewId} is not null`),
    check("trade_reviews_basis", sql`${t.basis} in ('chart', 'history')`),
    check(
      "trade_reviews_verdict",
      sql`${t.brainVerdict} is null or ${t.brainVerdict} in ('wejdz', 'czekaj', 'odpusc')`,
    ),
    check("trade_reviews_kind", sql`${t.kind} in ('ai', 'user_override')`),
    check(
      "trade_reviews_override",
      sql`(${t.kind} = 'user_override') = (${t.overridesReviewId} is not null)`,
    ),
    check("trade_reviews_as_of_hash", sql`(${t.asOf} is null) = (${t.evidenceHash} is null)`),
    check(
      "trade_reviews_evidence_hash",
      sql`${t.evidenceHash} is null or ${t.evidenceHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "trade_reviews_manifest",
      sql`${t.evidenceManifest} is null or ${t.evidenceHash} is not null`,
    ),
    check(
      "trade_reviews_override_dated",
      sql`${t.kind} <> 'user_override' or ${t.asOf} is not null`,
    ),
    check("trade_reviews_ruleset", sql`${t.rulesetVersion} is null or ${t.rulesetVersion} >= 0`),
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
    // Wersja tej konkretnej reguly (migracja 0021). RESTRICT: wersji uzytej w werdykcie nie da sie skasowac.
    ruleVersionId: integer().references(() => ruleVersions.id, { onDelete: "restrict" }),
  },
  (t) => [
    unique("trade_rule_checks_review_rule_uq").on(t.reviewId, t.ruleId),
    index("trade_rule_checks_rule_idx").on(t.ruleId),
    index("trade_rule_checks_rule_version_idx")
      .on(t.ruleVersionId)
      .where(sql`${t.ruleVersionId} is not null`),
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
    /* Rytual przed sesja (migracja 0021): kierunek dnia, limit trade'ow, sen 1-5. */
    bias: text().$type<"long" | "short" | "neutral">(),
    maxTrades: smallint(),
    sleep: smallint(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("day_notes_bias", sql`${t.bias} is null or ${t.bias} in ('long', 'short', 'neutral')`),
    check("day_notes_max_trades", sql`${t.maxTrades} is null or ${t.maxTrades} between 1 and 20`),
    check("day_notes_sleep", sql`${t.sleep} is null or ${t.sleep} between 1 and 5`),
    /* Zakres 1-5 w bazie: walidacja w przegladarce nie jest zabezpieczeniem. W migracji 0021
       zalozone jako NOT VALID i sprawdzone osobna instrukcja (patrz plik migracji). */
    check("day_notes_mood", sql`${t.mood} is null or ${t.mood} between 1 and 5`),
    check("day_notes_energy", sql`${t.energy} is null or ${t.energy} between 1 and 5`),
    check("day_notes_day_rating", sql`${t.dayRating} is null or ${t.dayRating} between 1 and 5`),
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
  /* Dane brokera (migracja 0031, ADR-034). */
  "broker_import",
  "broker_import_reverted",
  "broker_import_rejected",
  "broker_account_mapped",
  "broker_match_reverted",
  "broker_history_recalculated",
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

export type ApiScope = "read" | "write" | "propose" | "import" | "import_broker";
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
    /* import_broker (0031, ADR-034): wylacznie samodzielny, tylko z UI i zawsze z terminem. */
    check(
      "api_tokens_scopes",
      sql`cardinality(${t.scopes}) between 1 and 4 and ${t.scopes} <@ array['read', 'write', 'propose', 'import', 'import_broker'] and (not ('import_broker' = any (${t.scopes})) or ${t.scopes} = array['import_broker']::text[])`,
    ),
    check(
      "api_tokens_import_broker",
      sql`not ('import_broker' = any (${t.scopes})) or (${t.createdVia} = 'ui' and ${t.expiresAt} is not null)`,
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
    // Powod odrzucenia / adnotacja decyzji (migracja 0020); zmienia sie razem ze statusem,
    // wiec nie nalezy do kolumn niezmiennych.
    decisionReason: text(),
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

/* ==========================================================================
   Faza 2b (migracje 0020-0027, ADR-033). Projekt: docs/v2/model-danych.md
   (sekcje 5.1-5.9), odstepstwa: sekcja 14. Triggery niezmiennosci i zatwierdzen siedza w SQL
   (kody: TJ409 niezmiennosc, TJ403 zatwierdzenie spoza UI, TJ422 dane niespojne / za malo danych).
   ========================================================================== */

/* --- Playbook: setupy, wersje, przyklady (0020) ------------------------------ */

export const setups = pgTable(
  "setups",
  {
    id: serial().primaryKey(),
    slug: text().notNull(),
    name: text().notNull(),
    // Karta setupu: opis i historia (notes.kind = 'setup'). RESTRICT: karty nie da sie osierocic.
    noteId: integer()
      .notNull()
      .references(() => notes.id, { onDelete: "restrict" }),
    retiredAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("setups_slug", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,79}$'`),
    check("setups_name", sql`length(${t.name}) between 1 and 120`),
    unique("setups_slug_uq").on(t.slug),
    unique("setups_note_uq").on(t.noteId),
  ],
);

export type SetupVersionStatus = "proposed" | "approved" | "rejected" | "superseded";

/* Wersja setupu: tresc niezmienna (trigger tj_guard_columns), zmienia sie status, znaczniki
   decyzji i decisionReason. Zatwierdzenie / odrzucenie / zastapienie tylko z UI (TJ403). */
export const setupVersions = pgTable(
  "setup_versions",
  {
    id: serial().primaryKey(),
    setupId: integer()
      .notNull()
      .references(() => setups.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    status: text().$type<SetupVersionStatus>().notNull(),
    // [{id, text}]: kontekst, bias, sesja.
    preconditions: jsonb().$type<{ id: string; text: string }[]>().notNull().default([]),
    // [{id, text, rule_code?}].
    entryChecklist: jsonb()
      .$type<{ id: string; text: string; rule_code?: string }[]>()
      .notNull()
      .default([]),
    stopRule: text(),
    targetRule: text(),
    beRule: text(),
    invalidation: text(),
    avoid: text(),
    // Progi statusu ZADEKLAROWANE Z GORY (min n, granice). Zmiana progu = nowa wersja.
    thresholds: jsonb().$type<Record<string, unknown>>().notNull(),
    origin: text().$type<Origin>().notNull(),
    counterargument: text(),
    evidence: jsonb().$type<Record<string, unknown>>(),
    proposedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
    supersededAt: timestamp({ withTimezone: true }),
    // Powod odrzucenia / adnotacja decyzji; zmienia sie razem ze statusem (nie jest niezmienna).
    decisionReason: text(),
    createdByTokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
  },
  (t) => [
    check("setup_versions_version", sql`${t.version} >= 1`),
    check(
      "setup_versions_status",
      sql`${t.status} in ('proposed', 'approved', 'rejected', 'superseded')`,
    ),
    check("setup_versions_origin", sql`${t.origin} in ('user', 'ai', 'mentor', 'vault-import')`),
    check("setup_versions_preconditions", sql`jsonb_typeof(${t.preconditions}) = 'array'`),
    check("setup_versions_entry_checklist", sql`jsonb_typeof(${t.entryChecklist}) = 'array'`),
    check("setup_versions_thresholds", sql`jsonb_typeof(${t.thresholds}) = 'object'`),
    check(
      "setup_versions_ai_proof",
      sql`${t.origin} <> 'ai' or (${t.counterargument} is not null and length(${t.counterargument}) > 0 and ${t.evidence} is not null)`,
    ),
    check(
      "setup_versions_mentor_proof",
      sql`${t.origin} <> 'mentor' or ${t.evidence} is not null`,
    ),
    unique("setup_versions_setup_version_uq").on(t.setupId, t.version),
    // Jedna obowiazujaca wersja i jedna propozycja naraz na setupie.
    uniqueIndex("setup_versions_approved_idx")
      .on(t.setupId)
      .where(sql`${t.status} = 'approved'`),
    uniqueIndex("setup_versions_proposed_idx")
      .on(t.setupId)
      .where(sql`${t.status} = 'proposed'`),
  ],
);

export const setupExamples = pgTable(
  "setup_examples",
  {
    id: serial().primaryKey(),
    setupId: integer()
      .notNull()
      .references(() => setups.id, { onDelete: "cascade" }),
    tradeId: integer()
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    kind: text().$type<"a_plus" | "anti">().notNull(),
    screenshotId: integer().references(() => screenshots.id, { onDelete: "set null" }),
    captionWordsId: integer().references(() => userWords.id, { onDelete: "no action" }),
    // 'ai' tylko po zatwierdzeniu sugestii.
    origin: text().$type<"user" | "ai">().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("setup_examples_kind", sql`${t.kind} in ('a_plus', 'anti')`),
    check("setup_examples_origin", sql`${t.origin} in ('user', 'ai')`),
    unique("setup_examples_uq").on(t.setupId, t.tradeId, t.kind),
    index("setup_examples_trade_idx").on(t.tradeId),
  ],
);

/* Trade <-> hipoteza / pojecie ICT / blad / mocna strona. Kolumny tradeId, noteId, role czyta
   funkcja SQL tj_hypothesis_n (0018): nie zmieniaj nazw. */
export const tradeNoteLinks = pgTable(
  "trade_note_links",
  {
    id: serial().primaryKey(),
    tradeId: integer()
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    noteId: integer()
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    role: text().$type<"hypothesis" | "concept" | "mistake" | "strength" | "other">().notNull(),
    origin: text().$type<"user" | "ai">().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "trade_note_links_role",
      sql`${t.role} in ('hypothesis', 'concept', 'mistake', 'strength', 'other')`,
    ),
    check("trade_note_links_origin", sql`${t.origin} in ('user', 'ai')`),
    unique("trade_note_links_uq").on(t.tradeId, t.noteId, t.role),
    index("trade_note_links_note_idx").on(t.noteId, t.role),
  ],
);

/* --- Kolejka AI i dopiski (0020) --------------------------------------------- */

export type AiSuggestionKind =
  | "tag"
  | "trade_link"
  | "setup_example"
  | "process_grade"
  | "profile_term"
  | "day_conclusion"
  | "weekly_conclusion"
  | "strategy_detail"
  | "trade_setup"
  | "broker_match"
  | "broker_trade";

/* Kolejka potwierdzen. Tresc niezmienna; zmieniaja sie status, decidedAt, appliedRef.
   accepted / rejected / reverted tylko z UI (TJ403); 'applied' ustawia API wylacznie dla
   kind = 'strategy_detail' (CHECK). */
export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: serial().primaryKey(),
    kind: text().$type<AiSuggestionKind>().notNull(),
    status: text()
      .$type<"pending" | "accepted" | "rejected" | "applied" | "reverted">()
      .notNull()
      .default("pending"),
    // {"type":"trade","id":123}.
    target: jsonb().$type<Record<string, unknown>>().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    // Twierdzenie jednym zdaniem.
    claim: text().notNull(),
    evidence: jsonb().$type<unknown[]>().notNull(),
    evidenceLevel: text().$type<"tested" | "partial" | "inferred">().notNull(),
    n: integer(),
    // Co wstawiono (do cofniecia).
    appliedRef: jsonb().$type<Record<string, unknown>>(),
    createdByTokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      "ai_suggestions_kind",
      sql`${t.kind} in ('tag', 'trade_link', 'setup_example', 'process_grade', 'profile_term', 'day_conclusion', 'weekly_conclusion', 'strategy_detail', 'trade_setup', 'broker_match', 'broker_trade')`,
    ),
    check(
      "ai_suggestions_status",
      sql`${t.status} in ('pending', 'accepted', 'rejected', 'applied', 'reverted')`,
    ),
    check("ai_suggestions_target", sql`jsonb_typeof(${t.target}) = 'object'`),
    check("ai_suggestions_payload", sql`jsonb_typeof(${t.payload}) = 'object'`),
    check("ai_suggestions_claim", sql`length(${t.claim}) > 0`),
    // Twierdzenie bez dowodu nie wejdzie do bazy (MUST 10, metodyka R21).
    check(
      "ai_suggestions_evidence",
      sql`jsonb_typeof(${t.evidence}) = 'array' and jsonb_array_length(${t.evidence}) > 0`,
    ),
    check(
      "ai_suggestions_evidence_level",
      sql`${t.evidenceLevel} in ('tested', 'partial', 'inferred')`,
    ),
    check("ai_suggestions_n", sql`${t.n} is null or ${t.n} >= 0`),
    check("ai_suggestions_decided", sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
    check(
      "ai_suggestions_applied_kind",
      sql`${t.status} <> 'applied' or ${t.kind} = 'strategy_detail'`,
    ),
    index("ai_suggestions_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    index("ai_suggestions_kind_status_idx").on(t.kind, t.status),
  ],
);

/* Dopiski AI i mentora do notatek strategii i kart setupu. Zmienia sie tylko revertedAt;
   tradeId i quoteWordsId wolno jedynie wyzerowac (kaskada FK SET NULL, trigger tj_guard_null_only). */
export const noteAdditions = pgTable(
  "note_additions",
  {
    id: serial().primaryKey(),
    noteId: integer()
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    // Tekst AI / mentora; w UI zawsze podpisany pochodzeniem.
    bodyMd: text().notNull(),
    origin: text().$type<"ai" | "mentor">().notNull(),
    // SET NULL: slowa przywiazane do trade'u kasuja sie razem z nim, a dopisek ma przezyc.
    quoteWordsId: integer().references(() => userWords.id, { onDelete: "set null" }),
    // SET NULL: dopisek przezywa skasowanie trade'u.
    tradeId: integer().references(() => trades.id, { onDelete: "set null" }),
    evidence: jsonb().$type<Record<string, unknown>>(),
    // NO ACTION (model: SET NULL): kolumna jest chroniona przez tj_guard_columns.
    suggestionId: integer().references(() => aiSuggestions.id, { onDelete: "no action" }),
    // Dopisek mentora wskazuje twierdzenie (0027). NO ACTION z tego samego powodu.
    mentorClaimId: integer().references(() => mentorClaims.id, { onDelete: "no action" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revertedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("note_additions_body", sql`length(${t.bodyMd}) > 0`),
    check("note_additions_origin", sql`${t.origin} in ('ai', 'mentor')`),
    check(
      "note_additions_mentor",
      sql`${t.origin} <> 'mentor' or ${t.mentorClaimId} is not null`,
    ),
    index("note_additions_note_idx")
      .on(t.noteId)
      .where(sql`${t.revertedAt} is null`),
    index("note_additions_trade_idx")
      .on(t.tradeId)
      .where(sql`${t.tradeId} is not null`),
    index("note_additions_quote_idx")
      .on(t.quoteWordsId)
      .where(sql`${t.quoteWordsId} is not null`),
    index("note_additions_claim_idx")
      .on(t.mentorClaimId)
      .where(sql`${t.mentorClaimId} is not null`),
  ],
);

/* --- Plan zamrozony (0021) ----------------------------------------------------- */

/* Plan jest migawka decyzji sprzed wejscia. Jedyny dozwolony UPDATE to przypiecie trade'u
   (trade_id z NULL na wartosc; trigger tj_plan_guard); kazda inna zmiana to TJ409, a zmiany po
   zamrozeniu ida jako dopiski (tradePlanAddenda). riskCents to MIGAWKA z computeTrade. */
export const tradePlans = pgTable(
  "trade_plans",
  {
    id: serial().primaryKey(),
    // Plan powstaje PRZED trade'em; wiele planow czeka z NULL, kazdy trade ma najwyzej jeden plan.
    tradeId: integer().references(() => trades.id, { onDelete: "cascade" }),
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    instrumentId: integer()
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    backtestSessionId: integer().references(() => backtestSessions.id, { onDelete: "cascade" }),
    // Dzien handlowy planu.
    day: date().notNull(),
    setupId: integer().references(() => setups.id, { onDelete: "restrict" }),
    setupVersionId: integer().references(() => setupVersions.id, { onDelete: "restrict" }),
    // Zestaw regul w chwili zamrozenia.
    rulesetVersion: integer().notNull(),
    direction: text().$type<"long" | "short">().notNull(),
    bias: text().$type<"long" | "short" | "neutral">(),
    entryPrice: numeric({ precision: 18, scale: 8 }).notNull(),
    stopLoss: numeric({ precision: 18, scale: 8 }).notNull(),
    takeProfit: numeric({ precision: 18, scale: 8 }),
    contracts: numeric({ precision: 14, scale: 4 }).notNull(),
    // MIGAWKA z computeTrade w chwili zamrozenia, w centach. Nigdy nie liczona w SQL.
    riskCents: bigint({ mode: "number" }).notNull(),
    thesisWordsId: integer().references(() => userWords.id, { onDelete: "no action" }),
    invalidationWordsId: integer().references(() => userWords.id, { onDelete: "no action" }),
    // 'ai' = AI przepisalo plan ze slow uzytkownika.
    origin: text().$type<"user" | "ai">().notNull(),
    createdByTokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
    frozenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Czas wejscia trade'a z chwili przypiecia planu (0028): pozniejsza zmiana entry_time nie przesuwa trade'a wzgledem planu.
    entryTimeAtAttach: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("trade_plans_direction", sql`${t.direction} in ('long', 'short')`),
    check("trade_plans_bias", sql`${t.bias} is null or ${t.bias} in ('long', 'short', 'neutral')`),
    check("trade_plans_origin", sql`${t.origin} in ('user', 'ai')`),
    check("trade_plans_contracts", sql`${t.contracts} > 0`),
    check("trade_plans_risk", sql`${t.riskCents} > 0`),
    check("trade_plans_ruleset", sql`${t.rulesetVersion} >= 0`),
    check(
      "trade_plans_setup_version",
      sql`${t.setupVersionId} is null or ${t.setupId} is not null`,
    ),
    // Long: SL ponizej wejscia, TP powyzej. Short: odwrotnie.
    check(
      "trade_plans_levels",
      sql`(${t.direction} = 'long' and ${t.stopLoss} < ${t.entryPrice} and (${t.takeProfit} is null or ${t.takeProfit} > ${t.entryPrice})) or (${t.direction} = 'short' and ${t.stopLoss} > ${t.entryPrice} and (${t.takeProfit} is null or ${t.takeProfit} < ${t.entryPrice}))`,
    ),
    unique("trade_plans_trade_uq").on(t.tradeId),
    index("trade_plans_day_idx").on(t.day),
    index("trade_plans_account_day_idx").on(t.accountId, t.day),
    index("trade_plans_setup_idx")
      .on(t.setupId)
      .where(sql`${t.setupId} is not null`),
    index("trade_plans_session_idx")
      .on(t.backtestSessionId)
      .where(sql`${t.backtestSessionId} is not null`),
  ],
);

/* Zmiany planu po zamrozeniu, tylko dopisywanie (trigger tj_forbid_update). */
export const tradePlanAddenda = pgTable(
  "trade_plan_addenda",
  {
    id: serial().primaryKey(),
    planId: integer()
      .notNull()
      .references(() => tradePlans.id, { onDelete: "cascade" }),
    field: text().$type<
      "stop_loss" | "take_profit" | "contracts" | "bias" | "invalidation" | "other"
    >(),
    newValue: jsonb().$type<unknown>(),
    wordsId: integer()
      .notNull()
      .references(() => userWords.id, { onDelete: "no action" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "trade_plan_addenda_field",
      sql`${t.field} is null or ${t.field} in ('stop_loss', 'take_profit', 'contracts', 'bias', 'invalidation', 'other')`,
    ),
    index("trade_plan_addenda_plan_idx").on(t.planId, t.createdAt),
  ],
);

/* --- Hipotezy: warianty i log progow (0022) -------------------------------------- */

export const hypothesisVariants = pgTable(
  "hypothesis_variants",
  {
    id: serial().primaryKey(),
    hypothesisId: integer().references(() => hypotheses.id, { onDelete: "cascade" }),
    setupId: integer().references(() => setups.id, { onDelete: "cascade" }),
    label: text().notNull(),
    // {"sl":"...","tp":"...","okno":"09:30-10:00"}.
    params: jsonb().$type<Record<string, unknown>>().notNull(),
    // SHA-256 kanonicznego JSON-a parametrow (posortowane klucze), liczy API.
    paramsHash: text().notNull(),
    nTested: integer().notNull(),
    // Migawka wyniku wariantu.
    result: jsonb().$type<Record<string, unknown>>(),
    origin: text().$type<"user" | "ai">().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("hypothesis_variants_label", sql`length(${t.label}) > 0`),
    check("hypothesis_variants_params", sql`jsonb_typeof(${t.params}) = 'object'`),
    check("hypothesis_variants_params_hash", sql`${t.paramsHash} ~ '^[0-9a-f]{64}$'`),
    check("hypothesis_variants_n_tested", sql`${t.nTested} >= 0`),
    check("hypothesis_variants_origin", sql`${t.origin} in ('user', 'ai')`),
    // Wariant nalezy do hipotezy ALBO do setupu.
    check(
      "hypothesis_variants_owner",
      sql`num_nonnulls(${t.hypothesisId}, ${t.setupId}) = 1`,
    ),
    // NULLS NOT DISTINCT: jeden z dwoch wlascicieli jest zawsze NULL.
    unique("hypothesis_variants_uq").on(t.hypothesisId, t.setupId, t.paramsHash).nullsNotDistinct(),
    index("hypothesis_variants_setup_idx")
      .on(t.setupId)
      .where(sql`${t.setupId} is not null`),
  ],
);

/* Log zmian progow po fakcie, tylko dopisywanie. Wiersze wstawia trigger
   hypotheses_threshold_log (tj_log_threshold_change), nie kod aplikacji. */
export const thresholdChanges = pgTable(
  "threshold_changes",
  {
    id: serial().primaryKey(),
    hypothesisId: integer()
      .notNull()
      .references(() => hypotheses.id, { onDelete: "cascade" }),
    field: text().$type<"prog_n" | "thresholds">().notNull(),
    oldValue: jsonb().$type<unknown>().notNull(),
    newValue: jsonb().$type<unknown>().notNull(),
    nAtChange: integer().notNull(),
    // nAtChange >= stary prog_n: wynik byl juz pokazany, gdy prog zmieniono.
    resultWasVisible: boolean().notNull(),
    actor: text().notNull(),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("threshold_changes_field", sql`${t.field} in ('prog_n', 'thresholds')`),
    index("threshold_changes_hypothesis_idx").on(t.hypothesisId, t.changedAt),
  ],
);

/* --- Modul prop (0023, dane presetow w 0024) -------------------------------------- */

export type PropDdType = "eod" | "intraday" | "static" | "trailing_to_static";

export const propFirmPresets = pgTable(
  "prop_firm_presets",
  {
    id: serial().primaryKey(),
    firm: text().notNull(),
    program: text().notNull(),
    phase: text().$type<"eval" | "funded">().notNull(),
    accountSizeCents: bigint({ mode: "number" }).notNull(),
    ddType: text().$type<PropDdType>().notNull(),
    maxDdCents: bigint({ mode: "number" }).notNull(),
    // trailing_to_static: przy jakim zysku DD staje w miejscu.
    ddLockCents: bigint({ mode: "number" }),
    dailyLossCents: bigint({ mode: "number" }),
    profitTargetCents: bigint({ mode: "number" }),
    consistencyPct: numeric({ precision: 5, scale: 2 }),
    minDays: smallint(),
    maxContractsMini: smallint(),
    maxContractsMicro: smallint(),
    // Stawka oplat round turn za kontrakt (prowizja + gielda + NFA), centy; NULL = nieznana (0030, ADR-034).
    feeRtMiniCents: bigint({ mode: "number" }),
    feeRtMicroCents: bigint({ mode: "number" }),
    feeSourceUrl: text(),
    sourceUrl: text().notNull(),
    // Data odczytu regulaminu.
    readOn: date().notNull(),
    effectiveFrom: date(),
    // [DO WERYFIKACJI] przy sprzecznych zrodlach; ma byc WIDOCZNE w UI.
    needsVerification: boolean().notNull().default(true),
    // Reguly pokazywane, ale nieliczone (trail_basis, consistency_effect, dll_optional_usd, ...).
    extra: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("prop_firm_presets_firm", sql`length(${t.firm}) > 0 and length(${t.program}) > 0`),
    check("prop_firm_presets_phase", sql`${t.phase} in ('eval', 'funded')`),
    check("prop_firm_presets_account_size", sql`${t.accountSizeCents} > 0`),
    check(
      "prop_firm_presets_dd_type",
      sql`${t.ddType} in ('eod', 'intraday', 'static', 'trailing_to_static')`,
    ),
    check("prop_firm_presets_max_dd", sql`${t.maxDdCents} > 0`),
    check(
      "prop_firm_presets_dd_lock",
      sql`${t.ddType} <> 'trailing_to_static' or ${t.ddLockCents} is not null`,
    ),
    check(
      "prop_firm_presets_daily_loss",
      sql`${t.dailyLossCents} is null or ${t.dailyLossCents} > 0`,
    ),
    check(
      "prop_firm_presets_profit_target",
      sql`${t.profitTargetCents} is null or ${t.profitTargetCents} > 0`,
    ),
    check(
      "prop_firm_presets_consistency",
      sql`${t.consistencyPct} is null or (${t.consistencyPct} > 0 and ${t.consistencyPct} <= 100)`,
    ),
    check("prop_firm_presets_min_days", sql`${t.minDays} is null or ${t.minDays} > 0`),
    check(
      "prop_firm_presets_contracts",
      sql`(${t.maxContractsMini} is null or ${t.maxContractsMini} > 0) and (${t.maxContractsMicro} is null or ${t.maxContractsMicro} > 0)`,
    ),
    check("prop_firm_presets_source_url", sql`${t.sourceUrl} ~ '^https://'`),
    check("prop_firm_presets_fee_mini", sql`${t.feeRtMiniCents} is null or ${t.feeRtMiniCents} >= 0`),
    check("prop_firm_presets_fee_micro", sql`${t.feeRtMicroCents} is null or ${t.feeRtMicroCents} >= 0`),
    check("prop_firm_presets_fee_source_url", sql`${t.feeSourceUrl} is null or ${t.feeSourceUrl} ~ '^https://'`),
    check("prop_firm_presets_extra", sql`jsonb_typeof(${t.extra}) = 'object'`),
    /* Kolejny odczyt tego samego programu to nowy wiersz z nowym readOn. Unikat zaczyna sie od
       (firm, program, phase), wiec obsluguje tez wybor presetu w UI; osobny indeks byl by zbedny. */
    unique("prop_firm_presets_uq").on(
      t.firm,
      t.program,
      t.phase,
      t.accountSizeCents,
      t.readOn,
    ),
  ],
);

/* Regula konta: kopia presetu, KAZDA wartosc nadpisywalna zwyklym UPDATE. Obowiazuje najnowsza
   regula z validFrom <= dzien (validFrom = data zakupu konta albo zmiany regulaminu). */
export const propRules = pgTable(
  "prop_rules",
  {
    id: serial().primaryKey(),
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // SET NULL: preset mozna usunac, regula konta zostaje (to jej kopia).
    presetId: integer().references(() => propFirmPresets.id, { onDelete: "set null" }),
    validFrom: date().notNull(),
    ddType: text().$type<PropDdType>().notNull(),
    maxDdCents: bigint({ mode: "number" }).notNull(),
    ddLockCents: bigint({ mode: "number" }),
    dailyLossCents: bigint({ mode: "number" }),
    profitTargetCents: bigint({ mode: "number" }),
    consistencyPct: numeric({ precision: 5, scale: 2 }),
    minDays: smallint(),
    maxContractsMini: smallint(),
    maxContractsMicro: smallint(),
    // Kopia stawek z presetu (edytowalna); obowiazuje najnowsza regula z validFrom <= dzien trade'a (0030, ADR-034).
    feeRtMiniCents: bigint({ mode: "number" }),
    feeRtMicroCents: bigint({ mode: "number" }),
    feeSourceUrl: text(),
    sourceUrl: text(),
    // Kopia presetu.extra.
    extra: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // Uzytkownik potwierdzil wartosci z regulaminem (metodyka R29).
    confirmedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "prop_rules_dd_type",
      sql`${t.ddType} in ('eod', 'intraday', 'static', 'trailing_to_static')`,
    ),
    check("prop_rules_max_dd", sql`${t.maxDdCents} > 0`),
    check(
      "prop_rules_dd_lock",
      sql`${t.ddType} <> 'trailing_to_static' or ${t.ddLockCents} is not null`,
    ),
    check("prop_rules_daily_loss", sql`${t.dailyLossCents} is null or ${t.dailyLossCents} > 0`),
    check(
      "prop_rules_profit_target",
      sql`${t.profitTargetCents} is null or ${t.profitTargetCents} > 0`,
    ),
    check(
      "prop_rules_consistency",
      sql`${t.consistencyPct} is null or (${t.consistencyPct} > 0 and ${t.consistencyPct} <= 100)`,
    ),
    check("prop_rules_min_days", sql`${t.minDays} is null or ${t.minDays} > 0`),
    check(
      "prop_rules_contracts",
      sql`(${t.maxContractsMini} is null or ${t.maxContractsMini} > 0) and (${t.maxContractsMicro} is null or ${t.maxContractsMicro} > 0)`,
    ),
    check("prop_rules_source_url", sql`${t.sourceUrl} is null or ${t.sourceUrl} ~ '^https://'`),
    check("prop_rules_fee_mini", sql`${t.feeRtMiniCents} is null or ${t.feeRtMiniCents} >= 0`),
    check("prop_rules_fee_micro", sql`${t.feeRtMicroCents} is null or ${t.feeRtMicroCents} >= 0`),
    check("prop_rules_fee_source_url", sql`${t.feeSourceUrl} is null or ${t.feeSourceUrl} ~ '^https://'`),
    check("prop_rules_extra", sql`jsonb_typeof(${t.extra}) = 'object'`),
    unique("prop_rules_account_valid_uq").on(t.accountId, t.validFrom),
    index("prop_rules_preset_idx")
      .on(t.presetId)
      .where(sql`${t.presetId} is not null`),
  ],
);

export type PropLedgerKind =
  | "eval_fee"
  | "reset_fee"
  | "activation_fee"
  | "subscription"
  | "data_fee"
  | "payout"
  | "refund"
  | "other";

/* Ksiega kosztow i wyplat. Znak kwoty: koszt < 0, wplyw > 0. */
export const propLedger = pgTable(
  "prop_ledger",
  {
    id: serial().primaryKey(),
    // RESTRICT: konta z ksiega sie archiwizuje, nie kasuje.
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    kind: text().$type<PropLedgerKind>().notNull(),
    amountCents: bigint({ mode: "number" }).notNull(),
    occurredOn: date().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "prop_ledger_kind",
      sql`${t.kind} in ('eval_fee', 'reset_fee', 'activation_fee', 'subscription', 'data_fee', 'payout', 'refund', 'other')`,
    ),
    check("prop_ledger_amount", sql`${t.amountCents} <> 0`),
    check(
      "prop_ledger_sign",
      sql`${t.kind} = 'other' or ((${t.kind} in ('payout', 'refund')) = (${t.amountCents} > 0))`,
    ),
    index("prop_ledger_account_idx").on(t.accountId, t.occurredOn),
  ],
);

/* --- Przeglad tygodnia (0025) ------------------------------------------------------- */

/* Zatwierdzenie (status 'approved') tylko z UI (TJ403). Jedno zobowiazanie = jedna kolumna
   commitmentWordsId; prevReviewId wskazuje przeglad, ktorego zobowiazanie rozliczamy. */
export const weeklyReviews = pgTable(
  "weekly_reviews",
  {
    id: serial().primaryKey(),
    // Poniedzialek tygodnia (ISO). Jeden przeglad na tydzien.
    weekStart: date().notNull(),
    status: text().$type<"draft" | "approved">().notNull().default("draft"),
    // Szkic AI (origin ai, w UI podpisany).
    draftMd: text(),
    // Liczby, na ktorych stal szkic, i chwila ich wyliczenia.
    statsSnapshot: jsonb().$type<Record<string, unknown>>(),
    asOf: timestamp({ withTimezone: true }),
    conclusionsWordsId: integer().references(() => userWords.id, { onDelete: "no action" }),
    commitmentWordsId: integer().references(() => userWords.id, { onDelete: "no action" }),
    prevReviewId: integer().references((): AnyPgColumn => weeklyReviews.id, {
      onDelete: "no action",
    }),
    prevCommitmentResult: text().$type<"kept" | "partial" | "broken">(),
    prevResultWordsId: integer().references(() => userWords.id, { onDelete: "no action" }),
    approvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("weekly_reviews_week_monday", sql`extract(isodow from ${t.weekStart}) = 1`),
    check("weekly_reviews_status", sql`${t.status} in ('draft', 'approved')`),
    check("weekly_reviews_approved", sql`(${t.status} = 'approved') = (${t.approvedAt} is not null)`),
    check("weekly_reviews_snapshot", sql`(${t.statsSnapshot} is null) = (${t.asOf} is null)`),
    check(
      "weekly_reviews_prev_result",
      sql`${t.prevCommitmentResult} is null or ${t.prevCommitmentResult} in ('kept', 'partial', 'broken')`,
    ),
    check(
      "weekly_reviews_prev_linked",
      sql`${t.prevCommitmentResult} is null or ${t.prevReviewId} is not null`,
    ),
    check(
      "weekly_reviews_prev_words",
      sql`${t.prevResultWordsId} is null or ${t.prevCommitmentResult} is not null`,
    ),
    check(
      "weekly_reviews_prev_self",
      sql`${t.prevReviewId} is null or ${t.prevReviewId} <> ${t.id}`,
    ),
    unique("weekly_reviews_week_uq").on(t.weekStart),
    // Zobowiazanie danego przegladu rozlicza najwyzej jeden nastepny przeglad.
    uniqueIndex("weekly_reviews_prev_idx")
      .on(t.prevReviewId)
      .where(sql`${t.prevReviewId} is not null`),
  ],
);

/* --- Wykres, slownik, poprawki (0026) ----------------------------------------------- */

export const chartAnnotations = pgTable(
  "chart_annotations",
  {
    id: serial().primaryKey(),
    platform: text().$type<"tradingview" | "fxreplay">().notNull(),
    // Id rysunku na platformie.
    externalId: text().notNull(),
    tradeId: integer().references(() => trades.id, { onDelete: "cascade" }),
    backtestSessionId: integer().references(() => backtestSessions.id, { onDelete: "cascade" }),
    day: date(),
    shape: text().$type<"hline" | "rect" | "trend" | "text" | "other">().notNull(),
    interval: text(),
    price: numeric({ precision: 18, scale: 8 }),
    price2: numeric({ precision: 18, scale: 8 }),
    timeFrom: timestamp({ withTimezone: true }),
    timeTo: timestamp({ withTimezone: true }),
    // Tekst rysunku 1:1 (user_words.source = 'chart').
    wordsId: integer().references(() => userWords.id, { onDelete: "no action" }),
    // Surowy ksztalt z platformy, do diagnozy.
    raw: jsonb().$type<unknown>().notNull(),
    capturedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    check("chart_annotations_platform", sql`${t.platform} in ('tradingview', 'fxreplay')`),
    check("chart_annotations_shape", sql`${t.shape} in ('hline', 'rect', 'trend', 'text', 'other')`),
    check("chart_annotations_external_id", sql`length(${t.externalId}) > 0`),
    check("chart_annotations_anchor", sql`num_nonnulls(${t.tradeId}, ${t.day}) >= 1`),
    check(
      "chart_annotations_time_order",
      sql`${t.timeFrom} is null or ${t.timeTo} is null or ${t.timeTo} >= ${t.timeFrom}`,
    ),
    // Ten sam rysunek wysylany ponownie nie powiela sie, takze gdy tradeId albo day jest NULL.
    unique("chart_annotations_uq")
      .on(t.platform, t.externalId, t.tradeId, t.day)
      .nullsNotDistinct(),
    index("chart_annotations_trade_idx")
      .on(t.tradeId)
      .where(sql`${t.tradeId} is not null`),
    index("chart_annotations_session_idx")
      .on(t.backtestSessionId)
      .where(sql`${t.backtestSessionId} is not null`),
    index("chart_annotations_day_idx")
      .on(t.day)
      .where(sql`${t.day} is not null`),
  ],
);

/* Slownik tradera. Potwierdzenie / odrzucenie terminu tylko z UI (TJ403). */
export const profileTerms = pgTable(
  "profile_terms",
  {
    id: serial().primaryKey(),
    // Okreslenie uzytkownika dokladnie tak, jak je pisze.
    term: text().notNull(),
    // Postac do porownan; liczy baza, wiec nie rozjedzie sie z term.
    termNorm: text().generatedAlwaysAs(sql`lower(public.f_unaccent("term"))`),
    // Np. "FVG@5m po sweepie".
    meaning: text().notNull(),
    // SET NULL: pojecie mozna usunac, slownik zostaje.
    conceptNoteId: integer().references(() => notes.id, { onDelete: "set null" }),
    status: text().$type<"proposed" | "confirmed" | "rejected">().notNull().default("proposed"),
    origin: text().$type<"user" | "ai">().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("profile_terms_term", sql`length(${t.term}) > 0`),
    check("profile_terms_meaning", sql`length(${t.meaning}) > 0`),
    check("profile_terms_status", sql`${t.status} in ('proposed', 'confirmed', 'rejected')`),
    check("profile_terms_origin", sql`${t.origin} in ('user', 'ai')`),
    check("profile_terms_decided", sql`(${t.status} = 'proposed') = (${t.decidedAt} is null)`),
    unique("profile_terms_term_norm_uq").on(t.termNorm),
    index("profile_terms_concept_idx")
      .on(t.conceptNoteId)
      .where(sql`${t.conceptNoteId} is not null`),
  ],
);

export const profileTermSources = pgTable(
  "profile_term_sources",
  {
    termId: integer()
      .notNull()
      .references(() => profileTerms.id, { onDelete: "cascade" }),
    wordsId: integer()
      .notNull()
      .references(() => userWords.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "profile_term_sources_pk", columns: [t.termId, t.wordsId] }),
    index("profile_term_sources_words_idx").on(t.wordsId),
  ],
);

/* Rejestr poprawek interpretacji AI, tylko dopisywanie (trigger tj_forbid_update). */
export const interpretationCorrections = pgTable(
  "interpretation_corrections",
  {
    id: serial().primaryKey(),
    wordsId: integer()
      .notNull()
      .references(() => userWords.id, { onDelete: "cascade" }),
    beforeInterpretation: text().notNull(),
    // "Nie, chodzilo mi o..." doslownie.
    correctionWordsId: integer()
      .notNull()
      .references(() => userWords.id, { onDelete: "no action" }),
    afterInterpretation: text().notNull(),
    // NO ACTION, nigdy SET NULL: tabela jest tylko do dopisywania.
    termId: integer().references(() => profileTerms.id, { onDelete: "no action" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Miara "odsetek poprawionych interpretacji w czasie".
    index("interpretation_corrections_created_idx").on(t.createdAt),
    index("interpretation_corrections_words_idx").on(t.wordsId),
  ],
);

/* --- Mentor i luki w strategii (0027) ------------------------------------------------ */

export const mentorSources = pgTable(
  "mentor_sources",
  {
    id: serial().primaryKey(),
    platform: text().$type<"youtube">().notNull().default("youtube"),
    videoId: text().notNull(),
    playlistId: text(),
    position: integer(),
    title: text().notNull(),
    url: text().notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    durationS: integer(),
    status: text()
      .$type<"pending" | "processed" | "no_captions" | "error">()
      .notNull()
      .default("pending"),
    transcriptSource: text().$type<"captions" | "whisper">(),
    // Sciezka lokalna na R:, nigdy tresc transkrypcji.
    transcriptPath: text(),
    error: text(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("mentor_sources_platform", sql`${t.platform} in ('youtube')`),
    check("mentor_sources_video_id", sql`length(${t.videoId}) > 0`),
    check("mentor_sources_title", sql`length(${t.title}) > 0`),
    check("mentor_sources_url", sql`${t.url} ~ '^https://'`),
    check("mentor_sources_duration", sql`${t.durationS} is null or ${t.durationS} >= 0`),
    check(
      "mentor_sources_status",
      sql`${t.status} in ('pending', 'processed', 'no_captions', 'error')`,
    ),
    check(
      "mentor_sources_transcript_source",
      sql`${t.transcriptSource} is null or ${t.transcriptSource} in ('captions', 'whisper')`,
    ),
    // Idempotencja `tj mentor sync`.
    unique("mentor_sources_video_uq").on(t.platform, t.videoId),
    index("mentor_sources_pending_idx")
      .on(t.playlistId, t.position)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/* Twierdzenia mentora z doslownym cytatem. Cytat i znacznik czasu niezmienne (tj_guard_columns);
   skrot cytatu liczy trigger tj_mentor_claim_hash. */
export const mentorClaims = pgTable(
  "mentor_claims",
  {
    id: serial().primaryKey(),
    sourceId: integer()
      .notNull()
      .references(() => mentorSources.id, { onDelete: "cascade" }),
    // Doslowny cytat.
    quote: text().notNull(),
    quoteSha256: text().notNull().default(""),
    tStartS: integer().notNull(),
    tEndS: integer(),
    claimType: text()
      .$type<"concept" | "setup_condition" | "management" | "psychology" | "other">()
      .notNull(),
    // Streszczenie AI, zawsze podpisane.
    paraphrase: text(),
    status: text()
      .$type<"extracted" | "merged" | "review_ok" | "review_bad">()
      .notNull()
      .default("extracted"),
    // SET NULL: te dwie kolumny nie sa chronione przez tj_guard_columns.
    mergedNoteId: integer().references(() => notes.id, { onDelete: "set null" }),
    setupId: integer().references((): AnyPgColumn => setups.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("mentor_claims_quote", sql`length(${t.quote}) > 0`),
    check("mentor_claims_quote_sha256", sql`${t.quoteSha256} ~ '^[0-9a-f]{64}$'`),
    check("mentor_claims_t_start", sql`${t.tStartS} >= 0`),
    check("mentor_claims_t_end", sql`${t.tEndS} is null or ${t.tEndS} >= ${t.tStartS}`),
    check(
      "mentor_claims_claim_type",
      sql`${t.claimType} in ('concept', 'setup_condition', 'management', 'psychology', 'other')`,
    ),
    check(
      "mentor_claims_status",
      sql`${t.status} in ('extracted', 'merged', 'review_ok', 'review_bad')`,
    ),
    unique("mentor_claims_source_quote_uq").on(t.sourceId, t.quoteSha256, t.tStartS),
    index("mentor_claims_note_idx")
      .on(t.mergedNoteId)
      .where(sql`${t.mergedNoteId} is not null`),
    index("mentor_claims_setup_idx")
      .on(t.setupId)
      .where(sql`${t.setupId} is not null`),
  ],
);

/* Luki w strategii i sprzecznosci "mentor kontra praktyka". Odpowiedz i odrzucenie tylko z UI
   (TJ403): AI nie rozstrzyga. Stan 'asked' ustawia API. */
export const strategyGaps = pgTable(
  "strategy_gaps",
  {
    id: serial().primaryKey(),
    // 'mentor_conflict' = "Do rozstrzygniecia".
    kind: text().$type<"gap" | "mentor_conflict">().notNull(),
    question: text().notNull(),
    // sha256(kind + znormalizowane pytanie), liczy API.
    dedupeKey: text().notNull(),
    setupId: integer().references((): AnyPgColumn => setups.id, { onDelete: "set null" }),
    tradeId: integer().references(() => trades.id, { onDelete: "set null" }),
    // NO ACTION (model: SET NULL): CHECK strategy_gaps_conflict wymaga cytatu przy sprzecznosci.
    mentorClaimId: integer().references(() => mentorClaims.id, { onDelete: "no action" }),
    noteId: integer().references(() => notes.id, { onDelete: "set null" }),
    status: text()
      .$type<"open" | "asked" | "answered" | "dismissed">()
      .notNull()
      .default("open"),
    origin: text().$type<"ai" | "mentor">().notNull(),
    askedAt: timestamp({ withTimezone: true }),
    answeredAt: timestamp({ withTimezone: true }),
    // Odpowiedz uzytkownika: jego slowa dokladnie.
    answerWordsId: integer().references(() => userWords.id, { onDelete: "no action" }),
    // Rozstrzygniecie sprzecznosci; luka (kind = 'gap') nigdy go nie ma.
    resolution: text().$type<"keep_mine" | "take_mentor" | "both_conditional">(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("strategy_gaps_kind", sql`${t.kind} in ('gap', 'mentor_conflict')`),
    check("strategy_gaps_question", sql`length(${t.question}) > 0`),
    check("strategy_gaps_dedupe_key", sql`${t.dedupeKey} ~ '^[0-9a-f]{64}$'`),
    check("strategy_gaps_status", sql`${t.status} in ('open', 'asked', 'answered', 'dismissed')`),
    check("strategy_gaps_origin", sql`${t.origin} in ('ai', 'mentor')`),
    check(
      "strategy_gaps_conflict",
      sql`${t.kind} <> 'mentor_conflict' or ${t.mentorClaimId} is not null`,
    ),
    check(
      "strategy_gaps_answer",
      sql`(${t.status} = 'answered') = (${t.answerWordsId} is not null)`,
    ),
    check(
      "strategy_gaps_answered_at",
      sql`(${t.status} = 'answered') = (${t.answeredAt} is not null)`,
    ),
    check(
      "strategy_gaps_resolution_value",
      sql`${t.resolution} is null or ${t.resolution} in ('keep_mine', 'take_mentor', 'both_conditional')`,
    ),
    check(
      "strategy_gaps_resolution",
      sql`(${t.kind} = 'gap' and ${t.resolution} is null) or (${t.kind} = 'mentor_conflict' and ((${t.status} = 'answered') = (${t.resolution} is not null)))`,
    ),
    uniqueIndex("strategy_gaps_open_dedupe_idx")
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('open', 'asked')`),
    index("strategy_gaps_queue_idx")
      .on(t.kind, t.createdAt)
      .where(sql`${t.status} in ('open', 'asked')`),
    index("strategy_gaps_trade_idx")
      .on(t.tradeId)
      .where(sql`${t.tradeId} is not null`),
    index("strategy_gaps_claim_idx")
      .on(t.mentorClaimId)
      .where(sql`${t.mentorClaimId} is not null`),
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
export type Setup = typeof setups.$inferSelect;
export type SetupVersion = typeof setupVersions.$inferSelect;
export type SetupExample = typeof setupExamples.$inferSelect;
export type TradeNoteLink = typeof tradeNoteLinks.$inferSelect;
export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type NoteAddition = typeof noteAdditions.$inferSelect;
export type TradePlan = typeof tradePlans.$inferSelect;
export type TradePlanAddendum = typeof tradePlanAddenda.$inferSelect;
export type HypothesisVariant = typeof hypothesisVariants.$inferSelect;
export type ThresholdChange = typeof thresholdChanges.$inferSelect;
export type PropFirmPreset = typeof propFirmPresets.$inferSelect;
export type PropRule = typeof propRules.$inferSelect;
export type PropLedgerEntry = typeof propLedger.$inferSelect;
export type WeeklyReview = typeof weeklyReviews.$inferSelect;
export type ChartAnnotation = typeof chartAnnotations.$inferSelect;
export type ProfileTerm = typeof profileTerms.$inferSelect;
export type ProfileTermSource = typeof profileTermSources.$inferSelect;
export type InterpretationCorrection = typeof interpretationCorrections.$inferSelect;
export type MentorSource = typeof mentorSources.$inferSelect;
export type MentorClaim = typeof mentorClaims.$inferSelect;
export type StrategyGap = typeof strategyGaps.$inferSelect;

/* ==========================================================================
   Dane brokera (migracje 0030 do 0032, ADR-034, etap A). Migracje pisane recznie; ten plik jest ich lustrem.
   Triggery (tj_broker_zapis, tj_broker_konto_zapis, tj_broker_import_origin, tj_broker_dopasowanie,
   tj_trade_odepnij_broker) opisuje test src/lib/db/migracje-v2.db.test.ts.
   ========================================================================== */

export type MetodaBrokera = "export_file" | "oauth_tradovate";
export type PlatformaBrokera = "tradovate" | "tradingview" | "topstepx" | "rithmic" | "ninjatrader" | "generic";

/* Lista firm i platform jako DANE (0031, wiersze w 0032): starzeje sie w tygodniach, wiec read_on + ostrzezenie po 30 dniach. */
export const propFirmPlatforms = pgTable(
  "prop_firm_platforms",
  {
    id: serial().primaryKey(),
    firm: text().notNull(),
    platform: text().notNull(),
    methods: text().array().$type<MetodaBrokera[]>().notNull(),
    // Skad pobrac plik ("Reports -> Orders -> Download CSV").
    exportHint: text(),
    sourceUrl: text().notNull(),
    readOn: date().notNull(),
    needsVerification: boolean().notNull().default(true),
    notes: text(),
  },
  (t) => [
    check("prop_firm_platforms_firm", sql`length(${t.firm}) > 0 and length(${t.platform}) > 0`),
    check("prop_firm_platforms_methods", sql`${t.methods} <@ array['export_file', 'oauth_tradovate']::text[]`),
    check("prop_firm_platforms_source_url", sql`${t.sourceUrl} ~ '^https://'`),
    unique("prop_firm_platforms_uq").on(t.firm, t.platform, t.readOn),
  ],
);

/* Konto u brokera <-> konto dziennika. accountId NULL = konto zgloszone przez automat, czeka na przypisanie w UI.
   Numer konta u brokera: tylko HMAC-SHA256 (klucz BROKER_ID_HMAC_KEY) i ostatnie 4 znaki. */
export const brokerAccounts = pgTable(
  "broker_accounts",
  {
    id: serial().primaryKey(),
    accountId: integer().references(() => accounts.id, { onDelete: "cascade" }),
    platform: text().$type<PlatformaBrokera>().notNull(),
    method: text().$type<MetodaBrokera>().notNull(),
    firm: text(),
    externalAccountHmac: text().notNull(),
    labelLast4: text(),
    // Strefa czasowa plikow tego konta bez przesuniecia (automat); NULL = strefa z ustawien uzytkownika.
    tz: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("broker_accounts_platform", sql`${t.platform} in ('tradovate', 'tradingview', 'topstepx', 'rithmic', 'ninjatrader', 'generic')`),
    check("broker_accounts_method", sql`${t.method} in ('export_file', 'oauth_tradovate')`),
    check("broker_accounts_method_platform", sql`${t.method} <> 'oauth_tradovate' or ${t.platform} = 'tradovate'`),
    check("broker_accounts_hmac", sql`${t.externalAccountHmac} ~ '^[0-9a-f]{64}$'`),
    check("broker_accounts_last4", sql`${t.labelLast4} is null or length(${t.labelLast4}) <= 4`),
    unique("broker_accounts_account_uq").on(t.accountId),
    unique("broker_accounts_external_uq").on(t.platform, t.externalAccountHmac),
  ],
);

export type OstrzezenieImportu = { code: string; message: string };

/* Jeden wiersz na plik. Pliku nie przechowujemy: SHA-256, liczniki i ostrzezenia. */
export const brokerImports = pgTable(
  "broker_imports",
  {
    id: serial().primaryKey(),
    origin: text().$type<"ui" | "tj_watch" | "oauth">().notNull(),
    format: text().notNull(),
    fileSha256: text(),
    fileBytes: integer(),
    tz: text().notNull(),
    rowsTotal: integer().notNull(),
    rowsSkipped: integer().notNull(),
    fillsNew: integer().notNull(),
    fillsDuplicate: integer().notNull(),
    tradesMatched: integer().notNull(),
    tradesCreated: integer().notNull(),
    pendingDecisions: integer().notNull(),
    status: text().$type<"committed" | "reverted" | "rejected">().notNull().default("committed"),
    warnings: jsonb().$type<OstrzezenieImportu[]>().notNull().default(sql`'[]'::jsonb`),
    note: text(),
    createdByTokenId: integer().references(() => apiTokens.id, { onDelete: "no action" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revertedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("broker_imports_origin", sql`${t.origin} in ('ui', 'tj_watch', 'oauth')`),
    check("broker_imports_sha256", sql`${t.fileSha256} is null or ${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check("broker_imports_status", sql`${t.status} in ('committed', 'reverted', 'rejected')`),
    check("broker_imports_reverted", sql`(${t.status} = 'reverted') = (${t.revertedAt} is not null)`),
    check("broker_imports_oauth_sha", sql`(${t.origin} = 'oauth') = (${t.fileSha256} is null)`),
    check(
      "broker_imports_counts",
      sql`${t.rowsTotal} >= 0 and ${t.rowsSkipped} >= 0 and ${t.fillsNew} >= 0 and ${t.fillsDuplicate} >= 0 and ${t.tradesMatched} >= 0 and ${t.tradesCreated} >= 0 and ${t.pendingDecisions} >= 0`,
    ),
    check("broker_imports_warnings", sql`jsonb_typeof(${t.warnings}) = 'array'`),
    uniqueIndex("broker_imports_sha_committed_uq")
      .on(t.fileSha256)
      .where(sql`${t.status} = 'committed' and ${t.fileSha256} is not null`),
    index("broker_imports_created_idx").on(t.createdAt.desc()),
    index("broker_imports_sha_idx")
      .on(t.fileSha256)
      .where(sql`${t.fileSha256} is not null`),
  ],
);

/* Trade'y brokera zgrupowane z wypelnien (od zera pozycji do powrotu do zera). */
export const brokerTrades = pgTable(
  "broker_trades",
  {
    id: serial().primaryKey(),
    brokerAccountId: integer()
      .notNull()
      .references(() => brokerAccounts.id, { onDelete: "cascade" }),
    importId: integer().references(() => brokerImports.id, { onDelete: "cascade" }),
    // 'brk:<platforma>:<skrot konta>:<id pierwszego fill wejscia>'
    externalRef: text().notNull(),
    contract: text().notNull(),
    instrumentId: integer().references(() => instruments.id, { onDelete: "restrict" }),
    direction: text().$type<"long" | "short">().notNull(),
    maxQty: numeric({ precision: 14, scale: 4 }).notNull(),
    entryTime: timestamp({ withTimezone: true }).notNull(),
    exitTime: timestamp({ withTimezone: true }),
    avgEntryPrice: numeric({ precision: 18, scale: 8 }).notNull(),
    avgExitPrice: numeric({ precision: 18, scale: 8 }),
    status: text().$type<"open" | "closed">().notNull(),
    grossCents: bigint({ mode: "number" }),
    grossSource: text().$type<"broker" | "computed">(),
    feesCents: bigint({ mode: "number" }),
    feeSource: text().$type<"broker" | "rate">(),
    netCents: bigint({ mode: "number" }),
    tradingDay: date(),
    tradeId: integer().references(() => trades.id, { onDelete: "set null" }),
    matchKind: text().$type<"auto" | "user" | "ai_accepted" | "created">(),
    matchState: text().$type<"unmatched" | "ambiguous" | "matched" | "skipped">().notNull().default("unmatched"),
    matchedAt: timestamp({ withTimezone: true }),
    // Kwota z rachunku trade'u dziennika sprzed dopasowania (do cofniecia).
    prevBrokerAmountCents: bigint({ mode: "number" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("broker_trades_external_ref_uq").on(t.externalRef),
    check("broker_trades_external_ref", sql`${t.externalRef} ~ '^brk:'`),
    check("broker_trades_direction", sql`${t.direction} in ('long', 'short')`),
    check("broker_trades_qty", sql`${t.maxQty} > 0`),
    check("broker_trades_status", sql`${t.status} in ('open', 'closed')`),
    check("broker_trades_closed", sql`(${t.status} = 'closed') = (${t.exitTime} is not null)`),
    check("broker_trades_gross_source", sql`${t.grossSource} is null or ${t.grossSource} in ('broker', 'computed')`),
    check("broker_trades_gross_pair", sql`(${t.grossCents} is null) = (${t.grossSource} is null)`),
    check("broker_trades_fee_source", sql`${t.feeSource} is null or ${t.feeSource} in ('broker', 'rate')`),
    check("broker_trades_fees_pair", sql`(${t.feesCents} is null) = (${t.feeSource} is null)`),
    check("broker_trades_fees_nonneg", sql`${t.feesCents} is null or ${t.feesCents} >= 0`),
    check("broker_trades_match_kind", sql`${t.matchKind} is null or ${t.matchKind} in ('auto', 'user', 'ai_accepted', 'created')`),
    check("broker_trades_match_state", sql`${t.matchState} in ('unmatched', 'ambiguous', 'matched', 'skipped')`),
    check("broker_trades_link_kind", sql`(${t.tradeId} is null) = (${t.matchKind} is null)`),
    check("broker_trades_link_state", sql`(${t.matchState} = 'matched') = (${t.tradeId} is not null)`),
    uniqueIndex("broker_trades_trade_uq")
      .on(t.tradeId)
      .where(sql`${t.tradeId} is not null`),
    index("broker_trades_account_entry_idx").on(t.brokerAccountId, t.entryTime),
    index("broker_trades_day_idx").on(t.tradingDay),
    index("broker_trades_open_state_idx")
      .on(t.matchState)
      .where(sql`${t.matchState} in ('unmatched', 'ambiguous')`),
    index("broker_trades_import_idx").on(t.importId),
  ],
);

/* Wypelnienia (zlecenia z Orders). `raw` to sparsowany wiersz BEZ numeru konta. */
export const brokerFills = pgTable(
  "broker_fills",
  {
    id: serial().primaryKey(),
    brokerAccountId: integer()
      .notNull()
      .references(() => brokerAccounts.id, { onDelete: "cascade" }),
    importId: integer().references(() => brokerImports.id, { onDelete: "cascade" }),
    // '<platforma>:<skrot konta>:<id_zrodla>'
    externalRef: text().notNull(),
    brokerTradeId: integer().references(() => brokerTrades.id, { onDelete: "set null" }),
    contract: text().notNull(),
    side: text().$type<"buy" | "sell">().notNull(),
    qty: numeric({ precision: 14, scale: 4 }).notNull(),
    price: numeric({ precision: 18, scale: 8 }).notNull(),
    filledAt: timestamp({ withTimezone: true }).notNull(),
    feeCents: bigint({ mode: "number" }),
    brokerPnlCents: bigint({ mode: "number" }),
    orderRef: text(),
    raw: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("broker_fills_external_ref_uq").on(t.externalRef),
    check("broker_fills_side", sql`${t.side} in ('buy', 'sell')`),
    check("broker_fills_qty", sql`${t.qty} > 0`),
    check("broker_fills_price", sql`${t.price} > 0`),
    check("broker_fills_fee", sql`${t.feeCents} is null or ${t.feeCents} >= 0`),
    check("broker_fills_raw", sql`jsonb_typeof(${t.raw}) = 'object'`),
    index("broker_fills_account_time_idx").on(t.brokerAccountId, t.filledAt),
    index("broker_fills_trade_idx").on(t.brokerTradeId),
    index("broker_fills_import_idx").on(t.importId),
  ],
);

/* Zdarzenia Cash History: prowizje, wynik brutto pary, wplaty. Osobno od wypelnien, bo plik moze przyjsc przed Orders albo po nich. */
export const brokerCashEvents = pgTable(
  "broker_cash_events",
  {
    id: serial().primaryKey(),
    brokerAccountId: integer()
      .notNull()
      .references(() => brokerAccounts.id, { onDelete: "cascade" }),
    importId: integer().references(() => brokerImports.id, { onDelete: "cascade" }),
    externalRef: text().notNull(),
    kind: text().$type<"commission" | "fee" | "trade_paired" | "deposit" | "other">().notNull(),
    // Ze znakiem: koszt < 0, wplyw > 0.
    deltaCents: bigint({ mode: "number" }).notNull(),
    contract: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    raw: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("broker_cash_events_external_ref_uq").on(t.externalRef),
    check("broker_cash_events_kind", sql`${t.kind} in ('commission', 'fee', 'trade_paired', 'deposit', 'other')`),
    check("broker_cash_events_raw", sql`jsonb_typeof(${t.raw}) = 'object'`),
    index("broker_cash_events_account_time_idx").on(t.brokerAccountId, t.occurredAt),
    index("broker_cash_events_import_idx").on(t.importId),
  ],
);

/* Aktywne konta dnia (rytual przed sesja), wielokrotne (Slowa uzytkownika 16.10.2026: «Kilka naraz»). */
export const dayAccounts = pgTable(
  "day_accounts",
  {
    day: date().notNull(),
    accountId: integer()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.accountId] })],
);
