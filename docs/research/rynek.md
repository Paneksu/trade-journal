# Badanie rynku aplikacji do journalingu tradingowego

**Data: 14.10.2026. Badanie konkurencji do przebudowy v2.**

## Decyzje użytkownika po raporcie (14.10.2026)

Słowa użytkownika (przekazane przez koordynatora): kilka kont prop plus presety najpopularniejszych futures prop firm, PWA na telefon, ocena procesu w skali A/B/C, backtest ślepy.

Konsekwencje dla raportu (interpretacja badacza, nie decyzja):
- **Kilka kont prop + presety firm.** Luki 1, 11, 12, 13 i 14 przestają być opcjonalne. Presety firm trzeba oprzeć na aktualnych regułach ze stron firm, bo TradesViz sam zastrzega, że reguły się zmieniają (ich lista z marca 2026). Nie kopiować wszystkich 20 firm, tylko najpopularniejsze futures.
- **PWA na telefon.** Odpowiada na lukę mobile: TradeZella i Tradervue są tylko webowe (CZĘŚCIOWE). Wymaga potwierdzenia, co telefon ma robić (najpewniej szybka notatka po sesji i podgląd bufora prop).
- **Ocena procesu A/B/C.** Zgodna z praktyką z poradnika FX Replay (A+, B, C). Wspiera wskaźnik oparty na zgodności z regułami zamiast Zella Score (pkt 5.1).
- **Backtest ślepy.** Raport nie badał go osobno. W źródłach nie znalazłem produktu, który wprost ukrywa wynik do końca sesji (WYWNIOSKOWANE). Zakres do osobnego sprawdzenia.

## 0. Metoda i granice badania

- **Nie testowałem żadnego produktu na żywo.** Czytałem strony producentów, cenniki, help center, recenzje i Trustpilot. Dlatego żadne twierdzenie nie ma poziomu PRZETESTOWANE.
- **CZĘŚCIOWE** oznacza twierdzenie z przeczytanego źródła pierwotnego (strona producenta, help center, recenzja z datą). To często deklaracja marketingowa, której nie sprawdziłem w działaniu.
- **WYWNIOSKOWANE** oznacza mój wniosek ze źródeł albo z braku wzmianki.
- **Reddit i YouTube.** Nie dotarłem do wątków r/Daytrading, r/FuturesTrading, r/Forex ani r/ICT. Wyszukiwarka nie zwróciła ani jednego wątku, a `old.reddit.com` jest zablokowany dla fetchera. Opisów YouTube też nie dostałem.
  - Głosy użytkowników pochodzą z Trustpilot (TradeZella, recenzje z datami) i z pojedynczych komentarzy na NexusFi.
  - Wątki z Reddita i forów prop firm trzeba zebrać ręcznie. Frazy w sekcji "Czego brakuje w badaniu".
- **Większość porównań w sieci to materiały sprzedażowe** (afiliacje, blogi producentów, blog prop firmy Tradeify). Oznaczam to przy każdym źródle.
- **ICT.** W żadnym z przeczytanych źródeł nie ma FVG, IFVG ani rejection blocków jako pojęć produktu. Rynek journali jest generyczny (akcje, opcje, forex). Wywnioskowane z braku wzmianek.
- **Zakres.** Cele i nawyki oraz mobile zbadałem słabo. Obszary, w których nie mam dowodów, oznaczam wprost.

## 1. Tabela konkurencji

Ceny w USD. Wszystkie pochodzą ze stron producentów, poza przypadkami opisanymi osobno.

