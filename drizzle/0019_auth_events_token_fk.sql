-- Klucz obcy auth_events.token_id -> api_tokens.id (docs/v2/model-danych.md, sekcja 9).
--
-- Dlaczego osobna migracja: model kazal dolozyc ten FK w 0017, ale 0016 (faza 1, tabela
-- auth_events) i 0017 (faza 2, tabela api_tokens) powstaly na osobnych galeziach, a po
-- scaleniu obie sa juz w historii i nie wolno ich edytowac (migrator liczy SHA-256 z bajtow).
--
-- NO ACTION: tokenow sie nie kasuje (uniewaznia), a dziennik zdarzen jest tylko do dopisywania
-- (trigger tj_forbid_update), wiec wiersza auth_events nie da sie "wyzerowac" przez SET NULL.
-- Do tej pory token_id w auth_events bylo zawsze NULL (nie istnialy tokeny), wiec dodanie FK
-- na istniejacych danych nie moze sie nie udac.
--
-- Cofniecie: docs/v2/rollback/0019_down.sql.

ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_token_id_fkey"
  FOREIGN KEY ("token_id") REFERENCES "api_tokens" ("id") ON DELETE NO ACTION;--> statement-breakpoint
CREATE INDEX "auth_events_token_idx" ON "auth_events" ("token_id") WHERE "token_id" IS NOT NULL;
