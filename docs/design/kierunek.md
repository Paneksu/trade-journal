# Kierunek wizualny: dziennik tradingowy (UI v2, wydanie R3)

Data: 2026-10-14 · Autor: design-scout · Status: ZAAKCEPTOWANY 14.10.2026 przez użytkownika (plansza wzorów `docs/design/wzory/plansza.html`, szkielet A: Mercury, wzory ekranów bez zmian)

Pytanie celu (przyjęte przez użytkownika 14.10.2026): „czy ekran wygląda co najmniej tak dobrze jak wzór i czy widać, że to nasz dziennik?”

Żadna decyzja nie ma źródła w guście użytkownika: `wiedza/gust.md` nie ma jeszcze wpisów o aplikacjach i panelach (jedyny wpis dotyczy stron bez zdjęć), a `projekty/trade-journal/gust.md` nie istnieje.

Tryb per typ ekranu:
| Typ ekranu | Ścieżka | Tryb | Dlaczego |
|---|---|---|---|
| Wszystkie ekrany | `/(app)/*` | APLIKACJA | Prywatne narzędzie jednoosobowe, praca na danych codziennie, gęstość ważniejsza niż efekt |
| Notatka, Mózg | `/mozg/*` | APLIKACJA z kolumną LEKTURY | Długi tekst użytkownika, szerokość wiersza ok. 68 znaków |
| Mobile/PWA | wszystkie | APLIKACJA (telefon) | Szybki wpis, zdjęcie, podgląd Dziś i buforów |

> Przykładowe etykiety w tym pliku („Przed sesją”, „Do decyzji”) to nazwy z planu funkcji, nie teksty interfejsu. Mikrocopy pisze `copywriter-pl`.

## Szkielet
**A (WYBRANY 14.10.2026, słowa użytkownika: «A: Mercury»): Mercury, ciemny motyw.** https://demo.mercury.com/dashboard · Refero `859b1114-d9af-4c87-ab18-4b26fa4f8896` · zrzuty `wzory/szkielet-mercury/1440.jpg`, `375.jpg`, `refero-home.jpg`. Nośnik charakteru: **liczby i karty**. Język: sidebar 220 px o stopień ciemniejszy od tła, kontener ok. 968 px wyśrodkowany, nagłówek strony 28/36, karty r=12 z ramką 1 px przezroczystej bieli 12% i paddingiem 24, siatka 2 i 3 kolumn z odstępem 24, księga z datą tylko w pierwszym wierszu dnia, pigułki akcji pod nagłówkiem. Kolejność Dziś: nagłówek → pigułki akcji → [karta główna z wykresem | karta listy kont] → 3 karty pomocnicze → sekcja „ruch” w 2 kartach → księga.
Dlaczego A: dziennik to w połowie „bank” (R, $, bufory, księga kosztów prop), a Mercury rozwiązuje dokładnie to: dużą liczbę z kontekstem, paski limitu, księgę. Ma publiczne demo, więc da się mierzyć na żywo.

**B (wariant): Linear, ciemny motyw.** Refero `58ac6637-2009-4f3e-86c3-382b0dbfd942` · `wzory/szkielet-linear/refero-lista.jpg`. Nośnik charakteru: **typografia i gęstość listy**. Język: płaskie listy bez kart, grupy z nagłówkiem na pasku, chipy, prawy panel właściwości, wszystko z klawiatury. Brak publicznego adresu, pomiar tylko szacunkowy.
Dlaczego B jako wariant: lepszy dla Mózgu, notatek i szczegółu trade'u (tekst), słabszy dla Dziś i Prop (liczby).

Ekrany 3, 4 i 8 biorą formę z rodziny Linear także przy szkielecie A: to ta sama ciemna, neutralna rodzina (sidebar + treść + prawy panel), więc nie łamią jednego języka. Karty, promienie i liczby i tak idą z A.

