# Model danych v2 (projekt do akceptacji)

**Status:** ZAAKCEPTOWANY 14.10.2026 przez użytkownika (STOP fazy 0). Słowa użytkownika: «Akceptuję, ruszamy».
**Decyzje:** ADR-029 do ADR-033 w `docs/decyzje.md`. **Źródło wymagań:** zatwierdzony plan
„Przebudowa dziennika tradingowego + łącznik `tj` dla AI” i raporty `docs/research/{rynek,metodyka}.md`.

Dokument opisuje **docelowy schemat**, a nie gotowe migracje. Migracje pisze `database-engineer`
w fazach 1, 2 i 2b, ręcznie, według sekcji 9. Fragmenty SQL niżej są szkicem kształtu (kolumny,
typy, ograniczenia), nie plikiem do wklejenia.

---

## 1. Konwencje (obowiązują każdą nową tabelę)

| Sprawa | Reguła | Skąd |
|---|---|---|
| Klucz główny | `serial` (`integer`), jak w całym schemacie | spójność z istniejącymi FK |
| Kwoty | `bigint` w **centach**; nigdy `numeric` ani float | ADR-002 |
| Wartość ticku | `instruments.tick_value` w **tysięcznych USD** (NQ = 5000). Nowe tabele nie liczą pieniędzy z ticków same — ryzyko i wynik daje wyłącznie `computeTrade` | ADR-002, ADR-003 |
| Ceny | `numeric(18,8)`; kontrakty `numeric(14,4)` | ADR-002 |
| Czas | `timestamptz`. Dzień handlowy `date` | ADR-022 |
| Dziedziny wartości | `text` + `CHECK`. **Nigdy** nowy `pgEnum` ani `ALTER TYPE … ADD VALUE` | ADR-026 |
| Listy, które rosną bez migracji (interwały) | `text` bez CHECK, lista w `lib/domain` | ADR-013 |
| Pochodzenie | `origin text` z CHECK na: `user`, `ai`, `mentor`, `vault-import` (podzbiór zależnie od tabeli) | ADR-033 |
| Skróty | `text` z `CHECK (x ~ '^[0-9a-f]{64}$')`, SHA-256 hex z **bajtów UTF-8** | sekcja 7 |
| Unikat z NULL-em | `NULLS NOT DISTINCT` (tylko przez `unique()` w drizzle 0.45) albo indeks częściowy | ADR-017, ADR-008 |
| FK z tabeli niezmiennej | **`NO ACTION` / `RESTRICT`, nigdy `SET NULL`** — `SET NULL` to `UPDATE`, który trigger niezmienności odrzuci i zablokuje kasowanie rodzica | sekcja 6 |
| Pola pochodne | nie zapisujemy tego, co da się wyprowadzić (status fazy hipotezy, `n`, kategoria konta, flaga look-ahead, naruszenia dyscypliny). Wyjątek: zamrożone migawki (ryzyko planu w chwili zamrożenia) | ADR-003, „Nie robimy” |
| Aktor zapisu | każda transakcja zapisu ustawia `set_config('tj.actor', 'ui' \| 'api:<token_id>' \| 'import', true)`; triggery zatwierdzeń go czytają | ADR-030 |

Jedna osoba = brak kolumn `user_id` i RLS (ADR-001).

---

## 2. Funkcje i rozszerzenia (migracja 0018)

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;   -- do sprawdzenia na serwerze, sekcja 10
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() jest STABLE, wiec nie wolno jej uzyc w kolumnie generowanej ani w indeksie.
-- Opakowanie IMMUTABLE ze slownikiem i schematem podanym WPROST: pg_dump/pg_restore
-- ustawia pusty search_path, a goly 'unaccent' w ciele funkcji wtedy nie istnieje.
CREATE FUNCTION public.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
```

Trzy funkcje triggerów, wspólne dla wielu tabel (SQLSTATE własne, żeby API mapowało je na HTTP
bez parsowania komunikatu):

| Funkcja | Działanie | SQLSTATE → HTTP |
|---|---|---|
| `tj_forbid_update()` | każdy `UPDATE` → wyjątek. Tabele tylko-do-dopisywania | `TJ409` → 409 |
| `tj_guard_columns(VARIADIC kolumny)` | `UPDATE` zmieniający którąkolwiek z kolumn podanych w `TG_ARGV` (porównanie `to_jsonb(OLD)->k IS DISTINCT FROM to_jsonb(NEW)->k`) → wyjątek | `TJ409` → 409 |
| `tj_require_ui_actor()` | przejście statusu w stan zatwierdzony / decyzję (`approved`, `confirmed`, `answered`, …) przy `current_setting('tj.actor', true) IS DISTINCT FROM 'ui'` → wyjątek | `TJ403` → 403 |

Trzy triggery specyficzne: `tj_user_words_hash` (sekcja 4.1), `tj_note_revision` (4.2),
`tj_plan_guard` (5.1). `DELETE` nie jest blokowany triggerem nigdzie — kaskady z kasowania
trade'u przez użytkownika muszą działać, a API v2 i MCP nie mają operacji kasowania (ADR-032).

---

## 3. Faza 1 — bezpieczeństwo (migracja 0016)

### 3.1 `settings` (dokładane kolumny)

| Kolumna | Typ | Uwagi |
|---|---|---|
| `totp_secret_enc` | `text` NULL | AES-256-GCM (`iv.tag.szyfrogram`, base64url), klucz z env `TOTP_ENC_KEY`; NULL = 2FA wyłączone |
| `totp_enabled_at` | `timestamptz` NULL | CHECK: `(totp_secret_enc IS NULL) = (totp_enabled_at IS NULL)` |
| `totp_last_step` | `bigint` NULL | numer ostatnio przyjętego kroku 30 s — ochrona przed powtórką kodu |

### 3.2 `auth_backup_codes`

```sql
id serial PK,
code_hmac text NOT NULL UNIQUE CHECK (code_hmac ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256(sekret serwera, kod)
batch integer NOT NULL,                     -- nowa paczka = stara uniewazniona (DELETE starej w tej samej transakcji)
used_at timestamptz NULL,
created_at timestamptz NOT NULL DEFAULT now()
-- indeks: (batch) WHERE used_at IS NULL
```

### 3.3 `auth_events` (tylko dopisywanie: `tj_forbid_update`)

```sql
id serial PK,
at timestamptz NOT NULL DEFAULT now(),
kind text NOT NULL CHECK (kind IN ('login_ok','login_fail','totp_ok','totp_fail','backup_code_used',
  'sudo','totp_enabled','totp_disabled','backup_codes_regenerated','password_changed',
  'device_requested','device_approved','device_denied','token_created','token_revoked','logout_all')),
ip text, user_agent text,
token_id integer NULL,        -- bez FK w 0016 (api_tokens powstaje w 0017); FK NO ACTION dokladany w 0019 (po scaleniu faz 1 i 2)
detail jsonb NOT NULL DEFAULT '{}'
-- indeks: (at DESC), (kind, at DESC)
```

Sudo i „czeka na drugi krok” to podpisane ciasteczka (bez tabeli) — ADR-031.

---

## 4. Faza 2 — API v2 i notatki (migracje 0017, 0018)

### 4.0 `api_tokens`, `device_codes` (0017)

```sql
CREATE TABLE api_tokens (
  id serial PK,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z0-9]{8}$'),
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 4
                                AND scopes <@ ARRAY['read','write','propose','import']),  -- zakresu "approve" nie ma;
                                -- "import" (15.10.2026) tylko z UI, nigdy z device_codes
  created_via text NOT NULL CHECK (created_via IN ('device_code','ui')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz, last_used_ip text,     -- zapis najwyzej raz na minute
  expires_at timestamptz NULL,                      -- NULL = bez terminu (ADR-030)
  revoked_at timestamptz NULL, revoked_reason text
);
-- Tokenow sie nie kasuje (uniewaznia), bo wskazuja na nie created_by_token_id w tabelach niezmiennych.

