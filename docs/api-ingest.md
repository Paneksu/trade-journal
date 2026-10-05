# API synchronizacji (`/api/ingest`)

Kontrakt dla klienta wysyłającego trade'y z TradingView i FX Replay oraz oceny AI (repo „mózg
tradingowy"). Decyzje i uzasadnienia: `docs/decyzje.md`, ADR-026 do 028. Wdrożenie i token:
`docs/wdrozenie-coolify.md`, sekcja 8.

## Zasady wspólne

- Każde zapytanie: `Authorization: Bearer <token>`. Brak zmiennej `INGEST_TOKEN_SHA256` na serwerze
  = **404** na każdej trasie. W produkcji tylko HTTPS (inaczej 403).
- Odpowiedzi to zawsze JSON. Błąd ma kształt `{ "error": "<zdanie po polsku>", "code": "<kod>", … }`;
  komunikat mówi, co się stało, dlaczego i jak poprawić, z faktyczną wartością.
- Kody: `401` zły token, `404` nie ma API / nie ma trade'a, `413` za duże ciało (JSON 1 MB,
  multipart 11 MB), `415` zły `Content-Type`, `400` zła koperta, `422` zły plik lub interwał,
  `429` blokada (8 błędów) albo limit 120 zapytań na minutę (nagłówek `Retry-After`),
  `500` błąd serwera (szczegóły w logach pod `x-request-id`).
- **Czasy: ISO 8601 z offsetem lub `Z`**, np. `2026-03-10T09:35:00-04:00`. Czas bez strefy to błąd.
- **Kwoty brokera w walucie konta** (np. `116.5`), nie w centach. Ceny jako liczby JSON.
- Pola spoza kontraktu są błędem (literówka nie ginie po cichu).

## `GET /api/ingest/meta`

Słownik: `accounts` (`id`, `name`, `type`, `propPhase`, `currency`), `instruments`
(`id`, `symbol`, `tickSize`, `tickValue` w tysięcznych dolara), `tags` (`id`, `name`, `categoryKey`),
`tagCategories`, `sessions` (`id`, `kind`, `externalRef`), `customFields`, `intervals`
(`30s 1m 2m 3m 4m 5m 15m 30m 1h 4h D W M`), `htfThreshold` (`1h`), `statuses`, `limits`.

## `POST /api/ingest/trades`

```json
{
  "dryRun": false,
  "mode": "create",
  "trades": [ { "...": "do 50 pozycji" } ]
}
```

`mode`: `create` (domyślny; istniejący klucz → `unchanged`, nic nie nadpisuje) albo `update`
(upsert: zmieniona treść → `updated`). `dryRun: true` waliduje i liczy, **nic nie zapisuje**.

Pozycja trade'a:

| Pole | Typ | Uwagi |
|---|---|---|
| `externalRef` | string, wymagane | `tv:<id>` albo `fxr:<id>`; klucz idempotencji |
| `source` | `tradingview`\|`fxreplay` | opcjonalne; musi zgadzać się z prefiksem |
| `accountId` | int, wymagane | z `meta.accounts` |
| `symbol` | string, wymagane | `NQ`, `NQ1!`, `MNQ1!`, `CME_MINI:NQZ2026`; **CFD (US100) odrzucane** |
| `sessionId` / `sessionRef` | int / string | sesja backtestu; jedno z dwóch (`sessionRef` = `externalRef` sesji) |
| `direction` | `long`\|`short`, wymagane | |
| `status` | `closed` (domyślne) `open` `planned` `cancelled` `missed` | |
| `entryTime` | ISO z offsetem, wymagane | |
| `entryPrice`, `contracts` | liczby, wymagane | `contracts` > 0 |
| `stopLoss`, `takeProfit`, `mae`, `mfe` | liczba \| null | |
| `brokerAmount` | liczba \| null | wynik z rachunku, bije ticki (ADR-016) |
| `exits` | tablica do 20 | `{ time, price, contracts?, brokerAmount?, note? }`; jedno wyjście bez `contracts` = cała pozycja; trade `closed` wymaga `time` w każdym |
| `note`, `moodNote`, `readiness` (1–10), `custom`, `tags` | opcjonalne | pominięte = **nie ruszaj** przy aktualizacji |
| `tags` | tablica do 40 | `{ tagId, interval? }` albo `{ category, name, interval? }`; tagi nie są zakładane automatycznie |
| `snapshot` | obiekt | surowe dane klienta do diagnozy (`source_snapshot`), bez wpływu na statystyki |

