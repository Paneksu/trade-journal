# Połączenia kont prop firm tylko do odczytu: research techniczny

Data odczytu: **2026-10-16**. Gałąź `feat/adr-v2`. Kontekst: `prop-presety.md` (9 firm, 28 programów). Zlecenie: funkcja „Połącz” przy liście firm, dziennik sam pobiera zlecenia, fills, pozycje, saldo i fazę konta.

## Jak czytać

- Poziomy dowodów: **PRZETESTOWANE** (widziałem na żywo; tu nic, bo nie logowałem się do żadnej platformy), **CZĘŚCIOWE** (oficjalna dokumentacja lub help center, ale pominięty kluczowy szczegół), **WYWNIOSKOWANE** (z forum, blogów, stron dziennika lub z zestawienia faktów), **LUKA** (nie znalazłem, nie zgaduję).
- Źródła oznaczone: [OFICJALNE] dokumentacja/help center firmy lub platformy, [FORUM] community.tradovate.com (użytkownicy, bez oznaczenia pracownika), [DZIENNIK] strona vendora dziennika (marketing własnego produktu), [BLOG] strony trzecie, często afiliacyjne.
- Nie było możliwości sprawdzenia żadnego z interfejsów na żywo (brak kont, brak kluczy). Wszystko poniżej to czytanie dokumentów.

## Najważniejszy wniosek (czytaj to, jeśli nic więcej)

**Żadna z sprawdzonych platform nie daje udokumentowanego, wymuszonego po stronie platformy poświadczenia „tylko do odczytu” dla konta prop.** To zmienia sposób, w jaki można spełnić wymóg użytkownika «nie może wykonywać żadnych czynności»:

| Platforma | Czy poświadczenie jest naprawdę tylko do odczytu | Dowód |
|---|---|---|
| Tradovate, klucz API (stary) | Tak, per kategoria (Denied/Read/Full), ale klucz tylko dla konta LIVE z saldem > $1000 i nie dla prop; poza tym wymaga hasła w żądaniu tokenu | CZĘŚCIOWE |
| Tradovate OAuth | **Nieudokumentowane.** Żadna dokumentacja nie pokazuje parametru `scope` | CZĘŚCIOWE |
| ProjectX / TopstepX | **Nie.** Klucz ma pełny dostęp handlowy do wszystkich kwalifikujących się kont | OFICJALNE |
| Rithmic | **Nie wiadomo.** Poświadczenie to login i hasło traderskie; nie znalazłem trybu view-only | LUKA |
| CQG, Volumetrica, DXtrade, WealthCharts | Brak publicznego API; tylko raport/eksport | LUKA / WYWNIOSKOWANE |

Konsekwencja: „tylko do odczytu” będzie w praktyce gwarantowane **warstwami po naszej stronie** (patrz „Architektura bezpieczeństwa”), a nie przez platformę. Tam, gdzie klucz daje pełne prawa handlowe (ProjectX, Rithmic), automatycznej integracji **nie robimy**: import CSV. Dopóki Tradovate nie potwierdzi zakresu OAuth na piśmie, nawet tam obietnica brzmi „my tylko czytamy”, nie „platforma nam nie pozwoli”.

---

## 1. Tradovate (priorytet)

### 1.1 Trzy drogi dostępu

| Droga | Kto może | Tylko do odczytu | Koszt | Dla kont prop | Dowód |
|---|---|---|---|---|---|
| **A. Klucz API użytkownika** (`accesstokenrequest`) | Konto LIVE, saldo > $1000, dodatek „API Access” | Tak: uprawnienia klucza per kategoria (m.in. Account Information, Positions, Orders, Contract Library), poziomy Denied/Read/Full; zmiana w Application Settings > API Access > Change Permissions | **$25/mies.** (dodatek) | **NIE.** Konta prop i evaluation wykluczone | Opłata i saldo: [FORUM] cytujące help center, strona `support.tradovate.com/s/article/Tradovate-API-Access` nie wczytała się (błąd CSS), więc CZĘŚCIOWE; wyłączenie prop: WYWNIOSKOWANE z [FORUM] + [BLOG]; uprawnienia: [FORUM] BWeis 2021-04-29, tekst potwierdza tylko „Denied”, resztę widać na obrazkach |
| **B. OAuth dla aplikacji zewnętrznych** | Aplikacje zatwierdzone w **NinjaTrader Ecosystem** (formalne podanie i przegląd); każdy użytkownik loguje się u Tradovate i zatwierdza | **Nieudokumentowane.** Brak parametru `scope` w URL autoryzacji i w żądaniu tokenu | Brak publicznego cennika. Subskrypcja $25/mies. sama nie daje poświadczeń; partnerstwo „fees involved” wg [FORUM] | Praktycznie tak: TradesViz, Tanto, TraderWaves łączą konta Tradeify, Lucid, MFFU, Apex, TPT przez OAuth (wg [DZIENNIK]) | [OFICJALNE] `docs.ninjatrader.com/api/oauth`; kolejne: e-mail Tradovate zacytowany na forum 2026-07-02 |
| **C. Partner API** (`partner.tradovate.com`) | Zarejestrowani partnerzy z Organization Admin, klucz + CID | Nie dotyczy | Nieznany | Dla firm prop jako organizacji (zakładają użytkowników, ryzyko), nie dla dziennika | [OFICJALNE] |

