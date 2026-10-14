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
| `TOTP_ENC_KEY` | **wymagana do włączenia 2FA** (sekcja 9): 32 losowe bajty, `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Secret. **Nie zmieniaj po włączeniu 2FA** |
| `INGEST_TOKEN_SHA256` | **opcjonalna**: skrót SHA-256 tokenu API synchronizacji, 64 znaki hex (patrz sekcja 8). Bez niej `/api/ingest/*` odpowiada 404 |

`SESSION_SECRET`, `OWNER_PASSWORD`, `TOTP_ENC_KEY` i `INGEST_TOKEN_SHA256` oznacz w Coolify jako **secret**.
Po pierwszym zalogowaniu zmień hasło w *Ustawienia → Bezpieczeństwo* i usuń `OWNER_PASSWORD`
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

Po pierwszym zalogowaniu zmień hasło w *Ustawienia → Bezpieczeństwo* i usuń `OWNER_PASSWORD`
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

Docelowy adres: **`https://dziennik.panekweb.pl`** (ADR-031). Adres wygenerowany przez Coolify
(`*.sslip.io`, http) **trzeba usunąć**, ale dopiero po sprawdzeniu domeny: patrz kroki w sekcji 9.

Ciasteczka sesji, drugiego kroku logowania i trybu sudo są na produkcji **zawsze** `Secure` i
`SameSite=Strict`. Pod adresem `http://` przeglądarka nie zapisze ich w ogóle, więc logowanie tam
**nie zadziała** (to zamierzone: hasło nie ma lecieć otwartym tekstem). Nagłówek `x-forwarded-proto`
od Traefika decyduje już tylko o tym, czy `/api/ingest/**` przyjmie zapytanie (403 bez HTTPS).

## 5. Smoke test po wdrożeniu

Wykonaj za każdym razem, nie tylko przy pierwszym wdrożeniu:

- [ ] `GET /api/health` zwraca `{"status":"ok"}` — to znaczy, że aplikacja **widzi bazę**
- [ ] wdrożony commit w Coolify == `HEAD` gałęzi `master` (sprawdzone, nie założone)
- [ ] logowanie hasłem działa, złe hasło jest odrzucane; przy włączonym 2FA po haśle pyta o kod
- [ ] `curl -sI https://dziennik.panekweb.pl/login` ma `Strict-Transport-Security: max-age=31536000` **bez** `includeSubDomains`, a `curl -s https://dziennik.panekweb.pl/robots.txt` zwraca `Disallow: /`
- [ ] `curl -sI http://dziennik.panekweb.pl/login` przekierowuje na `https://` (Traefik), a stary adres sslip nie odpowiada
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
danych dziennika niezależny od Postgresa (nie zawiera hasła ani sekretu 2FA; przy włączonym 2FA wymaga trybu sudo).

Kopia **lokalnej** bazy deweloperskiej: `npm run db:backup` (pg_dump do `.dane/kopie/`). Skrypt odmawia, gdy
`DATABASE_URL` nie wskazuje na localhost, więc produkcji nie dotyka; kopię produkcji robi się wyłącznie w Coolify.

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

## 9. Domena `dziennik.panekweb.pl`, HTTPS i 2FA (wydanie R1, ADR-031)

Push na `master` wdraża automatycznie, więc kroki 1-4 wykonaj **PRZED scaleniem**. Nowa wersja
wymusza ciasteczka `Secure`, dlatego dostęp ma tylko przez HTTPS (adres sslip też je ma).

**PRZED scaleniem:**

1. **Kopia bazy w Coolify** (Backups → ręczny backup) i sprawdzenie, że plik kopii powstał.
   Migracja `0016_totp.sql` dokłada kolumny i tabele (`auth_backup_codes`, `auth_events`), nie zmienia istniejących.
2. **Zmienna `TOTP_ENC_KEY`** (secret) w Coolify. Wygeneruj na własnym komputerze, nie na serwerze:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   Zapisz klucz poza gitem (menedżer haseł). **Nie zmieniaj go po włączeniu 2FA.**
3. **DNS:** w Hetzner DNS rekord A `dziennik` w strefie `panekweb.pl` → adres serwera. Sprawdź
   `nslookup dziennik.panekweb.pl`. Rekordu nie rób na `*`: pozostałe subdomeny nie należą do tej aplikacji.
4. **Domena w Coolify:** w zasobie aplikacji, pole Domains, dopisz `https://dziennik.panekweb.pl`
   (adres sslip na razie zostaw). Coolify wystąpi o certyfikat Let's Encrypt; poczekaj, aż
   `curl -sI https://dziennik.panekweb.pl/api/health` zwróci 200 z poprawnym certyfikatem.

**Scalenie i po nim:**

5. **Scal do `master`** (to uruchamia deploy; sprawdź w Coolify, że wdrożony commit == HEAD `master`).
   Start kontenera uruchamia migrację 0016.
6. **Podmień `TJ_INGEST_URL`** w `C:\Users\ahaah\.claude\sekrety\trade-journal-ingest.env` na
   `https://dziennik.panekweb.pl`. Dopiero potem krok 7, inaczej łącznik straci adres.
7. **Usuń adres sslip** z pola Domains i zapisz. Od teraz zostaje tylko `https://dziennik.panekweb.pl`.
8. **Smoke test** z sekcji 5, razem z nowymi punktami o HSTS, robots i przekierowaniu.
9. **Włącz 2FA:** Ustawienia → Bezpieczeństwo → hasło → zeskanuj QR → wpisz kod. Zapisz 10 kodów
   zapasowych (pokazują się raz). Wyloguj się i zaloguj ponownie, żeby sprawdzić drugi krok.
10. **Po tygodniu bez problemów** usuń `OWNER_PASSWORD` ze zmiennych, jeśli jeszcze tam jest.

**Awaria: telefon i kody zapasowe zgubione albo zmieniony `TOTP_ENC_KEY`.** Nie ma obejścia w aplikacji, bo
ma być twardo. Z dostępem do bazy (Coolify → terminal bazy) wyłączasz 2FA SQL-em, potem włączasz od nowa:

```sql
BEGIN;
UPDATE settings SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
                    session_version = session_version + 1 WHERE id = 1;
DELETE FROM auth_backup_codes;
COMMIT;
```

Wejście do panelu Coolify i do bazy jest więc ostatnią linią obrony: zabezpiecz konto Coolify i GitHub własnym 2FA.

**Wyloguj pozostałe urządzenia** (Ustawienia → Bezpieczeństwo) odcina wszystkie urządzenia poza bieżącym. Blokada prób
(8 błędów hasła lub kodu na adres, 10 minut) siedzi w pamięci kontenera: restart ją zeruje.
Adres klienta do blokad to ostatni wpis `X-Forwarded-For` (dopisuje go Traefik); CDN przed Traefikiem
trzeba by uwzględnić w `adresZNaglowkow` (`lib/ingest/http.ts`).

## 10. API v2, tokeny urządzeń i notatki (wydanie R2, ADR-029 i ADR-030)

Wydanie R2 wchodzi **po R1** (sekcja 9) na tej samej gałęzi historii: migracje `0017_api_tokens`,
`0018_notatki` i `0019_auth_events_token_fk` wykonują się przy starcie kontenera (`scripts/migrate.mjs`).

- **Kopia bazy przed wdrożeniem** (Coolify → Backups → „Backup now”): migracje tylko dokładają, ale
  `0018` zastępuje funkcję `tj_forbid_update` (to samo zachowanie, `TJ409`) i rozszerza `screenshots_owner`.
- **Rozszerzenia Postgresa** `unaccent` i `pg_trgm` (od PG13 „trusted”, wystarczy `CREATE` na bazie).
  Sprawdzenie przed wdrożeniem (tylko odczyt): `SELECT name FROM pg_available_extensions WHERE name IN ('unaccent','pg_trgm');`
  Jeśli zapytanie nie zwraca obu wierszy, obraz bazy nie ma `contrib` i wdrożenie trzeba wstrzymać.
- **Nowe zmienne** (żadna nie jest wymagana): `API_V2_DISABLED=1` (wyłącznik awaryjny całego `/api/v2`),
  `DEVICE_LOGIN_DISABLED=1` (zamyka tylko logowanie nowych urządzeń), `APP_PUBLIC_URL=https://dziennik.panekweb.pl`
  (adres w `verificationUri`). `INGEST_TOKEN_SHA256` zostaje, dopóki łącznik nie przejdzie na tokeny v2
  (trasy `/api/ingest/**` są wygaszane, nagłówek `Deprecation`; usunięcie po fazie 3 i za zgodą).
- **Pierwsze urządzenie:** `tj login` → Ustawienia → Urządzenia → „Połącz urządzenie” → przepisz kod.
  Zatwierdzenie wymaga **sudo** (2FA włączone) albo hasła (2FA wyłączone); wpisy trafiają do Bezpieczeństwo → dziennik zdarzeń.
  **Token importu** (zakres `import`, 24 h, pokazywany raz) tworzysz tam samo, ręcznie.
- **Smoke po wdrożeniu:** `curl https://dziennik.panekweb.pl/api/v2/meta` → `401`; z tokenem → `200` i `contractHash`
  równy temu z `docs/openapi-v2.json`.