CREATE TABLE device_codes (
  id serial PK,
  device_code_sha256 text NOT NULL UNIQUE CHECK (device_code_sha256 ~ '^[0-9a-f]{64}$'),
  user_code text NOT NULL UNIQUE CHECK (user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$'),
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 80),
  client_ip text,
  requested_scopes text[] NOT NULL CHECK (requested_scopes <@ ARRAY['read','write','propose']),
  granted_scopes text[] NULL CHECK (granted_scopes IS NULL OR granted_scopes <@ requested_scopes),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,                  -- created_at + 10 min
  last_polled_at timestamptz,
  approved_at timestamptz, denied_at timestamptz,
  token_id integer NULL REFERENCES api_tokens ON DELETE NO ACTION,
  consumed_at timestamptz,
  CHECK (approved_at IS NULL OR denied_at IS NULL),
  CHECK ((approved_at IS NULL) = (granted_scopes IS NULL)),
  CHECK (consumed_at IS NULL OR (approved_at IS NOT NULL AND token_id IS NOT NULL))
);
```

Token powstaje **przy odpytaniu po zatwierdzeniu**, nie przy zatwierdzeniu — dzięki temu jawny
token nie leży w bazie ani chwili. Wiersze starsze niż doba sprząta `device/start`.

### 4.1 `user_words` — słowa użytkownika dosłownie (0018)

```sql
CREATE TABLE user_words (
  id serial PK,
  text text NOT NULL CHECK (length(text) > 0),      -- bajt w bajt: bez trim, bez NFC, bez zamiany CRLF
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),   -- liczy trigger, nie klient
  byte_len integer NOT NULL,
  source text NOT NULL CHECK (source IN ('chat','note','chart','ui','mobile','vault-import')),
  role text NULL,                  -- czym jest ten tekst: 'trade.note','plan.thesis','plan.invalidation',
                                   -- 'day.invalidation','weekly.commitment','correction',... (lista w kodzie)
  trade_id integer NULL REFERENCES trades ON DELETE CASCADE,
  note_id integer NULL REFERENCES notes ON DELETE CASCADE,
  backtest_session_id integer NULL REFERENCES backtest_sessions ON DELETE CASCADE,
  day date NULL,
  captured_at timestamptz NOT NULL,                 -- kiedy uzytkownik to napisal (z klienta)
  ai_interpretation text NULL,                      -- JEDYNA zmienna tresc wiersza; w UI zawsze "interpretacja AI"
  interpretation_model text NULL, interpretation_at timestamptz NULL,
  supersedes_id integer NULL REFERENCES user_words ON DELETE NO ACTION,  -- poprawka w UI = nowy wiersz
  created_by_token_id integer NULL REFERENCES api_tokens ON DELETE NO ACTION,
  created_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', public.f_unaccent(text))) STORED
);
-- indeksy: GIN(search); (trade_id) WHERE trade_id IS NOT NULL; (note_id) WHERE ...; (day) WHERE ...;
--          UNIQUE (supersedes_id) WHERE supersedes_id IS NOT NULL   -- jedna poprawka na wersje
```

Triggery: `BEFORE INSERT tj_user_words_hash` ustawia `sha256 = encode(sha256(convert_to(text,'UTF8')),'hex')`
i `byte_len = octet_length(text)`; `BEFORE UPDATE tj_guard_columns('text','sha256','byte_len','source',
'captured_at','trade_id','note_id','backtest_session_id','day','supersedes_id','created_by_token_id')`.

**Odstępstwo od brzmienia planu (decyzja gustu, opisana w raporcie):** plan mówi „w `notes`:
`user_words` + `ai_interpretation`”. Słowa są osobną tabelą wskazującą notatkę, bo (a) jedna
notatka trade'u zbiera kilka wypowiedzi w czasie („wszedłem, bo…”, potem „zamknąłem, bo…”), a pole
niezmienne nie przyjmie dopisku; (b) te same słowa wiszą też przy planie, dniu, rysunku i poprawce,
nie tylko przy notatce; (c) niezmienność całego wiersza da się wymusić triggerem, a niezmienność
jednej kolumny w edytowalnym wierszu `notes` — tylko kruchym wyjątkiem. Widok notatki w UI pokazuje
blok „Słowa użytkownika” z wierszy `user_words`, `body_md` i interpretację AI osobno.

### 4.2 `notes`, `note_revisions`, `note_links` (0018)

```sql
CREATE TABLE notes (
  id serial PK,
  kind text NOT NULL CHECK (kind IN ('system','concept','rule','decision_proc','trade_note','session',
        'hypothesis','mistake','strength','brain_decision','learning','profile','strategy','setup')),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),  -- ASCII z tytulu, do adresow
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body_md text NOT NULL DEFAULT '',
  meta jsonb NOT NULL DEFAULT '{}',
  origin text NOT NULL DEFAULT 'user' CHECK (origin IN ('user','ai','mentor','vault-import')),
  trade_id integer NULL REFERENCES trades ON DELETE SET NULL,          -- notatka przezywa skasowanie trade'u (uwaga nizej)
  backtest_session_id integer NULL REFERENCES backtest_sessions ON DELETE SET NULL,
  day date NULL,
  external_ref text NULL,                 -- 'vault:<sciezka>' (import), 'mentor:<video_id>'
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),  -- sha256(body_md) liczy trigger
  rev integer NOT NULL DEFAULT 1,         -- If-Match; podbija trigger
  archived_at timestamptz NULL,
  created_by_token_id integer NULL REFERENCES api_tokens ON DELETE NO ACTION,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', public.f_unaccent(title)), 'A') ||
    setweight(to_tsvector('simple', public.f_unaccent(body_md)), 'B')) STORED
);
-- indeksy: UNIQUE (external_ref) WHERE external_ref IS NOT NULL;
--          UNIQUE (lower(public.f_unaccent(title)))      -- [[Tytul]] rozwiazuje sie po tytule jak w Obsidianie
--          GIN(search); GIN (lower(public.f_unaccent(title)) gin_trgm_ops);
--          GIN (lower(public.f_unaccent(body_md)) gin_trgm_ops);
--          (kind); (trade_id) WHERE ...; (day) WHERE ...; (backtest_session_id) WHERE ...
```

Kotwice `SET NULL`, nie `CASCADE`: skasowanie trade'u nie kasuje notatki, w której mogą być
wnioski na lata (słowa użytkownika przy samym trade'ie kasują się z nim — `user_words.trade_id`
ma `CASCADE`, bo to jego opis, nie wiedza ogólna). `notes` nie są tabelą niezmienną, więc `SET NULL`
jest tu bezpieczne.

```sql
CREATE TABLE note_revisions (            -- tylko dopisywanie: tj_forbid_update
  id serial PK,
  note_id integer NOT NULL REFERENCES notes ON DELETE CASCADE,
  rev integer NOT NULL,
  title text NOT NULL, body_md text NOT NULL, meta jsonb NOT NULL,
  content_hash text NOT NULL,
  actor text NOT NULL,                   -- current_setting('tj.actor')
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, rev)
);

CREATE TABLE note_links (
  id serial PK,
  from_note_id integer NOT NULL REFERENCES notes ON DELETE CASCADE,
  target text NOT NULL,                  -- surowa tresc [[...]] (bez aliasu po |)
  to_note_id integer NULL REFERENCES notes ON DELETE SET NULL,  -- NULL = notatki jeszcze nie ma
  UNIQUE (from_note_id, target)
);
-- indeksy: (to_note_id) -- backlinki; (lower(public.f_unaccent(target))) WHERE to_note_id IS NULL -- dowiazywanie
```

Trigger `BEFORE UPDATE tj_note_revision` na `notes`: gdy zmienia się `title`, `body_md` albo `meta`,
wstawia `OLD` do `note_revisions`, ustawia `NEW.rev = OLD.rev + 1`, `NEW.content_hash`, `NEW.updated_at`.
API robi `UPDATE … WHERE id = $1 AND rev = $ifMatch`; zero wierszy → 409 z bieżącą treścią.
Linki przelicza kod zapisu w tej samej transakcji (parser `[[...]]` w `lib/domain`, czysty).

### 4.3 `rules`, `rule_versions`, `hypotheses` (0018)

```sql
CREATE TABLE rules (
  id serial PK,
  code text NOT NULL UNIQUE CHECK (code ~ '^R-[0-9]{3,}$'),
  note_id integer NOT NULL UNIQUE REFERENCES notes ON DELETE RESTRICT,
  hard boolean NOT NULL DEFAULT false,       -- twarda regula -> wskaznik dyscypliny
  retired_at timestamptz NULL, retired_in_ruleset integer NULL, retired_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((retired_at IS NULL) = (retired_in_ruleset IS NULL))
);

