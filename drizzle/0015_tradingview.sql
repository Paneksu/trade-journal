-- Synchronizacja z TradingView i FX Replay przez API (ADR-026, 2026-10-05).
--
-- Wszystko dokladane, nic nie przepisywane: stare wiersze dostaja wartosci
-- domyslne, wiec dziennik prowadzony recznie dziala bez zmian.
--
-- ZAKAZ `ALTER TYPE ... ADD VALUE` w tym pliku (patrz uwaga w 0013): migrator
-- drizzle owija jedna transakcja cala serie zaleglych plikow, a swieza wartosc
-- enuma nie moze byc uzyta w tej samej transakcji. Dlatego nowe dziedziny
-- wartosci to `text` + CHECK, nie enumy.

-- --- trades: skad wpis przyszedl --------------------------------------------

ALTER TABLE "trades" ADD COLUMN "source" text NOT NULL DEFAULT 'form';--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_source" CHECK ("source" IN ('form', 'tradingview', 'fxreplay'));--> statement-breakpoint

-- Klucz idempotencji dla API: "tv:<id>" / "fxr:<id>". Unikalny tylko tam, gdzie
-- jest ustawiony - wpisy z formularza maja NULL, a NULL != NULL w indeksie.
ALTER TABLE "trades" ADD COLUMN "external_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "trades_external_ref_idx" ON "trades" ("external_ref") WHERE "external_ref" IS NOT NULL;--> statement-breakpoint

-- Kiedy API ostatnio zapisalo ten wiersz. Edycja w aplikacji podbija
-- `updated_at` ponad ten moment, i wlasnie to wykrywa konflikt (ADR-026).
ALTER TABLE "trades" ADD COLUMN "ingested_at" timestamptz;--> statement-breakpoint

-- Surowy ksztalt tego, co przyslal klient - do diagnozy rozjazdow, nie do statystyk.
ALTER TABLE "trades" ADD COLUMN "source_snapshot" jsonb;--> statement-breakpoint

-- --- accounts: faza konta prop ----------------------------------------------

ALTER TABLE "accounts" ADD COLUMN "prop_phase" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_prop_phase" CHECK (
  "prop_phase" IS NULL OR ("prop_phase" IN ('eval', 'funded') AND "type"::text = 'prop')
);--> statement-breakpoint

-- --- backtest_sessions: rodzaj i klucz sesji FX Replay ----------------------

ALTER TABLE "backtest_sessions" ADD COLUMN "kind" text NOT NULL DEFAULT 'backtest';--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_kind" CHECK ("kind" IN ('backtest', 'forward'));--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD COLUMN "external_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "backtest_sessions_external_ref_idx" ON "backtest_sessions" ("external_ref") WHERE "external_ref" IS NOT NULL;--> statement-breakpoint

-- --- screenshots: kto wgral zrzut -------------------------------------------

ALTER TABLE "screenshots" ADD COLUMN "origin" text NOT NULL DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_origin" CHECK ("origin" IN ('manual', 'tradingview', 'fxreplay'));--> statement-breakpoint

-- --- ocena trade'a (AI) -----------------------------------------------------

CREATE TABLE "trade_reviews" (
  "id" serial PRIMARY KEY,
  "trade_id" integer NOT NULL REFERENCES "trades" ("id") ON DELETE CASCADE,
  "setup_type" text,
  "summary_md" text,
  "lesson" text,
  "basis" text NOT NULL,
  "brain_verdict" text,
  "brain_plan" jsonb,
  "brain_version" text,
  "evidence_cutoff" timestamptz,
  "model" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "trade_reviews_basis" CHECK ("basis" IN ('chart', 'history')),
  CONSTRAINT "trade_reviews_verdict" CHECK ("brain_verdict" IS NULL OR "brain_verdict" IN ('wejdz', 'czekaj', 'odpusc')),
  -- Jedna ocena na podstawe: ponowne wyslanie podmienia, nie mnozy (ADR-028).
  CONSTRAINT "trade_reviews_trade_basis_uq" UNIQUE ("trade_id", "basis")
);--> statement-breakpoint

CREATE TABLE "trade_rule_checks" (
  "id" serial PRIMARY KEY,
  "review_id" integer NOT NULL REFERENCES "trade_reviews" ("id") ON DELETE CASCADE,
  "rule_id" text NOT NULL,
  -- Kopia tresci reguly z chwili oceny: regula w mozgu moze sie zmienic,
  -- a ocena ma dalej mowic o tym, co faktycznie sprawdzono.
  "rule_text" text NOT NULL,
  "verdict" text NOT NULL,
  "evidence" text,
  "user_verdict" text,
  CONSTRAINT "trade_rule_checks_verdict" CHECK ("verdict" IN ('pass', 'fail', 'na', 'unclear')),
  CONSTRAINT "trade_rule_checks_user_verdict" CHECK ("user_verdict" IS NULL OR "user_verdict" IN ('agree', 'disagree')),
  CONSTRAINT "trade_rule_checks_review_rule_uq" UNIQUE ("review_id", "rule_id")
);--> statement-breakpoint
CREATE INDEX "trade_rule_checks_rule_idx" ON "trade_rule_checks" ("rule_id");--> statement-breakpoint

-- --- ingest_skips: czego klient ma nie wysylac ponownie ---------------------

CREATE TABLE "ingest_skips" (
  "id" serial PRIMARY KEY,
  "external_ref" text NOT NULL,
  "reason" text NOT NULL DEFAULT 'client',
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ingest_skips_reason" CHECK ("reason" IN ('client', 'deleted')),
  CONSTRAINT "ingest_skips_ref_uq" UNIQUE ("external_ref")
);
