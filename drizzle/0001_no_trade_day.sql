CREATE TYPE "public"."no_trade_reason" AS ENUM('no_setup', 'outside_hours', 'market_conditions', 'day_off', 'planned_break', 'personal', 'other');--> statement-breakpoint
ALTER TABLE "day_notes" ADD COLUMN "no_trade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "day_notes" ADD COLUMN "no_trade_reason" "no_trade_reason";--> statement-breakpoint
CREATE UNIQUE INDEX "day_notes_no_account_idx" ON "day_notes" USING btree ("day") WHERE "day_notes"."account_id" is null;