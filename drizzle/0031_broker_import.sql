-- Dane brokera: eksport z platformy -> jeden wlot (ADR-034, etap A, 2026-10-16). Konta prop tylko do odczytu: dziennik
-- niczego nie wysyla do brokera, zna tylko FORMAT PLIKU i konto u brokera (jako HMAC + 4 ostatnie znaki).
-- Slowa uzytkownika (16.10.2026): «Tak, akceptuje» (automat stosuje dopasowania 1:1 z "Cofnij"), «Przycisk z podgladem»,
-- «Kilka naraz» (aktywne konto dnia jest wielokrotne).
--
-- Co robi ta migracja:
--   * prop_firm_platforms  - lista firm i platform jako DANE (sama tabela; wiersze: 0032);
--   * broker_accounts      - konto u brokera <-> konto dziennika. account_id moze byc NULL: konto, ktore przyszlo z automatu
--                            i czeka na przypisanie w UI (inbox nie umie przypisywac kont, ADR-034 pkt 3);
--   * broker_imports       - jeden wiersz na plik (SHA-256, liczniki, ostrzezenia); status committed / reverted / rejected;
--   * broker_trades        - trade'y brokera zgrupowane z wypelnien, z dopasowaniem do trade'u dziennika;
--   * broker_fills         - wypelnienia (zlecenia z Orders) z `raw` BEZ numeru konta;
--   * broker_cash_events   - zdarzenia Cash History (prowizje, wynik brutto pary, wplaty); osobna tabela, bo Cash
--                            History moze przyjsc przed Orders albo po nich (odstepstwo od szkicu w model-danych 5.10);
--   * day_accounts        - aktywne konta dnia, wielokrotne (przeniesione z 0030 wg zlecenia: model-danych 5.10 mialo je w 0030);
--   * triggery: zapis do tabel brokera TYLKO z aktorem `ui` albo `api:<id>` tokenu, ktorego jedynym zakresem jest
--     `import_broker` (agent z `read`/`write`/`propose` dostaje TJ403); trade z source = 'broker' tylko z aktorem `ui`;
--   * zakres `import_broker` w CHECK api_tokens (wylacznie samodzielny, tylko created_via = 'ui', zawsze z terminem);
--   * rozszerzone CHECK-i: trades_source ('broker'), ai_suggestions_kind ('broker_match', 'broker_trade'), auth_events_kind.
-- Plik CSV nie zostaje na serwerze (ani jawny, ani zaszyfrowany): serwer parsuje go w pamieci i zapomina.
-- Cofniecie: docs/v2/rollback/0031_down.sql.
-- Separator miedzy instrukcjami nie moze wystapic ani w tresci funkcji, ani w komentarzu.

CREATE TABLE "prop_firm_platforms" (
  "id" serial PRIMARY KEY,
  "firm" text NOT NULL,
  "platform" text NOT NULL,
  "methods" text[] NOT NULL,
  "export_hint" text,
  "source_url" text NOT NULL,
  "read_on" date NOT NULL,
  "needs_verification" boolean NOT NULL DEFAULT true,
  "notes" text,
  CONSTRAINT "prop_firm_platforms_firm" CHECK (length("firm") > 0 AND length("platform") > 0),
  CONSTRAINT "prop_firm_platforms_methods" CHECK ("methods" <@ ARRAY['export_file', 'oauth_tradovate']::text[]),
  CONSTRAINT "prop_firm_platforms_source_url" CHECK ("source_url" ~ '^https://'),
  CONSTRAINT "prop_firm_platforms_uq" UNIQUE ("firm", "platform", "read_on")
);--> statement-breakpoint

