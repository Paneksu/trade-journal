-- Plan zamrozony, werdykt AI niezmienny, rytual dnia (ADR-033, faza 2b, 2026-10-15).
-- Projekt: docs/v2/model-danych.md, sekcje 5.1, 5.2, 5.7 (day_notes); odstepstwa: sekcja 14 tego dokumentu.
--
-- Zmiany istniejacych obiektow (jedyne w tym pliku, poza dokladaniem kolumn):
--   * trade_reviews_trade_basis_uq: UNIQUE (trade_id, basis) -> unikat CZESCIOWY WHERE kind = 'ai'.
--     Stare wiersze maja kind = 'ai' (DEFAULT), wiec nowy indeks zalozy sie bez konfliktu.
--     UWAGA dla kodu: ON CONFLICT (trade_id, basis) wymaga teraz dopisku WHERE kind = 'ai'
--     (drizzle: targetWhere), inaczej Postgres odpowie 42P10.
--   * day_notes: trzy CHECK-i 1-5 dla mood / energy / day_rating, zalozone jako NOT VALID, a potem
--     sprawdzone osobna instrukcja (patrz nizej). Dane historyczne, ktore ich nie spelniaja, nie
--     wywala migracji na starcie kontenera: stan "NOT VALID" jest wtedy widoczny w pg_constraint
--     (convalidated = false), a nowe i zmieniane wiersze i tak sa pilnowane.
--
-- Cofniecie: docs/v2/rollback/0021_down.sql (usuwa korekty user_override, ktore nie zmieszcza sie
-- w starym unikacie). Zaleznosci: 0020 (setups, setup_versions), 0018 (user_words, rule_versions).
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

-- --- Funkcje triggerow ----------------------------------------------------------------

