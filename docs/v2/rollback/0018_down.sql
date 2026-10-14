-- Cofniecie migracji 0018_notatki.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- !!! NISZCZY DANE: notatki, rewizje, linki, slowa uzytkownika, reguly, wersje regul,
-- hipotezy i zrzuty podpiete pod notatki. Przed uruchomieniem zrzut bazy (pg_dump).
-- Nie dotyka: rozszerzen unaccent / pg_trgm i funkcji tj_forbid_update (moga nalezec do
-- innych migracji; patrz zakomentowane linie na koncu).
-- Kolejnosc: odwrotna do tworzenia. Nie ma kaskad - jesli cos zalezy od tych obiektow,
-- DROP padnie i nic sie nie zmieni (transakcja).

ALTER TABLE "settings" DROP CONSTRAINT "settings_ruleset_version";
ALTER TABLE "settings" DROP COLUMN "ruleset_version";

DROP INDEX "screenshots_note_idx";
DELETE FROM "screenshots" WHERE "note_id" IS NOT NULL;
ALTER TABLE "screenshots" DROP CONSTRAINT "screenshots_owner";
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_owner"
  CHECK (("screenshots"."trade_id" is null) != ("screenshots"."day_note_id" is null));
ALTER TABLE "screenshots" DROP CONSTRAINT "screenshots_sha256";
ALTER TABLE "screenshots" DROP COLUMN "chart_state";
ALTER TABLE "screenshots" DROP COLUMN "captured_at";
ALTER TABLE "screenshots" DROP COLUMN "sha256";
ALTER TABLE "screenshots" DROP COLUMN "note_id";

DROP TABLE "rule_versions";
DROP TABLE "rules";
DROP TABLE "hypotheses";
DROP TABLE "user_words";
DROP TABLE "note_links";
DROP TABLE "note_revisions";
DROP TABLE "notes";

DROP FUNCTION public.tj_rule_version_gate();
DROP FUNCTION public.tj_hypothesis_n(integer);
DROP FUNCTION public.tj_user_words_hash();
DROP FUNCTION public.tj_note_revision();
DROP FUNCTION public.tj_require_ui_actor();
DROP FUNCTION public.tj_guard_columns();
DROP FUNCTION public.f_unaccent(text);

-- Tylko jesli 0016 nie jest zaaplikowane (tam tez uzywa jej auth_events):
-- DROP FUNCTION public.tj_forbid_update();
-- Tylko jesli rozszerzenia nie istnialy przed 0018 i nic innego z nich nie korzysta:
-- DROP EXTENSION pg_trgm;
-- DROP EXTENSION unaccent;

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787630000000;
