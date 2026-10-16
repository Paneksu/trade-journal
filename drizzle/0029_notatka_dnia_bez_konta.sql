-- Jedna notatka dnia bez konta (ADR-033, runda r2 UI v2, 2026-10-16). Slowa uzytkownika 16.10.2026: «Scal w migracji».
-- Rytual na "Dzis" i AI (PUT /api/v2/days/:date) zapisuja notatke dnia bez konta; kalendarz zapisywal ja na
-- pierwszym koncie. Ta migracja przenosi notatki dziennika przypiete do konta (backtest_session_id IS NULL) do
-- notatki bez konta:
--   * dzien z jednym wpisem na koncie: wpis traci konto (ten sam wiersz, te same zrzuty);
--   * dzien z kilkoma wpisami (rozne konta albo juz istniejaca notatka bez konta): tresci sie lacza (podwojna nowa
--     linia), tekst z wpisu na koncie dostaje dopisek " — [nazwa konta]"; pola liczbowe i ustawienia dnia
--     biora wartosc z notatki bez konta, a gdy jej brak, z pierwszego konta (kolejnosc kont jak w aplikacji);
--     rozne wartosci z kolejnych wpisow nie gina: trafiaja jako linia do "Po sesji" z dopiskiem konta;
--     zrzuty dnia sa przepinane na scalona notatke (pliki zostaja w katalogu dzien-<stary id>, sciezka w `file`).
-- Notatki sesji backtestu zostaja bez zmian. Slowa uzytkownika (user_words) nie maja klucza do day_notes
-- (kotwica to data `day`), wiec ich tresc i kotwica zostaja nietkniete.
-- Kopia stanu sprzed scalenia: tabele tj_kopie.notatki_0029 i tj_kopie.zrzuty_0029 (osobny schemat: tabele kopii nie mieszaja sie ze schematem aplikacji) (do cofniecia;
-- docs/v2/rollback/0029_down.sql). Przed migracja na produkcji: kopia bazy (docs/wdrozenie-coolify.md).
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

CREATE SCHEMA IF NOT EXISTS "tj_kopie";--> statement-breakpoint

CREATE TABLE "tj_kopie"."notatki_0029" AS
  SELECT * FROM "day_notes"
  WHERE "backtest_session_id" IS NULL
    AND "day" IN (SELECT "day" FROM "day_notes" WHERE "backtest_session_id" IS NULL AND "account_id" IS NOT NULL);--> statement-breakpoint

CREATE TABLE "tj_kopie"."zrzuty_0029" AS
  SELECT "id", "day_note_id", "sort_order" FROM "screenshots"
  WHERE "day_note_id" IN (SELECT "id" FROM "tj_kopie"."notatki_0029");--> statement-breakpoint

DO $$
DECLARE
  v_day date;
  v_ile integer;
  v_cel integer;
  r record;
  v_pierwszy boolean;
  v_pre text;
  v_post text;
  v_dopiski text;
  v_inne text;
  v_et text;
  v_mood smallint;
  v_energy smallint;
  v_rating smallint;
  v_sleep smallint;
  v_max smallint;
  v_bias text;
  v_no_trade boolean;
  v_reason no_trade_reason;
  v_created timestamptz;
  v_updated timestamptz;
