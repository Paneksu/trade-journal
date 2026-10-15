# API v2 (`/api/v2`)

Kontrakt dla łącznika `tj` i asystentów AI: trade'y, notatki, słowa użytkownika dosłownie, reguły,
hipotezy, dzień, wyszukiwanie. Decyzje: `docs/decyzje.md`, ADR-029 do 033. Model danych:
`docs/v2/model-danych.md`. **Maszynowy kontrakt: `docs/openapi-v2.json`** (generowany z zod,
`npm run api:kontrakt`; test pada, gdy plik jest nieaktualny). Stary `/api/ingest/**` opisuje
`docs/api-ingest.md`; jest wygaszany (sekcja „Zgodność wstecz” niżej).

## Tokeny i zakresy

Token ma postać `tj_<prefiks>_<sekret>`: prefiks (8 znaków) służy do wyszukania wiersza i do
pokazania w ekranie Urządzenia, sekret (32 losowe bajty) nie leży nigdzie, w bazie jest tylko
SHA-256 całego tokenu. Każde zapytanie: `Authorization: Bearer <token>`.

| Zakres | Pozwala |
|---|---|
| `read` | wszystkie `GET`, wyszukiwanie, `/meta` |
| `write` | trade'y, zrzuty, oceny, sesje, pominięcia, notatki, słowa użytkownika, hipotezy, dzień |
| `propose` | propozycje reguł (`POST /rules/proposals`) |
| `import` | **dodatkowy**: tylko z nim wolno zadeklarować `origin: "vault-import"` (z `nImported`, `vaultStatus`) i `origin: "mentor"`; sam nic nie otwiera |

**Zakres `import`** (Słowa użytkownika 15.10.2026: «Osobny zakres „import”»): token bez niego, który w `POST /notes`,
`POST /rules/proposals` albo `POST /hypotheses` zadeklaruje `vault-import` lub `mentor`, dostaje `403 insufficient_scope`
(`missingScope: "import"`), także gdy serwer i tak potraktowałby wpis jak `ai`. Zakres nadaje **wyłącznie
użytkownik ręcznie** w Ustawienia → Urządzenia → „Utwórz token importu (24 h)”: token (read, write, propose,
import) jest pokazywany raz i wygasa po 24 godzinach. `device/start` nie może go żądać (`400`), a CHECK w bazie
(`device_codes.requested_scopes`) jest drugim zabezpieczeniem.

**Zakresu „zatwierdź” nie ma.** Reguły zatwierdza wyłącznie użytkownik w aplikacji, po jednej.
Pilnują tego trzy niezależne warstwy: brak zakresu (CHECK w bazie), brak trasy zatwierdzającej
(`guard.test.ts` czyta źródła tras) i trigger `tj_require_ui_actor` w bazie (aktor `api:<id>`
dostaje `403`).

## Logowanie kodem urządzenia

1. `POST /api/v2/device/start` `{ "clientName": "tj na laptopie", "scopes": ["read","write"] }`
   (bez tokenu, 10 startów na godzinę na adres) → `deviceCode`, `userCode` (np. `BCDF-GHJK`),
   `verificationUri`, `expiresIn: 600`, `interval: 5`.
2. Użytkownik loguje się do aplikacji i **przepisuje** `userCode` na stronie
   `/urzadzenia/polacz` (Ustawienia → Urządzenia → Połącz urządzenie). Widzi nazwę klienta, adres IP
   żądania i zakresy, może je zawęzić.
3. `POST /api/v2/device/token` `{ "deviceCode": "…" }` co 5 s. Odpowiedzi: `400 authorization_pending`,
   `429 slow_down`, `400 expired_token`, `403 access_denied`, `400 invalid_grant` (kod nieznany albo
   już zrealizowany), a po zatwierdzeniu `200` z `accessToken`. **Token wraca dokładnie raz.**

Unieważnienie: Ustawienia → Urządzenia → „Unieważnij”. Działa od razu, bez restartu.

## Zasady wspólne

- Odpowiedzi: JSON, `Cache-Control: no-store`, nagłówek `x-request-id`. Błąd:
  `{ "error": "<zdanie po polsku>", "code": "<kod>", … }`; komunikat mówi, co się stało, dlaczego
  i jak poprawić, z faktyczną wartością. Surowe błędy bazy trafiają tylko do logów.
- Kolejność bramki: wyłącznik `API_V2_DISABLED=1` (404) → HTTPS w produkcji (403) → blokada po
  8 złych tokenach z adresu (429) → token (401: `unauthorized`, `token_revoked`, `token_expired`)
  → zakres (403 `insufficient_scope` z nazwą brakującego) → limit 120 zapytań na minutę **na token**
  (429) → handler.
