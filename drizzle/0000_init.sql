CREATE TYPE "public"."account_type" AS ENUM('live', 'demo', 'prop', 'paper');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."field_scope" AS ENUM('trade', 'backtest', 'both');--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('text', 'number', 'select', 'multiselect', 'bool', 'date', 'rating');--> statement-breakpoint
CREATE TYPE "public"."market_session" AS ENUM('premarket', 'rth', 'afterhours', 'overnight');--> statement-breakpoint
CREATE TYPE "public"."screenshot_kind" AS ENUM('before', 'after', 'other');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('running', 'finished', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('planned', 'open', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"starting_balance" bigint DEFAULT 0 NOT NULL,
	"type" "account_type" DEFAULT 'live' NOT NULL,
	"default_risk_pct" numeric(6, 3),
	"default_risk_amount" bigint,
	"description" text,
	"archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"strategy_id" integer,
	"instrument_id" integer,
	"interval" text,
	"data_from" date,
	"data_to" date,
	"starting_balance" bigint DEFAULT 0 NOT NULL,
	"risk_per_trade" bigint,
	"target_trades" integer DEFAULT 100 NOT NULL,
	"status" "session_status" DEFAULT 'running' NOT NULL,
	"assumptions" text,
	"conclusions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "field_type" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min" numeric(18, 6),
	"max" numeric(18, 6),
	"unit" text,
	"hint" text,
	"required" boolean DEFAULT false NOT NULL,
	"in_table" boolean DEFAULT false NOT NULL,
	"in_stats" boolean DEFAULT true NOT NULL,
	"scope" "field_scope" DEFAULT 'both' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"account_id" integer,
	"pre_session" text,
	"post_session" text,
	"mood" smallint,
	"energy" smallint,
	"day_rating" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"exchange" text,
	"tick_size" numeric(18, 8) NOT NULL,
	"tick_value" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"commission_per_contract" bigint DEFAULT 0 NOT NULL,
	"rth_from" text DEFAULT '09:30' NOT NULL,
	"rth_to" text DEFAULT '16:00' NOT NULL,
	"exchange_timezone" text DEFAULT 'America/New_York' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screenshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"kind" "screenshot_kind" DEFAULT 'before' NOT NULL,
	"file" text NOT NULL,
	"thumbnail" text,
	"caption" text,
	"width" integer,
	"height" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text,
	"session_version" integer DEFAULT 1 NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'Europe/Warsaw' NOT NULL,
	"default_risk" bigint DEFAULT 10000 NOT NULL,
	"min_sample" integer DEFAULT 15 NOT NULL,
	"trading_hours_from" text,
	"trading_hours_to" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instrument_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"color" text DEFAULT '#e8a44c' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#8fa3b8' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_tags" (
	"trade_id" integer NOT NULL,
	"tag_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"instrument_id" integer NOT NULL,
	"strategy_id" integer,
	"backtest_session_id" integer,
	"direction" "direction" NOT NULL,
	"status" "trade_status" DEFAULT 'closed' NOT NULL,
	"entry_time" timestamp with time zone NOT NULL,
	"entry_price" numeric(18, 8) NOT NULL,
	"exit_time" timestamp with time zone,
	"exit_price" numeric(18, 8),
	"contracts" numeric(14, 4) NOT NULL,
	"stop_loss" numeric(18, 8),
	"take_profit" numeric(18, 8),
	"mae" numeric(18, 8),
	"mfe" numeric(18, 8),
	"commission" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"execution_rating" smallint,
	"rules_met" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ticks" integer,
	"risk_ticks" integer,
	"pnl_gross" bigint,
	"pnl_net" bigint,
	"risk_amount" bigint,
	"r_multiple" numeric(12, 4),
	"mae_r" numeric(12, 4),
	"mfe_r" numeric(12, 4),
	"duration_s" integer,
	"market_session" "market_session",
	"weekday" smallint,
	"entry_hour" smallint,
	"trading_day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_category_id_tag_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."tag_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_backtest_session_id_backtest_sessions_id_fk" FOREIGN KEY ("backtest_session_id") REFERENCES "public"."backtest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_key_idx" ON "custom_fields" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "day_notes_idx" ON "day_notes" USING btree ("day","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_symbol_idx" ON "instruments" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "screenshots_trade_idx" ON "screenshots" USING btree ("trade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_category_name_idx" ON "tags" USING btree ("category_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_tags_idx" ON "trade_tags" USING btree ("trade_id","tag_id");--> statement-breakpoint
CREATE INDEX "trade_tags_tag_idx" ON "trade_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "trades_entry_idx" ON "trades" USING btree ("entry_time");--> statement-breakpoint
CREATE INDEX "trades_account_idx" ON "trades" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "trades_session_idx" ON "trades" USING btree ("backtest_session_id");--> statement-breakpoint
CREATE INDEX "trades_trading_day_idx" ON "trades" USING btree ("trading_day");--> statement-breakpoint
CREATE INDEX "trades_custom_idx" ON "trades" USING gin ("custom");