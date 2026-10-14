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
| `POST /trades/:id/reviews` | write | ocena AI z regułami (do migracji 0020: podmiana, ADR-028) |
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

## Zgodność wstecz: `/api/ingest/**`

Trasy przyjmują stary skrót (`INGEST_TOKEN_SHA256`) **albo** token v2 z zakresem `write`. Każda
odpowiedź (także błąd) niesie `Deprecation: true` i `Link: </api/v2>; rel="successor-version"`.
Każde użycie starego skrótu zostawia w logu linię `DEPRECATED: uzycie starego tokenu` z licznikiem.
Usunięcie tras i zmiennej: po fazie 3, za zgodą użytkownika.

## Zmienne środowiskowe

Żadna nie jest wymagana. Opcjonalne: `API_V2_DISABLED=1` (wyłącznik awaryjny), `APP_PUBLIC_URL`
(adres w `verificationUri`; za proxy bez niej używamy `X-Forwarded-Host`).