- Kody z reguł danych: `409 immutable` (próba zmiany czegoś niezmiennego), `403 approval_forbidden`
  (próba zatwierdzenia), `422 below_threshold` (propozycja AI poniżej progu n), `409 conflict`
  (unikat), `422 unknown_reference` (nieistniejąca kotwica).
- Czasy: ISO 8601 z offsetem lub `Z`. Czas bez strefy to błąd.
- API nie ma operacji kasowania (ADR-032). Notatkę odkłada się do archiwum (`archived: true`).

## Trasy

| Metoda i ścieżka | Zakres | Opis |
|---|---|---|
| `GET /meta` | read | słownik + `contractHash`, `rulesVersion`, zakresy, limity |
| `GET /trades`, `POST /trades` | read, write | jak w `docs/api-ingest.md`; zapis przez `persistTrade`/`computeTrade` |
| `POST /trades/:id/reviews` | write | ocena AI z regułami (do migracji 0021: podmiana, ADR-028) |
| `POST /trades/:id/screenshots` | write | multipart; zastępuje zrzuty tego samego pochodzenia |
| `POST /backtest-sessions`, `POST /skips` | write | jak w ingest |
| `GET /days/:date`, `PUT /days/:date` | read, write | notatka dnia, trade'y, słowa i notatki przypięte do dnia |
| `GET /notes`, `POST /notes` | read, write | lista bez treści / nowa notatka |
| `GET /notes/:id`, `PATCH /notes/:id` | read, write | treść + rewizja (`ETag`) + linki i backlinki; `PATCH` wymaga `If-Match: <rev>` |
| `GET /search?q=` | read | notatki, słowa użytkownika, trade'y; bez polskich znaków, prefiksowo, rozmyto |
| `GET /rules?status=` | read | reguły ze statusem wyliczonym z wersji; `rulesVersion` |
| `POST /rules/proposals` | propose | propozycja reguły albo nowej wersji (jedna oczekująca naraz) |
| `GET /hypotheses`, `POST /hypotheses` | read, write | `n`, próg i faza (`zbieranie` / `do_oceny`) wyliczane |
| `GET /user-words`, `POST /user-words` | read, write | słowa użytkownika bajt w bajt |
| `PATCH`/`PUT /user-words/:id` | write | **zawsze `409`**: poprawia tylko użytkownik w aplikacji |
| `PUT /user-words/:id/interpretation` | write | interpretacja AI, ustawiana raz |
| `POST /device/start`, `POST /device/token` | brak | logowanie kodem urządzenia |

### Notatki i `If-Match`

`PATCH /notes/12` z `If-Match: 3`. Nieaktualny `rev` → `409 rev_mismatch` z bieżącą treścią w polu
`current`: klient scala i ponawia z nowym `If-Match`. Brak nagłówka → `428`. Tytuły są unikalne
bez względu na wielkość liter i ogonki (`[[Tytuł]]` rozwiązuje się po tytule): `409 title_taken`
wskazuje istniejącą notatkę. Link do nieistniejącej notatki jest dozwolony i dowiązuje się sam,
gdy notatka powstanie.

### Słowa użytkownika bajt w bajt

`POST /user-words` przyjmuje `text` i `sha256` (SHA-256 hex z **bajtów UTF-8** tekstu u klienta,
bez trim, bez NFC, bez zamiany CRLF). Serwer liczy skrót sam; niezgodność → `400 hash_mismatch`
z oboma skrótami i nic nie zapisuje. To test „tekst nie zmienił się w drodze czat → `tj` → API”.
Bajt NUL i samotny surogat UTF-16 → `400 invalid_text`. Skrót zapisany w bazie liczy trigger.
Ponowne wysłanie tego samego wpisu (ta sama treść, chwila `capturedAt` i kotwice) → `200`, ten sam `id`.

### Propozycje reguł

`POST /rules/proposals`:

- `origin: "ai"` wymaga `counterargument`, `evidence` i `hypothesisId`; poniżej progu `n` hipotezy
  → `422 below_threshold`.
- `origin: "mentor"` bez progu, wymaga `evidence` (cytat z filmu), podpisane „wg mentora, n = 0”.
- `origin: "vault-import"` (import z sejfu Obsidiana) wchodzi jako **propozycja**; `vaultStatus` to
  tylko informacja dla UI, nie zatwierdzenie. Powtórny import tej samej treści (`externalRef`) nic
  nie mnoży.
