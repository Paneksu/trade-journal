# Decyzje techniczne i świadome odstępstwa

Dokument opisuje wybory, które nie wynikają z kodu, oraz miejsca, w których
świadomie odeszliśmy od standardowej reguły. Każdy wpis ma datę.

---

## ADR-001 — stack (2026-08-21)

| Warstwa | Wybór | Dlaczego |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict | Aplikacja za logowaniem, ciężka w formularzach, tabelach i wykresach. Server Actions dają zapis bez osobnej warstwy API. Astro i czysty HTML odpadają — to aplikacja, nie strona. |
| Baza | PostgreSQL 17 | Statystyki to agregaty i funkcje okienkowe. JSONB obsługuje pola własne z indeksem GIN. |
| ORM | Drizzle + drizzle-kit | Typowane zapytania, migracje wersjonowane w repo, surowy SQL tam, gdzie potrzebny. |
| Autoryzacja | własna: scrypt + podpisane ciasteczko | Jeden użytkownik. Gotowa biblioteka byłaby cięższa od problemu. |
| UI | Tailwind v4 + własne tokeny | Zero gotowych bloków z rejestrów komponentów; cały wygląd wynika z jednego zestawu tokenów. |
| Tabela | TanStack Table v8 | Sortowanie, widoczność kolumn, zaznaczanie wierszy. |
| Wykresy | Recharts, ładowane leniwie | Kilka tysięcy punktów; cięższy silnik nie jest potrzebny. |

**Plan zakładał Next 15, powstało na Next 16.** `create-next-app` instaluje dziś wersję 16,
a cofanie się o major bez powodu byłoby gorsze niż różnice w API (`middleware` nazywa się
teraz `proxy`, API żądania są asynchroniczne). Uboczna korzyść: żadnych łatanych zależności
tranzytywnych, `npm audit` czysty.

**Supabase odrzucone.** RLS, realtime i storage nie są tu do niczego potrzebne, a instalacja
i utrzymanie są cięższe od problemu, który mieliśmy rozwiązać.

---

## ADR-002 — jednostki liczbowe (2026-08-21)

- **Kwoty w centach jako liczby całkowite.** Zmiennoprzecinkowe pieniądze prędzej czy
  później rozjeżdżają sumy.
- **Wartość ticku w tysięcznych dolara, nie w centach.** ZN ma tick 15,625 USD — w centach
  to nie jest liczba całkowita. Przy jednostce 1/1000 USD każdy kontrakt CME ma wartość
  całkowitą: NQ = 5000, ES = 12500, ZN = 15625.
- **Ruch ceny liczymy w tickach, nie w punktach.** Zaokrąglenie do pełnego ticku zdejmuje
  błąd zmiennoprzecinkowy raz, na wejściu, zamiast propagować go przez wszystkie statystyki.
- **R liczymy z wyniku, ryzyko z odległości do stopa.** Ryzyko to odległość do stopa razy
  wartość ticku; prowizja w modelu nie istnieje - patrz ADR-010.

---

## ADR-003 — kolumny wyliczane w bazie (2026-08-21)

Tabela `trades` przechowuje wyniki obliczeń: `ticks`, `pnl_net`, `r_multiple`, `duration_s`,
`market_session`, `weekday`, `trading_day`. To denormalizacja i jest świadoma: bez niej
sortowanie tabeli po R albo filtr „tylko stratne" wymagałyby przeliczania całej historii
przy każdym żądaniu.

Warunek, który to utrzymuje w ryzach: **jedynym miejscem, które je liczy, jest
`lib/domain/calc.ts`**. Zapis przechodzi zawsze przez `computeTrade`. Ten sam moduł liczy
podgląd w formularzu, więc rozjazd między tym, co widać przed zapisem, a tym, co ląduje
w bazie, jest niemożliwy bez zmiany testów.

---

## ADR-004 — pola własne w JSONB (2026-08-21)

Wartości pól własnych siedzą w jednej kolumnie `trades.custom` (JSONB, indeks GIN),
a definicje w tabeli `custom_fields`. Alternatywa — kolumna na pole albo tabela
klucz-wartość — dawałaby migrację przy każdym nowym polu albo zapytania nie do czytania.

Walidacja powstaje w locie z definicji (Zod budowany z listy pól), więc do bazy nie wejdzie
wartość spoza słownika ani liczba poza zakresem, mimo że schemat bazy o tych polach nie wie.

**Klucz pola powstaje raz, przy zakładaniu.** Późniejsza zmiana nazwy nie rusza klucza —
inaczej wartości zapisane przy istniejących trade'ach zostałyby osierocone.

---

## ADR-005 — hasło na scrypcie z `node:crypto` (2026-08-21)

Argon2id byłby odrobinę mocniejszy, ale wymaga binariów kompilowanych pod platformę,
co przy budowaniu obrazu w Coolify jest dodatkowym punktem awarii. Scrypt z `N = 2^16`
jest w zupełności wystarczający dla aplikacji z jednym kontem i zerem zależności.

Sesja jest bezstanowa: podpisane HMAC-em ciasteczko `HttpOnly`, `SameSite=Lax`.
Unieważnienie wszystkich sesji działa przez licznik `session_version` w ustawieniach —
zmiana hasła podbija licznik i wylogowuje każde urządzenie.

---

## ADR-006 — dzień bez transakcji jako flaga notatki dnia (2026-08-21)

Dzień świadomie odpuszczony jest zapisem dziennika, nie brakiem zapisu. Trzyma go
istniejąca tabela `day_notes`: znacznik `no_trade` plus powód z zamkniętej listy
(`no_trade_reason`). Osobna tabela dałaby dwa byty opisujące ten sam dzień i dwa
miejsca do edycji, a plan dnia, przegląd i ocena i tak mieszkają już w notatce.

Powody są enumem, nie słownikiem edytowalnym z ustawień: mają dawać się zliczać
i porównywać między miesiącami, a lista siedmiu pozycji pokrywa realne przypadki.
Opis własny wpisuje się w pole „Po sesji”.

**Trade'y wygrywają z flagą.** Akcja zapisu odrzuca oznaczenie dnia, w którym są
trade'y, a widok kalendarza w razie kolizji pokazuje wynik, nie pauzę. Bez tej
zasady dwa źródła prawdy o dniu potrafiłyby sobie przeczyć.

Nowa miara **pokrycie dziennika**: odsetek dni roboczych zakresu, które mają
jakikolwiek zapis. Mianownik obcinamy do dzisiaj — przyszłość nie jest luką.
**Świąt nie modelujemy**: dzień wolny oznacza się ręcznie powodem „dzień wolny”,
nieoznaczony liczy się jako dziura. Kalendarz świąt dwóch giełd i jednego kraju
byłby osobnym zbiorem danych do utrzymywania.

**Miernik dyscypliny zostaje nietknięty.** Pauza nie podnosi i nie obniża wyniku:
`scoreDiscipline` liczy kary per trade, a sygnał dniowy nie ma tam sensownego
mianownika. To decyzja do rewizji, gdyby pauz uzbierało się dość, żeby coś znaczyły.

---

## ADR-007 — zrzut wisi pod trade'em albo pod dniem (2026-08-21)

Zrzuty dnia trafiają do tej samej tabeli `screenshots`, co zrzuty trade'a. Kolumna
`trade_id` przestała być wymagana, doszła `day_note_id`, a warunek `screenshots_owner`
pilnuje, żeby dokładnie jedna z nich była wypełniona. Osobna tabela oznaczałaby
duplikat całej obsługi plików: zapisu przez sharpa, miniatur, kasowania i trasy
serwującej z kontrolą sesji.

Pliki dnia leżą w katalogu `dzien-<id>`, trade'a w `<id>`. Bez przedrostka trade 7
i notatka dnia 7 wskazywałyby ten sam katalog. Wzorzec w `safePath` zna obie postacie
i nic poza nimi — to nadal jedyna bariera między fragmentem adresu a dyskiem.

**Wklejanie ze schowka jest główną drogą.** Nasłuch `paste` wisi na całym dokumencie,
gdy panel dnia jest otwarty: po zrzucie z platformy nikt nie szuka najpierw pola do
wklejenia. Nasłuch rusza dopiero po hydratacji, więc strefa mówi wprost, czy jest
gotowa — inaczej pierwsze Ctrl+V po wejściu na stronę przepadałoby bez śladu.

Zrzut wgrywa się bez zapisywania notatki: pusty wpis dnia powstaje sam, jeśli trzeba.

Podział zrzutów trade'a na „przed" i „po" zniknął — patrz ADR-009.

---

## ADR-008 — wpis dnia należy do konta albo do sesji backtestu (2026-08-21)

`day_notes` obsługuje teraz dwa konteksty: dziennik realny (konto) i sesję backtestu.
Dzień bez sygnału w symulacji to ta sama rzecz co pauza w dzienniku — ten sam powód,
ta sama notatka, te same zrzuty — więc dostał tę samą tabelę zamiast własnej.

Kosztem są **trzy rozłączne indeksy częściowe** zamiast jednego unikalnego:
dzień z kontem, dzień bez konta i dzień sesji. W Postgresie NULL != NULL, więc bez
tego podziału wpisy dwóch różnych sesji na ten sam dzień trafiałyby na siebie
w indeksie „dzień bez konta". Akcja zapisu wybiera cel konfliktu tą samą regułą.

W backteście nie ma nastroju, energii ani oceny dnia — osobny, krótszy formularz
pyta o datę, powód i to, co było na wykresie. Zrzuty działają bez zmian, bo wiszą
pod wpisem dnia, nie pod kontem.

Nowa miara sesji: **pokrycie zakresu danych** — ile dni roboczych z `dataFrom`–`dataTo`
ma jakikolwiek zapis. Backtest, który pokazuje 30 wejść i milczy o 200 dniach czekania,
mówi o strategii mniej niż połowę.

---

## Odstępstwo — Lighthouse SEO 60 (2026-08-21)

Bramka publikacji wymaga ≥ 90 w czterech kategoriach. Ta aplikacja ma **60 w SEO**
i tak zostaje.

Powód: cała aplikacja wysyła `X-Robots-Tag: noindex, nofollow` i jest za logowaniem.
Lighthouse odejmuje punkty dokładnie za to, czego tu chcemy. Jedyny audyt, który nie
przechodzi, to `is-crawlable`. Podbicie wyniku wymagałoby wpuszczenia wyszukiwarek
do prywatnego dziennika transakcji.

Pozostałe kategorie są spełnione: wydajność 100 (desktop) i 92 (mobile), dostępność 100,
dobre praktyki 100.

---

## ADR-009 — zrzuty bez podziału na „przed" i „po" (2026-08-22)

Trade miał dwa osobne pola na zrzuty i kolumnę `kind` z wartościami `before`/`after`.
Etykieta nie niosła informacji: ze zrzutu „po" widać, jak wyglądało „przed", a przy
trzecim obrazie trzeba było zgadywać, do której szuflady go wcisnąć. Zamiast tego jest
**jedna lista w kolejności wgrywania**, a chronologia i tak stawia zrzut sprzed wejścia
na początku — za darmo, bez pola do pomyłki.

Enum `screenshot_kind` i kolumna `kind` zostały **usunięte** migracją `0004`. Ta sama
migracja przenumerowała `sort_order` oknem `row_number()` po `trade_id`: wcześniej
„przed" i „po" numerowały się osobno od zera, więc kolejność się dublowała. Kolumna
`caption` zostaje w schemacie nieużywana — podpisy odrzucono świadomie, a osobna
migracja kasująca jedną kolumnę tekstową może poczekać, aż będzie pewne, że nie wrócą.

**Limit 8 zrzutów na wpis** (`src/lib/screenshots-limit.ts`, ten sam moduł liczy
w przeglądarce i na serwerze). Przy przekroczeniu odrzucamy **całą paczkę**, nie
przycinamy: przy wklejeniu pięciu zdjęć do sześciu istniejących nikt nie zgadnie,
które dwa weszły. Komunikat podaje liczbę wolnych miejsc.

Nowy trade nie ma jeszcze identyfikatora, więc jego pliki jadą tym samym multipartem
co reszta formularza (`NewTradeShots` synchronizuje stan z polem przez `DataTransfer`).
Trade istniejący i dzień dziennika dzielą jeden `ScreenshotUploader` — wklejanie,
przeciąganie, licznik i kasowanie w jednym miejscu zamiast w dwóch.

**Powiększenie stoi na natywnym `<dialog>` i `showModal()`, nie na bibliotece.**
Pułapka fokusu, wygaszenie tła, Escape i powrót fokusu na kafel są wtedy za darmo,
a repozytorium trzyma się zasady „celowo bez biblioteki komponentów" — paczki
`@radix-ui/*` z `package.json` nadal nie są nigdzie importowane. Zawartość okna
renderuje się dopiero po otwarciu: inaczej każde wejście na kartę ciągnęłoby pełny
plik obok miniatur.

Siatka ma **stałą wysokość wiersza**, nie proporcję liczoną z szerokości. Przy
proporcji pionowy zrzut obok poziomego rozpychał wiersz i zostawiał pod sąsiadem
pustą dziurę. Pierwszy zrzut dostaje szerszy kafel tylko przy trzech i pięciu
sztukach — tam, gdzie siatka i tak miałaby lukę.

---

## Odstępstwo — świadomie poza zakresem (2026-08-21)

Uzgodnione przed budową, wypisane, żeby nie wracało jako brak:

- **import CSV z brokera** — dziennik jest ręczny; model danych niczego tu nie blokuje,
- **automatyczne MAE/MFE** — wpisywane ręcznie, opcjonalnie,
- **wiele wejść i wyjść w jednym trade'zie** — jedno wejście, jedno wyjście; częściowe
  realizacje wpisuje się jako cenę uśrednioną
  *(połowa dotycząca wyjść uchylona — ADR-025, 2026-08-30: częściowe realizacje mają własne
  wiersze; częściowe wejścia zostają poza zakresem)*,
- **odtwarzacz wykresów, asystent AI, aplikacja mobilna, synchronizacja z brokerami**.
  *(częściowo uchylone — ADR-026, 2026-10-05: wchodzi API, do którego klient wysyła trade'y
  z TradingView i FX Replay oraz oceny AI; synchronizacja z **brokerami** i asystent AI wewnątrz
  aplikacji zostają poza zakresem)*

---

## Odstępstwo — ostrzeżenie React Compiler przy tabeli (2026-08-21)

`useReactTable` z TanStack Table zwraca funkcje, których React Compiler nie potrafi
bezpiecznie zapamiętać, i zgłasza to jako ostrzeżenie `react-hooks/incompatible-library`.
Ostrzeżenia nie wyciszamy: jest prawdziwe, komponent po prostu nie korzysta z memoizacji.
Tabela działa poprawnie, a wyłączenie reguły ukryłoby przyszłe, realne problemy.

---

## ADR-010 — prowizja poza modelem (2026-08-23)

Prowizja została usunięta z modelu danych: `instruments.commissionPerContract`,
`trades.commission` i `trades.pnlGross` znikły, a `pnlNet` przemianowano na
jedną kolumnę `pnl`. Powód jest wprost od użytkownika: jej nie chce. Bez
prowizji brutto i netto to zawsze ta sama liczba, więc trzymanie dwóch
kolumn i dwóch podpisów w interfejsie („Wynik brutto" / „Wynik netto")
opisywałoby rozróżnienie, które nie istnieje.

Migracja `drizzle/0005_bez_prowizji.sql` przepisuje stare trade'y na dawne
`pnl_gross` (czyli wynik bez odjętej prowizji) i przelicza za nimi
`r_multiple` - w przeciwnym razie stare trade'y zostałyby na zawsze
obciążone prowizją, a każda ich kolejna edycja liczyłaby wynik już bez niej,
więc dwa identyczne trade'y (jeden edytowany, jeden nie) pokazywałyby różny
wynik. `exitPriceForNet` przemianowano na `exitPriceForAmount` (`targetNet` →
`target`) - nazwa „netto" przestała mieć desygnat, skoro nie ma już od czego
odejmować.

