-- Cofniecie migracji 0031_broker_import.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f), PO cofnieciu 0032.
--
-- Kasuje WSZYSTKIE dane brokera (wypelnienia, trade'y brokera, zdarzenia Cash History, importy, konta u brokera,
-- aktywne konta dnia) i tokeny z zakresem import_broker razem z wpisami dziennika zdarzen, ktore na nie wskazuja.
-- Trade'y dziennika zostaja; te z source = 'broker' wracaja do source = 'form' (external_ref czyszczony).
-- Kwoty z rachunku (trades.broker_amount) wpisane przez dopasowania zostaja, bo to wartosci uzytkownika po fakcie.
-- Sugestie ai_suggestions rodzaju broker_match / broker_trade sa kasowane (ich efekty w trades zostaja).
-- Zrzut bazy przed uruchomieniem.
DROP TRIGGER "trades_odepnij_broker" ON "trades";
DROP FUNCTION public.tj_trade_odepnij_broker();
DROP TRIGGER "trades_source_broker_update" ON "trades";
DROP TRIGGER "trades_source_broker_insert" ON "trades";
ALTER TABLE "trades" DROP CONSTRAINT "trades_broker_ref";
UPDATE "trades" SET "source" = 'form', "external_ref" = NULL WHERE "source" = 'broker';
ALTER TABLE "trades" DROP CONSTRAINT "trades_source";
ALTER TABLE "trades" ADD CONSTRAINT "trades_source" CHECK ("source" IN ('form', 'tradingview', 'fxreplay'));

DELETE FROM "ai_suggestions" WHERE "kind" IN ('broker_match', 'broker_trade');
ALTER TABLE "ai_suggestions" DROP CONSTRAINT "ai_suggestions_kind";
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_kind" CHECK ("kind" IN ('tag', 'trade_link', 'setup_example', 'process_grade',
  'profile_term', 'day_conclusion', 'weekly_conclusion', 'strategy_detail', 'trade_setup'));

DROP TABLE "day_accounts";
DROP TABLE "broker_cash_events";
DROP TABLE "broker_fills";
DROP TABLE "broker_trades";
DROP TABLE "broker_imports";
DROP TABLE "broker_accounts";
DROP TABLE "prop_firm_platforms";
DROP FUNCTION public.tj_broker_dopasowanie();
DROP FUNCTION public.tj_broker_import_origin();
DROP FUNCTION public.tj_broker_konto_zapis();
DROP FUNCTION public.tj_broker_zapis();
DROP FUNCTION public.tj_broker_aktor_import();

DELETE FROM "auth_events" WHERE "kind" IN ('broker_import', 'broker_import_reverted', 'broker_import_rejected', 'broker_account_mapped', 'broker_match_reverted', 'broker_history_recalculated')
  OR "token_id" IN (SELECT "id" FROM "api_tokens" WHERE 'import_broker' = ANY ("scopes"));
DELETE FROM "api_tokens" WHERE 'import_broker' = ANY ("scopes");
ALTER TABLE "auth_events" DROP CONSTRAINT "auth_events_kind";
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_kind" CHECK ("kind" IN ('login_ok', 'login_fail', 'totp_ok', 'totp_fail', 'backup_code_used', 'sudo', 'totp_enabled', 'totp_disabled', 'backup_codes_regenerated', 'password_changed', 'device_requested', 'device_approved', 'device_denied', 'token_created', 'token_revoked', 'logout_all'));
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_import_broker";
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_scopes";
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_scopes" CHECK (
  cardinality("scopes") BETWEEN 1 AND 4 AND "scopes" <@ ARRAY['read', 'write', 'propose', 'import']
);
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787760000000;
