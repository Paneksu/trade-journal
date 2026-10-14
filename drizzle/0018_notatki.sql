-- Notatki w aplikacji, slowa uzytkownika, reguly i hipotezy (ADR-029, ADR-030, ADR-033; 2026-10-14).
-- Projekt: docs/v2/model-danych.md, sekcje 2, 4.1 - 4.4, 6, 7, 8. Odstepstwa od szkicu:
-- koniec tego pliku oraz sekcja "Odstepstwa od szkicu w migracjach 0017-0018" w modelu.
--
-- Wszystko dokladane. Jedyna zmiana istniejacego ograniczenia: screenshots_owner
-- (rozszerzenie z "dokladnie jedno z dwoch" na "dokladnie jedno z trzech"; stare
-- wiersze je spelniaja). Cofniecie: docs/v2/rollback/0018_down.sql.
--
-- Zaleznosci: 0017 (api_tokens) - FK created_by_token_id. 0016 NIE jest potrzebne.
--
-- Funkcja tj_forbid_update() powstala w 0016 (faza 1, auth_events) jako CREATE FUNCTION. Ta migracja
-- potrzebuje jej dla note_revisions i NADPISUJE ja przez CREATE OR REPLACE wersja o tym samym
-- zachowaniu (kod TJ409), z dopiskiem TABLE w bledzie. Po 0016 -> 0018 obowiazuje ta definicja;
-- bez 0016 (swieza galaz fazy 2) CREATE OR REPLACE po prostu ja tworzy. Test migracje-v2.db.test.ts
-- pilnuje, ze oba triggery (auth_events, note_revisions) odrzucaja UPDATE tym samym kodem.
--
-- Konwencje wspolnych funkcji triggerow (SQLSTATE wlasne, API mapuje je bez parsowania tekstu):
--   TJ409 - naruszenie niezmiennosci (-> HTTP 409)
--   TJ403 - zatwierdzenie spoza sesji UI (-> HTTP 403)
--   TJ422 - bramka progu n dla propozycji AI (-> HTTP 422); trzeci kod ponad model,
--           bo ani 409 ani 403 nie opisuja "za malo danych"
-- Komunikaty: co sie stalo + dlaczego + jak naprawic. Surowy tekst trafia do logow,
-- klient dostaje tlumaczenie z API.
--
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- unaccent() jest STABLE, wiec nie wolno jej uzyc w kolumnie generowanej ani w indeksie.
-- Opakowanie IMMUTABLE ze slownikiem i schematem podanym WPROST: pg_dump/pg_restore ustawia
-- pusty search_path, a goly 'unaccent' w ciele funkcji wtedy nie istnieje.
-- UWAGA: zmiana definicji po wdrozeniu wymaga przebudowy kolumn generowanych i indeksow.
CREATE FUNCTION public.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint

-- --- Wspolne funkcje triggerow ------------------------------------------------

