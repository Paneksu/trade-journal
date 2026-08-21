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

`SESSION_SECRET` i `OWNER_PASSWORD` oznacz w Coolify jako **secret**.
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
