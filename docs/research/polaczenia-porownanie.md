# Połączenia kont prop z dziennikiem: pełne porównanie opcji i jak robi to TradeZella

Data odczytu: **2026-10-16**. Gałąź `feat/adr-v2`, bez commitu. Uzupełnia `polaczenia-kont.md` (dwie sekcje). Wnioski tamtych raportów nie są tu ograniczeniem; gdy je poprawiam, piszę to wprost w sekcji 7.

Zlecenie: słowa użytkownika: «Nie ograniczaj mojej wiedzy do tych kwestii. Właśnie poinformowano mnie, że Tradezilla ma inne rozwiązanie, które u nich działa, więc proszę o pełne porównanie oraz zestawienie najskuteczniejszych opcji, w tym Twojej rekomendacji i innych. Nie ograniczaj się na razie żadnymi ograniczeniami; napisz jedynie, jakie mogą być skutki. Jeśli firmy takie jak Tradezilla stosują to rozwiązanie, powinno być bezpieczne.»

## Jak czytać

- **PRZETESTOWANE**: widziałem na żywo. Tu nic: nie logowałem się do żadnej platformy ani dziennika.
- **OFICJALNE-CAŁOŚĆ**: przeczytałem całą stronę producenta (help center, dokumentacja). To najwyższy poziom, jaki tu osiągnąłem.
- **CZĘŚCIOWE**: oficjalne źródło, ale bez kluczowego szczegółu, albo tylko cytat z wyszukiwarki (strona nie dała się wczytać).
- **WYWNIOSKOWANE**: z faktów pośrednich. Zawsze opisane jako wniosek.
- **LUKA**: nie znalazłem, nie zgaduję.
- Źródła: [TZ-help] help.tradezella.com, [TZ-www] tradezella.com (marketing), [VENDOR] strona konkurencyjnego dziennika (marketing własnego produktu, drugorzędne), [FORUM] community.tradovate.com (użytkownicy, nie pracownicy, chyba że napisano inaczej), [BLOG] strony trzecie, często afiliacyjne. Reddit i YouTube: nie znalazłem żadnego wątku ani filmu, który wnosiłby coś ponad dokumentację; nie cytuję ich.
- Szacunki prawdopodobieństwa w sekcji skutków to **Szacunek:** mój osąd, nie dane.

---

## 0. Najważniejsze w sześciu zdaniach

1. **TradeZella nie ma żadnego „innego” sekretnego rozwiązania technicznego.** Używa zwykłych, publicznych dróg, osobnych dla każdej platformy: okno logowania Tradovate (wg ich bloga OAuth), klucz API ProjectX dla TopstepX, login i hasło Rithmic przez R|Protocol, login i hasło DXtrade, plik CSV dla reszty. Dane z brokera pobierają **co 3 godziny** (ręcznie co 15 minut), nie w czasie rzeczywistym [TZ-help].
2. **„PropFirm Sync” to nie połączenie z kontami prop.** To darmowy panel finansowy: opłaty za eval, resety, wypłaty i ROI, zasilany przez **bank/kartę przez Plaid** albo ręcznie. Wprost: „nie importuje historii transakcji” [TZ-help, 02.07.2026]. Jeśli ktoś Ci powiedział, że to jest ich rozwiązanie na łączenie kont prop, to pomyłka; prawdopodobnie chodzi o tę nazwę.
3. **Dla Twojego przypadku (Tradovate, konta prop) TradeZella robi to samo, co TradesViz, Tradecopia, Tradesyncer i TraderWaves: OAuth Tradovate.** Hasło zostaje u Tradovate, dziennik dostaje token. Różnica: oni mają zatwierdzenie w NinjaTrader Ecosystem (według relacji z forum Tradovate); Ty go na razie nie masz.
4. **Teza „skoro TradeZella tak robi, to bezpieczne” jest w połowie prawdziwa i źle ustawiona.** Bezpieczeństwo zależy od tego, **co dane poświadczenie pozwala zrobić** (zasięg szkody), a nie od tego, kto je trzyma. TradeZella robi jedne rzeczy bezpiecznie (OAuth Tradovate), a drugie ryzykownie (klucz ProjectX z prawami handlowymi, hasło Rithmic). Nie znalazłem u nich SOC 2, strony bezpieczeństwa ani opisu szyfrowania poświadczeń.
5. **Ranking dla Ciebie:** (1) własny OAuth Tradovate po zatwierdzeniu, (2) TradesViz jako pośrednik przez ich API tylko do odczytu na start, (3) wyciągi e-mail po teście, (4) odczyt panelu TradingView lokalnym agentem, (5) CSV jako zawsze działający zapas. Szczegóły w sekcji 6.
6. **Co zmienia moją wcześniejszą ocenę:** TradeZella od lipca 2026 łączy Rithmic automatycznie, a zakres OAuth Tradovate ma pośrednie wskazówki (kategorie uprawnień), choć nadal nie ma oficjalnej listy. Szczegóły w sekcji 7.

---

## 1. TradeZella: jak to dokładnie działa

### 1.1 Tabela metod per platforma

| Platforma | Metoda w TradeZella | Co użytkownik podaje | Dowód |
|---|---|---|---|
| **Tradovate** | „Auto Sync”: Add Trade, Add New Account, wybór Tradovate, Auto Sync, data startu (opcjonalna), **Live albo Demo**, Connect. Otwiera się **okno logowania Tradovate**, 2FA jeśli włączone | Dane wpisujesz **w oknie Tradovate**, nie u TradeZella. Konta prop zwykle trzeba wybrać jako **Demo** (patrz niżej) | OFICJALNE-CAŁOŚĆ [TZ-help art. 9557659, 01.03.2025]. Strona nie mówi „OAuth” ani „read-only”. Natomiast **blog TradeZella** (tutorial dla początkujących, 2026) wg cytatu z wyszukiwarki: „Tradovate/Webull/TD Ameritrade: These use OAuth connections. Click Connect, log into your brokerage in the popup window, and authorize read-only access.” Strona nie dała się wczytać (404), więc to CZĘŚCIOWE |
| **NinjaTrader** (konto NT Brokerage) | To samo okno Tradovate: „the Tradovate API is used for NinjaTrader accounts, as both operate under the same company” | NinjaTrader login w oknie Tradovate | OFICJALNE-CAŁOŚĆ [TZ-help art. 10254410, 01.03.2025] |
| **Rithmic R Trader** | „Auto Sync” przez **R\|Protocol API**: login, hasło i wybór „System” z listy (przykłady: Apex, TopstepTrader, Bulenox, Rithmic Paper Trading), „link all your accounts at once” | **Login i hasło Rithmic** wpisane u TradeZella | OFICJALNE-CAŁOŚĆ [TZ-help art. 16074943, **24.07.2026**]. Historia z synca: tylko **180 dni**; starsze przez CSV, najlepiej przed połączeniem |
| **TopstepX** | Auto Sync: **nazwa użytkownika + klucz API ProjectX** (płatna subskrypcja API u Topstep, osobno) | Klucz API | OFICJALNE-CAŁOŚĆ [TZ-help art. 13853592, 24.02.2026]. Brak informacji o bezpieczeństwie |
| **ProjectX (inne firmy)** | Tylko plik (eksport z zakładki Trades) | Plik | [TZ-help art. 11943188] CZĘŚCIOWE (cytat) oraz lista platform |
| **DXtrade** | Auto Sync: **e-mail i hasło DXtrade** + serwer (lub URL platformy) | Login i hasło | OFICJALNE-CAŁOŚĆ [TZ-help art. 9562973]. Brak informacji o bezpieczeństwie |
| **TradingView** | Tylko plik: eksport Order History z panelu (wszystkie kolumny) jako CSV; dla paper tradingu broker „Other” | Plik | [TZ-help art. 6992227] CZĘŚCIOWE (cytat) i lista platform |
| **CQG** | Tylko plik („CQG Desktop” na liście importów plikowych) | Plik | CZĘŚCIOWE (wynik wyszukiwania) |
| **Volumetrica**, **WealthCharts** | **Nie znalazłem żadnej wzmianki** | n/d | LUKA (nie ma ich na liście z art. 10055421 ani w wynikach) |
| **Plik dla każdej platformy** | „File Upload” CSV | Plik (np. Tradovate: eksport raportu zleceń z Orders) | [TZ-help art. 6472250] CZĘŚCIOWE |

