-- Cofniecie migracji 0020_proces_playbook.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
-- Najpierw cofnij 0027, 0026, ..., 0021 (tabele z tych migracji wskazuja setups i trades).
--
-- !!! NISZCZY DANE: playbook (setups, setup_versions, setup_examples), powiazania trade'ow z notatkami
-- (trade_note_links: od nich zalezy n hipotez - po cofnieciu tj_hypothesis_n liczy tylko n_imported),
-- kolejke AI (ai_suggestions), dopiski (note_additions), oceny procesu A/B/C
-- (trades.process_grade), przypisania trade'ow do setupow i wersji, trades.day_known oraz
-- rule_versions.decision_reason. Przypisania tagow zatwierdzone z AI (trade_tags.origin = 'ai')
-- ZOSTAJA jako zwykle przypisania uzytkownika (zatwierdzil je w UI).
-- Przed uruchomieniem zrzut bazy (pg_dump). Kolumna generowana trades.search znika razem z indeksem.
-- Kolejnosc: odwrotna do tworzenia.

ALTER TABLE "trade_tags" DROP CONSTRAINT "trade_tags_origin";
ALTER TABLE "trade_tags" DROP COLUMN "origin";

DROP INDEX "trades_process_grade_idx";
DROP INDEX "trades_setup_version_idx";
DROP INDEX "trades_setup_idx";
DROP INDEX "trades_search_idx";
ALTER TABLE "trades" DROP CONSTRAINT "trades_ruleset_version";
ALTER TABLE "trades" DROP CONSTRAINT "trades_process_graded";
ALTER TABLE "trades" DROP CONSTRAINT "trades_process_grade";
ALTER TABLE "trades" DROP COLUMN "search";
ALTER TABLE "trades" DROP COLUMN "day_known";
ALTER TABLE "trades" DROP COLUMN "ruleset_version";
ALTER TABLE "trades" DROP COLUMN "setup_version_id";
ALTER TABLE "trades" DROP COLUMN "setup_id";
ALTER TABLE "trades" DROP COLUMN "process_graded_at";
ALTER TABLE "trades" DROP COLUMN "process_grade";

DROP TABLE "note_additions";
DROP TABLE "ai_suggestions";
DROP TABLE "trade_note_links";
DROP TABLE "setup_examples";
DROP TABLE "setup_versions";
DROP TABLE "setups";

ALTER TABLE "rule_versions" DROP COLUMN "decision_reason";

DROP FUNCTION public.tj_note_addition_insert();
DROP FUNCTION public.tj_ai_suggestion_flow();
DROP FUNCTION public.tj_guard_null_only();

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787650000000;