Wynik: `{ dryRun, mode, summary: {created, updated, unchanged, conflict, skipped, error}, results: [...] }`,
gdzie każda pozycja ma `index`, `externalRef`, `status` (`created` `updated` `unchanged` `conflict`
`skipped` `error`), a zależnie od statusu `id`, `note`, `error`, `errors[]`, `fieldErrors`,
`preview` (przy `dryRun`: `pnl` w centach, `ticks`, `rMultiple`, `riskAmount`, `marketSession`,
`tradingDay`). Jedna zła pozycja nie blokuje reszty. Ten sam `externalRef` dwa razy w paczce to błąd
drugiej pozycji. `conflict` = wpis edytowano w aplikacji po ostatnim zapisie API (zmiany użytkownika
wygrywają).

## `GET /api/ingest/trades`

Query: `refs=tv:1,fxr:2` (do 100), `source`, `after` (id), `limit` (1–500, domyślnie 100).
Zwraca `{ trades: [{ id, externalRef, source, status, sessionId, entryTime, updatedAt, ingestedAt,
editedInApp, hash }], nextAfter }` — do uzgodnienia stanu przed wysyłką.

## `POST /api/ingest/trades/:id/screenshots`

`multipart/form-data`: `shot` (plik, powtarzalne, do 8, PNG/JPEG/WEBP/AVIF ≤ 10 MB), `interval`
(powtarzalne, po jednym na plik, w tej samej kolejności; pusty = brak), `origin`
(`tradingview`|`fxreplay`; domyślnie źródło trade'a). **Zastępuje** wszystkie zrzuty tego
pochodzenia na trade'cie; ręcznych nie rusza. Wynik: `{ tradeId, origin, replaced, screenshots[] }`.

## `POST /api/ingest/trades/:id/reviews`

```json
{
  "basis": "chart",
  "setupType": "kontynuacja",
  "summaryMd": "…",
  "lesson": "…",
  "brainVerdict": "wejdz",
  "brainPlan": { "entry": 20000, "stopLoss": 19990, "takeProfit": 20020, "interwalWejscia": "5m" },
  "brainVersion": "<hash commita mózgu>",
  "evidenceCutoff": "2026-03-10T09:34:00-04:00",
  "model": "…",
  "ruleChecks": [
    { "ruleId": "R-007", "ruleText": "treść reguły z chwili oceny", "verdict": "pass", "evidence": "…" }
  ]
}
```

`basis`: `chart` (z wykresu na moment decyzji) albo `history` (po fakcie); jedna ocena na podstawę,
ponowne wysłanie podmienia (`201` nowa, `200` podmieniona). `verdict`: `pass` `fail` `na` `unclear`;
`brainVerdict`: `wejdz` `czekaj` `odpusc`. `ruleText` obowiązkowe. Zdanie użytkownika o regule
zostaje przy ponownym wysłaniu tylko wtedy, gdy werdykt AI się nie zmienił.

## `POST /api/ingest/backtest-sessions`

`{ "externalRef": "fxr:<id>", "name": "…", "kind": "backtest"|"forward", "symbol"?, "interval"?,
"dataFrom"?, "dataTo"?, "startingBalance"?, "riskPerTrade"?, "targetTrades"?, "assumptions"? }`.
Tworzy (`201`) albo odnajduje po `externalRef` (`200`, niczego nie zmienia; `warnings` mówi o różnicach).
Zwraca `{ id, created, kind, externalRef, name, warnings }`.

## `POST /api/ingest/skips`

`{ "skips": [ { "externalRef": "tv:123", "note"?: "…" } ] }` (do 100). Status per klucz:
`recorded`, `already_skipped`, `trade_exists` (trade o tym kluczu już jest — pominięcia nie zapisano).
Kolejne `POST /trades` z tym kluczem daje `skipped`. Skasowanie trade'a w aplikacji zostawia taki
wpis samo (`reason: deleted`).
