-- API v2: tokeny urzadzen i logowanie kodem urzadzenia (ADR-030, 2026-10-14).
-- Projekt: docs/v2/model-danych.md, sekcja 4.0.
--
-- Wszystko dokladane, nic nie przepisywane. Cofniecie: docs/v2/rollback/0017_down.sql.
--
-- Kopia bazy przed wdrozeniem NIE jest wymagana przez sama migracje (same nowe
-- tabele), ale jest wymagana przez wydanie R2 jako calosc (STOP z planu).
--
-- FK auth_events.token_id -> api_tokens.id: migracja 0019_auth_events_token_fk (0016 i 0017 powstaly
-- na osobnych galeziach, wiec klucz obcy dochodzi osobna migracja po scaleniu).
--
-- Tokenow sie nie kasuje, tylko uniewaznia (revoked_at): wskazuja na nie
-- created_by_token_id w tabelach niezmiennych, a FK do nich jest NO ACTION.
--
-- Zapis last_used_at / last_used_ip: najwyzej raz na minute. Wystarcza do tego
-- ta sama instrukcja po stronie API, bez dodatkowej kolumny ani triggera:
--   UPDATE api_tokens SET last_used_at = now(), last_used_ip = $1
--    WHERE id = $2 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
-- (zero zmienionych wierszy = zapisano przed chwila, nic wiecej do roboty).

CREATE TABLE "api_tokens" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  -- 8 znakow, sluzy do wyszukania wiersza i do pokazania w UI; sekret nie jest nigdzie zapisany.
  "prefix" text NOT NULL,
  -- SHA-256 calego tokenu (tj_<prefix>_<sekret>), hex.
  "token_sha256" text NOT NULL,
  "scopes" text[] NOT NULL,
  "created_via" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  "last_used_ip" text,
  -- NULL = bez terminu (ADR-030).
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "revoked_reason" text,
  CONSTRAINT "api_tokens_name" CHECK (length("name") BETWEEN 1 AND 80),
  CONSTRAINT "api_tokens_prefix" CHECK ("prefix" ~ '^[a-z0-9]{8}$'),
  CONSTRAINT "api_tokens_sha256" CHECK ("token_sha256" ~ '^[0-9a-f]{64}$'),
  -- Zakresu "approve" nie ma i nie moze byc dopisany bez migracji (ADR-030, warstwa 1).
  -- Zakres "import" (Slowa uzytkownika 15.10.2026: «Osobny zakres „import”») pozwala deklarowac
  -- pochodzenie vault-import i mentor. Nadaje go TYLKO uzytkownik recznie w UI (created_via = 'ui');
  -- device_codes.requested_scopes go nie zna (nizej), wiec logowanie urzadzenia nigdy go nie da.
  CONSTRAINT "api_tokens_scopes" CHECK (
    cardinality("scopes") BETWEEN 1 AND 4 AND "scopes" <@ ARRAY['read', 'write', 'propose', 'import']
  ),
  CONSTRAINT "api_tokens_created_via" CHECK ("created_via" IN ('device_code', 'ui')),
  CONSTRAINT "api_tokens_prefix_uq" UNIQUE ("prefix"),
  CONSTRAINT "api_tokens_sha256_uq" UNIQUE ("token_sha256")
);--> statement-breakpoint

CREATE TABLE "device_codes" (
  "id" serial PRIMARY KEY,
  -- Skrot device_code (nie sam kod), hex.
  "device_code_sha256" text NOT NULL,
  -- 8 spolglosek z listy bez mylacych liter, np. BCDF-GHJK.
  "user_code" text NOT NULL,
  "client_name" text NOT NULL,
  "client_ip" text,
  "requested_scopes" text[] NOT NULL,
  "granted_scopes" text[],
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- created_at + 10 min (liczy API).
  "expires_at" timestamptz NOT NULL,
  "last_polled_at" timestamptz,
  "approved_at" timestamptz,
  "denied_at" timestamptz,
  -- Token powstaje przy odpytaniu PO zatwierdzeniu, nie przy zatwierdzeniu:
  -- jawny token nie lezy w bazie ani chwili.
  "token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION,
  "consumed_at" timestamptz,
  CONSTRAINT "device_codes_sha256" CHECK ("device_code_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "device_codes_user_code" CHECK (
    "user_code" ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$'
  ),
  CONSTRAINT "device_codes_client_name" CHECK (length("client_name") BETWEEN 1 AND 80),
  -- Celowo BEZ 'import': CHECK jest drugim zabezpieczeniem obok walidacji w API.
  CONSTRAINT "device_codes_requested_scopes" CHECK ("requested_scopes" <@ ARRAY['read', 'write', 'propose']),
  CONSTRAINT "device_codes_granted_scopes" CHECK ("granted_scopes" IS NULL OR "granted_scopes" <@ "requested_scopes"),
  CONSTRAINT "device_codes_decision" CHECK ("approved_at" IS NULL OR "denied_at" IS NULL),
  CONSTRAINT "device_codes_granted_when_approved" CHECK (("approved_at" IS NULL) = ("granted_scopes" IS NULL)),
  CONSTRAINT "device_codes_consumed" CHECK (
    "consumed_at" IS NULL OR ("approved_at" IS NOT NULL AND "token_id" IS NOT NULL)
  ),
  CONSTRAINT "device_codes_sha256_uq" UNIQUE ("device_code_sha256"),
  CONSTRAINT "device_codes_user_code_uq" UNIQUE ("user_code")
);