**Odpowiedź na pytanie „czy da się tylko do odczytu”:** dla konta LIVE tak (droga A, ale patrz 1.2), dla konta prop **tylko jeśli** Ecosystem OAuth faktycznie ogranicza uprawnienia aplikacji. Nie wiem, czy ogranicza. TradesViz pisze „approve read-only access”, TraderWaves pisze „approve TraderWaves scopes”, ale żaden nie podaje nazw zakresów (CZĘŚCIOWE, [DZIENNIK]). **To jest pytanie do Tradovate/NinjaTrader w podaniu Ecosystem** (lista pytań niżej).

Wyjątek, który wynika z tego, że nasz użytkownik to jedna osoba: forum (Frik, 2025-04-28) twierdzi, że poświadczenia kont prop „nie są oparte na OAuth”, a użytkownik z własnym kontem TOV może wybrać logowanie Google OAuth. To sprzeczne z deklaracjami dzienników, że łączą konta prop. Rozstrzygnie to tylko próba na koncie Szymona. **WYWNIOSKOWANE, niepotwierdzone.**

### 1.2 Wada drogi A, nawet dla konta live

`POST /auth/accesstokenrequest` przyjmuje **nazwę użytkownika i hasło** plus `appId`, `appVersion`, `cid`, `sec` (partner.tradovate.com, auth overview, [OFICJALNE]). Czyli klucz API „tylko do odczytu” i tak wymaga przechowywania hasła Tradovate. To sprzeczne z zasadą „nie przechowujemy haseł”. Droga A odpada jako integracja produktowa. Uwaga: ten opis pochodzi z dokumentacji Partner API; publiczna dokumentacja `api.tradovate.com` nie wczytała się (SPA), więc to CZĘŚCIOWE dla zwykłego użytkownika.

### 1.3 OAuth: flow, czasy życia

[OFICJALNE] `docs.ninjatrader.com/api/oauth` i `partner.tradovate.com/api/rest-api-endpoints/authentication/o-auth-token`:

1. Przekierowanie na `https://trader.tradovate.com/oauth` (demo: `https://trader.devel.ninjatrader.dev/oauth`) z `response_type=code`, `client_id`, `redirect_uri`. Użytkownik loguje się u Tradovate (hasło nigdy u nas).
2. Powrót na zarejestrowany `redirect_uri` z jednorazowym `code`.
3. `POST https://live.tradovateapi.com/auth/oauthtoken` (form: `grant_type=authorization_code`, `client_id`, `client_secret`, `redirect_uri`, `code`).
4. Odpowiedź: `access_token`, `expires_in` (przykład 3600), `refresh_token`, `refresh_token_expires_in` (przykład 1209600, jednostka nie podana, jeśli sekundy to 14 dni), `id_token`.
5. PKCE: pole `code_verifier` istnieje w żądaniu, ale strona go nie opisuje. Odświeżanie: pole `refresh_token` jest, procedura nieopisana. Odwołanie dostępu: nieopisane.

Niezgodność: prozą host wymiany to `live-api-d.tradovate.com`, w kodzie przykładu `live.tradovateapi.com`. Przykładowe repo OAuth na forum bywa zgłaszane jako nieaktualne (undated) [FORUM]. Przy implementacji użyć dokumentacji, nie repo.

Tokeny dostępu do żądań klasycznych: 80 minut (Partner) lub około 90 minut (NinjaTrader docs), odnawianie `renewAccessToken` około 15 minut przed wygaśnięciem. Niespójność 80/90, nieistotna dla projektu (czytamy `expirationTime`).

### 1.4 Endpointy do pobrania danych konta

Z indeksu dokumentacji Partner API (`partner.tradovate.com/llms.txt`, [OFICJALNE]), zakładam to samo REST dla zwykłych użytkowników (WYWNIOSKOWANE):

| Potrzeba | Endpoint |
|---|---|
| Lista kont | `/account/list`, `/account/find` |
| Fills | `/fill/list`, `/fill/ldeps`, `/fill/find`; prowizje: `/fillFee/list`; pary wejście/wyjście: `/fillPair/list` |
| Zlecenia | `/order/list`, `/order/ldeps`, `/orderStrategy/...` |
| Pozycje | `/position/list`, `/position/find` |
| Saldo | `/cashBalance/list`, `/cashBalance/getcashbalancesnapshot`, `/cashBalance/...log` |
| Kontrakty | `/contract/...` (Contract Library, potrzebne do symbolu i wartości punktu) |

Do dziennika wystarczy REST; **WebSocket i market data nie są potrzebne**. Market data wymaga osobnej umowy z CME (sub-vendor; kwoty $290 do $500/mies. wg [FORUM] 2022 i [BLOG] 2026, nieoficjalne). Do dziennika nie wchodzimy w to.

Wyjątek: prowizje. TradeZella pisze, że Tradovate **nie zwraca prowizji w danych** (CZĘŚCIOWE, [DZIENNIK]). Endpoint `fillFee` istnieje w dokumentacji Partner API; czy działa dla OAuth, LUKA. Ewentualnie prowizje z reguł firmy (stała kwota na kontrakt).

### 1.5 Limity