Pole „Kwota z brokera" w formularzu trade'a zostaje - to nadal wygodny
sposób wpisania wyniku bez liczenia ceny wyjścia ręcznie, tylko przestało
być kwotą „po prowizji". (Rola tego pola zmieniła się później — ADR-016:
kwota nie podpowiada już wyniku, tylko nim jest.)

---

## ADR-011 — wynik BE (2026-08-23)

Wynik trade'a ma trzy stany, nie dwa: zysk, strata, be. Stop przesunięty na
zero rzadko wychodzi dokładnie na 0,00 - trade wyprowadzony na +7 USD dziś
liczy się jako wygrana i zawyża skuteczność. Próg BE skaluje się wielkością
trade'a: ułamek ryzyka w tysięcznych R (domyślnie 0,100R), a gdy trade nie ma
stopa - zapasowy próg kwotowy na kontrakt (domyślnie 2,00 USD).

**Skala progu - liczby całkowite, nie `numeric`.** `settings.beProgRMille`
(integer, tysięczne R) i `settings.beProgNaKontrakt` (bigint, centy). Gdyby
próg siedział w `numeric`, TS liczyłby `0.1 * risk` w double, a Postgres w
arytmetyce `numeric` - na samej granicy przedziału obie strony mogłyby dać
inną odpowiedź. Na liczbach całkowitych `round(progRMille * risk / 1000)`
jest identyczne po obu stronach (`src/lib/domain/outcome.ts`, funkcje
`progBE`/`sqlProgBE` i `wynikTrade`/`sqlWynik` - jeden wzór, dwie postacie).
Granica jest domknięta: `pnl` równe progowi co do centa to `be`, nie `zysk`
ani `strata`. Test parzystości TS↔SQL siedzi w `e2e/dziennik.spec.ts`
(trzy trade'y na granicy 0,09R/0,10R/0,11R, potem `/trades?wynik=be` i
`/stats?wynik=be` muszą zgadzać się co do liczby).

**BE poza mianownikiem skuteczności.** `winRate = wins / (wins + losses)`,
nie `wins / count`. Inaczej im lepiej ktoś przesuwa stopy na zero, tym gorzej
wyglądałby system - `breakEvenWinRate` (próg opłacalności) i tak porównuje się
z trade'ami rozstrzygniętymi, więc mianownik `winRate` musi być ten sam zbiór.
Z tego samego powodu `profitFactor`, `avgWin`, `avgLoss` i `payoff` liczą się
wyłącznie z trade'ów zysk/strata - BE nie wchodzi do żadnej z sum.

**BE nie rusza serii.** `L, BE, L` to nadal seria dwóch strat, nie jeden ani
trzy. Gałąź `be` w `computeStats` nie dotyka `winStreak`/`lossStreak` - w
przeciwieństwie do dawnego `flat`, które zerowało oba liczniki.

**Kalendarz bez progu.** Kolor kafla miesiąca w `MonthGrid` liczy się dalej z
sumy dziennego `pnl`/`R`, nie z liczby trade'ów BE - dzień nie ma własnego
stopa, więc nie ma z czego liczyć progu na poziomie dnia. Opis dnia pod
kafelkiem dokłada `X BE`, gdy takie trade'y są, ale kolor zostaje po sumie.

**`scoreDiscipline` świadomie zostaje przy znaku `pnl`.** Miernik dyscypliny
(`src/lib/domain/discipline.ts`) używa `previous.pnl >= 0`, żeby rozpoznać
"poprzedni trade był stratny" przy sygnale odwetu i powiększania pozycji po
stracie - to pytanie o zachowanie po jakiejkolwiek nie-wygranej, nie o
kategorię BE. Przepisanie na `wynikTrade` zmieniłoby znaczenie sygnału bez
korzyści: trade BE poprzedzający kolejne wejście nie jest tym samym ryzykiem
psychologicznym co strata, ale nie jest też jej przeciwieństwem - zostawiamy
istniejące zachowanie i zapisujemy to tutaj, żeby nie wróciło jako błąd w
kolejnym audycie.

Migracja `drizzle/0006_wynik_be.sql` dokłada dwie kolumny do `settings` z
sensownymi wartościami domyślnymi (0,100R, 2,00 USD) - istniejące wiersze nie
wymagają przeliczenia, bo `wynik` liczy się w locie z `pnl`/`riskAmount`/
`contracts`, a nie jest kolumną w `trades`.

---

## ADR-012 — zrzut zawsze w pełnym kadrze (2026-08-23)

Siatka zrzutów opisana w ADR-009 (stała wysokość wiersza, „kafel główny"
przy 3 i 5 zdjęciach) przycinała obraz przez `object-cover`, gdy trade miał
więcej niż jedno zdjęcie. Powód zmiany jest wprost od użytkownika: przycięty
zrzut nie jest wiarygodnym dowodem transakcji — kawałek świecy albo poziomu
uciętego poza kadrem jest gorszy niż brak zrzutu, bo sprawia wrażenie dowodu,
którym nie jest.

Zamiast tego galeria (`src/lib/domain/galeria.ts`) liczy **układ justowany**
jak w Google Photos/Flickr, jako jedno drzewo DOM (`flex flex-wrap`): każdy
kafel dostaje `flex-basis` proporcjonalny do własnej szerokości przy
wspólnej bazowej wysokości wiersza (`BAZA_WYSOKOSCI_WIERSZA`) i `flex-grow`
równy własnej proporcji szerokość/wysokość. Przy wspólnej wysokości wiersza
każdy kafel wychodzi wtedy dokładnie na swoją naturalną szerokość — zero
przycięcia, zero pasów. Zawijanie do kolejnych wierszy robi sam CSS
(`flex-wrap`) na podstawie szerokości kontenera, więc responsywność telefon
↔ desktop nie potrzebuje osobnego przelicznika w JS.

Pierwsza wersja tego ADR renderowała dwa równoległe warianty w DOM
(`hidden sm:block` / `sm:hidden`), żeby uniknąć przeskoku układu po
hydratacji przy przeliczniku opartym na `matchMedia` — koszt uznany wtedy za
akceptowalny, bo obrazy pobierają się raz niezależnie od tego, w którym
wariancie akurat siedzi `<img>`. Code review pokazało, że koszt jest wyższy,
niż wyglądał: każdy zrzut renderuje się **dwa razy** w DOM, co psuje testy
e2e liczące obrazy (`img[src^="/api/screenshots/"]` widzi 2× więcej niż
faktycznie jest) i dostępność (zdublowany `<img>` z tym samym `alt` czyta się
w czytniku ekranu dwukrotnie). CSS `flex-wrap` daje responsywność bez
przeliczania w JS, więc nie ma powodu do dwóch wariantów — jedno drzewo
wystarcza i renderuje się poprawnie w pierwszym malowaniu tak samo jak dwa.

Ostatni, niepełny wiersz: przy jednym drzewie DOM nie da się już (jak
poprzednio w JS) policzyć z góry, które kafle trafią do ostatniego wiersza —
o tym decyduje `flex-wrap` w przeglądarce. Domknięcie jest więc też czystym
CSS: na końcu listy siedzi kilka niewidocznych wypełniaczy (`height: 0`,
`aria-hidden`) z bardzo dużym `flex-grow`. Który wypełniacz wyląduje w
niepełnym wierszu, zależy od przeglądarki — to mniej deterministyczne niż
jawne liczenie wierszy w JS, ale akceptowalne: efekt końcowy (żaden
pojedynczy zrzut nie rozdyma się na całą szerokość panelu) jest ten sam.

**Koszt zapisany świadomie:** wiersze galerii mają teraz nierówne wysokości
zależne od proporcji zdjęć w danym wpisie, zamiast równych rzędów jak w
starym układzie. To może wyglądać mniej estetycznie niż poprzednia siatka —
akceptowane w zamian za to, że żaden zrzut nigdy nie traci fragmentu obrazu.

Stare funkcje `ukladSiatki`, `klasaKafla`, `czyPion` i stała `WIERSZ` zostały
usunięte z `galeria.ts` razem z ich testami; nie ma po nich zależności poza
`screenshot-grid.tsx` i `new-trade-shots.tsx`, oba przepisane na nowe API.
Funkcje `wiersze`/`proporcjaWiersza` z pierwszej wersji tego ADR poszły w
ich ślady przy przejściu na jedno drzewo DOM — podział na wiersze i
domykanie ostatniego robi teraz CSS, nie JS.

---

## ADR-013 — interwał jako atrybut przypisania tagu (2026-08-23)

Interwał przestał być osobną kategorią tagów (`timeframe`: "1 min", "5 min",
"15 min", "1 h"). Zamiast tego każde przypisanie tagu do trade'a
(`trade_tags`) ma własną, opcjonalną kolumnę `interval` — jeden tag
"wybicie" może więc opisywać wejście zauważone na 5m i osobno na 1h, czego
osobna kategoria tagów nigdy nie potrafiła wyrazić bez dublowania tagów
("wybicie 5m", "wybicie 1h", ...).

Lista dozwolonych wartości (`src/lib/domain/interwaly.ts`, stała
`INTERWALY`) jest w kodzie, nie w bazie: kolumna to `text`, nie enum
Postgresa. Dołożenie "2h" nie ma wymagać migracji schematu. Kolejność listy
(`30s 1m 2m 3m 4m 5m 15m 30m 1h 4h D W M`) jest kolejnością wyświetlania
i sortowania w całej aplikacji — nigdy alfabetyczną (`porzadekInterwalu`),
bo alfabetycznie "1h" wyprzedza "1m", a czasowo jest odwrotnie.

Zapis idzie osobnym polem `name="tagint:<tagId>"` obok checkboksa
`name="tag"`, nie jedną zakodowaną wartością typu `"12:5m"` — nazwa `tag`
jest współdzielona z `filter-bar.tsx` i z masowym tagowaniem `tagMany`
w `actions/trades.ts`, które o interwale nic nie wiedzą i muszą dalej
działać bez zmian. `tagMany` zawsze wstawia `interval: null`: tagowanie
zbiorcze z tabeli nie ma kontekstu pojedynczego trade'a, więc nie ma z
czego wybrać interwału.

**`TagPicker`** pokazuje `<select>` interwału czystym CSS-em przez
`peer-checked:` w momencie zaznaczenia tagu — bez JavaScriptu. To wymusza
kolejność w DOM (`<input class="peer">` → chip → `<select>`), bo `peer-*`
działa tylko na późniejsze rodzeństwo tego samego rodzica.

**Wymiar `interval` w `grouping.ts`** nie jest `outcomeDerived` — interwał
jest wyborem użytkownika przy tagowaniu, nie wartością wyliczoną z wyniku
trade'a, więc Edge Finder wolno mu go używać. Trade z tagami na dwóch
interwałach trafia do obu grup, zgodnie z istniejącą konwencją modułu dla
wymiarów tagowych. Dimension zyskał opcjonalne pole `sortValues`: bez niego
`groupBy` sortuje malejąco po wyniku grupy, co dla skali czasowej nie ma
sensu (1m powinno stać przed 1h niezależnie od tego, który z nich jest
bardziej zyskowny).

### Migracja `drizzle/0007_interwal_przy_tagu.sql`

Stare tagi kategorii `timeframe` są przepisywane na kolumnę `interval`
pozostałych przypisań tego samego trade'a (`"1 min"→"1m"`, `"5 min"→"5m"`,
`"15 min"→"15m"`, `"1 h"→"1h"`), potem kasowane razem z kategorią. Trade
oznaczony dwoma tagami interwałowymi naraz (błąd sprzed migracji) dostaje
ten niższy w kolejności z `INTERWALY` — drobniejszy interwał niesie więcej
informacji.

**Znany brzeg, zaakceptowany świadomie:** trade otagowany WYŁĄCZNIE tagiem
interwałowym (bez żadnego innego tagu) traci interwał po tej migracji — nie
ma innego przypisania `trade_tags`, na którym mógłby zawisnąć. Odzyskanie
tej informacji wymagałoby trzymania jej gdzieś tymczasowo poza modelem
docelowym; uznaliśmy to za nadmiarowe dla jednorazowej migracji.

---

## ADR-014 — kasowanie tagu tylko gdy nieużywany (2026-08-23)

`deleteTag` liczy `count(*)` w `trade_tags` i przy wyniku większym od zera
odmawia z komunikatem kierującym do archiwizacji, zamiast po cichu kasować
tag razem z jego przypisaniami (tak działało to wcześniej — usunięcie
definicji tagu wyrywało go z historii trade'ów bez ostrzeżenia, a
statystyki, które już go policzyły, zostawały bez wyjaśnienia rozjazdu).
Nowa `archiveTag` (wzorem istniejącej `archiveField`) daje ten sam efekt
widoczności — tag znika z wyboru przy nowych trade'ach — bez utraty danych.

`deleteTagCategory` jest zamknięte tym samym licznikiem (sumą użyć
wszystkich tagów kategorii), żeby nie było furtką omijającą regułę: kasowanie
kategorii kaskadowo zdejmuje jej tagi i ich przypisania (`onDelete:
"cascade"`), więc bez tej blokady wystarczyłoby skasować kategorię zamiast
pojedynczego tagu, żeby obejść zakaz.

Treść `window.confirm` przy kasowaniu tagu (`components/settings/forms.tsx`,
`components/trades/tag-manager.tsx`) została poprawiona — do tej pory
obiecywała, że tag "zniknie z trade'ów, które go mają", co po tej zmianie
przestało być prawdą: usunięcie użytego tagu teraz się nie powiedzie.

---

## ADR-015 — interwał zrzutu, osobno od interwału tagu (2026-08-23)

Zrzut ekranu dostał własną kolumnę `screenshots.interval` (`text`, nullable —
to samo uzasadnienie co przy `trade_tags.interval` w ADR-013: lista
dozwolonych wartości żyje w kodzie, `lib/domain/interwaly.ts`, dołożenie
np. "2h" nie ma wymagać migracji schematu).

**Dlaczego to nie jest ten sam interwał co przy tagu.** Tag opisuje setup —
"wybicie" zauważone na 5m. Zrzut opisuje konkretny obraz — wykres otwarty na
1h. Jeden trade miewa po kilka zrzutów z różnych interwałów naraz (wejście na
5m, kontekst z 1h, potwierdzenie z D), więc próba utożsamienia tych dwóch pól
zmuszałaby do wyboru jednego interwału dla całego trade'a i kłamałaby o
pozostałych zrzutach. Migracja `drizzle/0008_interwal_zrzutu.sql` dokłada
kolumnę bez żadnego przepisywania danych — nie ma z czego wywnioskować
interwału istniejących zrzutów wstecz.

**Dwa różne miejsca wyboru, bo dwa różne przepływy wgrywania.**

- **Dogrywanie do istniejącego wpisu** (`ScreenshotUploader`, trade w edycji
  i dzień dziennika) — jeden `<select name="interval">` nad strefą wgrywania,
  wspólny dla całej paczki. Typowy przepływ to kilka zrzutów z tego samego
  interwału pod rząd (Ctrl+V kilka razy z rzędu z tej samej platformy), więc
  wartość zostaje zapamiętana w stanie komponentu między wgraniami zamiast
  zerować się po każdym pliku — przestawianie selecta za każdym razem byłoby
  karą za normalne użycie.
