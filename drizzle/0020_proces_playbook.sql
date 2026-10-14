-- Proces i playbook, kolejka AI, dopiski (ADR-033, faza 2b, 2026-10-15).
-- Projekt: docs/v2/model-danych.md, sekcje 5.3 i 5.4; odstepstwa od szkicu: sekcja 14 tego dokumentu.
--
-- Wszystko dokladane (nowe tabele, nowe kolumny NULL / z DEFAULT, nowe CHECK-i). Wyjatek, o ktorym
-- trzeba wiedziec przed wdrozeniem na produkcje: kolumna generowana trades.search (STORED) wymusza
-- JEDNORAZOWE PRZEPISANIE tabeli trades (ACCESS EXCLUSIVE na czas przepisania; przy tysiacach wierszy
-- to sekundy). Przed wdrozeniem kopia bazy (pg_dump). Cofniecie: docs/v2/rollback/0020_down.sql.
--
-- Zaleznosci: 0018 (notes, user_words, rules, rule_versions, funkcje tj_*), 0017 (api_tokens).
--
-- Kody bledow triggerow (jak w 0018): TJ409 niezmiennosc, TJ403 zatwierdzenie spoza UI, TJ422 dane
-- niespojne albo za malo danych (tu: dopisek AI bez podstawy).
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

-- --- Nowe funkcje triggerow ----------------------------------------------------

-- Kolumna, ktora moze byc tylko wyzerowana (wartosc -> NULL), nigdy ustawiona na inna wartosc.
-- Po co: FK ON DELETE SET NULL na wierszu pod ochrona tj_guard_columns zablokowalby kasowanie
-- rodzica (SET NULL to UPDATE chronionej kolumny), a wylaczenie kolumny z ochrony zostawiloby
-- furtke "przepnij dopisek na inny trade". Ta funkcja przepuszcza dokladnie to, co robi FK.
-- Uzycie: EXECUTE FUNCTION public.tj_guard_null_only('kolumna1', 'kolumna2', ...).
CREATE FUNCTION public.tj_guard_null_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_col text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF TG_NARGS < 1 THEN
    RAISE EXCEPTION 'tj_guard_null_only: trigger % na tabeli % nie podaje zadnej kolumny. Naprawa: dopisz nazwy kolumn w argumentach triggera.', TG_NAME, TG_TABLE_NAME;
  END IF;
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF NOT (v_old ? v_col) THEN
      RAISE EXCEPTION 'tj_guard_null_only: tabela % nie ma kolumny % (trigger %). Naprawa: popraw nazwe kolumny w argumentach triggera.', TG_TABLE_NAME, v_col, TG_NAME;
    END IF;
    IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) AND (v_new -> v_col) <> 'null'::jsonb THEN
      RAISE EXCEPTION 'Kolumna % w tabeli % moze byc tylko wyzerowana (przy kasowaniu powiazanego wiersza), a UPDATE ustawia ja na "%" (bylo "%"). Powod: powiazanie jest czescia dowodu i nie wolno go przepiac. Naprawa: dodaj nowy wiersz zamiast przepinac stary.', v_col, TG_TABLE_NAME, v_new ->> v_col, coalesce(v_old ->> v_col, '(brak)')
        USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME, COLUMN = v_col;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Sugestia, ktora zostala rozstrzygnieta, nie wraca do kolejki "pending": decided_at jest
-- dziennikiem decyzji, a powrot do pending by go po cichu wyczyscil (CHECK ai_suggestions_decided
-- wymusilby wtedy decided_at NULL, wiec UPDATE i tak musialby je skasowac).
CREATE FUNCTION public.tj_ai_suggestion_flow() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status <> 'pending' AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'Sugestia #% ma status "%" i nie wraca do "pending". Powod: decyzja (accepted / rejected / applied / reverted) jest wpisem w dzienniku. Naprawa: dodaj nowa sugestie zamiast otwierac stara.', OLD.id, OLD.status
      USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME, COLUMN = 'status';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Dopisek AI musi byc osadzony w danych w chwili ZAPISU: dotyczyc trade'u i miec cytat ze slow