-- Tabele tylko-do-dopisywania: kazdy UPDATE jest bledem. DELETE nie jest blokowany
-- (kaskady z kasowania trade'u w UI musza dzialac).
CREATE OR REPLACE FUNCTION public.tj_forbid_update() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % jest tylko do dopisywania, wiec wiersza nie wolno zmienic. Powod: wpisy tej tabeli sa dowodem i historia. Naprawa: dodaj nowy wiersz zamiast zmieniac stary.', TG_TABLE_NAME
    USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME;
END
$$;--> statement-breakpoint

-- UPDATE zmieniajacy ktorakolwiek z kolumn podanych w argumentach triggera -> TJ409.
-- Uzycie: EXECUTE FUNCTION public.tj_guard_columns('kolumna1', 'kolumna2', ...).
-- Literowka w nazwie kolumny nie moze po cichu wylaczyc ochrony, wiec nieistniejaca
-- kolumna to blad przy pierwszym UPDATE (kazdy UPDATE sprawdza wszystkie argumenty).
CREATE FUNCTION public.tj_guard_columns() RETURNS trigger
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
    RAISE EXCEPTION 'tj_guard_columns: trigger % na tabeli % nie podaje zadnej kolumny. Naprawa: dopisz nazwy kolumn w argumentach triggera.', TG_NAME, TG_TABLE_NAME;
  END IF;
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF NOT (v_old ? v_col) THEN
      RAISE EXCEPTION 'tj_guard_columns: tabela % nie ma kolumny % (trigger %). Naprawa: popraw nazwe kolumny w argumentach triggera.', TG_TABLE_NAME, v_col, TG_NAME;
    END IF;
    IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
      RAISE EXCEPTION 'Kolumna % w tabeli % jest niezmienna po zapisaniu. Powod: to tresc albo dowod, ktorego nie wolno podmienic. Naprawa: dodaj nowy wiersz lub nowa wersje zamiast edytowac stary.', v_col, TG_TABLE_NAME
        USING ERRCODE = 'TJ409', TABLE = TG_TABLE_NAME, COLUMN = v_col;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Zatwierdzenia tylko z sesji UI (tj.actor = 'ui'). Argumenty triggera:
--   pierwszy  - nazwa kolumny stanu (np. 'status', 'decision'),
--   kolejne   - stany strzezone (np. 'approved', 'rejected'); brak = kazda zmiana kolumny.
-- Strzezone jest wejscie W stan strzezony oraz wyjscie Z niego (agent nie cofnie
-- zatwierdzenia). Na INSERT liczy sie wartosc wstawiana. Wyjatku dla importu nie ma.
CREATE FUNCTION public.tj_require_ui_actor() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_col text;
  v_guarded text[] := '{}';
  v_old text;
  v_new text;
  v_actor text;
  i integer;
BEGIN
  IF TG_NARGS < 1 THEN
    RAISE EXCEPTION 'tj_require_ui_actor: trigger % na tabeli % nie podaje kolumny stanu. Naprawa: dopisz nazwe kolumny w argumentach triggera.', TG_NAME, TG_TABLE_NAME;
  END IF;
  v_col := TG_ARGV[0];
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    v_guarded := v_guarded || TG_ARGV[i];
  END LOOP;
  IF NOT (to_jsonb(NEW) ? v_col) THEN
    RAISE EXCEPTION 'tj_require_ui_actor: tabela % nie ma kolumny % (trigger %). Naprawa: popraw nazwe kolumny w argumentach triggera.', TG_TABLE_NAME, v_col, TG_NAME;
  END IF;
  v_new := to_jsonb(NEW) ->> v_col;
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD) ->> v_col;
    IF v_old IS NOT DISTINCT FROM v_new THEN
      RETURN NEW;
    END IF;
  END IF;
  IF cardinality(v_guarded) > 0
     AND NOT coalesce(v_new = ANY (v_guarded), false)
     AND NOT coalesce(v_old = ANY (v_guarded), false) THEN
    RETURN NEW;
  END IF;
  v_actor := nullif(current_setting('tj.actor', true), '');
  IF v_actor IS DISTINCT FROM 'ui' THEN
    RAISE EXCEPTION 'Zmiana pola % w tabeli % (z "%" na "%") wymaga zatwierdzenia przez uzytkownika w interfejsie, a zapis przyszedl od aktora "%". Powod: agent moze tylko proponowac. Naprawa: zostaw wiersz jako propozycje; uzytkownik zatwierdzi go w UI.', v_col, TG_TABLE_NAME, coalesce(v_old, '(brak)'), coalesce(v_new, '(brak)'), coalesce(v_actor, '(nieustawiony)')
      USING ERRCODE = 'TJ403', TABLE = TG_TABLE_NAME, COLUMN = v_col;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- --- notes -------------------------------------------------------------------

