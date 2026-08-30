# Instrukcja obsługi

Jak używać dziennika, żeby dawał odpowiedzi, a nie tylko przechowywał liczby.

## Zanim wpiszesz pierwszy trade

Katalog kontraktów, tagi i trzy pola własne są już gotowe. Warto sprawdzić dwie rzeczy:

1. **Ustawienia → Konta** — saldo startowe. To punkt zerowy krzywej kapitału.
   Ustaw też domyślne ryzyko na trade; formularz będzie z niego podpowiadał wielkość pozycji.
2. **Ustawienia → Instrumenty** — wielkość i wartość ticku dla kontraktów, którymi grasz.
   Te dwie liczby decydują o każdym wyniku w dzienniku.

## Wpisywanie trade'a

*Nowy trade* (przycisk jest zawsze pod ręką, także na telefonie).

Formularz pamięta ostatnio użyte konto i instrument, więc zwykle wystarczy
wpisać ceny i godziny. Po prawej stronie liczy się **podgląd wyniku** — ticki, wynik,
ryzyko, R. To ten sam kod, który zapisze trade, więc podgląd nie kłamie.

Kilka rzeczy, które warto wiedzieć:

- **Puste pole ceny wyjścia** oznacza pozycję wciąż otwartą. Status przestawi się sam.
- **Bez stopa nie ma R.** Statystyki w R pominą taki trade, a miernik dyscypliny go zgłosi.
- **Zapisz i dodaj kolejny** zostawia Cię w formularzu — wygodne przy wpisywaniu sesji z kartki.

### Zrzuty wykresu

Do jednego trade'a wchodzi **do ośmiu zrzutów** — bez dzielenia na „przed" i „po".
Wrzuć tyle, ile potrzeba, żeby wytłumaczyć wejście: interwał wyższy, niższy, moment
wyjścia. Układają się w kolejności wgrywania, więc chronologia robi się sama.

W formularzu nowego trade'a pliki jadą razem z zapisem; na karcie zapisanego trade'a
zrzut dokłada się od razu — **Ctrl+V** ze schowka, przeciągnięcie pliku albo wybór
z dysku. Kliknięcie miniatury otwiera pełny obraz: strzałki przewijają, **Esc** zamyka.
Kosz na miniaturze kasuje zrzut razem z plikiem, tego nie da się cofnąć.

Gdy zrzutów jest już osiem, pole wgrywania znika — usuń któryś, żeby zrobić miejsce.
Większa paczka nie zostanie przycięta po cichu: albo wejdzie w całości, albo dostaniesz
komunikat z liczbą wolnych miejsc.

### Nie znasz ceny wyjścia? Wpisz kwotę

Broker pokazuje wynik w dolarach, a nie cenę, po której poszło wypełnienie. Zamiast zgadywać
z wykresu, wpisz tę kwotę — dokładnie to, co masz u siebie na rachunku.

Są na to dwa miejsca i warto je rozróżniać:

- **Kwota z brokera** przy pozycji dotyczy **całego trade'a** i nadpisuje wynik. Wpisujesz ją,
  gdy znasz tylko końcową liczbę z rachunku.
- **Kwota z brokera** w wierszu wyjścia (pod przyciskiem **kwota i notatka**) dotyczy
  **tego jednego kawałka**. Z niej dziennik policzy cenę wyjścia tego wiersza sam.

Ruch ceny musi wypaść na pełnym ticku instrumentu, więc nie każda kwota trafia co do centa.
Gdy trzeba było zaokrąglić, pod polem pojawia się informacja, ile faktycznie wyszło i o ile
różni się od wpisanej kwoty.

Kwota w wierszu jest nakładką na cenę, nie zamiast niej. Wpisanie ceny wprost gasi wyliczanie
i czyści kwotę. Skasowanie kwoty przywraca ostatnią cenę wpisaną ręcznie — nic nie ginie.

### Częściowe wyjścia z pozycji

Wyjście nie musi być jedną operacją. Pozycję można zamykać kawałkami: TP1 na pierwszym
celu, TP2 na drugim, runner z reszty. Każdy kawałek to osobny wiersz, a przycisk
**Dodaj wyjście** dokłada kolejny.