CREATE TABLE rule_versions (
  id serial PK,
  rule_id integer NOT NULL REFERENCES rules ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  text_md text NOT NULL CHECK (length(text_md) > 0),
  status text NOT NULL CHECK (status IN ('proposed','approved','rejected','superseded')),
  origin text NOT NULL CHECK (origin IN ('user','ai','mentor','vault-import')),
  counterargument text NULL,                 -- najsilniejszy kontrargument (MUST 10)
  evidence jsonb NULL,                       -- trade'y, swiece, zrzuty, poziom dowodu, n
  hypothesis_id integer NULL REFERENCES hypotheses ON DELETE RESTRICT,  -- podstawa propozycji AI
  ruleset_version integer NULL,              -- numer zestawu nadany przy zatwierdzeniu
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL, superseded_at timestamptz NULL,
  created_by_token_id integer NULL REFERENCES api_tokens ON DELETE NO ACTION,
  UNIQUE (rule_id, version),
  CHECK (origin <> 'ai' OR (counterargument IS NOT NULL AND length(counterargument) > 0
                            AND evidence IS NOT NULL AND hypothesis_id IS NOT NULL)),
  CHECK ((status IN ('approved','superseded')) = (ruleset_version IS NOT NULL))
);
-- UNIQUE (rule_id) WHERE status = 'approved'   -- jedna obowiazujaca wersja
-- UNIQUE (rule_id) WHERE status = 'proposed'   -- jedna propozycja naraz na regule
-- (status) WHERE status = 'proposed'           -- kolejka "Do decyzji"
```

Triggery na `rule_versions`: `tj_require_ui_actor` (przejście w `approved` i `rejected`);
`tj_guard_columns('rule_id','version','text_md','origin','counterargument','evidence','hypothesis_id',
'proposed_at','created_by_token_id')` — treść wersji nie zmienia się nigdy, zmienia się tylko jej
status (`proposed → approved|rejected`, `approved → superseded`). Bramka „poniżej progu AI nie
proponuje reguły”: API sprawdza `n ≥ prog_n` hipotezy z `hypothesis_id`; trigger `BEFORE INSERT`
powtarza to zapytaniem (n liczone tak jak w 5.4), bo to reguła z planu, nie wygoda.
Propozycje `origin = 'mentor'` (MUST 16.5) bramce `n` **nie podlegają** — Słowa użytkownika
(14.10.2026): «Bez progu, podpisane n=0». Trigger sprawdza próg wyłącznie przy `origin = 'ai'`;
propozycja mentora ma `hypothesis_id` NULL, w `evidence` cytat z `mentor_claims` (film, `t=`),
a UI podpisuje ją „wg mentora, n = 0”. Nadal tylko propozycja (`tj_require_ui_actor`).
CHECK dla mentora: `CHECK (origin <> 'mentor' OR evidence IS NOT NULL)`.

**Numer zestawu reguł.** `settings.ruleset_version integer NOT NULL DEFAULT 0`. Akcja zatwierdzenia
w UI (jedna transakcja): `ruleset_version + 1` → stempel w nowej wersji → poprzednia `approved`
staje się `superseded`. Wycofanie reguły też podbija numer (`rules.retired_in_ruleset`). Zestaw nr V
= dla każdej reguły najnowsza wersja z `ruleset_version ≤ V`, bez reguł wycofanych w ≤ V.
Status reguły (`proponowana` / `aktywna` / `wycofana` / `odrzucona`) jest **wyliczany** z wersji,
nie zapisywany. `GET /rules` zwraca `rulesVersion` = bieżący numer.

**Import reguł z sejfu — bez furtki w bazie.** Słowa użytkownika (14.10.2026): «Jako propozycje,
zatwierdzam ponownie». Sejf ma 3 reguły `zatwierdzona` (R-004, R-007, R-010) i 9 `proponowana`.
`tj import vault` zakłada wszystkie 12 jako `rule_versions.status = 'proposed'`,
`origin = 'vault-import'`, ze statusem z sejfu w `notes.meta` (`{"vault_status": "zatwierdzona"}`)
— to informacja dla UI, nie zatwierdzenie. Użytkownik zatwierdza je w UI po jednej. Trigger
`tj_require_ui_actor` nie ma wyjątku dla importu ani kolumny „okno importu”.

Kolejność w pliku 0018: `notes` → `user_words` → `hypotheses` → `rules` → `rule_versions`
(FK `rule_versions.hypothesis_id`).

```sql
CREATE TABLE hypotheses (
  id serial PK,
  code text NOT NULL UNIQUE CHECK (code ~ '^H-[0-9]{3,}$'),
  note_id integer NOT NULL UNIQUE REFERENCES notes ON DELETE RESTRICT,
  decision text NOT NULL DEFAULT 'active'
    CHECK (decision IN ('active','confirmed','rejected','abandoned')),  -- decyzja czlowieka
  prog_n integer NOT NULL DEFAULT 20 CHECK (prog_n >= 1),
  thresholds jsonb NOT NULL DEFAULT '{}',     -- progi statusu zadeklarowane z gory (np. dolna granica Wilsona vs BE)
  n_imported integer NOT NULL DEFAULT 0 CHECK (n_imported >= 0),  -- n z sejfu sprzed aplikacji
  declared_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL
);
```

Faza hipotezy (**zbieranie** `n < prog_n` / **do oceny** `n ≥ prog_n`) i status statystyczny
(nieważny / niejednoznaczny / obiecujący / potwierdzony) są wyliczane w `stats-ci.ts`. W bazie
leży tylko decyzja człowieka (`tj_require_ui_actor` na zmianie `decision`). Sejf ma dziś
`status: aktywna` przy wszystkich H-001..H-005 → `decision = 'active'`.

### 4.4 `screenshots` i `settings` (0018)

- `screenshots.note_id integer NULL REFERENCES notes ON DELETE CASCADE`;
  CHECK `screenshots_owner` przepisany na `num_nonnulls(trade_id, day_note_id, note_id) = 1`;
  indeks `(note_id) WHERE note_id IS NOT NULL`.
- `screenshots.sha256 text NULL` (bajty **pliku wgranego**, przed konwersją sharp → WebP; dowód
  do `evidence_hash`), `captured_at timestamptz NULL`, `chart_state jsonb NULL` (symbol, interwał,
  zakres z `tj shot`). Stare wiersze: NULL.
- `settings.ruleset_version integer NOT NULL DEFAULT 0`.

---

## 5. Faza 2b — rdzeń MUST (migracje 0020+)

### 5.1 Plan zamrożony: `trade_plans`, `trade_plan_addenda` (0021)

```sql
CREATE TABLE trade_plans (
  id serial PK,
  trade_id integer NULL UNIQUE REFERENCES trades ON DELETE CASCADE,  -- plan powstaje PRZED trade'em
  account_id integer NOT NULL REFERENCES accounts ON DELETE RESTRICT,
  instrument_id integer NOT NULL REFERENCES instruments ON DELETE RESTRICT,
  backtest_session_id integer NULL REFERENCES backtest_sessions ON DELETE CASCADE,
  day date NOT NULL,                                     -- dzien handlowy planu
  setup_id integer NULL REFERENCES setups ON DELETE RESTRICT,
  setup_version_id integer NULL REFERENCES setup_versions ON DELETE RESTRICT,
  ruleset_version integer NOT NULL,                      -- zestaw regul w chwili zamrozenia
  direction text NOT NULL CHECK (direction IN ('long','short')),
  bias text NULL CHECK (bias IN ('long','short','neutral')),
  entry_price numeric(18,8) NOT NULL,
  stop_loss numeric(18,8) NOT NULL,
  take_profit numeric(18,8) NULL,
  contracts numeric(14,4) NOT NULL CHECK (contracts > 0),
  risk_cents bigint NOT NULL CHECK (risk_cents > 0),     -- MIGAWKA z computeTrade w chwili zamrozenia
  thesis_words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,
  invalidation_words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,
  origin text NOT NULL CHECK (origin IN ('user','ai')),  -- 'ai' = AI przepisalo plan ze slow uzytkownika
  created_by_token_id integer NULL REFERENCES api_tokens ON DELETE NO ACTION,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (CASE direction WHEN 'long'  THEN stop_loss < entry_price AND (take_profit IS NULL OR take_profit > entry_price)
                        WHEN 'short' THEN stop_loss > entry_price AND (take_profit IS NULL OR take_profit < entry_price) END)
);
-- indeksy: (day), (account_id, day), (setup_id)

CREATE TABLE trade_plan_addenda (       -- tylko dopisywanie: tj_forbid_update
  id serial PK,
  plan_id integer NOT NULL REFERENCES trade_plans ON DELETE CASCADE,
  field text NULL CHECK (field IN ('stop_loss','take_profit','contracts','bias','invalidation','other')),
  new_value jsonb NULL,
  words_id integer NOT NULL REFERENCES user_words ON DELETE NO ACTION,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`tj_plan_guard` (BEFORE UPDATE): dozwolone jest wyłącznie przypięcie trade'u (`OLD.trade_id IS NULL`,
`NEW.trade_id IS NOT NULL`, reszta bez zmian). `risk_cents` liczy `computeTrade` (podgląd jak
`dryRun` w `persistTrade`), nigdy SQL ani `prop.ts` — tick jest w tysięcznych USD (ADR-002).
Plan jest migawką: ryzyko zapisane w chwili decyzji nie może się zmienić po zmianie katalogu
instrumentów, dlatego to jeden z niewielu zapisanych wyników obliczeń.

### 5.2 Werdykt AI niezmienny: zmiany w `trade_reviews`, `trade_rule_checks` (0021)

| Zmiana | Szczegół |
|---|---|
| `kind text NOT NULL DEFAULT 'ai' CHECK (kind IN ('ai','user_override'))` | korekta użytkownika = nowy wiersz |
| `overrides_review_id integer NULL REFERENCES trade_reviews ON DELETE NO ACTION` | `CHECK ((kind = 'user_override') = (overrides_review_id IS NOT NULL))` |
| `as_of timestamptz NULL` | czas **zegarowy** wydania werdyktu (≠ `evidence_cutoff`, który jest czasem **rynkowym** ostatniej świecy) |
| `evidence_hash text NULL` + `evidence_manifest jsonb NULL` | SHA-256 kanonicznego JSON-a: lista świec (czas, OHLC) + `sha256` zrzutów; `CHECK ((as_of IS NULL) = (evidence_hash IS NULL))` |
| `ruleset_version integer NULL` | zestaw reguł, względem którego oceniono (zastępuje `brain_version` w nowych wierszach) |
| `created_by_token_id integer NULL REFERENCES api_tokens ON DELETE NO ACTION` | |
| **usunięcie** `trade_reviews_trade_basis_uq` → `UNIQUE (trade_id, basis) WHERE kind = 'ai'` | override nie koliduje z werdyktem |
| `trade_rule_checks.rule_version_id integer NULL REFERENCES rule_versions ON DELETE RESTRICT` | wersja tej konkretnej reguły |