-- Plan zamrozony: dozwolone jest WYLACZNIE przypiecie trade'u do planu (trade_id NULL -> wartosc),
-- przy niezmienionych pozostalych kolumnach. Kazda inna zmiana to TJ409; zmiany planu po zamrozeniu
-- ida jako dopiski (trade_plan_addenda). Kasowanie nie jest blokowane (kaskada z kasowania trade'u).
CREATE FUNCTION public.tj_plan_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.trade_id IS NULL
     AND NEW.trade_id IS NOT NULL
     AND (to_jsonb(OLD) - 'trade_id') = (to_jsonb(NEW) - 'trade_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Plan #% jest zamrozony i nie wolno go zmienic (jedyny dozwolony UPDATE to przypiecie trade''u: trade_id z NULL na wartosc, bez zmiany reszty). Powod: plan jest dowodem decyzji sprzed wejscia. Naprawa: dopisz zmiane jako dopisek w trade_plan_addenda.', OLD.id
    USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME;
END
$$;--> statement-breakpoint

-- Korekta uzytkownika (kind = 'user_override') musi dotyczyc werdyktu AI tego samego trade'u i tej
-- samej podstawy (basis). Korekty korekty nie ma: nadpisujemy zawsze oryginalny werdykt AI.
-- Cross-row, wiec trigger, a nie CHECK.
CREATE FUNCTION public.tj_review_override_check() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_trade integer;
  v_basis text;
  v_kind text;
BEGIN
  SELECT r.trade_id, r.basis, r.kind INTO v_trade, v_basis, v_kind
    FROM public.trade_reviews r WHERE r.id = NEW.overrides_review_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_kind <> 'ai' OR v_trade <> NEW.trade_id OR v_basis <> NEW.basis THEN
    RAISE EXCEPTION 'Korekta uzytkownika odrzucona: nadpisywany werdykt #% ma kind = "%", trade_id = %, basis = "%", a korekta ma trade_id = %, basis = "%". Powod: korekta dotyczy werdyktu AI tego samego trade''u i tej samej podstawy. Naprawa: wskaz overrides_review_id werdyktu kind = "ai" z tym samym trade_id i basis.', NEW.overrides_review_id, v_kind, v_trade, v_basis, NEW.trade_id, NEW.basis
      USING ERRCODE = 'TJ422', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Sprawdzenia regul werdyktu z as_of sa czescia niezmiennego werdyktu:
--   UPDATE: wolno zmienic tylko user_verdict (to zdanie uzytkownika, nie werdykt AI);
--   INSERT: nowe sprawdzenie do JUZ ISTNIEJACEGO werdyktu z as_of jest zabronione, ale API wstawia
--           werdykt i sprawdzenia razem, wiec INSERT w transakcji, w ktorej werdykt powstal (albo zostal
--           uzupelniony o as_of), musi przejsc.
-- Rozroznienie "w tej samej transakcji": rodzic zapisany przez te transakcje ma xmin rowne jej
-- numerowi (pokrywa tez UPDATE starego werdyktu bez as_of), a rodzic wstawiony w SAVEPOINCIE ma
-- w xmin numer podtransakcji, wiec dla niego sprawdzamy created_at = now() (now() jest stale w calej
-- transakcji, a created_at ma DEFAULT now()). Werdykt z innej transakcji nie spelnia zadnego
-- z warunkow: numer transakcji i chwila jej startu sa unikalne.
-- DELETE nie jest blokowany (kaskada z kasowania trade'u).
CREATE FUNCTION public.tj_rule_check_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_as_of timestamptz;
  v_created timestamptz;
  v_xmin bigint;
  v_found boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT r.as_of, r.created_at, r.xmin::text::bigint INTO v_as_of, v_created, v_xmin
      FROM public.trade_reviews r WHERE r.id = NEW.review_id;
    v_found := FOUND;
    IF NOT v_found OR v_as_of IS NULL THEN
      RETURN NEW;
    END IF;
    IF v_xmin = (txid_current() % 4294967296) OR v_created = now() THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Nie mozna dopisac sprawdzenia reguly "%" do werdyktu #%: werdykt ma as_of = % i zostal zapisany w innej transakcji. Powod: werdykt z as_of jest niezmienny razem ze swoimi sprawdzeniami. Naprawa: wyslij nowy werdykt (kind = "user_override" dla korekty uzytkownika) razem z jego sprawdzeniami w jednej transakcji.', NEW.rule_id, NEW.review_id, v_as_of
      USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME;
  END IF;
  SELECT r.as_of INTO v_as_of FROM public.trade_reviews r WHERE r.id = OLD.review_id;
  IF v_as_of IS NULL THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(OLD) - 'user_verdict') IS DISTINCT FROM (to_jsonb(NEW) - 'user_verdict') THEN
    RAISE EXCEPTION 'Sprawdzenie reguly "%" werdyktu #% (as_of = %) jest niezmienne: wolno zmienic tylko user_verdict. Powod: werdykt AI z as_of jest dowodem. Naprawa: zmien tylko user_verdict albo wyslij korekte jako nowy werdykt kind = "user_override".', OLD.rule_id, OLD.review_id, v_as_of
      USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- --- trade_plans ----------------------------------------------------------------------------

-- FK do user_words z wierszy, ktore gina RAZEM Z TRADE'EM (plan, dopiski planu), sa
-- NO ACTION DEFERRABLE INITIALLY DEFERRED. Powod: kasowanie trade'u kaskaduje rownolegle do planu
-- (trade_plans.trade_id) i do slow (user_words.trade_id), a Postgres odpala te kaskady po kolei,
-- w kolejnosci utworzenia ograniczen. Zwykle NO ACTION sprawdza sie po kazdej takiej kaskadzie, wiec
-- kaskada slow, ktora idzie pierwsza, zobaczylaby jeszcze zyjacy plan i zablokowala kasowanie.
-- Odroczone sprawdzenie dzieje sie przy COMMIT, gdy wszystkie kaskady sa skonczone. Skutek uboczny:
-- bledny id slow w planie wychodzi (kod 23503) dopiero przy zatwierdzeniu transakcji, nie w instrukcji.

CREATE TABLE "trade_plans" (
  "id" serial PRIMARY KEY,
  -- Plan powstaje PRZED trade'em; trade przypina sie pozniej (jedyny dozwolony UPDATE).
  "trade_id" integer REFERENCES "trades" ("id") ON DELETE CASCADE,
  "account_id" integer NOT NULL REFERENCES "accounts" ("id") ON DELETE RESTRICT,
  "instrument_id" integer NOT NULL REFERENCES "instruments" ("id") ON DELETE RESTRICT,
  "backtest_session_id" integer REFERENCES "backtest_sessions" ("id") ON DELETE CASCADE,
  -- Dzien handlowy planu.
  "day" date NOT NULL,
  "setup_id" integer REFERENCES "setups" ("id") ON DELETE RESTRICT,
  "setup_version_id" integer REFERENCES "setup_versions" ("id") ON DELETE RESTRICT,
  -- Zestaw regul w chwili zamrozenia.
  "ruleset_version" integer NOT NULL,
  "direction" text NOT NULL,
  "bias" text,
  "entry_price" numeric(18,8) NOT NULL,
  "stop_loss" numeric(18,8) NOT NULL,
  "take_profit" numeric(18,8),
  "contracts" numeric(14,4) NOT NULL,
  -- MIGAWKA z computeTrade w chwili zamrozenia (kwota w centach). Nigdy nie liczona w SQL.
  "risk_cents" bigint NOT NULL,
  "thesis_words_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  "invalidation_words_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  -- 'ai' = AI przepisalo plan ze slow uzytkownika.
  "origin" text NOT NULL,
  "created_by_token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION,
  "frozen_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "trade_plans_direction" CHECK ("direction" IN ('long', 'short')),
  CONSTRAINT "trade_plans_bias" CHECK ("bias" IS NULL OR "bias" IN ('long', 'short', 'neutral')),
  CONSTRAINT "trade_plans_origin" CHECK ("origin" IN ('user', 'ai')),
  CONSTRAINT "trade_plans_contracts" CHECK ("contracts" > 0),
  CONSTRAINT "trade_plans_risk" CHECK ("risk_cents" > 0),
  CONSTRAINT "trade_plans_ruleset" CHECK ("ruleset_version" >= 0),
  -- Wersja setupu ma sens tylko razem z setupem.
  CONSTRAINT "trade_plans_setup_version" CHECK ("setup_version_id" IS NULL OR "setup_id" IS NOT NULL),
  -- Long: SL ponizej wejscia, TP powyzej. Short: odwrotnie.
  CONSTRAINT "trade_plans_levels" CHECK (
    ("direction" = 'long' AND "stop_loss" < "entry_price" AND ("take_profit" IS NULL OR "take_profit" > "entry_price"))
    OR ("direction" = 'short' AND "stop_loss" > "entry_price" AND ("take_profit" IS NULL OR "take_profit" < "entry_price"))
  ),
  -- UNIQUE dopuszcza wiele NULL-i: wiele planow czeka na trade, kazdy trade ma najwyzej jeden plan.
  CONSTRAINT "trade_plans_trade_uq" UNIQUE ("trade_id")
);--> statement-breakpoint

CREATE INDEX "trade_plans_day_idx" ON "trade_plans" ("day");--> statement-breakpoint
CREATE INDEX "trade_plans_account_day_idx" ON "trade_plans" ("account_id", "day");--> statement-breakpoint
CREATE INDEX "trade_plans_setup_idx" ON "trade_plans" ("setup_id") WHERE "setup_id" IS NOT NULL;--> statement-breakpoint
-- Kaskada z kasowania sesji backtestu.
CREATE INDEX "trade_plans_session_idx" ON "trade_plans" ("backtest_session_id") WHERE "backtest_session_id" IS NOT NULL;--> statement-breakpoint

CREATE TRIGGER "trade_plans_guard" BEFORE UPDATE ON "trade_plans"
  FOR EACH ROW EXECUTE FUNCTION public.tj_plan_guard();--> statement-breakpoint

CREATE TABLE "trade_plan_addenda" (
  "id" serial PRIMARY KEY,
  "plan_id" integer NOT NULL REFERENCES "trade_plans" ("id") ON DELETE CASCADE,
  "field" text,
  "new_value" jsonb,
  "words_id" integer NOT NULL REFERENCES "user_words" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "trade_plan_addenda_field" CHECK ("field" IS NULL OR "field" IN ('stop_loss', 'take_profit', 'contracts', 'bias', 'invalidation', 'other'))
);--> statement-breakpoint
CREATE INDEX "trade_plan_addenda_plan_idx" ON "trade_plan_addenda" ("plan_id", "created_at");--> statement-breakpoint

CREATE TRIGGER "trade_plan_addenda_immutable" BEFORE UPDATE ON "trade_plan_addenda"
  FOR EACH ROW EXECUTE FUNCTION public.tj_forbid_update();--> statement-breakpoint

-- --- trade_reviews: werdykt niezmienny -------------------------------------------------------

-- Korekta uzytkownika = nowy wiersz kind = 'user_override', ktory wskazuje nadpisywany werdykt AI.
ALTER TABLE "trade_reviews" ADD COLUMN "kind" text NOT NULL DEFAULT 'ai';--> statement-breakpoint
-- NO ACTION: werdykt z korekta nie da sie skasowac osobno (kasowanie trade'u kasuje oba naraz).
ALTER TABLE "trade_reviews" ADD COLUMN "overrides_review_id" integer REFERENCES "trade_reviews" ("id") ON DELETE NO ACTION;--> statement-breakpoint
-- Czas ZEGAROWY wydania werdyktu (nie mylic z evidence_cutoff, czasem RYNKOWYM ostatniej swiecy).
ALTER TABLE "trade_reviews" ADD COLUMN "as_of" timestamptz;--> statement-breakpoint
-- SHA-256 kanonicznego JSON-a dowodow (swiece, sha256 zrzutow) i sam manifest.
ALTER TABLE "trade_reviews" ADD COLUMN "evidence_hash" text;--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD COLUMN "evidence_manifest" jsonb;--> statement-breakpoint
-- Zestaw regul, wzgledem ktorego oceniono (zastepuje brain_version w nowych wierszach).
ALTER TABLE "trade_reviews" ADD COLUMN "ruleset_version" integer;--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD COLUMN "created_by_token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION;--> statement-breakpoint

ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_kind" CHECK ("kind" IN ('ai', 'user_override'));--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_override" CHECK (("kind" = 'user_override') = ("overrides_review_id" IS NOT NULL));--> statement-breakpoint
-- Werdykt z dowodem ma as_of i skrot, werdykt bez dowodu (stary, ADR-028) nie ma ani jednego.
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_as_of_hash" CHECK (("as_of" IS NULL) = ("evidence_hash" IS NULL));--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_evidence_hash" CHECK ("evidence_hash" IS NULL OR "evidence_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_manifest" CHECK ("evidence_manifest" IS NULL OR "evidence_hash" IS NOT NULL);--> statement-breakpoint
-- Korekta tez jest datowana i niezmienna (as_of NOT NULL, a wiec i skrot): zeby nie dalo sie jej
-- podmienic po fakcie. Dla korekty skrot liczy API z kanonicznego JSON-a jej tresci.
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_override_dated" CHECK ("kind" <> 'user_override' OR "as_of" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_ruleset" CHECK ("ruleset_version" IS NULL OR "ruleset_version" >= 0);--> statement-breakpoint

-- Jeden werdykt AI na (trade, podstawa); korekty uzytkownika sie nie licza.
ALTER TABLE "trade_reviews" DROP CONSTRAINT "trade_reviews_trade_basis_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "trade_reviews_trade_basis_uq" ON "trade_reviews" ("trade_id", "basis") WHERE "kind" = 'ai';--> statement-breakpoint
-- Dawny unikat obslugiwal tez kaskade z kasowania trade'u; czesciowy jej nie obsluzy (zapytanie
-- bez warunku kind), wiec osobny indeks.
CREATE INDEX "trade_reviews_trade_idx" ON "trade_reviews" ("trade_id");--> statement-breakpoint
CREATE INDEX "trade_reviews_overrides_idx" ON "trade_reviews" ("overrides_review_id") WHERE "overrides_review_id" IS NOT NULL;--> statement-breakpoint

CREATE TRIGGER "trade_reviews_override_check" BEFORE INSERT ON "trade_reviews"
  FOR EACH ROW WHEN (NEW."overrides_review_id" IS NOT NULL)
  EXECUTE FUNCTION public.tj_review_override_check();--> statement-breakpoint

-- Werdykt z as_of: zadna kolumna nie zmienia sie po zapisie. Stare oceny bez as_of (ADR-028) mozna
-- nadal podmieniac, w tym uzupelnic o as_of (wtedy od razu zamykaja sie na zmiany).
CREATE TRIGGER "trade_reviews_immutable" BEFORE UPDATE ON "trade_reviews"
  FOR EACH ROW WHEN (OLD."as_of" IS NOT NULL)
  EXECUTE FUNCTION public.tj_guard_columns(
    'id', 'trade_id', 'setup_type', 'summary_md', 'lesson', 'basis', 'brain_verdict', 'brain_plan',
    'brain_version', 'evidence_cutoff', 'model', 'created_at', 'kind', 'overrides_review_id', 'as_of',
    'evidence_hash', 'evidence_manifest', 'ruleset_version', 'created_by_token_id'
  );--> statement-breakpoint

-- --- trade_rule_checks ----------------------------------------------------------------------

-- Wersja tej konkretnej reguly. RESTRICT: wersji uzytej w werdykcie nie da sie skasowac.
ALTER TABLE "trade_rule_checks" ADD COLUMN "rule_version_id" integer REFERENCES "rule_versions" ("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "trade_rule_checks_rule_version_idx" ON "trade_rule_checks" ("rule_version_id") WHERE "rule_version_id" IS NOT NULL;--> statement-breakpoint

CREATE TRIGGER "trade_rule_checks_guard" BEFORE INSERT OR UPDATE ON "trade_rule_checks"
  FOR EACH ROW EXECUTE FUNCTION public.tj_rule_check_guard();--> statement-breakpoint

-- --- day_notes: rytual przed sesja + zakresy ocen ----------------------------------------------

ALTER TABLE "day_notes" ADD COLUMN "bias" text;--> statement-breakpoint
ALTER TABLE "day_notes" ADD COLUMN "max_trades" smallint;--> statement-breakpoint
ALTER TABLE "day_notes" ADD COLUMN "sleep" smallint;--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_bias" CHECK ("bias" IS NULL OR "bias" IN ('long', 'short', 'neutral'));--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_max_trades" CHECK ("max_trades" IS NULL OR "max_trades" BETWEEN 1 AND 20);--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_sleep" CHECK ("sleep" IS NULL OR "sleep" BETWEEN 1 AND 5);--> statement-breakpoint

-- Istniejace kolumny: walidacja w przegladarce nie jest zabezpieczeniem, wiec zakres 1-5 tez w bazie.
-- NOT VALID pilnuje nowych i zmienianych wierszy od razu, bez skanowania historii.
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_mood" CHECK ("mood" IS NULL OR "mood" BETWEEN 1 AND 5) NOT VALID;--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_energy" CHECK ("energy" IS NULL OR "energy" BETWEEN 1 AND 5) NOT VALID;--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_day_rating" CHECK ("day_rating" IS NULL OR "day_rating" BETWEEN 1 AND 5) NOT VALID;--> statement-breakpoint

-- Osobna instrukcja walidacji historii. Gdy w danych sa wiersze poza zakresem, migracja NIE pada
-- (to zatrzymaloby start kontenera na produkcji): ograniczenie zostaje NOT VALID, a operator
-- widzi komunikat i poprawia dane. Zapytanie kontrolne:
--   SELECT id, day, mood, energy, day_rating FROM day_notes
--   WHERE mood NOT BETWEEN 1 AND 5 OR energy NOT BETWEEN 1 AND 5 OR day_rating NOT BETWEEN 1 AND 5;
-- po poprawie: ALTER TABLE day_notes VALIDATE CONSTRAINT day_notes_mood (i energy, day_rating).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.day_notes WHERE mood NOT BETWEEN 1 AND 5) THEN
    RAISE NOTICE 'day_notes_mood zostaje NOT VALID: w danych sa oceny poza zakresem 1-5. Napraw dane i wykonaj VALIDATE CONSTRAINT.';
  ELSE
    ALTER TABLE public.day_notes VALIDATE CONSTRAINT day_notes_mood;
  END IF;
  IF EXISTS (SELECT 1 FROM public.day_notes WHERE energy NOT BETWEEN 1 AND 5) THEN
    RAISE NOTICE 'day_notes_energy zostaje NOT VALID: w danych sa oceny poza zakresem 1-5. Napraw dane i wykonaj VALIDATE CONSTRAINT.';
  ELSE
    ALTER TABLE public.day_notes VALIDATE CONSTRAINT day_notes_energy;
  END IF;
  IF EXISTS (SELECT 1 FROM public.day_notes WHERE day_rating NOT BETWEEN 1 AND 5) THEN
    RAISE NOTICE 'day_notes_day_rating zostaje NOT VALID: w danych sa oceny poza zakresem 1-5. Napraw dane i wykonaj VALIDATE CONSTRAINT.';
  ELSE
    ALTER TABLE public.day_notes VALIDATE CONSTRAINT day_notes_day_rating;
  END IF;
END
$$;
