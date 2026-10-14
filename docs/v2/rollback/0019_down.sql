-- Cofniecie migracji 0019_auth_events_token_fk.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
-- Nie niszczy danych: usuwa tylko klucz obcy i indeks. Wpisy auth_events zostaja.

DROP INDEX "auth_events_token_idx";
ALTER TABLE "auth_events" DROP CONSTRAINT "auth_events_token_id_fkey";

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787640000000;