Triggery: na `trade_reviews` `tj_guard_columns(...)` wszystkich kolumn werdyktu, **warunkowo**
`WHEN (OLD.as_of IS NOT NULL)` — stare oceny bez `as_of` zachowują się jak w ADR-028. Na
`trade_rule_checks` trigger sprawdza `as_of` rodzica i przepuszcza wyłącznie zmianę `user_verdict`
(to zdanie użytkownika, nie werdykt AI). Miara „ile werdyktów zmienił użytkownik” = liczba
`user_override` + `user_verdict = 'disagree'` — wyliczana. Flaga „model mógł znać ten dzień”
— wyliczana (ADR-033), bez kolumny.

### 5.3 Proces i playbook (0020)

**`trades` (dokładane):**

| Kolumna | Typ / ograniczenie | Uwagi |
|---|---|---|
| `process_grade` | `text NULL CHECK (process_grade IN ('A','B','C'))` | NULL = nieocenione; zapisuje UI albo zatwierdzona sugestia AI |
| `process_graded_at` | `timestamptz NULL` | `CHECK ((process_grade IS NULL) = (process_graded_at IS NULL))` |
| `setup_id` | `integer NULL REFERENCES setups ON DELETE SET NULL` | |
| `setup_version_id` | `integer NULL REFERENCES setup_versions ON DELETE SET NULL` | wersja w chwili decyzji, zapisywana raz |
| `ruleset_version` | `integer NULL` | j.w.; NULL dla historii sprzed v2 |
| `day_known` | `boolean NOT NULL DEFAULT false` | metodyka R15: trade z replayu, trader rozpoznał dzień |
| `search` | `tsvector GENERATED … (f_unaccent(coalesce(note,'') ‖ ' ' ‖ coalesce(mood_note,'')))` | Ctrl+K; indeks GIN |

**Źródło danych jest wyliczane, kolumny `data_source` nie ma.** Słowa użytkownika (14.10.2026):
«Wyliczane». Jedna funkcja `zrodloDanych` w `lib/domain/zrodla.ts` i jej lustro SQL w `filters.ts`
(test parzystości TS↔SQL, wzór `wynikTrade`/`sqlWynik` z ADR-011):

```sql
CASE
  WHEN t.backtest_session_id IS NOT NULL THEN bs.kind          -- 'backtest' | 'forward'
  WHEN a.type IN ('demo','paper')        THEN 'demo'
  ELSE                                        'live'           -- 'live' | 'prop'
END
```

Podział `live` na realne / prop eval / prop funded daje istniejąca `kategoriaKonta` (ADR-027).
Wskaźnik „ile R znika między backtestem a live” grupuje po tej funkcji. Nie mylić z `trades.source`
(ADR-026: kanał wpisu — formularz, TradingView, FX Replay).

„W chwili decyzji” dla replayu znaczy czas **zegarowy** zapisu, nie `entry_time` (ten jest
historyczny, np. 2023). Ta sama zasada w sprawdzeniu „plan przed wejściem”: dla sesji
`kind = 'backtest'` porównujemy `trade_plans.frozen_at` z `trades.created_at`, dla reszty z `entry_time`.

```sql
CREATE TABLE setups (
  id serial PK,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text NOT NULL,
  note_id integer NOT NULL UNIQUE REFERENCES notes ON DELETE RESTRICT,   -- karta: opis i historia (kind 'setup')
  retired_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE setup_versions (
  id serial PK,
  setup_id integer NOT NULL REFERENCES setups ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('proposed','approved','rejected','superseded')),
  preconditions jsonb NOT NULL DEFAULT '[]',     -- [{id, text}] kontekst, bias, sesja
  entry_checklist jsonb NOT NULL DEFAULT '[]',   -- [{id, text, rule_code?}]
  stop_rule text, target_rule text, be_rule text, invalidation text, avoid text,
  thresholds jsonb NOT NULL,                     -- progi statusu ZADEKLAROWANE Z GORY (min n, granice)
  origin text NOT NULL CHECK (origin IN ('user','ai','mentor','vault-import')),
  counterargument text NULL, evidence jsonb NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL, superseded_at timestamptz NULL,
  created_by_token_id integer NULL REFERENCES api_tokens ON DELETE NO ACTION,
  UNIQUE (setup_id, version),
  CHECK (origin <> 'ai' OR (counterargument IS NOT NULL AND evidence IS NOT NULL))
);
-- UNIQUE (setup_id) WHERE status = 'approved'; UNIQUE (setup_id) WHERE status = 'proposed'
-- triggery: tj_require_ui_actor (approved/rejected); tj_guard_columns(tresc wersji) jak w rule_versions

CREATE TABLE setup_examples (
  id serial PK,
  setup_id integer NOT NULL REFERENCES setups ON DELETE CASCADE,
  trade_id integer NOT NULL REFERENCES trades ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('a_plus','anti')),
  screenshot_id integer NULL REFERENCES screenshots ON DELETE SET NULL,
  caption_words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,
  origin text NOT NULL CHECK (origin IN ('user','ai')),   -- 'ai' tylko po zatwierdzeniu sugestii
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (setup_id, trade_id, kind)
);

CREATE TABLE trade_note_links (          -- trade <-> hipoteza / pojecie ICT / blad / mocna strona
  id serial PK,
  trade_id integer NOT NULL REFERENCES trades ON DELETE CASCADE,
  note_id integer NOT NULL REFERENCES notes ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('hypothesis','concept','mistake','strength','other')),
  origin text NOT NULL CHECK (origin IN ('user','ai')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_id, note_id, role)
);
-- indeks: (note_id, role)
```

**Zatwierdzone tylko w tabelach docelowych.** AI nie wstawia bezpośrednio do `trade_tags`,
`trade_note_links` ani `setup_examples`. Propozycja czeka w `ai_suggestions`; zatwierdzenie
(UI, jedno kliknięcie) wstawia wiersz z `origin = 'ai'`, odrzucenie niczego nie wstawia, cofnięcie
kasuje wstawiony wiersz. Dzięki temu istniejące statystyki, grupowanie i Edge Finder („liczą
tylko zatwierdzone”) **nie wymagają zmiany** — w tabelach docelowych nie ma niczego niezatwierdzonego.
`trade_tags` dostaje tylko `origin text NOT NULL DEFAULT 'user' CHECK (origin IN ('user','ai'))`
do pokazania pochodzenia.

### 5.4 Kolejka AI i dopiski: `ai_suggestions`, `note_additions` (0020)

```sql
CREATE TABLE ai_suggestions (
  id serial PK,
  kind text NOT NULL CHECK (kind IN ('tag','trade_link','setup_example','process_grade',
        'profile_term','day_conclusion','weekly_conclusion','strategy_detail')),
  status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','accepted','rejected','applied','reverted')),
  target jsonb NOT NULL,                  -- {"type":"trade","id":123}
  payload jsonb NOT NULL,
  claim text NOT NULL,                    -- twierdzenie jednym zdaniem
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0),
  evidence_level text NOT NULL CHECK (evidence_level IN ('tested','partial','inferred')),
  n integer NULL CHECK (n IS NULL OR n >= 0),
  applied_ref jsonb NULL,                 -- co wstawiono (do cofniecia)
  created_by_token_id integer NULL REFERENCES api_tokens ON DELETE NO ACTION,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- indeksy: (status, created_at) WHERE status = 'pending'; (kind, status)
-- trigger: tj_require_ui_actor na przejsciu w accepted / rejected / reverted
-- 'applied' ustawia API wylacznie dla kind = 'strategy_detail' (MUST 15: obserwacja, nie regula)
```

Twierdzenie bez dowodu nie wejdzie do bazy (CHECK na `evidence`) — MUST 10 i metodyka R21.

```sql
CREATE TABLE note_additions (           -- dopiski AI i mentora do notatek strategii i kart setupu
  id serial PK,
  note_id integer NOT NULL REFERENCES notes ON DELETE CASCADE,
  body_md text NOT NULL,                  -- tekst AI/mentora, w UI zawsze podpisany pochodzeniem
  origin text NOT NULL CHECK (origin IN ('ai','mentor')),
  quote_words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,   -- cytat ze slow uzytkownika
  trade_id integer NULL REFERENCES trades ON DELETE SET NULL,
  evidence jsonb NULL,
  suggestion_id integer NULL REFERENCES ai_suggestions ON DELETE SET NULL,
  -- mentor_claim_id dokladany w 0027 (mentor_claims powstaje pozniej)
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz NULL,
  CHECK (origin <> 'ai' OR (trade_id IS NOT NULL AND (quote_words_id IS NOT NULL OR evidence IS NOT NULL)))
);
-- indeks: (note_id) WHERE reverted_at IS NULL
-- tj_guard_columns: wszystko poza reverted_at i trade_id (SET NULL przy skasowaniu trade'u)
```

