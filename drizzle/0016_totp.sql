-- Faza 1 (R1): drugi skladnik logowania TOTP, kody zapasowe, dziennik zdarzen
-- bezpieczenstwa (ADR-031, docs/v2/model-danych.md, sekcja 3). Pisana recznie, LF.
--
-- Wszystko dokladane, nic nie przepisywane: dopoki ktos nie wlaczy 2FA, kolumny
-- zostaja NULL i logowanie dziala jak dotad.
--
-- Wdrozonego pliku nie wolno edytowac (nawet komentarza ani koncowek linii):
-- migrator liczy SHA-256 z bajtow.

-- --- settings: sekret TOTP --------------------------------------------------

ALTER TABLE "settings" ADD COLUMN "totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "totp_enabled_at" timestamptz;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_totp_zgodne" CHECK (("totp_secret_enc" IS NULL) = ("totp_enabled_at" IS NULL));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_totp_krok" CHECK ("totp_secret_enc" IS NOT NULL OR "totp_last_step" IS NULL);--> statement-breakpoint

-- --- funkcja dla tabel tylko-do-dopisywania ---------------------------------
-- Kod bledu TJ409 mapuje sie na HTTP 409 (model-danych.md, sekcja 2).

CREATE FUNCTION "tj_forbid_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % jest tylko do dopisywania, UPDATE jest zabroniony.', TG_TABLE_NAME USING ERRCODE = 'TJ409';
END;
$$;--> statement-breakpoint

-- --- kody zapasowe ----------------------------------------------------------
-- W bazie lezy HMAC-SHA256 kodu, nigdy kod. Nowa paczka kasuje stara w tej samej transakcji.

CREATE TABLE "auth_backup_codes" (
  "id" serial PRIMARY KEY,
  "code_hmac" text NOT NULL,
  "batch" integer NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "auth_backup_codes_code_hmac_unique" UNIQUE ("code_hmac"),
  CONSTRAINT "auth_backup_codes_hmac_format" CHECK ("code_hmac" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "auth_backup_codes_batch_idx" ON "auth_backup_codes" ("batch") WHERE "used_at" IS NULL;--> statement-breakpoint

-- --- dziennik zdarzen bezpieczenstwa (tylko dopisywanie) --------------------
-- token_id bez klucza obcego: api_tokens powstaje w 0017, tam dojdzie FK.

CREATE TABLE "auth_events" (
  "id" serial PRIMARY KEY,
  "at" timestamptz NOT NULL DEFAULT now(),
  "kind" text NOT NULL,
  "ip" text,
  "user_agent" text,
  "token_id" integer,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "auth_events_kind" CHECK ("kind" IN ('login_ok', 'login_fail', 'totp_ok', 'totp_fail', 'backup_code_used', 'sudo', 'totp_enabled', 'totp_disabled', 'backup_codes_regenerated', 'password_changed', 'device_requested', 'device_approved', 'device_denied', 'token_created', 'token_revoked', 'logout_all'))
);--> statement-breakpoint
CREATE INDEX "auth_events_at_idx" ON "auth_events" ("at" DESC);--> statement-breakpoint
CREATE INDEX "auth_events_kind_at_idx" ON "auth_events" ("kind", "at" DESC);--> statement-breakpoint
CREATE TRIGGER "auth_events_bez_update" BEFORE UPDATE ON "auth_events" FOR EACH ROW EXECUTE FUNCTION "tj_forbid_update"();