## Lista wzorów (rdzeń dokumentu)
| # | Ekran | Wzór (plik) | Źródło | Forma ze wzoru | Gdzie widać markę | Nośnik i źródło | Pomiar |
|---|---|---|---|---|---|---|---|
| 1 | Dziś | wzory/panel-dzis.jpg, szkielet-mercury/1440.jpg, 375.jpg | demo.mercury.com/dashboard · 859b1114 | Pigułki akcji pod nagłówkiem (Przed sesją / Po sesji / Szybki wpis), karta główna 472 z liczbą dnia w R i krzywą, karta „Konta” z buforami każdego konta prop, rząd 3 kart: plan dnia, checklista reguł, „Do decyzji” (licznik jak „Tasks 10” w sidebarze) | Liczba bohater w IBM Plex Mono z tabular-nums; akcent #e8a44c tylko na głównej pigułce i aktywnym stanie; zysk/strata wyłącznie zielony/czerwony z tokenów | dane z API (trade'y, konta prop, reguły) | szkielet-mercury |
| 2a | Lista trade'ów | wzory/panel-lista.jpg + panel-prop-konto-zywy-1440.jpg (księga) | Linear 58ac6637 + demo.mercury.com/accounts/credit | Wiersz ok. 44–48 px, grupy po dniu z datą tylko w pierwszym wierszu, kolumny: godzina, kierunek, setup (chip), proces A/B/C, R (wyrównane do prawej, mono), filtr u góry | Chip procesu A/B/C w kolorach tokenów, R w Plex Mono, linie `--color-line` | dane | panel-prop-konto |
| 2b | Lista: szuflada | wzory/panel-lista-szuflada.jpg | demo.mercury.com/transactions · 8fd6e234 | Prawa szuflada ok. 420 px nad listą: wynik, miniatury zrzutów, kategoria, komentarz | Miniatury to zrzuty wykresu użytkownika (jego styl, jego rysunki) | zrzuty z `tj chart` / upload | (2c) |
| 2c | Galeria | wzory/panel-galeria.jpg | lumalabs.ai/featured · a00a01e8 | Siatka 5 kolumn (1440), 2 kolumny (375), kafel kwadratowy r=8, podpis pod spodem jednym wierszem | Podpis: data · setup · R w Plex Mono; nakładka procesu A/B/C w rogu | zrzuty wykresów użytkownika, bez zewnętrznych obrazów | (2c) |
| 3 | Szczegół trade'u | wzory/panel-szczegol.jpg | Linear issue · 77d175dd | Środek: tytuł, pod nim zakładki (Plan, Werdykt AI, Przebieg, Zrzuty, Proces, Notatka); prawy panel ok. 280 px „Właściwości” = zamrożony plan (setup, bias, wejście, SL, TP, unieważnienie, ryzyko) z kłódką; aktywność jako oś czasu dopisków | Kłódka i znacznik „zamrożony” w akcencie; liczby planu w mono | dane + tekst użytkownika | (2c) |
| 3w | Zakładka Werdykt AI | wzory/panel-werdykt.jpg | parallel.ai · 1f946f8c | Panel „Basis”: blok „Uzasadnienie”, pod nim numerowane dowody [1] [2] z linkiem i fragmentem; u nas każdy warunek reguły = pozycja z dowodem (OHLC, zrzut), `as_of`, hash, wersja reguły; wynik trade'u zakryty paskiem „ukryty do zamknięcia” | Podpis „interpretacja AI” osobnym stylem od „Słowa użytkownika” (cytat bajt w bajt w ramce z lewą kreską akcentu) | dane AI z API | (2c) |
| 4 | Playbook: karta setupu | wzory/panel-playbook.jpg | Linear profile · 4a094449 | Lewa część: trade'y setupu w grupach z nagłówkiem na pasku (A+, anty-przykłady, pozostałe); prawy panel ok. 470 px: nazwa, status (nieważny / niejednoznaczny / obiecujący / potwierdzony), wersja, warunki jako checklista, statystyka z `n` i przedziałem; zakładki pod spodem jak „Labels / Priority / Projects” = Warunki / Statystyka / Historia | Status setupu w kolorze tokenów (akcent tylko „obiecujący”), statystyka w mono | dane + zrzuty A+ | (2c) |
| 5 | Przegląd tygodnia | wzory/panel-przeglad.jpg | demo.mercury.com/insights · 320c6124 | Segmentowane zakładki Tydzień / Miesiąc, zakres dat po prawej, duża liczba + średnia, wykres słupkowy dni z linią średniej, pod spodem 3 kolumny tekstu: najlepsze/najgorsze wg procesu, koszt gry C i łamania reguł, jedno zobowiązanie (z rozliczeniem poprzedniego) | Słupki zysk/strata w tokenach profit/loss, linia średniej w `--color-muted`, zobowiązanie z akcentem | dane + szkic AI do zatwierdzenia | (2c) |
| 6 | Backtest i porównanie | wzory/panel-backtest.jpg | missiveapp.com · 30b695eb | Tabela: wiersze = źródła (backtest, forward, demo, live prop), kolumny = n, win rate z przedziałem, expectancy, R; delta przy liczbie; przełącznik „porównaj z”; nad tabelą lista sesji backtestu | Delta w zielonym/czerwonym, flaga „orientacyjnie” przy n<30 w `--color-faint` | dane | (2c) |
| 7a | Prop: konta | wzory/panel-prop-konta.jpg | demo.mercury.com/accounts · c7f36c02 | Duża suma u góry + 2 liczby obok (łączna ekspozycja NQ, wypłaty netto), zakładki Konta / Presety / Księga, tabela kont: nazwa + firma, saldo, kolumna bufora (dzień i DD w $ i R) | Ostrzeżenia 50/75/90% w skali akcentu → straty, bez nowych kolorów | dane | (2c) |
| 7b | Prop: konto | wzory/panel-prop-konto.jpg, panel-prop-konto-zywy-1440.jpg | demo.mercury.com/accounts/credit · 420d8e8e | Lewa kolumna 296: saldo, pasek bufora do DD (jak pasek limitu), 2 wiersze-pigułki 44 px (limit dzienny, consistency), prawa: krzywa salda z linią DD; pod spodem księga z datą w 1. wierszu dnia (evale, resety, wypłaty) | Pasek bufora w akcencie, przekroczenie progów w loss | dane | panel-prop-konto |
| 8 | Mózg: kolejka decyzji | wzory/panel-mozg.jpg | cycle.app · a721db29 | Jedna propozycja w środku (tytuł, źródło, cytat), w nagłówku strzałki góra/dół i „1 / n”, prawy panel z dowodami i kontrargumentem; na dole pasek akcji: Zatwierdź / Odrzuć / Później, skróty klawiszy | „Słowa użytkownika” i „wg mentora” jako osobne bloki; zatwierdzenie w akcencie | tekst z API | (2c) |
| 9 | Notatka z backlinkami | wzory/panel-notatka.jpg | memotron.app · e516f4e0 | Notatka ok. 65% (kolumna lektury 68 znaków), prawy panel ok. 35% „Linki”: backlinki i wzmianki z wyszukiwarką; przełącznik Edycja / Podgląd na dole | Markdown w Plex Sans, kod i liczby w Plex Mono, `[[` linki w akcencie | tekst użytkownika | (2c) |
| 10 | Statystyki | wzory/panel-statystyki.jpg | missiveapp.com · 1c47a246 | Rząd 3 kafli: liczba + pod nią `n` i przedział 95%; 2 karty wykresu (equity, dyscyplina obok siebie); kolumny rozkładów z procentem (godziny, dni, setupy), komórki n<20 wyszarzone | Kafle jak karty A (r=12, ramka 12%), liczby w mono | dane | (2c) |
| 11 | Kalendarz | wzory/panel-kalendarz.jpg | missiveapp.com · dca15c76 | Siatka miesiąca z liniami 1 px, dziś w kółku, przełącznik Miesiąc/Tydzień, w komórce: wynik w R (kolor) i liczba trade'ów, kropka gdy jest notatka dnia | Kółko „dziś” w akcencie zamiast czerwieni wzoru (czerwień u nas = strata) | dane | (2c) |
| 12 | Ustawienia | wzory/panel-ustawienia.jpg | Linear settings/security · 00c4424c | Lewa nawigacja ustawień, środkowa kolumna ok. 640: sekcje z tytułem, opisem i ramką-listą; przycisk akcji po prawej w wierszu | Ciemne tło z tokenów (wzór jest jasny) | tekst | (2c) |
| 13 | Paleta Ctrl+K | wzory/panel-ctrlk.jpg | runey.app · 237a7449 | Modal ok. 560 px nad przyciemnionym tłem, pole szukania, grupy wyników z licznikiem (Trade'y 2, Notatki 1), wiersz z ikoną, tytułem i ścieżką, stopka ze skrótami ↑↓ / ↵ / esc | Zaznaczony wiersz tłem `--color-surface-3`, skróty w Plex Mono | dane | (2c) |
| 14a | Mobile: Dziś | wzory/mobile-dzis.jpg + szkielet-mercury/375.jpg | Revolut iOS · 0cb050cd | Dolny pasek 5 pozycji (Dziś, Trade'y, + Szybki wpis, Mózg, Więcej), karta z sumą i wierszami kont prop z buforem, margines 16 | Aktywna zakładka w akcencie, liczby w mono | dane | szkielet-mercury.375 |
| 14b | Mobile: szybki wpis i zdjęcie | wzory/mobile-szybki-wpis.jpg | ABY Journal iOS · c4cbf16d | Pełnoekranowy edytor: godzina i „Gotowe” u góry, chipy kontekstu (dzień / trade), pole tekstu, pod nim Aparat i Galeria; klawiatura | Bez cudzej ilustracji mediów; przyciski w stylu pigułek A | aparat telefonu (`<input capture>`) | (2c) |
| 14c | Mobile: lista trade'ów (375) | wzory/mobile-lista.jpg | Dime iOS (ciemny) · eab42955 | Jedna liczba główna u góry (suma R okresu) z mini-krzywą pod spodem; tylko dwa sterowania (szukaj, filtr w arkuszu); grupy dni: nagłówek dnia wersalikami 13 pt + suma R dnia po prawej, linia 1 px; wiersz ok. 54 pt: setup i godzina w dwóch liniach, R po prawej; dolny pasek z 14a | R w Plex Mono z tabular-nums; zieleń/czerwień tylko na R; zamiast emoji kategorii chip procesu A/B/C z tokenów; aktywny filtr w akcencie | dane | szacunek z obrazu 800 px (skala ok. 2,13) |
| 14d | Mobile: szczegół trade'u (375) | wzory/mobile-szczegol.jpg | Roi iOS (ciemny) · 0ffbcc9e | Pasek: wstecz / w środku dwa wiersze (instrument i kierunek, pod spodem liczba główna R albo „ukryty do zamknięcia”) / okrągły przycisk „…” z akcjami w arkuszu; zakładki z podkreśleniem przewijane w poziomie, ostatnia ucięta krawędzią = sygnał przewijania (Plan, Werdykt AI, Przebieg, Zrzuty, Proces, Notatka); zakładka Plan = wiersze etykieta–wartość ok. 52 pt z linią 1 px, margines 24 pt → u nas 16 | Podkreślenie aktywnej zakładki w akcencie; wartości planu w Plex Mono; kłódka przy nagłówku Planu; bez białego przycisku na dole (akcje w „…”) | dane + tekst | szacunek z obrazu 800 px |
| 14e | Mobile: Werdykt AI (375) | wzory/mobile-werdykt.jpg | Perplexity iOS (ciemny) · 8aac76a8 | Karta/arkusz: nagłówek z ikoną („Uzasadnienie”), pod nim pozycje numerowane „1.”, „2.”: nad tytułem jeden wiersz metadanych (typ dowodu · as_of · wersja reguły), tytuł = warunek reguły z wynikiem, pod spodem szary fragment dowodu skrócony do 2 wierszy, linia 1 px między pozycjami; margines 16 | Podpis „interpretacja AI” osobnym stylem; numery i metadane w Plex Mono; zamiast favikon serwisów ikona typu dowodu (świeca, zrzut); „Słowa użytkownika” w ramce z lewą kreską akcentu | dane AI z API | szacunek z obrazu 800 px |

## Co zostaje z marki (nienaruszone; wejście dla brand-designer)
Status marki: częściowa (system wizualny aplikacji jest, logo nie ma).
- Logotyp: dziś brak (favicon domyślny Next). Decyzja użytkownika 14.10.2026 («Tak, prosty znak»): prosty znak projektuje `brand-designer`; ten sam znak służy jako favicon i ikona PWA (manifest). Znak musi trzymać się marki: akcent #e8a44c na grafitowym tle, geometria zgodna z IBM Plex. Do czasu znaku nazwa składem w Plex Sans 600.
- Kolory klienta (`src/app/globals.css`): tło #0b0e12, powierzchnie #12161c / #191f26 / #212932, linie #262e38 / #35404d, tekst #e7ecf1 / #97a3b0 / #838f9d, **akcent #e8a44c** (mocny #f5b968, przygaszony #3a2c17), zysk #46c08b, strata #e5654f, paleta wykresów viz-1…8. Wchodzą w role, które we wzorze pełnią granaty Mercury (#10101a, #171721, #1e1e2a) i fiolet akcentu #5266eb. Palety wzoru nie przejmujemy.
- Zasada kolorów klienta (komentarz w globals.css): zieleń i czerwień tylko dla zysku i straty, nigdzie indziej. Wzory używają czerwieni do „dziś” i „błędu”: u nas to akcent albo neutralny.
- Kroje klienta: IBM Plex Sans (400/500/600) i IBM Plex Mono (400/500), `tabular-nums` dla liczb. Skala ze wzoru, krój klienta. Arcadia (Mercury) i Inter (Linear) nie wchodzą.
- Styl obrazu: zrzuty wykresów TradingView / FX Replay użytkownika, z jego rysunkami. Żadnych zdjęć stockowych ani AI.
- Ton: rzeczowy, polski, bez gamifikacji i serii. AI to audytor z dowodami, nie doradca.
- Charakterystyczne motywy: terminal danych (mono dla liczb), „Słowa użytkownika” jako cytat bajt w bajt, podpis „interpretacja AI”, kłódka zamrożonego planu, n i przedział przy każdej liczbie.
- Test marki: „czy po zasłonięciu logo nadal widać, że to ten dziennik?” — **TAK**, bo tożsamość niesie bursztynowy akcent na grafitowym tle, Plex Mono w każdej liczbie i stałe znaczniki (n, przedział, interpretacja AI, kłódka), a nie układ. Ryzyko: przy szkielecie A ekran Dziś może wyglądać jak „Mercury w pomarańczu”; zabezpieczenie: liczby w mono, R zamiast $, akcent wyłącznie na głównym CTA i stanach aktywnych.

## Forma ze wzoru (wejście dla brand-designer)
- Krój wzoru: Arcadia Text/Display (Mercury, firmowy, płatny) → nasz: IBM Plex Sans / Mono (krój klienta, bez zamiennika).
- Skala (pomiar 1440 i 375, Playwright): nagłówek strony 28/36 (waga u nas 500, bo Plex nie ma 380), nagłówek sekcji 19/28, etykieta karty 15/24, tekst drugorzędny 13/20 (+0.1px), etykieta grupy nav 12/20 (+0.2px), liczba bohater 28/36 z trackingiem −0.03em, grosze/ułamki R mniejsze. Przy 375 skala ta sama, margines 16.
- Odstępy: kontener ok. 968 px, odstęp kart 24, padding kart 24, sekcja 44 px od poprzedniej, wiersz tabeli 48–51 px, wiersz nav 30 px, pigułka 32 px, wiersz-pigułka 44 px.
- Powierzchnie: karta r=12, ramka 1 px biel 12% (u nas `--color-line`), bez cieni; sidebar o stopień ciemniejszy od tła treści; zakładka aktywna r=8 z tłem akcentu 20% (u nas `--color-accent-dim`).
- Ruch: stany hover, 160 ms ease-out (tło i kolor), linki 200 ms; brak animacji wejścia treści. Faza 2d (16.10.2026) dodaje ruch jako odpowiedź na działanie (szuflada, paleta, arkusz „+”, zakładki, kolejka, rozwijanie), wyłącznie `opacity` i `transform`, na tokenach `--czas-*` i `--ease-*` z `globals.css`; pomiar Mercury: `wzory/pomiar.json` → `ruch.pomiar_2d_16_10_2026`. Wynik ukryty do zamknięcia: ruch nigdy nie przechodzi z wartości do wartości (test e2e `e2e/ruch.spec.ts`). Reduced motion: wszystko wyłączone (`!important`).
- Role rules: kolor akcentu #e8a44c dostają wyłącznie: główna pigułka akcji ekranu (np. „Przed sesją”, „Zatwierdź”), aktywny element nawigacji i zakładki, pasek bufora prop, `[[` linki w notatkach i kłódka zamrożonego planu. Pozostałe przyciski: tło neutralne (`--color-surface-3`). Zieleń i czerwień nigdy na przyciskach.

## Uwagi doradcze
- Linear (szkielet B) i obrazy Refero ekranów 2a, 3, 4: pomiar tylko z obrazu 800 px, NIEPRZETESTOWANE na żywo.
- Wzory 7a, 9, 12 są jasne; bierzemy układ, motyw z tokenów klienta.
- Plex Sans nie ma wagi 380 (Mercury): najbliższa 400 dla etykiet i 500 dla nagłówka strony; do decyzji brand-designer.
- (15.10.2026) Pary bramki przy 375 dla ekranów 2a, 3 i 3w porównują z 14c, 14d, 14e, nie z dashboardem Mercury 375; wcześniejsze wyniki tych par są niemiarodajne. 14c: zrzut ma otwarty popover filtra zasłaniający liczbę (to stan, nie spoczynek). 14d: siłę Roi niesie biel przycisku „Trade” i czerń tła; u nas akcje w „…”, tło z tokenów. 14e: favikony Reddit/YouTube to cudza tożsamość, nie wchodzą.
- Mercury na 375 chowa nawigację w hamburger; dla PWA bierzemy dolny pasek z 14a (plan fazy 5 wymaga dolnej nawigacji).
- 14b: siłę wzoru częściowo niesie kolorowa ilustracja ABY (cudza tożsamość); bierzemy tylko układ edytora.
- Czarna lista (doradczo): Mercury ma pigułki-przyciski w rzędzie i wiele kart równej wysokości (ryzyko „siatki kart”); trzymać jedną kartę główną i resztę jako listy.
- Dembrandt niedostępny (brak binarki chromium_headless_shell-1243, zakaz instalacji): kolory i typografię zmierzono Playwrightem.

## Decision ledger
| # | Decyzja | Źródło | Dlaczego | Data |
|---|---|---|---|---|
| 1 | Marka = obecne tokeny `globals.css` (ciemny, #e8a44c, IBM Plex) | polecenie sesji głównej, plan fazy 5 („Tożsamość”) | Wzór daje formę, marka tożsamość | 2026-10-14 |
| 2 | Szkielet A = Mercury (ciemny), B = Linear (ciemny) | wzór (decyzja gustu, do akceptacji) | A niesie liczby i bufory, B tekst i listy; różnią się nośnikiem charakteru | 2026-10-14 |
| 3 | Ekrany 3, 4, 8 z rodziny Linear także przy A | wzór | Ten sam ciemny neutralny język, lepiej rozwiązuje tekst i panel właściwości | 2026-10-14 |
| 4 | Werdykt AI ze wzoru Parallel „Basis” (uzasadnienie + numerowane dowody) | wzór | Plan: „każde twierdzenie ma dowód” | 2026-10-14 |
| 5 | Kolejka Mózgu ze wzoru Cycle (jedna pozycja + 1/n) | wzór + plan („jedna naraz”) | Jedna decyzja naraz, skróty klawiszy | 2026-10-14 |
| 6 | Dolny pasek mobile ze wzoru Revolut zamiast hamburgera Mercury | plan fazy 5 (PWA: dolny pasek) | Słowa planu > wzór | 2026-10-14 |
| 7 | Czerwone „dziś” w kalendarzu → akcent | marka (zieleń/czerwień tylko dla P&L) | Marka > wzór | 2026-10-14 |
| 8 | Odrzucony Kraken Pro i Mercury Insights Overview | wzór | Terminal zleceń poza zakresem; grafika Mercury to cudza tożsamość | 2026-10-14 |
| 9 | Szkielet A: Mercury (ciemny) | Słowa użytkownika: «A: Mercury» | Akceptacja planszy wzorów | 2026-10-14 |
| 10 | Pytanie celu: „czy ekran wygląda co najmniej tak dobrze jak wzór i czy widać, że to nasz dziennik?” | Słowa użytkownika: «Tak» | Przyjęte brzmienie z planszy | 2026-10-14 |
| 11 | Logo: prosty znak, robi `brand-designer`; także favicon i ikona PWA | Słowa użytkownika: «Tak, prosty znak» | Marka bez znaku; PWA potrzebuje ikony | 2026-10-14 |
| 12 | Wzory ekranów 1–14 bez zmian | Słowa użytkownika: «Bez zmian» | Akceptacja listy wzorów | 2026-10-14 |
| 13 | Znak: FVG, wariant V1 „Bycza luka z CE” (zestaw `docs/design/znak/runda-4-fvg/v1-bycza-ce/`); zmienia „prosty znak” z decyzji 11 na znak z detalem | Słowa użytkownika: «V1: Bycza luka z CE» (wcześniej «2. FVG» i «Cos bardziej w stylu tradingu może być bardziej detalowe») | Rundy 1–3 odrzucone; użytkownik chce znaku tradingowego z detalem | 2026-10-14 |
| 14 | Etap 1 UI v2 (tokeny, szkielet, Dziś, Trade'y, szczegół trade'a) przyjęty, dalej kolejne ekrany | Słowa użytkownika: «Akceptuję, dalej kolejne ekrany» | Bramka designu po rundzie r5 | 2026-10-15 |
| 15 | Grosze i ułamki R pomniejszone w liczbach bohaterach zostają | Słowa użytkownika: «Zostaw pomniejszone» | Forma ze wzoru (pomiar Mercury), sędzia ślepy to kwestionował | 2026-10-15 |
| 16 | Księga trade'ów pokazuje najpierw 100 wierszy („Pokaż wszystkie”), filtry na liście domyślnie zwinięte z licznikiem | Słowa użytkownika: «OK, zostaw» | Długość strony i cel dotyku przy 375 | 2026-10-15 |
| 17 | Etap 2 UI v2 (Mózg: kolejka Do decyzji, listy, notatki z edytorem, profil; Playbook) przyjęty, dalej etap 3 | Słowa użytkownika: «Akceptuję, dalej etap 3» | Bramka twarda 0 przy 1440 i 375, pary r1 | 2026-10-15 |
| 18 | Ekran /strategies zostaje poza nawigacją (strategie sesji backtestu), link z Playbooka | Słowa użytkownika: «OK, zostaw» | Strategie opisują sesje backtestu, karty setupów je zastępują w nawigacji | 2026-10-15 |
| 19 | Etap 3 UI v2 (Przegląd tygodnia i miesiąca, Prop: konta i konto, Statystyki v2) przyjęty, dalej etap 4 | Słowa użytkownika: «Akceptuję, dalej etap 4» | Bramka twarda 0 przy 1440 i 375, pary r1 | 2026-10-16 |
| 20 | Etap 4 UI v2 (Kalendarz, Backtest, Ustawienia, PWA z arkuszem „+”) przyjęty, dalej runda szlifu r2 | Słowa użytkownika: «Akceptuję» | Bramka twarda 0 przy 1440 i 375, pary r1 | 2026-10-16 |
| 21 | Notatki dnia z kont scalone migracją 0029 w jedną notatkę dnia bez konta (teksty z dopiskiem konta, zrzuty przepięte) | Słowa użytkownika: «Scal w migracji» | Jedna notatka dnia jak w rytuale i API; ADR-033 | 2026-10-16 |
| 22 | Przewijanie na telefonie zostaje: dolny pasek przyklejony, /mozg mobile ma dostępność 96 w Lighthouse (pasek przykrywa wiersz przy pierwszym ekranie) | Słowa użytkownika: «Zostaw» | Przewijanie w kontenerze zmieniłoby całą aplikację i psuło zrzuty całej strony | 2026-10-16 |
| 23 | Ruch UI v2 (faza 2d): szuflada 150 ms (pomiar Mercury), paleta 220 ms, arkusz „+” 280 ms z gestem zamknięcia, treść 160 ms opacity; reduced motion wyłącza wszystko; liczby bez liczników od zera | decyzja gustu motion-designer (do akceptacji) | Wzór Mercury ma tylko hover i szufladę 150 ms; reszta wg `ruch.md` | 2026-10-16 |
| 24 | Wzory mobilne 375: 14c lista = Dime iOS ciemny (eab42955), 14d szczegół = Roi iOS ciemny (0ffbcc9e), 14e Werdykt AI = Perplexity iOS ciemny (8aac76a8); pary 375 ekranów 2a, 3, 3w biorą te wzory zamiast `szkielet-mercury/375.jpg`. Uzupełnienie 15.10.2026 po bramce etapu 1 | wzór (decyzja gustu; kierunek już zaakceptowany, marka i wzory desktop bez zmian) | Bramka porównywała ekrany telefonu z dashboardem Mercury 375, który nie ma listy, szczegółu ani dowodów | 2026-10-15 |
| 25 | Nowe ekrany etapu A ADR-034 (Prop → Połączenia, karta Rachunek i konta dnia na Dziś, blok „Wynik netto” przy trade'ie, stawki opłat w Ustawieniach → Konta) budowane z istniejących prymitywów UI v2 (Karta, DataPoint, przyciski, tokeny), bez nowych wzorów z Refero | Decyzja sesji głównej (gust): ekrany robocze z danymi, bez nowego języka wizualnego | Wygląd z tokenów projektu, układ jak Prop: konta (etap 3); dostępność sprawdzona axe, brak poziomego przewijania przy 375 px (e2e/broker.spec.ts) | 17.10.2026 |
| 26 | Ślepa ocena obejmuje dane z rachunku: dla trade'a z ukrytym wynikiem pozycje brokera z tego konta w oknie ±120 s od wejścia, status i kwoty są zakryte w interfejsie i w API | Decyzja sesji głównej (mechaniczna, wynika z ADR-010 i ślepej oceny) | Test e2e na HTML i RSC oraz testy bazy (broker.db.test.ts) | 17.10.2026 |

## Znak
Zestaw: `docs/design/znak/runda-4-fvg/v1-bycza-ce/` (favicon.svg, favicon-16/32.png, apple-touch-icon-180.png, icon-192/512.png, icon-maskable-192/512.png, glif.svg do nagłówka). Generator: `docs/audyt/robocze/generuj-znak-r4.mjs`. Wdrożenie w fazie 5 (PWA), do tego czasu w kodzie nic.

Pełny znak to trzy świece z metalu na siatce wykresu: złota świeca przemieszczenia w środku, stalowe po bokach, między nimi złota strefa FVG z kreskowaniem i przerywaną linią CE 50%. Od 16 do 32 px działa osobny, uproszczony favicon z tej samej rodziny. Zieleń i czerwień w znaku nie występują.

Historia (14.10.2026):
- Runda 1 (`znak/`): trzy proste znaki (nawiasy zakresu, monogramy D i R). Odrzucone: «Jakiś ładniejszy popracuj nad tym dłużej».
- Runda 2 (`znak/runda-2/`): 10 szkiców geometrycznych, finały: przesunięcie, zakres, horyzont. Odrzucone: «Cos bardziej w stylu tradingu może być bardziej detalowe».
- Runda 3 (`znak/runda-3/`): 12 szkiców z detalem tradingowym, finały: herb, świeca-dziennik, otwarty dziennik. Użytkownik wybrał szkic 2: «2. FVG».
- Runda 4 (`znak/runda-4-fvg/`): trzy warianty FVG (bycza z CE, niedźwiedzia z CE, przerwa z kreskowaniem). Wybrany V1: «V1: Bycza luka z CE».

## Poziom dowodów
PRZETESTOWANE: szkielet A przy 1440 i 375 (zrzuty i pomiar Playwright, brak poziomego scrolla przy 375), ekran 7b przy 1440, ruch hover Mercury. CZĘŚCIOWE: wszystkie pozostałe wzory (obraz Refero `full` obejrzany, bez pomiaru na żywo). NIEPRZETESTOWANE: liczby Linear, zachowanie 375 wzorów 4–13 (brak wersji telefonu we wzorach; przyjęto regułę jednej kolumny z A), ruch Linear. CZĘŚCIOWE (15.10.2026): 14c, 14d, 14e jako wzory 375 dla 2a, 3, 3w (obraz Refero full obejrzany, wymiary szacowane z obrazu, aplikacje natywne bez pomiaru na żywo).

---
Research: biblioteka 0 pasujących wpisów (2 wpisy, oba strony) · Refero 48 wywołań (1 search_styles, 26 search_screens, 1 get_similar_screens, 20 get_screen_image full) · Dembrandt 1 strona (check_robots; pomiar padł na braku binarki) · Playwright 2 wzory żywe (dashboard, accounts/credit) · uzupełnienie 15.10.2026: Refero 17 wywołań (9 search_screens, 1 get_similar_screens, 7 get_screen_image full)
