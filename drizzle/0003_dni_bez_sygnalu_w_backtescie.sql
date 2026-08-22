DROP INDEX "day_notes_idx";--> statement-breakpoint
DROP INDEX "day_notes_no_account_idx";--> statement-breakpoint
ALTER TABLE "day_notes" ADD COLUMN "backtest_session_id" integer;--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_backtest_session_id_backtest_sessions_id_fk" FOREIGN KEY ("backtest_session_id") REFERENCES "public"."backtest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_notes_session_idx" ON "day_notes" USING btree ("day","backtest_session_id") WHERE "day_notes"."backtest_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "day_notes_idx" ON "day_notes" USING btree ("day","account_id") WHERE "day_notes"."backtest_session_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "day_notes_no_account_idx" ON "day_notes" USING btree ("day") WHERE "day_notes"."account_id" is null and "day_notes"."backtest_session_id" is null;