- Agent może mieć najwyżej jedną oczekującą propozycję na regułę (`409 proposal_pending`).

## Funkcje MUST (faza 2b)

Wszystkie zapisy idą przez `api.zapis` z `tj.actor = api:<id>`; zatwierdza wyłącznie UI (`ui`).
Kontrakt i schematy odpowiedzi: `docs/openapi-v2.json`. Tabele: `docs/v2/model-danych.md`, sekcja 14.

| Metoda i ścieżka | Zakres | Opis |
|---|---|---|
| `GET /me` | read | kim jest token: zakresy, aktor (bez sekretu) |
| `GET /trades/:id` | read | trade ze zrzutami, ocenami, planem, słowami; `resultHidden`, gdy trade otwarty ma werdykt |
| `POST /trades/:id/reviews` | write | każdy werdykt NIEZMIENNY z `as_of` (także bez `evidence`; z `evidence` = świece + sha256 zrzutów); powtórka tej samej treści 200, inna 409, poprawka = `user_override` |
| `PATCH`/`PUT /trades/:id/reviews/:rid` | write | zawsze `409`; korekta to `POST .../override` (`user_override`) |
| `POST /trades/:id/screenshots` | write | `origin=manual` dopisuje, `tradingview`/`fxreplay` zastępują swoje poprzednie wydanie; `capturedAt`, `chartState` |
| `POST /notes/:id/attachments`, `POST /days/:date/attachments` | write | PNG/JPG/WebP/HEIC → WebP + miniatura |
| `POST /trade-plans`, `GET /trade-plans[/:id]` | write, read | plan zamrażany raz (ryzyko liczy serwer); `PATCH`/`PUT` = `409` |
| `POST /trade-plans/:id/addenda`, `/attach` | write | zmiana planu tylko dopiskiem ze słowami użytkownika; powiązanie z trade'em |
| `GET`/`POST /setups`, `POST /setups/:slug/versions` | read, propose | playbook z wersjami; wersja to PROPOZYCJA do zatwierdzenia w UI; statystyka z przedziałami |
| `GET /prop/presets`, `/prop/overview` | read | presety (138 wierszy, `needsVerification`), przegląd kont i łączna ekspozycja NQ |
| `GET`/`POST /prop/accounts/:id/rules` | read, write | preset przypięty od daty zakupu, każda wartość nadpisywalna |
| `GET /prop/accounts/:id/status` | read | bufory DD/DLL, consistency, ostrzeżenia 50/75/90%, bufor „gdy trafi SL” w $ i R |
| `GET`/`POST /prop/accounts/:id/ledger` | read, write | koszty i wypłaty |
| `GET /reviews/weekly`, `PUT /reviews/weekly/:weekStart` | read, write | przegląd tygodnia z jednym zobowiązaniem |
| `GET`/`POST /ai-suggestions` | read, propose | agent tworzy; skutek w tabelach docelowych dopiero po zatwierdzeniu w UI |
| `GET`/`POST /hypotheses/:code/variants` | read, write | licznik prób wariantów, korekta na wielokrotne testowanie |
| `GET`/`POST /chart-annotations` | read, write | tekst rysunku bajt w bajt (sha256 jak `user_words`); przedrostek AI odrzucany |
| `GET /profile`, `POST /profile/corrections` | read, write | słownik użytkownika i rejestr poprawek interpretacji (tylko dopisywany) |
| `GET`/`POST /strategy-gaps`, `POST .../:id/ask` | read, propose, write | luki i sprzeczności mentor kontra praktyka; rozstrzyga tylko UI |
| `/mentor/sources`, `/mentor/claims` | read/write + **import** | import filmów i cytatów (bez zakresu `import` każda trasa = `403`) |

Filtr `externalRef` działa na `GET /rules` i `GET /hypotheses`.

Poprawki po przeglądzie (15.10.2026): `POST /trades/:id/reviews` z `basis = chart` wymaga `evidence.intervalMinutes` (świeca musi się skończyć przed wejściem); `POST .../override`, `POST /trade-plans/:id/addenda` i `POST /notes/:id/additions` są idempotentne (powtórka = 200, ten sam wiersz); `GET /setups/:slug` zwraca `statsByVersion` (progi nie działają wstecz) i `unversionedTrades`; `GET /prop/accounts/:id/status` zwraca `rulesConfirmed`, `rulesUsed`, `rulesNote`; `GET /trades/:id` ma `hiddenFields` i `hiddenReviews`; nowy rodzaj sugestii `trade_setup`. Szczegóły: ADR-033, sekcja »Faza 2b, poprawki po audycie i review«.