`n` hipotezy = `n_imported` + liczba `trade_note_links (role='hypothesis')` do jej notatki, tylko
trade'y `closed` (bariera `closedOnly` z ADR-024). Zapisane linki są z definicji zatwierdzone.

### 5.5 Hipotezy: warianty i progi (0022)

```sql
CREATE TABLE hypothesis_variants (
  id serial PK,
  hypothesis_id integer NULL REFERENCES hypotheses ON DELETE CASCADE,
  setup_id integer NULL REFERENCES setups ON DELETE CASCADE,
  label text NOT NULL,
  params jsonb NOT NULL,                  -- {"sl":"...","tp":"...","okno":"09:30-10:00"}
  params_hash text NOT NULL,              -- sha256 kanonicznego JSON-a (posortowane klucze)
  n_tested integer NOT NULL CHECK (n_tested >= 0),
  result jsonb NULL,                      -- migawka wyniku wariantu
  origin text NOT NULL CHECK (origin IN ('user','ai')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(hypothesis_id, setup_id) = 1)
);
-- UNIQUE NULLS NOT DISTINCT (hypothesis_id, setup_id, params_hash)
```

Licznik testowanych wariantów = `count(*)`; ostrzeżenie „wynik najlepszego jest zawyżony” liczy
`stats-ci.ts`. Tabela nie ma triggera niezmienności, bo wariant zarejestrowany przez pomyłkę
musi dać się skasować w UI — ale API nie ma operacji kasowania, więc AI licznika nie zaniży.

```sql
CREATE TABLE threshold_changes (        -- tylko dopisywanie: tj_forbid_update
  id serial PK,
  hypothesis_id integer NOT NULL REFERENCES hypotheses ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('prog_n','thresholds')),
  old_value jsonb NOT NULL, new_value jsonb NOT NULL,
  n_at_change integer NOT NULL,
  result_was_visible boolean NOT NULL,   -- n_at_change >= stary prog_n: wynik byl juz pokazany
  actor text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
```

Zapisuje go trigger `AFTER UPDATE OF prog_n, thresholds ON hypotheses` (liczy `n` zapytaniem) —
log, o którym nie da się zapomnieć w nowej ścieżce zapisu. Progi setupu nie potrzebują logu:
zmiana progu to nowa wersja setupu, a wersje są niezmienne.

### 5.6 Moduł prop (0023, dane w 0024)

```sql
CREATE TABLE prop_firm_presets (
  id serial PK,
  firm text NOT NULL, program text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('eval','funded')),
  account_size_cents bigint NOT NULL CHECK (account_size_cents > 0),
  dd_type text NOT NULL CHECK (dd_type IN ('eod','intraday','static','trailing_to_static')),
  max_dd_cents bigint NOT NULL CHECK (max_dd_cents > 0),
  dd_lock_cents bigint NULL,               -- trailing_to_static: przy jakim zysku DD staje w miejscu
  daily_loss_cents bigint NULL CHECK (daily_loss_cents IS NULL OR daily_loss_cents > 0),
  profit_target_cents bigint NULL,
  consistency_pct numeric(5,2) NULL CHECK (consistency_pct IS NULL OR (consistency_pct > 0 AND consistency_pct <= 100)),
  min_days smallint NULL, max_contracts_mini smallint NULL, max_contracts_micro smallint NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  read_on date NOT NULL,                   -- data odczytu regulaminu
  effective_from date NULL,
  needs_verification boolean NOT NULL DEFAULT true,   -- [DO WERYFIKACJI] przy sprzecznych zrodlach
  extra jsonb NOT NULL DEFAULT '{}',       -- reguly pokazywane, ale nieliczone (newsy, skalowanie)
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (dd_type <> 'trailing_to_static' OR dd_lock_cents IS NOT NULL)
);
-- UNIQUE (firm, program, phase, account_size_cents, read_on)

CREATE TABLE prop_rules (                 -- regula konta: kopia presetu, kazde pole edytowalne
  id serial PK,
  account_id integer NOT NULL REFERENCES accounts ON DELETE CASCADE,
  preset_id integer NULL REFERENCES prop_firm_presets ON DELETE SET NULL,
  valid_from date NOT NULL,
  -- te same kolumny regul co w presecie (dd_type ... max_contracts_micro, source_url)
  confirmed_at timestamptz NULL,           -- uzytkownik potwierdzil wartosci z regulaminem (metodyka R29)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, valid_from)
);
-- regula obowiazujaca = najnowsza z valid_from <= dzien

CREATE TABLE prop_ledger (
  id serial PK,
  account_id integer NOT NULL REFERENCES accounts ON DELETE RESTRICT,   -- konta sie archiwizuje
  kind text NOT NULL CHECK (kind IN ('eval_fee','reset_fee','activation_fee','subscription',
                                     'data_fee','payout','refund','other')),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),               -- ze znakiem: koszt < 0, wplyw > 0
  occurred_on date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'other' OR (kind IN ('payout','refund')) = (amount_cents > 0))
);
-- indeks: (account_id, occurred_on)
```

Bufory, ostrzeżenia 50/75/90%, consistency, bufor „gdy trafi SL” i łączna ekspozycja NQ liczy
`lib/domain/prop.ts` z `prop_rules`, `accounts.starting_balance`, `trades.pnl` i ryzyka planu
(wszystko w centach). Tabeli stanu konta nie ma — stan to funkcja historii. Presety (9 firm z planu)
wpisuje migracja danych 0024 dopiero po weryfikacji `market-researcher` w oficjalnych regulaminach;
wartości są danymi, więc ich zmiana to zwykła edycja, nie wydanie.

### 5.7 Przegląd tygodnia i rytuał dnia (0025, 0021)

```sql
CREATE TABLE weekly_reviews (
  id serial PK,
  week_start date NOT NULL UNIQUE CHECK (extract(isodow FROM week_start) = 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  draft_md text NULL,                      -- szkic AI (origin ai, podpisany)
  stats_snapshot jsonb NULL, as_of timestamptz NULL,   -- liczby, na ktorych stal szkic
  conclusions_words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,
  commitment_words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,  -- JEDNO zobowiazanie: jedna kolumna
  prev_commitment_result text NULL CHECK (prev_commitment_result IN ('kept','partial','broken')),
  prev_result_words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,
  approved_at timestamptz NULL,
  CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
-- trigger: tj_require_ui_actor na przejsciu w 'approved'
```

`day_notes` (0021): `bias text NULL CHECK (bias IN ('long','short','neutral'))`,
`max_trades smallint NULL CHECK (max_trades BETWEEN 1 AND 20)`, `sleep smallint NULL CHECK (sleep BETWEEN 1 AND 5)`.
Unieważnienie dnia → `user_words (role='day.invalidation', day=…)`. Przy okazji CHECK 1–5 na
istniejących `mood`, `energy`, `day_rating` — jako `NOT VALID`, potem `VALIDATE CONSTRAINT`
(dane historyczne zapisywała akcja z tym samym zakresem, ale walidacja w przeglądarce nie jest
zabezpieczeniem).

### 5.8 Wykres, słownik, poprawki (0026)

```sql
CREATE TABLE chart_annotations (
  id serial PK,
  platform text NOT NULL CHECK (platform IN ('tradingview','fxreplay')),
  external_id text NOT NULL,               -- id rysunku na platformie
  trade_id integer NULL REFERENCES trades ON DELETE CASCADE,
  backtest_session_id integer NULL REFERENCES backtest_sessions ON DELETE CASCADE,
  day date NULL,
  shape text NOT NULL CHECK (shape IN ('hline','rect','trend','text','other')),
  interval text NULL,
  price numeric(18,8) NULL, price2 numeric(18,8) NULL,
  time_from timestamptz NULL, time_to timestamptz NULL,
  words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,   -- tekst rysunku 1:1 (source='chart')
  raw jsonb NOT NULL,                      -- surowy ksztalt z platformy, do diagnozy
  captured_at timestamptz NOT NULL,
  CHECK (num_nonnulls(trade_id, day) >= 1),
  UNIQUE NULLS NOT DISTINCT (platform, external_id, trade_id, day)
);
```

Serwer odrzuca rysunek, którego tekst zaczyna się od `[AI] ` (ADR-032). Zmiana tekstu rysunku
na wykresie = nowy wiersz `user_words` z `supersedes_id`, `words_id` przepięte.

