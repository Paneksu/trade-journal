-- Samopoczucie i gotowosc zamiast pola wlasnego "nastroj" (2026-08-29).
--
-- Prawdziwe kolumny w "trades", nie pole wlasne w JSONB: gotowosc ma byc
-- wymiarem statystyk i ma sie dac porownac liczbowo, a lista czterech nastrojow
-- do wyboru nie miescila tego, co uzytkownik chce zapisac.
--
-- Migracja NIE kasuje zadnych danych trade'ow. Kolumny "execution_rating",
-- "strategy_id" i "rules_met" zostaja nietkniete, mimo ze formularz przestal
-- je wypelniac - historia ma sie nie zgubic. Kasujemy wylacznie DEFINICJE
-- trzech pol wlasnych; ich wartosci zostaja w "trades"."custom".

ALTER TABLE "trades" ADD COLUMN "mood_note" text;--> statement-breakpoint

-- NULL znaczy "nie oceniono", nie "zero gotowosci". Trade sprzed tej zmiany
-- nie ma prawa wpasc do najgorszego kubelka tylko dlatego, ze pola nie bylo.
ALTER TABLE "trades" ADD COLUMN "readiness" smallint;--> statement-breakpoint

-- Suwak w formularzu ma min/max, ale walidacja w przegladarce nie jest
-- zabezpieczeniem - prog musi byc powtorzony po stronie bazy.
ALTER TABLE "trades" ADD CONSTRAINT "trades_readiness" CHECK (
  "readiness" IS NULL OR ("readiness" BETWEEN 1 AND 10)
);--> statement-breakpoint

-- Trzy pola wlasne znikaja z formularza. "nastroj" zastapily kolumny wyzej,
-- "jakosc_wejscia" i "plan_zrealizowany" uzytkownik odrzucil - wypelniane po
-- fakcie mowily wiecej o wyniku niz o decyzji. Wartosci zostaja w JSONB.
DELETE FROM "custom_fields" WHERE "key" IN ('nastroj', 'jakosc_wejscia', 'plan_zrealizowany');--> statement-breakpoint

-- Nowa kategoria tagow: nazwa typu trade'a. Bez interwalu - chipy warstw ma
-- wylacznie "confluence". ON CONFLICT, bo baza jest juz zasiana, a ta sama
-- kategoria wchodzi tez przez seed-data.ts przy swiezej instalacji.
INSERT INTO "tag_categories" ("name", "key", "description", "sort_order")
VALUES ('Styl wejścia', 'entry_style', 'Jak nazywasz ten typ trade''a. Bez interwału.', 15)
ON CONFLICT ("key") DO NOTHING;