[OFICJALNE] Partner API, `rate-limits`: użytkownik zalogowany 5000/godz., 5000/min, 5000/s; `accesstokenrequest` 5/godz. (tylko nieudane) z back-offem 15 s; limity per IP. Odpowiedź z `p-ticket`/`p-time`, a przy `p-captcha=true` nie da się ponowić z aplikacji zewnętrznej. HTTP 429: czekać godzinę. Dla odczytu raz na kilka minut (pollowanie) to nieistotne.

**Ryzyko praktyczne (ważniejsze niż limity):** NinjaTrader docs: **maks. dwie równoległe sesje na użytkownika, trzecia zamyka najstarszą**, oraz jedno jednoczesne połączenie klienta na klienta [OFICJALNE]. Nasze logowanie może wyrzucić Szymona z jego platformy w trakcie sesji handlowej. Trzeba to sprawdzić na jego koncie przed wdrożeniem; OAuth może liczyć się inaczej niż `accesstokenrequest`, tego nie wiem (LUKA).

### 1.6 Regulamin

- **NinjaTrader API License Agreement** (oznaczona „September 2026”, [OFICJALNE]): licencja ograniczona, odwołalna. Sekcja 2: nie wolno „access or control customer accounts or act on a customer's behalf”; wymagane szyfrowanie przechowywanych poświadczeń. Sekcja 3: **zbuforowana zawartość NinjaTrader trzeba usunąć lub odświeżyć w ciągu 24 godzin od pobrania**. Wypowiedzenie: natychmiast za naruszenie, 30 dni bez powodu.
- Umowa jest pisana pod partnerów „order entry software”, a nie wprost pod dziennik tylko do odczytu. Czy „NinjaTrader Content” obejmuje własne fills użytkownika (czy tylko dane rynkowe), umowa tego nie rozstrzyga w przeczytanym streszczeniu. Dzienniki typu TradesViz trzymają historię trwale, więc w praktyce zakładają, że nie. **WYWNIOSKOWANE, wymaga pytania do Tradovate przed budową, bo może zabić model „przechowujemy historię”.**
- Czy wolno użyć API do **własnego** dziennika jednego użytkownika: dokumentacja nie mówi nic wprost. Ścieżka OAuth wymaga zatwierdzenia przez Ecosystem, więc to Tradovate decyduje, nie regulamin.

---

## 2. ProjectX / TopstepX Gateway API

- **Klucz:** generowany w TopstepX: Settings > API > „Add API Key” po wykupieniu subskrypcji w ProjectX Dashboard. [OFICJALNE] `help.topstep.com/en/articles/11187768` (bez daty: „Updated over a month ago”).
- **Koszt:** **$29/mies.**, z kodem „topstep” $14.50. Rozliczenie osobno (Sim2Funded Solutions).
- **Uprawnienia:** „Your API key grants full trading access to every eligible account under your profile.” Brak trybu read-only: „The article does not describe a read-only API key”; dokumentacja ProjectX o uprawnieniach tokenu milczy [OFICJALNE]. **Nie ma tu odczytu tylko do odczytu na poziomie poświadczenia.**
- **Token sesji:** po `POST /api/Auth/loginKey` ważny 24 godziny, `Validate Session` odnawia; ten sam token dla REST i huba realtime. Limit: 200 żądań/60 s (historia świec 50/30 s) [OFICJALNE].
- **Co mówi Topstep o serwerach:** zakaz VPS/VPN/zdalnych serwerów dla **składania zleceń**. Dopuszczone: „A private server may be used for non-order work, such as storage, logging, or a read-only dashboard. The line is order transmission: your server can watch and record, but it cannot trade.” [OFICJALNE]. To zgodne z dziennikiem, ale nasz serwer trzymałby klucz z pełnymi prawami handlowymi.
- **Konta Live Funded nie handlują przez ProjectX API** („API is for the simulated environment”) [OFICJALNE]. Czyli dane Live Funded z API nie pobierzemy.
- **Kto korzysta:** po lutym 2026 wg kilku [BLOG] ProjectX został praktycznie wyłącznie dla Topstep (TraderSpost wrzesień 2026 wymienia TopstepX i The Futures Desk). Lucid, Alpha, Bulenox, Tradeify wypadły z ProjectX. Źródła blogowe, ale zgodne z oficjalnymi listami platform Lucid, Tradeify i Alpha (patrz sekcja 5).
- **Dzienniki:** TradeZella (art. z 2026-02-24), TradesViz i Tanto łączą TopstepX przez nazwę użytkownika i klucz API (płatna subskrypcja po stronie użytkownika). TraderSync, Trademetria, Edgewonk: tylko import plików [BLOG, Tanto, 2026-10-11, vendor konkurencyjny].
- **Eksport bez klucza:** TopstepX, zakładka „Trades”, przycisk Export (dolny prawy róg), zakres dat, CSV [BLOG, TradeZella help; oficjalnego artykułu Topstep nie znalazłem]. Importować z „Trades”, nie z „Orders”.

**Decyzja wynikająca z wymogu użytkownika: NIE integrujemy ProjectX automatycznie.** Klucz ma prawa handlowe na koncie funded; wyciek z naszej bazy = możliwość handlu na kontach użytkownika.

---

## 3. Rithmic (R|Protocol, R|API)