-- uzytkownika albo dowod. To jest trigger INSERT, a nie CHECK, bo kasowanie trade'u zeruje
-- note_additions.trade_id i quote_words_id (SET NULL), a CHECK z tymi kolumnami blokowalby kasowanie.
CREATE FUNCTION public.tj_note_addition_insert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.origin = 'ai' AND (NEW.trade_id IS NULL OR (NEW.quote_words_id IS NULL AND NEW.evidence IS NULL)) THEN
    RAISE EXCEPTION 'Dopisek AI do notatki #% odrzucony: trade_id = %, quote_words_id = %, evidence = %. Powod: dopisek AI musi dotyczyc trade''u i miec cytat ze slow uzytkownika albo dowod. Naprawa: podaj trade_id oraz quote_words_id lub evidence.', NEW.note_id, coalesce(NEW.trade_id::text, 'NULL'), coalesce(NEW.quote_words_id::text, 'NULL'), CASE WHEN NEW.evidence IS NULL THEN 'NULL' ELSE 'jest' END
      USING ERRCODE = 'TJ422', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- --- rule_versions: powod decyzji ------------------------------------------------

-- Powod odrzucenia / adnotacja decyzji. Zmienia sie razem ze statusem, wiec NIE nalezy do kolumn
-- niezmiennych w triggerze rule_versions_immutable (0018).
ALTER TABLE "rule_versions" ADD COLUMN "decision_reason" text;--> statement-breakpoint

-- --- setups ----------------------------------------------------------------------

CREATE TABLE "setups" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  -- Karta setupu: opis i historia (notes.kind = 'setup'). RESTRICT: karty nie da sie osierocic.
  "note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE RESTRICT,
  "retired_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "setups_slug" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  CONSTRAINT "setups_name" CHECK (length("name") BETWEEN 1 AND 120),
  CONSTRAINT "setups_slug_uq" UNIQUE ("slug"),
  CONSTRAINT "setups_note_uq" UNIQUE ("note_id")
);--> statement-breakpoint

CREATE TABLE "setup_versions" (
  "id" serial PRIMARY KEY,
  "setup_id" integer NOT NULL REFERENCES "setups" ("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "status" text NOT NULL,
  -- [{id, text}]: kontekst, bias, sesja.
  "preconditions" jsonb NOT NULL DEFAULT '[]',
  -- [{id, text, rule_code?}].
  "entry_checklist" jsonb NOT NULL DEFAULT '[]',
  "stop_rule" text,
  "target_rule" text,
  "be_rule" text,
  "invalidation" text,
  "avoid" text,
  -- Progi statusu ZADEKLAROWANE Z GORY (min n, granice). Zmiana progu = nowa wersja.
  "thresholds" jsonb NOT NULL,
  "origin" text NOT NULL,
  "counterargument" text,
  "evidence" jsonb,
  "proposed_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz,
  "superseded_at" timestamptz,
  -- Powod odrzucenia / adnotacja decyzji; zmienia sie razem ze statusem (nie jest niezmienna).
  "decision_reason" text,
  "created_by_token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION,
  CONSTRAINT "setup_versions_version" CHECK ("version" >= 1),
  CONSTRAINT "setup_versions_status" CHECK ("status" IN ('proposed', 'approved', 'rejected', 'superseded')),
  CONSTRAINT "setup_versions_origin" CHECK ("origin" IN ('user', 'ai', 'mentor', 'vault-import')),
  CONSTRAINT "setup_versions_preconditions" CHECK (jsonb_typeof("preconditions") = 'array'),
  CONSTRAINT "setup_versions_entry_checklist" CHECK (jsonb_typeof("entry_checklist") = 'array'),
  CONSTRAINT "setup_versions_thresholds" CHECK (jsonb_typeof("thresholds") = 'object'),
  -- Propozycja AI: kontrargument i dowod sa obowiazkowe (MUST 10).
  CONSTRAINT "setup_versions_ai_proof" CHECK (
    "origin" <> 'ai' OR (
      "counterargument" IS NOT NULL AND length("counterargument") > 0 AND "evidence" IS NOT NULL
    )
  ),
  -- Propozycja mentora: bez progu n, ale z cytatem (jak rule_versions_mentor_proof w 0018).
  CONSTRAINT "setup_versions_mentor_proof" CHECK ("origin" <> 'mentor' OR "evidence" IS NOT NULL),
  CONSTRAINT "setup_versions_setup_version_uq" UNIQUE ("setup_id", "version")
);--> statement-breakpoint

-- Jedna obowiazujaca wersja i jedna propozycja naraz na setupie. Drugi indeks obsluguje tez kolejke
-- "Do decyzji" (wszystkie wiersze proposed).
CREATE UNIQUE INDEX "setup_versions_approved_idx" ON "setup_versions" ("setup_id") WHERE "status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "setup_versions_proposed_idx" ON "setup_versions" ("setup_id") WHERE "status" = 'proposed';--> statement-breakpoint

-- Tresc wersji nie zmienia sie nigdy; zmienia sie status, znaczniki decyzji i decision_reason.
CREATE TRIGGER "setup_versions_immutable" BEFORE UPDATE ON "setup_versions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_columns(
    'setup_id', 'version', 'preconditions', 'entry_checklist', 'stop_rule', 'target_rule', 'be_rule',
    'invalidation', 'avoid', 'thresholds', 'origin', 'counterargument', 'evidence', 'proposed_at',
    'created_by_token_id'
  );--> statement-breakpoint

