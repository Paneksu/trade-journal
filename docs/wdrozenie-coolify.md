# Wdrożenie na Coolify

Instrukcja od zera do działającego dziennika. Zakłada Coolify na serwerze Hetzner
i prywatne repozytorium na GitHubie.

## 1. Baza danych

W Coolify: **Project → New Resource → Database → PostgreSQL 18** (domyślna; 17 też przetestowana).

- nazwa: `trade-journal-db`
- zapamiętaj wygenerowane hasło
- po utworzeniu skopiuj **wewnętrzny** adres połączenia (`postgres://…@<nazwa>:5432/…`) —
  aplikacja i baza rozmawiają po sieci wewnętrznej, baza nie musi być wystawiona na świat

Zakładka **Backups**: ustaw harmonogram (raz dziennie wystarczy) **zanim** wejdzie
pierwszy prawdziwy trade.

## 2. Aplikacja

**New Resource → Application → Private Repository (GitHub App)**.

- repozytorium: `Paneksu/trade-journal`, gałąź `master`
- Build Pack: **Dockerfile** (jest w korzeniu repo)
- port: `3000`

### Zmienne środowiskowe

| Zmienna | Wartość |
|---|---|
| `DATABASE_URL` | wewnętrzny adres z kroku 1 |
| `SESSION_SECRET` | `openssl rand -base64 48` — minimum 32 znaki |
| `OWNER_PASSWORD` | hasło do pierwszego logowania |
| `UPLOADS_DIR` | `/data/zrzuty` (już ustawione w obrazie, ale niech będzie jawnie) |

| `INGEST_TOKEN_SHA256` | **opcjonalna**: skrót SHA-256 tokenu API synchronizacji, 64 znaki hex (patrz sekcja 8). Bez niej `/api/ingest/*` odpowiada 404 |

`SESSION_SECRET`, `OWNER_PASSWORD` i `INGEST_TOKEN_SHA256` oznacz w Coolify jako **secret**.
Po pierwszym zalogowaniu zmień hasło w *Ustawienia → Hasło* i usuń `OWNER_PASSWORD`
ze zmiennych — nie jest już potrzebne.

### Wolumen na zrzuty ekranu

**Storage → Add → Volume Mount**:

- nazwa: `trade-journal-zrzuty`
- ścieżka w kontenerze: `/data`

Bez tego zrzuty wykresów znikną przy pierwszym wdrożeniu. Katalog `/data` jest
zadeklarowany jako `VOLUME` w obrazie, więc Docker i tak zrobiłby wolumen anonimowy —
ale anonimowego nikt nie zabezpieczy kopią.

## 3. Pierwsze uruchomienie

Kliknij **Deploy**. Kontener przy starcie:

1. uruchamia migracje (`scripts/migrate.mjs`) — gdy padną, kontener się nie podnosi,
2. startuje serwer,
3. na **zupełnie pustej bazie** zakłada dane początkowe: hasło z `OWNER_PASSWORD`,
   konto, katalog 23 kontraktów futures, tagi i przykładowe pola własne.

Nie ma żadnego ręcznego kroku z seedem. Kolejne restarty niczego nie ruszają —
w szczególności nie wskrzeszają instrumentów ani tagów, które usuniesz.

Po pierwszym zalogowaniu zmień hasło w *Ustawienia → Hasło* i usuń `OWNER_PASSWORD`
ze zmiennych środowiskowych.

### Healthcheck

W zakładce **Configuration → Healthcheck** ustaw ścieżkę `/api/health` i port `3000`.
Endpoint sprawdza także połączenie z bazą, więc aplikacja odpowiadająca po HTTP,
ale bez dostępu do bazy, zostanie uznana za niezdrową. `curl` jest w obrazie —
Coolify go potrzebuje do własnej sondy.

## 4. Domena i SSL

Kolejność ma znaczenie:

1. rekord A w Hetzner DNS na adres serwera,
2. odczekaj propagację i sprawdź `nslookup <domena>`,
3. **dopiero teraz** dodaj domenę w Coolify.

Coolify występuje o certyfikat w momencie dodania domeny. Gdy DNS jeszcze nie wskazuje
na serwer, walidacja nie przechodzi, a Let's Encrypt blokuje kolejne próby na godziny.

Do czasu podania własnej domeny działa adres wygenerowany przez Coolify.

Ciasteczko sesji jest oznaczane jako `secure` tylko wtedy, gdy połączenie idzie po HTTPS
(decyduje nagłówek `x-forwarded-proto` od proxy). Dzięki temu logowanie działa także pod
adresem `http` z Coolify, ale **hasło leci wtedy otwartym tekstem** — włącz SSL, gdy
tylko aplikacja przestanie być zabawką testową.

