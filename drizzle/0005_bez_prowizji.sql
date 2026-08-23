-- Koniec prowizji w modelu (ADR-010). pnl_net i pnl_gross byly ta sama liczba
-- rozjezdzona o prowizje - zostaje jedna kolumna pnl.

-- Rename zamiast drop+add: zachowuje historie kolumny i nie zeruje danych.
ALTER TABLE "trades" RENAME COLUMN "pnl_net" TO "pnl";--> statement-breakpoint

-- Stare trade'y maja pnl policzone z prowizja odjeta (dawne pnl_net).
-- Bez tego przepisania zostalyby po staremu, a kazda kolejna edycja policzylaby
-- je juz bez prowizji - dwa identyczne trade'y pokazywalyby rozny wynik.
UPDATE "trades" SET "pnl" = "pnl_gross" WHERE "pnl_gross" IS NOT NULL;--> statement-breakpoint

-- r_multiple liczony jest z pnl, wiec musi pojsc krok za nim.
UPDATE "trades" SET "r_multiple" = round("pnl"::numeric / "risk_amount", 4)
  WHERE "pnl" IS NOT NULL AND "risk_amount" IS NOT NULL AND "risk_amount" <> 0;--> statement-breakpoint

-- Prowizja znika z modelu - uzytkownik jej nie chce, brutto i netto to byla
-- ta sama liczba.
ALTER TABLE "trades" DROP COLUMN "pnl_gross";--> statement-breakpoint
ALTER TABLE "trades" DROP COLUMN "commission";--> statement-breakpoint
ALTER TABLE "instruments" DROP COLUMN "commission_per_contract";--> statement-breakpoint

-- saved_views.columns trzyma identyfikator kolumny w JSONB - kolumna tabeli
-- zmienila nazwe, wiec zapisane widoki tez musza wskazywac na "pnl".
UPDATE "saved_views" SET "columns" = replace("columns"::text, '"pnlNet"', '"pnl"')::jsonb
 WHERE "columns"::text LIKE '%"pnlNet"%';
