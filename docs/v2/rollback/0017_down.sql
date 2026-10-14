-- Cofniecie migracji 0017_api_tokens.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- !!! NISZCZY DANE: wszystkie tokeny urzadzen i kody logowania. Po cofnieciu urzadzenia z `tj`
-- musza zalogowac sie od nowa. Przed uruchomieniem zrzut bazy (pg_dump).
-- Najpierw cofnij 0018 (jej tabele maja FK do api_tokens), a jesli po scaleniu z faza 1
-- istnieje FK auth_events.token_id -> api_tokens, usun go przed DROP TABLE:
--   ALTER TABLE "auth_events" DROP CONSTRAINT "auth_events_token_id_fkey";

DROP TABLE "device_codes";
DROP TABLE "api_tokens";

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787620000000;
