-- Wynik netto (ADR-034, etap A, 2026-10-16). Slowa uzytkownika: «wynik trade'a powinien byc taki, jaki faktycznie jest
-- prawdziwy, czyli powinien odzwierciedlac to, ile zarobilem po oplatach i wszelkich innych kosztach. wynik ma byc po
-- prostu prawdziwy». Zmienia ADR-010 (prowizja poza modelem): od teraz `trades.pnl` to wynik NETTO.
--
-- Co robi ta migracja (tylko DODAJE; zadnego istniejacego wiersza nie przelicza):
--   * trades.fees          - oplaty w centach (stawka x zamkniete kontrakty albo suma z rachunku). NULL = oplaty nieznane
--                            (historia sprzed 0030 albo brak stawki dla konta); NIE znaczy "zero".
--   * trades.pnl_estimate  - wynik wyliczony z cen trade'a minus oplaty (liczy computeTrade, zapisuje persistTrade).
--                            "wyliczony" vs "z rachunku" wynika z broker_amount IS NULL, bez osobnej kolumny.
--   * instruments.size_class - mini / micro, bo stawka oplaty zalezy od klasy kontraktu. Wypelnione po symbolu dla
--                            instrumentow istniejacych w chwili migracji (symbole M-prefiksowe z seeda = micro, reszta = mini);
--                            nowe instrumenty dostaja wartosc z seeda albo od uzytkownika (NULL = brak stawki).
--   * stawki oplat (round turn: prowizja + gielda + NFA za kontrakt w obie strony, w centach) w prop_firm_presets,
--     prop_rules (kopia presetu, edytowalna) i accounts (konta inne niz prop). Dane stawek z badania: migracja 0032.
-- Historii NIE przeliczamy w migracji: zmienialaby wyniki bez decyzji. W aplikacji jest przycisk "Przelicz historie
-- z oplatami" z podgladem (Slowa uzytkownika 16.10.2026: «Przycisk z podgladem»), ktory dotyka tylko trade'ow bez
-- kwoty z rachunku.
-- Cofniecie: docs/v2/rollback/0030_down.sql (kasuje te kolumny razem z ich wartosciami).
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

ALTER TABLE "trades" ADD COLUMN "fees" bigint;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "pnl_estimate" bigint;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_fees" CHECK ("fees" IS NULL OR "fees" >= 0);--> statement-breakpoint

ALTER TABLE "instruments" ADD COLUMN "size_class" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_size_class" CHECK ("size_class" IS NULL OR "size_class" IN ('mini', 'micro'));--> statement-breakpoint
UPDATE "instruments" SET "size_class" = CASE
  WHEN "symbol" IN ('MES', 'MNQ', 'MYM', 'M2K', 'MCL', 'MGC', 'MBT', 'MET', 'M6E', 'M6B', 'M6A') THEN 'micro'
  ELSE 'mini'
END;--> statement-breakpoint

ALTER TABLE "prop_firm_presets" ADD COLUMN "fee_rt_mini_cents" bigint;--> statement-breakpoint
ALTER TABLE "prop_firm_presets" ADD COLUMN "fee_rt_micro_cents" bigint;--> statement-breakpoint
ALTER TABLE "prop_firm_presets" ADD COLUMN "fee_source_url" text;--> statement-breakpoint
ALTER TABLE "prop_firm_presets" ADD CONSTRAINT "prop_firm_presets_fee_mini" CHECK ("fee_rt_mini_cents" IS NULL OR "fee_rt_mini_cents" >= 0);--> statement-breakpoint
ALTER TABLE "prop_firm_presets" ADD CONSTRAINT "prop_firm_presets_fee_micro" CHECK ("fee_rt_micro_cents" IS NULL OR "fee_rt_micro_cents" >= 0);--> statement-breakpoint
ALTER TABLE "prop_firm_presets" ADD CONSTRAINT "prop_firm_presets_fee_source_url" CHECK ("fee_source_url" IS NULL OR "fee_source_url" ~ '^https://');--> statement-breakpoint

ALTER TABLE "prop_rules" ADD COLUMN "fee_rt_mini_cents" bigint;--> statement-breakpoint
ALTER TABLE "prop_rules" ADD COLUMN "fee_rt_micro_cents" bigint;--> statement-breakpoint
ALTER TABLE "prop_rules" ADD COLUMN "fee_source_url" text;--> statement-breakpoint
ALTER TABLE "prop_rules" ADD CONSTRAINT "prop_rules_fee_mini" CHECK ("fee_rt_mini_cents" IS NULL OR "fee_rt_mini_cents" >= 0);--> statement-breakpoint
ALTER TABLE "prop_rules" ADD CONSTRAINT "prop_rules_fee_micro" CHECK ("fee_rt_micro_cents" IS NULL OR "fee_rt_micro_cents" >= 0);--> statement-breakpoint
ALTER TABLE "prop_rules" ADD CONSTRAINT "prop_rules_fee_source_url" CHECK ("fee_source_url" IS NULL OR "fee_source_url" ~ '^https://');--> statement-breakpoint

ALTER TABLE "accounts" ADD COLUMN "fee_rt_mini_cents" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "fee_rt_micro_cents" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_fee_mini" CHECK ("fee_rt_mini_cents" IS NULL OR "fee_rt_mini_cents" >= 0);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_fee_micro" CHECK ("fee_rt_micro_cents" IS NULL OR "fee_rt_micro_cents" >= 0);