| Produkt | Kluczowe funkcje | Unikalne pomysły | Cena | Chwalą / narzekają |
|---|---|---|---|---|
| **TradeZella** | Auto-sync 500+ brokerów, playbooki z logowaniem pominiętych trade'ów, Notebook (plan przed, przegląd po), 300+ raportów, trade replay, ręczny i AI backtest, PropFirm Sync, Mentor Mode | Agenci AI (Auto-Tagger, Session Review, Market Sentiment Briefing "Start My Day"), Zella Score (6 ważonych metryk), Spaces | Essential 35/mies. (315/rok), Pro 59 (531/rok), Ultra 99 (891/rok). Od lipca 2026 podwyżka z 29 i 49. Brak planu darmowego. | Chwalą replay i prop. Narzekają na błędy synchronizacji i brak zwrotów, w tym "Asked for refund 1h after purchase and was told that they not doing refunds" (Robert, 10.03.2025). Pojawia się też "pay $49 per month for onther subscription" za sync prop (Hinal, 22.06.2026). Trustpilot 1* (dostęp 14.10.2026). |
| **Tradervue** | Import 80+ brokerów, wykresy TradingView z wejściami i wyjściami, 100+ raportów, MFE/MAE, udostępnianie trade'ów, mentoring | Najstarszy produkt (od 2011), warstwa społecznościowa | Free do 100 trade'ów/mies. (inne źródło: ok. 30), Silver 29,95, Gold 49,95 | Chwalą stabilność. Przeglądy opisują UI jako "dated". Brak AI, replayu i natywnej aplikacji mobilnej. Skargi na obciążenia po anulowaniu. Recenzja 6,5/10, aktualizacja 24.09.2026. |
| **Edgewonk** | Import 200+ brokerów, Psychology Lab (błędy, checklisty), Chart Lab, 50+ raportów, Edge Finder, optymalizatory wyjść | Tiltmeter (dyscyplina), Mistakes z kosztem w $, Session report cards | 197/rok, jeden plan, zwrot 14 dni. Strona [BEZ DATY], promocja 169 niepewna. | Głos z NexusFi z 2020 r. ("couldn't show if I scaled into a position") jest **[NIEAKTUALNE]**. Starsze recenzje mówią o braku auto-sync, dziś strona deklaruje import. Rozbieżność niewyjaśniona. |
| **TraderSync** | Autosync, CSV, Playbook i Strategy Checker, replay (1 min / 1 s / 250 ms zależnie od planu), asystent AI Cypher | Replay na prawdziwych danych w każdym planie płatnym | Pro 29,95, Premium 49,95, Elite 79,95 (7 dni próby) | Cypher na Pro ma 5 wiadomości dziennie, recenzent uważa to za zbyt restrykcyjne. Interaktywny wykres tylko dla akcji USA. Recenzje 2026 wspominają błędy danych i brak zwrotów. Recenzja afiliacyjna, aktualizacja 24.09.2026. |
| **TradesViz** | 600+ statystyk, 250+ brokerów, replay, symulator, **moduł prop firm**, AI Coach, **hostowany MCP + REST API** | 4 typy drawdownu, retroaktywna ocena kont, multi-chart replay, "Persist Replay Trades" | Basic 0 (tylko akcje), Pro 19,99, Platinum 29,99. API i MCP od Pro. | Chwalą tanią i szeroką analitykę. Recenzje wskazują "dated UI" i nadmiar wykresów kosztem wskazówek. |
| **FX Replay** | Replay ręczny, journal w zakładce, symulator prop, multi-chart | Dane futures od 2012 (plan Pro) | Standard 17,99/mies. (źródło NexusFi, możliwe nieaktualne) | Skargi na lag i zamrożenia w Trustpilot od 2023. Journal tylko dla trade'ów symulowanych, bez screenshotów w produkcie i bez broker importu. |
| **Chartlog** | Wykresy TradingView z wejściami i wyjściami | brak potwierdzonych | 14,99 lub 29,99 (źródła niespójne) | Dane tylko dla giełd USA. Wątpliwy dla futures. Poza kandydatami. |
| **Kinfo** | Auto-śledzenie, warstwa społecznościowa (portfele, ranking) | Liderboard | Free + IAP, Pro ok. 9,99 (niepewne) | Aplikacja mobilna, 4,8/5 w App Store. Profil "social investing", nie dla tradera prop. |
| **Notion / Obsidian** | Baza z kolumnami, notatki | Pełna elastyczność | 0 | Źródła są konkurencyjne wobec Notion. Wady: ręczny wpis, kruche formuły (trailing drawdown), brak importu. Dla Obsidiana nie znalazłem nic. |
| **Tradesea Compass** | Bezpłatny dla klientów Tradeify, ma blokady ryzyka | Lockout przy zbliżaniu się do limitów | 0 | Tylko synchronizacja z Tradeify. Deklaracje z artykułu prop firmy, który sam go promuje. |
| **JournalPlus, Lune, PropControl** | AI czat, natywny sync prop, śledzenie dziennego limitu | brak potwierdzonych | JournalPlus 159 jednorazowo | Tylko opisy wydawców. Za mało danych. |

**Nowsze AI-journale 2025-2026.** Nie znalazłem żadnego dedykowanego "journala dla Claude" poza hostowanym MCP TradesViz i kilkoma małymi serwerami MCP (m.in. `trader-journal-mcp` do MT5, Simple Trading Journal), ale ich opisy są cienkie. Brokerzy otwierają MCP (TradeStation w styczniu 2026, Interactive Brokers i ThinkMarkets w czerwcu 2026, ten ostatni tylko według agregatora).

## 2. Lista funkcji według obszarów

