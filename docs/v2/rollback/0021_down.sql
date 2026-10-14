-- Cofniecie migracji 0021_plan_werdykt.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- !!! NISZCZY DANE: plany zamrozone (trade_plans) z dopiskami (trade_plan_addenda), korekty
-- uzytkownika do werdyktow AI (trade_reviews.kind = 'user_override' razem z ich sprawdzeniami),
-- kolumny as_of / evidence_hash / evidence_manifest / ruleset_version / kind / overrides_review_id /
-- created_by_token_id werdyktow, trade_rule_checks.rule_version_id oraz rytual dnia
-- (day_notes.bias, max_trades, sleep). Przed uruchomieniem zrzut bazy (pg_dump).
--
-- Przywraca stary unikat trade_reviews_trade_basis_uq UNIQUE (trade_id, basis). Wiersze kind = 'ai'
-- go spelniaja (czesciowy unikat gwarantowal to samo), a korekty (kind = 'user_override') kasujemy
-- wczesniej, bo nie zmieszcza sie w starym unikacie. CHECK-i 1-5 na day_notes.mood / energy /
-- day_rating znikaja (z NOT VALID albo po walidacji).
-- Kolejnosc: odwrotna do tworzenia.

-- day_notes
ALTER TABLE "day_notes" DROP CONSTRAINT "day_notes_day_rating";
ALTER TABLE "day_notes" DROP CONSTRAINT "day_notes_energy";
ALTER TABLE "day_notes" DROP CONSTRAINT "day_notes_mood";
ALTER TABLE "day_notes" DROP CONSTRAINT "day_notes_sleep";
ALTER TABLE "day_notes" DROP CONSTRAINT "day_notes_max_trades";
ALTER TABLE "day_notes" DROP CONSTRAINT "day_notes_bias";
ALTER TABLE "day_notes" DROP COLUMN "sleep";
ALTER TABLE "day_notes" DROP COLUMN "max_trades";
ALTER TABLE "day_notes" DROP COLUMN "bias";

-- trade_rule_checks
DROP TRIGGER "trade_rule_checks_guard" ON "trade_rule_checks";
DROP INDEX "trade_rule_checks_rule_version_idx";
ALTER TABLE "trade_rule_checks" DROP COLUMN "rule_version_id";

-- trade_reviews
DROP TRIGGER "trade_reviews_immutable" ON "trade_reviews";
DROP TRIGGER "trade_reviews_override_check" ON "trade_reviews";
DELETE FROM "trade_reviews" WHERE "kind" = 'user_override';
DROP INDEX "trade_reviews_overrides_idx";
DROP INDEX "trade_reviews_trade_idx";
DROP INDEX "trade_reviews_trade_basis_uq";
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_trade_basis_uq" UNIQUE ("trade_id", "basis");
ALTER TABLE "trade_reviews" DROP CONSTRAINT "trade_reviews_ruleset";
ALTER TABLE "trade_reviews" DROP CONSTRAINT "trade_reviews_override_dated";
ALTER TABLE "trade_reviews" DROP CONSTRAINT "trade_reviews_manifest";
ALTER TABLE "trade_reviews" DROP CONSTRAINT "trade_reviews_evidence_hash";
ALTER TABLE "trade_reviews" DROP CONSTRAINT "trade_reviews_as_of_hash";
ALTER TABLE "trade_reviews" DROP CONSTRAINT "trade_reviews_override";
ALTER TABLE "trade_reviews" DROP CONSTRAINT "trade_reviews_kind";
ALTER TABLE "trade_reviews" DROP COLUMN "created_by_token_id";
ALTER TABLE "trade_reviews" DROP COLUMN "ruleset_version";
ALTER TABLE "trade_reviews" DROP COLUMN "evidence_manifest";
ALTER TABLE "trade_reviews" DROP COLUMN "evidence_hash";
ALTER TABLE "trade_reviews" DROP COLUMN "as_of";
ALTER TABLE "trade_reviews" DROP COLUMN "overrides_review_id";
ALTER TABLE "trade_reviews" DROP COLUMN "kind";

-- plany
DROP TABLE "trade_plan_addenda";
DROP TABLE "trade_plans";

DROP FUNCTION public.tj_rule_check_guard();
DROP FUNCTION public.tj_review_override_check();
DROP FUNCTION public.tj_plan_guard();

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787660000000;
