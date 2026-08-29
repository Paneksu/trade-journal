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
  realizacje wpisuje się jako cenę uśrednioną,
- **odtwarzacz wykresów, asystent AI, aplikacja mobilna, synchronizacja z brokerami**.

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
