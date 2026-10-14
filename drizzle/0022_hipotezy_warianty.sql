-- Hipotezy: licznik testowanych wariantow i log zmian progow (ADR-033, faza 2b, 2026-10-15).
-- Projekt: docs/v2/model-danych.md, sekcja 5.5. Cofniecie: docs/v2/rollback/0022_down.sql.
-- Zaleznosci: 0018 (hypotheses, tj_hypothesis_n), 0020 (setups).
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

CREATE TABLE "hypothesis_variants" (
  "id" serial PRIMARY KEY,
  "hypothesis_id" integer REFERENCES "hypotheses" ("id") ON DELETE CASCADE,
  "setup_id" integer REFERENCES "setups" ("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  -- {"sl":"...","tp":"...","okno":"09:30-10:00"}.
  "params" jsonb NOT NULL,
  -- SHA-256 kanonicznego JSON-a parametrow (posortowane klucze), liczy API.
  "params_hash" text NOT NULL,
  "n_tested" integer NOT NULL,
  -- Migawka wyniku wariantu.
  "result" jsonb,
  "origin" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hypothesis_variants_label" CHECK (length("label") > 0),
  CONSTRAINT "hypothesis_variants_params" CHECK (jsonb_typeof("params") = 'object'),
  CONSTRAINT "hypothesis_variants_params_hash" CHECK ("params_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "hypothesis_variants_n_tested" CHECK ("n_tested" >= 0),
  CONSTRAINT "hypothesis_variants_origin" CHECK ("origin" IN ('user', 'ai')),
  -- Wariant nalezy do hipotezy ALBO do setupu, nigdy do obu i nigdy do zadnej.
  CONSTRAINT "hypothesis_variants_owner" CHECK (num_nonnulls("hypothesis_id", "setup_id") = 1),
  -- Ten sam zestaw parametrow rejestruje sie raz na wlasciciela; NULL-e traktowane jako rowne,
  -- bo jeden z dwoch wlascicieli jest zawsze NULL.
  CONSTRAINT "hypothesis_variants_uq" UNIQUE NULLS NOT DISTINCT ("hypothesis_id", "setup_id", "params_hash")
);--> statement-breakpoint
-- Unikat obsluguje kaskade z kasowania hipotezy (kolumna wiodaca); setup potrzebuje wlasnego.
CREATE INDEX "hypothesis_variants_setup_idx" ON "hypothesis_variants" ("setup_id") WHERE "setup_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "threshold_changes" (
  "id" serial PRIMARY KEY,
  "hypothesis_id" integer NOT NULL REFERENCES "hypotheses" ("id") ON DELETE CASCADE,
  "field" text NOT NULL,
  "old_value" jsonb NOT NULL,
  "new_value" jsonb NOT NULL,
  "n_at_change" integer NOT NULL,
  -- n_at_change >= stary prog_n: wynik byl juz pokazany, gdy prog zmieniono.
  "result_was_visible" boolean NOT NULL,
  "actor" text NOT NULL,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "threshold_changes_field" CHECK ("field" IN ('prog_n', 'thresholds'))
);--> statement-breakpoint
CREATE INDEX "threshold_changes_hypothesis_idx" ON "threshold_changes" ("hypothesis_id", "changed_at");--> statement-breakpoint

CREATE TRIGGER "threshold_changes_immutable" BEFORE UPDATE ON "threshold_changes"
  FOR EACH ROW EXECUTE FUNCTION public.tj_forbid_update();--> statement-breakpoint

-- Log zmian progow po fakcie: kazda zmiana hypotheses.prog_n / thresholds, z DOWOLNEJ sciezki zapisu
-- (UI, API, skrypt), zostawia wiersz. Log, o ktorym nie da sie zapomnic w nowej sciezce zapisu.
-- Przy jednoczesnej zmianie obu pol powstaja dwa wiersze. n liczy tj_hypothesis_n z 0018.
-- Aktor: tj.actor transakcji, a bez niego 'unknown' (zapis nie moze sie nie udac z braku etykiety).
CREATE FUNCTION public.tj_log_threshold_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_n integer;
  v_actor text;
BEGIN
  v_n := public.tj_hypothesis_n(NEW.id);
  v_actor := coalesce(nullif(current_setting('tj.actor', true), ''), 'unknown');
  IF NEW.prog_n IS DISTINCT FROM OLD.prog_n THEN
    INSERT INTO public.threshold_changes (hypothesis_id, field, old_value, new_value, n_at_change, result_was_visible, actor)
    VALUES (NEW.id, 'prog_n', to_jsonb(OLD.prog_n), to_jsonb(NEW.prog_n), v_n, v_n >= OLD.prog_n, v_actor);
  END IF;
  IF NEW.thresholds IS DISTINCT FROM OLD.thresholds THEN
    INSERT INTO public.threshold_changes (hypothesis_id, field, old_value, new_value, n_at_change, result_was_visible, actor)
    VALUES (NEW.id, 'thresholds', OLD.thresholds, NEW.thresholds, v_n, v_n >= OLD.prog_n, v_actor);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

CREATE TRIGGER "hypotheses_threshold_log" AFTER UPDATE OF "prog_n", "thresholds" ON "hypotheses"
  FOR EACH ROW WHEN (OLD."prog_n" IS DISTINCT FROM NEW."prog_n" OR OLD."thresholds" IS DISTINCT FROM NEW."thresholds")
  EXECUTE FUNCTION public.tj_log_threshold_change();
