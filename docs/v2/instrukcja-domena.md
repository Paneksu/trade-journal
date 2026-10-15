# Instrukcja: dziennik pod adresem https://dziennik.panekweb.pl

Dla: Szymon, klika sam. Faza 1 przebudowy (ADR-031). Stan sprawdzony publicznie 14.10.2026.

Cel: aplikacja działa pod `https://dziennik.panekweb.pl` z certyfikatem Let's Encrypt, a stary
adres `...sslip.io` znika. Całość to około 30 minut, z czego większość to czekanie.

## Czego używasz

- Panel Hetzner, strefa DNS `panekweb.pl` (serwery nazw: `hydrogen/oxygen.ns.hetzner.com`, `helium.ns.hetzner.de`, więc rekordy dodajesz w Hetznerze).
- Panel Coolify, projekt „trading app”, środowisko production, aplikacja `trade-journal`, baza `trade-journal-db`.
- IP serwera: **178.104.172.227**
- Terminal (PowerShell) na swoim komputerze.

## Co już wiemy (sprawdzone publicznie, bez dotykania serwera)

| Co | Wynik | Co to znaczy dla Ciebie |
|---|---|---|
| `dziennik.panekweb.pl` | nie istnieje (NXDOMAIN) | musisz dodać rekord, krok 1 |
| `panekweb.pl` A | 178.104.172.227 | domena główna już wskazuje na ten sam serwer, więc Let's Encrypt z tego serwera już działa |
| rekordy CAA (strefa i subdomena) | brak | nic nie blokuje Let's Encrypt, nie dodawaj CAA |
| rekordy AAAA (IPv6) | brak, nawet dla `panekweb.pl` | **dodaj tylko rekord A**, AAAA pomiń |
| wildcard `*.panekweb.pl` | brak | inne subdomeny nie są przekierowane przypadkiem |

Uwaga o cache: sprawdzałem `dziennik.panekweb.pl` przez 1.1.1.1 i 8.8.8.8, więc te resolwery
zapamiętały „nie istnieje" na czas do **60 minut** (SOA minimum = 3600 s). Po dodaniu rekordu
pytaj najpierw serwer Hetznera wprost (krok 1.3). Jeśli tam jest odpowiedź, a Twój komputer
jeszcze nie widzi, to tylko cache, nic nie jest zepsute. Nie klikaj wtedy nic w Coolify,
dopóki nie zobaczysz IP także zwykłym `nslookup`.

Ciekawostka, która zmienia założenie: stary adres sslip **już dziś ma działający HTTPS** (certyfikat
poprawny, `/api/health` odpowiada `ok`), a `http://` przekierowuje na `https://`. Nie wymaga
to żadnego kroku, ale usunięcie adresu sslip i tak zostaje, bo ADR-031 nie chce drugiego adresu.

---

## Krok 0. Zanim cokolwiek klikniesz: kolejność

1. DNS (krok 1), potem czekanie, aż zobaczysz IP.
2. Kopia bazy (krok 4) i zmienna `TOTP_ENC_KEY` (krok 3) **przed scaleniem fazy 1**.
3. Domena w Coolify (krok 2).
4. Dopiero po sprawdzeniu, że https działa: usunięcie adresu sslip (krok 5).
5. Test końcowy (krok 6).

**Nie scalaj fazy 1 do `master`, dopóki kroki 3 i 4 nie są zrobione.** Deploy tej aplikacji jest
automatyczny po pushu na `master`, więc scalenie od razu uruchamia nowy kod i migracje.

Reguła, której nie wolno złamać: **DNS musi wskazywać na serwer, ZANIM dodasz domenę w Coolify.**
Coolify prosi o certyfikat w chwili dodania domeny. Gdy DNS jeszcze jej nie widzi, walidacja
pada, a Let's Encrypt blokuje kolejne próby na godzinę lub dłużej.

---

## Krok 1. DNS w Hetznerze

### 1.1 Dodaj rekord