-- Zatwierdzenie, odrzucenie i zastapienie wersji tylko z UI (jak rule_versions_ui_actor w 0018).
CREATE TRIGGER "setup_versions_ui_actor" BEFORE INSERT OR UPDATE ON "setup_versions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_require_ui_actor('status', 'approved', 'rejected', 'superseded');--> statement-breakpoint

-- --- setup_examples: przyklady A+ i anty-przyklady ---------------------------------

CREATE TABLE "setup_examples" (
  "id" serial PRIMARY KEY,
  "setup_id" integer NOT NULL REFERENCES "setups" ("id") ON DELETE CASCADE,
  "trade_id" integer NOT NULL REFERENCES "trades" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "screenshot_id" integer REFERENCES "screenshots" ("id") ON DELETE SET NULL,
  -- DEFERRABLE INITIALLY DEFERRED: przyklad ginie razem z trade'em, tak samo jak slowa z jego
  -- user_words.trade_id; zwykle NO ACTION blokowalo by kasowanie trade'u (uzasadnienie: 0021, trade_plans).
  "caption_words_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  -- 'ai' tylko po zatwierdzeniu sugestii (ai_suggestions).
  "origin" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "setup_examples_kind" CHECK ("kind" IN ('a_plus', 'anti')),
  CONSTRAINT "setup_examples_origin" CHECK ("origin" IN ('user', 'ai')),
  CONSTRAINT "setup_examples_uq" UNIQUE ("setup_id", "trade_id", "kind")
);--> statement-breakpoint
-- Kaskada z kasowania trade'u nie moze skanowac tabeli.
CREATE INDEX "setup_examples_trade_idx" ON "setup_examples" ("trade_id");--> statement-breakpoint

-- --- trade_note_links: trade <-> hipoteza / pojecie / blad / mocna strona -----------
-- Kolumny trade_id, note_id, role sa czytane przez tj_hypothesis_n (0018): nie zmieniac nazw.

CREATE TABLE "trade_note_links" (
  "id" serial PRIMARY KEY,
  "trade_id" integer NOT NULL REFERENCES "trades" ("id") ON DELETE CASCADE,
  "note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "origin" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "trade_note_links_role" CHECK ("role" IN ('hypothesis', 'concept', 'mistake', 'strength', 'other')),
  CONSTRAINT "trade_note_links_origin" CHECK ("origin" IN ('user', 'ai')),
  CONSTRAINT "trade_note_links_uq" UNIQUE ("trade_id", "note_id", "role")
);--> statement-breakpoint
-- Liczenie n hipotezy (tj_hypothesis_n) i lista trade'ow pojecia.
CREATE INDEX "trade_note_links_note_idx" ON "trade_note_links" ("note_id", "role");--> statement-breakpoint

-- --- ai_suggestions: kolejka potwierdzen -------------------------------------------