- **Poświadczenie:** zwykły login traderski z „system name” (np. „Rithmic 01” dla brokerów, nazwa firmy dla prop). Nie znalazłem trybu view-only ani osobnego użytkownika tylko do odczytu (LUKA, nie wykluczam).
- **Dostęp do API:** włącza go **podmiot, który wydał ID użytkownika** (dla evaluation prop firma), nie platforma automatyzująca. Darmowe/trial ID nie działają [BLOG PickMyTrade, 2026-09-29; vendor automatyzacji, WYWNIOSKOWANE].
- **Koszt (przez brokera):** AMP: opcjonalnie $100/mies. za User ID + $25 opłata ID + $0.10 za kontrakt przy live [OFICJALNE, strona brokera AMP, bez daty, ostatni wpis 2025-06-30]. Prop firmy tego nie naliczają użytkownikowi w ten sam sposób, szczegóły LUKA.
- **Conformance:** forum EliteTrader sugeruje wymóg testu zgodności przed live; nie znalazłem oficjalnej strony Rithmic (rithmic.com/apis zwróciła tylko tytuł). **LUKA: czy pojedynczy developer ma realny dostęp.**
- **Dzienniki:** Tanto wprost: „stores your password because Rithmic requires credentials at each login”, szyfrowane at-rest [DZIENNIK]. TradesViz: login i hasło („never shared or stored” wg ich strony) [DZIENNIK]. Deltalytix: poświadczenia Rithmic w przeglądarce użytkownika [BLOG, dokumentacja strony trzeciej].
- **Konsekwencja:** każde automatyczne połączenie = zapisanie hasła, które jest pełnym poświadczeniem handlowym. Dla Szymona: **NIE integrujemy Rithmic automatycznie.** CSV: eksport z R|Trader (zawiera m.in. „Qty Filled” i „Order Number” po dodaniu kolumn) [DZIENNIK, TradesViz].
- Zastrzeżenie: R|Protocol wymaga podobno osobnej „API entitlement” u wydawcy ID, więc dla prop firm i tak może nie być dostępny nawet w razie decyzji o integracji.

---

## 4. NinjaTrader, CQG, Volumetrica, DXtrade, WealthCharts

| Platforma | Odczyt | Metoda | Dowód |
|---|---|---|---|
| NinjaTrader (konto Tradovate pod NT) | Tak, jako konto Tradovate (to samo OAuth/API NinjaTrader Brokerage). Dla konta Rithmic pod NT: jak Rithmic | OAuth lub CSV (Executions, Report, Statements > Fills) | [OFICJALNE] docs.ninjatrader.com; [DZIENNIK] TradesViz |
| CQG | Brak publicznego API dla użytkownika końcowego. W prop CQG to głównie **kanał danych** (Lucid, TPT), a zlecenia i tak idą przez Tradovate/Rithmic | Dane kont z platformy zleceń | [OFICJALNE] help center Lucid |
| Volumetrica (Deepchart, Quantower na Volumetrica Trading) | Nie znalazłem publicznego API. Wbudowany raport: Accounts > Report, zakres dat | Eksport z raportu / CSV | LUKA / WYWNIOSKOWANE, [BLOG] The Edge Funder |
| DXtrade | Brak oficjalnego API dla użytkownika; TradesViz: wklejanie HTML z Order History; TraderWaves reklamuje auto-sync dla wspieranych brokerów | HTML/CSV | [DZIENNIK] |
| WealthCharts | Brak publicznego API wg wyników; TradesViz: import plików | Eksport plików | LUKA |

W żadnym z nich nie znalazłem trybu read-only na poziomie poświadczenia (LUKA).

---

## 5. Mapowanie firm na platformy (stan 2026-10-16)

Zasada: platforma jest **zablokowana przy zakupie konta** (Apex, Alpha, Tradeify wg źródeł). Dlatego mapowanie jest na konto, nie na firmę. Użytkownik musi wskazać platformę w kreatorze „Połącz”.

