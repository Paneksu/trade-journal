-- Kierunek trafiony mimo zlej egzekucji (ADR-018).
--
-- Prawdziwe kolumny w "trades", nie pole wlasne w JSONB: te liczby wchodza do
-- statystyk, do filtrow SQL i do wymiarow Edge Findera, a JSONB nie da sie na
-- to sensownie zindeksowac ani porownac liczbowo.

CREATE TYPE "bad_execution_reason" AS ENUM ('unnecessary_be', 'unnecessary_sl', 'early_exit');--> statement-breakpoint

-- NULL znaczy "nieocenione", nie "kierunek chybiony". Trade sprzed tej zmiany
-- nie ma prawa psuc trafnosci tylko dlatego, ze nikt go nie przejrzal.
ALTER TABLE "trades" ADD COLUMN "direction_correct" boolean;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "bad_execution_reason" "bad_execution_reason";--> statement-breakpoint

-- Zasieg, jaki cena faktycznie osiagnela, w R. To NIE jest "mfe_r": MFE mierzy
-- ruch w trakcie trwania pozycji, a potencjal - ruch calego zagrania, czesto
-- juz po wyjsciu. Mylenie ich odbiera sens metryce "utracone R" (ADR-018).
ALTER TABLE "trades" ADD COLUMN "potential_r" numeric(12,4);--> statement-breakpoint

-- Powod i potencjal maja sens wylacznie przy trafionym kierunku. Wygranej nie
-- zapisujemy: "zysk => kierunek trafiony" wyprowadza lib/domain/kierunek.ts,
-- bo prog BE jest ustawieniem i denormalizacja rozjechalaby sie po jego
-- zmianie (ADR-011).
ALTER TABLE "trades" ADD CONSTRAINT "trades_kierunek" CHECK (
  ("bad_execution_reason" IS NULL AND "potential_r" IS NULL) OR "direction_correct" IS TRUE
);--> statement-breakpoint

CREATE INDEX "trades_direction_correct_idx"
  ON "trades" ("direction_correct") WHERE "direction_correct" IS NOT NULL;