```sql
CREATE TABLE profile_terms (
  id serial PK,
  term text NOT NULL,                      -- okreslenie uzytkownika, dokladnie tak, jak je pisze
  term_norm text GENERATED ALWAYS AS (lower(public.f_unaccent(term))) STORED UNIQUE,
  meaning text NOT NULL,                   -- np. "FVG@5m po sweepie"
  concept_note_id integer NULL REFERENCES notes ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected')),
  origin text NOT NULL CHECK (origin IN ('user','ai')),
  created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz NULL
);
-- trigger: tj_require_ui_actor (confirmed / rejected)

CREATE TABLE profile_term_sources (
  term_id integer NOT NULL REFERENCES profile_terms ON DELETE CASCADE,
  words_id integer NOT NULL REFERENCES user_words ON DELETE CASCADE,
  PRIMARY KEY (term_id, words_id)
);

CREATE TABLE interpretation_corrections (   -- tylko dopisywanie: tj_forbid_update
  id serial PK,
  words_id integer NOT NULL REFERENCES user_words ON DELETE CASCADE,          -- interpretowane slowa
  before_interpretation text NOT NULL,
  correction_words_id integer NOT NULL REFERENCES user_words ON DELETE NO ACTION,  -- "nie, chodzilo mi o..." doslownie
  after_interpretation text NOT NULL,
  term_id integer NULL REFERENCES profile_terms ON DELETE NO ACTION,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- indeks: (created_at) -- miara "odsetek poprawionych interpretacji w czasie"
```

Poprawka idzie jedną transakcją: wiersz w `interpretation_corrections` + nowa wartość
`user_words.ai_interpretation` (jedyna zmienna kolumna tamtej tabeli). Miara spadku poprawek
jest wyliczana, bez kolumny.

### 5.9 Mentor i luki (0027)

```sql
CREATE TABLE mentor_sources (
  id serial PK,
  platform text NOT NULL DEFAULT 'youtube' CHECK (platform IN ('youtube')),
  video_id text NOT NULL, playlist_id text NULL, position integer NULL,
  title text NOT NULL, url text NOT NULL CHECK (url ~ '^https://'),
  published_at timestamptz NULL, duration_s integer NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','no_captions','error')),
  transcript_source text NULL CHECK (transcript_source IN ('captions','whisper')),
  transcript_path text NULL,               -- sciezka lokalna na R:, nigdy tresc transkrypcji
  error text NULL, processed_at timestamptz NULL,
  UNIQUE (platform, video_id)              -- idempotencja tj mentor sync
);

CREATE TABLE mentor_claims (
  id serial PK,
  source_id integer NOT NULL REFERENCES mentor_sources ON DELETE CASCADE,
  quote text NOT NULL,                     -- dosłowny cytat
  quote_sha256 text NOT NULL,              -- trigger, jak w user_words
  t_start_s integer NOT NULL CHECK (t_start_s >= 0),
  t_end_s integer NULL CHECK (t_end_s IS NULL OR t_end_s >= t_start_s),
  claim_type text NOT NULL CHECK (claim_type IN ('concept','setup_condition','management','psychology','other')),
  paraphrase text NULL,                    -- streszczenie AI, zawsze podpisane
  status text NOT NULL DEFAULT 'extracted' CHECK (status IN ('extracted','merged','review_ok','review_bad')),
  merged_note_id integer NULL REFERENCES notes ON DELETE SET NULL,
  setup_id integer NULL REFERENCES setups ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, quote_sha256, t_start_s)
);
-- tj_guard_columns('source_id','quote','quote_sha256','t_start_s','t_end_s')

ALTER TABLE note_additions ADD COLUMN mentor_claim_id integer NULL REFERENCES mentor_claims ON DELETE NO ACTION;
ALTER TABLE note_additions ADD CONSTRAINT note_additions_mentor CHECK (origin <> 'mentor' OR mentor_claim_id IS NOT NULL);

CREATE TABLE strategy_gaps (
  id serial PK,
  kind text NOT NULL CHECK (kind IN ('gap','mentor_conflict')),   -- "Do rozstrzygniecia" = mentor_conflict
  question text NOT NULL,
  dedupe_key text NOT NULL,                -- sha256(kind + znormalizowane pytanie)
  setup_id integer NULL REFERENCES setups ON DELETE SET NULL,
  trade_id integer NULL REFERENCES trades ON DELETE SET NULL,
  mentor_claim_id integer NULL REFERENCES mentor_claims ON DELETE SET NULL,
  note_id integer NULL REFERENCES notes ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','asked','answered','dismissed')),
  origin text NOT NULL CHECK (origin IN ('ai','mentor')),
  asked_at timestamptz NULL, answered_at timestamptz NULL,
  answer_words_id integer NULL REFERENCES user_words ON DELETE NO ACTION,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'mentor_conflict' OR mentor_claim_id IS NOT NULL),
  CHECK ((status = 'answered') = (answer_words_id IS NOT NULL))
);
-- UNIQUE (dedupe_key) WHERE status IN ('open','asked')
-- trigger: tj_require_ui_actor na przejsciu w answered / dismissed (AI nie rozstrzyga)
-- 'asked' ustawia API (rytual po sesji zadaje pytanie, po jednym)
```

---

## 6. Co jest niezmienne i czym to wymusza baza

| Co | Mechanizm w bazie | Zachowanie API v2 |
|---|---|---|
| `user_words` (tekst, skrót, kotwice) | `tj_guard_columns` | `PATCH`/`PUT` → 409; poprawka tylko w UI = nowy wiersz `supersedes_id` |
| `trade_plans` | `tj_plan_guard` (wolno tylko przypiąć trade) | `POST` raz; potem tylko `POST …/addenda` |
| `trade_plan_addenda`, `note_revisions`, `threshold_changes`, `interpretation_corrections`, `auth_events` | `tj_forbid_update` | brak tras zmiany |
| werdykt AI z `as_of` (`trade_reviews`, `trade_rule_checks` poza `user_verdict`) | `tj_guard_columns … WHEN (OLD.as_of IS NOT NULL)` | ponowne wysłanie → 409; korekta = `user_override` |
| treść wersji reguły i setupu | `tj_guard_columns` (zmienia się tylko status) | brak tras zmiany treści |
| zatwierdzenia (`rule_versions`, `setup_versions`, `hypotheses.decision`, `ai_suggestions`, `profile_terms`, `weekly_reviews`, `strategy_gaps`) | `tj_require_ui_actor` | brak tras; zakres `approve` nie istnieje (CHECK) |
| cytat i znacznik czasu mentora | `tj_guard_columns` | — |
| `api_tokens.token_sha256`, `scopes` | (UI) brak ścieżki zmiany; zmiana zakresu = nowy token | — |

Triggery chronią przed błędem we **własnym** kodzie (nowa akcja serwera, skrypt, import), nie przed
właścicielem bazy. Kasowanie nie jest blokowane triggerem nigdzie (kaskady z kasowania trade'u
w UI muszą działać); API v2 i MCP nie mają operacji kasowania.

**Pułapka do zapamiętania:** FK z tabeli niezmiennej do tabeli, którą da się skasować, musi mieć
`NO ACTION`/`RESTRICT`. `ON DELETE SET NULL` to `UPDATE` wiersza niezmiennego → trigger rzuca
i skasowanie rodzica pada z niezrozumiałym błędem. Tokenów się więc nie kasuje (unieważnia), a wersji
reguł i setupów użytych w werdyktach nie da się skasować.

---

## 7. Wyszukiwanie

- **Pełnotekstowe:** `search @@ websearch_to_tsquery('simple', public.f_unaccent($q))`, ranking
  `ts_rank`; dla ostatniego słowa zapytania prefiks (`:*`), żeby Ctrl+K działał w trakcie pisania.
- **Rozmyte:** `lower(public.f_unaccent(title)) % lower(public.f_unaccent($q))` (próg `pg_trgm.similarity_threshold`,
  domyślnie 0,3) i `ILIKE` po tym samym wyrażeniu — oba korzystają z indeksów GIN `gin_trgm_ops`.
- **Zakres `/api/v2/search`:** `notes` ∪ `user_words` ∪ `trades.search`, z typem wyniku.
- **Test z planu:** „zarzadzanie” znajduje „Zarządzanie”. Dołożyć przypadek z „ł” (`unaccent`
  mapuje ł → l regułą słownika, w odróżnieniu od NFD, które ł nie rozkłada) i z tekstem w NFD
  (sekcja 8, pkt 6).
- **Dlaczego nie `polish`:** brak wbudowanego słownika polskiego w Postgresie; pliki ispell
  wymagałyby własnego obrazu bazy w Coolify (ADR-029).

---

## 8. Pułapki, które ten model musi przeżyć

1. **Tick w tysięcznych USD (ADR-002).** Wszystko, co nowe, liczy pieniądze w **centach**. Ryzyko
   planu i bufor „gdy trafi SL” biorą `riskAmount` z `computeTrade`, nigdy `ticks × tick_value`
   w `prop.ts` ani w SQL (ZN: 15,625 USD nie jest całkowite w centach, kolejność zaokrągleń zmienia wynik).
2. **`computeTrade` jedynym liczącym (ADR-003).** API v2 `trades` przenosi logikę z `src/lib/ingest/*`
   i zapisuje wyłącznie przez `persistTrade` → `computeTrade`. Żadna nowa tabela nie trzyma kopii
   `pnl`/R (wyjątek: zamrożone `trade_plans.risk_cents` jako migawka decyzji).