CREATE TABLE "notes" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL,
  -- ASCII z tytulu, do adresow.
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "body_md" text NOT NULL DEFAULT '',
  "meta" jsonb NOT NULL DEFAULT '{}',
  "origin" text NOT NULL DEFAULT 'user',
  -- Notatka przezywa skasowanie trade'u / sesji. notes nie jest tabela niezmienna,
  -- a trigger tj_note_revision nie tworzy rewizji przy zmianie samych kotwic.
  "trade_id" integer REFERENCES "trades" ("id") ON DELETE SET NULL,
  "backtest_session_id" integer REFERENCES "backtest_sessions" ("id") ON DELETE SET NULL,
  "day" date,
  -- 'vault:<sciezka>' (import), 'mentor:<video_id>'.
  "external_ref" text,
  -- sha256(body_md w bajtach UTF-8) liczy trigger; DEFAULT '' tylko po to, by INSERT
  -- mogl go pominac (bez triggera CHECK odrzuci pusty ciag).
  "content_hash" text NOT NULL DEFAULT '',
  -- If-Match; podbija trigger przy zmianie title / body_md / meta.
  "rev" integer NOT NULL DEFAULT 1,
  "archived_at" timestamptz,
  "created_by_token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "search" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', public.f_unaccent("title")), 'A') ||
    setweight(to_tsvector('simple', public.f_unaccent("body_md")), 'B')
  ) STORED,
  CONSTRAINT "notes_kind" CHECK ("kind" IN ('system', 'concept', 'rule', 'decision_proc', 'trade_note', 'session',
    'hypothesis', 'mistake', 'strength', 'brain_decision', 'learning', 'profile', 'strategy', 'setup')),
  CONSTRAINT "notes_slug" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  CONSTRAINT "notes_title" CHECK (length("title") BETWEEN 1 AND 200),
  CONSTRAINT "notes_origin" CHECK ("origin" IN ('user', 'ai', 'mentor', 'vault-import')),
  CONSTRAINT "notes_content_hash" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "notes_rev" CHECK ("rev" >= 1),
  CONSTRAINT "notes_slug_uq" UNIQUE ("slug")
);--> statement-breakpoint

