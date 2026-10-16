-- Cofniecie migracji 0030_wynik_netto.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- Kasuje kolumny wyniku netto razem z wartosciami: trades.fees, trades.pnl_estimate, instruments.size_class oraz stawki
-- oplat w prop_firm_presets, prop_rules i accounts. Wartosc trades.pnl ZOSTAJE taka, jaka zapisano (od 0030 netto);
-- cofniecie nie przelicza jej z powrotem na brutto. Zrzut bazy przed uruchomieniem, jesli ktorakolwiek stawka byla edytowana.
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_fee_micro";
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_fee_mini";
ALTER TABLE "accounts" DROP COLUMN "fee_rt_micro_cents";
ALTER TABLE "accounts" DROP COLUMN "fee_rt_mini_cents";
ALTER TABLE "prop_rules" DROP CONSTRAINT "prop_rules_fee_source_url";
ALTER TABLE "prop_rules" DROP CONSTRAINT "prop_rules_fee_micro";
ALTER TABLE "prop_rules" DROP CONSTRAINT "prop_rules_fee_mini";
ALTER TABLE "prop_rules" DROP COLUMN "fee_source_url";
ALTER TABLE "prop_rules" DROP COLUMN "fee_rt_micro_cents";
ALTER TABLE "prop_rules" DROP COLUMN "fee_rt_mini_cents";
ALTER TABLE "prop_firm_presets" DROP CONSTRAINT "prop_firm_presets_fee_source_url";
ALTER TABLE "prop_firm_presets" DROP CONSTRAINT "prop_firm_presets_fee_micro";
ALTER TABLE "prop_firm_presets" DROP CONSTRAINT "prop_firm_presets_fee_mini";
ALTER TABLE "prop_firm_presets" DROP COLUMN "fee_source_url";
ALTER TABLE "prop_firm_presets" DROP COLUMN "fee_rt_micro_cents";
ALTER TABLE "prop_firm_presets" DROP COLUMN "fee_rt_mini_cents";
ALTER TABLE "instruments" DROP CONSTRAINT "instruments_size_class";
ALTER TABLE "instruments" DROP COLUMN "size_class";
ALTER TABLE "trades" DROP CONSTRAINT "trades_fees";
ALTER TABLE "trades" DROP COLUMN "pnl_estimate";
ALTER TABLE "trades" DROP COLUMN "fees";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787750000000;
