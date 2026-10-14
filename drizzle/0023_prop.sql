-- Modul prop: presety firm, reguly konta, ksiega kosztow (ADR-033, faza 2b, 2026-10-15).
-- Projekt: docs/v2/model-danych.md, sekcja 5.6; odstepstwa: sekcja 14. Dane presetow: 0024 (tylko dane).
-- Cofniecie: docs/v2/rollback/0023_down.sql. Zaleznosci: tylko accounts (0000).
-- Wszystkie kwoty w centach (bigint). Bufory i ostrzezenia liczy lib/domain/prop.ts, nie baza.
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

CREATE TABLE "prop_firm_presets" (
  "id" serial PRIMARY KEY,
  "firm" text NOT NULL,
  "program" text NOT NULL,
  "phase" text NOT NULL,
  "account_size_cents" bigint NOT NULL,
  -- eod = trailing po zamknieciu dnia bez znanego punktu blokady; intraday; static; trailing_to_static.
  "dd_type" text NOT NULL,
  "max_dd_cents" bigint NOT NULL,
  -- trailing_to_static: przy jakim zysku DD staje w miejscu.
  "dd_lock_cents" bigint,
  "daily_loss_cents" bigint,
  "profit_target_cents" bigint,
  "consistency_pct" numeric(5,2),
  "min_days" smallint,
  "max_contracts_mini" smallint,
  "max_contracts_micro" smallint,
  "source_url" text NOT NULL,
  -- Data odczytu regulaminu.
  "read_on" date NOT NULL,
  "effective_from" date,
  -- [DO WERYFIKACJI] przy sprzecznych zrodlach; ma byc WIDOCZNE w UI.
  "needs_verification" boolean NOT NULL DEFAULT true,
  -- Reguly pokazywane, ale nieliczone (newsy, skalowanie, podstawa trailingu, ...).
  "extra" jsonb NOT NULL DEFAULT '{}',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "prop_firm_presets_firm" CHECK (length("firm") > 0 AND length("program") > 0),
  CONSTRAINT "prop_firm_presets_phase" CHECK ("phase" IN ('eval', 'funded')),
  CONSTRAINT "prop_firm_presets_account_size" CHECK ("account_size_cents" > 0),
  CONSTRAINT "prop_firm_presets_dd_type" CHECK ("dd_type" IN ('eod', 'intraday', 'static', 'trailing_to_static')),
  CONSTRAINT "prop_firm_presets_max_dd" CHECK ("max_dd_cents" > 0),
  CONSTRAINT "prop_firm_presets_dd_lock" CHECK ("dd_type" <> 'trailing_to_static' OR "dd_lock_cents" IS NOT NULL),
  CONSTRAINT "prop_firm_presets_daily_loss" CHECK ("daily_loss_cents" IS NULL OR "daily_loss_cents" > 0),
  CONSTRAINT "prop_firm_presets_profit_target" CHECK ("profit_target_cents" IS NULL OR "profit_target_cents" > 0),
  CONSTRAINT "prop_firm_presets_consistency" CHECK ("consistency_pct" IS NULL OR ("consistency_pct" > 0 AND "consistency_pct" <= 100)),
  CONSTRAINT "prop_firm_presets_min_days" CHECK ("min_days" IS NULL OR "min_days" > 0),
  CONSTRAINT "prop_firm_presets_contracts" CHECK (
    ("max_contracts_mini" IS NULL OR "max_contracts_mini" > 0) AND ("max_contracts_micro" IS NULL OR "max_contracts_micro" > 0)
  ),
  CONSTRAINT "prop_firm_presets_source_url" CHECK ("source_url" ~ '^https://'),
  CONSTRAINT "prop_firm_presets_extra" CHECK (jsonb_typeof("extra") = 'object'),
  -- Kolejny odczyt tego samego programu to nowy wiersz z nowym read_on. Unikat zaczyna sie od
  -- (firm, program, phase), wiec obsluguje tez wybor presetu w UI (firma -> program -> faza);
  -- osobny indeks pod wybor bylby zbedny.
  CONSTRAINT "prop_firm_presets_uq" UNIQUE ("firm", "program", "phase", "account_size_cents", "read_on")
);--> statement-breakpoint

