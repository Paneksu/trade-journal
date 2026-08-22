ALTER TABLE "screenshots" ALTER COLUMN "trade_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "screenshots" ADD COLUMN "day_note_id" integer;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_day_note_id_day_notes_id_fk" FOREIGN KEY ("day_note_id") REFERENCES "public"."day_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screenshots_day_note_idx" ON "screenshots" USING btree ("day_note_id");--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_owner" CHECK (("screenshots"."trade_id" is null) != ("screenshots"."day_note_id" is null));