| Firma | Platformy (z poziomem źródła) | Odczyt tylko do odczytu | Rekomendowana metoda |
|---|---|---|---|
| **Topstep** | Tylko TopstepX (ProjectX) [OFICJALNE, help center 2026-07-20] | Nie (klucz pełny, $29/mies., Live Funded nie przez API) | **Import CSV** („Trades” > Export). Auto: nie |
| **Apex** | Rithmic, Tradovate, WealthCharts [BLOG, 8.2026]; help center Apex 403 | Tradovate: OAuth (jeśli zakres ok); Rithmic: nie; WealthCharts: brak API | Tradovate: **Połącz przez OAuth**, o ile spełnione warunki z pyt. 1; Rithmic/WealthCharts: **import CSV** |
| **Tradeify** | Tradovate (+NinjaTrader, TradingView), Rithmic (+Tradesea, Quantower, Sierra Chart, R|Trader), WealthCharts [OFICJALNE, help Tradeify, 2026-08-05]. Wybór „brokera” przy checkout | Tradovate: OAuth; Rithmic: nie | Tradovate: **Połącz przez OAuth**; Rithmic/WealthCharts: **CSV** |
| **Lucid** | Kanał CQG: NinjaTrader, Tradovate, TradingView; kanał Rithmic: Quantower, Tradesea, MotiveWave, Sierra, Jigsaw, Bookmap, ATAS, R|Trader Pro, MultiCharts [OFICJALNE, „Updated this week”, bez daty]. ProjectX nie na liście | Tradovate: OAuth; Rithmic: nie | Tradovate: **Połącz przez OAuth**; reszta: **CSV** |
| **MyFundedFutures** | NinjaTrader, Hyperprop, Tradovate, TradingView, Quantower, Volumetrica, DeepChart/DeepDom, ATAS [OFICJALNE, help MFFU, „Updated over a week ago”]. Rithmic nie wymieniony | Tradovate: OAuth; reszta: brak API | Tradovate: **Połącz przez OAuth**; reszta: **CSV** |
| **Take Profit Trader** | Kanał CQG: TradingView, NinjaTrader, Tradovate; kanał Rithmic: Bookmap, MultiCharts, MotiveWave; Quantower [BLOG + wyniki wyszukiwania z oficjalnej tabeli; strona crunch.help dała 404 przy bezpośrednim odczycie] | Tradovate: OAuth; Rithmic: nie | Tradovate: **Połącz przez OAuth** (WYWNIOSKOWANE); reszta **CSV** |
| **Alpha Futures** | AlphaTrader (własna), TradingView (Plus500), WealthCharts, Deepchart (Volumetrica), Quantower (Volumetrica Trading) [OFICJALNE, help Alpha, „Updated over 2 weeks ago”]. **Tradovate i NinjaTrader wycofane 2026-07-12** wg wpisów firmy (alpha-futures.com/posts), konta migrowane na AlphaTrader; starsze strony nadal je wymieniają | Brak API dla użytkownika (nie znalazłem) | **Import CSV / brak** (LUKA: format eksportu AlphaTrader nie sprawdzony) |
| **Bulenox** | Rithmic (R|Trader Pro, NinjaTrader 8, Quantower, ATAS, Sierra Chart, MotiveWave) [BLOG, stan niepewny; TradesViz nadal oferuje Tradovate/NinjaTrader i Rithmic API]. ProjectX wycofany wg blogów | Rithmic: nie | **Import CSV** (eksport „Completed Orders” z R|Trader) |
| **Earn2Trade** | NinjaTrader, Tradovate, TradingView + inne („13 platform”) [BLOG propfirmmap 2026]; oficjalnej listy nie znalazłem | Zależy od platformy | Jeśli Tradovate: OAuth, inaczej **CSV**; do weryfikacji |
| **Własne konto Tradovate (live, Szymon)** | Tradovate | Klucz API z uprawnieniem Read (ale wymaga hasła) albo OAuth | OAuth |

Dodatkowe firmy „najpopularniejsze w 2026”: nie dodaję. Zgodnie z `prop-presety.md` rankingi nie dały dowodu popularności poza tymi dziewięcioma. Pozycja „Inna firma / dowolna platforma” z importem CSV pokrywa resztę bez ryzyka.

### Czy platforma pozwala odróżnić eval od funded?

- **Tradovate:** w odpowiedzi tokenu są flagi `hasLive`, `hasFunded` (NinjaTrader docs, [OFICJALNE]), ale dokumentacja nie mówi, co oznaczają, i dotyczą klienta, nie fazy prop. Faza prop (Combine/Express, Eval/PA) nie jest udokumentowana w żadnym endpointcie, który sprawdziłem.
- **ProjectX:** w przeczytanej dokumentacji nie ma pola fazy. Topstep rozróżnia Trading Combine, Express Funded i Live Funded w panelu, API tego nie opisuje w sprawdzonych stronach.
- **Rithmic:** nie sprawdzono, LUKA.
- **Wniosek:** fazę konta (eval/funded) **musi podać użytkownik**, ewentualnie wyprowadzić ze skojarzenia „konto → preset z `prop-presety.md`”. Heurystyka po nazwie konta (np. prefiksy) jest WYWNIOSKOWANA i nie powinna być jedynym źródłem.

### Drawdown, saldo i faza z paneli firm

- **Saldo** da się pobrać z Tradovate (`cashBalance`) i ProjectX (konta). Ale saldo w platformie nie musi zgadzać się z liczeniem reguł firmy: [BLOG damnpropfirms] ostrzega, że widok platformy ≠ silnik reguł. Drawdown liczy się z presetu i fills po naszej stronie, nie z platformy.
- **Własne API dashboardów firm** (Topstep, Apex i pozostałe): **nie znalazłem żadnego publicznego API** dashboardu z fazą, drawdown i saldem. Topstep ma tylko ProjectX Gateway. Oficjalnych eksportów z dashboardów firm (poza Trades CSV w TopstepX) nie potwierdziłem; Apex, Tradeify i TPT zwracają 403 dla odczytu automatycznego (`prop-presety.md`). LUKA.

---

## 6. Ryzyka

