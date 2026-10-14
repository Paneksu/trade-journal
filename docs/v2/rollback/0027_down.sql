-- Cofniecie migracji 0027_mentor_luki.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- !!! NISZCZY DANE: filmy i twierdzenia mentora (mentor_sources, mentor_claims), pytania o luki
-- i sprzecznosci (strategy_gaps) oraz dopiski mentora do notatek (note_additions.origin = 'mentor').
-- Slowa uzytkownika wskazywane przez strategy_gaps.answer_words_id zostaja (user_words).
-- Przed uruchomieniem zrzut bazy (pg_dump).
-- Kolejnosc: odwrotna do tworzenia.

DROP TABLE "strategy_gaps";

-- Dopiski mentora bez twierdzenia nie powinny istniec (CHECK note_additions_mentor to wymuszal).
DELETE FROM "note_additions" WHERE "origin" = 'mentor';
DROP TRIGGER "note_additions_immutable" ON "note_additions";
-- Ochrona z 0020 (bez mentor_claim_id).
CREATE TRIGGER "note_additions_immutable" BEFORE UPDATE ON "note_additions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_columns(
    'id', 'note_id', 'body_md', 'origin', 'evidence', 'suggestion_id', 'created_at'
  );
DROP INDEX "note_additions_claim_idx";
ALTER TABLE "note_additions" DROP CONSTRAINT "note_additions_mentor";
ALTER TABLE "note_additions" DROP COLUMN "mentor_claim_id";

DROP TABLE "mentor_claims";
DROP TABLE "mentor_sources";
DROP FUNCTION public.tj_mentor_claim_hash();

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787720000000;