CREATE TABLE "broker_accounts" (
  "id" serial PRIMARY KEY,
  "account_id" integer REFERENCES "accounts" ("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "method" text NOT NULL,
  "firm" text,
  "external_account_hmac" text NOT NULL,
  "label_last4" text,
  "tz" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "broker_accounts_platform" CHECK ("platform" IN ('tradovate', 'tradingview', 'topstepx', 'rithmic', 'ninjatrader', 'generic')),
  CONSTRAINT "broker_accounts_method" CHECK ("method" IN ('export_file', 'oauth_tradovate')),
  CONSTRAINT "broker_accounts_method_platform" CHECK ("method" <> 'oauth_tradovate' OR "platform" = 'tradovate'),
  CONSTRAINT "broker_accounts_hmac" CHECK ("external_account_hmac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "broker_accounts_last4" CHECK ("label_last4" IS NULL OR length("label_last4") <= 4),
  CONSTRAINT "broker_accounts_account_uq" UNIQUE ("account_id"),
  CONSTRAINT "broker_accounts_external_uq" UNIQUE ("platform", "external_account_hmac")
);--> statement-breakpoint

CREATE TABLE "broker_imports" (
  "id" serial PRIMARY KEY,
  "origin" text NOT NULL,
  "format" text NOT NULL,
  "file_sha256" text,
  "file_bytes" integer,
  "tz" text NOT NULL,
  "rows_total" integer NOT NULL,
  "rows_skipped" integer NOT NULL,
  "fills_new" integer NOT NULL,
  "fills_duplicate" integer NOT NULL,
  "trades_matched" integer NOT NULL,
  "trades_created" integer NOT NULL,
  "pending_decisions" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'committed',
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text,
  "created_by_token_id" integer REFERENCES "api_tokens" ("id") ON DELETE NO ACTION,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "reverted_at" timestamptz,
  CONSTRAINT "broker_imports_origin" CHECK ("origin" IN ('ui', 'tj_watch', 'oauth')),
  CONSTRAINT "broker_imports_sha256" CHECK ("file_sha256" IS NULL OR "file_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "broker_imports_status" CHECK ("status" IN ('committed', 'reverted', 'rejected')),
  CONSTRAINT "broker_imports_reverted" CHECK (("status" = 'reverted') = ("reverted_at" IS NOT NULL)),
  CONSTRAINT "broker_imports_oauth_sha" CHECK (("origin" = 'oauth') = ("file_sha256" IS NULL)),
  CONSTRAINT "broker_imports_counts" CHECK ("rows_total" >= 0 AND "rows_skipped" >= 0 AND "fills_new" >= 0 AND "fills_duplicate" >= 0
    AND "trades_matched" >= 0 AND "trades_created" >= 0 AND "pending_decisions" >= 0),
  CONSTRAINT "broker_imports_warnings" CHECK (jsonb_typeof("warnings") = 'array')
);--> statement-breakpoint
CREATE UNIQUE INDEX "broker_imports_sha_committed_uq" ON "broker_imports" ("file_sha256") WHERE "status" = 'committed' AND "file_sha256" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "broker_imports_created_idx" ON "broker_imports" ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "broker_imports_sha_idx" ON "broker_imports" ("file_sha256") WHERE "file_sha256" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "broker_trades" (
  "id" serial PRIMARY KEY,
  "broker_account_id" integer NOT NULL REFERENCES "broker_accounts" ("id") ON DELETE CASCADE,
  "import_id" integer REFERENCES "broker_imports" ("id") ON DELETE CASCADE,
  "external_ref" text NOT NULL,
  "contract" text NOT NULL,
  "instrument_id" integer REFERENCES "instruments" ("id") ON DELETE RESTRICT,
  "direction" text NOT NULL,
  "max_qty" numeric(14, 4) NOT NULL,
  "entry_time" timestamptz NOT NULL,
  "exit_time" timestamptz,
  "avg_entry_price" numeric(18, 8) NOT NULL,
  "avg_exit_price" numeric(18, 8),
  "status" text NOT NULL,
  "gross_cents" bigint,
  "gross_source" text,
  "fees_cents" bigint,
  "fee_source" text,
  "net_cents" bigint,
  "trading_day" date,
  "trade_id" integer REFERENCES "trades" ("id") ON DELETE SET NULL,
  "match_kind" text,
  "match_state" text NOT NULL DEFAULT 'unmatched',
  "matched_at" timestamptz,
  "prev_broker_amount_cents" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "broker_trades_external_ref_uq" UNIQUE ("external_ref"),
  CONSTRAINT "broker_trades_external_ref" CHECK ("external_ref" ~ '^brk:'),
  CONSTRAINT "broker_trades_direction" CHECK ("direction" IN ('long', 'short')),
  CONSTRAINT "broker_trades_qty" CHECK ("max_qty" > 0),
  CONSTRAINT "broker_trades_status" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "broker_trades_closed" CHECK (("status" = 'closed') = ("exit_time" IS NOT NULL)),
  CONSTRAINT "broker_trades_gross_source" CHECK ("gross_source" IS NULL OR "gross_source" IN ('broker', 'computed')),
  CONSTRAINT "broker_trades_gross_pair" CHECK (("gross_cents" IS NULL) = ("gross_source" IS NULL)),
  CONSTRAINT "broker_trades_fee_source" CHECK ("fee_source" IS NULL OR "fee_source" IN ('broker', 'rate')),
  CONSTRAINT "broker_trades_fees_pair" CHECK (("fees_cents" IS NULL) = ("fee_source" IS NULL)),
  CONSTRAINT "broker_trades_fees_nonneg" CHECK ("fees_cents" IS NULL OR "fees_cents" >= 0),
  CONSTRAINT "broker_trades_match_kind" CHECK ("match_kind" IS NULL OR "match_kind" IN ('auto', 'user', 'ai_accepted', 'created')),
  CONSTRAINT "broker_trades_match_state" CHECK ("match_state" IN ('unmatched', 'ambiguous', 'matched', 'skipped')),
  CONSTRAINT "broker_trades_link_kind" CHECK (("trade_id" IS NULL) = ("match_kind" IS NULL)),
  CONSTRAINT "broker_trades_link_state" CHECK (("match_state" = 'matched') = ("trade_id" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "broker_trades_trade_uq" ON "broker_trades" ("trade_id") WHERE "trade_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "broker_trades_account_entry_idx" ON "broker_trades" ("broker_account_id", "entry_time");--> statement-breakpoint
CREATE INDEX "broker_trades_day_idx" ON "broker_trades" ("trading_day");--> statement-breakpoint
CREATE INDEX "broker_trades_open_state_idx" ON "broker_trades" ("match_state") WHERE "match_state" IN ('unmatched', 'ambiguous');--> statement-breakpoint
CREATE INDEX "broker_trades_import_idx" ON "broker_trades" ("import_id");--> statement-breakpoint

CREATE TABLE "broker_fills" (
  "id" serial PRIMARY KEY,
  "broker_account_id" integer NOT NULL REFERENCES "broker_accounts" ("id") ON DELETE CASCADE,
  "import_id" integer REFERENCES "broker_imports" ("id") ON DELETE CASCADE,
  "external_ref" text NOT NULL,
  "broker_trade_id" integer REFERENCES "broker_trades" ("id") ON DELETE SET NULL,
  "contract" text NOT NULL,
  "side" text NOT NULL,
  "qty" numeric(14, 4) NOT NULL,
  "price" numeric(18, 8) NOT NULL,
  "filled_at" timestamptz NOT NULL,
  "fee_cents" bigint,
  "broker_pnl_cents" bigint,
  "order_ref" text,
  "raw" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "broker_fills_external_ref_uq" UNIQUE ("external_ref"),
  CONSTRAINT "broker_fills_side" CHECK ("side" IN ('buy', 'sell')),
  CONSTRAINT "broker_fills_qty" CHECK ("qty" > 0),
  CONSTRAINT "broker_fills_price" CHECK ("price" > 0),
  CONSTRAINT "broker_fills_fee" CHECK ("fee_cents" IS NULL OR "fee_cents" >= 0),
  CONSTRAINT "broker_fills_raw" CHECK (jsonb_typeof("raw") = 'object')
);--> statement-breakpoint
CREATE INDEX "broker_fills_account_time_idx" ON "broker_fills" ("broker_account_id", "filled_at");--> statement-breakpoint
CREATE INDEX "broker_fills_trade_idx" ON "broker_fills" ("broker_trade_id");--> statement-breakpoint
CREATE INDEX "broker_fills_import_idx" ON "broker_fills" ("import_id");--> statement-breakpoint

CREATE TABLE "broker_cash_events" (
  "id" serial PRIMARY KEY,
  "broker_account_id" integer NOT NULL REFERENCES "broker_accounts" ("id") ON DELETE CASCADE,
  "import_id" integer REFERENCES "broker_imports" ("id") ON DELETE CASCADE,
  "external_ref" text NOT NULL,
  "kind" text NOT NULL,
  "delta_cents" bigint NOT NULL,
  "contract" text,
  "occurred_at" timestamptz NOT NULL,
  "raw" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "broker_cash_events_external_ref_uq" UNIQUE ("external_ref"),
  CONSTRAINT "broker_cash_events_kind" CHECK ("kind" IN ('commission', 'fee', 'trade_paired', 'deposit', 'other')),
  CONSTRAINT "broker_cash_events_raw" CHECK (jsonb_typeof("raw") = 'object')
);--> statement-breakpoint
CREATE INDEX "broker_cash_events_account_time_idx" ON "broker_cash_events" ("broker_account_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "broker_cash_events_import_idx" ON "broker_cash_events" ("import_id");--> statement-breakpoint

CREATE TABLE "day_accounts" (
  "day" date NOT NULL,
  "account_id" integer NOT NULL REFERENCES "accounts" ("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("day", "account_id")
);--> statement-breakpoint

-- --- Kto moze pisac do tabel brokera -----------------------------------------------------------------------------
-- Aktor `ui` (uzytkownik w aplikacji) albo `api:<id>` tokenu, ktorego JEDYNYM zakresem jest import_broker, nieuniewazniony
-- i niewygasly. Reszta (token read/write/propose, brak aktora) dostaje TJ403. Sprawdzanie zakresow wprost w bazie to druga
-- warstwa za brama API: nawet blad w trasie nie otworzy tych tabel agentowi.
CREATE FUNCTION public.tj_broker_aktor_import() RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  AS $$
DECLARE
  v_actor text;
  v_id integer;
BEGIN
  v_actor := nullif(current_setting('tj.actor', true), '');
  IF v_actor IS NULL OR v_actor !~ '^api:[0-9]{1,9}$' THEN
    RETURN false;
  END IF;
  v_id := substring(v_actor from 5)::integer;
  RETURN EXISTS (
    SELECT 1 FROM api_tokens t
    WHERE t.id = v_id
      AND t.scopes = ARRAY['import_broker']::text[]
      AND t.revoked_at IS NULL
      AND (t.expires_at IS NULL OR t.expires_at > now())
  );
END
$$;--> statement-breakpoint

CREATE FUNCTION public.tj_broker_zapis() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_actor text;
BEGIN
  -- Kaskada z FK (usuniecie konta albo importu) idzie z kontekstu wyzwalacza RI, nie od aktora.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  v_actor := nullif(current_setting('tj.actor', true), '');
  IF v_actor = 'ui' OR public.tj_broker_aktor_import() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Odpiecie trade'u brokera od skasowanego trade'u dziennika (trigger trades_odepnij_broker) i zerowanie klucza obcego
  -- przy kasowaniu wiersza nadrzednego: to ruch w kontekscie wyzwalacza, ktory niczego nie dopisuje. Osobne IF-y na tabele,
  -- bo plpgsql planuje kazde wyrazenie w calosci (pole trade_id nie istnieje w pozostalych tabelach).
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    IF TG_TABLE_NAME = 'broker_trades' THEN
      IF NEW.trade_id IS NULL AND NEW.match_kind IS NULL AND NEW.match_state = 'unmatched' THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'broker_fills' THEN
      IF NEW.broker_trade_id IS NULL AND (to_jsonb(NEW) - 'broker_trade_id') = (to_jsonb(OLD) - 'broker_trade_id') THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Zapis do tabeli % (%) wymaga aktora "ui" albo tokenu z jedynym zakresem import_broker, a przyszedl od aktora "%". Powod: dane brokera moze wprowadzac tylko uzytkownik w aplikacji albo jego automat z folderu Pobrane; agent AI ma wylacznie odczyt. Naprawa: zaimportuj plik w aplikacji (Prop -> Polaczenia).', TG_TABLE_NAME, TG_OP, coalesce(v_actor, '(nieustawiony)')
    USING ERRCODE = 'TJ403', TABLE = TG_TABLE_NAME;
END
$$;--> statement-breakpoint

-- Konta u brokera: uzytkownik moze wszystko; token importu tylko WSTAWIC konto jeszcze nieprzypisane (account_id NULL).
-- Przypisanie do konta dziennika (UPDATE account_id) robi wylacznie UI.
CREATE FUNCTION public.tj_broker_konto_zapis() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_actor text;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  v_actor := nullif(current_setting('tj.actor', true), '');
  IF v_actor = 'ui' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.account_id IS NULL AND NEW.method = 'export_file' AND public.tj_broker_aktor_import() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Zapis do tabeli broker_accounts (%) od aktora "%" jest niedozwolony. Powod: konto u brokera przypisuje do konta dziennika wylacznie uzytkownik w aplikacji; automat z folderu Pobrane moze tylko zglosic nowe, nieprzypisane konto. Naprawa: przypisz konto w aplikacji (Prop -> Polaczenia).', TG_OP, coalesce(v_actor, '(nieustawiony)')
    USING ERRCODE = 'TJ403', TABLE = TG_TABLE_NAME;
END
$$;--> statement-breakpoint

-- Pochodzenie importu musi zgadzac sie z aktorem: `ui` tylko od uzytkownika, `tj_watch` tylko od tokenu importu, ktory
-- zapisuje swoj wlasny numer (nie da sie wpisac cudzego); `oauth` czeka na etap B i nie przechodzi.
CREATE FUNCTION public.tj_broker_import_origin() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_actor text;
BEGIN
  v_actor := nullif(current_setting('tj.actor', true), '');
  IF NEW.origin = 'ui' AND v_actor = 'ui' AND NEW.created_by_token_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.origin = 'tj_watch' AND public.tj_broker_aktor_import() AND NEW.created_by_token_id = substring(v_actor from 5)::integer THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Import z pochodzeniem "%" nie zgadza sie z aktorem "%" (token zapisu: %). Powod: pochodzenie importu jest dowodem, skad przyszly dane, wiec musi wynikac z aktora, a nie z tresci zapytania. Naprawa: ui -> import z aplikacji; tj_watch -> automat z tokenem import_broker; oauth jest wylaczone do etapu B (ADR-034 pkt 8).', NEW.origin, coalesce(v_actor, '(nieustawiony)'), coalesce(NEW.created_by_token_id::text, 'brak')
    USING ERRCODE = 'TJ403', TABLE = TG_TABLE_NAME;
END
$$;--> statement-breakpoint

CREATE TRIGGER "broker_accounts_zapis" BEFORE INSERT OR UPDATE OR DELETE ON "broker_accounts"
  FOR EACH ROW EXECUTE FUNCTION public.tj_broker_konto_zapis();--> statement-breakpoint
CREATE TRIGGER "broker_imports_zapis" BEFORE INSERT OR UPDATE OR DELETE ON "broker_imports"
  FOR EACH ROW EXECUTE FUNCTION public.tj_broker_zapis();--> statement-breakpoint
CREATE TRIGGER "broker_imports_origin" BEFORE INSERT ON "broker_imports"
  FOR EACH ROW EXECUTE FUNCTION public.tj_broker_import_origin();--> statement-breakpoint
CREATE TRIGGER "broker_trades_zapis" BEFORE INSERT OR UPDATE OR DELETE ON "broker_trades"
  FOR EACH ROW EXECUTE FUNCTION public.tj_broker_zapis();--> statement-breakpoint
CREATE TRIGGER "broker_fills_zapis" BEFORE INSERT OR UPDATE OR DELETE ON "broker_fills"
  FOR EACH ROW EXECUTE FUNCTION public.tj_broker_zapis();--> statement-breakpoint
CREATE TRIGGER "broker_cash_events_zapis" BEFORE INSERT OR UPDATE OR DELETE ON "broker_cash_events"
  FOR EACH ROW EXECUTE FUNCTION public.tj_broker_zapis();--> statement-breakpoint

-- Dopasowanie inne niz automatyczne 1:1 (reczne, z zatwierdzonej sugestii AI, trade utworzony z danych brokera) tylko od
-- uzytkownika. Wyjatek: odpiecie od skasowanego trade'u dziennika (trigger trades_odepnij_broker), ktore dzieje sie
-- w kontekscie wyzwalacza (pg_trigger_depth() > 1), nie od aktora.
CREATE FUNCTION public.tj_broker_dopasowanie() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_actor text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.match_kind IS NOT DISTINCT FROM NEW.match_kind THEN
    RETURN NEW;
  END IF;
  IF NEW.match_kind IS NULL AND OLD.match_kind IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.match_kind = 'auto' AND (TG_OP = 'INSERT' OR OLD.match_kind IS NULL OR OLD.match_kind = 'auto') THEN
    RETURN NEW;
  END IF;
  IF NEW.match_kind IS NULL AND OLD.match_kind = 'auto' THEN
    RETURN NEW;
  END IF;
  v_actor := nullif(current_setting('tj.actor', true), '');
  IF v_actor = 'ui' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND NEW.match_kind IS NULL AND NEW.trade_id IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Dopasowanie trade''u brokera #% (rodzaj z "%" na "%") wymaga aktora "ui", a zapis przyszedl od aktora "%". Powod: automat z folderu Pobrane stosuje wylacznie dopasowania 1:1 (rodzaj auto); reczne, z sugestii AI i utworzone z danych brokera zatwierdza uzytkownik w aplikacji. Naprawa: wskaz dopasowanie w aplikacji (Prop -> Polaczenia -> Do decyzji).', NEW.id, coalesce(OLD.match_kind, '(brak)'), coalesce(NEW.match_kind, '(brak)'), coalesce(v_actor, '(nieustawiony)')
    USING ERRCODE = 'TJ403', TABLE = TG_TABLE_NAME, COLUMN = 'match_kind';
END
$$;--> statement-breakpoint
CREATE TRIGGER "broker_trades_dopasowanie_insert" BEFORE INSERT ON "broker_trades"
  FOR EACH ROW WHEN (NEW."match_kind" IS NOT NULL)
  EXECUTE FUNCTION public.tj_broker_dopasowanie();--> statement-breakpoint
CREATE TRIGGER "broker_trades_dopasowanie_update" BEFORE UPDATE ON "broker_trades"
  FOR EACH ROW WHEN (OLD."match_kind" IS DISTINCT FROM NEW."match_kind")
  EXECUTE FUNCTION public.tj_broker_dopasowanie();--> statement-breakpoint

-- Skasowanie trade'u dziennika odpina jego trade brokera (wraca do "bez dopasowania"). BEFORE DELETE, bo CHECK-i
-- broker_trades wymagaja, zeby trade_id, match_kind i match_state zmienialy sie razem (sama akcja FK SET NULL by je zlamala).
CREATE FUNCTION public.tj_trade_odepnij_broker() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE broker_trades
     SET trade_id = NULL, match_kind = NULL, match_state = 'unmatched', matched_at = NULL,
         prev_broker_amount_cents = NULL, updated_at = now()
   WHERE trade_id = OLD.id;
  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER "trades_odepnij_broker" BEFORE DELETE ON "trades"
  FOR EACH ROW EXECUTE FUNCTION public.tj_trade_odepnij_broker();--> statement-breakpoint

-- --- Rozszerzone ograniczenia -----------------------------------------------------------------------------------
-- Zakres import_broker: samodzielny (zadnego laczenia z read/write/propose/import), wylacznie z UI (created_via = 'ui'),
-- zawsze z terminem waznosci. device_codes.requested_scopes zostaje bez zmian, wiec logowanie kodem urzadzenia go nie da.
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_scopes";--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_scopes" CHECK (
  cardinality("scopes") BETWEEN 1 AND 4
  AND "scopes" <@ ARRAY['read', 'write', 'propose', 'import', 'import_broker']
  AND (NOT ('import_broker' = ANY ("scopes")) OR "scopes" = ARRAY['import_broker']::text[])
);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_import_broker" CHECK (
  NOT ('import_broker' = ANY ("scopes")) OR ("created_via" = 'ui' AND "expires_at" IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "trades" DROP CONSTRAINT "trades_source";--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_source" CHECK ("source" IN ('form', 'tradingview', 'fxreplay', 'broker'));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_broker_ref" CHECK ("source" <> 'broker' OR "external_ref" ~ '^brk:');--> statement-breakpoint
CREATE TRIGGER "trades_source_broker_insert" BEFORE INSERT ON "trades"
  FOR EACH ROW WHEN (NEW."source" = 'broker')
  EXECUTE FUNCTION public.tj_require_ui_actor('source', 'broker');--> statement-breakpoint
CREATE TRIGGER "trades_source_broker_update" BEFORE UPDATE ON "trades"
  FOR EACH ROW WHEN (OLD."source" IS DISTINCT FROM NEW."source")
  EXECUTE FUNCTION public.tj_require_ui_actor('source', 'broker');--> statement-breakpoint

ALTER TABLE "ai_suggestions" DROP CONSTRAINT "ai_suggestions_kind";--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_kind" CHECK ("kind" IN ('tag', 'trade_link', 'setup_example', 'process_grade',
  'profile_term', 'day_conclusion', 'weekly_conclusion', 'strategy_detail', 'trade_setup', 'broker_match', 'broker_trade'));--> statement-breakpoint

ALTER TABLE "auth_events" DROP CONSTRAINT "auth_events_kind";--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_kind" CHECK ("kind" IN ('login_ok', 'login_fail', 'totp_ok', 'totp_fail', 'backup_code_used', 'sudo', 'totp_enabled', 'totp_disabled', 'backup_codes_regenerated', 'password_changed', 'device_requested', 'device_approved', 'device_denied', 'token_created', 'token_revoked', 'logout_all',
  'broker_import', 'broker_import_reverted', 'broker_import_rejected', 'broker_account_mapped', 'broker_match_reverted', 'broker_history_recalculated'));