1. **Zakaz udostępniania logowania:** Topstep Terms of Use sekcja 8: dane logowania nie mogą być udostępniane osobom trzecim; konto osobiste; nadużycia = blokada transakcji bez uprzedzenia [OFICJALNE, wyniki wyszukiwania cytujące `topstep.com/terms-of-use`; pełnego tekstu nie czytałem]. Ten sam help center każe jednocześnie wpisywać klucze w narzędzia zewnętrzne (sprzeczność niewyjaśniona). Klucz ProjectX to w praktyce udostępnienie dostępu handlowego.
2. **Automatyzacja:** Apex User Agreement ponoć zakazuje automatycznego składania zleceń z wąskimi wyjątkami [BLOG PickMyTrade]; trzy blogi mówią trzy różne rzeczy o automatyzacji u Apex. Zakaz dotyczy **zleceń**. Czy zwykły odczyt przez OAuth jest naruszeniem, nie znalazłem żadnego oficjalnego zapisu, który to mówi, ani żadnego udokumentowanego przypadku bana za sam dziennik. Nie znaleziono ≠ bezpieczne (szukałem raz, jedno zapytanie).
3. **Egzekwowanie wobec narzędzi sync:** Tradesyncer wprowadza limity połączeń i zawieszenia kont, ale to copy trading, nie dziennik [BLOG]. Pokazuje, że firmy monitorują połączenia.
4. **Sesje Tradovate:** logowanie dziennika może wyrzucić trader (limit 2 sesji). Najwyższe ryzyko operacyjne.
5. **Zakaz VPS/VPN dla zleceń (Topstep):** nie dotyczy odczytu na prywatnym serwerze (jawnie dozwolone), ale IP serwera inne niż użytkownika = „nietypowe logowanie” (WYWNIOSKOWANE, brak dowodu na ban).
6. **Hasło lub klucz z pełnymi prawami w naszej bazie:** wyciek = ryzyko handlu na koncie funded i utraty wypłat. Dlatego ProjectX i Rithmic poza integracją automatyczną.
7. **Licencja NinjaTrader:** pytania o przechowywanie danych (24 h) i „act on a customer's behalf”; odwołanie licencji = utrata funkcji.
8. **Zmienność platform:** w 2026 wypadły z ProjectX cztery firmy, Alpha porzuciła Tradovate (lipiec). Lista „kto jest na czym” starzeje się w tygodniach; trzeba ją trzymać w konfiguracji z datą odczytu (jak preset reguł), nie w kodzie.
9. **Rozjazd deklaracji dzienników z dokumentacją:** „read-only” u TradesViz, Tanto i TraderWaves to deklaracje vendora; zakres nie jest nigdzie podany z nazwy. Nie traktować jako dowodu.

---

## 7. Jak robią to istniejące dzienniki

| Dziennik | Tradovate | Rithmic | ProjectX / TopstepX | Zabezpieczenia deklarowane | Dowód |
|---|---|---|---|---|---|
| **TradeZella** | Okno logowania Tradovate, 2FA; tutorial mówi o OAuth (niepotwierdzone w help center); Live/Demo; brak prowizji w danych | Plik (wg Tanto, zmieniane) | Nazwa użytkownika + klucz API (art. 2026-02-24); plik jako alternatywa; sync co 3 godz. wg Tanto | W help center brak informacji o bezpieczeństwie i read-only | [DZIENNIK] help.tradezella.com |
| **TradesViz** | OAuth (od 2022-08-22, uaktualniony 2026-05-25), wybór kont; wcześniej kod dostępu wklejany ręcznie; sync raz na dobę po 18:00 ET | „Rithmic API”, login i hasło; „never shared or stored” | Nazwa użytkownika + klucz API, 90 dni historii, raz na dobę | „NEVER write/execution permissions”, szyfrowanie in transit i at rest | [DZIENNIK] tradesviz.com |
| **Tanto** | OAuth, „password never touches our servers” | Hasło **przechowywane** (szyfrowane), strumień w czasie rzeczywistym | Klucz API, szyfrowany at-rest, nie dla frontendu | „Strictly read-only” | [DZIENNIK] tradetanto.com |
| **TraderWaves** | OAuth, bez klucza API, bez hasła w aplikacji | nie sprawdzono | nie sprawdzono | tokeny autoryzacji | [DZIENNIK] |
| **Edgewonk** | Import plików (auto tylko MT4/MT5) | Import plików | Import plików | brak (brak poświadczeń) | [BLOG] |
| **TraderSync** | Import plików (Topstep); Rithmic: wg jednej opinii import plików działa | j.w. | Plik | brak | [BLOG, Tanto 2026-10-11] |
| **Tradervue** | Import CSV (wpis o Rithmic R|Trader); TopstepX niepotwierdzone | CSV | CSV | brak | [BLOG] |

Wniosek: najpopularniejszy wzorzec to **Tradovate OAuth** (token, bez hasła) i **klucz API** dla ProjectX; **Rithmic jest jedynym przypadkiem, gdzie dzienniki trzymają hasło**. Dzienniki z najsłabszym zabezpieczeniem poświadczeń (Edgewonk, TraderSync, Tradervue) po prostu nie mają poświadczeń: tylko pliki.

---

## 8. Rekomendacja architektury bezpieczeństwa

### 8.1 Zasady

1. **Metody w kolejności preferencji:** (a) import CSV (zero poświadczeń); (b) OAuth Tradovate (token, bez hasła), po uzyskaniu potwierdzenia zakresu; (c) nic więcej. Metody z hasłem lub kluczem z prawami handlowymi (Rithmic, ProjectX): **nie w produkcie**.
2. **Domyślnie CSV.** Przycisk „Połącz” dla firmy bez bezpiecznej metody prowadzi do kroku „Importuj plik”, z instrukcją skąd pobrać eksport. Nie ukrywać tego: użytkownik ma widzieć, dlaczego (jedno zdanie: „platforma nie wydaje klucza tylko do odczytu”).
3. **Tryb własny jako opcja, nie standard** (do decyzji, patrz pytania): jeśli dziennik ma jednego użytkownika (Szymona), klucz ProjectX/OAuth trzymany w sekretach jego serwera jest innym ryzykiem niż w wielotenantowej bazie.

