# Dziennik tradingowy

Prywatny dziennik transakcji na kontraktach futures z sekcją backtestingu.
Jedno konto, hasło, własna baza PostgreSQL, wdrożenie na Coolify.

Co robi:

- **Dziennik** — szybkie wpisywanie trade'ów z podglądem wyniku liczonym na żywo,
  zrzutami wykresu przed i po, checklistą strategii i notatką dnia.
- **Statystyki** — oczekiwana wartość w R i w gotówce, profit factor, obsunięcie,
  rozkład R, MAE/MFE, rozbicie na dowolny wymiar (instrument, sesja, dzień, tag, pole własne).
- **Edge Finder** — automatycznie wskazuje konteksty, w których wyniki odstają od średniej,
  z jawnie podaną wielkością próbki.
- **Miernik dyscypliny** — trade'y bez stopa, złamane własne zasady, powiększanie pozycji
  po stracie, wejścia tuż po stracie.
- **Backtesting** — osobne sesje z własnymi założeniami, licznikiem próbki i porównaniem
  symulacji z realnym handlem tej samej strategii.
- **Pola własne** — sam definiujesz kolumny opisujące trade i ich słowniki; nowe pole
  od razu pojawia się w formularzu, tabeli, filtrach i statystykach.

## Uruchomienie lokalne

Wymagania: Node 22, Docker (albo własny PostgreSQL 17).

```bash
# 1. Baza
docker run -d --name tj-postgres \
  -e POSTGRES_USER=journal -e POSTGRES_PASSWORD=journal -e POSTGRES_DB=journal \
  -p 55432:5432 postgres:17-alpine

# 2. Zmienne
cp .env.example .env       # ustaw DATABASE_URL, SESSION_SECRET i OWNER_PASSWORD

# 3. Zależności, struktura bazy, dane początkowe
npm install
npm run db:migrate
npm run seed

# 4. Start
npm run dev                # http://localhost:3000
```

`npm run seed` zakłada hasło z `OWNER_PASSWORD`, konto startowe, katalog 23 kontraktów
futures (ES, NQ, CL, GC, ZB, 6E i pozostałe), cztery kategorie tagów i trzy przykładowe
pola własne. Skrypt jest idempotentny — kolejne uruchomienie nic nie psuje.

Dane demonstracyjne do pracy nad wyglądem (tylko lokalnie):

```bash
npx tsx scripts/demo-data.ts 140
```

## Polecenia

| Polecenie | Co robi |
|---|---|
| `npm run dev` | serwer deweloperski |
| `npm run build` / `npm start` | build i serwer produkcyjny |
| `npm test` | testy modułu obliczeń i pól własnych (Vitest) |
| `npm run test:e2e` | testy przeglądarkowe i audyt dostępności (Playwright + axe) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | nowa migracja z różnicy w schemacie |
| `npm run db:migrate` | zastosowanie migracji |
| `npm run seed` | dane początkowe |
| `npm run db:studio` | przeglądarka bazy (drizzle-kit) |

Testy E2E potrzebują hasła: `E2E_PASSWORD=... npm run test:e2e`.
Uruchamiaj je wyłącznie na bazie lokalnej — dopisują trade'y i pola.

## Zmienne środowiskowe

| Zmienna | Opis |
|---|---|
| `DATABASE_URL` | połączenie do PostgreSQL |
| `SESSION_SECRET` | co najmniej 32 znaki; podpisuje ciasteczko sesji |
| `OWNER_PASSWORD` | hasło zakładane przez `npm run seed` (potem można je zmienić w ustawieniach) |
| `UPLOADS_DIR` | katalog na zrzuty ekranu; w Dockerze `/data/zrzuty` |

## Jak to jest zbudowane

```
src/
  app/            ekrany (Next.js App Router), API zrzutów i sondy zdrowia
  components/     interfejs: tabela, formularze, wykresy, kalendarz
  lib/
    domain/       CZYSTE obliczenia: wynik trade'a, statystyki, Edge Finder, dyscyplina
    db/           schemat Drizzle, migracje, dane początkowe
    queries/      zapytania i filtry (adres URL → warunki SQL)
    actions/      akcje serwerowe (zapis)
    fields/       pola własne: definicje, walidacja, formatowanie
drizzle/          wygenerowane migracje SQL
e2e/              testy przeglądarkowe i audyt dostępności
```

Reguła, na której stoi całość: **`lib/domain` nie wie nic o bazie ani o Next**.
Ten sam moduł liczy podgląd w przeglądarce i wynik zapisywany na serwerze, więc
te dwie liczby nie mają jak się rozjechać. Kolumny wyliczane w tabeli `trades`
są wyłącznie zapisanym wynikiem tych funkcji.

Szczegóły decyzji technicznych: [docs/decyzje.md](docs/decyzje.md).
Wdrożenie: [docs/wdrozenie-coolify.md](docs/wdrozenie-coolify.md).
Instrukcja obsługi: [docs/instrukcja.md](docs/instrukcja.md).

## Stan jakości

Mierzone na obrazie produkcyjnym, nie na serwerze deweloperskim:

| Sprawdzenie | Wynik |
|---|---|
| Testy jednostkowe | 97 zielonych |
| Testy E2E | 6 scenariuszy |
| Dostępność (axe, WCAG 2.2 AA) | 11 ekranów bez naruszeń |
| Lighthouse desktop | wydajność 100, dostępność 100, dobre praktyki 100 |
| Lighthouse mobile | wydajność 92, dostępność 100, dobre praktyki 100 |
| Lighthouse SEO | 60 — celowo, aplikacja jest `noindex` (patrz `docs/decyzje.md`) |