## 5. Smoke test po wdrożeniu

Wykonaj za każdym razem, nie tylko przy pierwszym wdrożeniu:

- [ ] `GET /api/health` zwraca `{"status":"ok"}` — to znaczy, że aplikacja **widzi bazę**
- [ ] wdrożony commit w Coolify == `HEAD` gałęzi `master` (sprawdzone, nie założone)
- [ ] logowanie hasłem działa, złe hasło jest odrzucane
- [ ] wpisanie trade'a zapisuje się i zmienia liczby na pulpicie
- [ ] wgranie zrzutu ekranu działa, a zrzut jest widoczny po restarcie kontenera
- [ ] kalendarz i statystyki pokazują dane
- [ ] na telefonie nie ma poziomego przewijania
- [ ] jeśli włączone jest API synchronizacji: `GET /api/ingest/meta` bez tokenu zwraca 401, z tokenem 200; gdy zmiennej nie ma — 404 (sekcja 8)

## 6. Kopie zapasowe

Dwie warstwy, obie potrzebne:

1. **Baza** — harmonogram w zasobie PostgreSQL w Coolify. Ręcznie:
   `docker exec <kontener-bazy> pg_dump -U postgres postgres > kopia.sql`
2. **Zrzuty ekranu** — wolumen `/data`. Kopia bazy ich nie obejmuje.

Dodatkowo w aplikacji: *Ustawienia → Dane i kopia → Pobierz kopię w JSON* daje eksport
wszystkich tabel niezależny od Postgresa.

## 7. Aktualizacja

`git push` na `master` uruchamia wdrożenie, jeśli w Coolify włączone jest automatyczne
wdrażanie. **Sprawdź to w panelu** — przy wyłączonym trzeba kliknąć Deploy ręcznie,
a produkcja potrafi cicho stać na starym buildzie.

Migracje idą razem z obrazem i wykonują się przy starcie. Przed wdrożeniem, które zmienia
strukturę danych, zrób kopię bazy.

## 8. API synchronizacji (TradingView i FX Replay)

Wdrożenie kodu **niczego nie włącza**: dopóki `INGEST_TOKEN_SHA256` nie jest ustawiona,
każda trasa `/api/ingest/*` odpowiada 404. Kontrakt API: `docs/api-ingest.md`, decyzje: ADR-026 do 028.

**Kolejność przy pierwszym włączeniu (kopię bazy robi właściciel, nie klient API):**

1. **Kopia bazy w Coolify** (zakładka Backups → ręczny backup) **przed** wdrożeniem commita z migracją
   `0015_tradingview.sql`. Migracja tylko dokłada kolumny i tabele, ale to zmiana struktury danych.
2. Wygeneruj token i jego skrót **na komputerze z repo mózgu**, nie na serwerze:
   ```
   node -e "console.log('tj_' + require('crypto').randomBytes(32).toString('base64url'))"
   node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <token>
   ```
   Token zapisz w pliku poza gitem (`C:\Users\ahaah\.claude\sekrety\trade-journal-ingest.env`).
   **Do Coolify trafia wyłącznie skrót.**
3. W Coolify dodaj zmienną `INGEST_TOKEN_SHA256` (secret) i wdróż. Zmienna zmienia zachowanie
   dopiero po restarcie kontenera.
4. Smoke test przez HTTPS (nie po adresie `http` z Coolify — w produkcji API odrzuca takie
   zapytania 403, bo token nie może iść otwartym tekstem):
   - `curl -i https://<domena>/api/ingest/meta` → **401** (a nie 404: 404 znaczy, że zmienna nie weszła)
   - `curl -H "Authorization: Bearer <token>" https://<domena>/api/ingest/meta` → **200**
   - pierwsza wysyłka zawsze z `"dryRun": true`; dopiero po obejrzeniu wyniku właściwy zapis
5. **Zrzuty ekranu z API leżą w tym samym wolumenie `/data`** co ręczne — kopia bazy ich nie obejmuje
   (sekcja 6).

**Rotacja tokenu:** nowy token i skrót, podmiana zmiennej, restart. Stary przestaje działać natychmiast;
nie ma okresu przejściowego.

**Awaria klienta (429):** po 8 błędnych tokenach z jednego adresu blokada trwa 10 minut. Liczniki są
w pamięci kontenera, więc restart je zeruje.

**Proxy przed aplikacją:** adres klienta do blokad to ostatni wpis `X-Forwarded-For`, a HTTPS wynika
z `X-Forwarded-Proto`. Traefik z Coolify ustawia oba. Dodanie kolejnego proxy (CDN) przed Traefikiem
sprawi, że wszyscy klienci zlecą się pod jeden adres — wtedy trzeba zmienić `adresKlienta` w `lib/ingest/http.ts`.
