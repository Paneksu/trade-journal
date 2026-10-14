-- Cofniecie migracji 0026_profil_wykres.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- !!! NISZCZY DANE: rysunki z wykresu (chart_annotations), slownik tradera (profile_terms,
-- profile_term_sources) i rejestr poprawek interpretacji (interpretation_corrections).
-- Slowa uzytkownika (user_words) zostaja. Przed uruchomieniem zrzut bazy (pg_dump).
-- Kolejnosc: odwrotna do tworzenia (poprawki wskazuja termin).

DROP TABLE "interpretation_corrections";
DROP TABLE "profile_term_sources";
DROP TABLE "profile_terms";
DROP TABLE "chart_annotations";

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787710000000;