W kolumnie "Mamy" korzystam wyłącznie z listy funkcji aplikacji podanej w zleceniu. Brak wzmianki w liście oznacza NIE albo "do potwierdzenia".

| Obszar / funkcja | Standard / wyróżnik / rzadkość | Dowód | Mamy |
|---|---|---|---|
| **Import: auto-sync brokerów** | Standard (Zella 500+, Edgewonk 200+, TradesViz 250+, Tradervue 80+) | CZĘŚCIOWE | NIE (do potwierdzenia, w liście tylko "kwota brokera") |
| **Import: pliki CSV** | Standard | CZĘŚCIOWE | do potwierdzenia |
| **Import: zawodność sync** | Najczęstsza skarga przy TradeZelli | CZĘŚCIOWE (Trustpilot) | nie dotyczy |
| **Wpis: wyjścia częściowe, R, MAE/MFE** | Standard | CZĘŚCIOWE | TAK |
| **Wpis: pola własne** | Standard u Edgewonka, u pozostałych niewiele | WYWNIOSKOWANE | TAK |
| **Wpis: tagi-konfluencje z interwałem** | Rzadkie. Żadne źródło nie opisuje tagu z interwałem. | WYWNIOSKOWANE | TAK |
| **Wpis: ocena wykonania A+/B/C** | Praktyka z poradnika FX Replay (4.06.2026) | CZĘŚCIOWE | CZĘŚCIOWO (AI pass/fail); decyzja użytkownika: skala A/B/C |
| **Playbook: strategia z checklistą** | Standard (TradeZella, TraderSync, Edgewonk) | CZĘŚCIOWE | TAK |
| **Playbook: pominięte trade'y** | Wyróżnik (TradeZella: "log missed trades") | CZĘŚCIOWE | TAK |
| **Playbook: wersjonowanie reguł i atrybucja zmian** | Rzadkie. Poradnik TradeZelli zaleca jedną zmianę tygodniowo, ale bez narzędzia. | CZĘŚCIOWE | NIE |
| **Przegląd dnia** (plan przed, przegląd po) | Standard (Notebook TradeZelli, FX Replay) | CZĘŚCIOWE | TAK |
| **Przegląd tygodnia: szablon 30 min** | Opisany w poradniku, bez automatycznej wersji | CZĘŚCIOWE | CZĘŚCIOWO (kalendarz, statystyki) |
| **Statystyki: krzywa, rozkład R** | Standard | CZĘŚCIOWE | TAK |
| **Statystyki: Edge Finder** | Wyróżnik Edgewonka | CZĘŚCIOWE | TAK |
| **Statystyki: Zella Score** | Wyróżnik, z progami pod wysoką skuteczność (pkt 5) | CZĘŚCIOWE | CZĘŚCIOWO (dyscyplina) |
| **Statystyki: pora dnia i dzień tygodnia** | Standard (FX Replay Stats) | CZĘŚCIOWE | do potwierdzenia |
| **Psychologia: nastrój / energia** | Rzadkie. Wzmianki: Bear Bull Traders (sen, kofeina). | CZĘŚCIOWE | TAK |
| **Psychologia: Tiltmeter / koszt błędów w $** | Wyróżnik Edgewonka | CZĘŚCIOWE | CZĘŚCIOWO (dyscyplina) |
| **Psychologia: wykrywanie revenge / overtrading** | Wyróżnik (CernoQuant, MCP MT5) | CZĘŚCIOWE | NIE |
| **Prop: profile firm, 4 typy drawdownu, daily loss, consistency, min. dni** | Wyróżnik TradesViz, TradeZella dla nazwanych firm | CZĘŚCIOWE | NIE (decyzja użytkownika: kilka kont + presety) |
| **Prop: alert przy 80% limitu, ekspozycja łączna na kontach** | Zalecenia w blogu TradeZelli, brak potwierdzonej implementacji | CZĘŚCIOWE | NIE |
| **Prop: wypłaty i koszty evali, realny zwrot** | Tylko zalecenie, bez produktu | CZĘŚCIOWE | NIE |
| **Backtest: sesje** | Standard (FX Replay, TradeZella) | CZĘŚCIOWE | TAK |
| **Backtest: wspólna statystyka z livem** | Nie znalazłem. TradeZella i FX Replay trzymają je osobno. | WYWNIOSKOWANE | NIE |
| **Replay prawdziwych trade'ów (bar po barze)** | Wyróżnik (TradeZella Pro, TraderSync, TradesViz) | CZĘŚCIOWE | NIE |
| **Replay z "what-if" zapisanym obok** | Rzadkie (TradesViz "Persist Replay Trades") | CZĘŚCIOWE | NIE |
| **AI: czat nad danymi** | Standard w 2026 (Cypher, Zella AI, TradesViz) | CZĘŚCIOWE | NIE |
| **AI: agent tagujący po regułach użytkownika** | Wyróżnik (TradeZella Auto-Tagger, Pro+) | CZĘŚCIOWE | CZĘŚCIOWO (oceny reguł) |
| **AI: plan przed sesją / przegląd po** | Wyróżnik (TradeZella) | CZĘŚCIOWE | NIE |
| **AI: MCP z zapisem i uprawnieniami** | Rzadkie (tylko TradesViz) | CZĘŚCIOWE | zaplanowane |
| **AI steruje wykresem i robi zrzuty** | Nie znalazłem w produkcie. TradesViz MCP wprost nie renderuje wykresów. | WYWNIOSKOWANE | zaplanowane |
| **Notatki: pojęcia, hipotezy, wiedza powiązana z trade'ami** | Nie znalazłem. Notion robi to ręcznie. | WYWNIOSKOWANE | zaplanowane |
| **Zrzuty per interwał** | Rzadkie. FX Replay nie zapisuje zrzutów w produkcie. | CZĘŚCIOWE | TAK |
| **Wykres TradingView z wejściami i wyjściami wewnątrz trade'a** | Standard (Tradervue, TraderInsight, Chartlog) | CZĘŚCIOWE | NIE (tylko zrzuty) |
| **Eksport pełnego backupu** | Słaby punkt. Eksport TradeZelli opisano jako "not a complete backup/re-import path", źródło konkurencyjne. | CZĘŚCIOWE | do potwierdzenia |
| **Cele i nawyki** | Brak wiarygodnych danych | WYWNIOSKOWANE | NIE |
| **Mobile** | TradeZella i Tradervue tylko web. Edgewonk zapewnia dostęp z telefonu. | CZĘŚCIOWE | decyzja użytkownika: PWA |

