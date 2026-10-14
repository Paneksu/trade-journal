-- Cofniecie migracji 0025_przeglad_tygodnia.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- !!! NISZCZY DANE: przeglady tygodnia (weekly_reviews) razem ze szkicami, liczbami i rozliczeniem
-- zobowiazan. Slowa uzytkownika (user_words) zostaja. Przed uruchomieniem zrzut bazy (pg_dump).

DROP TABLE "weekly_reviews";
DROP FUNCTION public.tj_weekly_prev_check();

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787700000000;