1. Zaloguj się do Hetznera i wejdź w **DNS** (w nowym panelu: konsola Hetznera, zakładka DNS; w starym: dns.hetzner.com). Otwórz strefę **panekweb.pl**.
2. Kliknij **Add record** (Dodaj rekord).
3. Wpisz dokładnie:
   - Type: **A**
   - Name: **dziennik** (samo `dziennik`, bez kropki i bez `.panekweb.pl`)
   - Value / IP address: **178.104.172.227**
   - TTL: **300**
4. Zapisz (**Save** / **Add record**).
5. **Nie dodawaj** rekordu AAAA ani CAA.

Jeśli panel pyta o kolejność: rekord ma pojawić się na liście jako `dziennik   A   178.104.172.227   300`.

### 1.2 Sprawdź, czy rekord jest widoczny publicznie

W PowerShellu:

```
nslookup dziennik.panekweb.pl
```

Poprawny wynik kończy się tak:

```
Name:    dziennik.panekweb.pl
Address:  178.104.172.227
```

Wynik „Non-existent domain" znaczy: jeszcze nie (albo stary cache, patrz uwaga wyżej).

### 1.3 Pytanie wprost serwera Hetznera (omija cache)

```
nslookup dziennik.panekweb.pl hydrogen.ns.hetzner.com
```

- Jest IP 178.104.172.227, a krok 1.2 jeszcze nie: rekord dodany dobrze, czekasz na cache (do godziny).
- Nie ma IP także tutaj: rekord źle wpisany. Sprawdź nazwę (`dziennik`), typ (A) i IP.

Drugi sposób: wejdź na https://dnschecker.org, wpisz `dziennik.panekweb.pl`, typ A. Zielone
znaczniki z 178.104.172.227 w większości miejsc to dobry znak.

**Idź dalej dopiero, gdy krok 1.2 pokazuje IP.**

---

## Krok 2. Domena w Coolify

