-- Czesciowe wyjscia z pozycji - ETAP 1 planu skalowania (2026-08-30).
--
-- Dzis trade ma jedno wyjscie ("trades"."exit_price" / "trades"."exit_time").
-- Ta migracja dodaje "trade_exits" - jedno wejscie moze miec wiele wyjsc
-- czastkowych. Wejscie zostaje jedno; ryzyko poczatkowe (1R) liczy sie dalej
-- z pelnej liczby kontraktow w "trades"."contracts" - to sie NIE zmienia.
--
-- "trades"."exit_price" i "trades"."exit_time" ZOSTAJA w tabeli, ale zmieniaja
-- status na pola POCHODNE: srednia wazona ceny wyjscia i czas ostatniego
-- wyjscia, wyliczane w akcji zapisu z wierszy "trade_exits". Nie sa juz
-- niezaleznym zrodlem prawdy - patrz komentarz w schema.ts.
--
-- SWIADOMIE bez CHECK-a "suma trade_exits.contracts == trades.contracts":
-- Postgres nie wyrazi ograniczenia miedzy tabelami (agregat po drugiej
-- tabeli w CHECK jest zabroniony), a i tak walidacja musi siedziec w akcji
-- zapisu, zeby uzytkownik dostal polski komunikat, a nie surowy blad bazy -
-- ta sama zasada, co przy normalizujKierunek w lib/domain/kierunek.ts.
--
-- Backfill: kazdy istniejacy trade z wypelnionym exit_price dostaje dokladnie
-- jeden wiersz w "trade_exits" (sort_order 0), a "trades"."closed_contracts"
-- i "trades"."exit_count" sa ustawiane tak, jakby ten jeden zapis byl calym
-- wyjsciem - bo byl. "scaling_r" zostaje NULL dla calej historii: kazdy stary
-- trade ma jedno wyjscie, wiec miara "wplyw skalowania" nie ma tam sensu -
-- to poprawny stan, nie brak danych.
--
-- Kwota z rachunku brokera ("trades"."broker_amount") NIE jest kopiowana do
-- wiersza w "trade_exits" - zostaje wylacznie na poziomie trade'a. Gdyby
-- wpisac ja tez do kawalka, przy sumowaniu podwoilaby wynik.
--
-- Warunek "contracts > 0" w backfillu jest bezpiecznikiem, nie filtrem na
-- dane, ktorych sie spodziewamy. Akcja zapisu odrzuca niedodatnia wielkosc
-- pozycji od poczatku istnienia dziennika i w bazie takich wierszy nie ma, ale
-- w "trades" nie ma CHECK-a, ktory by tego pilnowal - a "trade_exits" taki
-- CHECK ma. Jeden odziedziczony wiersz z zerem wywrocilby INSERT, a migrator
-- owija JEDNA transakcja caly przebieg, wiec padloby cale wdrozenie. Taki
-- trade zostaje po prostu bez wiersza-potomka i z exit_count = 0.
--
-- Migracja nie dodaje wartosci do zadnego enuma, wiec pulapka z 0013
-- (migrator owija jedna transakcja caly przebieg zaleglych plikow) tu nie
-- gryzie - CREATE TABLE, ALTER TABLE ADD COLUMN i UPDATE moga bezpiecznie
-- isc w jednej transakcji.

CREATE TABLE "trade_exits" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"exit_time" timestamp with time zone,
	"exit_price" numeric(18, 8) NOT NULL,
	"contracts" numeric(14, 4) NOT NULL,
	"broker_amount" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_trade_id_trades_id_fk"
	FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "trade_exits_trade_idx" ON "trade_exits" USING btree ("trade_id");--> statement-breakpoint

ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_kontrakty" CHECK ("contracts" > 0);--> statement-breakpoint

ALTER TABLE "trades" ADD COLUMN "closed_contracts" numeric(14, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "scaling_r" numeric(12, 4);--> statement-breakpoint

-- Backfill: kazdy trade zamkniety pojedynczym wyjsciem dostaje dokladnie
-- jeden wiersz-potomek. Kwota brokera zostaje na trade'cie, nie schodzi tu.
INSERT INTO "trade_exits" ("trade_id", "sort_order", "exit_time", "exit_price", "contracts", "broker_amount")
SELECT "id", 0, "exit_time", "exit_price", "contracts", NULL
FROM "trades"
WHERE "exit_price" IS NOT NULL AND "contracts" > 0;--> statement-breakpoint

UPDATE "trades"
SET "closed_contracts" = "contracts", "exit_count" = 1
WHERE "exit_price" IS NOT NULL AND "contracts" > 0;--> statement-breakpoint

CREATE INDEX "trades_skalowanie_idx" ON "trades" USING btree ("exit_count") WHERE "exit_count" > 1;