-- Regula konta: kopia presetu, KAZDA wartosc nadpisywalna zwyklym UPDATE (UI / API). Obowiazuje
-- najnowsza regula z valid_from <= dzien; valid_from = data zakupu konta albo zmiany regulaminu.
CREATE TABLE "prop_rules" (
  "id" serial PRIMARY KEY,
  "account_id" integer NOT NULL REFERENCES "accounts" ("id") ON DELETE CASCADE,
  -- SET NULL: preset mozna usunac, regula konta zostaje (to jej kopia). prop_rules nie jest niezmienna.
  "preset_id" integer REFERENCES "prop_firm_presets" ("id") ON DELETE SET NULL,
  "valid_from" date NOT NULL,
  "dd_type" text NOT NULL,
  "max_dd_cents" bigint NOT NULL,
  "dd_lock_cents" bigint,
  "daily_loss_cents" bigint,
  "profit_target_cents" bigint,
  "consistency_pct" numeric(5,2),
  "min_days" smallint,
  "max_contracts_mini" smallint,
  "max_contracts_micro" smallint,
  "source_url" text,
  -- Kopia presetu.extra (trail_basis, consistency_basis, consistency_effect, dll_optional_usd, ...).
  "extra" jsonb NOT NULL DEFAULT '{}',
  -- Uzytkownik potwierdzil wartosci z regulaminem (metodyka R29).
  "confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "prop_rules_dd_type" CHECK ("dd_type" IN ('eod', 'intraday', 'static', 'trailing_to_static')),
  CONSTRAINT "prop_rules_max_dd" CHECK ("max_dd_cents" > 0),
  CONSTRAINT "prop_rules_dd_lock" CHECK ("dd_type" <> 'trailing_to_static' OR "dd_lock_cents" IS NOT NULL),
  CONSTRAINT "prop_rules_daily_loss" CHECK ("daily_loss_cents" IS NULL OR "daily_loss_cents" > 0),
  CONSTRAINT "prop_rules_profit_target" CHECK ("profit_target_cents" IS NULL OR "profit_target_cents" > 0),
  CONSTRAINT "prop_rules_consistency" CHECK ("consistency_pct" IS NULL OR ("consistency_pct" > 0 AND "consistency_pct" <= 100)),
  CONSTRAINT "prop_rules_min_days" CHECK ("min_days" IS NULL OR "min_days" > 0),
  CONSTRAINT "prop_rules_contracts" CHECK (
    ("max_contracts_mini" IS NULL OR "max_contracts_mini" > 0) AND ("max_contracts_micro" IS NULL OR "max_contracts_micro" > 0)
  ),
  CONSTRAINT "prop_rules_source_url" CHECK ("source_url" IS NULL OR "source_url" ~ '^https://'),
  CONSTRAINT "prop_rules_extra" CHECK (jsonb_typeof("extra") = 'object'),
  -- Unikat zaczyna sie od account_id: obsluguje kaskade z kasowania konta i wybor reguly na dzien.
  CONSTRAINT "prop_rules_account_valid_uq" UNIQUE ("account_id", "valid_from")
);--> statement-breakpoint
-- Zerowanie preset_id przy kasowaniu presetu.
CREATE INDEX "prop_rules_preset_idx" ON "prop_rules" ("preset_id") WHERE "preset_id" IS NOT NULL;--> statement-breakpoint

-- Ksiega kosztow i wyplat konta prop. Znak kwoty: koszt < 0, wplyw > 0.
CREATE TABLE "prop_ledger" (
  "id" serial PRIMARY KEY,
  -- RESTRICT: konta z ksiega sie archiwizuje, nie kasuje.
  "account_id" integer NOT NULL REFERENCES "accounts" ("id") ON DELETE RESTRICT,
  "kind" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  "occurred_on" date NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "prop_ledger_kind" CHECK ("kind" IN ('eval_fee', 'reset_fee', 'activation_fee', 'subscription', 'data_fee', 'payout', 'refund', 'other')),
  CONSTRAINT "prop_ledger_amount" CHECK ("amount_cents" <> 0),
  -- payout i refund to wplywy (> 0), pozostale rodzaje poza 'other' to koszty (< 0).
  CONSTRAINT "prop_ledger_sign" CHECK ("kind" = 'other' OR (("kind" IN ('payout', 'refund')) = ("amount_cents" > 0)))
);--> statement-breakpoint
CREATE INDEX "prop_ledger_account_idx" ON "prop_ledger" ("account_id", "occurred_on");