Przy jednym wyjściu liczbę kontraktów możesz zostawić pustą — znaczy to całą pozycję.
Pole pokazuje tę liczbę w podpowiedzi, więc nic nie dzieje się po cichu. Zwykły trade
wpisuje się przez to dokładnie tak jak dawniej: cena i godzina wyjścia, i tyle.

Przy kilku wierszach każdy musi mieć swoją liczbę kontraktów. Pomaga skrót **reszta**,
który wstawia tyle, ile zostało do zamknięcia całej pozycji.

Trade można zapisać niedokończony. Jeśli wyjścia nie pokrywają całej pozycji, status
wraca jako *otwarty*: widać zysk już zrealizowany, ale trade nie wchodzi jeszcze do
statystyk. Wejdzie, gdy domkniesz resztę.

Kwotę z rachunku możesz podać osobno dla każdego kawałka — pole jest pod przyciskiem
**kwota i notatka** w wierszu. Kwota wpisana dla całego trade'a nadal bije wszystko.

### Wpływ skalowania

To jest powód, dla którego w ogóle warto rozpisywać wyjścia po kawałku. Dziennik
porównuje Twój wynik z tym, co dałaby cała pozycja zamknięta po cenie **ostatniego**
wyjścia, i pokazuje różnicę w R.

Przykład. Dwa kontrakty, wejście po 100, stop na 90 — ryzyko to 10 punktów na kontrakt,
czyli 1R to 20 punktów na całej pozycji.

- Zdejmujesz jeden kontrakt po 110, drugi wychodzi po 130. Masz 10 + 30 = 40 punktów.
  Gdybyś trzymał oba do 130, miałbyś 60. Wpływ skalowania: **−1R** — pierwszy kawałek
  zabrałeś za wcześnie.
- Odwrotnie: zdejmujesz jeden po 130, a reszta wychodzi po 110. Masz 30 + 10 = 40,
  a trzymając oba do 110 miałbyś 20. Wpływ skalowania: **+1R** — zdjęcie na szczycie
  uratowało trade.

Pojedyncze liczby niewiele znaczą, bo raz się trafi, raz nie. Sens ma dopiero suma
z wielu trade'ów — znajdziesz ją na ekranie *Statystyki* jako **Wpływ częściowych
realizacji**, razem z liczbą trade'ów, z których została policzona. Jeśli po pięćdziesięciu
zagraniach wychodzi wyraźnie na minus, to znaczy, że zdejmujesz zbyt wcześnie.

W liczeniu tej miary kwoty z rachunku są pomijane. Ocenia ona decyzję, kiedy i po ile
zdejmować, a nie poślizg i prowizje.

Na karcie trade'a „Cena wyjścia" jest wtedy średnią ważoną wszystkich kawałków,
a „Wyjście" to godzina ostatniego z nich. Pełne rozbicie znajdziesz niżej, w panelu
*Wyjścia*: każdy kawałek z ceną, udziałem w pozycji, wynikiem i własnym R.

### MAE i MFE

Pola ukryte pod przyciskiem, bo nie każdy je prowadzi. Warto, jeśli chcesz wiedzieć,
czy stopy nie są za ciasne, a cele za bliskie:

- **MAE** — najgorsza cena w trakcie trwania pozycji,
- **MFE** — najlepsza cena w trakcie trwania pozycji.

Dziennik przelicza je na wielokrotność ryzyka i rysuje wykres MAE/MFE w statystykach.
Czerwona linia to Twój stop: punkty po jej prawej stronie to trade'y, które o włos
nie zostały wyrzucone.

## Pola własne — Twoje kolumny

*Ustawienia → Pola własne*. Definiujesz nazwę, typ i — przy listach — stałe wartości
do wyboru. Pole od razu pojawia się w formularzu, opcjonalnie w tabeli, w filtrach
i jako wymiar w statystykach.

Typy: tekst, liczba (z zakresem i jednostką), lista wyboru, lista wielokrotnego wyboru,
tak/nie, data, ocena 1–5.