CREATE TABLE "ai_suggestions" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  -- {"type":"trade","id":123}.
  "target" jsonb NOT NULL,
  "payload" jsonb NOT NULL,
  -- Twierdzenie jednym zdaniem.
  "claim" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "evidence_level" text NOT NULL,
  "n" integer,
  -- Co wstawiono (do cofniecia).
  "applied_ref" jsonb,
  "created_by_token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz,
  CONSTRAINT "ai_suggestions_kind" CHECK ("kind" IN ('tag', 'trade_link', 'setup_example', 'process_grade',
    'profile_term', 'day_conclusion', 'weekly_conclusion', 'strategy_detail')),
  CONSTRAINT "ai_suggestions_status" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'applied', 'reverted')),
  CONSTRAINT "ai_suggestions_target" CHECK (jsonb_typeof("target") = 'object'),
  CONSTRAINT "ai_suggestions_payload" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "ai_suggestions_claim" CHECK (length("claim") > 0),
  -- Twierdzenie bez dowodu nie wejdzie do bazy (MUST 10, metodyka R21).
  CONSTRAINT "ai_suggestions_evidence" CHECK (jsonb_typeof("evidence") = 'array' AND jsonb_array_length("evidence") > 0),
  CONSTRAINT "ai_suggestions_evidence_level" CHECK ("evidence_level" IN ('tested', 'partial', 'inferred')),
  CONSTRAINT "ai_suggestions_n" CHECK ("n" IS NULL OR "n" >= 0),
  CONSTRAINT "ai_suggestions_decided" CHECK (("status" = 'pending') = ("decided_at" IS NULL)),
  -- 'applied' ustawia API wylacznie dla dopiskow do strategii (MUST 15: obserwacja, nie regula).
  -- Wszystkie inne rodzaje moga wejsc w 'accepted' tylko przez UI (trigger ai_suggestions_ui_actor).
  CONSTRAINT "ai_suggestions_applied_kind" CHECK ("status" <> 'applied' OR "kind" = 'strategy_detail')
);--> statement-breakpoint

-- Kolejka "pending" i widok per rodzaj.
CREATE INDEX "ai_suggestions_pending_idx" ON "ai_suggestions" ("created_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "ai_suggestions_kind_status_idx" ON "ai_suggestions" ("kind", "status");--> statement-breakpoint

-- Tresc sugestii jest niezmienna; zmieniaja sie status, decided_at i applied_ref.
CREATE TRIGGER "ai_suggestions_immutable" BEFORE UPDATE ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_columns(
    'id', 'kind', 'target', 'payload', 'claim', 'evidence', 'evidence_level', 'n', 'created_by_token_id',
    'created_at'
  );--> statement-breakpoint

-- Przyjecie, odrzucenie i cofniecie tylko z UI (takze wyjscie z tych stanow). AI proponuje, nie decyduje.
CREATE TRIGGER "ai_suggestions_ui_actor" BEFORE INSERT OR UPDATE ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_require_ui_actor('status', 'accepted', 'rejected', 'reverted');--> statement-breakpoint

CREATE TRIGGER "ai_suggestions_flow" BEFORE UPDATE ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_ai_suggestion_flow();--> statement-breakpoint

-- --- note_additions: dopiski AI i mentora do notatek -------------------------------

CREATE TABLE "note_additions" (
  "id" serial PRIMARY KEY,
  "note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE CASCADE,
  -- Tekst AI / mentora; w UI zawsze podpisany pochodzeniem.
  "body_md" text NOT NULL,
  "origin" text NOT NULL,
  -- Cytat ze slow uzytkownika. SET NULL: slowa przywiazane do trade'u kasuja sie razem z nim
  -- (user_words.trade_id CASCADE), a dopisek ma przezyc; zerowanie pilnuje tj_guard_null_only.
  "quote_words_id" integer REFERENCES "user_words" ("id") ON DELETE SET NULL,
  -- SET NULL: dopisek przezywa skasowanie trade'u (zerowanie pilnuje tj_guard_null_only).
  "trade_id" integer REFERENCES "trades" ("id") ON DELETE SET NULL,
  "evidence" jsonb,
  -- NO ACTION, nie SET NULL (model: SET NULL): kolumna jest chroniona przez tj_guard_columns.
  "suggestion_id" integer REFERENCES "ai_suggestions" ("id") ON DELETE NO ACTION,
  -- mentor_claim_id dochodzi w 0027 (mentor_claims powstaje pozniej).
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "reverted_at" timestamptz,
  CONSTRAINT "note_additions_body" CHECK (length("body_md") > 0),
  CONSTRAINT "note_additions_origin" CHECK ("origin" IN ('ai', 'mentor'))
);--> statement-breakpoint

-- Dopiski aktywne danej notatki.
CREATE INDEX "note_additions_note_idx" ON "note_additions" ("note_id") WHERE "reverted_at" IS NULL;--> statement-breakpoint
-- Zerowanie trade_id przy kasowaniu trade'u nie moze skanowac tabeli.
CREATE INDEX "note_additions_trade_idx" ON "note_additions" ("trade_id") WHERE "trade_id" IS NOT NULL;--> statement-breakpoint
-- Zerowanie quote_words_id przy kasowaniu slow.
CREATE INDEX "note_additions_quote_idx" ON "note_additions" ("quote_words_id") WHERE "quote_words_id" IS NOT NULL;--> statement-breakpoint

CREATE TRIGGER "note_additions_insert_check" BEFORE INSERT ON "note_additions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_note_addition_insert();--> statement-breakpoint

-- Zmienia sie tylko reverted_at; trade_id i quote_words_id wolno jedynie wyzerowac (kaskada FK).
CREATE TRIGGER "note_additions_immutable" BEFORE UPDATE ON "note_additions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_columns(
    'id', 'note_id', 'body_md', 'origin', 'evidence', 'suggestion_id', 'created_at'
  );--> statement-breakpoint