3. **`lib/domain` czysty.** `stats-ci.ts`, `prop.ts`, `process-grid.ts`, rozszerzenie `discipline.ts`,
   parser `[[...]]`, kanoniczny JSON do `evidence_hash`/`params_hash` — bez importu `db`, `next/*`
   ani `server-only`; bootstrap z wstrzykiwanym ziarnem (testy deterministyczne). Proponuję regułę
   ESLint `no-restricted-imports` dla `src/lib/domain/**`.
4. **Migracje pisane ręcznie, nigdy `drizzle-kit generate`** (dług z ADR-017: brak snapshotów od 0010;
   `generate` wyprodukowałby duplikat). Każda: plik `drizzle/00NN_nazwa.sql` + wpis w
   `drizzle/meta/_journal.json` (`idx` kolejny, `when` rosnący: 0016 → `1787610000000`, dalej co
   `10000000`, `breakpoints: true`) + lustro w `schema.ts` (CHECK-i i indeksy też, jak dotąd).
   Separator `--> statement-breakpoint` nie może wystąpić w treści funkcji ani w komentarzu.
   `CREATE EXTENSION` i `CREATE FUNCTION` działają w transakcji, więc oba migratory
   (drizzle lokalnie — jedna transakcja na całą serię; `scripts/migrate.mjs` — transakcja na plik) je przyjmą.
5. **LF i hash bajtów migracji.** Migrator liczy SHA-256 z treści pliku; wdrożonego pliku nie wolno
   edytować (nawet komentarza, nawet końców linii). **Stan dziś (sprawdzone `git ls-files --eol`):**
   w indeksie wszystkie `*.sql` mają LF, ale `core.autocrlf=true` daje w katalogu roboczym CRLF dla
   `0004`, `0009`–`0015`. Produkcja buduje z gita (LF) — zgodna. **Lokalna baza** migrowana z Windows
   mogła zapisać skróty z wersji CRLF. Po dodaniu `.gitattributes` (`*.sql text eol=lf`) i odświeżeniu
   plików lokalny migrator uzna te 8 migracji za nowe i spróbuje je wykonać drugi raz (pierwszy
   `ALTER … ADD COLUMN` padnie). Rozwiązanie w fazie 1, przed `0016`: postawić lokalną bazę od zera
   (i tak potrzebny test „migracje od zera vs `schema.ts`”) albo jednorazowo podmienić skróty CRLF → LF
   w lokalnym `drizzle.__drizzle_migrations`. **Nigdy na produkcji.** To samo dotyczy edytorów
   dokładających BOM.
6. **Hash bajtów słów użytkownika.** SHA-256 z bajtów UTF-8, bez normalizacji. Konsekwencje:
   CRLF ze schowka Windows zostaje CRLF; tekst w NFD (rzadki, np. z nazw plików macOS) zostaje NFD
   i ma inny skrót niż ten sam tekst w NFC — to poprawne („bajt w bajt”), ale wyszukiwanie po
   `unaccent` może go nie znaleźć (test). Postgres odrzuca bajt NUL w `text` → API 400 z komunikatem,
   nie 500. `tj` czyta tekst jako bajty (plik/stdin binarnie); potok PowerShell 5.1 potrafi
   przekodować wejście — test z planu (polskie znaki, emoji, nowe linie) musi przejść przez CLI na Windows.
7. **`set_config('tj.actor', …, true)`** jest lokalne dla transakcji. Musi być wołane na tym samym
   połączeniu co zapis (`sql.begin(tx => …)` w postgres.js). Z `false` wartość wyciekłaby na
   połączenie z puli i następne zapytanie innej ścieżki miałoby cudzego aktora. Akcje UI, które
   zatwierdzają, też muszą otwierać transakcję i ustawiać `'ui'` — inaczej trigger je odrzuci (to dobrze:
   błąd widać od razu w teście).
8. **Czas w replayu.** `entry_time` trade'u z backtestu jest historyczny. „Plan przed wejściem”,
   „wersja reguł w chwili decyzji” i „werdykt przed wynikiem” porównują czasy **zegarowe**
   (`frozen_at`, `created_at`, `as_of`), a „AI widziało dane do HH:MM” to `evidence_cutoff` (czas rynkowy).
9. **NULL w unikatach** (`NULL ≠ NULL`): `NULLS NOT DISTINCT` tylko przez `unique()` w drizzle 0.45;
   w innych miejscach indeksy częściowe — jak w `day_notes` (ADR-008).
10. **Kolumny generowane z `f_unaccent`.** Wyrażenie musi wołać `public.f_unaccent` z pełną nazwą;
    przy `pg_restore` `search_path` jest pusty. Zmiana definicji `f_unaccent` po fakcie wymaga przebudowy
    kolumn generowanych i indeksów — traktować ją jak wdrożoną migrację (nie ruszać).
11. **Trigger rzuca `TJ409`/`TJ403`, API tłumaczy na polski komunikat.** Użytkownik nie ma prawa
    zobaczyć surowego błędu Postgresa (zasada z ADR-018/025).

---

## 9. Kolejność migracji i przypisanie do faz

| Plik | Faza / wydanie | Zawartość | Zależy od |
|---|---|---|---|
| `0016_totp.sql` | **1 / R1** | `settings.totp_*`, `auth_backup_codes`, `auth_events`, funkcja `tj_forbid_update` | — |
| `0017_api_tokens.sql` | **2 / R2** | `api_tokens`, `device_codes` | 0016 |
| `0018_notatki.sql` | **2 / R2** | rozszerzenia, `f_unaccent`, `tj_guard_columns`, `tj_require_ui_actor`, `tj_user_words_hash`, `tj_note_revision`; `notes`, `note_revisions`, `note_links`, `user_words`, `hypotheses`, `rules`, `rule_versions`; `screenshots.note_id/sha256/captured_at/chart_state` + nowy `screenshots_owner`; `settings.ruleset_version` | 0017 |
| `0019_auth_events_token_fk.sql` | **2 / R2** (po scaleniu z fazą 1) | FK `auth_events.token_id` → `api_tokens` (NO ACTION) + indeks częściowy; osobna migracja, bo 0016 i 0017 są już w historii i nie wolno ich edytować | 0016, 0017 |
| `0020_proces_playbook.sql` | **2b / R2b** | `trades.process_grade/process_graded_at/setup_id/setup_version_id/ruleset_version/day_known/search`, `trade_tags.origin`; `setups`, `setup_versions`, `setup_examples`, `trade_note_links`, `ai_suggestions`, `note_additions` | 0018 |
| `0021_plan_werdykt.sql` | 2b | `trade_plans` (+`tj_plan_guard`), `trade_plan_addenda`; zmiany `trade_reviews`, `trade_rule_checks`; `day_notes.bias/max_trades/sleep` + CHECK-i `NOT VALID` | 0020 |
| `0022_hipotezy_warianty.sql` | 2b | `hypothesis_variants`, `threshold_changes` + trigger logu | 0020 |
| `0023_prop.sql` | 2b | `prop_firm_presets`, `prop_rules`, `prop_ledger` | — |
| `0024_prop_presety.sql` | 2b (po weryfikacji regulaminów) | **tylko dane**: presety 9 firm z URL, `read_on`, `needs_verification` | 0023 |
| `0025_przeglad_tygodnia.sql` | 2b | `weekly_reviews` | 0018 |
| `0026_profil_wykres.sql` | 2b (potrzebne fazie 3) | `chart_annotations`, `profile_terms`, `profile_term_sources`, `interpretation_corrections` | 0018 |
| `0027_mentor_luki.sql` | 2b (przed fazą 4b) | `mentor_sources`, `mentor_claims`, `note_additions.mentor_claim_id`, `strategy_gaps` | 0020 |

Każde wydanie: kopia bazy w Coolify przed scaleniem (STOP z planu), migracje sprawdzone oboma
migratorami na świeżej bazie lokalnej (`127.0.0.1:55433`), test „migracje od zera vs `schema.ts`”.
Wszystkie migracje są **dokładające** (nowe tabele, nowe kolumny NULL/DEFAULT, nowe CHECK-i);
jedyna zmiana istniejącego ograniczenia to `screenshots_owner` (rozszerzenie, stare wiersze go spełniają)
i unikat `trade_reviews` (zawężenie do `kind='ai'`, stare wiersze mają `kind='ai'`). Cofnięcie samej
aplikacji na starszy obraz jest bezpieczne: stary kod nie zna nowych tabel i kolumn.

---

## 10. Do sprawdzenia na serwerze (przed 0018, odczyt, bez zmian)

```sql
SHOW server_version;                       -- ADR-001 zaklada 17; NULLS NOT DISTINCT wymaga >= 15, sha256() >= 11
SHOW server_encoding;                      -- musi byc UTF8 (convert_to(text,'UTF8') i skroty)
SELECT name, default_version, installed_version
  FROM pg_available_extensions WHERE name IN ('unaccent','pg_trgm');
SELECT rolsuper FROM pg_roles WHERE rolname = current_user;
SELECT has_database_privilege(current_user, current_database(), 'CREATE');
-- unaccent i pg_trgm sa "trusted" od PG13: wystarczy CREATE na bazie, superuser niepotrzebny.
-- Gdy pg_available_extensions ich nie zwraca: obraz bazy w Coolify nie ma contrib -> decyzja przed faza 2.
```