1. Coolify → projekt **trading app** → środowisko **production** → aplikacja **trade-journal**.
2. Zakładka **Configuration** → **General**, pole **Domains**.
3. Dziś siedzi tam adres sslip. **Nie kasuj go jeszcze.** Dopisz nową domenę po przecinku, tak by pole wyglądało:

   ```
   https://dziennik.panekweb.pl,http://wme8lmoth3oayvqjuixmp508.178.104.172.227.sslip.io
   ```

   (Zostaw stary wpis dokładnie tak, jak jest u Ciebie w polu, nawet jeśli wygląda inaczej niż ten
   przykład. Ważne: nowy wpis zaczyna się od **https://** i nie ma ukośnika na końcu.)
4. Kliknij **Save**.
5. Kliknij **Redeploy** (lub **Restart**, jeśli Coolify tak podpowie) i poczekaj, aż status będzie **Running**.
6. Zakładka **Logs** (lub logi proxy): nie powinno być błędów o certyfikacie / ACME.

### Sprawdzenie certyfikatu

Po 1 do 2 minutach:

```
curl -I https://dziennik.panekweb.pl/login
```

- `HTTP/1.1 200 OK` (lub 307/302 na `/login`, jeśli aplikacja tak przekierowuje): działa.
- Błąd certyfikatu (`SSL certificate problem`, `self-signed`, `TRAEFIK DEFAULT CERT`): Let's Encrypt
  jeszcze nie wystawił certyfikatu. Poczekaj 5 minut i powtórz. Jeśli po 15 minutach dalej
  tak samo: zrzut logów proxy w Coolify i do mnie. **Nie dodawaj i nie usuwaj domeny w kółko**,
  bo uderzysz w limit prób.

Dodatkowo w przeglądarce: wejdź na https://dziennik.panekweb.pl, kliknij kłódkę, wystawca
powinien zawierać „Let's Encrypt".

---

## Krok 3. Zmienna `TOTP_ENC_KEY` (przed scaleniem fazy 1)

To klucz, którym aplikacja szyfruje sekret dwuskładnikowego logowania (ADR-031). Wyciek samej
bazy nie da wtedy sekretu 2FA.

### 3.1 Wygeneruj

Na swoim komputerze, nie na serwerze:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

(Jeśli masz `openssl`: `openssl rand -base64 32` daje to samo. Na Windowsie `openssl` często nie ma,
wtedy użyj wersji z `node`.)

Wynik to jedna linia, około 44 znaków, np. `k3J...=`. To jest klucz 32-bajtowy; format (base64
z 32 bajtów) zakładam zgodnie z `docs/v2/model-danych.md` (AES-256-GCM). Gdy implementacja fazy 1
będzie wymagała innego formatu, napiszę to w opisie PR i poprawię ten krok.

### 3.2 Zapisz kopię, zanim wkleisz

Wklej klucz w dwa miejsca:

1. menedżer haseł,
2. plik poza gitem `C:\Users\ahaah\.claude\sekrety\trade-journal-totp.env`, w jednej linii `TOTP_ENC_KEY=...`.

**Ostrzeżenie: nie zgub tego klucza i nie zmieniaj go później.** Bez niego zaszyfrowane sekrety
2FA w bazie są nie do odczytania i logowanie drugim składnikiem przestaje działać. Wtedy zostaje
jedynie wyłączenie 2FA ręcznie w bazie. Nie wysyłaj klucza mailem, na czat ani do repozytorium.

### 3.3 Wklej do Coolify

1. Coolify → aplikacja `trade-journal` → **Configuration** → **Environment Variables** → **Add**.
2. Name: `TOTP_ENC_KEY`, Value: wklejony klucz.
3. Zaznacz opcję **secret** (jeśli panel ją pokazuje), tak jak przy `SESSION_SECRET`.
4. **Save**. **Nie klikaj jeszcze Redeploy**; zmienna wejdzie przy pierwszym wdrożeniu fazy 1
   (albo przy najbliższym redeployu w kroku 2, jeśli zrobisz krok 3 wcześniej).

Przypomnienie z dokumentacji wdrożenia: produkcja czyta zmienne z panelu Coolify, nie z pliku na
Twoim komputerze, a po zmianie zmiennej potrzebny jest Redeploy.

---

## Krok 4. Kopia bazy przed migracją

Faza 1 dokłada tabele i kolumny w bazie. Cofnięcie kodu nie cofa migracji, więc kopia jest
jedynym wyjściem awaryjnym.

1. Coolify → projekt **trading app** → środowisko **production** → zasób bazy **trade-journal-db**.
2. Zakładka **Backups**.
3. Jeśli nie ma jeszcze harmonogramu: dodaj (**Add** / **New Scheduled Backup**), częstotliwość
   dzienna (np. `0 3 * * *`), zapisz. Docelowo ma być, zgodnie z `docs/wdrozenie-coolify.md`.
4. Kliknij **Backup Now** (ręczna kopia teraz).
5. Poczekaj chwilę i odśwież listę **Executions** (wykonania).

### Jak sprawdzić, że kopia jest

- Najnowszy wpis ma status **Success** (zielony), dzisiejszą datę i **rozmiar większy od 0**
  (porównaj z poprzednimi, jeśli są; rozmiar rzędu kilobajtów lub megabajtów, nie 0 B).
- Status **Failed** albo rozmiar 0: kopii nie ma. **Nie scalaj fazy 1.** Zrób zrzut ekranu i do mnie.
- Przy zapisie lokalnym na serwerze kopia leży na tym samym dysku co baza, więc nie chroni przed
  awarią dysku. Jeśli pole „S3 / Storage Box" jest skonfigurowane, upewnij się, że wykonanie
  pokazuje też wysyłkę tam.

Zasada firmowa: kopia, której nie odtworzyłeś, nie jest kopią. Minimum realne: pobierz plik z
Executions (przycisk pobierania, jeśli jest) i sprawdź, że nie jest pusty. Pełny test odtworzenia
zrobię osobno na lokalnej bazie; nie przywracaj niczego na produkcji.

Dodatkowo, niezależnie od Postgresa: w aplikacji *Ustawienia → Dane i kopia → Pobierz kopię w JSON*.
Zrzutów ekranu z wolumenu `/data` kopia bazy **nie** obejmuje.

---

## Krok 5. Usunięcie adresu sslip (dopiero po sprawdzeniu)

Warunki, wszystkie trzy:

- [ ] `nslookup dziennik.panekweb.pl` pokazuje 178.104.172.227,
- [ ] `curl -I https://dziennik.panekweb.pl/login` daje odpowiedź bez błędu certyfikatu,
- [ ] w przeglądarce https://dziennik.panekweb.pl otwiera ekran logowania i da się zalogować.

Kroki:

1. Coolify → aplikacja → **Configuration** → **General** → **Domains**.
2. Zostaw tylko: `https://dziennik.panekweb.pl` (usuń przecinek i cały wpis `...sslip.io`).
3. **Save** → **Redeploy**, poczekaj na **Running**.

**Zanim klikniesz Save: łącznik.** Plik `C:\Users\ahaah\.claude\sekrety\trade-journal-ingest.env`
(czyta go `wyslij.mjs`) zawiera dziś adres sslip. Po usunięciu adresu synchronizacja
TradingView i FX Replay przestanie działać, aż zmienisz w nim adres na
`https://dziennik.panekweb.pl`. Otwórz plik i podmień adres; nie wklejaj mi jego zawartości,
bo siedzi w nim token. (W repo adres sslip występuje jeszcze w starych notatkach
`wiedza/stan/stan-dziennika-tradingowego.md` i `.checkpoints/...`; to opis historyczny,
poprawię przy zamykaniu fazy.)

Zapisz też zakładki / skróty na telefonie (PWA) na nowy adres.

---

## Krok 6. Test końcowy

W PowerShellu (`curl.exe`, bo samo `curl` w PowerShellu 5 to inne polecenie):

```
curl.exe -I https://dziennik.panekweb.pl/login
```

Oczekujesz:
- pierwsza linia `HTTP/1.1 200 OK` (lub 307 na `/login` przy braku sesji, jeśli tak działa aplikacja),
- `Strict-Transport-Security: max-age=31536000` (**bez** `includeSubDomains`, **bez** `preload`),
- `X-Robots-Tag: noindex, nofollow`.

Uwaga: HSTS pojawi się dopiero po wdrożeniu kodu fazy 1 (ADR-031). Dziś aplikacja go nie wysyła.
Brak HSTS **przed** scaleniem to normalne; brak **po** scaleniu to usterka do zgłoszenia.

```
curl.exe -I http://dziennik.panekweb.pl/login
```
Oczekujesz: `HTTP/1.1 301` lub `308`/`307` z `Location: https://dziennik.panekweb.pl/login`.

```
curl.exe -s https://dziennik.panekweb.pl/api/health
```
Oczekujesz: `{"status":"ok"}`.

```
curl.exe -I -m 15 https://wme8lmoth3oayvqjuixmp508.178.104.172.227.sslip.io/login
```
Oczekujesz: **brak poprawnej odpowiedzi**, czyli błąd (`404 page not found` od Traefika albo
timeout / błąd certyfikatu). `200` znaczy, że adres sslip jeszcze żyje, wróć do kroku 5.

Dopiero po tych czterech wynikach napisz mi „domena działa". Wtedy scalam fazę 1.

## Gdyby coś poszło nie tak

| Objaw | Przyczyna | Co zrobić |
|---|---|---|
| `nslookup` nadal „Non-existent domain" po godzinie | rekord źle wpisany | krok 1.3, sprawdź nazwę `dziennik`, typ A, IP |
| Błąd certyfikatu po 15 min | Let's Encrypt nie wystawił | zrzut logów proxy w Coolify, nic nie dodawaj ponownie |
| 502 / 504 pod nową domeną | kontener jeszcze nie wstał albo port inny niż 3000 | status Running, port 3000 w Configuration |
| `wyslij.mjs` nie łączy się | stary adres w pliku z tokenem | krok 5, podmiana adresu |
| Nie mogę się zalogować po fazie 1 | brak lub zła `TOTP_ENC_KEY` | sprawdź, czy zmienna jest w Coolify i czy był Redeploy |