## 3. TOP 15 luk dla tego tradera

Skala: W = wartość (1-5), K = koszt (1-5, niższy = taniej). Priorytet wynika z W minus K, z uwzględnieniem tego, że egzamin prop jest ryzykiem finansowym.

1. **Silnik reguł prop (W5 / K3).** Profil konta: typ drawdownu (trailing EOD, intraday, static, trailing-to-static lock), dzienny limit, consistency %, min. dni, kontrakty, cel. Do tego wskaźnik bufora i alert przy 80%.
   - Rynek: TradesViz ma 20 firm i 65 konfiguracji, a TradeZella robi synchronizację dla nazwanych firm.
   - Zastrzeżenie producenta: TradesViz pisze, że bufor w dzienniku zależy od częstotliwości synchronizacji (co kilka minut), a dane są "tylko informacyjne".
   - Nie kopiować wszystkich 20 firm. Zbudować własne profile z presetami najpopularniejszych firm futures.
   - Dowód: CZĘŚCIOWE.
2. **Auto-capture przy wejściu i wyjściu przez MCP (W5 / K4).** AI zapisuje zrzuty wszystkich interwałów, symbol, wartości wskaźników i narysowane poziomy w chwili zdarzenia. To przewaga: konkurenci opierają się na pamięci tradera albo na imporcie po fakcie. Tool `capture_screenshot`, `data_get_pine_boxes` i `chart_get_state` są w MCP TradingView.
   - Dowód: WYWNIOSKOWANE (nie znalazłem tego w produkcie konkurencji).
3. **Plan przed sesją generowany przez AI i porównywany po sesji (W5 / K3).** TradeZella ma ten przepływ jako "Start My Day" i Session Review. Wersja własna czyta realne poziomy z wykresu (PDH/PDL, sesje, FVG). Wynik: bias i scenariusze zapisane przed pierwszą świecą, a po sesji AI zestawia plan z wykonaniem.
   - Dowód: CZĘŚCIOWE.
4. **Kolejka potwierdzeń dla tagów AI (W4 / K2).** AI taguje, trader zatwierdza jednym kliknięciem, tag ma pochodzenie (AI albo ręczny) i da się go cofnąć. TradesViz wymaga podglądu i potwierdzenia operacji i rozdziela uprawnienia odczytu, zapisu i usuwania.
   - Dowód: CZĘŚCIOWE.
5. **Replay "what-if" (W4 / K4).** Odtwarzanie własnego trade'u w replayu TradingView, test innego wyjścia i zapis wyniku symulowanego obok oryginału, jak "Persist Replay Trades" w TradesViz.
   - Dowód: CZĘŚCIOWE.
