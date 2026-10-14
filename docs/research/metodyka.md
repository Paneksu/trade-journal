# Metodyka journalingu i rola AI: wymagania funkcjonalne dla dziennika tradingowego

Data: 14.10.2026
Autor: market-researcher
Kontekst: dziennik jednego tradera (futures NQ, NY open, ICT, konta prop, backtesty w FX Replay). AI steruje TradingView/FX Replay, ocenia wykonanie względem reguł (werdykt PRZED wynikiem), prowadzi hipotezy (próg n=20), proponuje reguły zatwierdzane pojedynczo.

## 0. Jak czytać poziomy dowodów

- **PRZETESTOWANE**: sprawdziłem tekst źródła na żywo (pełna strona). W tym badaniu to jedna strona: traderssecondbrain.com.
- **CZĘŚCIOWE**: widziałem to w wynikach wyszukiwania (streszczenia, abstrakty), ale nie w pełnym tekście, albo źródło jest drugorzędne lub sprzedażowe.
- **WYWNIOSKOWANE**: moja inferencja z matematyki albo praktyki, bez źródła potwierdzającego wprost.

Czego nie udało się potwierdzić:
- Nazwy „inchworm problem map" u Tendlera nie znalazłem. Najbliższe jest jego rozróżnienie warstw problemu (techniczna, taktyczna, tożsamościowa). Źródło drugorzędne.
- Nie znalazłem pierwotnego źródła opisującego format dziennego przeglądu w SMB ani ich skali „A+".
- Nie znalazłem recenzowanego badania, że deliberate practice poprawia wyniki day tradera. Źródła tradingowe przenoszą Ericssona przez analogię.
- Mark Douglas, Al Brooks, społeczność ICT: nie sprawdzałem źródeł na żywo. Używam tylko ogólnego wniosku (myślenie probabilistyczne, pojedynczy trade nic nie dowodzi), oznaczonego jako WYWNIOSKOWANE.

## 1. Co jest ugruntowane

### 1.1 Metodyka