CREATE TRIGGER "note_additions_null_only" BEFORE UPDATE ON "note_additions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_null_only('trade_id', 'quote_words_id');--> statement-breakpoint

-- --- trades: proces, wersje, wyszukiwanie ------------------------------------------

-- Kolejnosc: najpierw tabele, do ktorych odwoluja sie nowe FK.
-- Ocena procesu A / B / C osobno od wyniku; NULL = nieocenione.
ALTER TABLE "trades" ADD COLUMN "process_grade" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "process_graded_at" timestamptz;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "setup_id" integer REFERENCES "setups" ("id") ON DELETE SET NULL;--> statement-breakpoint
-- Wersja setupu w chwili decyzji, zapisywana raz.
ALTER TABLE "trades" ADD COLUMN "setup_version_id" integer REFERENCES "setup_versions" ("id") ON DELETE SET NULL;--> statement-breakpoint
-- Zestaw regul w chwili wejscia; NULL dla historii sprzed v2.
ALTER TABLE "trades" ADD COLUMN "ruleset_version" integer;--> statement-breakpoint
-- Metodyka R15: trade z replayu, trader rozpoznal dzien.
ALTER TABLE "trades" ADD COLUMN "day_known" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- Ctrl+K: notatka i opis samopoczucia. Kolumny data_source NIE MA - zrodlo danych jest wyliczane
-- (Slowa uzytkownika 14.10.2026: "Wyliczane", ADR-033).
ALTER TABLE "trades" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (
  to_tsvector('simple', public.f_unaccent(coalesce("note", '') || ' ' || coalesce("mood_note", '')))
) STORED;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_process_grade" CHECK ("process_grade" IS NULL OR "process_grade" IN ('A', 'B', 'C'));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_process_graded" CHECK (("process_grade" IS NULL) = ("process_graded_at" IS NULL));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_ruleset_version" CHECK ("ruleset_version" IS NULL OR "ruleset_version" >= 0);--> statement-breakpoint
CREATE INDEX "trades_search_idx" ON "trades" USING gin ("search");--> statement-breakpoint
-- Statystyki per setup oraz zerowanie przy kasowaniu setupu / wersji.
CREATE INDEX "trades_setup_idx" ON "trades" ("setup_id") WHERE "setup_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "trades_setup_version_idx" ON "trades" ("setup_version_id") WHERE "setup_version_id" IS NOT NULL;--> statement-breakpoint
-- Siatka procesu 2x2 liczy tylko trade'y ocenione.
CREATE INDEX "trades_process_grade_idx" ON "trades" ("process_grade") WHERE "process_grade" IS NOT NULL;--> statement-breakpoint

-- --- trade_tags: pochodzenie przypisania -------------------------------------------
-- 'ai' tylko po zatwierdzeniu sugestii; istniejace wiersze to 'user'.
ALTER TABLE "trade_tags" ADD COLUMN "origin" text NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_origin" CHECK ("origin" IN ('user', 'ai'));