### Ekrany decyzji użytkownika (bez AI)

- `/decyzje` („Do decyzji”): propozycje reguł i wersji setupów po jednej (przyjmij / popraw i przyjmij / odrzuć
  z powodem), sugestie AI jednym kliknięciem, z cofnięciem. Zatwierdzenie to `tj.actor = 'ui'`.
- `/decyzje/rozstrzygniecia`: sprzeczność mentora z praktyką, po jednej, z cytatem mentora i linkiem `t=` obok
  Twoich słów. Wybór: zostaje moje / biorę mentora / oba pod warunkiem (Twoje słowa zapisane dosłownie).

## Zgodność wstecz: `/api/ingest/**`

Trasy przyjmują stary skrót (`INGEST_TOKEN_SHA256`) **albo** token v2 z zakresem `write`. Każda
odpowiedź (także błąd) niesie `Deprecation: true` i `Link: </api/v2>; rel="successor-version"`.
Każde użycie starego skrótu zostawia w logu linię `DEPRECATED: uzycie starego tokenu` z licznikiem.
Usunięcie tras i zmiennej: po fazie 3, za zgodą użytkownika.

## Walidacja pochodzenia i progu n (decyzja 15.10.2026: «Walidacja danych»)

- `nImported` hipotezy przyjmuje się tylko przy `origin: "vault-import"` z `externalRef` zaczynającym
  się od `vault:`. `progN` przez API nie może być niższy niż 20; niższy ustawia tylko użytkownik w UI.
- `origin: "mentor"`: `evidence` to ścisły obiekt `{ video, t, quote }`, wszystkie niepuste.
- `vaultStatus` tylko przy `vault-import` z kluczem `vault:`.
- `vault-import` bez klucza `vault:` jest traktowany jak `ai` (wymaga kontrargumentu, dowodów i hipotezy,
  podlega progowi n, zapisuje się jako `ai`).
- `POST /notes` z rodzajem `rule` albo `hypothesis` → `422 use_dedicated_endpoint`; `PATCH` takiej notatki
  nie zmienia `title`, `bodyMd` ani `meta` (`409 managed_note`).
- Powtórzenie treści odrzuconej wersji reguły → `409 previously_rejected` z `decidedAt`; powtórzenie treści
  istniejącej wersji zwraca jej prawdziwy status.

## Zapisy z `tj.actor` (ADR-030)

Każdy zapis v2 (trade'y, oceny, zrzuty, sesje, pominięcia, dzień, notatki, słowa, reguły) idzie w transakcji
z `set_config('tj.actor', 'api:<id tokenu>', true)`; stare trasy `/api/ingest/**` zapisują jako `ingest`.
Trade'y: każda pozycja paczki we własnej transakcji (błąd bazy w jednej nie psuje reszty).

## Logowanie urządzeń: ochrona przed phishingiem kodem

Lista urządzeń nie pokazuje kodów oczekujących żądań (tylko liczbę, adres i czas). Ekran zatwierdzenia
oznacza nazwę jako podaną przez urządzenie i ostrzega, gdy adres żądania różni się od adresu przeglądarki.
Globalny limit: 20 niezatwierdzonych żądań naraz (`429 too_many_pending`); wygasłe żądania są sprzątane po
10 minutach. Zatwierdzenie urządzenia i utworzenie tokenu importu wymagają **sudo** (kod TOTP lub zapasowy, 10 min)
albo, przy wyłączonym 2FA, hasła (ADR-031); odrzucenie i unieważnienie nie wymagają. Każda decyzja zostawia wpis w
`auth_events` (`device_requested`, `device_approved`, `device_denied`, `token_created`, `token_revoked`; bez kodów i haseł).
`DEVICE_LOGIN_DISABLED=1` zamyka `device/start` (np. na czas awarii).

## Zmienne środowiskowe

Żadna nie jest wymagana. Opcjonalne: `API_V2_DISABLED=1` (wyłącznik awaryjny całego v2, także tokenów v2
na `/api/ingest/**`), `DEVICE_LOGIN_DISABLED=1` (zamyka tylko logowanie nowych urządzeń), `APP_PUBLIC_URL`
(adres w `verificationUri`; za proxy bez niej używamy `X-Forwarded-Host`).

## Testy na bazie

`npm run test:db` (wspólny bezpiecznik produkcji, baza `tj_*` na tej maszynie) uruchamia pełny pakiet;
bez lokalnej bazy testy `*.db.test.ts` są POMINIĘTE (to nie jest dowód).
