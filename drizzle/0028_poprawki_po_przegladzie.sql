-- Poprawki fazy 2b po audycie bezpieczenstwa i code review (2026-10-15).
-- 1) ai_suggestions.kind dostaje 'trade_setup': przypisanie setupu do trade'a przez AI idzie kolejka
--    potwierdzen i liczy sie w statystykach dopiero po zatwierdzeniu (Slowa uzytkownika 15.10.2026:
--    «Plan z moich slow = zatwierdzenie»; wyjatek: plan przed wejsciem z moimi slowami wchodzi od razu).
-- 2) weekly_reviews: zobowiazanie tygodnia i rozliczenie poprzedniego raz ustawione nie zmieniaja sie
--    (chyba ze zapis robi UI). Wczesniej mogl je podmienic agent, bo trigger pilnowal tylko statusu.
-- 3) mentor_claims.status: review_ok i review_bad to ocena zgodnosci z filmem, czyli decyzja uzytkownika.
-- 4) prop_rules.confirmed_at: potwierdza uzytkownik w aplikacji.
-- Plany z juz przypietym trade'em dostaja entry_time_at_attach z entry_time trade'a z DNIA MIGRACJI (czasu z chwili
-- przypiecia sprzed migracji nie da sie odtworzyc). Na produkcji (migracja 0015) takich planow nie ma.
-- Cofniecie: docs/v2/rollback/0028_down.sql.
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

ALTER TABLE "ai_suggestions" DROP CONSTRAINT "ai_suggestions_kind";--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_kind" CHECK ("kind" IN ('tag', 'trade_link', 'setup_example', 'process_grade',
  'profile_term', 'day_conclusion', 'weekly_conclusion', 'strategy_detail', 'trade_setup'));--> statement-breakpoint

CREATE FUNCTION public.tj_weekly_once() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_col text;
  v_old text;
  v_new text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF nullif(current_setting('tj.actor', true), '') IS NOT DISTINCT FROM 'ui' THEN
    RETURN NEW;
  END IF;
  FOREACH v_col IN ARRAY ARRAY['commitment_words_id', 'prev_commitment_result', 'prev_result_words_id'] LOOP
    v_old := to_jsonb(OLD) ->> v_col;
    v_new := to_jsonb(NEW) ->> v_col;
    IF v_old IS NOT NULL AND v_old IS DISTINCT FROM v_new THEN
      RAISE EXCEPTION 'Pole % w przegladzie tygodnia % ma juz wartosc (%), a zapis chce ja zmienic na (%). Powod: zobowiazanie i jego rozliczenie ustawia sie raz. Naprawa: zmiane zapisuje uzytkownik w aplikacji.', v_col, OLD.week_start, v_old, coalesce(v_new, 'brak')
        USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME, COLUMN = v_col;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "weekly_reviews_once" BEFORE UPDATE ON "weekly_reviews"
  FOR EACH ROW EXECUTE FUNCTION public.tj_weekly_once();--> statement-breakpoint

CREATE TRIGGER "mentor_claims_ui_actor" BEFORE INSERT OR UPDATE ON "mentor_claims"
  FOR EACH ROW EXECUTE FUNCTION public.tj_require_ui_actor('status', 'review_ok', 'review_bad');
--> statement-breakpoint

-- 4) prop_rules.confirmed_at: potwierdzenie zgodnosci z regulaminem robi uzytkownik w aplikacji (R29).
-- Wstawienie wiersza juz potwierdzonego tez wymaga aktora ui (WHEN omija zwykle wstawienie z NULL).
CREATE TRIGGER "prop_rules_confirm_update" BEFORE UPDATE OF "confirmed_at" ON "prop_rules"
  FOR EACH ROW EXECUTE FUNCTION public.tj_require_ui_actor('confirmed_at');--> statement-breakpoint
CREATE TRIGGER "prop_rules_confirm_insert" BEFORE INSERT ON "prop_rules"
  FOR EACH ROW WHEN (NEW."confirmed_at" IS NOT NULL) EXECUTE FUNCTION public.tj_require_ui_actor('confirmed_at');
--> statement-breakpoint

-- 5) trade_plans.entry_time_at_attach: czas wejscia trade'a z CHWILI przypiecia planu (pierwszy zapis). Pozniejsza
-- zmiana entry_time trade'a (np. ponowna synchronizacja) nie moze przeniesc go z »po planie« na »przed plan«
-- ani odwrotnie. Strazniki planu dopuszczaja ustawienie tej kolumny razem z przypieciem trade'u.
ALTER TABLE "trade_plans" ADD COLUMN "entry_time_at_attach" timestamptz;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tj_plan_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.trade_id IS NULL
     AND NEW.trade_id IS NOT NULL
     AND (to_jsonb(OLD) - 'trade_id' - 'entry_time_at_attach') = (to_jsonb(NEW) - 'trade_id' - 'entry_time_at_attach') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Plan #% jest zamrozony i nie wolno go zmienic (jedyny dozwolony UPDATE to przypiecie trade''u: trade_id z NULL na wartosc, bez zmiany reszty). Powod: plan jest dowodem decyzji sprzed wejscia. Naprawa: dopisz zmiane jako dopisek w trade_plan_addenda.', OLD.id
    USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME;
END
$$;--> statement-breakpoint
-- Uzupelnienie istniejacych planow z przypietym trade'em (jednorazowo, z wylaczonym straznikiem planu).
-- Uwaga: bierze DZISIEJSZE entry_time trade'a, bo czasu z chwili przypiecia sprzed tej migracji nie da sie odtworzyc.
ALTER TABLE "trade_plans" DISABLE TRIGGER "trade_plans_guard";--> statement-breakpoint
UPDATE "trade_plans" p SET "entry_time_at_attach" = t."entry_time" FROM "trades" t WHERE t."id" = p."trade_id";--> statement-breakpoint
ALTER TABLE "trade_plans" ENABLE TRIGGER "trade_plans_guard";