BEGIN
  FOR v_day IN
    SELECT DISTINCT "day" FROM "day_notes" WHERE "backtest_session_id" IS NULL AND "account_id" IS NOT NULL ORDER BY 1
  LOOP
    SELECT count(*) INTO v_ile FROM "day_notes" WHERE "day" = v_day AND "backtest_session_id" IS NULL;
    IF v_ile = 1 THEN
      UPDATE "day_notes" SET "account_id" = NULL WHERE "day" = v_day AND "backtest_session_id" IS NULL;
      CONTINUE;
    END IF;

    v_pierwszy := true;
    v_pre := NULL; v_post := NULL; v_dopiski := NULL;
    FOR r IN
      SELECT n.*, a."name" AS konto
      FROM "day_notes" n LEFT JOIN "accounts" a ON a."id" = n."account_id"
      WHERE n."day" = v_day AND n."backtest_session_id" IS NULL
      ORDER BY (n."account_id" IS NOT NULL), a."sort_order", a."id", n."id"
    LOOP
      v_et := CASE WHEN r."account_id" IS NULL THEN '' ELSE ' — [' || r.konto || ']' END;
      IF nullif(btrim(r."pre_session"), '') IS NOT NULL THEN v_pre := concat_ws(E'\n\n', v_pre, r."pre_session" || v_et); END IF;
      IF nullif(btrim(r."post_session"), '') IS NOT NULL THEN v_post := concat_ws(E'\n\n', v_post, r."post_session" || v_et); END IF;
      IF v_pierwszy THEN
        v_cel := r."id";
        v_mood := r."mood"; v_energy := r."energy"; v_rating := r."day_rating"; v_sleep := r."sleep";
        v_max := r."max_trades"; v_bias := r."bias"; v_no_trade := r."no_trade"; v_reason := r."no_trade_reason";
        v_created := r."created_at"; v_updated := r."updated_at";
        v_pierwszy := false;
      ELSE
        -- Brakujace wartosci uzupelniamy z kolejnego wpisu; rozne wartosci zapisujemy tekstem, zeby nic nie zginelo.
        v_inne := concat_ws(', ',
          CASE WHEN r."mood" IS NOT NULL AND v_mood IS NOT NULL AND r."mood" <> v_mood THEN 'nastroj ' || r."mood" END,
          CASE WHEN r."energy" IS NOT NULL AND v_energy IS NOT NULL AND r."energy" <> v_energy THEN 'energia ' || r."energy" END,
          CASE WHEN r."day_rating" IS NOT NULL AND v_rating IS NOT NULL AND r."day_rating" <> v_rating THEN 'ocena dnia ' || r."day_rating" END,
          CASE WHEN r."sleep" IS NOT NULL AND v_sleep IS NOT NULL AND r."sleep" <> v_sleep THEN 'sen ' || r."sleep" END,
          CASE WHEN r."max_trades" IS NOT NULL AND v_max IS NOT NULL AND r."max_trades" <> v_max THEN 'maks. trade''ow ' || r."max_trades" END,
          CASE WHEN r."bias" IS NOT NULL AND v_bias IS NOT NULL AND r."bias" <> v_bias THEN 'bias ' || r."bias" END,
          CASE WHEN r."no_trade" AND v_no_trade AND r."no_trade_reason" IS DISTINCT FROM v_reason AND r."no_trade_reason" IS NOT NULL THEN 'powod pauzy ' || r."no_trade_reason"::text END);
        IF nullif(v_inne, '') IS NOT NULL THEN
          v_dopiski := concat_ws(E'\n', v_dopiski, 'Inne wartosci z tego dnia: ' || v_inne || v_et);
        END IF;
        v_mood := coalesce(v_mood, r."mood"); v_energy := coalesce(v_energy, r."energy");
        v_rating := coalesce(v_rating, r."day_rating"); v_sleep := coalesce(v_sleep, r."sleep");
        v_max := coalesce(v_max, r."max_trades"); v_bias := coalesce(v_bias, r."bias");
        -- Dzien bez transakcji: flaga jest true, jesli mial ja ktorykolwiek scalany wpis (decyzja sesji glownej 16.10.2026);
        -- powod z pierwszego wpisu, ktory go podal, inne powody trafiaja linia do "Po sesji" (wyzej).
        IF r."no_trade" AND NOT v_no_trade THEN v_no_trade := true; v_reason := coalesce(v_reason, r."no_trade_reason"); END IF;
        v_created := least(v_created, r."created_at"); v_updated := greatest(v_updated, r."updated_at");
      END IF;
    END LOOP;
    IF v_dopiski IS NOT NULL THEN v_post := concat_ws(E'\n\n', v_post, v_dopiski); END IF;

    -- Zrzuty pozostalych wpisow przechodza na notatke docelowa, w kolejnosci: docelowa, potem kolejne wpisy.
    UPDATE "screenshots" s SET "day_note_id" = v_cel, "sort_order" = k.nowa
    FROM (
      SELECT s2."id", (row_number() OVER (ORDER BY (n."id" <> v_cel), (n."account_id" IS NOT NULL), a."sort_order", a."id", n."id", s2."sort_order", s2."id") - 1)::integer AS nowa
      FROM "screenshots" s2
      JOIN "day_notes" n ON n."id" = s2."day_note_id"
      LEFT JOIN "accounts" a ON a."id" = n."account_id"
      WHERE n."day" = v_day AND n."backtest_session_id" IS NULL
    ) k
    WHERE s."id" = k."id";

    DELETE FROM "day_notes" WHERE "day" = v_day AND "backtest_session_id" IS NULL AND "id" <> v_cel;
    UPDATE "day_notes" SET
      "account_id" = NULL, "pre_session" = v_pre, "post_session" = v_post, "mood" = v_mood, "energy" = v_energy,
      "day_rating" = v_rating, "sleep" = v_sleep, "max_trades" = v_max, "bias" = v_bias, "no_trade" = v_no_trade,
      "no_trade_reason" = v_reason, "created_at" = v_created, "updated_at" = v_updated
    WHERE "id" = v_cel;
  END LOOP;
END
$$;
