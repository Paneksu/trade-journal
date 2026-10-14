-- Wiedza mentora i luki w strategii (ADR-033, faza 2b, 2026-10-15).
-- Projekt: docs/v2/model-danych.md, sekcja 5.9; odstepstwa: sekcja 14. Cofniecie: docs/v2/rollback/0027_down.sql.
-- Zaleznosci: 0020 (note_additions, setups, ai_suggestions), 0018 (notes, user_words, funkcje tj_*).
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

CREATE TABLE "mentor_sources" (
  "id" serial PRIMARY KEY,
  "platform" text NOT NULL DEFAULT 'youtube',
  "video_id" text NOT NULL,
  "playlist_id" text,
  "position" integer,
  "title" text NOT NULL,
  "url" text NOT NULL,
  "published_at" timestamptz,
  "duration_s" integer,
  "status" text NOT NULL DEFAULT 'pending',
  "transcript_source" text,
  -- Sciezka lokalna na R:, nigdy tresc transkrypcji.
  "transcript_path" text,
  "error" text,
  "processed_at" timestamptz,
  CONSTRAINT "mentor_sources_platform" CHECK ("platform" IN ('youtube')),
  CONSTRAINT "mentor_sources_video_id" CHECK (length("video_id") > 0),
  CONSTRAINT "mentor_sources_title" CHECK (length("title") > 0),
  CONSTRAINT "mentor_sources_url" CHECK ("url" ~ '^https://'),
  CONSTRAINT "mentor_sources_duration" CHECK ("duration_s" IS NULL OR "duration_s" >= 0),
  CONSTRAINT "mentor_sources_status" CHECK ("status" IN ('pending', 'processed', 'no_captions', 'error')),
  CONSTRAINT "mentor_sources_transcript_source" CHECK ("transcript_source" IS NULL OR "transcript_source" IN ('captions', 'whisper')),
  -- Idempotencja `tj mentor sync`.
  CONSTRAINT "mentor_sources_video_uq" UNIQUE ("platform", "video_id")
);--> statement-breakpoint
-- Kolejka filmow do przetworzenia, w kolejnosci playlisty.
CREATE INDEX "mentor_sources_pending_idx" ON "mentor_sources" ("playlist_id", "position") WHERE "status" = 'pending';--> statement-breakpoint