### 8.2 Co przechowywać

| Dane | Gdzie | Jak |
|---|---|---|
| Access token Tradovate (krótki) | Pamięć procesu pobierającego, ewentualnie szyfrowane pole z TTL | Nie logować, nie wysyłać do przeglądarki |
| Refresh token / dane autoryzacji OAuth | Tabela `broker_connections`, kolumna szyfrowana | Szyfrowanie aplikacyjne AES-256-GCM z kluczem danych na użytkownika, klucz główny (KEK) w sekrecie spoza bazy (np. Coolify secret), nigdy w repo |
| `client_id`, `client_secret` aplikacji | Zmienne środowiskowe serwera | Nigdy w kodzie przeglądarki ani w bazie |
| Pobrane dane (fills, zlecenia, pozycje, salda) | Tabele dziennika | Standardowy RLS; z oznaczeniem źródła (`source = 'tradovate_oauth'`) i datą pobrania |
| Metadane połączenia | Tabela | Platforma, ID konta (zamaskowane w UI), data autoryzacji, ostatni sync, status, **lista użytych endpointów** |

### 8.3 Czego nigdy

- Hasła Tradovate, Rithmic, Topstep ani żadnej platformy (ani szyfrowanych, ani w logach).
- Klucza API z prawami handlowymi (ProjectX) w bazie.
- Tokenów w localStorage, w zapytaniach URL, w logach, w Sentry, w błędach.
- Poświadczeń w replikach/backupach bez szyfrowania (backup bazy zawiera tylko tekst zaszyfrowany; klucz KEK osobno).
- Przyjmowania „SMS/2FA kodu” ani przechwytywania okna logowania (zakaz scrapowania i automatyzacji logowania: OAuth tylko przez oficjalne okno platformy, nie przez nasz formularz ani headless browser).
- Wywoływania jakiegokolwiek endpointu zmieniającego stan konta.

### 8.4 Gwarancja „tylko do odczytu” po naszej stronie

Skoro platforma jej nie wymusza, wymuszamy sami, warstwowo:

1. **Osobny moduł klienta (`lib/brokers/tradovate-readonly`)** z jedną funkcją HTTP, która sprawdza ścieżkę względem **białej listy** (np. `/account/list`, `/fill/list`, `/order/list`, `/position/list`, `/cashBalance/...`, `/contract/...`, `/auth/oauthtoken`, `/auth/renewaccesstoken`, `/auth/me`). Wszystko inne: wyjątek. Nie ma w kodzie żadnej ścieżki `/order/placeorder`, `/order/cancelorder`, `/order/modifyorder`, `/order/liquidateposition`, `/orderStrategy/start*`, `/account/delete*` itp.
2. **Test w CI**, który skanuje repo pod kątem czarnej listy ścieżek (powyżej) i oblewa build.
3. **Allow-list wychodzącego ruchu** (sieć kontenera): tylko hosty Tradovate/NinjaTrader (`live.tradovateapi.com`, `trader.tradovate.com` itd.), nic więcej z procesu pobierającego.
4. **Osobny proces/kontener roboczy** (worker) bez dostępu do reszty sekretów aplikacji; webowy proces nie widzi tokenów.
5. **Dziennik audytu** każdego żądania do platformy (ścieżka, metoda, status, czas; bez treści); widoczny dla użytkownika w „Połączenia”.
6. **Przycisk „Rozłącz”**: odwołanie dostępu u platformy tak, jak to możliwe (jeśli Tradovate nie dokumentuje odwołania: instrukcja dla użytkownika, gdzie cofnąć autoryzację), natychmiastowe usunięcie tokenu z bazy; wybór: zostawić pobrane dane czy skasować.
7. **Pytanie wprost do Tradovate** o zakres OAuth w podaniu Ecosystem. Dopiero odpowiedź zmienia wnioskowanie z „my tylko czytamy” na „platforma nam nie pozwoli”.

### 8.5 Zgodność z RODO i dane wrażliwe

Dane handlowe i salda to dane finansowe osoby. Dla jednego użytkownika (Szymon) RODO stosuje się inaczej niż dla wielu; jeśli produkt będzie dla innych, potrzebna `legal-compliance-pl` (retencja, usuwanie, podmioty przetwarzające, polityka). Poza zakresem tego raportu.

---

## 9. Lista pytań do użytkownika

**Decyzje klasy trzeciej (dotykają danych, pieniędzy, ryzyka dla kont):**