CREATE UNIQUE INDEX "notes_external_ref_idx" ON "notes" ("external_ref") WHERE "external_ref" IS NOT NULL;--> statement-breakpoint
-- [[Tytul]] rozwiazuje sie po tytule jak w Obsidianie: "Zarzadzanie" i "zarzadzanie" to ta sama notatka.
CREATE UNIQUE INDEX "notes_title_norm_idx" ON "notes" ((lower(public.f_unaccent("title"))));--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin ("search");--> statement-breakpoint
CREATE INDEX "notes_title_trgm_idx" ON "notes" USING gin ((lower(public.f_unaccent("title"))) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notes_body_trgm_idx" ON "notes" USING gin ((lower(public.f_unaccent("body_md"))) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notes_kind_idx" ON "notes" ("kind");--> statement-breakpoint
CREATE INDEX "notes_trade_idx" ON "notes" ("trade_id") WHERE "trade_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notes_day_idx" ON "notes" ("day") WHERE "day" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notes_session_idx" ON "notes" ("backtest_session_id") WHERE "backtest_session_id" IS NOT NULL;--> statement-breakpoint

-- --- note_revisions: historia tresci, tylko dopisywanie ----------------------

CREATE TABLE "note_revisions" (
  "id" serial PRIMARY KEY,
  "note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE CASCADE,
  -- Numer rewizji, ktora ten wiersz zachowuje (czyli OLD.rev w chwili zmiany).
  "rev" integer NOT NULL,
  "title" text NOT NULL,
  "body_md" text NOT NULL,
  "meta" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  -- Aktor transakcji, ktora ZASTAPILA te tresc nowa (current_setting('tj.actor')).
  "actor" text NOT NULL,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "note_revisions_content_hash" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "note_revisions_note_rev_uq" UNIQUE ("note_id", "rev")
);--> statement-breakpoint

CREATE TRIGGER "note_revisions_immutable" BEFORE UPDATE ON "note_revisions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_forbid_update();--> statement-breakpoint

-- INSERT: ustawia rev = 1 i content_hash. UPDATE zmieniajacy title / body_md / meta:
-- zapisuje OLD w note_revisions, podbija rev, przelicza content_hash i updated_at.
-- UPDATE niczego z tych trzech (archiwizacja, zmiana kotwic, SET NULL z FK) nie tworzy
-- rewizji i nie rusza rev ani content_hash. Aktor nieustawiony zapisuje sie jako 'unknown'
-- (zapis tresci nie moze sie nie udac z powodu braku etykiety; brak etykiety widac w historii).
CREATE FUNCTION public.tj_note_revision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.rev := 1;
    NEW.content_hash := encode(sha256(convert_to(NEW.body_md, 'UTF8')), 'hex');
    RETURN NEW;
  END IF;
  IF NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.body_md IS NOT DISTINCT FROM OLD.body_md
     AND NEW.meta IS NOT DISTINCT FROM OLD.meta THEN
    NEW.rev := OLD.rev;
    NEW.content_hash := OLD.content_hash;
    RETURN NEW;
  END IF;
  INSERT INTO public.note_revisions (note_id, rev, title, body_md, meta, content_hash, actor)
  VALUES (OLD.id, OLD.rev, OLD.title, OLD.body_md, OLD.meta, OLD.content_hash,
          coalesce(nullif(current_setting('tj.actor', true), ''), 'unknown'));
  NEW.rev := OLD.rev + 1;
  NEW.content_hash := encode(sha256(convert_to(NEW.body_md, 'UTF8')), 'hex');
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "notes_revision" BEFORE INSERT OR UPDATE ON "notes"
  FOR EACH ROW EXECUTE FUNCTION public.tj_note_revision();--> statement-breakpoint

-- --- note_links: [[...]] z tresci notatek -------------------------------------

CREATE TABLE "note_links" (
  "id" serial PRIMARY KEY,
  "from_note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE CASCADE,
  -- Surowa tresc [[...]] bez aliasu po "|". (ADR-029 mowi o to_slug, model o target: trzymamy sie modelu.)
  "target" text NOT NULL,
  -- NULL = notatki jeszcze nie ma; dowiazuje sie, gdy powstanie.
  "to_note_id" integer REFERENCES "notes" ("id") ON DELETE SET NULL,
  CONSTRAINT "note_links_target" CHECK (length("target") > 0),
  CONSTRAINT "note_links_from_target_uq" UNIQUE ("from_note_id", "target")
);--> statement-breakpoint
CREATE INDEX "note_links_to_idx" ON "note_links" ("to_note_id");--> statement-breakpoint
CREATE INDEX "note_links_unresolved_idx" ON "note_links" ((lower(public.f_unaccent("target")))) WHERE "to_note_id" IS NULL;--> statement-breakpoint

-- --- user_words: slowa uzytkownika doslownie -----------------------------------

CREATE TABLE "user_words" (
  "id" serial PRIMARY KEY,
  -- Bajt w bajt: bez trim, bez NFC, bez zamiany CRLF.
  "text" text NOT NULL,
  -- Skrot i dlugosc w bajtach liczy trigger tj_user_words_hash, nigdy klient; DEFAULT-y
  -- tylko po to, by INSERT mogl je pominac (bez triggera CHECK odrzuci pusty ciag).
  "sha256" text NOT NULL DEFAULT '',
  "byte_len" integer NOT NULL DEFAULT 0,
  "source" text NOT NULL,
  -- Czym jest ten tekst: 'trade.note', 'plan.thesis', 'day.invalidation', 'correction', ... (lista w kodzie).
  "role" text,
  "trade_id" integer REFERENCES "trades" ("id") ON DELETE CASCADE,
  "note_id" integer REFERENCES "notes" ("id") ON DELETE CASCADE,
  "backtest_session_id" integer REFERENCES "backtest_sessions" ("id") ON DELETE CASCADE,
  "day" date,
  -- Kiedy uzytkownik to napisal (z klienta).
  "captured_at" timestamptz NOT NULL,
  -- JEDYNA zmienna tresc wiersza; w UI zawsze "interpretacja AI".
  "ai_interpretation" text,
  "interpretation_model" text,
  "interpretation_at" timestamptz,
  -- Poprawka w UI = nowy wiersz wskazujacy stary. NO ACTION, nigdy SET NULL (tabela niezmienna).
  "supersedes_id" integer REFERENCES "user_words" ("id") ON DELETE NO ACTION,
  "created_by_token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', public.f_unaccent("text"))) STORED,
  CONSTRAINT "user_words_text" CHECK (length("text") > 0),
  CONSTRAINT "user_words_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "user_words_byte_len" CHECK ("byte_len" > 0),
  CONSTRAINT "user_words_source" CHECK ("source" IN ('chat', 'note', 'chart', 'ui', 'mobile', 'vault-import'))
);--> statement-breakpoint

CREATE INDEX "user_words_search_idx" ON "user_words" USING gin ("search");--> statement-breakpoint
CREATE INDEX "user_words_trade_idx" ON "user_words" ("trade_id") WHERE "trade_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_words_note_idx" ON "user_words" ("note_id") WHERE "note_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_words_session_idx" ON "user_words" ("backtest_session_id") WHERE "backtest_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_words_day_idx" ON "user_words" ("day") WHERE "day" IS NOT NULL;--> statement-breakpoint
-- Jedna poprawka na wersje.
CREATE UNIQUE INDEX "user_words_supersedes_idx" ON "user_words" ("supersedes_id") WHERE "supersedes_id" IS NOT NULL;--> statement-breakpoint

-- Skrot z bajtow UTF-8 (convert_to), nie z reprezentacji w sesji. Trigger NIE ufa wartosci
-- od klienta: nadpisuje sha256 i byte_len wlasnymi. Niezgodnosc ze skrotem klienta
-- wykrywa API PRZED INSERT-em (ADR-030, "tekst nie zmienil sie w drodze"); baza jest
-- ostatnia linia obrony, ktora gwarantuje, ze zapisany skrot zawsze opisuje zapisany tekst.
CREATE FUNCTION public.tj_user_words_hash() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_bytes bytea;
BEGIN
  v_bytes := convert_to(NEW."text", 'UTF8');
  NEW.sha256 := encode(sha256(v_bytes), 'hex');
  NEW.byte_len := octet_length(v_bytes);
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "user_words_hash" BEFORE INSERT ON "user_words"
  FOR EACH ROW EXECUTE FUNCTION public.tj_user_words_hash();--> statement-breakpoint

-- Zmienne zostaja: ai_interpretation, interpretation_model, interpretation_at.
CREATE TRIGGER "user_words_immutable" BEFORE UPDATE ON "user_words"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_columns(
    'id', 'text', 'sha256', 'byte_len', 'source', 'role', 'captured_at', 'trade_id', 'note_id',
    'backtest_session_id', 'day', 'supersedes_id', 'created_by_token_id', 'created_at'
  );--> statement-breakpoint

-- --- hypotheses ------------------------------------------------------------

CREATE TABLE "hypotheses" (
  "id" serial PRIMARY KEY,
  "code" text NOT NULL,
  "note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE RESTRICT,
  -- Decyzja czlowieka; faza hipotezy i status statystyczny sa wyliczane (stats-ci.ts).
  "decision" text NOT NULL DEFAULT 'active',
  "prog_n" integer NOT NULL DEFAULT 20,
  "thresholds" jsonb NOT NULL DEFAULT '{}',
  -- n z sejfu sprzed aplikacji.
  "n_imported" integer NOT NULL DEFAULT 0,
  "declared_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz,
  CONSTRAINT "hypotheses_code" CHECK ("code" ~ '^H-[0-9]{3,}$'),
  CONSTRAINT "hypotheses_decision" CHECK ("decision" IN ('active', 'confirmed', 'rejected', 'abandoned')),
  CONSTRAINT "hypotheses_prog_n" CHECK ("prog_n" >= 1),
  CONSTRAINT "hypotheses_n_imported" CHECK ("n_imported" >= 0),
  CONSTRAINT "hypotheses_code_uq" UNIQUE ("code"),
  CONSTRAINT "hypotheses_note_uq" UNIQUE ("note_id")
);--> statement-breakpoint

-- Decyzja o hipotezie tylko z UI: kazda zmiana kolumny decision, a przy INSERT kazda
-- wartosc inna niz domyslna 'active' (agent moze zalozyc hipoteze aktywna, nie potwierdzona).
CREATE TRIGGER "hypotheses_decision_update" BEFORE UPDATE ON "hypotheses"
  FOR EACH ROW WHEN (OLD."decision" IS DISTINCT FROM NEW."decision")
  EXECUTE FUNCTION public.tj_require_ui_actor('decision');--> statement-breakpoint
CREATE TRIGGER "hypotheses_decision_insert" BEFORE INSERT ON "hypotheses"
  FOR EACH ROW WHEN (NEW."decision" <> 'active')
  EXECUTE FUNCTION public.tj_require_ui_actor('decision');--> statement-breakpoint

-- --- rules -------------------------------------------------------------------

CREATE TABLE "rules" (
  "id" serial PRIMARY KEY,
  "code" text NOT NULL,
  "note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE RESTRICT,
  -- Twarda regula -> wskaznik dyscypliny.
  "hard" boolean NOT NULL DEFAULT false,
  "retired_at" timestamptz,
  "retired_in_ruleset" integer,
  "retired_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "rules_code" CHECK ("code" ~ '^R-[0-9]{3,}$'),
  CONSTRAINT "rules_retired" CHECK (("retired_at" IS NULL) = ("retired_in_ruleset" IS NULL)),
  CONSTRAINT "rules_code_uq" UNIQUE ("code"),
  CONSTRAINT "rules_note_uq" UNIQUE ("note_id")
);--> statement-breakpoint

-- --- rule_versions ---------------------------------------------------------------

CREATE TABLE "rule_versions" (
  "id" serial PRIMARY KEY,
  "rule_id" integer NOT NULL REFERENCES "rules" ("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "text_md" text NOT NULL,
  "status" text NOT NULL,
  "origin" text NOT NULL,
  -- Najsilniejszy kontrargument (MUST 10).
  "counterargument" text,
  -- Trade'y, swiece, zrzuty, poziom dowodu, n.
  "evidence" jsonb,
  -- Podstawa propozycji AI. RESTRICT: hipotezy z reguly nie da sie skasowac.
  "hypothesis_id" integer REFERENCES "hypotheses" ("id") ON DELETE RESTRICT,
  -- Numer zestawu nadany przy zatwierdzeniu.
  "ruleset_version" integer,
  "proposed_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz,
  "superseded_at" timestamptz,
  "created_by_token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION,
  CONSTRAINT "rule_versions_version" CHECK ("version" >= 1),
  CONSTRAINT "rule_versions_text" CHECK (length("text_md") > 0),
  CONSTRAINT "rule_versions_status" CHECK ("status" IN ('proposed', 'approved', 'rejected', 'superseded')),
  CONSTRAINT "rule_versions_origin" CHECK ("origin" IN ('user', 'ai', 'mentor', 'vault-import')),
  -- Propozycja AI: kontrargument, dowod i hipoteza sa obowiazkowe (a prog n pilnuje trigger).
  CONSTRAINT "rule_versions_ai_proof" CHECK (
    "origin" <> 'ai' OR (
      "counterargument" IS NOT NULL AND length("counterargument") > 0
      AND "evidence" IS NOT NULL AND "hypothesis_id" IS NOT NULL
    )
  ),
  -- Propozycja mentora: bez progu n (Slowa uzytkownika 14.10.2026: "Bez progu, podpisane n=0"), ale z cytatem.
  CONSTRAINT "rule_versions_mentor_proof" CHECK ("origin" <> 'mentor' OR "evidence" IS NOT NULL),
  CONSTRAINT "rule_versions_ruleset" CHECK (("status" IN ('approved', 'superseded')) = ("ruleset_version" IS NOT NULL)),
  CONSTRAINT "rule_versions_rule_version_uq" UNIQUE ("rule_id", "version")
);--> statement-breakpoint

-- Jedna obowiazujaca wersja i jedna propozycja naraz na regule. Ten drugi indeks obsluguje tez
-- kolejke "Do decyzji" (wszystkie wiersze proposed), wiec osobnego indeksu na status nie ma.
CREATE UNIQUE INDEX "rule_versions_approved_idx" ON "rule_versions" ("rule_id") WHERE "status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "rule_versions_proposed_idx" ON "rule_versions" ("rule_id") WHERE "status" = 'proposed';--> statement-breakpoint

-- n hipotezy = n_imported + liczba trade'ow zamknietych podpietych do jej notatki
-- (trade_note_links, role = 'hypothesis'; bariera closedOnly z ADR-024).
-- trade_note_links powstaje dopiero w 0020, wiec funkcja pyta o nia dynamicznie: dopoki
-- tabeli nie ma, n = n_imported + 0. Po 0020 ta sama funkcja zaczyna liczyc linki bez
-- zadnej redefinicji (zalecane zamiast CREATE OR REPLACE w 0020: brak ukrytego sprzezenia
-- migracji i brak ryzyka, ze zapomniana redefinicja po cichu zablokuje propozycje AI).
-- Jesli 0020 nada tej tabeli inne nazwy kolumn niz w modelu (trade_id, note_id, role),
-- trzeba ja zmienic tutaj, a test migracje-v2.db.test.ts to wykryje.
CREATE FUNCTION public.tj_hypothesis_n(p_hypothesis_id integer) RETURNS integer
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  v_imported integer;
  v_note integer;
  v_linked bigint := 0;
BEGIN
  SELECT h.n_imported, h.note_id INTO v_imported, v_note
    FROM public.hypotheses h WHERE h.id = p_hypothesis_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF to_regclass('public.trade_note_links') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.trade_note_links l JOIN public.trades t ON t.id = l.trade_id WHERE l.note_id = $1 AND l.role = ''hypothesis'' AND t.status::text = ''closed'''
      INTO v_linked USING v_note;
  END IF;
  RETURN v_imported + v_linked::integer;
END
$$;--> statement-breakpoint

-- Bramka: AI nie proponuje reguly z hipotezy ponizej progu n. Tylko origin = 'ai'
-- (mentor, uzytkownik i import sejfu bez progu). Brak hipotezy w wierszu ai lapie
-- CHECK rule_versions_ai_proof (BEFORE trigger go nie zastapi).
CREATE FUNCTION public.tj_rule_version_gate() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_prog integer;
  v_n integer;
BEGIN
  IF NEW.origin <> 'ai' OR NEW.hypothesis_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT h.prog_n INTO v_prog FROM public.hypotheses h WHERE h.id = NEW.hypothesis_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_n := public.tj_hypothesis_n(NEW.hypothesis_id);
  IF v_n < v_prog THEN
    RAISE EXCEPTION 'Propozycja reguly od AI odrzucona: hipoteza ma n = % przy progu %. Powod: ponizej progu danych AI nie proponuje reguly. Naprawa: poczekaj na kolejne trade''y tej hipotezy albo niech regule zaproponuje uzytkownik.', v_n, v_prog
      USING ERRCODE = 'TJ422', TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "rule_versions_n_gate" BEFORE INSERT ON "rule_versions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_rule_version_gate();--> statement-breakpoint

-- Tresc wersji nie zmienia sie nigdy; zmienia sie tylko status (i znaczniki decyzji).
CREATE TRIGGER "rule_versions_immutable" BEFORE UPDATE ON "rule_versions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_guard_columns(
    'rule_id', 'version', 'text_md', 'origin', 'counterargument', 'evidence', 'hypothesis_id',
    'proposed_at', 'created_by_token_id'
  );--> statement-breakpoint

-- Zatwierdzenie, odrzucenie i zastapienie wersji tylko z UI. Bez wyjatku dla importu:
-- reguly z sejfu wchodza jako status 'proposed', origin 'vault-import'.
CREATE TRIGGER "rule_versions_ui_actor" BEFORE INSERT OR UPDATE ON "rule_versions"
  FOR EACH ROW EXECUTE FUNCTION public.tj_require_ui_actor('status', 'approved', 'rejected', 'superseded');--> statement-breakpoint

-- --- screenshots: zrzut pod notatka ---------------------------------------------

ALTER TABLE "screenshots" ADD COLUMN "note_id" integer REFERENCES "notes" ("id") ON DELETE CASCADE;--> statement-breakpoint
-- SHA-256 bajtow pliku WGRANEGO (przed konwersja do WebP); stare wiersze: NULL.
ALTER TABLE "screenshots" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "screenshots" ADD COLUMN "captured_at" timestamptz;--> statement-breakpoint
ALTER TABLE "screenshots" ADD COLUMN "chart_state" jsonb;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_sha256" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "screenshots" DROP CONSTRAINT "screenshots_owner";--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_owner" CHECK (num_nonnulls("trade_id", "day_note_id", "note_id") = 1);--> statement-breakpoint
CREATE INDEX "screenshots_note_idx" ON "screenshots" ("note_id") WHERE "note_id" IS NOT NULL;--> statement-breakpoint

-- --- settings: numer zestawu regul --------------------------------------------------

ALTER TABLE "settings" ADD COLUMN "ruleset_version" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ruleset_version" CHECK ("ruleset_version" >= 0);
