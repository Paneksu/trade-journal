-- Rysunki z wykresu, slownik tradera, rejestr poprawek interpretacji (ADR-033, faza 2b, 2026-10-15).
-- Projekt: docs/v2/model-danych.md, sekcja 5.8; odstepstwa: sekcja 14. Cofniecie: docs/v2/rollback/0026_down.sql.
-- Zaleznosci: 0018 (notes, user_words, funkcje tj_*).
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

CREATE TABLE "chart_annotations" (
  "id" serial PRIMARY KEY,
  "platform" text NOT NULL,
  -- Id rysunku na platformie.
  "external_id" text NOT NULL,
  "trade_id" integer REFERENCES "trades" ("id") ON DELETE CASCADE,
  "backtest_session_id" integer REFERENCES "backtest_sessions" ("id") ON DELETE CASCADE,
  "day" date,
  "shape" text NOT NULL,
  "interval" text,
  "price" numeric(18,8),
  "price2" numeric(18,8),
  "time_from" timestamptz,
  "time_to" timestamptz,
  -- Tekst rysunku 1:1 (user_words.source = 'chart'). NO ACTION: slowa uzytkownika nie znikaja
  -- spod rysunku; kasuja sie razem z nim tylko przez kaskade z trade'u. DEFERRABLE INITIALLY
  -- DEFERRED, bo rysunek i jego slowa gina rownolegle (uzasadnienie: 0021, trade_plans).
  "words_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  -- Surowy ksztalt z platformy, do diagnozy.
  "raw" jsonb NOT NULL,
  "captured_at" timestamptz NOT NULL,
  CONSTRAINT "chart_annotations_platform" CHECK ("platform" IN ('tradingview', 'fxreplay')),
  CONSTRAINT "chart_annotations_shape" CHECK ("shape" IN ('hline', 'rect', 'trend', 'text', 'other')),
  CONSTRAINT "chart_annotations_external_id" CHECK (length("external_id") > 0),
  CONSTRAINT "chart_annotations_anchor" CHECK (num_nonnulls("trade_id", "day") >= 1),
  CONSTRAINT "chart_annotations_time_order" CHECK ("time_from" IS NULL OR "time_to" IS NULL OR "time_to" >= "time_from"),
  -- Ten sam rysunek wysylany ponownie nie powiela sie, takze gdy trade_id albo day jest NULL.
  CONSTRAINT "chart_annotations_uq" UNIQUE NULLS NOT DISTINCT ("platform", "external_id", "trade_id", "day")
);--> statement-breakpoint
-- Rysunki trade'u (takze kaskada z jego kasowania), sesji i dnia.
CREATE INDEX "chart_annotations_trade_idx" ON "chart_annotations" ("trade_id") WHERE "trade_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chart_annotations_session_idx" ON "chart_annotations" ("backtest_session_id") WHERE "backtest_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chart_annotations_day_idx" ON "chart_annotations" ("day") WHERE "day" IS NOT NULL;--> statement-breakpoint

-- --- Slownik tradera ---------------------------------------------------------------

CREATE TABLE "profile_terms" (
  "id" serial PRIMARY KEY,
  -- Okreslenie uzytkownika dokladnie tak, jak je pisze.
  "term" text NOT NULL,
  -- Postac do porownan; kolumna generowana, wiec nie da sie jej rozjechac z term.
  "term_norm" text GENERATED ALWAYS AS (lower(public.f_unaccent("term"))) STORED,
  -- Np. "FVG@5m po sweepie".
  "meaning" text NOT NULL,
  -- SET NULL: pojecie mozna usunac, slownik zostaje. profile_terms nie jest niezmienna.
  "concept_note_id" integer REFERENCES "notes" ("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'proposed',
  "origin" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz,
  CONSTRAINT "profile_terms_term" CHECK (length("term") > 0),
  CONSTRAINT "profile_terms_meaning" CHECK (length("meaning") > 0),
  CONSTRAINT "profile_terms_status" CHECK ("status" IN ('proposed', 'confirmed', 'rejected')),
  CONSTRAINT "profile_terms_origin" CHECK ("origin" IN ('user', 'ai')),
  CONSTRAINT "profile_terms_decided" CHECK (("status" = 'proposed') = ("decided_at" IS NULL)),
  CONSTRAINT "profile_terms_term_norm_uq" UNIQUE ("term_norm")
);--> statement-breakpoint
-- Zerowanie concept_note_id przy kasowaniu notatki.
CREATE INDEX "profile_terms_concept_idx" ON "profile_terms" ("concept_note_id") WHERE "concept_note_id" IS NOT NULL;--> statement-breakpoint

-- Potwierdzenie i odrzucenie terminu tylko z UI (takze wyjscie z tych stanow).
CREATE TRIGGER "profile_terms_ui_actor" BEFORE INSERT OR UPDATE ON "profile_terms"
  FOR EACH ROW EXECUTE FUNCTION public.tj_require_ui_actor('status', 'confirmed', 'rejected');--> statement-breakpoint

-- Slowa uzytkownika, z ktorych wynika termin.
CREATE TABLE "profile_term_sources" (
  "term_id" integer NOT NULL REFERENCES "profile_terms" ("id") ON DELETE CASCADE,
  "words_id" integer NOT NULL REFERENCES "user_words" ("id") ON DELETE CASCADE,
  CONSTRAINT "profile_term_sources_pk" PRIMARY KEY ("term_id", "words_id")
);--> statement-breakpoint
-- Kaskada z kasowania slow (klucz glowny zaczyna sie od term_id).
CREATE INDEX "profile_term_sources_words_idx" ON "profile_term_sources" ("words_id");--> statement-breakpoint

-- --- Rejestr poprawek interpretacji (tylko dopisywanie) ------------------------------------

CREATE TABLE "interpretation_corrections" (
  "id" serial PRIMARY KEY,
  -- Interpretowane slowa. CASCADE to DELETE, ktorego tj_forbid_update nie blokuje.
  "words_id" integer NOT NULL REFERENCES "user_words" ("id") ON DELETE CASCADE,
  "before_interpretation" text NOT NULL,
  -- "Nie, chodzilo mi o..." doslownie.
  "correction_words_id" integer NOT NULL REFERENCES "user_words" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  "after_interpretation" text NOT NULL,
  -- NO ACTION, nigdy SET NULL: tabela jest tylko do dopisywania, a SET NULL to UPDATE.
  "term_id" integer REFERENCES "profile_terms" ("id") ON DELETE NO ACTION,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
-- Miara "odsetek poprawionych interpretacji w czasie".
CREATE INDEX "interpretation_corrections_created_idx" ON "interpretation_corrections" ("created_at");--> statement-breakpoint
CREATE INDEX "interpretation_corrections_words_idx" ON "interpretation_corrections" ("words_id");--> statement-breakpoint

CREATE TRIGGER "interpretation_corrections_immutable" BEFORE UPDATE ON "interpretation_corrections"
  FOR EACH ROW EXECUTE FUNCTION public.tj_forbid_update();