6. **Statystyki per setup z ochroną przed małą próbą (W4 / K2).** Źródła zalecają win rate, średnie R i profit factor per setup oraz ostrożność przy małej próbie: "every new tag makes every statistic thinner", a wzorce pojawiają się po 50-100 trade'ach. Pokazywać liczbę trade'ów i przedział ufności zamiast gołych procentów.
   - Dowód: CZĘŚCIOWE.
7. **Wersjonowany playbook z dziennikiem zmian reguł (W4 / K3).** Każda zmiana reguły ma datę, powód i statystyki przed i po. Zasada "jedna zmiana tygodniowo" z poradnika TradeZelli daje czystą atrybucję. Narzędzia rynkowe jej nie wspierają.
   - Dowód: CZĘŚCIOWE (zalecenie) / WYWNIOSKOWANE (brak narzędzia).
8. **Hipotezy powiązane z trade'ami (W5 / K4).** Każda hipoteza w "mózgu" ma licznik trade'ów, które ją potwierdzają i obalają. Pytanie: "czy IFVG na 5m działa lepiej po sweepie London high?". Nie znalazłem tego u konkurencji. Notion robi to ręcznie.
   - Dowód: WYWNIOSKOWANE.
9. **Rejestr kosztu łamania reguł w R i $ (W4 / K2).** Edgewonk ma "Mistakes" z kosztem. Tu to prosty raport nad istniejącą dyscypliną i pominiętymi trade'ami.
   - Dowód: CZĘŚCIOWE.
10. **Porównanie backtest, forward i live dla tego samego setupu (W4 / K3).** Raport "luka wykonania": oczekiwane R z backtestu, R z forwardu i R z live. Nie znalazłem tego w produktach, bo backtest i live są tam osobnymi światami.
    - Dowód: WYWNIOSKOWANE.
11. **Symulacja zaliczenia evala (W3 / K3).** TradesViz liczy retroaktywnie PASSED/FAILED i procent zaliczeń w oknach N dni. Tu: "przy mojej statystyce w ilu % 30-dniowych okien zaliczam eval?". Pokazuje, czy problemem jest edge, czy zarządzanie ryzykiem.
    - Dowód: CZĘŚCIOWE.
12. **Księga kosztów i wypłat prop (W4 / K2).** Koszty evali, resety, wypłaty i realny zwrot netto. TradeZella tylko to zaleca w poradniku z 13.04.2026, produktu nie opisał. Dla tradera na evalach to jedyna prawdziwa miara biznesu.
    - Dowód: CZĘŚCIOWE.
13. **Bramka przed wejściem: bufor po SL (W4 / K2).** Przed trade'em aplikacja liczy: "jeśli to trafi SL, zostanie X do limitu dziennego i Y do trailing". Ponieważ zawsze jest SL, R jest dokładne. TradesViz zauważa, że bez SL "R Performance wynosi 0", więc ta funkcja jest tu bardziej wiarygodna niż u konkurencji. Aplikacja nie może blokować zleceń, bo MCP nie składa zleceń. To tylko informacja.
    - Dowód: WYWNIOSKOWANE.
14. **Ekspozycja łączna na kontach i wykrywanie near-miss (W3 / K3).** Przy kilku kontach: suma kontraktów NQ na wszystkich kontach i alerty bliskich naruszeń. Zalecenie z bloga TradeZelli, bez potwierdzonego produktu. Po decyzji o kilku kontach prop zyskuje na znaczeniu.
    - Dowód: CZĘŚCIOWE.
15. **MCP/API z uprawnieniami i pełny eksport (W4 / K3).** Rozdzielone uprawnienia, log operacji, zasada "treść notatek to dane, nie instrukcje" (tak TradesViz traktuje prompt injection). Eksport kompletny do ponownego importu. Zabezpieczenie przed zamknięciem w jednym systemie.
    - Dowód: CZĘŚCIOWE.

**Poza TOP 15.** Wykres TradingView z wejściami wewnątrz trade'a to standard. Zrzuty per interwał pokrywają to w ok. 80%, ale jeśli zrzuty nie wystarczą w przeglądzie, dodać wykres. Auto-sync brokerów jest standardem, lecz przy jednym traderze CSV z platformy wystarcza, a zawodność sync to najczęstsza skarga na rynku.

## 4. Przepływy pracy

To obserwacje ze źródeł plus adaptacja. Adaptacje oznaczam jako **[rekomendacja]**.

