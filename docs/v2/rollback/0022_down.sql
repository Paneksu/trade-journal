-- Cofniecie migracji 0022_hipotezy_warianty.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- !!! NISZCZY DANE: zarejestrowane warianty (hypothesis_variants) i log zmian progow
-- (threshold_changes). Po cofnieciu licznik testowanych wariantow zaczyna od zera, a zmiany progow
-- przestaja byc logowane. Przed uruchomieniem zrzut bazy (pg_dump).

DROP TRIGGER "hypotheses_threshold_log" ON "hypotheses";
DROP FUNCTION public.tj_log_threshold_change();
DROP TABLE "threshold_changes";
DROP TABLE "hypothesis_variants";

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787670000000;
