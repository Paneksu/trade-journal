# Instrukcja obsługi

Jak używać dziennika, żeby dawał odpowiedzi, a nie tylko przechowywał liczby.

## Zanim wpiszesz pierwszy trade

Katalog kontraktów, tagi i trzy pola własne są już gotowe. Warto sprawdzić dwie rzeczy:

1. **Ustawienia → Konta** — saldo startowe. To punkt zerowy krzywej kapitału.
   Ustaw też domyślne ryzyko na trade; formularz będzie z niego podpowiadał wielkość pozycji.
2. **Ustawienia → Instrumenty** — wielkość i wartość ticku dla kontraktów, którymi grasz,
   oraz prowizję. Te trzy liczby decydują o każdym wyniku w dzienniku.

## Wpisywanie trade'a

*Nowy trade* (przycisk jest zawsze pod ręką, także na telefonie).

Formularz pamięta ostatnio użyte konto, instrument i strategię, więc zwykle wystarczy
wpisać ceny i godziny. Po prawej stronie liczy się **podgląd wyniku** — ticki, wynik brutto
i netto, ryzyko, R. To ten sam kod, który zapisze trade, więc podgląd nie kłamie.

Kilka rzeczy, które warto wiedzieć:

- **Puste pole ceny wyjścia** oznacza pozycję wciąż otwartą. Status przestawi się sam.
- **Puste pole prowizji** oznacza „policz z katalogu instrumentu”.
- **Bez stopa nie ma R.** Statystyki w R pominą taki trade, a miernik dyscypliny go zgłosi.
- **Zapisz i dodaj kolejny** zostawia Cię w formularzu — wygodne przy wpisywaniu sesji z kartki.

### Nie znasz ceny wyjścia? Wpisz kwotę

Broker pokazuje wynik w dolarach, a nie cenę, po której poszło wypełnienie. Zamiast zgadywać
z wykresu, wpisz tę kwotę w pole **Kwota z brokera** — wynik netto, po prowizji, dokładnie
tak, jak masz u siebie. Dziennik doliczy prowizję z powrotem i wstawi cenę wyjścia sam.
Prowizję bierze z pola obok, a gdy jest puste — ze stawki zapisanej przy instrumencie.

Ruch ceny musi wypaść na pełnym ticku instrumentu, więc nie każda kwota trafia co do centa.
Gdy trzeba było zaokrąglić, pod polem pojawia się informacja, ile faktycznie wyszło i o ile
różni się od wpisanej kwoty.

Kwota jest nakładką na cenę wyjścia, nie zamiast niej. Wpisanie ceny wprost gasi wyliczanie
i czyści kwotę. W drugą stronę: skasowanie kwoty przywraca ostatnią cenę, którą wpisałeś
ręcznie — nic nie ginie.

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
w statystykach i w Edge Finderze. Domyślnie są cztery: setup, błąd, warunki rynkowe, interwał.

Trade z trzema tagami trafia do trzech grup naraz — dlatego suma trade'ów w tabeli
rozbicia bywa większa niż ich liczba. Tak się te tabele czyta.

## Strategie i checklista

Strategia to nazwa plus lista zasad wejścia. Przy każdym trade'zie odhaczasz, które były
spełnione. To zasila dwie rzeczy: kartę trade'a (widać, co pominąłeś) i miernik dyscypliny.

Zasady możesz później edytować — punkty, które zostały bez zmian, zachowują odhaczenia
przy starych trade'ach.

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
checklisty, powiększanie pozycji po stracie, wejścia w ciągu pięciu minut od straty
i ryzyko przekraczające półtora raza Twoją własną medianę.

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

## Kopia danych

*Ustawienia → Dane i kopia* — eksport wszystkich tabel do JSON. Zrzuty ekranu leżą
na dysku serwera i kopiuje się je osobno (opis w `docs/wdrozenie-coolify.md`).
