-- Cofniecie migracji 0028_poprawki_po_przegladzie.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- Sugestie 'trade_setup' (przypisanie setupu przez AI) przestaja byc dozwolone, wiec najpierw znikaja
-- (efekt zatwierdzonych zostaje w trades.setup_id).
DROP TRIGGER "prop_rules_confirm_insert" ON "prop_rules";
DROP TRIGGER "prop_rules_confirm_update" ON "prop_rules";
DROP TRIGGER "mentor_claims_ui_actor" ON "mentor_claims";
DROP TRIGGER "weekly_reviews_once" ON "weekly_reviews";
DROP FUNCTION public.tj_weekly_once();
DELETE FROM "ai_suggestions" WHERE "kind" = 'trade_setup';
ALTER TABLE "ai_suggestions" DROP CONSTRAINT "ai_suggestions_kind";
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_kind" CHECK ("kind" IN ('tag', 'trade_link', 'setup_example', 'process_grade',
  'profile_term', 'day_conclusion', 'weekly_conclusion', 'strategy_detail'));

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787730000000;
