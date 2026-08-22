WITH kolejnosc AS (
	SELECT id, row_number() OVER (
		PARTITION BY trade_id
		ORDER BY CASE "kind" WHEN 'before' THEN 0 WHEN 'after' THEN 1 ELSE 2 END,
		         "sort_order", id
	) - 1 AS nowy
	FROM "screenshots"
	WHERE "trade_id" IS NOT NULL
)
UPDATE "screenshots" s SET "sort_order" = k.nowy FROM kolejnosc k WHERE s.id = k.id;--> statement-breakpoint
ALTER TABLE "screenshots" DROP COLUMN "kind";--> statement-breakpoint
DROP TYPE "public"."screenshot_kind";