**Wewnętrzna niespójność dokumentacji TradeZella (ważne przy cytowaniu):** oficjalna lista platform (art. 10055421, „Updated over 2 weeks ago”, bez daty) wciąż wpisuje **Rithmic R Trader i TopstepX jako „File Upload only”**, a osobne artykuły z 24.02.2026 (TopstepX) i 24.07.2026 (Rithmic) opisują auto-sync. Strona brokersupport także pokazuje Rithmic jako Auto Sync i File Upload, a ProjectX/TopstepX jako tylko plik. Najbardziej prawdopodobne wytłumaczenie (WYWNIOSKOWANE): lista nie nadąża za artykułami. Ufam artykułom o konkretnej metodzie, bo mają daty i kroki.

### 1.2 Prop firmy na Tradovate: co faktycznie się dzieje

- Konto prop na Tradovate to zwykle konto **demo** na poziomie brokera, nawet funded. Tradecopia (inny narzędzie, ale ten sam mechanizm OAuth) pisze wprost: „Prop firm accounts are almost always demo accounts at the broker level”, wybiera się Demo, loguje **danymi Tradovate, nie portalu firmy**, a **jedno połączenie obejmuje wszystkie konta pod tą samą organizacją prop** [VENDOR/dokumentacja Tradecopia, „Updated this week”, bez daty]. TradeZella ma w swoim artykule tę samą wskazówkę o pomyłkach Live/Demo.
- Oznacza to, że dla Tradovate **nie istnieje u TradeZelli osobna ścieżka „prop firm”**. Konta prop są zwykłymi kontami demo w tym samym OAuth. Strona TradeZelli dla prop traderów mówi tylko: „If we support the broker or platform your prop firm uses (like Tradovate, Rithmic, DXtrade, or TradeLocker), you can sync and journal your prop firm trades just like any other account.” [TZ-www, /solutions/prop-firm-traders]
- Prowizje: Tradovate **nie zwraca prowizji** w danych; TradeZella każe dodać je ręcznie albo ustawić domyślne reguły prowizji [TZ-help art. 9557659].

### 1.3 PropFirm Sync: czym jest, czym nie jest

[TZ-help art. 14499729, 09.04.2026; art. 15808935, 02.07.2026; TZ-www /prop-firm-sync] OFICJALNE-CAŁOŚĆ.

| Pytanie | Odpowiedź |
|---|---|
| Czy to dodatek płatny? | **Nie.** „Completely free for all TradeZella users. No add-ons, no paywalls.” (Niektóre recenzje afiliacyjne mówią co innego; oficjalne strony mówią: za darmo) |
| Skąd bierze dane? | **Bank lub karta przez Plaid** („Connect your bank or credit card via Plaid”). Skanuje historię transakcji i kategoryzuje płatności prop firm i wypłaty. Tryb w pełni ręczny też jest |
| Czy importuje transakcje (fills)? | **Nie.** „It connects to your bank (via Plaid), not to your trading platform, so it does not import your trade history.” |
| Czy to partnerstwo z firmami prop, feed danych od firm? | **Nie ma na to dowodu.** Automatyczne wykrywanie obejmuje 10 firm (TopStep, Apex, Tradeify, Take Profit Trader, Bulenox, Top One Futures, MFF, FundedNext, Alpha Futures, Lucid), ale przez transakcje bankowe. Obsługiwane metody wypłat: Wise i WorkMarket |
| Co śledzi poza finansami? | Marketing: „monitors your drawdown, daily loss limits, and challenge progress” i „Monitor your challenge drawdown in real time”. Źródło danych o drawdownie nie jest podane, a artykuł z 02.07.2026 **nie potwierdza** drawdownu na żywo (nie wspomina o nim). Wnioskuję (WYWNIOSKOWANE), że drawdown liczą z zaimportowanych transakcji, jak każdy dziennik, a nie z feedu firmy |
| Bezpieczeństwo | Tylko „Powered by Plaid” / „Secured transaction sync via Plaid”. Plaid ma raport SOC 2 Type II i ISO 27001/27701 [Plaid, blog], ale to dotyczy Plaid, nie TradeZelli |