1. **Czy dziennik jest tylko dla Ciebie, czy będzie dla innych użytkowników?** Od tego zależy, czy podajemy podanie do Tradovate Ecosystem (wielu użytkowników) i czy tryb własny jest dopuszczalny.
2. **Jakie masz konta?** Firma, program, platforma (Tradovate przez firmę? NinjaTrader? Rithmic?), faza (eval/funded), czy masz też własne konto Tradovate live z saldem > $1000.
3. **Czy zgadzasz się, że ProjectX/TopstepX i Rithmic nie dostają automatycznej integracji, tylko import CSV?** Powód: klucz ProjectX i login Rithmic dają pełne prawa handlowe na koncie funded; w sprzeczności z wymogiem «nie może wykonywać żadnych czynności».
4. **Czy zaakceptujesz „obietnicę po naszej stronie” (biała lista endpointów, test CI, allow-list sieci) zamiast gwarancji platformy**, jeśli Tradovate nie potwierdzi zakresu tylko do odczytu? Jeśli nie, zostaje tylko import CSV wszędzie.
5. **Czy jesteś gotów złożyć podanie do NinjaTrader Ecosystem** (formalny przegląd, możliwe opłaty, czas oczekiwania nieznany)? To jedyna droga do OAuth Tradovate.
6. **Czy zgadzasz się na próbę na swoim koncie** (jeden test: OAuth na koncie prop, sprawdzenie czy 2 sesje wyrzucają Cię z platformy)? Bez niej decyzje o 1.1 i 1.5 zostają WYWNIOSKOWANE.

**Do Tradovate/NinjaTrader (w podaniu lub mailem):**

7. Jakie zakresy (scopes) przyznaje poświadczenie OAuth i czy da się ograniczyć do odczytu?
8. Czy OAuth działa dla kont prop firm (sim) pod organizacjami Apex, Tradeify, Lucid, MFFU, TPT?
9. Czy licencja pozwala trwale przechowywać fills/zlecenia użytkownika w dzienniku (wobec sekcji 3, 24 godziny)?
10. Czy sesja OAuth zalicza się do limitu dwóch sesji użytkownika?
11. Czy istnieje endpoint lub pole z fazą konta prop?

**Do firm prop (raz, na piśmie, przed pierwszym użyciem):**

12. Czy sam odczyt przez OAuth/API przez dziennik jest zgodny z regulaminem (Apex, Topstep, Tradeify)? Szczególnie bany za „nietypowe logowanie” z serwera.

**Do uzupełnienia przez Szymona:** format eksportu AlphaTrader i Earn2Trade, bo nie zdołałem ich sprawdzić.

---

## Wnioski dla projektu

**Standard (sprawdzone, mają wszystkie dzienniki):**
- Lista firm z przyciskiem „Połącz” plus **zawsze alternatywa „Importuj plik”**. Edgewonk, TraderSync i Tradervue żyją bez poświadczeń, więc brak auto-sync nie wygląda na amatorszczyznę, jeśli import działa dobrze.
- Przy Tradovate: OAuth, nigdy hasło. Przy ProjectX: dziennik wymaga osobnego płatnego klucza ($29/mies.), użytkownicy to znają.

**Modne (wchodzi do branży):**
- Sync w czasie rzeczywistym (Tanto: „fills appear within seconds”) i integracje z automatyczną kontrolą reguł. Droższe i bardziej ryzykowne; nie kopiujemy bez potrzeby: fills raz na kilka minut wystarczają, AI rozpoznaje trade po zamknięciu.

**Pierwsze zasady (czy konwencja jest słuszna dla TEGO klienta):**
- Branża zakłada Y: „zapisanie hasła lub klucza jest akceptowalne, bo vendor deklaruje read-only”. Dowód, że to nie jest zabezpieczenie: klucz ProjectX ma pełny dostęp, a Rithmic wymaga hasła traderskiego. Klient wprost napisał, że chroni przed „skasowaniem danych lub innymi działaniami” i że to dane wrażliwe. **Więc robimy Z: poświadczenie, które może handlować, w ogóle nie trafia do bazy.** Automatycznie łączymy tylko to, co nie daje prawa do zleceń (OAuth), a resztę przez import pliku. Gdzie dzienniki konkurencji mówią „połącz wszystko”, my mówimy otwarcie, które połączenia robimy i dlaczego pozostałych nie. To realna przewaga zaufania i spójna z wymogiem.

**Co przyjmujemy:**
1. Wspierane metody: `oauth_tradovate`, `csv_import`. `projectx_key` i `rithmic_login` oznaczone w kodzie jako „odrzucone, decyzja klasy 3, data”.
2. Faza konta (eval/funded) pochodzi od użytkownika i presetu, nie z API.
3. Drawdown i saldo reguł liczymy sami; saldo z platformy tylko do porównania.
4. Lista platform firm w konfiguracji z `read_on`, ostrzeżenie po 30 dniach (jak preset reguł).

**Co robimy inaczej:** przycisk „Połącz” otwiera kreator z platformą (nie samą firmą), bo ta sama firma ma kilka platform i kilka metod.

**Kolejność prac (wpływa na decyzje projektowe):**
1. Najpierw import CSV dla Tradovate, TopstepX i Rithmic (działa bez zgód, daje 100% pokrycia).
2. Równolegle podanie do Ecosystem i test OAuth na koncie Szymona.
3. Dopiero potem „Połącz” przez OAuth.

Jeśli OAuth odpada (brak zatwierdzenia, brak potwierdzenia zakresu), funkcja „Połącz” staje się „Importuj” i nadal spełnia wymóg użytkownika.

**Akcja pozyskania (zasada sesji planistycznej):** nie dotyczy, to research techniczny dziennika tradingowego, nie biznesu Szymona.

## Zapisane pliki

- R:\PROJEKTY\web_developer\projekty\trade-journal\docs\research\polaczenia-kont.md
