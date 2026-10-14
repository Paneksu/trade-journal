-- Przeglad tygodnia z jednym zobowiazaniem (ADR-033, faza 2b, 2026-10-15).
-- Projekt: docs/v2/model-danych.md, sekcja 5.7; odstepstwa: sekcja 14. Cofniecie: docs/v2/rollback/0025_down.sql.
-- Zaleznosci: 0018 (user_words, tj_require_ui_actor).
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

CREATE TABLE "weekly_reviews" (
  "id" serial PRIMARY KEY,
  -- Poniedzialek tygodnia (ISO). Jeden przeglad na tydzien.
  "week_start" date NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  -- Szkic AI (origin ai, w UI podpisany).
  "draft_md" text,
  -- Liczby, na ktorych stal szkic, i chwila ich wyliczenia.
  "stats_snapshot" jsonb,
  "as_of" timestamptz,
  "conclusions_words_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION,
  -- JEDNO zobowiazanie na nastepny tydzien: jedna kolumna, nie lista.
  "commitment_words_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION,
  -- Przeglad, ktorego zobowiazanie rozliczamy w tym tygodniu (zwykle poprzedni tydzien).
  -- Bez tej kolumny wynik rozliczenia nie wiedzialby, czego dotyczy. NO ACTION: przegladu,
  -- ktory jest rozliczany, nie da sie skasowac.
  "prev_review_id" integer REFERENCES "weekly_reviews" ("id") ON DELETE NO ACTION,
  "prev_commitment_result" text,
  "prev_result_words_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION,
  "approved_at" timestamptz,
  CONSTRAINT "weekly_reviews_week_monday" CHECK (extract(isodow FROM "week_start") = 1),
  CONSTRAINT "weekly_reviews_status" CHECK ("status" IN ('draft', 'approved')),
  CONSTRAINT "weekly_reviews_approved" CHECK (("status" = 'approved') = ("approved_at" IS NOT NULL)),
  CONSTRAINT "weekly_reviews_snapshot" CHECK (("stats_snapshot" IS NULL) = ("as_of" IS NULL)),
  CONSTRAINT "weekly_reviews_prev_result" CHECK ("prev_commitment_result" IS NULL OR "prev_commitment_result" IN ('kept', 'partial', 'broken')),
  -- Wynik rozliczenia ma sens tylko razem ze wskazaniem rozliczanego przegladu.
  CONSTRAINT "weekly_reviews_prev_linked" CHECK ("prev_commitment_result" IS NULL OR "prev_review_id" IS NOT NULL),
  CONSTRAINT "weekly_reviews_prev_words" CHECK ("prev_result_words_id" IS NULL OR "prev_commitment_result" IS NOT NULL),
  CONSTRAINT "weekly_reviews_prev_self" CHECK ("prev_review_id" IS NULL OR "prev_review_id" <> "id"),
  CONSTRAINT "weekly_reviews_week_uq" UNIQUE ("week_start")
);--> statement-breakpoint
-- Zobowiazanie danego przegladu rozlicza najwyzej jeden nastepny przeglad.
CREATE UNIQUE INDEX "weekly_reviews_prev_idx" ON "weekly_reviews" ("prev_review_id") WHERE "prev_review_id" IS NOT NULL;--> statement-breakpoint

-- Rozliczany przeglad musi dotyczyc wczesniejszego tygodnia niz biezacy.
CREATE FUNCTION public.tj_weekly_prev_check() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_prev_week date;
BEGIN
  IF NEW.prev_review_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT w.week_start INTO v_prev_week FROM public.weekly_reviews w WHERE w.id = NEW.prev_review_id;
  IF FOUND AND v_prev_week >= NEW.week_start THEN
    RAISE EXCEPTION 'Przeglad tygodnia % rozlicza przeglad #% z tygodnia %, ktory nie jest wczesniejszy. Powod: rozliczamy zobowiazanie z przeszlosci. Naprawa: wskaz przeglad z wczesniejszym week_start.', NEW.week_start, NEW.prev_review_id, v_prev_week
      USING ERRCODE = 'TJ422', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "weekly_reviews_prev_check" BEFORE INSERT OR UPDATE OF "prev_review_id", "week_start" ON "weekly_reviews"
  FOR EACH ROW EXECUTE FUNCTION public.tj_weekly_prev_check();--> statement-breakpoint

-- Zatwierdzenie przegladu (i cofniecie zatwierdzenia) tylko z UI.
CREATE TRIGGER "weekly_reviews_ui_actor" BEFORE INSERT OR UPDATE ON "weekly_reviews"
  FOR EACH ROW EXECUTE FUNCTION public.tj_require_ui_actor('status', 'approved');