CREATE TABLE "mentor_claims" (
  "id" serial PRIMARY KEY,
  -- CASCADE: film mozna usunac tylko wtedy, gdy nic na jego twierdzenia nie wskazuje
  -- (note_additions i strategy_gaps wskazuja NO ACTION, wiec kasowanie padnie czytelnym 23503).
  "source_id" integer NOT NULL REFERENCES "mentor_sources" ("id") ON DELETE CASCADE,
  -- Doslowny cytat.
  "quote" text NOT NULL,
  -- Liczy trigger tj_mentor_claim_hash; DEFAULT '' tylko po to, by INSERT mogl go pominac
  -- (bez triggera CHECK odrzuci pusty ciag).
  "quote_sha256" text NOT NULL DEFAULT '',
  "t_start_s" integer NOT NULL,
  "t_end_s" integer,
  "claim_type" text NOT NULL,
  -- Streszczenie AI, zawsze podpisane.
  "paraphrase" text,
  "status" text NOT NULL DEFAULT 'extracted',
  -- SET NULL: te dwie kolumny nie sa chronione przez tj_guard_columns (zmienia sie "do czego wlaczono").
  "merged_note_id" integer REFERENCES "notes" ("id") ON DELETE SET NULL,
  "setup_id" integer REFERENCES "setups" ("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mentor_claims_quote" CHECK (length("quote") > 0),
  CONSTRAINT "mentor_claims_quote_sha256" CHECK ("quote_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mentor_claims_t_start" CHECK ("t_start_s" >= 0),
  CONSTRAINT "mentor_claims_t_end" CHECK ("t_end_s" IS NULL OR "t_end_s" >= "t_start_s"),
  CONSTRAINT "mentor_claims_claim_type" CHECK ("claim_type" IN ('concept', 'setup_condition', 'management', 'psychology', 'other')),
  CONSTRAINT "mentor_claims_status" CHECK ("status" IN ('extracted', 'merged', 'review_ok', 'review_bad')),
  CONSTRAINT "mentor_claims_source_quote_uq" UNIQUE ("source_id", "quote_sha256", "t_start_s")
);--> statement-breakpoint
-- Zerowanie przy kasowaniu notatki lub setupu.
CREATE INDEX "mentor_claims_note_idx" ON "mentor_claims" ("merged_note_id") WHERE "merged_note_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mentor_claims_setup_idx" ON "mentor_claims" ("setup_id") WHERE "setup_id" IS NOT NULL;--> statement-breakpoint

-- Skrot z bajtow UTF-8 cytatu, jak w tj_user_words_hash (0018): trigger NIE ufa wartosci od klienta.
CREATE FUNCTION public.tj_mentor_claim_hash() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.quote_sha256 := encode(sha256(convert_to(NEW.quote, 'UTF8')), 'hex');
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "mentor_claims_hash" BEFORE INSERT ON "mentor_claims"
  FOR EACH ROW EXECUTE FUNCTION public.tj_mentor_claim_hash();--> statement-breakpoint

-- Cytat i znacznik czasu nie zmieniaja sie nigdy. Zmieniaja sie: paraphrase, status, merged_note_id, setup_id.
CREATE TRIGGER "mentor_claims_immutable" BEFORE UPDATE ON "mentor_claims"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_columns('source_id', 'quote', 'quote_sha256', 't_start_s', 't_end_s');--> statement-breakpoint

-- --- note_additions: dopisek mentora wskazuje twierdzenie -------------------------------------

-- NO ACTION: kolumna jest chroniona przez tj_guard_columns, wiec SET NULL byloby UPDATE-em chronionej kolumny.
ALTER TABLE "note_additions" ADD COLUMN "mentor_claim_id" integer REFERENCES "mentor_claims" ("id") ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE "note_additions" ADD CONSTRAINT "note_additions_mentor" CHECK ("origin" <> 'mentor' OR "mentor_claim_id" IS NOT NULL);--> statement-breakpoint
-- Kasowanie twierdzenia sprawdza, czy cos na nie wskazuje.
CREATE INDEX "note_additions_claim_idx" ON "note_additions" ("mentor_claim_id") WHERE "mentor_claim_id" IS NOT NULL;--> statement-breakpoint
-- Ta sama ochrona co w 0020, z nowa kolumna na liscie.
DROP TRIGGER "note_additions_immutable" ON "note_additions";--> statement-breakpoint
CREATE TRIGGER "note_additions_immutable" BEFORE UPDATE ON "note_additions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_columns(
    'id', 'note_id', 'body_md', 'origin', 'evidence', 'suggestion_id', 'created_at', 'mentor_claim_id'
  );--> statement-breakpoint

-- --- strategy_gaps: luki i sprzecznosci "mentor kontra praktyka" ------------------------------

CREATE TABLE "strategy_gaps" (
  "id" serial PRIMARY KEY,
  -- 'mentor_conflict' = "Do rozstrzygniecia".
  "kind" text NOT NULL,
  "question" text NOT NULL,
  -- sha256(kind + znormalizowane pytanie), liczy API.
  "dedupe_key" text NOT NULL,
  "setup_id" integer REFERENCES "setups" ("id") ON DELETE SET NULL,
  "trade_id" integer REFERENCES "trades" ("id") ON DELETE SET NULL,
  -- NO ACTION (model: SET NULL): CHECK strategy_gaps_conflict wymaga cytatu przy sprzecznosci,
  -- a SET NULL zablokowaloby kasowanie cytatu naruszeniem tego CHECK-a.
  "mentor_claim_id" integer REFERENCES "mentor_claims" ("id") ON DELETE NO ACTION,
  "note_id" integer REFERENCES "notes" ("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'open',
  "origin" text NOT NULL,
  "asked_at" timestamptz,
  "answered_at" timestamptz,
  -- Odpowiedz uzytkownika: jego slowa dokladnie.
  "answer_words_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION,
  -- Rozstrzygniecie sprzecznosci: zostaje moje / bierzemy mentora / oba warunkowo.
  "resolution" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "strategy_gaps_kind" CHECK ("kind" IN ('gap', 'mentor_conflict')),
  CONSTRAINT "strategy_gaps_question" CHECK (length("question") > 0),
  CONSTRAINT "strategy_gaps_dedupe_key" CHECK ("dedupe_key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "strategy_gaps_status" CHECK ("status" IN ('open', 'asked', 'answered', 'dismissed')),
  CONSTRAINT "strategy_gaps_origin" CHECK ("origin" IN ('ai', 'mentor')),
  CONSTRAINT "strategy_gaps_conflict" CHECK ("kind" <> 'mentor_conflict' OR "mentor_claim_id" IS NOT NULL),
  CONSTRAINT "strategy_gaps_answer" CHECK (("status" = 'answered') = ("answer_words_id" IS NOT NULL)),
  CONSTRAINT "strategy_gaps_answered_at" CHECK (("status" = 'answered') = ("answered_at" IS NOT NULL)),
  CONSTRAINT "strategy_gaps_resolution_value" CHECK ("resolution" IS NULL OR "resolution" IN ('keep_mine', 'take_mentor', 'both_conditional')),
  -- Sprzecznosc rozstrzygnieta ma rozstrzygniecie, nierozstrzygnieta nie ma; luka nigdy go nie ma.
  CONSTRAINT "strategy_gaps_resolution" CHECK (
    ("kind" = 'gap' AND "resolution" IS NULL)
    OR ("kind" = 'mentor_conflict' AND (("status" = 'answered') = ("resolution" IS NOT NULL)))
  )
);--> statement-breakpoint

-- To samo pytanie nie wisi dwa razy otwarte.
CREATE UNIQUE INDEX "strategy_gaps_open_dedupe_idx" ON "strategy_gaps" ("dedupe_key") WHERE "status" IN ('open', 'asked');--> statement-breakpoint
-- Kolejka pytan: "Do rozstrzygniecia" i luki po jednej.
CREATE INDEX "strategy_gaps_queue_idx" ON "strategy_gaps" ("kind", "created_at") WHERE "status" IN ('open', 'asked');--> statement-breakpoint
-- Zerowanie trade_id przy kasowaniu trade'u nie moze skanowac tabeli; kasowanie cytatu sprawdza claim.
CREATE INDEX "strategy_gaps_trade_idx" ON "strategy_gaps" ("trade_id") WHERE "trade_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "strategy_gaps_claim_idx" ON "strategy_gaps" ("mentor_claim_id") WHERE "mentor_claim_id" IS NOT NULL;--> statement-breakpoint

-- Odpowiedz i odrzucenie pytania tylko z UI: AI nie rozstrzyga. Stan 'asked' ustawia API.
CREATE TRIGGER "strategy_gaps_ui_actor" BEFORE INSERT OR UPDATE ON "strategy_gaps"
  FOR EACH ROW EXECUTE FUNCTION public.tj_require_ui_actor('status', 'answered', 'dismissed');