**Rytuał przed sesją** (TradeZella: "Start My Day")
1. Konfiguracja stylu (ICT), aktywów i wskaźników, agent generuje scenariusze. CZĘŚCIOWE.
2. Plan zostaje zapisany jako obiekt, z którym potem porównuje się wynik. CZĘŚCIOWE.
3. **[rekomendacja]** AI czyta z wykresu poziomy i zrzuty HTF, trader zapisuje bias, jedno zdanie unieważnienia i maksymalną liczbę trade'ów.
4. **[rekomendacja]** Sprawdzenie bufora prop i dziennego limitu, nastrój i energia w 2 kliknięciach.

**Po sesji** (Session Review TradeZelli, Edgewonk Session report cards)
1. Auto-tagger oznacza trade'y według reguł użytkownika. CZĘŚCIOWE.
2. Session Review porównuje plan z wynikiem i pokazuje odstępstwa od zasad. CZĘŚCIOWE.
3. Czego AI nie robi: nie zna emocji z chwili trade'u, co przyznaje sam TradeZella. Notatkę emocjonalną dodaje trader. CZĘŚCIOWE.
4. **[rekomendacja]** Kolejka potwierdzeń tagów (jedno kliknięcie), ocena procesu A/B/C, potem notatka dnia z jednym wnioskiem.

**Przegląd tygodnia** (poradnik TradeZelli, 2.04.2026, 30 min)
1. Kalendarz tygodnia (3 min).
2. Metryki kontra 30-dniowa średnia, flaga przy odchyleniu większym niż 15% (5 min).
3. Wygrane i straty rozdzielone na "dobra decyzja" i "złamana reguła" (5 min).
4. Odchylenia według setupu, pory dnia i instrumentu (7 min).
5. Trzy obserwacje: co działało, co kosztowało, jedna zmiana (5 min).
6. Jedna zmierzalna korekta zapisana w strategii (5 min).
Progi (15%, 30 dni) to propozycje bloga bez niezależnego dowodu. **[rekomendacja]** Ten szablon generuje AI z danych tradera, a trader zatwierdza punkty 5 i 6.

**Przegląd playbooka** (z kilku poradników)
1. Pokaż statystyki per setup z liczbą próby. CZĘŚCIOWE.
2. Wytnij lub zawęź setupy z ujemnym oczekiwaniem po 50-100 trade'ach. CZĘŚCIOWE (próg nieweryfikowany).
3. Zamieniaj lekcje na mierzalne reguły. "Be more patient" jest niemierzalne. CZĘŚCIOWE.
4. **[rekomendacja]** Zapisz zmianę w wersjonowanym playbooku z datą i wróć po N trade'ach, żeby porównać.

**Trade replay**
- TradeZella: pasywny odtwarzacz własnych trade'ów, sekunda po sekundzie, tylko Pro. Służy do analizy impulsywnych decyzji. CZĘŚCIOWE.
- TradesViz: dwa tryby, przegląd i "z handlem", gdzie testuje się inne wyjście, a symulowane trade'y lądują obok oryginalnych. Odtwarza też wszystkie wykresy z układu naraz. Deklaracja producenta. CZĘŚCIOWE.
- **[rekomendacja]** Replay po sesji: AI uruchamia replay w TradingView, dochodzi do wejścia, robi zrzut każdego interwału, potem testuje alternatywne wyjście (BE strukturalny vs TP) i zapisuje wynik symulowany z oznaczeniem pochodzenia.

## 5. Czego unikać