**Steenbarger.** Dziennik ma być „planem biznesowym", nie pamiętnikiem. Pięć elementów: obserwacje o sobie i rynku, notatki o najlepszych trade'ach, plan na następny dzień, kroki samodoskonalenia, metryki w czasie. Zaleca rozbijanie P/L po kategoriach (long/short, warunki rynkowe) i szukanie różnic w procesie. Zapisywać trzeba także to, co zrobiłeś dobrze. [CZĘŚCIOWE: excerpt na Scribd o niejasnej proweniencji i streszczenia Babypips; nie widziałem TraderFeed ani książki.]
Źródła: [Scribd](https://www.scribd.com/document/560690781/Trading-Journal-That-Works) `[BEZ DATY]`, [Babypips 2024-12-11](https://www.babypips.com/trading/psychology-3-ways-make-the-most-trading-journal-2024-12-11).

**Tendler.** Trzy poziomy gry: A (pełna koncentracja), B (dobrze, nieidealnie), C (poza formą, błędy podstawowe, emocje). Idea „inchworma": zysk robi się, podciągając dół (grę C), nie windując szczyt (A). Przykład z artykułu: A daje +0,35R i zdarza się raz na cztery trade'y, B daje +0,12R i jest większością. Warstwy problemu: techniczna, taktyczna, tożsamościowa; naprawa niewłaściwej warstwy sprawia, że problem wraca w innej formie. [CZĘŚCIOWE, drugorzędne.]
Źródło: [Complete Traders Edge](https://completetradersedge.com/raise-your-c-game/) `[BEZ DATY]`.

**Bellafiore (SMB).** Centralna idea: „process over outcome". Dobry trade to trade zgodny z planem, z kontrolą ryzyka i dyscypliną emocjonalną. PlayBook polega na kodyfikacji własnych najlepszych setupów. [CZĘŚCIOWE: tylko streszczenia, np. [TraderLion](https://traderlion.com/trading-books/the-playbook-summary/) `[BEZ DATY]`.]

**Deliberate practice.** Plausibilne (replay służy do powtórek i testu wyjść), ale bez dowodu efektu na wynik day tradera. [CZĘŚCIOWE: [SMB Training](https://www.smbtraining.com/blog/?p=27781), [Babypips](https://www.babypips.com/trading/deliberate_practice_part_1); brak badań.]

### 1.2 Statystyka małych prób

- Win rate nie jest edge'em. Break-even win rate = L / (W + L). Wilson 95% CI dla obserwowanego 50%: 15/30 daje 33,2–66,8%; 50/100 daje 40,4–59,6%; 100/200 daje 43,1–56,9%. Dla 8/10: 49,0–94,3%. Punkty kontrolne 30/100/200/500 to „checkpointy, nie werdykty". Progi mają być zadeklarowane z góry, a wynik klasyfikowany jako: nieważny / nieopłacalny / niejednoznaczny / obiecujący w próbie / potwierdzony w granicach. [PRZETESTOWANE: [Traders Second Brain, aktualizacja 2026-09-11](https://traderssecondbrain.com/guides/how-many-trades-to-know-if-strategy-works). Strona produktowa, więc ilustracja matematyki, nie autorytet.]
- SQN = √n · mean(R) / sd(R). Pasma Tharpa: <2 poniżej średniej, 2–2,5 średnio, 2,5–3 dobrze, 3–5 świetnie. SQN rośnie z n przy tym samym edge'u (stąd limit n=100 w niektórych wersjach). „n>30" to opinia z forum, nie reguła Tharpa. [CZĘŚCIOWE: [LuxAlgo](https://www.luxalgo.com/library/concept/sqn/), [NexusFi](https://nexusfi.com/psychology-money-management/453-van-tharps-system-quality-number-van-k-tharp-system-quality-number.html) `[BEZ DATY]`.]
- Bootstrap średniego R: nie znalazłem źródła walidującego go na małych próbach. WYWNIOSKOWANE: przy skośnym rozkładzie R i n<30 przedział z bootstrapu jest zbyt optymistyczny, traktować jako orientacyjny.
- MAE/MFE: stop optymalizuje się z rozkładu MAE zwycięzców (praktyka: zostawić 75–85% zwycięzców plus bufor). Optymalizacja na ~30 trade'ach to przeuczenie, praktycy zalecają 200+. MAE z backtestu jest „czystsze" niż live (brak poślizgu), więc live jest wiarygodniejsze. [CZĘŚCIOWE: [wiki MAE](https://nexusfi.com/wiki/trading-wiki/MAE), [Unger Academy](https://ungeracademy.com/blog/trading-tips-great-metrics-to-help-you-identify-stop-loss-and-take-profit-levels-for-your-strategies) `[BEZ DATY]`; heurystyki, nie badania.]
- Wielokrotne testowanie: przy przeszukiwaniu wielu wariantów (SL/TP/BE/godziny) rośnie ryzyko wyboru szumu. Deflated Sharpe Ratio i Probability of Backtest Overfitting wymagają uczciwego zliczenia prób. [CZĘŚCIOWE: abstrakty [DSR](https://papers.ssrn.com/abstract=2460551), [PBO](https://papers.ssrn.com/abstract=2326253). Pełna formalność jest przesadą dla ręcznego tradera, ale sam licznik prób jest tani i konieczny.]

### 1.3 AI w journalingu

- Rynek (2026): TradeZella ma auto-tagging (strategia, sesja, setup, zgodność z regułami) i raport dnia. Jedna recenzja na Trustpilot: auto-tagging zepsuł statystyki 200 trade'ów. TraderSync ma „Cypher AI" z limitami wiadomości. Edgewonk ma Tiltmeter, discipline score i raporty tygodniowe. Wszystkie porównania pochodzą od sprzedawców, jakości AI nie testowano niezależnie. [CZĘŚCIOWE: [TradeZella blog](https://www.tradezella.com/blog/ai-trading-journal-how-ai-replaces-manual-logging), [porównanie Edgewonk](https://traderssecondbrain.com/guides/edgewonk-alternative).]
- Look-ahead bias LLM-ów: przegląd 164 prac o LLM w finansach z lat 2023–2025 znalazł, że tylko ~27% uznaje look-ahead bias. Model może „znać" wynik historycznych dat z treningu (parametric look-ahead bias). Dotyczy to oceny starych dni w replayu, bo modele znają NQ z lat 2020–2024. [CZĘŚCIOWE, preprinty bez weryfikacji peer-review: [arXiv 2602.14233](https://arxiv.org/html/2602.14233), [2605.24564](https://arxiv.org/abs/2605.24564), [2601.13770](https://arxiv.org/pdf/2601.13770).]
- Sykofancja i nadmierne zaufanie: modele zawodzą, gdy preferencje użytkownika przeczą poprawnej odpowiedzi w zadaniach finansowych. Pewny ton LLM-a bywa brany za kompetencję. [CZĘŚCIOWE: [The Price of Agreement, ICLR 2026](https://arxiv.org/pdf/2604.24668), [Biased echoes](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12204588/), [arXiv 2309.00649](https://arxiv.org/pdf/2309.00649). Nie znalazłem badania terenowego o uzależnieniu tradera od AI.]

### 1.4 Prop firm (stan na 14.10.2026; regulaminy zmieniają się często)

- Topstep Combine: najlepszy dzień ≤ 55% celu zysku. Express Funded (wypłaty): największy dzień ≤ 40% łącznego zysku netto. [CZĘŚCIOWE: [Consistency at Topstep](https://help.topstep.com/en/articles/8284208-consistency-at-topstep), oficjalne, widziałem wynik wyszukiwania, `[BEZ DATY]`.] Strony podające „50%" dla Topstep są nieaktualne względem oficjalnego helpcenter `[NIEAKTUALNE]`.
- Apex: według blogów od 1 marca 2026 zmiana reguł (50% consistency, wybór EOD/intraday drawdown). Topstep miał kilka zmian trailing MLL od listopada 2025 do maja 2026. Źródła afiliacyjne i sprzeczne co do DLL i mechaniki drawdownu: [MQL5](https://www.mql5.com/en/blogs/post/772232), [tradetanto](https://tradetanto.com/learn/apex-trader-funding-rules-what-you-need-to-know) `[afiliacyjne, BEZ DATY]`.
- Wniosek projektowy: reguły konta to dane edytowane przez tradera, z datą obowiązywania i linkiem do źródła, nie stałe w kodzie. Presety są punktem wyjścia do weryfikacji w regulaminie, nie prawdą.

## 2. Synteza trójwarstwowa

**(1) Standard branży** (brak = amatorszczyzna): import transakcji i P/L w R, expectancy, win rate, profit factor, max DD, tagi setupów i błędów, przegląd tygodniowy, notatka emocji, equity, analiza po godzinie/dniu/instrumencie.

**(2) Moda**: AI auto-tagging, „AI coach" z czatem, wykrywanie tiltu, podsumowania sesji.

**(3) Pierwsze zasady dla TEGO tradera.** Konkurencyjne dzienniki zakładają, że wynik i tagi wpisuje człowiek albo AI po fakcie, a statystyka to win rate i P/L. Ten trader ma coś, czego te produkty nie mają: werdykt AI zapisany przed wynikiem, replay jako źródło dużych prób, próg n=20 i zatwierdzanie reguł pojedynczo. Przy małych próbach (30 trade'ów daje przedział Wilsona ok. ±17 pp) główną wartością dziennika nie jest „znajdź edge", tylko „nie oszukaj się". Więc:
- ocena procesu (zgodność z regułami) jest wiarygodna dużo szybciej niż ocena wyniku,
- dziennik ma bronić przed wnioskami, a nie je produkować,
- AI ma być audytorem z dowodami, a nie doradcą z opiniami.

## 3. Wymagania funkcjonalne

Priorytet dla tego tradera: MUST / SHOULD / COULD. „Źródło" odnosi się do sekcji 1.

### A. Zapis trade'u (przed, w trakcie, po)

**R1 (MUST). Zamrożony plan przed wejściem.**
- Opis: pola: setup z playbooka, bias/kontekst, poziom wejścia, SL, TP, unieważnienie, ryzyko w R i $. Po zapisie pole `plan` jest tylko do odczytu; zmiany idą jako dopisek z czasem.
- Dlaczego: bez zamrożonego planu nie da się ocenić procesu, a „plan pisany po wyniku" to hindsight.
- Źródło: 1.1. Dowód: CZĘŚCIOWE (zasada), WYWNIOSKOWANE (implementacja).

**R2 (MUST). Werdykt procesu AI z sygnaturą czasu i dowodem, zapisany przed wynikiem.**
- Opis: AI ocenia wejście względem wersjonowanej reguły (spełnione/niespełnione/niejednoznaczne, per warunek), z cytatem świec (czas, OHLC) i zrzutem, które widział. Werdykt niezmienny; w widoku nie ma wyniku, dopóki trade nie jest zamknięty. Mierz i wyświetlaj, ile werdyktów człowiek później zmienił (to dane, nie błąd).
- Dlaczego: rdzeń systemu i obrona przed hindsight.
- Źródło: 1.3. Dowód: CZĘŚCIOWE.

**R3 (MUST). Cutoff danych w każdym werdykcie.**
- Opis: każde wywołanie AI dostaje wyłącznie świece do momentu oceny (`as_of`). Zapisz `as_of`, listę przekazanych świec i hash. UI pokazuje „AI widziało dane do HH:MM". Dla dat, które model mógł znać z treningu, ostrzeżenie „model mógł znać ten dzień".
- Dlaczego: w replayu wykres nie zdradza przyszłości, ale zrzut, notatki i wcześniejsze wyniki mogą; do tego dochodzi znajomość historii z treningu modelu.
- Źródło: [arXiv 2605.24564](https://arxiv.org/abs/2605.24564), [2602.14233](https://arxiv.org/html/2602.14233). Dowód: CZĘŚCIOWE (preprinty); implementacja WYWNIOSKOWANA.

**R4 (MUST). Ocena procesu osobno od wyniku (siatka 2×2), skala A/B/C.**
- Opis: każdy trade ma `proces: A/B/C` (wg Tendlera: A zgodny z regułami / B drobne odchylenia / C naruszenie) oraz `wynik w R`. Widok 2×2: dobry proces/dobry wynik, dobry proces/zły wynik („dobra strata"), zły proces/dobry wynik („szczęście", najgroźniejsze), zły proces/zły wynik.
- Dlaczego: process vs outcome to wspólny mianownik Bellafiore'a, Steenbargera i Tendlera. Przy małych n proces jest jedyną miarą, która szybko mówi coś prawdziwego.
- Decyzja użytkownika 14.10.2026: skala A/B/C przyjęta.
- Źródło: 1.1. Dowód: CZĘŚCIOWE.

**R5 (SHOULD). Stan przed sesją (30 s).**
- Opis: 3–4 pola: sen/energia 1–5, stan emocjonalny 1–5, jeden cel procesu na dzień, „czy wolno mi dziś handlować" (tak/nie). Opcjonalnie checklista rozgrzewki.
- Dlaczego: Tendler wiąże grę C ze stanem; bez danych nie sprawdzisz korelacji ze snem.
- Dowód: CZĘŚCIOWE (zasada); korelację trzeba sprawdzić na własnych danych.

**R6 (SHOULD). Mikronotatka w trakcie (jedno zdanie, opcjonalna) i tag błędu po zamknięciu.**
- Opis: zamknięta lista tagów błędów według warstw Tendlera: techniczny (zły odczyt struktury), taktyczny (zarządzanie: przesunięty SL, przedwczesne BE), tożsamościowy/emocjonalny (revenge, FOMO, strach). Jeden wiodący tag na trade, lista ≤ 10 tagów. Wolny tekst dodatkowo.
- Dlaczego: tagi dają policzalność, warstwy mówią, co naprawiać; rozdrobnienie zabija statystykę przy małym n.
- Dowód: CZĘŚCIOWE (Tendler, drugorzędne); podział to adaptacja, WYWNIOSKOWANE.

**R7 (SHOULD). Dzienny przegląd (5 min, ten sam dzień).**
- Opis: trzy pytania: co zrobiłem zgodnie z planem, jedno odchylenie i jego warstwa, jedna rzecz na jutro. Wypełnienie liczy się do wskaźnika dyscypliny (R19).
- Źródło: Steenbarger (plan następnego dnia, notatki o najlepszych trade'ach). Dowód: CZĘŚCIOWE.

### B. Przeglądy

**R8 (MUST). Przegląd tygodniowy zorientowany na proces.**
- Opis: (a) 3 najlepsze i 3 najgorsze trade'y wg oceny procesu, nie wyniku; (b) rozkład A/B/C (inchworm: ile trade'ów w C i ile R tracą); (c) siatka 2×2 z R4; (d) jedno zobowiązanie na kolejny tydzień; (e) rozliczenie zobowiązania z poprzedniego tygodnia.
- Dlaczego: Tendler: zysk z podciągania dołu; jedna zmiana naraz pozwala sprawdzić, czy zadziałała.
- Dowód: CZĘŚCIOWE.

**R9 (SHOULD). Przegląd miesięczny z podziałami Steenbargera.**
- Opis: P/L w R podzielone na long/short, okno godzinowe po otwarciu (15–30 min), dzień tygodnia, setup, kontekst (np. dzień newsowy). Każda komórka z n i przedziałem (R11). Komórki z n<20 szare z napisem „za mało".
- Źródło: 1.1, 1.2. Dowód: CZĘŚCIOWE.

**R10 (SHOULD). Kwartalna recenzja hipotez i reguł.**
- Opis: lista aktywnych reguł z datą wprowadzenia, wersją, n od wprowadzenia i wynikiem względem stanu sprzed zmiany. Pytanie: zatrzymać, zmienić, wycofać. Decyzja tylko człowieka.
- Dlaczego: reguły dodane na małej próbie zbierają się jak dług.
- Dowód: WYWNIOSKOWANE.

### C. Statystyka

**R11 (MUST). Każda metryka pokazuje n i przedział, nigdy samą liczbę.**
- Opis: win rate z przedziałem Wilsona 95%; expectancy (średnie R) z przedziałem bootstrapowym i dla n<30 z ostrzeżeniem „orientacyjnie"; profit factor i SQN z flagą „n za małe".
- Dlaczego: 15/30 daje 33–67%, czyli statystycznie nic.
- Źródło: [Traders Second Brain](https://traderssecondbrain.com/guides/how-many-trades-to-know-if-strategy-works). Dowód: PRZETESTOWANE (Wilson); bootstrap WYWNIOSKOWANY.

**R12 (MUST). Test względem break-even, nie względem 50%.**
- Opis: dla każdego setupu licz break-even win rate z własnych średnich W i L (po kosztach, w R). „Edge" tylko gdy dolna granica przedziału przekracza próg. Statusy: nieważny / niejednoznaczny / obiecujący / potwierdzony (progi zadeklarowane z góry, edytowalne).
- Źródło: ta sama strona. Dowód: PRZETESTOWANE.

**R13 (MUST). Próg n=20 jako stan „do oceny", nie kosmetyka.**
- Opis: hipoteza ma stany: zbieranie (n<20), do oceny (n≥20), zatwierdzona/odrzucona. Poniżej progu system nie pozwala AI zaproponować reguły i nie pokazuje werdyktu „działa/nie działa". Próg edytowalny per hipoteza, a zmiana progu po zobaczeniu wyniku jest logowana.
- Dlaczego: przy n=20 przedział Wilsona dla 55% to ok. 35–75%, więc n=20 oznacza „zaczynamy oceniać", nie „wiemy". Działa razem z R11 i R12.
- Decyzja użytkownika 14.10.2026: próg n=20 zostaje jako „do oceny".
- Dowód: PRZETESTOWANE (matematyka przedziałów), WYWNIOSKOWANE (próg).

**R14 (MUST). Licznik prób testowanych wariantów (multiple testing).**
- Opis: dla każdej hipotezy/setupu rejestruj, ile wariantów (SL, TP, godziny, filtry) sprawdzono na tych samych danych. Wyświetlaj „testowano k wariantów na n trade'ach; wynik najlepszego jest zawyżony". Opcjonalnie rezerwa danych (np. ostatnie 30% próby ukryte do jednorazowej weryfikacji).
- Źródło: [DSR](https://papers.ssrn.com/abstract=2460551), [PBO](https://papers.ssrn.com/abstract=2326253). Dowód: CZĘŚCIOWE (abstrakty); pełne DSR/PBO niepotrzebne, licznik wystarczy.

**R15 (MUST). Rozdzielenie backtest / forward / live jako osobnych źródeł danych.**
- Opis: każdy trade ma `źródło: replay-backtest | replay-forward (reguła zamrożona przed) | demo | live prop`. Statystyki domyślnie liczone osobno, łączenie świadome. Różnica expectancy backtest vs live jako stały wskaźnik.
- Backtest ślepy: użytkownik losuje dzień i zwykle go nie zna („losuję, zwykle nie znam"). Czwarte źródło „dzień znany" nie jest potrzebne; zamiast tego opcjonalna flaga `dzień_znany` na trade'ie replay, domyślnie fałsz, do ręcznego ustawienia, gdy trader rozpozna dzień.
- Źródło: [NexusFi MAE](https://nexusfi.com/wiki/trading-wiki/MAE). Dowód: CZĘŚCIOWE, reszta WYWNIOSKOWANA.

**R16 (SHOULD). MAE/MFE na każdym trade'ie i widok optymalizacji SL/TP/BE z hamulcem.**
- Opis: liczone ze świec (w R i punktach). Wykres MAE zwycięzców vs przegranych, MFE vs wyjście, „efektywność wyjścia" = zrealizowane R / MFE. Sugestie zmiany SL/TP/BE dopiero od n≥100 w danym setupie (edytowalne), z komunikatem o przeuczeniu i licznikiem z R14. Wcześniej tylko opis rozkładu, bez rekomendacji.
- Decyzja użytkownika 14.10.2026: sugestie SL/TP/BE od n≥100.
- Dowód: CZĘŚCIOWE (forum/blogi).

**R17 (SHOULD). Max drawdown i serie w R, z symulacją.**
- Opis: max DD w R z historii oraz z symulacji Monte Carlo przetasowania R (5. i 95. percentyl DD, najdłuższa seria strat). Jedno zdanie: „przy tym expectancy seria 8 strat z rzędu zdarza się w x% przypadków".
- Dowód: WYWNIOSKOWANE (standardowa praktyka).

**R18 (COULD). SQN jako metryka drugorzędna, z zastrzeżeniem.**
- Opis: pokazuj z flagą, że rośnie z n i opisuje przeszłość; do porównań używaj przedziału expectancy.
- Źródło: [LuxAlgo SQN](https://www.luxalgo.com/library/concept/sqn/). Dowód: CZĘŚCIOWE.

### D. Dyscyplina

**R19 (MUST). Wskaźnik dyscypliny oparty na regułach, nie na wyniku.**
- Opis: dzienny i tygodniowy odsetek trade'ów w procesie A (R4), liczba naruszeń twardych reguł (przekroczony limit trade'ów/dnia, ruszony SL, handel poza oknem, brak planu przed wejściem), wypełnione przeglądy. Wykres w czasie obok equity.
- Dlaczego: przy małych n wynik jest szumem, a dyscyplina jest mierzalna od razu. Edgewonk ma podobny „discipline score" (opis sprzedawcy).
- Dowód: CZĘŚCIOWE, reszta WYWNIOSKOWANA.

**R20 (SHOULD). Wykrywanie wzorca tiltu z danych, nie z deklaracji.**
- Opis: sygnały: kolejny trade < X minut po stracie, wzrost rozmiaru po stracie, odejście od okna godzinowego, trade bez planu. Po przekroczeniu progu komunikat „stop-check" (nie blokada). Zapisuj, czy trader go posłuchał.
- Dowód: CZĘŚCIOWE (zasada), sygnały WYWNIOSKOWANE.

### E. AI: zasady projektowe

**R21 (MUST). Każde twierdzenie AI ma dowód i poziom pewności.**
- Opis: format: twierdzenie → dowód (trade'y, świece, zrzuty, linki) → poziom (PRZETESTOWANE/CZĘŚCIOWE/WYWNIOSKOWANE) → n. Twierdzenie bez dowodu jest odrzucane przez interfejs. Pole „czego AI nie wie".
- Źródło: [arXiv 2309.00649](https://arxiv.org/pdf/2309.00649), [ICLR 2026](https://arxiv.org/pdf/2604.24668). Dowód: CZĘŚCIOWE.

**R22 (MUST). Człowiek zatwierdza reguły pojedynczo, z wersjonowaniem.**
- Opis: propozycja reguły = obiekt ze statusem (propozycja → zatwierdzona → wycofana), autorem, dowodami, n, datą wersji. Zmiana reguły tworzy nową wersję; trade'y pozostają powiązane z wersją obowiązującą w dniu wejścia. Zero zbiorczego „zatwierdź wszystko".
- Dowód: WYWNIOSKOWANE + zasada tradera.

**R23 (MUST). AI nie zmienia danych źródłowych bez śladu.**
- Opis: tagi nadane przez AI w osobnym polu `proponowane_przez_AI`, zatwierdzane przez człowieka (masowo, z podglądem). Statystyki mogą pokazywać „tylko zatwierdzone". Log zmian.
- Dlaczego: relacja z Trustpilot o zepsutych statystykach 200 trade'ów po auto-taggingu; jeden przypadek, więc dowód słaby, koszt zabezpieczenia mały.
- Źródło: [TradeZella: porównanie](https://www.tradezella.com/best-trading-journal). Dowód: CZĘŚCIOWE.

**R24 (SHOULD). Tryb „adwokat diabła" i pytania refleksyjne zamiast porad.**
- Opis: po przeglądzie AI zadaje 2–3 pytania (np. „Który warunek planu był niespełniony, a mimo to wszedłeś?"), a przy propozycji reguły podaje najsilniejszy kontrargument i alternatywne wyjaśnienie. Domyślnie bez rekomendacji handlowych.
- Dlaczego: ogranicza sykofancję i uzależnienie od AI jako wyroczni; rozwija samoocenę tradera.
- Dowód: CZĘŚCIOWE.

**R25 (SHOULD). Kalibracja werdyktów AI względem człowieka.**
- Opis: dla każdej reguły licz zgodność werdyktu AI z późniejszą oceną tradera. Niska zgodność wskazuje regułę do przepisania (zwykle niejednoznaczna reguła, nie wina modelu).
- Dowód: WYWNIOSKOWANE.

### F. Playbook i wiedza

**R26 (MUST). Playbook jako struktura, nie notatka.**
- Opis: karta setupu: nazwa, warunki wstępne (kontekst/bias, sesja), warunki wejścia (checklista), SL, TP, BE, unieważnienie, czego unikać, przykłady A+ i anty-przykłady (zrzuty z linkami do trade'ów), aktualna statystyka z przedziałem (R11), wersja, historia zmian. Przy migracji z Obsidiana pola bez danych oznaczone `[do uzupełnienia]`.
- Źródło: [TraderLion o PlayBook](https://traderlion.com/trading-books/the-playbook-summary/). Dowód: CZĘŚCIOWE.

**R27 (MUST). Trade linkuje do setupu, wersji reguły, hipotezy i pojęć ICT.**
- Opis: relacje dwukierunkowe. Z karty setupu widać wszystkie trade'y, z trade'u reguły, które sprawdzał. Pojęcia ICT (FVG, OB, liquidity sweep, MSS itd.) jako encje z definicją i przykładami, linkowane z notatek i werdyktów.
- Dowód: WYWNIOSKOWANE.

**R28 (SHOULD). Powtórki przykładów A+ (lekki spaced repetition).**
- Opis: raz w tygodniu 5 losowych przykładów A+ i 2 anty-przykłady, wybrane według pominiętych w ostatnim miesiącu. Tryb quizu: wykres do momentu wejścia, trader deklaruje decyzję, potem odkrywa. Wynik zapisywany.
- Dlaczego: buduje rozpoznawanie wzorca; brak dowodów na wynik tradingowy, stąd SHOULD.
- Źródło: [SMB Training](https://www.smbtraining.com/blog/?p=27781). Dowód: CZĘŚCIOWE (analogia).

### G. Prop firm

**R29 (MUST). Moduł reguł kont prop jako dane, wiele kont, presety, ostrzeżenia.**
- Opis: trader może mieć kilka kont prop naraz. Dla każdego konta: firma, wielkość, typ drawdownu (EOD/intraday, trailing/static), limit dzienny, cel zysku, zasada konsystencji (próg %), liczba kontraktów, data obowiązywania i URL źródła. Aplikacja zawiera presety popularnych futures prop firm (np. Topstep, Apex) jako punkt wyjścia; każdy preset ma datę ostatniej weryfikacji i link do regulaminu, a trader potwierdza wartości przed użyciem. Dziennik pokazuje dla każdego konta odległość do limitu dziennego i trailing DD w $ i w R, największy dzień jako % zysku (przykładowe progi Topstep: Combine 55%, Express 40%), ostrzeżenia przy 50/75/90% limitu oraz podpowiedź rozmiaru pozycji z limitu ryzyka.
- Decyzja użytkownika 14.10.2026: kilka kont prop plus presety popularnych futures prop firm.
- Dlaczego: przekroczenie limitu kasuje konto, a reguły zmieniają się często i różni dostawcy podają je różnie. Presety bez daty weryfikacji byłyby ryzykowne.
- Źródło: [Topstep: consistency](https://help.topstep.com/en/articles/8284208-consistency-at-topstep) (oficjalne); Apex: [MQL5](https://www.mql5.com/en/blogs/post/772232) `[afiliacyjne, BEZ DATY]`. Dowód: CZĘŚCIOWE. Wartości presetów trzeba sprawdzić w oficjalnych regulaminach przed wpisaniem; do tego czasu `[ZAŚLEPKA: parametry presetu do weryfikacji]`.

**R30 (SHOULD). Plan zachowania zysku zgodny z konsystencją.**
- Opis: gdy dzień zbliża się do progu największego dnia, aplikacja pokazuje „zostało x$ zanim ten dzień złamie zasadę konsystencji" i opcję zakończenia sesji. Ocena po fakcie: czy dyscyplina wyjścia wynikała z reguły, czy z emocji.
- Źródło: [Topstep](https://help.topstep.com/en/articles/8284208-consistency-at-topstep). Dowód: CZĘŚCIOWE.

## 4. Czego nie robić (anty-wymagania)

- Nie dodawać „wyniku pewności edge'u" (jedna liczba 0–100): ukrywa n, przedział i multiple testing. Zamiast tego R11–R14.
- Nie dopuszczać do tego, by AI zmieniało reguły samo (R22). Nie pozwalać AI oceniać dni, które model może znać, bez ostrzeżenia (R3).
- Nie kopiować streaków i gamifikacji bez uzasadnienia: brak dowodu, że poprawiają wyniki tradera, a mogą zachęcać do handlowania „dla serii". WYWNIOSKOWANE.
- Nie wbudowywać stałych wartości limitów prop w kod (R29).

## 5. Wnioski dla projektu

**Przyjmujemy jako standard** (brak = amatorszczyzna): R-multiple, expectancy, win rate, profit factor, max DD, tagi setupów i błędów, przegląd tygodniowy, podziały po godzinie/setupie, equity, moduł prop.

**Robimy inaczej niż konkurencja** (warstwa 3):
1. Werdykt procesu zamrożony przed wynikiem, z cutoffem danych i dowodem (R2, R3). Konkurencja taguje po fakcie.
2. Każda liczba z n i przedziałem, ocena względem break-even, status hipotezy zamiast „win rate 62%" (R11–R13).
3. Licznik testowanych wariantów i rozdział backtest/forward/live (R14, R15), bo replay to fabryka przeuczenia.
4. Dyscyplina mierzona zgodnością z regułami, nie wynikiem (R4, R19), z siatką 2×2 w przeglądzie tygodniowym (R8).
5. AI jako audytor: dowód, kontrargument, brak rekomendacji handlowych, człowiek zatwierdza (R21–R25).

**Przekaz wyróżniający:** „Ten dziennik nie mówi Ci, że masz edge. Mówi, ile jeszcze nie wiesz, i pilnuje, żebyś się nie oszukał."

**Kolejność budowy (propozycja):** najpierw R1–R4, R11–R13, R22 (rdzeń modelu danych), potem R8, R15, R19, R26, R27, R29 (przegląd, źródła danych, dyscyplina, playbook, konta prop), dopiero potem R16, R17, R20, R28, R30.

## 6. Odpowiedzi użytkownika

Słowa użytkownika (przekazane przez koordynatora, 14.10.2026):
- Skala procesu A/B/C: TAK. Wpływ: R4, R8, R19.
- Konta prop: kilka kont prop plus presety popularnych futures prop firm. Wpływ: R29. Presety wymagają weryfikacji w oficjalnych regulaminach i daty weryfikacji.
- Backtest ślepy: „losuję, zwykle nie znam". Wpływ: R15 (bez czwartego źródła „dzień znany", tylko opcjonalna flaga), R3 (ostrzeżenie o znajomości dnia przez model zostaje, bo dotyczy modelu, nie tradera).
- Próg n=20 zostaje jako stan „do oceny". Wpływ: R13.
- Sugestie SL/TP/BE od n≥100. Wpływ: R16.

Pytania, które pozostają otwarte: dokładne parametry kont tradera (firma, typ drawdownu, DLL, consistency) do wpisania po sprawdzeniu w regulaminie.

## 7. Źródła (z uwagami o aktualności)

- [Traders Second Brain: how many trades](https://traderssecondbrain.com/guides/how-many-trades-to-know-if-strategy-works) (aktualizacja 2026-09-11; strona produktowa)
- [Topstep: Consistency](https://help.topstep.com/en/articles/8284208-consistency-at-topstep) (oficjalne helpcenter, `[BEZ DATY]`)
- [Complete Traders Edge: C-game](https://completetradersedge.com/raise-your-c-game/) (drugorzędne, `[BEZ DATY]`)
- [Scribd: Steenbarger excerpt](https://www.scribd.com/document/560690781/Trading-Journal-That-Works) (`[BEZ DATY]`, proweniencja niejasna), [Babypips 2024-12-11](https://www.babypips.com/trading/psychology-3-ways-make-the-most-trading-journal-2024-12-11)
- [TraderLion: PlayBook](https://traderlion.com/trading-books/the-playbook-summary/) (`[BEZ DATY]`)
- [LuxAlgo: SQN](https://www.luxalgo.com/library/concept/sqn/), [NexusFi: SQN](https://nexusfi.com/psychology-money-management/453-van-tharps-system-quality-number-van-k-tharp-system-quality-number.html) (forum, `[BEZ DATY]`)
- [NexusFi wiki: MAE](https://nexusfi.com/wiki/trading-wiki/MAE), [Unger Academy](https://ungeracademy.com/blog/trading-tips-great-metrics-to-help-you-identify-stop-loss-and-take-profit-levels-for-your-strategies) (`[BEZ DATY]`)
- [DSR (SSRN)](https://papers.ssrn.com/abstract=2460551), [PBO (SSRN)](https://papers.ssrn.com/abstract=2326253) (recenzowane, 2014/2015)
- [arXiv 2602.14233](https://arxiv.org/html/2602.14233), [2605.24564](https://arxiv.org/abs/2605.24564), [2601.13770](https://arxiv.org/pdf/2601.13770), [2604.24668](https://arxiv.org/pdf/2604.24668) (preprinty 2026, bez weryfikacji peer-review), [arXiv 2309.00649](https://arxiv.org/pdf/2309.00649), [PMC: Biased echoes](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12204588/)
- [TradeZella: AI journal](https://www.tradezella.com/blog/ai-trading-journal-how-ai-replaces-manual-logging), [TradeZella ranking](https://www.tradezella.com/best-trading-journal), [porównanie Edgewonk](https://traderssecondbrain.com/guides/edgewonk-alternative) (sprzedażowe, `[BEZ DATY]`)
- [MQL5: zmiany prop 2026](https://www.mql5.com/en/blogs/post/772232), [tradetanto: Apex](https://tradetanto.com/learn/apex-trader-funding-rules-what-you-need-to-know) (`[afiliacyjne, sprzeczne między sobą, BEZ DATY]`)
- [SMB Training: deliberate practice](https://www.smbtraining.com/blog/?p=27781), [Babypips: deliberate practice](https://www.babypips.com/trading/deliberate_practice_part_1)

## Zapisane pliki

- r:\PROJEKTY\web_developer\projekty\trade-journal\docs\research\metodyka.md