Po instalacji lokalnie (nie na produkcji): `SELECT public.f_unaccent('Zarządzanie łódź')` → `Zarzadzanie lodz`.

---

## 11. Czego model świadomie nie ma

- tabeli stanu konta prop (stan = funkcja historii), tabeli naruszeń dyscypliny (wyliczane),
  kolumny statusu reguły i fazy hipotezy (wyliczane), flagi look-ahead (wyliczana);
- kolumny `data_source` — źródło danych jest wyliczane (Słowa użytkownika, 14.10.2026: «Wyliczane»; sekcja 5.3);
- „okna importu” zatwierdzeń — import reguł tworzy wyłącznie propozycje (Słowa użytkownika, 14.10.2026: «Jako propozycje, zatwierdzam ponownie»);
- jednej liczby „edge score”, serii, gamifikacji, auto-sync brokerów (plan, „Nie robimy”);
- tabeli sesji logowania (sesja zostaje bezstanowa, ADR-005); sudo i drugi krok to ciasteczka;
- połączenia `strategies` (stara tabela, ADR-020) z `setups` — `strategies` zostaje przy sesjach
  backtestu bez zmian; ewentualne `backtest_sessions.setup_id` to SHOULD na później.

---

## 12. Odstępstwa od szkicu w migracjach 0017-0018

Migracje: `drizzle/0017_api_tokens.sql`, `drizzle/0018_notatki.sql`, `drizzle/0019_auth_events_token_fk.sql`; cofnięcie: `docs/v2/rollback/`;
dowód: `src/lib/db/migracje-v2.db.test.ts` (41 testów na prawdziwej bazie, `TEST_DATABASE_URL`).
Wszystko poniżej to odstępstwa od SQL-a w sekcjach 2 i 4, który był szkicem kształtu.

| # | Odstępstwo | Uzasadnienie |
|---|---|---|
| 1 | `tj_forbid_update()` jest zdefiniowana w 0018 przez `CREATE OR REPLACE`, a nie tylko w 0016. | Gałąź fazy 1 (0016) powstawała równolegle; 0018 potrzebuje tej funkcji (`note_revisions`). Ciało ma być identyczne w obu plikach. |
| 2 | 0017 **nie** dokłada FK `auth_events.token_id` → `api_tokens`. | `auth_events` (0016) nie istnieje w gałęzi fazy 2. Po scaleniu dopisać `ALTER TABLE auth_events ADD CONSTRAINT auth_events_token_id_fkey FOREIGN KEY (token_id) REFERENCES api_tokens (id) ON DELETE NO ACTION` na końcu 0017 (jeśli nigdzie jeszcze niezastosowana) i `.references(() => apiTokens.id)` w `schema.ts`. Test pada, gdy tabela istnieje bez tego FK. |
| 3 | Funkcje triggerów nie mają parametrów w deklaracji; kolumny i stany podaje `CREATE TRIGGER … EXECUTE FUNCTION f('a','b')` (`TG_ARGV`). `tj_guard_columns` odrzuca nazwę nieistniejącej kolumny przy pierwszym `UPDATE`. | W plpgsql trigger nie ma parametrów. Literówka w nazwie kolumny nie może po cichu wyłączyć ochrony (porównanie `NULL` z `NULL` zawsze przechodzi). |
| 4 | `tj_require_ui_actor('kolumna', 'stan', …)` strzeże wejścia w stan **i wyjścia z niego**, także przy `INSERT`. Na `rule_versions` strzeżone: `approved`, `rejected`, **`superseded`** (szkic: dwa pierwsze). Na `hypotheses.decision` dwa triggery: `UPDATE` przy każdej zmianie, `INSERT` gdy `decision <> 'active'`. | Agent nie może ani wstawić od razu zatwierdzonej wersji, ani cofnąć zatwierdzenia, ani wyłączyć obowiązującej wersji przez `superseded`. UI robi `superseded` w tej samej transakcji co zatwierdzenie (aktor `ui`). |
| 5 | Trzeci SQLSTATE: `TJ422` (bramka progu `n` dla `origin = 'ai'`). | Ani 409, ani 403 nie opisują „za mało danych”. API mapuje na 422. |
| 6 | `n` hipotezy liczy `tj_hypothesis_n(id)`, która pyta o `trade_note_links` dynamicznie (`to_regclass`). | `trade_note_links` powstaje w 0020. Dopóki jej nie ma: `n = n_imported`. Po 0020 ta sama funkcja liczy linki (tylko `closed`, `role = 'hypothesis'`) **bez redefinicji**, więc nie ma ukrytego sprzężenia migracji ani ryzyka zapomnianego `CREATE OR REPLACE`. 0020 musi zachować kolumny `trade_id`, `note_id`, `role`. |
| 7 | `user_words.sha256`, `byte_len` i `notes.content_hash` mają `DEFAULT ''` / `0`. | Trigger i tak nadpisuje (klient nie ustala skrótu); `DEFAULT` pozwala pominąć kolumnę w `INSERT` i tak ma typ w drizzle. Bez triggera `CHECK` odrzuci pusty ciąg. Trigger **nie ufa** skrótowi od klienta; niezgodność wykrywa API przed `INSERT`-em. |
| 8 | `tj_guard_columns` na `user_words` obejmuje też `id`, `role`, `created_at`. Dodane: CHECK `byte_len > 0`, indeks `(backtest_session_id)`. | `role` zmienia znaczenie dowodu, `created_at` jest dowodem czasu. Indeks na `backtest_session_id` potrzebny kaskadzie z kasowania sesji. |
| 9 | Brak osobnego indeksu `(status) WHERE status = 'proposed'` na `rule_versions`. | Kolejkę „Do decyzji” obsługuje już unikat `rule_versions_proposed_idx (rule_id) WHERE status = 'proposed'`; indeks na stałej kolumnie byłby bezużyteczny. |
| 10 | Dodatkowe CHECK-i: `screenshots.sha256` (regex SHA-256), `settings.ruleset_version >= 0`, `note_links.target` niepusty, `notes.rev >= 1`. Wszystkie ograniczenia mają jawne nazwy (unikaty `*_uq`, indeksy `*_idx`). | Konwencja „skróty z CHECK”; nazwy potrzebne do porównania ze `schema.ts`. |
| 11 | `tj_note_revision`: `INSERT` zawsze ustawia `rev = 1`; `UPDATE` bez zmiany `title`/`body_md`/`meta` (archiwizacja, `SET NULL` z FK) nie tworzy rewizji i **wymusza** dotychczasowe `rev` i `content_hash`; brak `tj.actor` zapisuje się jako `'unknown'`. | Klient nie może ręcznie podbić `rev` ani podmienić skrótu; zapis treści nie pada z powodu braku etykiety aktora. |
| 12 | `note_revisions.actor` to aktor transakcji, która **zastąpiła** zapisaną treść nową. | Rewizja przechowuje `OLD`; autora `OLD` baza nie zna (nie ma kolumny `last_actor`). |

Konsekwencje dla kodu API: (a) `device_codes.user_code` przyjmuje wyłącznie 20 spółgłosek
`BCDFGHJKLMNPQRSTVWXZ` (przykład `KTWM-4HQP` z ADR-030 narusza `device_codes_user_code`;
alfabet generatora = ta lista); (b) tytuł notatki jest unikalny globalnie po `lower(f_unaccent(title))`,
także między rodzajami i dla zarchiwizowanych (import musi rozstrzygać kolizje); (c) zatwierdzenie
nowej wersji reguły w UI musi w jednej transakcji najpierw ustawić poprzednią `approved` na
`superseded`, potem nową na `approved` (unikaty częściowe sprawdzane po każdej instrukcji);
(d) bardzo duży `body_md` (ponad ok. 1 MB unikalnych słów) przekroczy limit `tsvector`
(błąd 54000) — API powinno ograniczyć rozmiar treści.

## 13. Scalenie z fazą 1 (15.10.2026)

- Numeracja: 0016 (faza 1) → 0017 → 0018 → **0019 (FK `auth_events.token_id`)**. Plan fazy 2b przesunięty o jeden
  numer (0020 proces i playbook … 0027 mentor i luki); sekcje 5 i 9 poprawione.
- `tj_forbid_update`: 0016 tworzy ją (`CREATE FUNCTION`), 0018 zastępuje wersją `CREATE OR REPLACE` o tym samym
  zachowaniu (`TJ409`), z dopiskiem `TABLE` w błędzie i dłuższym komunikatem. Po wszystkich migracjach obowiązuje
  definicja z 0018; test `migracje-v2.db.test.ts` sprawdza, że `auth_events` i `note_revisions` odrzucają UPDATE
  tym samym kodem. 0016 nie wolno edytować (może być już wdrożona), dlatego nie ma tu ujednolicenia treści.
- Sudo przy zatwierdzaniu urządzenia i przy tworzeniu tokenu importu oraz wpisy w `auth_events`
  (`device_requested`, `device_approved`, `device_denied`, `token_created`, `token_revoked`) działają od scalenia.