Dwie zasady, które warto znać:

- **Klucz pola powstaje raz.** Możesz zmienić nazwę wyświetlaną, ale klucz zostaje —
  inaczej wartości zapisane przy starych trade'ach przestałyby do niego pasować.
- **Ukrywaj zamiast usuwać.** Ukryte pole znika z formularza, a dane zostają.
  Usunięcie definicji zostawia wartości w bazie, ale przestają być widoczne.

Pola tekstowe nie trafiają do statystyk — każda wartość byłaby osobną grupą.

## Tagi

*Ustawienia → Tagi*. Kategorie definiujesz sam; każda staje się osobnym wymiarem
w statystykach i w Edge Finderze. Domyślnie są trzy:

- **Konfluencje** — przesłanki, które złożyły się na wejście (EQ, FVG, przejęcie
  płynności). Tylko tu wybierasz interwały.
- **Setup** — nazwa całego zagrania, np. „Silver Bullet". Bez interwału. Ta
  kategoria startuje pusta: nikt poza Tobą nie wie, jak nazywasz swoje zagrania.
- **Błąd** — co poszło nie tak po Twojej stronie.

### Interwały i podział HTF/LTF

Po zaznaczeniu konfluencji pojawia się wiersz interwałów, rozdzielony na **HTF**
(1h i wyżej) oraz **LTF** (poniżej 1h). Możesz zaznaczyć **kilka naraz**: jeśli
to samo FVG widziałeś na 4h i na 5m, zaznacz oba — to jest osobna informacja niż
sam fakt, że FVG było.

Warstwa nie jest osobnym tagiem ani osobną kategorią. Wynika wprost z interwału,
więc nie musisz zakładać „FVG HTF" obok „FVG LTF" — statystyki i tak rozbiją to
na dwa wymiary: *Konfluencja HTF* i *Konfluencja LTF*. Dzięki temu Edge Finder,
który porównuje pary wymiarów, sam znajduje kombinacje typu „EQ na HTF razem
z FVG na LTF".

Trade z trzema tagami trafia do trzech grup naraz — dlatego suma trade'ów w tabeli
rozbicia bywa większa niż ich liczba. Tak się te tabele czyta. Ten sam tag na dwóch
interwałach liczy się przy tym **raz**, nie dwa.

## Galeria

*Galeria* w menu. Kafelki: pierwszy zrzut trade'a, pod nim data, instrument, wynik
w R i wszystkie tagi z interwałami. Klik wchodzi w kartę trade'a.

Filtry są te same co na liście trade'ów, więc możesz zapytać „pokaż wszystkie
wejścia z EQ na HTF" i obejrzeć same wykresy obok siebie. Domyślnie widać tylko
trade'y ze zrzutem — w filtrze *Zrzuty* przełączysz to na „wszystkie".

## Kierunek a egzekucja

Przy trade'zie zamkniętym na stracie albo na zero pojawia się pole **„kierunek był
dobry, zawiodła egzekucja"**. Zaznacz je, kiedy rynek poszedł tam, gdzie
zakładałeś, ale wyszedłeś za wcześnie albo dostałeś niepotrzebne BE. Możesz
dopisać powód i to, do ilu R doszła cena.

**Potencjał to nie MFE.** MFE mierzy ruch w trakcie trwania Twojej pozycji,
potencjał — zasięg całego zagrania, także po Twoim wyjściu. Formularz podpowiada
wartość z MFE, ale to dwie różne liczby; mylenie ich odbiera sens metryce
„utracone R".

Przy wygranej pola nie ma — kierunek trafiony wynika z wyniku i nie trzeba tego
zaznaczać.

Statystyki dostają z tego panel **„Kierunek a egzekucja"**:

- **Trafność kierunku** — jak często miałeś rację, niezależnie od tego, czy
  egzekucja to udźwignęła. Wygrane liczą się jako trafione z definicji, więc
  dopóki nie przejrzysz strat, wynik jest zawyżony — panel wypisze, ile trade'ów
  czeka na ocenę.
