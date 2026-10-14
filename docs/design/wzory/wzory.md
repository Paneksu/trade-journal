# Wzory ekranów: dziennik tradingowy (potok v2, etap 5a)

Data: 2026-10-14 · Autor: design-scout · Status: PROPOZYCJA (czeka na akceptację planszy)

**Uwaga prawna i ToS.** Pliki `panel-*.jpg`, `mobile-*.jpg` i `szkielet-*/refero-*.jpg` to obrazy ekranów z Refero (wnętrza aplikacji po zalogowaniu, bez publicznego adresu). Służą wyłącznie jako roboczy materiał projektu do porównań w 2c. Nie trafiają do biblioteki, do publicznego repo ani do publikacji. Katalog `docs/design/wzory/` warto dopisać do `.gitignore` albo trzymać repo prywatne (repo `trade-journal` jest prywatne, ale i tak: decyzja użytkownika). Pliki z dopiskiem `zywy` i `szkielet-mercury/1440.jpg`, `375.jpg` to zrzuty Playwrightem z publicznego demo Mercury.

Rozdzielczość obrazów Refero: ok. 800 px szerokości (podgląd `full` z MCP). Proporcje i układ czytelne, drobne liczby nie: liczby bierzemy z `pomiar.json`.

| # | Ekran | Plik | Źródło (adres, Refero id, selektor) | Nośnik | Uwagi |
|---|---|---|---|---|---|
| A | Szkielet A: Mercury (ciemny) | `szkielet-mercury/1440.jpg`, `375.jpg`, `refero-home.jpg` | https://demo.mercury.com/dashboard · `859b1114-d9af-4c87-ab18-4b26fa4f8896` · cała strona (wewnętrzny scroller `[class*=_layout_]`, zrzut przy oknie 1440×2240) | dane (liczby, wykres, księga) | Na żywym zrzucie w prawym dolnym rogu wisi popup demo „Try out Mercury”, nie należy do wzoru |
| B | Szkielet B: Linear (ciemny) | `szkielet-linear/refero-lista.jpg` | brak publicznego adresu · `58ac6637-2009-4f3e-86c3-382b0dbfd942` | typografia i gęstość listy | Tylko obraz Refero, pomiar NIEPRZETESTOWANY |
| 1 | Dziś | `panel-dzis.jpg` (+ żywy `szkielet-mercury/1440.jpg`) | demo.mercury.com/dashboard · `859b1114-d9af-4c87-ab18-4b26fa4f8896` · `main` | dane: bufory prop, plan dnia | Pigułki akcji = „Przed sesją / Po sesji / Szybki wpis”, licznik przy „Tasks” = „Do decyzji” |
| 2a | Lista trade'ów | `panel-lista.jpg` (Linear) + wzorzec księgi z `panel-prop-konto-zywy-1440.jpg` | `58ac6637-2009-4f3e-86c3-382b0dbfd942` · księga: demo.mercury.com/accounts/credit, tabela | dane | Grupowanie po dniu jak w księdze Mercury (data tylko w 1. wierszu dnia), gęstość i chipy jak Linear |
| 2b | Lista: szuflada podglądu | `panel-lista-szuflada.jpg` | demo.mercury.com/transactions · `8fd6e234-8f2c-4e42-89c2-0848e71feb20` | dane + miniatury zrzutów | Klik w wiersz otwiera prawą szufladę bez zmiany strony |
| 2c | Galeria | `panel-galeria.jpg` | lumalabs.ai/featured · `a00a01e8-6db2-4abf-bcc6-0bce3ce1582a` | zrzuty wykresów użytkownika (własne, z aplikacji) | Siatka 5 kolumn, kwadratowe kafle r=8, podpis pod kaflem; u nas podpis = data · setup · R |
| 3 | Szczegół trade'u | `panel-szczegol.jpg` | linear.app (issue) · `77d175dd-23fb-4d77-9a75-2177e45ccf79` | tekst + dane | Prawy panel „Properties” = zamrożony plan (tylko odczyt), środek = zakładki |
| 3w | Szczegół: zakładka Werdykt AI | `panel-werdykt.jpg` | platform.parallel.ai · `1f946f8c-3a50-43cd-beb1-79d46a0ec7e1` | tekst + dowody | Panel „Basis”: uzasadnienie + numerowane źródła = warunki reguły z dowodem (świece, zrzut) |
| 4 | Playbook: karta setupu | `panel-playbook.jpg` | linear.app (profile) · `4a094449-e0ab-4893-8e58-c6239e7c228c` | dane + zrzuty A+/anty | Lewa: trade'y setupu w grupach (A+, anty-przykład, reszta); prawa: karta (warunki, status, wersja) + statystyka z przedziałem |
| 5 | Przegląd tygodnia | `panel-przeglad.jpg` | demo.mercury.com/insights · `320c6124-65a9-4cfc-afeb-85cedfed5af4` | dane + 3 wnioski tekstem | Duża liczba + wykres + linia średniej; pod spodem 3 kolumny wniosków (u nas: 3 najlepsze/najgorsze, koszt gry C, zobowiązanie) |
| 6 | Backtest i porównanie źródeł | `panel-backtest.jpg` | missiveapp.com analytics · `30b695eb-c152-498c-abe1-a8c45fb039e8` | dane | Tabela metryk z deltą przy każdej komórce i przełącznikiem „porównaj z”; wiersze = źródła (backtest/forward/demo/live) |
| 7a | Prop: konta | `panel-prop-konta.jpg` | demo.mercury.com/accounts · `c7f36c02-98ce-4c9d-ae19-e025e04a0ffc` | dane | Wzór jasny, układ ten sam w ciemnym; kolumna „Auto transfer rules” = bufor dzienny i DD |
| 7b | Prop: konto (bufory, księga) | `panel-prop-konto.jpg`, żywy `panel-prop-konto-zywy-1440.jpg` | demo.mercury.com/accounts/credit · `420d8e8e-4a64-4dd9-95d4-76e5951844d3` · `main` | dane | Pasek salda = bufor do DD; pigułki-wiersze = limit dzienny, consistency; księga = evale, resety, wypłaty |
| 8 | Mózg: kolejka decyzji | `panel-mozg.jpg` | product.cycle.app · `a721db29-4fe5-490c-9dc2-f6eaccdf0d82` | tekst | Jedna pozycja w środku, strzałki góra/dół i licznik „1/n” w nagłówku; prawy panel = propozycje AI z zatwierdzeniem jednym kliknięciem |
| 9 | Notatka z backlinkami | `panel-notatka.jpg` | web.memotron.app · `e516f4e0-84f6-4d08-9efa-8da09c17ab94` | tekst | Wzór jasny; podział notatka / panel „Links” 50:50 → u nas ok. 65:35, panel = backlinki i wzmianki |
| 10 | Statystyki | `panel-statystyki.jpg` | missiveapp.com analytics · `1c47a246-4f51-4bbe-810b-0ad33fc5de46` | dane | Kafle z liczbą i porównaniem pod spodem (u nas: n i przedział 95%), kolumny rozkładów z procentem |
| 11 | Kalendarz | `panel-kalendarz.jpg` | missiveapp.com calendar · `dca15c76-b046-440a-bd15-eebc387b4171` | dane | Siatka miesiąca, dziś w kółku akcentu; w komórce wynik dnia w R i liczba trade'ów zamiast wydarzeń |
| 12 | Ustawienia (urządzenia, tokeny, 2FA) | `panel-ustawienia.jpg` | linear.app settings/account/security · `00c4424c-4e2e-485d-a704-e96586b49cd2` | tekst | Wzór jasny; sekcje: Sesje, Passkeys, Klucze API, Aplikacje = Urządzenia, 2FA, Tokeny `tj`, Łącznik MCP |
| 13 | Paleta Ctrl+K | `panel-ctrlk.jpg` | runey.app · `237a7449-489a-4988-9e85-90f6c3ef9773` | tekst | Wyniki w grupach (Trade'y, Notatki) z licznikiem, stopka ze skrótami klawiszy |
| 14a | Mobile: Dziś + dolny pasek | `mobile-dzis.jpg` | Revolut iOS · `0cb050cd-65de-4e49-95ef-53e5e301049c` | dane | Karta „Total wealth” z wierszami = bufory kont; 5 zakładek na dole |
| 14b | Mobile: szybki wpis + zdjęcie | `mobile-szybki-wpis.jpg` | ABY Journal iOS · `c4cbf16d-135a-4f78-8d2d-68e4c4bbef74` | tekst + aparat | Pełnoekranowy edytor, godzina u góry, „Gotowe”; ilustrację mediów (cudza tożsamość) zastępujemy dwoma przyciskami: Aparat, Galeria |

Wersja 375 dla ekranów desktopowych: wzór jednej kolumny ze `szkielet-mercury/375.jpg` (margines 16, karty pełnej szerokości), nawigacja z 14a. Osobne wzory telefonu: 14a, 14b.

## Odrzucone kandydatury (z powodem)
- Kraken Pro (terminal tradingowy, `69751349-…`): za gęsty, trzy kolumny paneli pod składanie zleceń; my nie składamy zleceń.
- Mercury Insights „Overview” (`f06ee439-…`): siłę niesie ich autorska grafika z chmury punktów, czyli cudza tożsamość.
- Missive month w roli statystyk: zbyt pusty bez danych.