1. **Zella Score jako miary jakości.** Win rate waży 15% przy progu 60%, a avg win/loss oraz profit factor mają progi od 1,8 do 2,6 (help.tradezella.com, artykuł bez daty). Trader ICT z niższą skutecznością i wyższym RR dostaje kary za styl. Zrobić wskaźnik oparty na zgodności z regułami, nie na wyniku. CZĘŚCIOWE.
2. **Setki wykresów bez wniosku.** TradesViz sam pisze o 600+ statystykach, a recenzje wskazują, że to szerokość kosztem wskazówek. Edge Finder i jedno "co zmienić" są cenniejsze. CZĘŚCIOWE.
3. **Czat AI bez dostępu do reguł tradera.** Tradervue przyznaje brak AI, a TraderSync ogranicza Cypher do 5 wiadomości dziennie na Pro. Model "kredytów AI" bez informacji, ile zużywa operacja, to źródło frustracji (TradeZella nie podaje kosztu). CZĘŚCIOWE.
4. **Auto-sync, który psuje dane.** Najczęstsze skargi na Trustpilot (np. "you pretty much have to delete all your trades and import it again", 15.12.2024). Zawsze trzymać surowe wykonania i pozwolić je przeliczyć. CZĘŚCIOWE.
5. **Odcinanie funkcji planami.** Opłata 49 USD za sync prop jako osobna subskrypcja budzi gniew (Hinal, 22.06.2026). Dla jednoosobowej aplikacji to nieistotne, ale pokazuje, że prop jest najbardziej pożądaną funkcją. CZĘŚCIOWE.
6. **Blokady, których nie można wymusić.** Tradesea mówi o "smart lockout controls", ale to działa tylko w integracji z jedną prop firmą. Ta aplikacja nie składa zleceń (MCP tego nie robi), więc nie obiecywać blokady. Dać ostrzeżenie. CZĘŚCIOWE.
7. **Funkcje zapowiedziane, nieistniejące.** TradesViz sam pisze, że egzekwowanie "news blackout" i "restricted hours" jest "w planach", a wielostopniowy Challenge Mode też. Nie zapisywać w aplikacji pól, których nic nie liczy. CZĘŚCIOWE.
8. **Ręczne wpisywanie jako warunek działania.** Notion wymaga wpisu każdego trade'u i kruchych formuł dla trailing drawdown (dwa źródła konkurencyjne). Zasada: ręcznie tylko to, czego AI nie wie, czyli intencja i emocje. WYWNIOSKOWANE.
9. **Warstwa społecznościowa.** Rankingi (Kinfo) i udostępnianie służą innym użytkownikom. Dla jednoosobowego ICT-tradera to szum. WYWNIOSKOWANE.
10. **Zamknięty eksport.** Zawsze pełny eksport z możliwością ponownego importu. CZĘŚCIOWE (źródło konkurencyjne).
11. **Ślepa wiara w AI.** Sam TradesViz zaznacza, że odpowiedzi AI mogą zawierać błędy. Dlatego rekomendacja nr 4 (kolejka potwierdzeń) jest ważniejsza niż "więcej AI". CZĘŚCIOWE.

## Wnioski dla projektu

**Standard (brak go będzie odczytany jako amatorszczyzna):**
- wpis z częściowymi wyjściami, R i MAE/MFE
- playbook z checklistą
- statystyki per setup
- przegląd dnia i tygodnia
- zrzuty
- eksport

Wszystko to aplikacja już ma.

**Modne (2026):**
- czat AI nad danymi
- agenci tagujący i podsumowujący
- hostowany MCP
- moduł prop firm z buforem drawdownu
- replay

**Pierwsze zasady (Eureka).** Branża zakłada, że trade'y trafiają do dziennika po fakcie (import z brokera albo wpis ręczny), a AI tylko je podsumowuje. Dlatego mierzy wynik (Zella Score, win rate), bo to jedyne, co ma w danych. Ten trader ma inną sytuację:
- zawsze SL i TP, więc R jest dokładne;
- jeden instrument, jedno okno czasowe, wąski zestaw setupów;
- sterowalne TradingView i FX Replay, więc kontekst można zapisać w momencie zdarzenia.

Stąd: **nie importujemy historii, tylko zapisujemy kontekst na żywo, a oceniamy wykonanie, nie wynik.**

**Co robimy inaczej:**
1. Priorytet nr 1 to silnik prop z buforem po SL (luki 1, 13, 11, 12), na kilka kont, z presetami najpopularniejszych firm futures. To ryzyko finansowe, a rynek ma to najsłabiej przy futures.
2. Priorytet nr 2 to auto-capture i plan przed sesją z poziomami z wykresu (2, 3). Tego nie znalazłem w żadnym produkcie.
3. Wskaźnik jakości oparty na zgodności z regułami (ocena procesu A/B/C), nie na win rate (pkt 5.1, luka 9).
4. AI zawsze proponuje, a człowiek zatwierdza jednym kliknięciem. Każdy zapis ma pochodzenie (luki 4, 15).
5. Pojęcia i hipotezy powiązane z trade'ami (8) to cel długoterminowy. Nikt tego nie robi, więc brak wzorca do skopiowania.

**Przekaz wyróżniający (do copy w aplikacji):** "Dziennik, który zapisuje kontekst, zanim zdążysz o nim zapomnieć, i ocenia, czy trzymałeś się planu, a nie czy wygrałeś".

**Pytania do Szymona (brakuje danych):**
- Czy jest auto-sync z platformy, czy kwota brokera jest wpisywana ręcznie? Lista mówi tylko o "kwocie brokera".
- U których firm prop są konta i ile? (Częściowo rozstrzygnięte: kilka kont plus presety najpopularniejszych firm futures. Brakuje listy firm.)
- Co ma robić PWA na telefonie (notatka po sesji, podgląd bufora)?
- Backtest ślepy: czy ma ukrywać wynik do końca sesji, czy dane po punkcie replayu? Raport tego nie badał.
- Cele i nawyki: nie znalazłem danych. Czy to w ogóle ma być w aplikacji?