- **Straty techniczne** — trafiony kierunek, wynik mimo to ujemny.
- **Utracone R** — ile R zostawiłeś na stole.
- **Sufit systemu** — oczekiwana wartość, jaką dałyby te same wejścia przy czystej
  egzekucji.

Zaznaczone niepotrzebne BE i za wczesne wyjście obniżają też miernik dyscypliny.
Niepotrzebny stop — nie: zbyt ciasny stop to błąd planu, nie ręki.

## Strategie

Strategia to nazwa plus lista zasad wejścia, prowadzona na ekranie *Strategie*.
Formularz trade'a nie pyta już o strategię ani nie każe odhaczać zasad — te pola wyszły
z niego 29 sierpnia 2026, bo wypełniało się je z rozpędu i nic z nich nie wynikało.

Strategie zostają z dwóch powodów: starsze trade'y mają je przypisane i widać je na
karcie trade'a, a sama lista zasad przydaje się jako ściąga przed wejściem.

## Czytanie statystyk

**Nie czytaj liczby bez próbki.** Każdy ekran statystyk zaczyna się od paska, który mówi,
z ilu trade'ów są liczone i czy to już coś znaczy. Poniżej progu (domyślnie 15) liczby
są zgadywaniem.

Co znaczą główne miary:

| Miara | Co mówi |
|---|---|
| **Oczekiwana wartość (R)** | ile średnio zarabia jeden trade w wielokrotności ryzyka. Jedyna liczba, która naprawdę mówi, czy system zarabia. |
| **Przedział oczekiwanej wartości** | gdzie leży prawdziwa wartość z 95% pewnością. Szeroki przedział = za mała próbka. |
| **Profit factor** | suma zysków ÷ suma strat. Poniżej 1 system traci. |
| **Skuteczność i próg opłacalności** | procent wygranych i to, ile musiałbyś mieć przy swoim payoffie, żeby wyjść na zero. Skuteczność sama w sobie nic nie znaczy. |
| **Maks. obsunięcie** | największy spadek od szczytu kapitału, nie największa pojedyncza strata. |
| **Jakość systemu** | średnie R podzielone przez odchylenie. Im wyżej, tym mniej losowe wyniki. |

**Rozbicie** liczy te same statystyki osobno dla każdej wartości wybranego wymiaru.
Kolumna „trade'y" stoi zaraz obok wyniku, a grupy poniżej progu są oznaczone jako
mała próbka — po to, żeby nie wyciągać wniosków z pięciu zagrań.

## Edge Finder