- **Nowy trade** (`NewTradeShots`) — interwał wybierany per plik w podglądzie,
  bo tu widać wszystkie miniatury naraz i naraz można wgrywać zrzuty z kilku
  interwałów. Pliki i interwały jadą równoległymi polami `shot`/`shotint`
  (multipart formularza trade'a, wpis nie ma jeszcze id — ADR-009), parowane
  po indeksie funkcją `sparujZInterwalami`
  (`src/lib/domain/interwaly.ts`), nie po treści. Cicha zamiana interwałów
  między zdjęciami przy przesunięciu indeksów jest dokładnie tym błędem,
  którego nikt by nie zauważył na oko — stąd czysta, testowana funkcja
  zamiast parowania w locie w komponencie.

**Poprawka po fakcie.** Wszędzie, gdzie zrzut wolno skasować (`onUsun`), wolno
też poprawić mu interwał — `setScreenshotInterval` /
`setDayScreenshotInterval` w `lib/actions/{trades,journal}.ts`, wołane bez
zagnieżdżonego `<form>` (formularz trade'a jest jednym `<form>`, wzorzec z
`tag-manager.tsx`). W `ScreenshotGrid` etykieta interwału jest wtedy od razu
`<select>`, nie statycznym tekstem — nie ma osobnego trybu "podgląd" i trybu
"edycja".

**Etykieta bez `opacity`.** Interwał na kaflu i w powiększeniu ma pełne,
kryjące tło (`bg-bg`, bez kanału alfa) i tekst w pełnym kontraście
(`text-text`), nie `text-faint` ani `opacity-*` — dokładnie to zawiodło dziś
w audycie dostępności `trades-table.tsx`. Tło pod tekstem musi być
nieprzezroczyste, bo leży na dowolnym, nieprzewidywalnym fragmencie zdjęcia
wykresu — półprzezroczyste tło (jak przy przycisku kosza obok, `bg-bg/80`)
dawałoby nieprzewidywalny kontrast zależny od tego, co akurat jest pod spodem.

---

## ADR-016 — kwota z brokera jest wynikiem (2026-08-23)

Pole „Kwota z brokera" było do tej pory wyłącznie kalkulatorem: nie miało
atrybutu `name`, nie trafiało do bazy, a jedyne, co robiło, to przez
`exitPriceForAmount` wyliczało cenę wyjścia na najbliższym ticku. Wynik
zapisywał się potem z tej ceny. Przy NQ tick to 5,00 USD na kontrakt, więc
wpisane 116,00 USD zapisywało się jako 117,00 USD, a formularz jeszcze
ostrzegał, że kwota „nie zgadza się" z siatką. Ostrzegał w złą stronę:
faktem jest rachunek brokera, a model tickowy tylko jego przybliżeniem.

**Kwota, gdy podana, jest wynikiem.** `computeTrade` przyjmuje
`brokerAmount` (centy) i zwraca go jako `pnl` zamiast kwoty z ticków.
Ponieważ `rMultiple` liczy się z `pnl`, a `wynikTrade` (ADR-011) też,
kategoria zysk/strata/BE i R idą za kwotą same z siebie — bez rozgałęzień
w statystykach. Statystyki, filtry SQL i wykresy czytają dalej `trades.pnl`
i o zmianie nic nie wiedzą; to była główna przesłanka za tym kształtem
zamiast `COALESCE` rozsianego po sześciu zapytaniach.

**Ticki zostają z ceny.** Opisują ruch rynku, nie pieniądze — 26 ticków to
26 ticków, niezależnie od tego, ile broker naliczył prowizji, poślizgu czy
częściowych wypełnień. To właśnie ta różnica jest treścią pola.

**Osobna kolumna `broker_amount`** (migracja `drizzle/0009_kwota_brokera.sql`)
trzyma ślad, że wynik pochodzi z rachunku, a nie z siatki. Bez niej nie dałoby
się odróżnić obu przypadków ani wrócić do edycji z wypełnionym polem, a
wyczyszczenie kwoty nie miałoby jak przywrócić wyniku z ticków. Zapisujemy ją
zawsze jawnie, także jako `null` — pominięcie klucza w `set()` zostawiłoby
w edycji starą kwotę. Zero jest poprawną wartością (break even u brokera),
więc wszędzie sprawdzamy `null`, nigdy „falsy".

**Bez backfillu.** Stare trade'y mają `broker_amount = NULL` i zachowują
swój wynik z ticków. Nie ma z czego odtworzyć kwot, których nikt nie zapisał.

**Komunikat pod polem** przestał mówić „o 1,00 USD więcej niż wpisane" —
mówi, jaka cena wyjścia wejdzie do zapisu, i przypomina, że w statystykach
liczy się wpisana kwota. Różnica `diff` z `exitPriceForAmount` nie jest już
błędem do zgłoszenia, tylko normalnym skutkiem tego, że ceny chodzą po tickach,
a pieniądze nie.

---

## ADR-017 — tagi jako konfluencje, warstwa z interwału, tag wielokrotnie (2026-08-24)

**Kontekst.** Kategoria „Setup" zawierała w praktyce konfluencje (EQ, RB, fvg,
ifvg, otwarcie sesji), a nie nazwy zagrań. Kategoria „Warunki rynkowe" nie była
używana. Interwał można było przypisać do tagu tylko jeden, choć ta sama
konfluencja bywa widoczna równocześnie na 4h i na 5m — i to właśnie ta para
jest informacją, nie sam fakt obecności FVG.

**Trzy kategorie zamiast trzech innych.** `confluence` (przesłanki wejścia,
z interwałem), `setup` (nazwa całego zagrania, bez interwału), `mistake`.
Kategorię `setup` **przemianowaliśmy** na `confluence` zamiast przepinać tagi
do nowej: `tags.id` zostają, więc historia w `trade_tags`, zapisane widoki
(`saved_views.filters->'tag'` trzyma ID-ki) i linki `?tag=12` przeżywają
migrację nietknięte. Koszt: klucz `setup` oznacza po migracji inną kategorię
niż przed nią. Żyje on wyłącznie w parametrze `?wymiar=tag:setup` na `/stats`,
którego nigdzie nie zapisujemy — stary link pokaże pustą kategorię.

**Warstwa HTF/LTF wynika z interwału, nie z kategorii.** Próg to `1h`, liczony
przez `porzadekInterwalu`, nie przez wypisaną listę — dołożenie „2h" do
`INTERWALY` samo trafi we właściwą warstwę. Osobne kategorie „Konfluencje HTF"
i „Konfluencje LTF" byłyby duplikatem tej samej listy tagów i zmuszałyby do
zakładania „FVG HTF" obok „FVG LTF" jako dwóch niezależnych bytów, których
statystyki nigdy by się nie spotkały.

**Ten sam tag kilka razy.** `trade_tags` dostaje `id serial primary key`
i unikat `(trade_id, tag_id, interval)` z **`NULLS NOT DISTINCT`**. Bez tego
modyfikatora wiersz z pustym interwałem dałby się wstawić dowolną liczbę razy
i `onConflictDoNothing` w `saveTrade` przestałby czegokolwiek pilnować.
W drizzle 0.45 `nullsNotDistinct()` istnieje **tylko** na `unique()`, nie na
`uniqueIndex()` — pomyłka nie daje błędu w czasie działania, tylko rozjazd
schematu przy następnym `generate`.

**Podwójne liczenie było największym ryzykiem tej zmiany.** `groupBy`
i `bucketize` wrzucają trade do kubełka raz na każdą wartość wymiaru, więc
FVG na 4h i 5m dałoby `["FVG","FVG"]` i ten sam trade wpadłby dwa razy do tej
samej grupy — zawyżając `count`, `pnl`, `sumR`, skuteczność i wagę w Edge
Finderze. Deduplikacja siedzi w **obu pętlach**, na poziomie mechanizmu, a nie
w każdym wymiarze tagowym z osobna: to jedyne miejsce, w którym da się o niej
nie zapomnieć. Poprawka weszła **przed** migracją, czyli zanim baza w ogóle
zaczęła takie dane produkować.