## Czego brakuje w badaniu (do uzupełnienia ręcznie)

Reddit (r/FuturesTrading, r/Daytrading, r/Forex), frazy do wklejenia w wyszukiwarkę:
- `tradezella vs tradesviz`
- `edgewonk worth it`
- `trading journal prop firm drawdown`
- `stopped journaling`
- `ICT journal`
- `trading journal AI`

YouTube: "TradeZella review 2026", "TradesViz prop firm", "Edgewonk Tiltmeter".

## Źródła (z datami i oznaczeniami)

Strony producentów. Ceny bez daty na stronie oznaczam [BEZ DATY]:
- [TradeZella: cennik](https://www.tradezella.com/pricing) [BEZ DATY]
- [TradeZella: nowe ceny](https://www.tradezella.com/blog/tradezella-pricing) (7.07.2026, aktualizacja 14.07.2026)
- [TradeZella: AI journal i agenci](https://www.tradezella.com/blog/ai-trading-journal-how-ai-replaces-manual-logging) [BEZ DATY]
- [TradeZella: Zella Score (help center)](https://help.tradezella.com/en/articles/10305642-introducing-the-all-new-zella-score) [BEZ DATY]
- [TradeZella: Trade Replay vs backtesting (help center)](https://help.tradezella.com/en/articles/11787298-what-is-the-trade-replay-feature-in-tradezella-and-how-does-it-compare-to-backtesting) [BEZ DATY]
- [TradeZella: przegląd tygodnia](https://www.tradezella.com/blog/weekly-trade-review-process) (2.04.2026)
- [TradeZella: dziennik prop](https://www.tradezella.com/blog/prop-firm-trading-journal) (13.04.2026)
- [Edgewonk: strona główna](https://edgewonk.com/) [BEZ DATY]
- [Edgewonk: cennik](https://edgewonk.com/pricing) [BEZ DATY]
- [Edgewonk: funkcje](https://edgewonk.com/features) [BEZ DATY]
- [TradesViz: cennik](https://www.tradesviz.com/pricing/) [BEZ DATY]
- [TradesViz: MCP i API](https://www.tradesviz.com/trading-journal-api-mcp/) [BEZ DATY]
- [TradesViz: prop firm compliance](https://www.tradesviz.com/blog/prop-firm-compliance-tracking/) (6.04.2026, aktualizacja 23.06.2026)
- [TradesViz: replay](https://tradesviz.com/trade-replay/) [BEZ DATY]
- [TradesViz: porównanie](https://www.tradesviz.com/trading-journal-comparison/) [BEZ DATY]
- [FX Replay: poradnik dziennika](https://fxreplay.com/learn/step-by-step-guide-to-creating-a-winning-journal-in-fx-replay) (4.06.2026)
- [Tradervue: blog 7 najlepszych](https://www.tradervue.com/blog/best-trading-journal) (daty niezgodne: 7.10.2026 w metadanych, 6.03.2026 w stopce). Blog producenta.

Recenzje i porównania (wszystkie z interesem komercyjnym, jeśli nie napisano inaczej):
- [DayTradingToolkit: Tradervue](https://daytradingtoolkit.com/reviews/tradervue-review) (aktualizacja 24.09.2026, afiliacje innych firm)
- [DayTradingToolkit: TraderSync](https://daytradingtoolkit.com/reviews/tradersync-review) (aktualizacja 24.09.2026, link afiliacyjny)
- [Tradeify: najlepsze dzienniki dla prop](https://tradeify.co/post/best-trading-journals-2026) (aktualizacja 20.05.2026, blog prop firmy promujący własne narzędzie)
- [CernoQuant: alternatywy](https://cernoquant.com/blog/trading-journal-alternatives) (25.09.2026, marketing narzędzia pod rynek indyjski, oceny konkurentów jednostronne)
- [Trader's Second Brain: recenzja TradeZelli](https://traderssecondbrain.com/guides/tradezella-review) (22.09.2026, autor deklaruje własny produkt konkurencyjny)
- [Trustpilot: TradeZella 1*](https://www.trustpilot.com/review/tradezella.com?stars=1) (recenzje z lat 2024-2026, dostęp 14.10.2026)
- [Kinfo (App Store)](https://apps.apple.com/app/id1220075825)
- [NexusFi: Chartlog](https://nexusfi.com/d/journals/chartlog/) (403, wykorzystano tylko wyniki wyszukiwania)

## Zapisane pliki

- r:\PROJEKTY\web_developer\projekty\trade-journal\docs\research\rynek.md