Przegląda wszystkie wymiary i wszystkie ich pary, i pokazuje konteksty, w których
oczekiwana wartość odstaje od Twojej średniej — w górę („tu masz przewagę")
i w dół („tu tracisz").

Co pomija świadomie:

- konteksty poniżej progu próbki (liczba pominiętych jest podana),
- wymiary wyliczone z wyniku, jak przedział R — „trade'y z +2R do +3R mają 100%
  skuteczności" to tautologia, nie znalezisko,
- wymiary o jednej wartości, na przykład jedyne konto.

Traktuj wyniki jak hipotezy do sprawdzenia, nie jak wyrocznię.

## Miernik dyscypliny

Ocenia zachowanie, nie wynik. Sto punktów minus kary za: trade'y bez stopa, niepełne
checklisty, powiększanie pozycji po stracie, wejścia w ciągu pięciu minut od straty,
zepsutą egzekucję przy trafionym kierunku i ryzyko przekraczające półtora raza Twoją
własną medianę.

Kara za niepełną checklistę dotyczy dziś wyłącznie starszych trade'ów, przy których
zasady były odhaczane. Nowe wpisy nie mają jak jej dostać.

Uwaga: sygnał „zepsuta egzekucja" doszedł 24 sierpnia 2026 i przesunął skalę.
Wyniki sprzed tej daty nie porównują się wprost z późniejszymi.

Przy każdym sygnale są numery trade'ów — klikalne, żeby dało się sprawdzić, o co chodzi.

## Kalendarz i dziennik dnia

Miesiąc jako mapa wyników. Kliknięcie dnia pokazuje jego trade'y i notatkę dnia:
plan przed sesją, podsumowanie po sesji, nastrój, energia i ocena dnia.

Notatka przed sesją ma sens tylko wtedy, gdy powstaje **przed** sesją. Po fakcie
zawsze wychodzi, że plan był dobry.

### Dzień bez transakcji

Dzień, w którym świadomie nie grałeś, też jest wpisem. W panelu dnia zaznacz
**Dzień bez transakcji** i wybierz powód: brak setupu, poza godzinami handlu,
warunki rynkowe, dzień wolny, zaplanowana pauza, powód osobisty albo inny.
Szczegóły dopisz w polu „Po sesji”.

Taki dzień dostaje w kalendarzu własny kafel — neutralny, bez zieleni i czerwieni,
bo nie jest ani zyskiem, ani stratą. Dnia, w którym są zapisane trade'y, nie da się
tak oznaczyć.

Dwa kafle na górze kalendarza czytają te zapisy:

- **Dni bez transakcji** — ile pauz w miesiącu i jaki powód wraca najczęściej,
- **Pokrycie dziennika** — jaki odsetek dni roboczych ma jakikolwiek zapis, trade
  albo świadomą pauzę. Reszta to dni, o których dziennik nie wie nic. Dni jeszcze
  nienadeszłe nie liczą się jako braki, święta trzeba oznaczyć samemu powodem
  „dzień wolny”.

Pauzy nie wchodzą do statystyk wyników ani do miernika dyscypliny — nie podbijają
skuteczności i nie psują średniej.

### Zrzuty dnia

Panel **Zrzuty dnia** przyjmuje obrazy niezwiązane z żadnym trade'em — wykres, na
którym setupu nie było, bywa wart więcej niż zdanie o nim. Zrób zrzut w platformie
i wciśnij **Ctrl+V** gdziekolwiek na panelu dnia; możesz też przeciągnąć plik albo
wybrać go z dysku. Zrzut zapisuje się od razu, notatki nie trzeba wcześniej zapisywać.

Tu też mieści się **osiem zrzutów**. Kliknięcie miniatury otwiera pełny obraz na całym
ekranie — strzałki przewijają, **Esc** zamyka. Kosz na miniaturze kasuje zrzut razem
z plikiem — tego nie da się cofnąć.

## Backtesting

*Backtesting → Nowa sesja*. Zapisujesz założenia (strategia, instrument, interwał,
zakres danych, ryzyko, cel liczby trade'ów) **zanim** zaczniesz liczyć. Potem wbijasz
trade'y tym samym formularzem, przyciskiem „Dodaj trade do sesji".

Sesja ma własne statystyki i własny licznik próbki. Trade'y z sesji nie mieszają się
z dziennikiem realnym — chyba że sam przełączysz widok na „razem".

Najciekawsza część to tabela **backtest kontra dziennik**: te same miary dla tej samej
strategii w symulacji i na żywo. Gdy realny handel wypada wyraźnie gorzej, zwykle winne
są poślizgi, gorsze wejścia albo trade'y spoza planu — i wtedy warto zajrzeć do miernika
dyscypliny, a nie do strategii.

### Dni bez sygnału w sesji

Panel **Dni bez sygnału** na stronie sesji zapisuje dni, w których strategia nie dała
wejścia: data, powód i to, co widziałeś na wykresie. Kliknięcie daty rozwija wpis —
wtedy działa **Ctrl+V** i wklejasz do niego zrzut, tak samo jak w kalendarzu.

Nagłówek panelu pokazuje **pokrycie zakresu danych**: ile dni roboczych z zakresu
sesji ma jakikolwiek zapis, trade albo udokumentowaną pauzę. To pilnuje uczciwości
badania — sesja z trzydziestoma wejściami i dwustoma przemilczanymi dniami mówi
o strategii mniej niż połowę.

Dnia, w którym sesja ma zapisany trade, nie da się oznaczyć jako dnia bez sygnału.

## Kopia danych

*Ustawienia → Dane i kopia* — eksport wszystkich tabel do JSON. Zrzuty ekranu leżą
na dysku serwera i kopiuje się je osobno (opis w `docs/wdrozenie-coolify.md`).