**Interfejs.** Wiersz checkboxów `tagint:<id>` odsłaniany `peer-checked:flex`,
rozdzielony na HTF i LTF z podpisami — podział przestaje być ukrytą regułą.
Chip jest teraz `<label for>`, a nie opakowaniem, dzięki czemu zagnieżdżone
checkboxy interwału nie przełączają tagu i nie potrzeba do tego
`stopPropagation`, czyli JavaScriptu (poprzedni `<select>` tego wymagał, więc
obietnica „działa bez JS" była wcześniej częściowo nieprawdziwa).

**Pułapka do zapamiętania:** checkbox ukryty CSS-em **nadal jedzie
w `FormData`** (`display:none` nie wyłącza kontrolki, robi to tylko
`disabled`). Parser iteruje więc po zaznaczonych tagach, nie po kluczach
`tagint:*` — inaczej odznaczenie tagu zostawiałoby osierocone interwały.
Sprawdzone na żywo: po odznaczeniu tagu formularz nadal niósł `4h` i `5m`,
a w bazie po zapisie zostało zero wierszy.

**„Warunki rynkowe" skasowane migracją**, wbrew ADR-014 — `deleteTag` odmawia
usunięcia tagu użytego w trade'ach i ma tak zostać. To jednorazowy wyjątek
podjęty świadomie, nie furtka omijająca tamtą zasadę. Migracja czyści przy
okazji `saved_views` z ID-ków skasowanych tagów: bez tego zapisany widok cicho
zwracałby zero wierszy, bo `EXISTS` na nieistniejącym `tag_id` nigdy nie jest
prawdziwy — a nic w interfejsie by tego nie wytłumaczyło.

**Dług:** migracje `0010`/`0011` pisane ręcznie (`drizzle-kit generate` wymaga
TTY), bez `meta/*_snapshot.json`. Migrator ich nie czyta, ale pierwszy przyszły
`generate` policzy różnicę od `0009` i wyprodukuje duplikat.

---

## ADR-018 — kierunek trafiony mimo złej egzekucji (2026-08-24)

**Kontekst.** Dziennik nie odróżniał „pomyliłem się co do kierunku" od
„miałem rację, ale wyszedłem za wcześnie". To dwie zupełnie różne porażki,
a skuteczność 41% może znaczyć system bez przewagi albo system z przewagą
i złą ręką.

**Prawdziwe kolumny, nie pole własne w JSONB:** `direction_correct`,
`bad_execution_reason` (enum), `potential_r`. Te liczby wchodzą do statystyk,
do filtrów SQL i do wymiarów Edge Findera, a JSONB nie da się na to sensownie
zindeksować ani porównać liczbowo.

**Wygranej nie zapisujemy.** „Zysk ⇒ kierunek trafiony" wyprowadza
`lib/domain/kierunek.ts`. Zapisanie `true` do bazy byłoby denormalizacją,
która skłamie po zmianie progu BE w ustawieniach — dokładnie pułapka z ADR-011.

**Trzy stany, nie dwa.** `null` znaczy „nieocenione", `false` — „kierunek
chybiony". Rozróżnienie niesie ukryte pole `kierunek_oceniany`, wysyłane razem
z blokiem: bez niego odznaczony checkbox byłby nieodróżnialny od „nie pytaliśmy",
mianownik trafności równałby się licznikowi i **metryka zawsze pokazywałaby sto
procent**.

**`potential_r` to nie `mfe_r`.** MFE mierzy ruch w trakcie trwania pozycji,
potencjał — zasięg całego zagrania, często już po wyjściu. Formularz podpowiada
wartość z MFE, ale ich nie utożsamia; mylenie ich odbiera sens metryce
„utracone R".

**Metryki.** Mianownikiem trafności są wyłącznie trade'y ocenione — nieoznaczona
strata to „nie wiem", nie „kierunek chybiony". `lostR` ma **clamp na zero per
trade**: trade lepszy od zadeklarowanego potencjału nie ma generować „ujemnej
straty" kompensującej cudze błędy w sumie zbiorczej.

**Błąd wyłapany dopiero na żywych danych:** „sufit systemu" liczony jako
`(sumR + lostR) / count` wyszedł **niżej** niż oczekiwana wartość (+0,79R wobec
+0,94R), bo `expectancyR` dzieli przez `countWithR`, a nie przez `count`.
Trade'y bez stopa rozwadniały sufit, który rzekomo ogranicza wartość od góry.
Mianownik musi być ten sam po obu stronach.

**Uczciwość podpisu.** Wygrane wpadają do mianownika z definicji, więc dopóki
użytkownik nie przejrzy strat, trafność pokazuje równe sto procent — liczba
prawdziwa i myląca naraz. Dlatego KPI i panel wymieniają liczbę trade'ów bez
oceny, zamiast pokazywać samo „100%".

**`badreason` i `directionHit` są `outcomeDerived`.** Powód złej egzekucji
istnieje wyłącznie przy trade'ach nie-wygranych, więc Edge Finder „odkryłby",
że kontekst „powód = niepotrzebny stop" ma oczekiwaną wartość poniżej zera —
z definicji, a nie z obserwacji. Ta sama pułapka co przy `rrange`.

**Miernik dyscypliny obniżany** o sygnał `zla_egzekucja` (waga 15) — decyzja
użytkownika. Wyniki sprzed tej zmiany **nie są porównywalne** z późniejszymi.
`unnecessary_sl` celowo poza miernikiem: zbyt ciasny stop to błąd planu, nie
dyscypliny.

---

## ADR-019 — galeria jako osobna trasa, siatka zamiast układu justowanego (2026-08-24)

**Kontekst.** Zdjęcie wykresu jest głównym nośnikiem informacji o trade'zie,
a na liście widać było wyłącznie liczbę zrzutów. Nie dało się zadać pytania
„pokaż wszystkie wejścia z EQ na HTF i FVG na LTF" i zobaczyć wykresów obok
siebie.

**Osobna trasa `/galeria`, nie przełącznik widoku na `/trades`.** Tabela
i galeria odpowiadają na różne pytania i mają różne domyślne filtry (galeria
startuje z „tylko ze zrzutem"). Wspólny jest cały aparat filtrowania: jeden
`parseFilters`, jeden `FilterBar`, jedno `whereClause`.

**Siatka o wspólnej proporcji, nie układ justowany z ADR-012.** Tamten moduł
(`lib/domain/galeria.ts`) układa zrzuty **jednego** trade'a tak, by żaden nie
był przycięty. Tutaj każdy kafel należy do innego trade'a i ma pod obrazkiem
więcej metadanych niż samego obrazka — nierówne wysokości rozsypałyby rytm.
Zdjęcie i tak nie jest przycięte: `object-contain` na tle, nie `object-cover`.
To dwa różne moduły o mylnie podobnej nazwie i nie wolno ich scalić.

**Pierwszy zrzut wsadowo, bez N+1.** `screenshotSummary` zwraca licznik
**i** pierwszy plik jedną agregacją (`array_agg(...)[1]` po `sort_order`, `id`),
bo licznik i tak trzeba policzyć. Przy dziesiątkach kafli to różnica między
stałą liczbą zapytań a zapytaniem na kafel. Pojęcia „zdjęcia głównego" nadal
nie ma (ADR-009) i nie wprowadzamy go tylnymi drzwiami — „pierwszy" znaczy
po prostu ten sam porządek, który widać w karcie trade'a.

**`next/image` odpada:** pliki leżą poza `public/`, a trasa `/api/screenshots`
wymaga sesji. Zwykły `<img>` z `width`, `height` i `loading="lazy"` daje to
samo bez przeskoku układu.

**Paginacja zwykłymi linkami**, nie nieskończonym przewijaniem: działa bez
JavaScriptu, da się wysłać linkiem i nie psuje powrotu z karty trade'a.

**Filtr zrzutów jest trójstanowy** (`1` / `0` / brak). Dwustanowy nie miałby
jak wyrazić opcji „tylko bez zrzutu", a w galerii brak parametru znaczy
„tylko ze zrzutem" — dlatego zdjęcie tego filtru wymaga jawnego
`?zezrzutem=wszystko`, sama nieobecność parametru niczego by nie wyłączyła.

---

## ADR-020 — formularz trade'a schudł: cztery pola wychodzą, gotowość wchodzi (2026-08-29)

**Kontekst.** Formularz urósł o pola, które nie wracały w żadnej decyzji:
„Jakość wejścia", „Ocena wykonania", „Trade zgodny z planem" i „Strategia".
Trzy pierwsze wypełniało się PO wyniku, więc mierzyły głównie nastrój po
zamknięciu pozycji. Strategia dublowała to, co lepiej niesie tag.

**Cztery pola znikają z interfejsu, dane zostają.** Kolumny
`trades.execution_rating`, `trades.strategy_id` i `trades.rules_met` są
nietknięte, a wartości pól własnych (`nastroj`, `jakosc_wejscia`,
`plan_zrealizowany`) zostają w `trades.custom`. Migracja `0012_gotowosc.sql`
kasuje wyłącznie DEFINICJE trzech pól z `custom_fields` — to wystarcza, żeby
przestały się renderować i przestały być wymiarem statystyk, a jednocześnie
nic z historii nie ginie. Karta starego trade'a nadal pokazuje jego strategię
i ocenę, podpisaną jako archiwalną.

**Zapis trade'a nie dotyka `strategy_id` ani `rules_met`.** Gdyby akcja
wpisywała tam `null`, edycja notatki kasowałaby strategię starego wpisu —
klucza po prostu nie ma w zapisywanym wierszu.

**Strategia zostaje przy sesji backtestu**, gdzie ma pracę: porównanie
„Backtest kontra dziennik" jest po niej. Trade'y strategii już nie dostają,
więc panele, które ją grupowały (wymiar `strategy`, „Porównanie strategii",
„Ten trade na tle strategii"), znikają — bez przypisań pokazywałyby jedną
grupę „brak danych" i udawały, że coś mierzą. Sygnał dyscypliny
`broken_rules` zasypia z tego samego powodu; definicja zostaje, bo stare
trade'y wciąż go wyzwalają.

**„Nastrój przed wejściem" → opis plus suwak gotowości.** Zamiast listy
czterech nastrojów: pole tekstowe (samopoczucie własnymi słowami) i suwak
1–10 obok niego. Dwie kontrolki, bo niosą dwie różne rzeczy — sam opis nie
zrobiłby wymiaru w statystykach, a sama liczba nie powiedziałaby dlaczego.
To prawdziwe kolumny (`mood_note`, `readiness`), nie pole własne: pola własne
nie mają typu „tekst + suwak", a dorabianie go do `field_type` byłoby
przerostem nad jedną potrzebą. Gotowość wchodzi do statystyk jako wymiar
z czterema kubełkami (`readinessBucket`) i NIE jest `outcomeDerived` — to
jedyna z usuwanych liczb, która powstaje przed wejściem, więc jedyna, którą
wolno zestawiać z wynikiem.

Zero na suwaku znaczy „nie oceniam": `<input type="range">` nie ma stanu
pustego, a osobny checkbox obok byłby drugą kontrolką na jedną decyzję.
Zamianę zera na `NULL` robi akcja zapisu, nie przeglądarka — CHECK
`trades_readiness` jest siatką bezpieczeństwa, której użytkownik nie ma prawa
zobaczyć jako surowego błędu Postgresa.

**Nowa kategoria tagów „Styl wejścia"** (`entry_style`) przejmuje to, co
robiła strategia: nazwanie typu zagrania. Bez interwału — chipy warstw ma
wyłącznie `confluence`, bo tylko konfluencja opisuje warstwę, a nie cały trade.

**Tagi w kolumnie, warstwy od LTF.** Chipy tagów idą jeden pod drugim: przy
zawijanym rzędzie rozwinięty wiersz interwałów przestawiał sąsiadów. Kolejność
`WARSTWY` to teraz `["LTF", "HTF"]` — praca zaczyna się od momentu wejścia,
nie od obrazu z góry. Jedna stała, więc zmiana idzie naraz przez chipy, filtr
„Warstwa TF" i sortowanie wymiaru.

**Zrzuty na karcie trade'a: pasek zamiast ramki.** Ctrl+V słucha całego
dokumentu, więc duża strefa wklejania nigdy nie była drogą, którą się tam
chodzi — zabierała tylko miejsce zdjęciom, czyli treści tej strony. Wariant
`kompakt` daje wąski pasek i większą bazę wiersza galerii
(`BAZA_WYSOKOSCI_WIERSZA_DUZA`). Formularz trade'a i panel dnia zostają na
wariancie pełnym, gdzie zrzut jest załącznikiem, nie treścią.

**Kalendarz w sesji backtestu** to ten sam `MonthGrid` co na pulpicie, z
`linkBase` na sesję — po jednej siatce na każdy miesiąc, w którym coś się
wydarzyło. Kliknięcie dnia bez wpisu wypełnia formularz „dnia bez sygnału" tą
datą; bez tego kliknięcie w kafel nie miałoby odpowiedzi.

---

## ADR-021 — dzień sesji backtestu dostaje własną stronę (2026-08-29)

**Kontekst.** Dzień bez sygnału był wyłącznie wierszem listy na stronie sesji.
Zrzut dało się wgrać dopiero po rozwinięciu wpisu w miejscu, zapisanej notatki
nie dało się poprawić w ogóle (formularz u góry zakładał nowy wpis, nie
otwierał istniejącego), a zdjęcia oglądało się w kaflach wielkości miniatur.
Trade ma na to wszystko własną kartę — dzień odpuszczony świadomie jest
wpisem dziennika dokładnie tak samo i zasługuje na to samo.

**Nowa trasa `/backtest/[id]/dzien/[data]`.** Ta sama budowa co karta trade'a:
nagłówek z datą i powodem pauzy, galeria w wariancie `kompakt` (wąski pasek
wklejania, duże kafle), formularz wpisu, trade'y tego dnia, usunięcie wpisu.
Adres jest stanem — dzień da się wysłać linkiem, czego `?dzien=` na stronie
sesji nie dawało w sposób, który cokolwiek pokazywał.

**Strona działa też dla dnia BEZ wpisu.** Formularz jest wtedy pusty, a
wklejenie zrzutu samo zakłada notatkę (`ensureDayNote`) — kolejność „najpierw
zapisz powód, potem wklej dowód" byłaby odwrotna do tego, jak się pracuje.
Wgranie zrzutu celowo NIE ustawia flagi `no_trade`: zdjęcie jest dowodem, nie
deklaracją, że dzień był bez sygnału.

**Ten sam formularz do zakładania i do poprawiania.** `saveBacktestDayNote`
i tak robi upsert po (dzień, sesja), więc osobny formularz edycji rozjechałby
się z nim przy pierwszej zmianie pola. Na stronie dnia data jest tylko do
odczytu — siedzi w adresie.

**Kafle kalendarza sesji prowadzą na stronę dnia**, nie do parametru adresu.
`MonthGrid` dostał na to prop `linkDnia`; kalendarz dziennika realnego zostaje
przy `?dzien=`, bo tam panel dnia stoi obok siatki i przeładowanie strony
byłoby stratą, nie zyskiem.

**Przy okazji, test e2e konfluencji na dwóch interwałach.** Klikał w chipy
interwałów bezwarunkowo, a kliknięcie PRZEŁĄCZA — drugi przebieg na tej samej
bazie odznaczał to, co pierwszy zaznaczył, i test sprawdzał własną szkodę.
Teraz klika tylko wtedy, gdy pole nie jest jeszcze zaznaczone. `check()`
wprost na kontrolce nie przechodzi: checkbox jest `sr-only`, klikalny jest
wyłącznie `<label>`.

---

## ADR-022 — godziny trade'a są w czasie giełdy, nie użytkownika (2026-08-30)

**Kontekst.** Błąd zgłoszony wprost: „podaję godziny wedle nowojorskiej i
zapisuje złą sesję". Formularz czytał `entryTime`/`exitTime` przez
`fromLocalInput(..., settings.timezone)`, czyli domyślnie w strefie
`Europe/Warsaw`. Kto przepisuje godziny z wykresu — a tak się pracuje —
wpisywał czas nowojorski, a system rozumiał go jako warszawski. Wejście 09:35
z otwarcia sesji lądowało jako 03:35 w Nowym Jorku, więc `market_session`
wychodziło „overnight" zamiast „rth", a przy godzinach po 18:00 przesuwał się
też `trading_day`, bo sesja CME otwiera się właśnie o 18:00 czasu giełdy.

Błąd był niewidoczny: liczba w polu zgadzała się z tym, co użytkownik wpisał,
a kłamały dopiero statystyki po sesjach i kalendarz.

**Godziny wpisuje się w strefie giełdy instrumentu** (`exchangeTimezone`),
nie w strefie z ustawień. To ta sama strefa, w której już liczyły się
`marketSession` i `tradingDay`, więc znika cała klasa rozjazdów, a przy
instrumencie z innej giełdy działa bez dodatkowej konfiguracji. Alternatywa —
przestawienie `settings.timezone` na `America/New_York` — naprawiałaby jeden
przypadek i psuła resztę: to samo ustawienie steruje datami w dzienniku.

**W tej samej strefie się pokazuje.** Karta trade'a, lista i tabela czytają
`trade.exchangeTimezone`. Wpis 09:35 wracający jako 15:35 byłby drugą wersją
tego samego błędu, tylko po stronie odczytu. Prop `timezone` w `TradeList`
i `TradesTable` zniknął — nie miał już czego opisywać.

**Pole mówi, w jakiej strefie jest.** Etykiety wejścia i wyjścia noszą podpis
„Czas giełdy — Nowy Jork". Bez niego 09:35 z wykresu i 09:35 z zegarka
wyglądają identycznie, a dzieli je sześć godzin i inna sesja rynkowa.
Podpowiedź „teraz" przy nowym trade'zie też jest z zegara giełdy.

**Historia nie jest ruszana automatycznie.** Trade'y sprzed tej zmiany mają
momenty przesunięte o różnicę stref, ale tylko użytkownik wie, od kiedy
wpisywał czas nowojorski. Naprawę robi `scripts/przesun-godziny.ts`:
domyślnie suchy bieg, przesuwa ściankę zegara ze strefy źródłowej do strefy
giełdy i przelicza kolumny pochodne tym samym kodem, co zapis z formularza.
Zapis dopiero po `--zapisz` i po kopii bazy.

---

## ADR-023 — jeden kalendarz sesji z przełącznikiem miesiąca (2026-08-30)

Kalendarz sesji backtestu rysował siatkę na KAŻDY miesiąc z wpisami naraz.
Przy sesji rozciągniętej na kilka lat dawało to kilkanaście siatek pod sobą,
w większości pustych — nie dało się tego czytać, a szukanie miesiąca z danymi
polegało na przewijaniu.

Teraz jest jedna siatka i nawigacja `‹ początek ›`, ta sama, co w kalendarzu
dziennika (`MonthNav`, wydzielony z `/calendar` — jeden komponent zamiast
dwóch kopii tego samego bloku). Pod siatką stoi lista miesięcy, które
faktycznie mają wpisy, więc skok do stycznia 2023 to jedno kliknięcie,
a nie dwadzieścia przewinięć.

Miesiąc jest parametrem adresu (`?miesiac=`), nie stanem klienta: widok da się
wysłać linkiem, a powrót z karty dnia wraca na ten sam miesiąc. Domyślny
miesiąc to PIERWSZY z wpisami — sesję backtestu czyta się od początku
zakresu, nie od dzisiaj.

## ADR-024 — trade nie wzięty jako wartość statusu (2026-08-30)

Dziennik umiał zapisać, że dnia nie było czego brać (`day_notes.noTrade`,
ADR-006). Nie umiał zapisać sytuacji odwrotnej: setup był, tylko go nie
wziąłem. A to jest ten drugi rodzaj błędu — nie zła egzekucja, tylko brak
decyzji — i do wczoraj nie było go widać nigdzie.

Trade nie wzięty to **nowa wartość enuma `trade_status`**, nie osobna kolumna
logiczna. Cały aparat statystyk przechodzi przez jeden filtr, `closedOnly`
(`status === "closed"`), więc jedna wartość wystarczyła, żeby pominięte
zniknęły z winrate, PnL, krzywej kapitału, obsunięcia, kalendarza, Edge
Findera i dyscypliny — bez zmiany w ani jednym module domeny. Żaden z nich
w ogóle nie zna statusu. Kolumna logiczna wymagałaby poprawki `closedOnly`
tak samo, a dodatkowo otwierałaby stany, których nic nie pilnuje: pozycja
otwarta i jednocześnie nie wzięta.

`closedOnly` zostaje dosłownie przy `"closed"` i to jest cała bariera. Obok
stoi `maWynik` z `lib/domain/status.ts`, które mówi `true` także dla
pominiętego — bo trade nie wzięty **ma policzony wynik**. Wpisujesz wejście,
stopa i wyjście, a system liczy R i PnL normalnie, tylko oznacza je jako
hipotetyczne. Bez tego panel „Pominięte" nie miałby czego pokazać, a pytanie
„ile mnie kosztowało to, że nie wszedłem" zostałoby bez odpowiedzi. Dwie
funkcje, które wyglądają na niekonsekwencję, są dwoma różnymi pytaniami:
„czy to wchodzi do statystyk" i „czy to ma wynik".

Blok kierunku (ADR-018) pominiętego **nie dotyczy** i celowo dalej pyta
o `"closed"`. „Kierunek dobry, zawiodła egzekucja" zakłada, że egzekucja
w ogóle była.

Trade nie wzięty **nie unieważnia flagi „dzień bez transakcji"** — to jedyny
wyjątek od zasady z ADR-006, że trade'y wygrywają z flagą. `countTradesOnDay`
i `countSessionTradesOnDay` go pomijają, bo pominięty trade nie jest dowodem
na to, że dzień był handlowy. Jest dowodem na to, że nie był.

Galeria zmienia domyślne źródło na „wszystko" u siebie, w `galeria/page.tsx`,
a nie w `parseFilters` — dokładnie tym samym chwytem, co nadpisanie
`withShots` (ADR-019). `/trades` i `/stats` dalej startują z dziennika
realnego. W parze z tym idzie nowy, trójstanowy wymiar `?pominiete=`:
`status=missed` wyrażał „tylko nie wzięte", ale nie było jak powiedzieć „bez
nie wziętych".

Migracja jest nieodwracalna: Postgres nie umie usunąć wartości z enuma, więc
odwrót wymaga przepisania typu, nie cofnięcia pliku. Cofnięcie samej aplikacji
na starszy obraz jest bezpieczne, ale degraduje — stary kod nie zna klucza
`missed`, więc etykieta statusu renderuje się pusta, a `countTradesOnDay` bez
wyjątku znów policzy pominięte setupy jako trade'y dnia i zablokuje znacznik
„dzień bez transakcji". Statystyki zostają czyste, bo stare `closedOnly` też
pyta dosłownie o `"closed"`.

**Dryf zakresu ponad plan (dopisane po recenzji 2026-08-30).** Dwie zmiany
wyszły poza to, co ta ADR pierwotnie planowała, i obie zasługują na osobny
zapis, żeby nie wróciły jako „błąd" w kolejnym audycie.

Pierwsza to token `--color-flat` w `globals.css`. Kafel BE w galerii miał być
odróżnialny od pominiętego trade'a — ale przy tej okazji odkryto, że
`--color-flat` był identyczny z `--color-faint` (#838f9d), więc wynik BE był
wizualnie nierozróżnialny od tekstu wyciszonego (kontrast 1,00, zmierzone na
pikselach). Poprawka zmieniła sam token na #bfc7d0, nie tylko klasę w galerii
— dotyczy to więc **każdego** wyświetlenia wyniku BE w całej aplikacji
(tabela, karta trade'a, lista, kalendarz), nie tylko przebudowanej galerii.
Świadome, pożądane rozszerzenie zakresu, ale nie było go w pierwotnym planie
tej ADR.

Druga to zachowanie przy przełączeniu statusu `closed → missed`.
`normalizujKierunek` (patrz `lib/actions/trades.ts`, parametr `oceniane`)
liczy trafność kierunku tylko dla statusu `"closed"` — zapis z jakimkolwiek
innym statusem, `"missed"` włącznie, dostaje `kontekst.oceniane === false`
i wraca z pustym wynikiem: `directionCorrect`, `badExecutionReason` i
`potentialR` idą na `NULL`. Efekt: użytkownik, który miał zamknięty trade
z ocenionym kierunkiem i przełączy go na „nie wzięty" (np. korygując
pomyłkę przy wpisywaniu), **traci tę ocenę bezpowrotnie** — formularz nie ma
skąd jej odtworzyć, trzeba wpisać ją ponownie ręcznie. To świadome
zachowanie (kierunek dobry/zły zakłada egzekucję, a „missed" jej nie ma —
patrz akapit o bloku kierunku wyżej), nie błąd, ale nieodwracalność bez
ostrzeżenia w UI jest warta świadomości przy kolejnym audycie interfejsu.

---

## ADR-025 — częściowe realizacje zysku (2026-08-30)

**Kontekst.** Dziennik od początku zakładał jedno wejście i jedno wyjście, a częściowe
realizacje kazał wpisywać jako cenę uśrednioną — patrz „Odstępstwo — świadomie poza
zakresem" wyżej. To obejście trzyma się, dopóki pytamy o pieniądze: uśredniona cena plus
kwota z rachunku (ADR-016) dają poprawny `pnl`. Rozsypuje się, gdy pytamy o **decyzję**.
Trade, w którym jeden kontrakt wyszedł na +1R, a drugi na +3R, po uśrednieniu wygląda
identycznie jak trade, w którym oba wyszły na +2R. A różnica między nimi jest dokładnie
tym, o co dziennik ma pytać: czy branie zysku po kawałku pomaga, czy szkodzi.

**Wyjście przestaje być polem trade'a, a staje się wierszem w `trade_exits`.** Jedno wejście,
wiele wyjść. Każdy kawałek ma własną cenę, liczbę kontraktów, czas, opcjonalną kwotę
z rachunku i notatkę. Odrzucona alternatywa: trzymanie kawałków w `trades.custom` (JSONB).
Poszłaby szybciej, ale te liczby wchodzą do statystyk, do filtrów SQL i do wymiarów Edge
Findera, a JSONB nie da się na to sensownie zaindeksować ani porównać liczbowo — to samo
rozumowanie, które w ADR-018 wypchnęło kierunek do prawdziwych kolumn.

**Ten wpis uchyla punkt „wiele wejść i wyjść w jednym trade'zie" z sekcji „świadomie poza
zakresem" (2026-08-21).** Uchylona jest tylko połowa dotycząca wyjść. **Częściowe wejścia
zostają poza zakresem** — i to nie jest odkładanie na potem, tylko decyzja. Dokładanie do
pozycji rozmywa cenę wejścia w średnią ważoną, a wtedy przestaje być oczywiste, czym jest
1R: ryzykiem pierwszej transzy, ostatniej, czy całości po uśrednieniu. Dopóki nie ma na to
odpowiedzi, której da się bronić w statystykach, wejście zostaje jedno. Precedens na
uchylenie zapisu z tej sekcji: ADR-017 wobec ADR-014.

**1R to ryzyko pozycji, którą otworzyłeś, i nie zmienia się przy zdejmowaniu kawałków.**
`riskAmount` liczy się dalej z pełnej liczby kontraktów z `trades.contracts`.
Odrzucona alternatywa: przeliczanie ryzyka po każdym częściowym wyjściu, proporcjonalnie do
tego, co zostało. Brzmi precyzyjniej, a jest gorsze — R przestałoby być porównywalne między
trade'ami, bo ten sam ruch ceny dawałby inne R w zależności od tego, ile kawałków zdążyłeś
zdjąć wcześniej. Mianownik ma opisywać decyzję o wielkości pozycji, podjętą raz, przy wejściu.

**P&L zaokrągla się raz na kawałek, nie raz na końcu.** `pnl_i` liczy się osobno dla każdego
wyjścia i dopiero potem sumuje. Dzięki temu trade z jednym wyjściem daje co do centa tę samą
liczbę, co dawał stary model jednowyjściowy — backfill całej historii jest bezstratny,
co sprawdza test regresyjny na siatce przypadków w `calc.test.ts`. Instrumentem, który to
łapie, jest ZN: tick 15,625 USD nie jest całkowity w centach, więc kolejność zaokrągleń
faktycznie zmienia wynik.

**`trades.exit_price` i `trades.exit_time` zostają, ale jako pola pochodne.** Cena wyjścia to
odtąd średnia ważona kontraktami, czas wyjścia to czas ostatniego kawałka. Nie są już
niezależnym źródłem prawdy — wylicza je `computeTrade`, tak jak resztę kolumn wyliczanych
(ADR-003). Kasowanie ich byłoby dużo szerszą zmianą bez zysku: czyta je warstwa zapytań,
`whereClause`, tabela i lista.

**`ticks` też jest średnią ważoną — i nie wolno jej liczyć z uśrednionej ceny.**
`moveInTicks(entry, cena_srednia)` daje w ogólności inną liczbę niż średnia ważona
pojedynczych ruchów, bo każdy kawałek zaokrągla się do pełnego ticka osobno, a to nie jest
operacja liniowa. Zapisane wprost w komentarzu w `calc.ts`, bo to jest dokładnie ten rodzaj
„uproszczenia", które ktoś kiedyś wprowadzi w dobrej wierze i po cichu rozjedzie statystyki.

**Nowa miara: `scaling_r` — ile R dała sama decyzja o skalowaniu.** Wynik faktyczny minus
wynik, jaki dałaby cała zamknięta część wyjęta jednorazowo po cenie ostatniego kawałka,
podzielone przez ryzyko. Dodatnia znaczy, że branie zysku po drodze pomogło; ujemna, że
zostawiłeś pieniądze na stole. `null` przy jednym wyjściu i przy braku stopa — zero
kłamałoby, że skalowania nie było albo że nic nie dało.

**`scaling_r` liczy się wyłącznie na siatce ticków, z pominięciem wszystkich kwot z rachunku** —
i tej z trade'a, i tych z kawałków. Ta miara ocenia decyzję: kiedy i po ile zdejmować.
Kwoty brokera niosą poślizg, prowizję i sposób wypełnienia zleceń, czyli rzeczy, których ta
miara nie ocenia, a które zaszumiłyby porównanie z wariantem kontrfaktycznym — bo dla
„gdyby wszystko wyszło na ostatniej cenie" żadnej kwoty z rachunku po prostu nie ma.
To świadome odstępstwo od ADR-016: tam kwota z rachunku jest prawdą o pieniądzach,
tutaj pytamy nie o pieniądze, tylko o jakość decyzji.

**Kolejność pierwszeństwa kwot, jako rozwinięcie ADR-016: trade → kawałek → siatka ticków.**
Kwota wpisana dla całego trade'a nadal bije wszystko. Poniżej niej kawałek może mieć własną
kwotę z rachunku, gdy broker rozliczył wypełnienia osobno. Dopiero bez obu liczy się z ticków.

**Pozycja częściowo zamknięta jest otwarta.** Gdy suma kontraktów z wyjść jest mniejsza niż
wielkość pozycji, status wraca jako `open` — nawet jeśli użytkownik wybrał „zamknięty".
Zysk zrealizowany jest policzony i pokazany, ale trade **nie wchodzi do statystyk**: bariera
to dalej dosłownie `closedOnly` (`status === "closed"`), nietknięta od ADR-024. Alternatywa
„niech `closed` znaczy tyle, ile wpisano" byłaby prostsza i cicho psułaby każdą miarę,
bo połowa pozycji liczyłaby się jako cały trade. Statusy `closed` i `missed` wymagają, żeby
wyjścia sumowały się do całości.

**Czas wyjścia zostaje wymagany przy trade'cie rozstrzygniętym.** Dawny formularz żądał
jednej daty wyjścia i ten wymóg obowiązuje dalej, tylko teraz dotyczy każdego kawałka przy
statusie `closed` i `missed`. Bez czasu `duration_s` jest `null`, więc trade po cichu
wypadałby ze statystyk czasu trzymania, a przy kilku wyjściach czas jest dodatkowo tym, co
ustala ich kolejność — a od kolejności zależy `scaling_r`. Kolumna `trade_exits.exit_time`
zostaje mimo to NULLABLE: potrzebują tego pozycje otwarte i kawałki wpisywane w trakcie,
gdy godziny jeszcze się nie zna.

**Bez CHECK-a pilnującego sumy kontraktów.** Postgres nie wyrazi ograniczenia sięgającego do
drugiej tabeli, a walidacja i tak musi siedzieć w akcji zapisu, żeby użytkownik dostał zdanie
po polsku, a nie surowy komunikat bazy — ta sama zasada, co przy `normalizujKierunek`
(ADR-018). W zamian zapis idzie w transakcji: rozjazd między `trades.pnl` a zawartością
`trade_exits` byłby kłamstwem, którego nikt by nie zauważył.

**Wymiar „częściowe wyjścia" w Edge Finderze jest oznaczony jako `outcomeDerived`.** Skaluje
się prawie wyłącznie trade'y, które są na plusie, więc bez tej flagi Edge Finder ogłaszałby
przewagę, która jest tylko odbiciem wyniku — dokładnie ten sam błąd, przed którym broni się
`badreason` i `directionHit` w ADR-018.

**Koszt / znany brzeg, zaakceptowany świadomie:** `pnl` nie da się odtworzyć z `ticks`, gdy
trade był skalowany — średnia ważona ruchu przemnożona przez wszystkie kontrakty da inną
liczbę niż suma kawałków. To nie jest nowy brzeg: ADR-016 rozerwał ten związek już wcześniej,
dopuszczając kwotę z rachunku. Zapisane, żeby nikt nie próbował używać `ticks` jako skrótu
do pieniędzy.

Migracja `drizzle/0014_czesciowe_wyjscia.sql` — zakłada `trade_exits`, dokłada
`closed_contracts`, `exit_count` i `scaling_r` do `trades`, a każdemu istniejącemu trade'owi
z wypełnioną ceną wyjścia daje dokładnie jeden wiersz-potomek. Kwota z rachunku nie schodzi
do kawałka, bo przy sumowaniu podwoiłaby wynik. `scaling_r` zostaje NULL dla całej historii:
każdy stary trade ma jedno wyjście, więc miara nie ma tam sensu — to poprawny stan, nie brak danych.

---

## ADR-026 — synchronizacja z TradingView i FX Replay przez API z tokenem (2026-10-05)

**Kontekst.** Dziennik był od początku ręczny, a „synchronizacja z brokerami" i „asystent AI"
stały na liście rzeczy świadomie poza zakresem. Użytkownik prowadzi teraz osobne repozytorium
(„mózg tradingowy" w Obsidianie), które widzi wykres w TradingView Desktop i w FX Replay,
zapisuje trade'y, robi zrzuty i ocenia je względem reguł. Dziennik ma dostać stamtąd gotowe
dane, zamiast przepisywać je ręcznie. Zakres: sekcja 4 zatwierdzonego planu (v2, 2026-10-05).

**Co z listy „poza zakresem" zostaje, a co się zmienia.** Synchronizacja z **brokerami** zostaje
poza zakresem: aplikacja nie zna żadnego brokera ani rachunku. Wchodzi **API, do którego klient
wysyła dane** (push). Aplikacja niczego nie pobiera i niczego nie wie o TradingView ani FX Replay
poza kształtem payloadu i prefiksem klucza (`tv:`, `fxr:`). „Asystent AI" też nie wchodzi do
aplikacji: AI mieszka w repozytorium mózgu, a aplikacja przechowuje wyłącznie jego **oceny** (ADR-028).

**Push, nie pull.** Pull wymagałby od aplikacji na Hetznerze dostępu do wykresu użytkownika
i jego sesji w FX Replay. Push odwraca zależność: klient ma dostęp do wszystkiego, aplikacja ma
jeden zamknięty endpoint i nic więcej.

**Brama (`withIngest`, `lib/ingest/with-ingest.ts`) — kolejność ma znaczenie:**

1. Brak (albo zepsuta) zmienna `INGEST_TOKEN_SHA256` → **404**. API nie istnieje, dopóki
   właściciel go świadomie nie włączy; po wdrożeniu kodu bez zmiennej nie ma żadnej nowej powierzchni.
2. Produkcja bez HTTPS → 403 (wg ostatniego `X-Forwarded-Proto`, jak ciasteczko sesji).
3. Blokada po **8 błędnych tokenach** → 429, **przed** porównaniem, żeby zablokowany klient nie mógł
   dalej zgadywać. Używa istniejącego `checkRateLimit`/`recordFailedAttempt` z `auth/guard.ts` pod
   kluczem `ingest:<adres>`, więc nie ma drugiego mechanizmu blokad.
4. Token → 401. Na serwerze leży **tylko skrót SHA-256**; porównanie `timingSafeEqual` na 32 bajtach.
   Szybki SHA-256 wystarcza, bo token to długi losowy ciąg, a nie hasło (w odróżnieniu od scrypta
   przy haśle z ADR-005).
5. Limit **120 zapytań na minutę** na adres → 429 z `Retry-After`.
6. Wyjątek w handlerze → 500 bez szczegółów technicznych dla klienta; identyfikator zapytania
   (`x-request-id`) wiąże odpowiedź z wpisem w logu.

Adres klienta to **ostatni** wpis `X-Forwarded-For`: dopisuje go zaufane proxy, a wpisy z lewej
może podstawić sam klient — przy pierwszym wpisie wystarczyłby losowy nagłówek, żeby każda próba
miała świeży licznik. Znany koszt: gdyby przed Traefikiem stało jeszcze jedno proxy (CDN), ostatnim
wpisem byłby jego adres i blokada objęłaby wszystkich za nim.

**Trasy nie przechodzą przez `proxy.ts`** (wykluczone w matcherze) z dwóch powodów: proxy buforuje
i obcina ciało powyżej 10 MB, a multipart ze zrzutami ma limit 11 MB; i te trasy nie mają
ciasteczka, więc proxy przekierowałoby każde zapytanie klienta na `/login`. Skoro cała autoryzacja
siedzi w opakowaniu, `guard.test.ts` czyta źródła tras i **pada, gdy jakakolwiek eksportuje handler
bez `withIngest`** (albo coś poza handlerami i konfiguracją Next). Sprawdzone mutacją: dopisana
trasa z gołym `export async function GET` łamie test.

**Limity ciała liczone na strumieniu**: JSON 1 MB, multipart 11 MB. Nagłówek `Content-Length`
można pominąć albo skłamać, więc bajty liczy się w trakcie czytania i przerywa po przekroczeniu.

**Idempotencja po `external_ref`** (`tv:<id>` / `fxr:<id>`, unikalny indeks częściowy). Wynik każdej
pozycji paczki osobno (jedna zła nie blokuje reszty):

| Wynik | Znaczenie |
|---|---|
| `created` | nowy wiersz |
| `updated` | `mode=update`, treść się zmieniła |
| `unchanged` | ta sama treść (skrót), albo `mode=create` na istniejącym |
| `conflict` | wpis edytowano w aplikacji po ostatnim zapisie API |
| `skipped` | klucz w `ingest_skips` (pominięty przez klienta albo skasowany w aplikacji) |
| `error` | walidacja albo zapis; komunikat mówi co, dlaczego i jak poprawić |

**Konflikt = `updated_at > ingested_at`.** `persistTrade` ustawia oba pola **jedną** chwilą, więc
zapis przez API nigdy nie kwalifikuje sam siebie jako edycji użytkownika, a każda edycja w formularzu
(który nie dotyka kolumn synchronizacji) podbija `updated_at` ponad `ingested_at`. Zmiany użytkownika
wygrywają i nic nie jest nadpisywane. **Znany brzeg:** konflikt nie ma ścieżki rozwiązania z poziomu
API — trade edytowany ręcznie jest od tej pory „własnością użytkownika", a jedyne wyjście to jego
skasowanie w aplikacji (powstaje nagrobek, trade się już nie wróci). To świadome: ścieżka „wymuś"
dałaby klientowi narzędzie do kasowania ręcznych poprawek.

**Skrót treści** (`source_snapshot->>'hash'`, sha256 ze stabilnie posortowanego JSON-a payloadu bez
pola `snapshot`) pozwala rozpoznać `unchanged` bez porównywania pól. W `source_snapshot` leży
też sam payload i `snapshot` klienta — do diagnozy rozjazdów, nigdy do statystyk.

**Nagrobki.** Skasowanie trade'a z `external_ref` zapisuje wiersz `ingest_skips(reason='deleted')`
**w tej samej transakcji**. Trzy miejsca kasują trade'y: `deleteTrade`, `deleteMany` i
`deleteBacktestSession` (kaskada) — wszystkie trzy poprawione (grep `delete(trades)` i kaskad
po `backtest_session_id`; to ta sama klasa błędu). Bez nagrobka następna synchronizacja
wskrzesiłaby wszystko, co użytkownik usunął. Skasowanie samej sesji nie zostawia nagrobka sesji:
`POST /backtest-sessions` założy ją od nowa, a jej trady i tak są zablokowane własnymi nagrobkami.

**`dryRun`.** `persistTrade(…, {dryRun})` przechodzi całą walidację i `computeTrade`, zwraca
policzony podgląd (`pnl`, R, sesja rynkowa) i **nie otwiera transakcji**. Test E2E porównuje
liczby wierszy w `trades`, `backtest_sessions` i `ingest_skips` przed i po.

**Czasy tylko ISO 8601 z offsetem lub `Z`.** Czas bez strefy jest niejednoznaczny (ADR-022: 09:35
warszawskie i 09:35 nowojorskie to dwa różne trade'y), więc jest błędem, a nie domysłem.
Formularz dalej czyta czas lokalny w strefie giełdy; API przekazuje gotową `Date`.

**Symbole (`mapujSymbol`, `domain/tradingview.ts`).** `NQ`, `NQ1!`, `MNQ1!`, `CME_MINI:NQZ2026`,
`NQZ26`, `ESH6` → symbol z katalogu. **CFD (`US100`, `NAS100`, `USTEC`) nie jest mapowane po
cichu**: to inny produkt niż kontrakt futures (inna wielkość punktu), więc zamiana dałaby wynik
w pieniądzach zły o czynnik, którego nikt by nie zauważył. Nieznany symbol to błąd z listą znanych.
Jeśli FX Replay okaże się nazywać kontrakt „US100", dopisuje się alias w `ALIASY` świadomą decyzją.

**Zrzuty z API zastępują zrzuty tego samego pochodzenia** (`screenshots.origin`:
`manual|tradingview|fxreplay`) i **nie ruszają ręcznych**. Najpierw zapis nowych, potem skasowanie
starych (wiersze i pliki): przerwanie w połowie zostawia nadmiar, a nie pustkę, a ponowienie
zapytania to naprawia. Limit 8 liczy się od tego, co zostaje.

**Tagi nie są zakładane automatycznie.** API przyjmuje `tagId` albo parę `category`+`name`;
nieznany tag to błąd z odesłaniem do `GET /meta`. Zakładanie słownika przez nienadzorowanego
klienta zaśmiecałoby go literówkami.

**Migracja `0015_tradingview.sql`** (ręczna, bez snapshotu — dług z ADR-017 trwa): nowe dziedziny
wartości jako `text` + `CHECK`, nigdy `ALTER TYPE … ADD VALUE` (migrator drizzle owija jedną
transakcją całą serię zaległych plików). Sprawdzona oboma migratorami (drizzle lokalnie i
`scripts/migrate.mjs` z obrazu) na świeżej bazie.

**Koszt i ograniczenia.** Liczniki blokady i limitu są w pamięci procesu: restart kontenera je
zeruje, a dwa kontenery miałyby osobne liczniki — przy jednym kontenerze i jednym kliencie to
wystarcza (ta sama decyzja co przy logowaniu). Token to jedna wartość: rotacja = zmiana zmiennej
i restart, bez okresu przejściowego.
*(do wygaszenia — ADR-030, 2026-10-14: tokeny urządzeń w bazie zastępują `INGEST_TOKEN_SHA256`;
brama `withIngest` zostaje do końca okresu przejściowego.)*

---

## ADR-027 — kategorie trade'ów wynikają z konta, a backtest i forward są rodzajem sesji (2026-10-05)

**Kontekst.** Wynik na koncie prop w fazie oceny (challenge) nie znaczy tego samego co wynik na
koncie z prawdziwymi pieniędzmi, a test na bieżących danych (forward) to inna próba niż replay
historii. Statystyki mieszające je w jedną liczbę kłamią o jednym albo o drugim.

**Kategoria (`realne | prop_eval | prop_funded | demo`) jest wyliczana z konta**
(`accounts.type` + nowa `accounts.prop_phase`), a nie zapisana na trade'u. Odrzucona alternatywa:
kolumna `category` w `trades`. Zmiana fazy konta z `eval` na `funded` (zdany challenge) musi
przesunąć całą jego historię, a przy kolumnie na trade'u wymagałaby masowego `UPDATE` i istniałaby
chwila, w której konto i jego trady się nie zgadzają. Mapowanie jest w jednym czystym
module (`domain/kategorie.ts`), filtr SQL w `filters.ts` (`kategoria=`, lista).

**Konto prop bez podanej fazy nie należy do żadnej kategorii.** Zgadywanie (`eval`) fałszowałoby
obie grupy; interfejs ma o fazę prosić. `CHECK` w bazie pilnuje, żeby faza wisiała wyłącznie przy
koncie typu `prop` (sprawdzone na prawdziwej bazie: wstawienie `live` + `eval` jest odrzucane).
`demo` obejmuje też `paper`.

**Backtest i forward to `backtest_sessions.kind`**, nie kategoria konta: dotyczą sesji, a trade
w sesji ma konto tylko dlatego, że `account_id` jest `NOT NULL`. Filtr `zrodlo=` zyskuje wartość
`forward`.

**Zmiana znaczenia `zrodlo=backtest`:** do tej pory oznaczał „każdy trade z sesji", teraz „trade
z sesji rodzaju backtest". Nie psuje to danych (wszystkie istniejące sesje mają `kind='backtest'`
z wartości domyślnej), ale po założeniu pierwszej sesji forward przestaje ona wpadać do
`zrodlo=backtest`. Konkretna sesja (`?sesja=`) bije rodzaj. Widok „wszystko" bez zmian.

**Zostaje dla interfejsu:** przełącznik źródła w galerii zna jeszcze trzy wartości; `forward` na
nim nie ma przycisku, a wybrany w adresie podświetli „dziennik".

---

## ADR-028 — ocena AI zamiast odrzuconej samooceny; plan gry w mózgu, nie w aplikacji (2026-10-05)

**Kontekst.** ADR-020 usunął z formularza „Jakość wejścia", „Ocenę wykonania" i „Trade zgodny
z planem": wypełniane **po** wyniku mierzyły głównie nastrój po zamknięciu pozycji. Ocena AI
względem reguł wygląda na tę samą rzecz, więc potrzebuje uzasadnienia, dlaczego nią nie jest.

**Czym ocena różni się od odrzuconej samooceny:**

- **Podstawa jest jawna i rozdzielona** (`trade_reviews.basis`). `chart` to ocena z wykresu na moment
  decyzji, bez wiedzy o wyniku; `history` to ocena po fakcie. Są **dwoma osobnymi wierszami**
  (unikat `trade_id + basis`): ponowne wysłanie podmienia, nie mnoży.
- **`evidence_cutoff`** zapisuje ostatnią świecę, jaką ocena mogła widzieć. „Zero zaglądania
  w przyszłość" przestaje być obietnicą, a staje się czymś, co da się sprawdzić po fakcie.
- **Każde sprawdzenie reguły ma dowód** (`evidence`) i **kopię treści reguły z chwili oceny**
  (`rule_text`). Regułę w mózgu można zmienić; ocena dalej mówi o tym, co faktycznie sprawdzono.
- **Użytkownik się wypowiada** (`user_verdict`: zgadzam się / nie zgadzam się z oceną reguły).
  To miara wiarygodności samej oceny, której samoocena nie miała. Przy ponownym wysłaniu jego zdanie
  **zostaje tylko przy regule, której werdykt AI się nie zmienił**; gdy AI zmieniło zdanie,
  stara odpowiedź dotyczyłaby czegoś innego i jest zerowana.
- **Zestawienie ma uczciwy mianownik** (`domain/zgodnosc.ts`): tylko `pass` i `fail`. `na` i `unclear`
  nie są ani zgodnością, ani złamaniem — idą do osobnego licznika „nieocenione", tak jak
  przy trafności kierunku (ADR-018). Trady bez żadnej oceny też są liczone osobno.
- **Rozstrzyganie przy dwóch ocenach tej samej reguły:** liczy się raz, wygrywa ocena, która coś
  rozstrzygnęła (`pass`/`fail`), a przy remisie ta z wykresu (nie znała wyniku). Ocena po fakcie
  wchodzi tam, gdzie wykres nie rozstrzygnął — typowo przy regułach zarządzania pozycją.
  Ta sama reguła rozstrzygania stoi w SQL filtra i w zestawieniu, żeby lista i liczby obok niej
  nie pokazywały różnych trade'ów (złapane testem na prawdziwej bazie).

**Ryzyko, które zostaje:** ocena `history` jest po fakcie, więc może być pod wpływem wyniku
(efekt aureoli). Dlatego nigdy nie nadpisuje rozstrzygającej oceny z wykresu i da się ją wyłączyć
ze zestawienia (`getZgodnosc(…, "chart")`). Interfejs powinien pokazywać podstawę przy każdej ocenie.

**Plan gry mieszka w mózgu (Obsidian), nie w aplikacji.** Nie ma tabeli `playbook_versions` ani
strony `/playbook`. Aplikacja trzyma wyłącznie to, co jest potrzebne do statystyk i do pokazania
oceny: `rule_id` + kopię treści + `brain_version` (hash commita w repo mózgu, więc ocenę da się
odnieść do wersji reguł, według których powstała). Powód: dwie kopie planu (w mózgu i w aplikacji)
rozjechałyby się przy pierwszej zmianie reguły, a mózg jest źródłem prawdy o wiedzy, aplikacja
— o liczbach.
*(uchylone — ADR-029, 2026-10-14: plan gry, reguły i wszystkie notatki przechodzą do aplikacji,
a Obsidian zostaje wycofany. Powód z tego akapitu — dwie kopie się rozjadą — zostaje w mocy, tylko
jedyną kopią staje się aplikacja. Zasada z akapitu niżej zostaje bez zmian.)*

**Reguły zmienia wyłącznie użytkownik.** API nie ma operacji, która zakłada, zmienia ani zatwierdza
regułę; może tylko ocenić trade względem reguł, które klient przysłał razem z oceną.
*(rozwinięte — ADR-029/030, 2026-10-14: API v2 dostaje operację **propozycji** reguły, ale nadal
nie ma operacji, która ją zatwierdza; zasada „reguły zmienia wyłącznie użytkownik” zostaje.)*

---

> **ADR-029 do ADR-033 (2026-10-14) — przebudowa v2.** Status: **ZAAKCEPTOWANY 14.10.2026**
> przez użytkownika (STOP fazy 0). Słowa użytkownika: «Akceptuję, ruszamy». Plan zatwierdzony przez użytkownika: „Przebudowa dziennika
> tradingowego + łącznik `tj` dla AI” (14.10.2026). Pełny projekt schematu: `docs/v2/model-danych.md`.
> Raporty, na których stoją decyzje: `docs/research/rynek.md`, `docs/research/metodyka.md`.

## ADR-029 — notatki w aplikacji; Obsidian wycofany (2026-10-14)

**Kontekst.** Wiedza i notatki są rozdarte: mózg tradingowy żyje w lokalnym sejfie Obsidiana
(bez zdalnego repo, bo dane finansowe), a dziennik trzyma trade'y i oceny. Na drugim urządzeniu
AI nie ma ani mózgu, ani narzędzi. Decyzja użytkownika z 14.10.2026: „wszystkie notatki
przechodzą do aplikacji, a Obsidian zostaje wycofany”. To odwraca akapit ADR-028 „plan gry
mieszka w mózgu”. Argument tamtego akapitu (dwie kopie planu się rozjadą) zostaje w mocy, tylko
odwraca wniosek: jedyną kopią staje się aplikacja.

**Model hybrydowy: dokument + typowane encje.** Wszystko, co w sejfie było plikiem `.md`, staje
się wierszem `notes` (`kind`, `slug`, `title`, `body_md`, `meta jsonb`, kotwice `trade_id` /
`backtest_session_id` / `day`, `external_ref`, `content_hash`, `search`). Tam, gdzie notatka
niesie liczby albo stan, który coś liczy, obok stoi typowana tabela 1:1: `rules` (R-xxx, status)
i `hypotheses` (H-xxx, `n`, `prog_n`). Odrzucone:
- **sam JSONB w `notes.meta`** — status reguły i `n` hipotezy wchodzą do filtrów, do bramki
  „poniżej progu AI nie proponuje reguły” i do statystyk; tego nie da się sensownie pilnować
  CHECK-iem ani indeksem w JSONB (to samo rozumowanie co ADR-018 i ADR-025);
- **osobna tabela na każdy rodzaj notatki** — 12 rodzajów z sejfu różni się prawie wyłącznie
  nazwą folderu; tabela na rodzaj dałaby 12 kopii CRUD-u, wyszukiwania i linków.

**Historia i linki.** Każda zmiana treści zostawia wiersz w `note_revisions` (zapisuje go
trigger, nie kod aplikacji — nie da się o nim zapomnieć w nowej ścieżce zapisu). Linki `[[...]]`
z treści trafiają do `note_links` przy każdym zapisie; link do notatki, której jeszcze nie ma,
jest dozwolony (`to_note_id` NULL, `to_slug` wypełnione) i dowiązuje się sam, gdy notatka
powstanie — tak działa Obsidian i tak działa import w dwóch przebiegach.

**Optymistyczna współbieżność.** Notatka ma licznik `rev`. Zapis przez API wymaga `If-Match: <rev>`;
nieaktualny `rev` daje 409 z bieżącą treścią. Dwa urządzenia z AI piszące do tej samej notatki
nie nadpiszą się po cichu.

**Wyszukiwanie: konfiguracja `simple` + `unaccent` + `pg_trgm`.** Nie `polish`: Postgres nie ma
wbudowanego słownika polskiego (wymaga plików ispell instalowanych na serwerze, czego Coolify
nie daje bez własnego obrazu bazy). `simple` nie odmienia, więc pełnotekstowe dopasowanie łapie
całe słowa, a `pg_trgm` łapie odmiany i literówki. `unaccent` sprawia, że „zarzadzanie” znajduje
„Zarządzanie” (test w fazie 2). Funkcja `f_unaccent` jest opakowaniem `IMMUTABLE` ze
schematem podanym wprost — goła `unaccent()` jest `STABLE` i nie wolno jej użyć w kolumnie
generowanej ani w indeksie.

**`screenshots.note_id`.** Zrzut może wisieć pod notatką (np. przykład pojęcia ICT). Warunek
`screenshots_owner` rozszerza się z „dokładnie jedno z dwóch” na „dokładnie jedno z trzech”.

**Reguły: agent tylko proponuje.** Zostaje w mocy zasada z ADR-028 i z `mozg-tradingowy/CLAUDE.md`:
regułę zatwierdza wyłącznie użytkownik w UI, **jedna propozycja naraz**, nigdy zbiorczo. Pilnują
tego trzy niezależne warstwy (szczegóły w ADR-030): brak zakresu tokenu, który by na to pozwalał,
403 na trasie, i trigger w bazie, który odrzuca zatwierdzenie, gdy zapis nie przyszedł z sesji UI.

**Import z sejfu nie zatwierdza niczego** (Słowa użytkownika, 14.10.2026: «Jako propozycje,
zatwierdzam ponownie»). Reguły R-004, R-007 i R-010, w sejfie `zatwierdzona`, wchodzą jako
propozycje z notą o statusie w sejfie i użytkownik zatwierdza je w UI po jednej. Trigger nie ma
wyjątku dla importu. Propozycje z wiedzy mentora nie podlegają progowi `n` i są podpisane
„wg mentora, n = 0” (Słowa użytkownika, 14.10.2026: «Bez progu, podpisane n=0»); szczegóły w ADR-033.

**Co dzieje się z `brain_version`.** Kolumna zostaje przy starych ocenach (historia ma się nie
zgubić). Nowe oceny wskazują wersję zestawu reguł z aplikacji (`ruleset_version`, ADR-033), bo
repo mózgu przestaje istnieć jako źródło prawdy.

**Koszt.** Edytor markdown z `[[` i backlinkami trzeba zbudować w UI (faza 5); do tego czasu notatki
pisze się przez `tj notes` i API. Obsidian działa do zakończenia importu (faza 4) i dopiero wtedy,
po decyzji użytkownika, sejf jest archiwizowany.

---

## ADR-030 — API v2: tokeny urządzeń z zakresami, logowanie kodem urządzenia (2026-10-14)

**Kontekst.** ADR-026 dał jeden token w zmiennej `INGEST_TOKEN_SHA256`: rotacja to restart,
nie ma listy urządzeń, każdy klient może wszystko. Łącznik `tj` ma działać na kilku urządzeniach,
a aplikacja staje się publiczna (ADR-031), więc token musi mieć właściciela, zakres i dać się
unieważnić bez restartu.

**Tokeny w bazie (`api_tokens`).** Format `tj_<prefix>_<sekret>`: prefiks (8 znaków) służy do
wyszukania wiersza i do pokazania w UI, sekret (32 losowe bajty) nie jest nigdzie zapisany.
W bazie leży tylko SHA-256 całego tokenu i porównanie idzie `timingSafeEqual` — ta sama
uzasadniona szybka funkcja co w ADR-026 (token to losowy ciąg, nie hasło). Ostatnie użycie
(czas, adres) zapisuje się nie częściej niż raz na minutę, żeby każde zapytanie nie było zapisem.

**Trzy zakresy i czwartego nie będzie.**

| Zakres | Pozwala |
|---|---|
| `read` | wszystkie `GET`, wyszukiwanie, `/meta` |
| `write` | trade'y, zrzuty, notatki i ich treść, słowa użytkownika, rysunki z wykresu, werdykty AI, pominięcia, dzień |
| `propose` | propozycje reguł i wersji setupów, kolejka sugestii AI, hasła słownika, pytania o luki |

Zakresu „zatwierdź” nie ma i CHECK w bazie (`scopes <@ {read,write,propose}`) nie pozwoli go
dopisać bez migracji. Zatwierdzanie reguł, zatwierdzanie sugestii AI, poprawianie słów
użytkownika, kasowanie czegokolwiek i zarządzanie tokenami dzieje się wyłącznie w UI, za sesją.

**Trzy warstwy pilnowania „agent nie zatwierdzi reguły”:**
1. brak zakresu (wyżej);
2. trasa `rules/proposals/:id/approve` nie istnieje w `/api/v2`; test-strażnik czyta źródła
   tras i pada, gdy jakakolwiek trasa v2 dotyka statusu `approved` (test „agent nie zatwierdzi
   reguły (403)” z planu sprawdza też, że próba przez istniejące trasy daje 403);
3. **trigger w bazie**: każde zapytanie v2 działa w transakcji z `set_config('tj.actor', 'api:<id tokenu>', true)`,
   akcje UI ustawiają `tj.actor = 'ui'`. Trigger na `rule_versions` i `setup_versions` odrzuca
   przejście w `approved`, gdy aktorem nie jest `ui`. To obrona przed błędem we własnym kodzie,
   nie przed właścicielem bazy — i tak ma być.

**Logowanie kodem urządzenia (`device_codes`, wzór RFC 8628).** `tj login` woła
`POST /api/v2/device/start` z nazwą klienta i żądanymi zakresami, dostaje `user_code` (8 znaków
bez mylących liter, np. `KTWM-4HQP`) i adres `https://dziennik.panekweb.pl/urzadzenia/polacz`.
Użytkownik loguje się (hasło + TOTP), wchodzi w tryb sudo (ADR-031), **przepisuje kod** z
terminala (nie klika gotowego linku z kodem — to utrudnia phishing kodem urządzenia), widzi nazwę
klienta, adres IP, z którego przyszło żądanie, i zakresy; może je zawęzić. CLI odpytuje
`POST /api/v2/device/token` co 5 s i dostaje token **dokładnie raz**. Kod żyje 10 minut. Skrót
`device_code` (nie sam kod) leży w bazie. Te dwie trasy są jedynymi w v2 bez tokenu; mają własne
opakowanie z limitem (10 startów na godzinę na adres) i test-strażnik zna je z nazwy.

**Brama `withApi({ scopes })`** w `src/lib/api-v2/with-api.ts` uogólnia `withIngest`. Kolejność:
wyłącznik awaryjny `API_V2_DISABLED=1` → 404; produkcja bez HTTPS → 403; blokada po 8 złych
tokenach (przed porównaniem) → 429; token nieznany, unieważniony albo przeterminowany → 401;
brak zakresu → 403 z nazwą brakującego zakresu; limit 120 zapytań na minutę **na token**
(nie na adres — urządzenie zmienia sieć) → 429; handler w transakcji z `tj.actor`; wyjątek → 500
z `x-request-id`. Trasy `/api/v2/**` są wyłączone z matchera `proxy.ts` z tych samych dwóch
powodów co w ADR-026.

**Kontrakt.** Schematy zod 4 w `src/lib/api-v2/contract/` generują `docs/openapi-v2.json`;
test pada, gdy plik jest nieaktualny. `GET /meta` zwraca `contractHash` (SHA-256 pliku), a
`tj doctor` porównuje go ze swoim — dryf kontraktu jest widoczny, zanim cokolwiek się zepsuje.

**Słowa użytkownika przez API.** `user_words` przyjmuje się tylko przez `POST`. Klient wysyła
tekst i swój SHA-256 z bajtów UTF-8; serwer liczy skrót sam (trigger w bazie) i przy niezgodności
odrzuca zapis (400) — to jest test „tekst nie zmienił się w drodze czat → `tj` → API”. Każdy
`PATCH` i `PUT` na słowach użytkownika daje **409** z odesłaniem do UI.

**Werdykt AI z `as_of` jest niezmienny.** Ponowne wysłanie werdyktu z tym samym `as_of` daje 409,
a korekta użytkownika to nowy wiersz `kind = 'user_override'` (ADR-033). To odwraca zdanie
z ADR-028 „ponowne wysłanie podmienia, nie mnoży” dla werdyktów z `as_of`; stare wiersze bez
`as_of` zachowują się jak dotąd.

**Wygaszanie `INGEST_TOKEN_SHA256`.**
1. Faza 2: `/api/ingest/**` przyjmuje stary skrót **albo** token v2 z zakresem `write`. Każda
   odpowiedź niesie `Deprecation: true` i `Link` do `/api/v2`. Logi liczą użycia starego tokenu.
2. Po fazie 3 (łącznik używa wyłącznie v2) i **za zgodą użytkownika**: trasy `/api/ingest/**`
   znikają, zmienna zostaje usunięta z Coolify, `withIngest` i jego test-strażnik idą do kosza.
   Do tego czasu ADR-026 obowiązuje bez zmian.

**Odrzucone.** OAuth z serwerem autoryzacji (jedna osoba, kilka urządzeń — ciężar bez zysku);
JWT bez stanu (nie da się unieważnić pojedynczego urządzenia bez listy, a lista to już stan);
token per zakres zamiast listy zakresów (CLI potrzebuje zwykle `read` + `write` naraz).

**Koszt.** Liczniki blokad i limitów zostają w pamięci procesu (decyzja z ADR-026). Tokeny bez
daty wygaśnięcia domyślnie; UI pokazuje ostatnie użycie i oznacza tokeny nieużywane od 90 dni.

---

## ADR-031 — publiczna domena `dziennik.panekweb.pl`, TOTP 2FA, kody zapasowe, tryb sudo (2026-10-14)

**Kontekst.** Decyzja użytkownika z 14.10.2026: „aplikacja zostaje jednoosobowa, dostępna
z internetu pod subdomeną panekweb.pl z SSL”. Do tej pory chroniło ją głównie to, że adres był
mało znany. Od teraz jedyną barierą jest uwierzytelnienie, a za nim leżą dane finansowe
i tokeny, które piszą do dziennika.

**Domena i transport.** Rekord w Hetzner DNS → serwer; domena i certyfikat Let's Encrypt
w Coolify. **Adres sslip/http zostaje usunięty** — drugi adres bez HTTPS byłby obejściem
wszystkiego niżej. HSTS `max-age=31536000` **bez** `includeSubDomains` i bez `preload`
(pozostałe subdomeny `panekweb.pl` nie są częścią tej aplikacji). `X-Robots-Tag: noindex`
i `robots.txt` bez zmian (odstępstwo „Lighthouse SEO 60” zostaje).

**Ciasteczko sesji.** Na produkcji zawsze `Secure` i `SameSite=Strict` (było: `Secure` tylko
przy HTTPS i `Lax`, ADR-005 — powód tamtego warunku, adres http z Coolify, znika razem z adresem).
Koszt `Strict`: wejście z linku z zewnątrz (np. z maila) trafia na stronę bez sesji i wymaga
kliknięcia jeszcze raz; dla dziennika jednoosobowego to akceptowalne. Do sprawdzenia w fazie 1:
`X-Forwarded-Proto` za Traefikiem i nagłówki `Host`/`Origin`, od których zależy ochrona CSRF
akcji serwera w Next.

**TOTP (RFC 6238).** 6 cyfr, SHA-1, krok 30 s, tolerancja ±1 krok, ochrona przed powtórką
(`settings.totp_last_step` — kod z kroku już użytego jest odrzucany). Sekret szyfrowany AES-256-GCM
kluczem z osobnej zmiennej `TOTP_ENC_KEY`: wyciek samej bazy nie daje sekretu. Włączenie wymaga
hasła, pokazuje kod QR i aktywuje się dopiero po wpisaniu poprawnego kodu. Logowanie dwuetapowe:
po haśle przeglądarka dostaje krótkie (5 min), podpisane ciasteczko „czeka na drugi krok”,
a dopiero po kodzie właściwą sesję. Błędne kody liczą się do tej samej blokady co hasło (8 prób).

**Kody zapasowe.** 10 kodów po 10 znaków, pokazane raz, jednorazowe. W bazie HMAC-SHA256 z
sekretem serwera (nie goły SHA-256: 50 bitów entropii to za mało przy wycieku samej bazy, a scrypt
na 10 kodach spowalniałby logowanie bez potrzeby). Wygenerowanie nowej paczki unieważnia starą.

**Tryb sudo.** Ponowne podanie kodu TOTP (albo kodu zapasowego) daje 10 minut podwyższonych
uprawnień — osobne ciasteczko `HttpOnly`, `Secure`, `SameSite=Strict`, związane z `session_version`.
Wymagane do: zatwierdzenia urządzenia (kod urządzenia), utworzenia tokenu, wygenerowania kodów
zapasowych, wyłączenia 2FA, zmiany hasła, pełnego eksportu. **Unieważnienie** tokenu sudo nie
wymaga — odcięcie dostępu ma być łatwiejsze niż jego nadanie. Zatwierdzanie reguł nie wymaga sudo:
to codzienna praca, a chroni ją sesja z 2FA.

**Dziennik zdarzeń bezpieczeństwa (`auth_events`).** Logowania udane i nieudane, błędne kody,
użycie kodu zapasowego, wejście w sudo, zatwierdzenie urządzenia, utworzenie i unieważnienie
tokenu. Tylko dopisywanie. Widoczny w Ustawieniach → Bezpieczeństwo.

**Wyłączenie 2FA i „wyloguj wszędzie”** podbijają `session_version` (mechanizm z ADR-005)
i opcjonalnie unieważniają wszystkie tokeny jednym przyciskiem.

**Odrzucone na teraz.** Passkey/WebAuthn (rekomendacja planu: później; wymaga biblioteki i testu
na telefonie, a TOTP daje 2FA od razu); SMS i e-mail jako drugi składnik (słabsze i wymagają
dostawcy); Cloudflare Access albo VPN przed aplikacją (PWA na telefonie i `tj` z dowolnego
urządzenia muszą działać bez klienta VPN).

---

## ADR-032 — łącznik `Paneksu/tj-connector` jako plugin Claude Code; AI steruje wykresem, nigdy nie składa zleceń (2026-10-14)

**Kontekst.** Łącznik to dziś luźne skrypty (`wyslij.mjs` z zaszytą ścieżką do sekretów), niesprawdzony
na żywo klon tradingview-mcp i metoda czytania FX Replay, której skrypty zaginęły. Decyzja
użytkownika z 14.10.2026: łącznik ma postać CLI `tj` + serwera MCP + skilli w jednym
**prywatnym** repo GitHub.

**Jedno repo, trzy pakiety (npm workspaces, ESM `.mjs` + `@ts-check`, Node ≥ 22):**
`packages/core` (klient API v2, konfiguracja, tokeny, port `ict.mjs` i `mapa-dziennika.mjs`,
czytniki FX Replay i TradingView, sterowanie wykresem), `packages/cli` (`tj`), `packages/mcp`
(stdio, narzędzia 1:1 z CLI). Do tego `skills/` i `.claude-plugin/` + `.mcp.json`. MCP i CLI są
cienkie: cała logika w `core`, więc to samo zachowanie testuje się raz. TypeScript z kompilacją
odrzucony: łącznik ma działać po `git clone` + `npm i` bez kroku budowania.

**Instalacja jako plugin Claude Code** (`tj setup claude` dodaje marketplace z prywatnego repo
i instaluje plugin). Plan B: `claude mcp add --scope user` + kopie skilli. Przed implementacją
`claude-code-guide` potwierdza, że plugin z prywatnego repo poprawnie podaje ścieżkę serwera MCP.

**Sekrety.** Token urządzenia (ADR-030) w katalogu konfiguracyjnym systemu (`%APPDATA%\tj\`
na Windows, `~/Library/Application Support/tj/` na macOS), plik z uprawnieniami tylko dla
użytkownika, nigdy w repo. Klient API: `https` poza `localhost`, `redirect: "error"` (przekierowanie
nie może zanieść nagłówka `Authorization` gdzie indziej), token wycinany z logów i błędów.
gitleaks w pre-commit i w CI; dane testowe wyłącznie syntetyczne.

**AI steruje wykresem — zmiana dotychczasowego „tylko odczyt”.** Słowa użytkownika (14.10.2026):
„żeby AI robiło screenshoty samo i umiało samo sterować wykresem i zmieniać timeframe, tak
naprawdę wszystko co robi człowiek, ale też jak mu wyślę zdjęcie to użyje tego”. Wspólne API
sterowania w `core/chart/` z dwoma sterownikami (TradingView Desktop przez tradingview-mcp,
CDP 9222; FX Replay przez Playwright `connectOverCDP`, CDP 9223, widżet TradingView w iframe).
Listy zakazów zmiany wykresu w `settings.json` obu repozytoriów zostają zdjęte **dla narzędzi
wykresu** i tylko dla nich. Zrzut (`tj shot`) przywraca stan wykresu sprzed zrzutu.

**AI nigdy nie składa zleceń (decyzja użytkownika 14.10.2026).** W żadnym narzędziu, ani w FX
Replay, ani w TradingView, nie ma operacji kupna, sprzedaży, zamknięcia, przesunięcia SL/TP
ani BE. Pilnowanie w trzech miejscach:
1. **kod**: sterownik ma listę dozwolonych akcji (allowlist, nie blocklist); selektory paneli
   zleceń (Buy/Sell/Close, okno zlecenia) i skróty klawiszowe zleceń są dodatkowo na czarnej
   liście, a kliknięcie w ich obszar jest odrzucane przed wysłaniem zdarzenia;
2. **testy**: test przechodzi po wszystkich narzędziach MCP i komendach CLI i pada, gdy
   którekolwiek dotyka zleceń; test na żywo kończy się sprawdzeniem, że nie powstało żadne zlecenie;
3. **Claude**: `settings.json` pluginu zabrania surowego `browser_click` i `evaluate` serwera
   `fxreplay` — sterowanie idzie wyłącznie przez `tj chart`.

Aplikacja tego nie musi pilnować, bo nie ma żadnego połączenia z brokerem (ADR-026 bez zmian).

**Rysunki AI na wykresie** mają stały prefiks `[AI] ` w tekście; `tj chart draw clear --own`
kasuje wyłącznie takie, a `tj chart drawings` pomija je przy zapisie rysunków użytkownika
(ADR-033, `chart_annotations`). Serwer odrzuca rysunek użytkownika z tym prefiksem.

**Treść notatek to dane, nie instrukcje.** Narzędzia MCP zwracają treść notatek i słowa
użytkownika w wyraźnie oznaczonym bloku danych; skille mają regułę, że polecenia znalezione
w treści się ignoruje. MCP nie ma operacji destrukcyjnych (kasowanie tylko w UI).

**TradingView.** `tj tools install tradingview` klonuje `tradesdontlie/tradingview-mcp`
przypięty do przejrzanego SHA; licencja do sprawdzenia przed pierwszym użyciem.

**Odrzucone.** Hostowany serwer MCP po stronie aplikacji (wymagałby, żeby aplikacja na Hetznerze
sięgała do wykresu na komputerze użytkownika — odwrotność decyzji „push, nie pull” z ADR-026);
publiczne repo (dane i ścieżki z komputera użytkownika w historii; decyzja użytkownika: prywatne).

---

## ADR-033 — model funkcji z researchu (2026-10-14)

**Kontekst.** Dwa raporty `market-researcher` z 14.10.2026. Wniosek: rynek importuje trade'y
po fakcie i mierzy wynik, a ten dziennik ma zapisywać kontekst na żywo i oceniać wykonanie.
Przy 30 trade'ach przedział Wilsona ma ok. ±17 pp, więc główną wartością dziennika nie jest
„znajdź edge”, tylko „nie oszukaj się”. AI jest audytorem z dowodami, nie doradcą. Decyzje
użytkownika z 14.10.2026: ocena procesu A/B/C osobno od wyniku; kilka kont prop + presety
najpopularniejszych futures prop firm; PWA; backtest ślepy („losuję, zwykle nie znam”);
próg n=20 jako „do oceny”; sugestie SL/TP/BE od n≥100.

**Zasady przekrojowe, którym podlega każda nowa tabela:**
- **Pochodzenie każdego zapisu** (`origin`: `user` / `ai` / `mentor` / `vault-import`). Statystyki
  domyślnie liczą tylko to, co zatwierdził użytkownik.
- **Słowa użytkownika dosłownie.** Słowa użytkownika z 14.10.2026: „to co piszę w notatce do niego
  i na wykresie zapisywało dosłownie i nie zmieniało moich słów”. Tekst użytkownika żyje w tabeli
  `user_words`: bajt w bajt, bez przycinania i normalizacji, ze skrótem SHA-256 liczonym przez bazę.
  Kolumny tekstu i skrótu są niezmienne (trigger odrzuca każdy `UPDATE` tych kolumn). Poprawka
  w UI to nowy wiersz wskazujący poprzedni (`supersedes_id`) — stary zostaje. `ai_interpretation`
  to osobne pole tego samego wiersza, zawsze podpisane w UI „interpretacja AI”, i tylko ono może
  się zmieniać (przez rejestr poprawek).
- **Co niezmienne, pilnuje baza, nie tylko API**: słowa użytkownika, zamrożony plan, werdykt
  AI z `as_of`, zatwierdzone wersje reguł i setupów, cytaty mentora, dziennik zdarzeń, rejestr
  poprawek. Trigger, a nie tylko brak trasy `PATCH`, bo kolejna ścieżka zapisu (akcja serwera,
  skrypt, import) nie przejdzie przez trasę API.
- **Nowe dziedziny wartości jako `text` + `CHECK`**, nigdy `ALTER TYPE … ADD VALUE` (ADR-026).
- **Pola, których nic nie liczy, nie powstają** (lista „Nie robimy” z planu). Wszystko, co da się
  wyprowadzić z istniejących danych, jest wyprowadzane w `lib/domain`, a nie zapisywane.

**Nowe tabele** (kolumny, ograniczenia i indeksy: `docs/v2/model-danych.md`):

| Tabela | Po co | MUST |
|---|---|---|
| `trade_plans` + `trade_plan_addenda` | plan przed wejściem: setup, bias, wejście, SL, TP, unieważnienie, ryzyko; po zapisie tylko do odczytu, zmiany jako dopiski z czasem | 1 |
| `setups` + `setup_versions` + `setup_examples` | playbook jako struktura: warunki, checklista, SL/TP/BE, unieważnienie, A+ i anty-przykłady, progi statusu zadeklarowane z góry, wersje | 4 |
| `rule_versions` | wersja reguły; propozycja → zatwierdzona → zastąpiona; trade wskazuje zestaw reguł z dnia wejścia | 4, 10 |
| `trade_note_links` | trade ↔ hipoteza / pojęcie ICT / błąd | 4 |
| `hypothesis_variants`, `threshold_changes` | licznik testowanych wariantów; log zmian progów po zobaczeniu wyniku | 5 |
| `prop_firm_presets`, `prop_rules`, `prop_ledger` | presety firm jako dane z URL i datą odczytu; reguły per konto z datą obowiązywania; koszty evali, resetów i wypłaty | 7 |
| `weekly_reviews` | przegląd procesowy z **jednym** zobowiązaniem i rozliczeniem poprzedniego | 9 |
| `ai_suggestions` | kolejka potwierdzeń z pochodzeniem, dowodem, pewnością i `n`; cofalna | 10, 15 |
| `user_words` | słowa użytkownika dosłownie + `ai_interpretation` | 13 |
| `chart_annotations` | rysunki użytkownika z wykresu, tekst 1:1 przez `user_words` | 12, 13 |
| `profile_terms` (+ źródła), `interpretation_corrections` | słownik tradera i rejestr poprawek interpretacji | 14 |
| `note_additions` | dopiski AI i mentora do notatek strategii i kart setupu, z cytatem i linkiem, cofalne | 15, 16 |
| `strategy_gaps` | pytania o luki w strategii i sprzeczności „mentor kontra praktyka” — AI ich nie rozstrzyga | 15, 16 |
| `mentor_sources`, `mentor_claims` | filmy playlisty ze statusem; twierdzenia z dosłownym cytatem i `t=` | 16 |

**Nowe pola w istniejących tabelach.**
- `trades.process_grade` (`A` / `B` / `C`, NULL = nieocenione) — osobno od wyniku; siatka 2×2
  liczy się z niej i z R.
- `trades.setup_id`, `trades.setup_version_id`, `trades.ruleset_version` — wersje obowiązujące
  w chwili wejścia, zapisywane raz.
- `trades.day_known` — opcjonalna flaga na trade'ie z replayu, domyślnie fałsz (raport metodyki,
  R15: przy ślepym backteście czwarte źródło danych nie jest potrzebne).
- `trade_reviews.as_of`, `evidence_hash`, `ruleset_version`, `kind` (`ai` / `user_override`);
  `trade_rule_checks.rule_version_id`. **Odstępstwo od brzmienia planu:** plan wymienia
  `rule_version_id` przy `trade_reviews`, ale jeden werdykt sprawdza kilka reguł naraz, więc
  wersja konkretnej reguły należy do wiersza sprawdzenia, a werdykt dostaje numer całego zestawu.
- `day_notes`: bias, maks. liczba trade'ów, sen (1–5) — rytuał przed sesją; reszta (energia,
  nastrój, notatki) już jest.
- **Źródło danych (backtest / forward / demo / live) jest wyliczane, bez kolumny `data_source`.**
  Słowa użytkownika (14.10.2026): «Wyliczane». Plan wymieniał je jako nową kolumnę `trades`, ale
  wszystkie cztery wartości wynikają z danych, a ADR-027 odrzucił zapis kategorii na trade'ie,
  bo zmiana fazy konta musiałaby przepisać całą historię. Wyliczenie (jedna funkcja
  `zrodloDanych` w `lib/domain/zrodla.ts` i jej lustro SQL w `filters.ts`, test parzystości jak
  przy `wynikTrade`/`sqlWynik` z ADR-011):
  1. trade w sesji (`backtest_session_id` nie NULL) → `backtest_sessions.kind` (`backtest` albo `forward`);
  2. inaczej konto `demo` albo `paper` → `demo`;
  3. inaczej (`live`, `prop`) → `live`; podział `live` na realne / prop eval / prop funded daje
     istniejąca kategoria konta (`kategoriaKonta`, ADR-027).

  Wskaźnik „ile R znika między backtestem a live” per setup grupuje po tej funkcji. Nie mylić
  z `trades.source` (ADR-026: skąd przyszedł wpis — formularz, TradingView, FX Replay).

**Statystyka uczciwa w czystym `lib/domain/stats-ci.ts`:** przedział Wilsona 95% dla win rate
(15/30 → 33,2–66,8%), bootstrap średniego R z ustalonym ziarnem w testach i flagą „orientacyjnie”
przy n<30, break-even win rate L/(W+L) z własnych średnich w R, status setupu i hipotezy
(nieważny / niejednoznaczny / obiecujący / potwierdzony) według progów zapisanych w wersji setupu
albo w hipotezie **przed** zebraniem próby. Do tego `prop.ts` (bufory DD dla czterech typów,
consistency, bufor „gdy trafi SL”), `process-grid.ts` i rozszerzenie istniejącego `discipline.ts`
o wskaźnik z reguł. Wszystkie bez dostępu do bazy, testowane jednostkowo na przypadkach z raportu.

**Dyscyplina bez nowej tabeli.** Naruszenia twardych reguł wynikają z danych: przekroczony limit
trade'ów (`day_notes.max_trades`), handel poza oknem (`settings.trading_hours_*`), ruszony SL
(SL trade'u ≠ SL zamrożonego planu), trade bez planu (brak `trade_plans` z `frozen_at` ≤ wejście).
Nowy wskaźnik nie zastępuje `scoreDiscipline` z ADR-011/018 — stoi obok, z inną nazwą, bo wyniki
obu nie są porównywalne.

**Presety prop są danymi, nie kodem.** Wypełnia je `market-researcher` z **oficjalnych** regulaminów
(URL, data odczytu, `needs_verification` przy sprzecznych źródłach) w migracji danych. Użytkownik
przypisuje preset do konta i może nadpisać każdą wartość; UI pokazuje wiek presetu. Tylko
ostrzeżenia, bez blokad — AI nie składa zleceń, więc blokady nie da się wymusić.

**Ryzyko look-ahead modelu.** Werdykt na dniu, który model mógł znać z treningu, dostaje w UI
flagę „model mógł znać ten dzień”. Flaga jest wyliczana (model + dzień handlowy względem daty
odcięcia wiedzy modelu z listy w `lib/domain`), nie zapisywana.

**Nie robimy** (z planu): jednej liczby „edge score”, gamifikacji i serii, warstwy społecznościowej,
auto-sync brokerów, blokad, których nie da się wymusić, pól, których nic nie liczy. Pełny eksport
do ponownego importu zostaje i obejmuje nowe tabele.

**Koszt.** Kilkanaście nowych tabel i trzy funkcje triggerów — więcej powierzchni migracji
i testów (test „migracje od zera vs `schema.ts`” w fazie 2 jest warunkiem, nie dodatkiem).
Zatwierdzanie przez kolejkę dokłada kliknięcia; łagodzi to zatwierdzanie jednym kliknięciem
z cofnięciem, a dopiski do strategii (obserwacje, nie reguły) wchodzą bez zatwierdzenia.

**Rozstrzygnięcia użytkownika (14.10.2026).** Słowa użytkownika:
1. Źródło danych: «Wyliczane». Bez kolumny `data_source`; wyliczenie opisane wyżej.
2. Reguły R-004, R-007, R-010, w sejfie `zatwierdzona`: «Jako propozycje, zatwierdzam ponownie».
   Import (`tj import vault`) zakłada **wszystkie** reguły z sejfu jako `proposed`
   z `origin = 'vault-import'` i notą o statusie w sejfie; użytkownik zatwierdza je w UI, po jednej.
   **Żadnej furtki w bazie:** trigger zatwierdzeń nie ma wyjątku dla importu. To doprecyzowuje
   punkt planu „statusy reguł 1:1, nic nie zostaje zatwierdzone z automatu”: status z sejfu jest
   zachowany jako informacja, a nie jako zatwierdzenie.
3. Reguły z wiedzy mentora: «Bez progu, podpisane n=0». Propozycje `origin = 'mentor'` nie
   podlegają bramce „poniżej progu `n` AI nie proponuje reguły” (ta bramka dotyczy wniosków AI
   z własnych trade'ów, `origin = 'ai'`). W UI są podpisane „wg mentora, n = 0”. Nadal są tylko
   propozycją: zatwierdza wyłącznie użytkownik, po jednej (MUST 16.5).

---

## ADR-030, uzupełnienie wdrożeniowe fazy 2 / R2 (2026-10-15)

Decyzje gustu podjęte przy wdrożeniu API v2 (odwracalne; pełny kontrakt: `docs/api-v2.md`, `docs/openapi-v2.json`):

- **Brak kasowania nawet notatek** (ADR-032): „D” z CRUD to archiwizacja (`PATCH archived: true`, odwracalna, bez zmiany `rev`).
- **Pochodzenie deklarowane przez klienta** ogranicza się do `ai`, `mentor`, `vault-import`; `user` jest zarezerwowane dla UI, żeby agent nie podszył się pod użytkownika.
- **Interpretacja AI słów użytkownika** (`PUT /user-words/:id/interpretation`) ustawia się raz (drugi raz 409); poprawki idą przez korekty w UI (faza 2b).
- **`POST /user-words` jest idempotentny** po (skrót, `capturedAt`, źródło, rola, kotwice): ponowne wysłanie to 200 z tym samym `id`.
- **`withApi` nie otwiera jednej transakcji na całe zapytanie**: zapisy trade'ów mają własną transakcję w `persistTrade`, a zrzuty to I/O na dysku. Handler dostaje `api.zapis(tx => …)`, która ustawia `tj.actor` na tym samym połączeniu.
- **Tytuły notatek unikalne globalnie** (także zarchiwizowane i między rodzajami), bo `[[Tytuł]]` rozwiązuje się po tytule; kolizja to 409 ze wskazaniem istniejącej notatki.
- **Evidence propozycji reguły** jest obiektem JSON (nie tablicą). Import z sejfu: `externalRef` daje idempotencję, `vaultStatus` ląduje w `notes.meta.vault_status` i nigdy nie zatwierdza.
- **Kody własne baz**: `TJ409` (niezmienność), `TJ403` (zatwierdzenie spoza UI), `TJ422` (próg n); API mapuje je na 409/403/422 bez parsowania komunikatu.
- **Werdykt z `as_of`** stanie się niezmienny dopiero w migracji 0020 (faza 2b); do tego czasu `reviews` zachowuje się jak w ADR-028.
- **TODO po scaleniu z fazą 1**: sudo + TOTP przed zatwierdzeniem urządzenia, wpisy w `auth_events`, FK `auth_events.token_id`.
- **Poprawki po audycie (15.10.2026), decyzje użytkownika:** «Walidacja danych» (próg n: `nImported` tylko z `vault:`, `progN` przez API ≥ 20, ścisłe `evidence` mentora, `vault-import` bez `vault:` jak `ai`) oraz «Wymóg zostaje, poprawiamy» (wszystkie zapisy v2 z `tj.actor`; `persistTrade` dostaje opcjonalny `tx`).
- **Phishing kodem urządzenia:** lista bez kodów, globalny limit 20 żądań, sprzątanie po 10 min, ostrzeżenie o innym IP, osobny przełącznik `DEVICE_LOGIN_DISABLED`. Sudo przy zatwierdzaniu zostaje WARUNKIEM scalenia/publicznego wystawienia (faza 1).
- **Wspólna funkcja tokenu v2** (`sprawdzTokenV2`) obsługuje `withApi` i `withIngest`: `API_V2_DISABLED=1` odcina też `/api/ingest/**` dla tokenów v2.
- **Zakres `import` (2026-10-15, Słowa użytkownika: «Osobny zakres „import”»; rozstrzyga ustalenie N1 z ponownego audytu):** pochodzenie `vault-import` (z `nImported` i `vaultStatus`) oraz `mentor` wolno zadeklarować tylko tokenem z zakresem `import`; bez niego 403. Zakres jest dodatkowy (sam nic nie otwiera), nadaje go wyłącznie użytkownik ręcznie w UI (przycisk „token importu”, pokazywany raz, domyślnie 24 h), nigdy logowanie kodem urządzenia (`device/start` odrzuca go 400, CHECK `device_codes_requested_scopes` bez `import`). CHECK `api_tokens_scopes` rozszerzony do czterech zakresów (migracja 0017, jeszcze niewdrożona, więc edytowana w miejscu). Zakresu „zatwierdź” nadal nie ma. TODO(faza 1): sudo przed utworzeniem tokenu importu.