**Wniosek dla projektu:** PropFirm Sync nie jest wzorem połączenia z kontem tradingowym. Może natomiast być wzorem na **osobną, tanią funkcję**: śledzenie kosztów i wypłat (bank/CSV z banku). To odrębna decyzja i inne dane (nie dotyczy trade'ów).

### 1.4 Częstotliwość

- „TradeZella supports same-day trade imports for synced brokers”; konta odświeżają się **automatycznie co 3 godziny**; ręczny re-sync **co 15 minut** [TZ-help art. 8542897] OFICJALNE-CAŁOŚĆ (bez daty, brak listy brokerów, którzy to obsługują).
- Tanto (konkurent) zarzuca TradeZelli „co 3 godziny” i reklamuje własne „w ciągu sekund” [VENDOR, 11.10.2026]. Zgodne z oficjalnym artykułem.
- **Czas rzeczywisty: nie.** WYWNIOSKOWANE: cykl 3-godzinny wskazuje na pobieranie wsadowe, a nie stałe połączenie. To dobra wiadomość dla limitu sesji Tradovate (patrz 3.2), ale to wniosek, nie dokumentacja.

### 1.5 Bezpieczeństwo i „read-only”: co deklaruje TradeZella

| Temat | Co znalazłem | Poziom |
|---|---|---|
| „Read-only” dla Tradovate | Tylko w blogu: „authorize read-only access” (cytat z wyszukiwarki). Help center o tym milczy | CZĘŚCIOWE |
| „Read-only” dla MetaTrader | Blog: hasło inwestora (investor password), „TradeZella can only access your trade data and account history. It cannot execute trades, modify orders, or withdraw money.” Ten sam blog: można spróbować zwykłego hasła, gdy inwestorskie nie zadziała | CZĘŚCIOWE [TZ-www, blog MT4/MT5] |
| Szyfrowanie | Polityka prywatności: wrażliwe informacje (np. dane transakcji) są „encrypted and transmitted to us in a secure way”, czyli mowa o **transmisji**. Szyfrowanie poświadczeń w spoczynku: **nie znalazłem** | CZĘŚCIOWE (cytat; sama strona nie dała się wczytać) |
| „100% secure” | Strony brokersupport, features, pricing: „we are 100% secure”. To slogan, bez opisu | OFICJALNE-CAŁOŚĆ (marketing) |
| SOC 2, pentest, strona zaufania | **Nie znalazłem** (dwa osobne wyszukiwania, w tym ograniczone do domeny tradezella.com). Nieznalezienie to nie dowód braku | LUKA |
| Sprzedaż danych | „does not sell or advertise your data” (kilka stron) | OFICJALNE-CAŁOŚĆ (marketing) |
| Incydenty | Nie znalazłem żadnego zgłoszonego wycieku TradeZelli (jedno wyszukiwanie) | LUKA, nie „brak” |
| Regulamin (odpowiedzialność, upoważnienie do dostępu) | Strona terms nie wczytała się | LUKA |

### 1.6 Aplikacja desktopowa, agent lokalny, rozszerzenie

Nie znalazłem żadnej aplikacji desktopowej, agenta ani rozszerzenia przeglądarki TradeZelli do pobierania danych z brokera. Wszystkie metody to: okno logowania w przeglądarce, login/hasło/klucz wpisane do ich formularza, albo plik. Wzmianka z tutorialu o NinjaTrader „export to a monitored location” (cytat z wyszukiwarki, niezgodny z artykułem pomocy, który mówi o Tradovate API) pozostaje CZĘŚCIOWA i niepotwierdzona. Publicznego API ani webhooka TradeZelli **nie znalazłem** (wyszukiwanie 16.10.2026; jedyny eksport to CSV z Trade Log, i ten CSV nie wraca do importu) [TZ-help art. 9725069]. Więc TradeZella nie może być **źródłem** dla naszego dziennika.

### 1.7 Co z tego wynika: „jak dokładnie to robią”, bez magii

TradeZella ma **pięć wzorców** zależnych od tego, co platforma udostępnia:

1. **Tradovate/NinjaTrader:** token po stronie Tradovate (okno logowania). To jedyny z ich wzorców, w którym dziennik **nie widzi hasła**.
2. **Rithmic:** hasło u nich. Konieczne, bo R|Protocol wymaga loginu i hasła przy każdym logowaniu (Tanto pisze to wprost, o sobie: „stores your password because Rithmic requires credentials at each login” [VENDOR]). Dla TradeZelli to WYWNIOSKOWANE: artykuł o przechowywaniu milczy, ale technicznie muszą trzymać hasło, skoro synchronizują co 3 godziny bez Ciebie.
3. **TopstepX/ProjectX:** klucz API z pełnymi prawami handlowymi (wg Topstep: „grants full trading access to every eligible account”). Ten klucz musi być u nich w bazie, żeby synchronizować co 3 godziny (WYWNIOSKOWANE).
4. **DXtrade:** e-mail i hasło.
5. **Wszystko inne:** plik.

Dostęp jest możliwy, bo to **umowy i formalności**: Tradovate wydaje poświadczenia OAuth zatwierdzonym członkom NinjaTrader Ecosystem [FORUM, relacja z maila Tradovate, 02.07.2026], Rithmic wymaga włączenia API przez wydawcę ID (firmę prop), TopstepX wymaga płatnej subskrypcji API u użytkownika. To nie jest technologia, której nie mamy; to bramki biznesowe.

---

## 2. Inne dzienniki, krótko

Źródła to głównie strony samych dzienników [VENDOR], więc traktować jako deklaracje. Daty: z samych stron.

| Dziennik | Tradovate (prop = Demo) | Rithmic | TopstepX/ProjectX | Częstotliwość | „Read-only” | Dowód |
|---|---|---|---|---|---|---|
| **TradeZella** | okno Tradovate (wg bloga OAuth) | login+hasło, R\|Protocol, od 07.2026, 180 dni | nazwa + klucz API ($ osobno u Topstep) | 3 h, ręcznie co 15 min | bloga: tak dla Tradovate; reszta bez deklaracji | sekcja 1 |
| **TradesViz** | OAuth, wybór kont, „only requests read-only permissions”; strona: „all Tradovate-based prop firms”; wpis aktualizowany 25.05.2026 | „Rithmic API”: login/hasło „never shared or stored” | nazwa + klucz API, 90 dni | raz na dobę po 18:00 ET, ręcznie w każdej chwili | „We NEVER have any write/execution permissions” | tradesviz.com/brokers/Tradovate i /Topstep Prop Firm |
| **TradesViz, rozszerzenie TradingView** | scraping zakładki History w TradingView przez rozszerzenie Chrome/Firefox, ręczne klikanie „Sync”, aktualizacja 25.08.2026, „not endorsed by TradingView” | n/d | n/d | ręcznie | brak deklaracji | tradesviz.com/blog/auto-import-tradingview |
| **Tradervue** | lista brokerów zawiera Tradovate (futures), bez prowizji; czy to Broker Sync czy import, **LUKA** | CSV | LUKA | n/d | n/d | help.tradervue.com, CZĘŚCIOWE |
| **TraderSync** | wg jednej recenzji: auto dla Tradovate; Rithmic/ProjectX/TopstepX tylko plik (archiwum lipca 2026) | plik | plik | LUKA | LUKA | thegodfunded.com, [BLOG], CZĘŚCIOWE; strona TraderSync blokuje odczyt |
| **Edgewonk** | LUKA (strona importu wspomina „automated trade upload”, bez listy) | LUKA | LUKA | n/d | deklaruje niezależne testy penetracyjne (wg recenzji LuxAlgo) | CZĘŚCIOWE |
| **Tanto** (start 03.2026) | OAuth, „password never touches our servers” | login/hasło **przechowywane** (szyfrowane at-rest), strumień „w ciągu sekund”, 30 dni historii | klucz API, szyfrowany | sekundy | „strictly read-only” (deklaracja) | tradetanto.com, 11.10.2026 |
| **TraderWaves** | OAuth, „approve TraderWaves scopes”, hasło nie wpisywane w aplikacji; nazw zakresów nie podaje | LUKA | LUKA | LUKA | nie opisano jako read-only | traderwaves.com/help/tradovate-connection-guide, bez daty |
| **Deltalytix** (open source, TS, ~102 gwiazdki, ostatni push 04.05.2026) | OAuth 2.0, wg dokumentacji trzeciej strony „currently supports demo environment only”; sync ręczny | login/hasło; „stored locally in your browser” przy „Save for Next Login”; limit 2 synców na 15 minut | LUKA | ręcznie / „hourly” (sprzeczne) | dokumentacja milczy | mintlify.wiki/hugodemenez/deltalytix, CZĘŚCIOWE (mirror, nie repo) |
| **Journalytix** | **LUKA**: wskazany adres pomocy przekierował na inną firmę (Jigsaw) | LUKA | LUKA | LUKA | LUKA | brak |
| **Chartlog** | **LUKA**: nic nie znalazłem | | | | | brak |
| **CrossTrade Journal** | sweep nocny 17:00 do 18:00 ET, API zwraca tylko **fills bieżącej sesji**, opuszczony dzień trzeba dociągnąć z CSV; dla NinjaTrader 8: **lokalny dodatek NT8** | n/d | n/d | nocą | LUKA | crosstrade.io/docs/journal/importing-trades |
| **Tradesyncer** (kopiarka, nie dziennik) | OAuth, „does not store your credentials” | auto-sync Rithmic „coming soon” wg jednego źródła, w blogu z 13.04.2026 „real time” (sprzeczne) | n/d | n/d | kopiarka potrzebuje praw handlowych | help.tradesyncer.com |

**Co z tego wynika:** ten sam OAuth Tradovate stosuje co najmniej pięć niezależnych firm (TradeZella, TradesViz, Tanto, TraderWaves, Tradecopia, Tradesyncer). Różnią się tym, co robią z hasłem Rithmic i kluczem ProjectX.

---

## 3. Ścieżki B2B: czy dostępne dla jednej osoby

| Ścieżka | Kto korzysta | Dla jednej osoby | Dowód |
|---|---|---|---|
| **Tradovate OAuth przez NinjaTrader Ecosystem** | TradeZella, TradesViz, Tanto, TraderWaves, Kinfo i inne | **Prawdopodobnie tak, ale z podaniem.** Relacja z maila Tradovate (02.07.2026): poświadczenia „are issued only to approved members of the NinjaTrader Ecosystem following a review process”. Mali deweloperzy (TikiTrade, Kinfo, autorzy małych dzienników) działają w tym systemie, więc to nie jest tylko dla dużych. Opłata za podanie: **LUKA**. Czas: **LUKA**. Oficjalnej strony „zostań partnerem” **nie znalazłem** | [FORUM] wątki 12456 i 11941, relacje użytkowników, bez odpowiedzi pracownika; CZĘŚCIOWE |
| **Tradovate API wg subskrypcji** ($25/mies. + konto live >$1000) | pojedynczy programiści | Tak, ale **nie obejmuje kont prop** i **nie daje poświadczeń OAuth** (nawet z subskrypcją trzeba zatwierdzenia Ecosystem) | [FORUM] 2025 i 2026 (Frik, tikidave, Luke_Hanner), CZĘŚCIOWE |
| **Tradovate Partner API** (partner.tradovate.com, conformance) | **firmy prop** (Evaluation Service partners), nie dzienniki | **Nie.** Program zgodności dotyczy tworzenia użytkowników i kont, uprawnień handlowych, resetów | OFICJALNE-CAŁOŚĆ: partner.ninjatrader.com, „API Partner Conformance Program Overview” |
| **Rithmic R\|Protocol jako vendor** | TradeZella, Tanto, TradesViz | **LUKA.** Znalazłem tylko anegdotę z EliteTrader o teście zgodności i opłacie przez brokera AMP; oficjalnej strony Rithmic nie znalazłem. Dostęp do API dla konta prop włącza **wydawca ID**, czyli firma prop | [FORUM], CZĘŚCIOWE |
| **Rithmic Order Plant / PnL Plant tylko do odczytu** | n/d | **LUKA:** nie znalazłem żadnej dokumentacji o trybie odczytu. Architektura to cztery osobne „plants”, każdy z własnym logowaniem, ale to ta sama para login/hasło | [BLOG/biblioteki klienta], CZĘŚCIOWE |
| **ProjectX/TopstepX klucz** | TradeZella, TradesViz, Tanto | Tak, $29/mies. u Topstep. Klucz ma pełne prawa handlowe; nic o trybie odczytu | OFICJALNE (Topstep help, prior raport) |
| **CQG API** | n/d | **LUKA:** nie badałem głębiej; w prop CQG jest głównie kanałem danych, a TradeZella ma CQG tylko jako plik | CZĘŚCIOWE |
| **Bezpośrednie partnerstwa z firmami prop** | **Nie znalazłem dowodu**, że TradeZella ma feed danych od jakiejkolwiek firmy prop. „Prop Firm Sync” używa banków. Konta prop wchodzą przez platformy (Tradovate/Rithmic/…) | **Nie dotyczy** | sekcja 1.3 |

---

## 4. Pełna tabela opcji dla jednego tradera

Skala skutków: P (prawdopodobieństwo, **Szacunek:** niskie = mniej niż 5% w roku, średnie 5 do 25%, wysokie więcej). „Firmy” = jak ograniczają to firmy stosujące metodę, tylko jeśli mam dowód.

| # | Opcja | Jak działa | Czas rzecz. | Co przechować | Read-only: platforma czy kod | Koszt | Wysiłek (1 osoba) | Regulamin |
|---|---|---|---|---|---|---|---|---|
| **A** | **Tradovate OAuth, własna aplikacja** | Okno logowania Tradovate, kod, wymiana na token (access około 60 do 90 min, refresh), polling REST. Fills wg doświadczeń: tylko bieżąca sesja, więc trzeba **sweep nocny** | Nie (polling, minuty do godzin) | refresh token + client_id/secret | **Platforma, jeśli zakresy mają poziom Read** (patrz 5.1: wskazówki, bez dokumentacji); inaczej kod | Podanie Ecosystem: nieznany; subskrypcja $25 sama nie wystarcza | Średni: podanie + OAuth + sweep + odświeżanie | NinjaTrader API License: „September 2026”, zakaz „act on a customer's behalf”, **bufor treści do 24 h** (do wyjaśnienia) |
| **B** | **TradesViz jako pośrednik** (u nich OAuth Tradovate, u nas klucz API GET z zakresami `trades.read`, `executions.read`, `analytics.read`) | Podłączasz broker u TradesViz; nasz dziennik czyta ich API | Nie (sync raz na dobę po 18:00 ET, ręcznie dowolnie) | klucz API TradesViz | **Dwie warstwy:** broker→TradesViz OAuth „read-only permissions” (deklaracja); TradesViz→nas: klucz tylko GET, „cannot place, change or cancel” (deklaracja, wg wcześniejszego raportu) | Pro $14.99 do 19.99 / Platinum $22.49 do 29.99 mies. (rozbieżność, czy API jest we wszystkich planach, nie rozstrzygnięta) | Niski | Regulamin API TradesViz: LUKA |
| **C** | Klucz API Tradovate (login+hasło) | `accesstokenrequest` z nazwą użytkownika i **hasłem** + appId, cid, sec | Tak (WebSocket) | **hasło** Tradovate | Platforma (Denied/Read/Full per kategoria), ale **tylko konto live >$1000, nie prop** | $25/mies. | Średni | j.w. |
| **D** | Rithmic login+hasło (R\|Protocol) | Hasło u dziennika, połączenie WebSocket do plants | Tak | **hasło traderskie** | **Kod** (brak trybu read-only, LUKA) | brak lub opłata brokera ($100/mies. u AMP, dla tego brokera) | Wysoki: protokół Protobuf, zgodność, zgoda wydawcy | Zależy od firmy; API włącza wydawca |
| **E** | ProjectX/TopstepX klucz | Nazwa + klucz, REST/SignalR, token 24 h | Tak | **klucz z pełnymi prawami handlowymi** | **Kod** (klucz „full trading access”) | $29/mies. u Topstep | Niski do średni | Topstep: dane logowania nie mogą być udostępniane; serwer „może obserwować, nie może handlować” |
| **F** | DXtrade login+hasło | E-mail+hasło+serwer | LUKA | **hasło** | **Kod** | brak | Średni | LUKA |
| **G** | **Odczyt panelu TradingView przez CDP** (istniejący łącznik `tj`) | Lokalny skrypt czyta zakładki History/Account history z otwartego TradingView Desktop | Prawie (gdy TV otwarty) | nic poza zrzutem danych | **Kod** (ten sam port daje też klikanie) | 0 | Niski (już istnieje) | TradingView: zakaz „machine-driven” dotyczy danych rynkowych; o danych konta nic; autor narzędzia ostrzega o scrapingu. Prop/NT: LUKA |
| **H** | **Rozszerzenie przeglądarki** (cudze: TradesViz-TV, PropLedger, Tradelore; lub własne) | Skrypt czyta stronę zalogowaną (trader.tradovate.com lub TradingView w przeglądarce) | Półautomat (klikanie lub zdarzenia strony) | token rozszerzenia w przeglądarce | **Kod/uprawnienia rozszerzenia**; rozszerzenie z dostępem do strony brokera **widzi także przyciski zleceń** | 0 do kilkunastu USD | Niski (cudze) / średni (własne) | Rozszerzenia nie są oficjalnie związane z brokerem; PropLedger v1.0.1, 06.2026, Tradelore: tylko opis sklepu, nie czytałem (strona zgody Google) |
| **I** | **Dodatek NT8** (CrossTrade XT Add-On) | Lokalny dodatek NinjaTrader zapisuje wykonania i wysyła do usługi | Nocą | token usługi | Kod | wg planu CrossTrade | Niski | **Nie dla Ciebie:** handlujesz z TradingView, NT8 nie zobaczy fills |
| **J** | **Wyciąg e-mail** | Tradovate wysyła dzienny wyciąg PDF; reguła przekazuje na nasz adres | Nie (D+1) | brak dostępu do brokera | **Z konstrukcji** (brak kanału) | 0 | Średni (parser PDF) | Zależy od tego, czy konta prop w ogóle dostają wyciąg: **LUKA** |
| **K** | **CSV ręczny / okresowy eksport** | Eksport z Tradovate Orders+Cash History, TopstepX Trades, Rithmic „periodic csv export” | Nie | brak | **Z konstrukcji** | 0 | Niski | brak problemu |
| **L** | TradeZella jako źródło | n/d | n/d | n/d | n/d | n/d | **Niemożliwe:** brak API | n/d |
| **M** | Plaid/bank (jak PropFirm Sync) | Odczyt transakcji bankowych | Dziennie | token Plaid | Plaid: odczyt | Plaid płatny | Wysoki, **ale inne dane** (opłaty, wypłaty, nie fills) | Plaid: umowa |

### 4.1 Skutki (najgorszy scenariusz, P, ograniczenia u firm)

| # | Najgorszy scenariusz | P (Szacunek:) | Jak ograniczają firmy, które to stosują |
|---|---|---|---|
| **A** | Wyciek tokenu OAuth z naszej bazy. Jeśli zakres jest tylko Read: ktoś czyta Twoje fills i salda. Jeśli zakres obejmuje Orders Full: może składać zlecenia na koncie prop, co kończy się utratą konta i wypłat | Wyciek: niskie. Zakres z prawem zleceń: **nieznane** do czasu dokumentacji | Firmy trzymają tokeny zaszyfrowane, ale szczegóły nie są publiczne; TradeZella: LUKA. Tradesyncer i Tanto deklarują, że nie trzymają haseł. Zatwierdzenie Ecosystem to przegląd zewnętrzny |
| **B** | Wyciek klucza TradesViz: ktoś czyta Twoje wykonania (GET). Zlecenia niemożliwe po stronie API TradesViz. Ryzyko wtórne: wyciek u TradesViz lub nagłe zamknięcie usługi | Niskie | TradesViz deklaruje szyfrowanie in transit i at rest oraz brak uprawnień zapisu. To deklaracje; certyfikatów nie sprawdzałem |
| **C** | Wyciek hasła Tradovate: pełne przejęcie konta live | Niskie, szkoda wysoka | Dlatego dzienniki w ogóle nie używają tej drogi (OAuth zamiast niej) |
| **D** | Wyciek hasła Rithmic: pełne prawa handlowe na koncie funded | Niskie, szkoda wysoka | Tanto: szyfrowanie at-rest. TradesViz: „never shared or stored” (hasło wpisywane na żądanie). Deltalytix: w przeglądarce użytkownika |
| **E** | Wyciek klucza ProjectX: handel na wszystkich kwalifikujących się kontach | Niskie, szkoda wysoka | Tanto: szyfrowanie at-rest, klucz nie dla frontendu |
| **F** | Wyciek hasła DXtrade | Niskie, szkoda wysoka | LUKA |
| **G** | Port CDP daje dowolnemu lokalnemu procesowi sterowanie zalogowaną sesją (klikanie zleceń). Złośliwe oprogramowanie na komputerze mogłoby handlować. Zablokowanie zleceń w hooku to blokada po naszej stronie | Niskie, o ile port jest zamykany po odczycie | Nie dotyczy firm (nikt tej metody nie sprzedaje) |
| **H** | Złośliwe lub przejęte rozszerzenie czyta stronę brokera: sesję, ciasteczka, może klikać. Dla **cudzego** rozszerzenia: aktualizacja po stronie dewelopera może zmienić zachowanie | Średnie dla cudzego, niskie dla własnego z minimalnymi uprawnieniami | Sklepy rozszerzeń sprawdzają listing, ale nie gwarantują; brak niezależnych recenzji |
| **J** | Brak (nie ma kanału do konta). Skutek uboczny: PDF z danymi finansowymi trafia do skrzynki odbiorczej | Brak ryzyka handlowego | Nie dotyczy |
| **K** | Brak | Brak | Nie dotyczy |
| **M** | Plaid daje dostęp do **całego** konta bankowego do odczytu, nie tylko wpływów od prop firm. Wyciek tokenu = wgląd w finanse prywatne | Niskie | Plaid ma SOC 2 Type II i ISO 27001; po stronie aplikacji: LUKA |

---

## 5. Ocena tezy „jeśli TradeZella to stosuje, powinno być bezpieczne”

### 5.1 Werdykt: częściowo prawdziwa, błędnie ustawiona

1. **Jednostką oceny nie jest firma, tylko poświadczenie.** To samo TradeZella robi **trzy różne rzeczy** pod jedną marką:
   - Tradovate: token OAuth (hasło zostaje u Tradovate). To jedyna z ich dróg, która jest dobra niezależnie od jakości ich zabezpieczeń.
   - Rithmic, DXtrade, ProjectX: dziennik trzyma coś, co może handlować (hasło lub klucz z pełnymi prawami). Jeśli ta baza wycieknie, ofiary mogą handlować na kontach funded.
   Zatem „TradeZella tak robi” oznacza coś innego dla każdej platformy. Dla Tradovate to uspokajające. Dla ProjectX nie.
2. **Czy OAuth Tradovate faktycznie jest tylko do odczytu?** Nadal nie ma oficjalnej listy zakresów. Co się zmieniło od poprzedniego raportu:
   - Dla aplikacji Kinfo okno zgody pokazuje zakresy: Users, Orders, Accounting, Positions, ContractLibrary [FORUM, wątek 12607, 20.04.2026, relacja użytkownika]. To jest kategoria „Orders”, więc sama nazwa nie mówi o poziomie.
   - Tradovate API Support (relacja pośrednia) miało potwierdzić, że wystarczy „Account Information: Read Only” dla jednego endpointu [FORUM, 20.04 i 23.05.2026, CZĘŚCIOWE]. To sugeruje, że poziomy Read/Full istnieją w modelu uprawnień aplikacji, ale **nie dowodzi**, że OAuth dziennika dostaje tylko Read.
   - Dokumentacja endpointu `/auth/oauthtoken` nadal nie ma parametru `scope` [OFICJALNE-CAŁOŚĆ, partner.ninjatrader.com].
   Ocena: **brak dowodu zarówno na „tylko do odczytu”, jak i na „może składać zlecenia”.** Pytanie do Tradovate pozostaje otwarte (patrz sekcja 8).
3. **Co mają firmy takie jak TradeZella (z tego, co mogłem sprawdzić):** zatwierdzenie u dostawcy platformy (Ecosystem), zespół, kilkadziesiąt tysięcy użytkowników jako motywacja do dbania, dopracowane produkty. **Czego nie mogłem potwierdzić:** SOC 2, pentesty, strona bezpieczeństwa, opis szyfrowania poświadczeń w spoczynku, ubezpieczenie, plan reagowania na incydent. Dla TradeZelli publiczne deklaracje to: szyfrowanie w transmisji, „100% secure”, brak sprzedaży danych. To mało. (Edgewonk deklaruje niezależne pentesty wg recenzji, ale to jedna recenzja.)
4. **Incydenty:** nie znalazłem zgłoszonego wycieku w TradeZella, TradesViz, Tradervue, TraderSync ani Edgewonk (jedno wyszukiwanie, nie dowód braku). Najbliższy znany precedens to **3Commas, grudzień 2022**: wyciek bazy kluczy API (około 100 tys. kluczy Binance i KuCoin) z narzędzia, które trzymało klucze z prawami handlu; straty szacowane na ponad 20 mln USD (HAPI Labs: ponad 27 mln); firma najpierw zaprzeczała, potem potwierdziła; przyczyna nie została ostatecznie ustalona (phishing lub „inside job”) [Forklog, Halborn, The Block, Hackread; blogi i prasa kryptowalutowa]. To nie dziennik, ale ta sama klasa ryzyka: **przechowywany klucz z prawami zleceń**. Lekcja: nie wiadomość, że „duże narzędzie”, tylko że klucz może handlować.
5. **Co ma, a czego nie ma dziennik jednoosobowy:**
   - Nie ma: zespołu bezpieczeństwa, audytu SOC 2, pentestu, monitoringu 24/7, ubezpieczenia, planu reagowania, drugiej pary oczu na kod.
   - Ma: **jednego użytkownika i jedną bazę**, czyli mały „blast radius” (atakujący nie dostaje tysięcy kont, więc cel jest mało atrakcyjny); pełną kontrolę nad tym, co przechowuje (może nie przechowywać nic wrażliwego); brak potrzeby wielotenantowego RLS; własny serwer w jednej lokalizacji; brak dodatkowego pośrednika przetwarzającego dane.
   - Wniosek: jednoosobowy dziennik **nie musi dorównywać TradeZelli certyfikatami; musi unikać przechowywania rzeczy, które mogą handlować**. To jest strategia, w której mały dziennik może być bezpieczniejszy niż duży: duży przechowuje klucze z prawami handlu dla tysięcy ludzi, a Ty przechowujesz token tylko do odczytu albo nic.
6. **Dodatkowe ryzyka niezależne od metody**, które dotyczą wszystkich (wskazane w poprzednim raporcie, tu zostawiam skrót): limit dwóch sesji Tradovate, regulaminy firm prop, licencja NinjaTrader (24 h buforu). Jedno nowe z tego badania: **spór Alpha Futures z Tradovate/NinjaTrader** (pozew 24.07.2026, północny okręg Illinois, sygnatura 1:26-cv-08846; konta Alpha „zgasły” w weekend 10.07.2026, firma twierdzi, że Tradovate użył listy klientów) [BLOG fundedtrading.com, 08.08.2026, nie akt sądowy; twierdzenia nieudowodnione]. Znaczenie dla nas: **zależność od jednej platformy** to ryzyko biznesowe, a dostawca platformy bywa uczestnikiem rynku, nie tylko infrastrukturą. To argument za wymiennymi źródłami (jeden wlot z kilkoma kanałami), nie za żadną konkretną metodą.

### 5.2 Jak odpowiedzieć na tezę jednym zdaniem

„Jeśli to samo robi TradeZella przy Tradovate (token OAuth), to metoda jest akceptowalna, ale tylko przy tej platformie; przy ProjectX i Rithmic TradeZella przechowuje poświadczenia z prawami handlowymi, co jest ryzykiem, które firma ponosi, a Ty nie musisz powielać.”

---

## 6. Rekomendacja: ranking 3 do 5 opcji dla tego użytkownika

Kryteria: (1) ile szkody może zrobić poświadczenie, (2) czy działa stale bez Twojego klikania, (3) czy obejmuje konta prop na Tradovate (Twoje), (4) wysiłek jednej osoby, (5) zależność od zgód zewnętrznych. Zakładam: handlujesz na Tradovate przez TradingView Desktop, kilka kont prop, wcześniej wymóg «tylko odczyt», a teraz zgoda na rozważenie skutków.

| Miejsce | Opcja | Dlaczego | Warunek / ryzyko resztkowe |
|---|---|---|---|
| **1** | **A. Własny OAuth Tradovate (Ecosystem)** | Ta sama metoda, której używa pięć firm dla Tradovate; hasło nie trafia do dziennika; po zatwierdzeniu jedno stałe połączenie dla wszystkich kont pod organizacją prop. **Jedyna opcja, która może dać „platforma nam nie pozwoli”** (jeśli zakres to Read) i niezależność od pośrednika | Bramka: zatwierdzenie Ecosystem (nieznany czas i koszt) oraz odpowiedź Tradovate o zakresie. Do tego sweep nocny i kopia CSV na wypadek luk (fills tylko bieżącej sesji) |
| **2** | **B. TradesViz jako pośrednik (klucz API GET)** | **Działa od zaraz**, jeden wysiłek, nie wymaga zgody Tradovate (to ich ścieżka OAuth). U nas zostaje tylko klucz odczytu, nie poświadczenie brokera. Najmniejszy wysiłek wśród opcji automatycznych | Dane finansowe u trzeciej strony; sync raz na dobę; koszt; regulamin API nieprzeczytany; czy konta Twojej firmy prop są widoczne: sprawdzić próbą (strona mówi „all Tradovate-based prop firms”). **Uwaga:** to przenosi pytanie o zakres OAuth do TradesViz, a nie rozwiązuje go |
| **3** | **J. Wyciąg e-mail** | Brak kanału do brokera, więc brak czego przechwycić. Najbezpieczniejsza z konstrukcji | **Test jednego maila** rozstrzyga, czy konta prop w ogóle dostają wyciąg (LUKA). Opóźnienie D+1 |
| **4** | **G. Odczyt panelu TradingView przez CDP** | Widzi dokładnie to, na czym handlujesz; nie dodaje sesji ani logowania; już istnieje | Read-only tylko z kodu; port CDP otwarty = powierzchnia ataku; wymaga uruchomionego TradingView; ToS niejasny. **Włączane na żądanie**, nie stale |
| **5** | **K. CSV (ręczny / okresowy)** | Zero ryzyka, zawsze działa, pokrywa 100% platform. Zapas dla każdej innej opcji | Wymaga klikania; nie spełnia „stałego połączenia” samo |

**Czego nie rekomenduję (i dlaczego, bez wykluczania):** D, E, F (hasło lub klucz z prawami handlu u nas w bazie): TradeZella to robi, ale to właśnie ta klasa ryzyka, jaką pokazał 3Commas. Jeśli kiedyś potrzebne dla TopstepX lub Rithmic, rozwiązanie pośrednie to **klucz wpisywany na żądanie, nigdy zapisywany** (jak deklaruje TradesViz dla Rithmic), albo CSV. C odpada, bo nie obejmuje kont prop. I: nie pasuje do TradingView. M: inne dane.

**Kolejność działań:** (1) w tym tygodniu: złożyć podanie Ecosystem i zadać pytania z sekcji 8 (to nic nie kosztuje i otwiera opcję 1); (2) równolegle: test B na jednym koncie (7-dniowy okres próbny TradesViz wg recenzji) i test J (przekazać jeden mail); (3) CSV jako zapas od pierwszego dnia (już w ADR-034 etap A).

**Zasada architektury (niezmienna niezależnie od metody):** jeden wlot z wymiennymi źródłami (`oauth_tradovate`, `tradesviz_api`, `email_statement`, `tradingview_panel`, `csv_import`), jak w poprzednim raporcie, sekcja U.9. Spór Alpha/Tradovate to dodatkowy argument.

---

## 7. Co zmienia poprzednie raporty (poprawki)

| Poprzednie twierdzenie (`polaczenia-kont.md`) | Teraz |
|---|---|
| TradeZella: Rithmic „plik (wg Tanto, zmieniane)” | **Poprawka:** od 07.2026 auto-sync przez R\|Protocol API z loginem i hasłem (art. z 24.07.2026), 180 dni historii. Lista platform w help center jest nieaktualna |
| TradeZella: sync co 3 godz. „wg Tanto” | **Potwierdzone w oficjalnym artykule** (art. 8542897): 3 godz., ręcznie co 15 min |
| TradeZella: „w help center brak informacji o bezpieczeństwie i read-only” | Nadal brak w help center; **pojawia się w blogu** („authorize read-only access”, tylko cytat) |
| Zakres OAuth Tradovate: „nieudokumentowany” | Nadal brak oficjalnej listy. Nowe: nazwy kategorii z okna zgody Kinfo oraz relacja o „Account Information: Read Only”. To wskazówki, nie dowód |
| OAuth dla kont prop: wątpliwość (Frik 2025) | Tradecopia i TradesViz opisują wybór **Demo** i konta prop; jedno połączenie na organizację. Zgodne z deklaracją dzienników. Nadal bez próby na koncie Szymona |
| Historia fills przez OAuth | **Nowe ryzyko:** raport z forum (kwiecień 2026) o pustych tablicach `fill/list` i `order/list` pod OAuth mimo działających `position/list`; CrossTrade: API zwraca tylko fills bieżącej sesji, opuszczony dzień bywa niemożliwy do odzyskania. Wymaga sweepu nocnego i CSV jako zapasu. CZĘŚCIOWE |
| PropFirm Sync | Nie było w poprzednim raporcie; jest to panel finansowy przez Plaid |

---

## 8. Pytania i decyzje

### Do Tradovate/NinjaTrader (w podaniu Ecosystem lub e-mailem), skrócone do tego, co teraz najbardziej ważne

1. Jakie zakresy (scopes) i **jakie poziomy (Read/Full)** dostaje aplikacja OAuth i czy dziennik może dostać tylko Read? Czy użytkownik widzi te poziomy w oknie zgody?
2. Czy OAuth działa dla kont prop (demo, organizacje Apex, Tradeify, Lucid, MFFU, TPT)?
3. Czy `fill/list` i `order/list` zwracają historię pod OAuth, czy trzeba Reporting API (rpt-live)? Czy Reporting API przyjmuje token OAuth?
4. Czy wolno trwale przechowywać fills użytkownika (licencja, 24 h buforu)?
5. Czy sesja OAuth wlicza się w limit dwóch sesji?
6. Czy istnieje sposób odwołania dostępu przez użytkownika w ustawieniach Tradovate? (Nie znalazłem żadnej strony „autoryzowane aplikacje”; znalazłem endpoint `revokeTradingPermission` dla deweloperów.)
7. Opłaty i czas podania Ecosystem dla dziennika jednoosobowego.

### Do Ciebie (decyzje klasy trzeciej: pieniądze, dane, publikacja)

1. Czy składasz podanie do NinjaTrader Ecosystem (jedyna droga do opcji 1)?
2. Czy wolno zrobić **test pośrednika TradesViz** na jednym Twoim koncie (okres próbny; sync konta prop Tradovate i wystawienie klucza z zakresami odczytu)? Dotyczy zewnętrznego podmiotu przetwarzającego dane finansowe.
3. Czy przekazujesz jeden mail wyciągowy (dane osobowe usunięte), żeby sprawdzić opcję J?
4. Czy akceptujesz opcję G (CDP) tylko na żądanie? Decyzja z poprzedniego raportu pozostaje otwarta.
5. Czy chcesz osobną funkcję „koszty i wypłaty prop” (jak PropFirm Sync), czy zostaje poza zakresem? To nie jest połączenie z kontem tradingowym.
6. Czy opcje z poświadczeniem handlowym (hasło Rithmic, klucz ProjectX) zostają wykluczone, czy dopuszczasz je wyłącznie jako „wpisz na żądanie, nie zapisuj”?

Do uzupełnienia przez Szymona: czy konto prop w TradingView łączy się wyborem „NinjaTrader” (Demo) czy „Tradovate”; które firmy; czy w skrzynce są maile „statement”.

---

## Wnioski dla projektu

**Standard (mają wszyscy):** dla Tradovate token OAuth, nigdy hasło; zawsze alternatywa „Importuj plik”; auto-sync w cyklu godzin (TradeZella co 3 godz., TradesViz raz na dobę), nie w czasie rzeczywistym. Brak czasu rzeczywistego nie wygląda na amatorszczyznę.

**Modne:** sync „w ciągu sekund” (Tanto), API i MCP dla dzienników (TradesViz), panel kosztów i wypłat przez bank (TradeZella PropFirm Sync). Nie kopiujemy bez potrzeby.

**Pierwsze zasady:** branża zakłada Y: „przechowanie hasła lub klucza jest akceptowalne, bo dostawca deklaruje, że to read-only”. Dowód, że Y jest słabe: klucz ProjectX ma pełny dostęp handlowy według Topstep; Rithmic wymaga hasła traderskiego; 3Commas pokazał, że baza kluczy z prawem handlu to cel. Jedyny użytkownik tego dziennika (Ty) chroni konta funded i wypłaty. Więc robimy Z: **nic, co może handlować, nie trafia do bazy**; automat tylko tam, gdzie poświadczenie jest tokenem OAuth (po potwierdzeniu zakresu) lub kluczem GET u pośrednika; reszta plikiem lub wyciągiem.

**Przyjmujemy:**
1. Jeden wlot, wiele wymiennych źródeł; metody w konfiguracji z `read_on`, jak preset reguł.
2. Sweep nocny + CSV jako zapas (luka fills OAuth i ewentualne limity sesji).
3. Faza konta (eval/funded) nadal od użytkownika lub presetu, bo ani TradeZella, ani platformy jej nie podają jako danych (PropFirm Sync daje ją z banku, nie z platformy).

**Robimy inaczej niż TradeZella:** nie przechowujemy haseł ani kluczy z prawami handlu; nie obiecujemy „100% secure”, tylko opisujemy, **co poświadczenie może zrobić** i jak je odwołać.

**Akcja pozyskania:** nie dotyczy (research techniczny dziennika tradingowego, nie biznesu Szymona).

---

## Zapisane pliki

- R:\PROJEKTY\web_developer\projekty\trade-journal\docs\research\polaczenia-porownanie.md

## Źródła (linki, odczyt 16.10.2026)

Oficjalne (TradeZella):
- https://help.tradezella.com/en/articles/9557659-tradovate-how-to-sync-your-tradovate-account-with-tradezella (01.03.2025)
- https://help.tradezella.com/en/articles/10254410-ninjatrader-how-to-sync-your-ninjatrader-account-with-tradezella (01.03.2025)
- https://help.tradezella.com/en/articles/16074943-rithmic-r-trader-how-to-sync-your-rithmic-r-trader-account-with-tradezella (24.07.2026)
- https://help.tradezella.com/en/articles/13853592-topstepx-how-to-sync-your-topstepx-account-with-tradezella (24.02.2026)
- https://help.tradezella.com/en/articles/9562973-dxtrade-how-to-sync-your-dxtrade-account-with-tradezella
- https://help.tradezella.com/en/articles/10055421-list-of-supported-brokers-and-platforms (bez daty, „over 2 weeks ago”)
- https://help.tradezella.com/en/articles/8542897-broker-sync-same-day-trades (bez daty)
- https://help.tradezella.com/en/articles/14499729-what-is-propfirm-sync-tradezella-s-command-center-for-prop-firm-traders (09.04.2026)
- https://help.tradezella.com/en/articles/15808935-propfirm-sync-vs-importing-your-prop-firm-trades-what-s-the-difference (02.07.2026)
- https://www.tradezella.com/prop-firm-sync, /brokersupport, /integrations/tradovate, /solutions/prop-firm-traders (marketing, bez dat)
- https://www.tradezella.com/blog/tradezella-tutorial-beginners (wczytanie 404; tylko cytat z wyszukiwarki)
- https://app.tradezella.com/information/privacy (wczytanie nieudane; cytat z wyszukiwarki)

Tradovate / NinjaTrader:
- https://partner.ninjatrader.com/eval/overview/conformance-testing.md
- https://partner.ninjatrader.com/eval/api/rest-api-endpoints/authentication/o-auth-token.md
- https://community.tradovate.com/t/third-party-oauth-integration/12456
- https://community.tradovate.com/t/api-access-for-3rd-party-app-development/11941
- https://community.tradovate.com/t/how-to-retrieve-historical-fills-trades-via-oauth/12607
- https://community.tradovate.com/t/api-access-requirements/7769

Dzienniki i narzędzia (drugorzędne):
- https://www.tradesviz.com/brokers/Tradovate ; https://www.tradesviz.com/brokers/Topstep%20Prop%20Firm ; https://www.tradesviz.com/blog/auto-import-tradovate/ ; https://www.tradesviz.com/blog/auto-import-tradingview/
- https://tradetanto.com/learn/tradezella-alternative (11.10.2026)
- https://traderwaves.com/help/tradovate-connection-guide
- https://docs.tradecopia.com/en/articles/15515275-how-to-connect-your-tradovate-account-to-tradecopia
- https://help.tradesyncer.com/en/articles/11746822-how-to-add-a-tradovate-connection ; https://tradesyncer.com/blog/rithmic-trade-journal-sync (13.04.2026)
- https://crosstrade.io/docs/journal/importing-trades
- https://mintlify.wiki/hugodemenez/deltalytix/guides/broker-sync
- https://help.tradervue.com/article/4626-broker-sync-vs-standar-import
- Chrome Web Store: PropLedger (ibndoomcpdhidclabkehdikggnipopmc), Tradelore Connector (bcopokgnamoehjmmbcndggpkoobjdhbc), tylko opis z wyszukiwarki

Incydenty i kontekst:
- https://forklog.com/en/api-key-leaks-and-exchange-inaction-a-hapi-analysis-of-the-3commas-incident/ ; https://halborn.com/explained-the-3commas-breach-december-2022/ ; https://www.theblock.co/news/ecosystems/2022-12-28-binance-warns-about-3commas-api-leak-says-users-should-disable-keys
- https://fundedtrading.com/alpha-futures-tradovate-lawsuit/ (08.08.2026, blog)
- https://security.plaid.com/ ; https://plaid.com/blog/plaids-continued-investment-in-security-and-privacy-standards/
