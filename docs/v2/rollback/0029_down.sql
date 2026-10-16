-- Cofniecie migracji 0029_notatka_dnia_bez_konta.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- Przywraca notatki dnia i przypiecie zrzutow do stanu z kopii zrobionej przez migracje
-- (tj_kopie.notatki_0029, tj_kopie.zrzuty_0029), potem kasuje kopie. Zmiany w tych notatkach zrobione PO migracji
-- (wpisy z kalendarza, rytualu, API) w dniach objetych scaleniem zostaja nadpisane stanem sprzed migracji;
-- notatki dni, ktorych migracja nie dotykala, zostaja bez zmian.

-- 1) Notatki z kopii, ktore przetrwaly scalenie (ten sam id), dostaja z powrotem konto i tresc sprzed scalenia
--    (notatka docelowa byla albo notatka bez konta, albo pierwszym wpisem na koncie, wiec indeksy sie nie zderzaja).
UPDATE "day_notes" n SET
  "account_id" = k."account_id", "pre_session" = k."pre_session", "post_session" = k."post_session",
  "mood" = k."mood", "energy" = k."energy", "day_rating" = k."day_rating", "created_at" = k."created_at",
  "updated_at" = k."updated_at", "no_trade" = k."no_trade", "no_trade_reason" = k."no_trade_reason",
  "bias" = k."bias", "max_trades" = k."max_trades", "sleep" = k."sleep"
FROM "tj_kopie"."notatki_0029" k
WHERE n."id" = k."id";

-- 2) Notatki skasowane przy scaleniu wracaja z tym samym id.
INSERT INTO "day_notes" ("id", "day", "account_id", "pre_session", "post_session", "mood", "energy", "day_rating",
  "created_at", "updated_at", "no_trade", "no_trade_reason", "backtest_session_id", "bias", "max_trades", "sleep")
SELECT k."id", k."day", k."account_id", k."pre_session", k."post_session", k."mood", k."energy", k."day_rating",
  k."created_at", k."updated_at", k."no_trade", k."no_trade_reason", k."backtest_session_id", k."bias", k."max_trades", k."sleep"
FROM "tj_kopie"."notatki_0029" k
WHERE NOT EXISTS (SELECT 1 FROM "day_notes" n WHERE n."id" = k."id");

-- 3) Zrzuty wracaja do swoich notatek i kolejnosci.
UPDATE "screenshots" s SET "day_note_id" = k."day_note_id", "sort_order" = k."sort_order"
FROM "tj_kopie"."zrzuty_0029" k
WHERE s."id" = k."id";

DROP TABLE "tj_kopie"."zrzuty_0029";
DROP TABLE "tj_kopie"."notatki_0029";
DROP SCHEMA IF EXISTS "tj_kopie" RESTRICT;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787740000000;
