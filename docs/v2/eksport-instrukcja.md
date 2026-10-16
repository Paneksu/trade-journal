# Eksport transakcji z Tradovate i TradingView: instrukcja krok po kroku

Data: 2026-10-16. Dla: Szymon (handel na Tradovate z TradingView Desktop, konta prop). Powiązane: ADR-034 (etap A, „Eksport”).

**O wiarygodności.** Masz już dwa prawdziwe pliki z 13.10.2026 (Orders.csv i Cash History.csv), więc nazwy plików i kolumn poniżej są POTWIERDZONE na nich. Miejsca w menu Tradovate są z oficjalnej pomocy Tradovate i poradników (CZĘŚCIOWE: strony pomocy zwracają mi błąd 403, czytałem je przez podsumowania wyszukiwarki). Nie klikałem w Twoim koncie. Jeśli ekran wygląda inaczej, wygrywa ekran.

## Zestaw, który polecam: Orders + Cash History (6 kroków, ok. 2 minuty)

Eksportuj z **Tradovate (przeglądarka albo aplikacja desktop)**. Z TradingView i z telefonu nie.

1. **Wybierz konto prop.** Zaloguj się do Tradovate i przełącz się na konto, z którego chcesz plik. Jedno konto na jeden eksport.
2. **Otwórz Raporty.** Kliknij ikonę **Reports** na pasku bocznym albo pasek z saldem u góry ekranu. Oba otwierają okno „Account Reports”. W aplikacji desktop poradniki podają też drogę: najedź na nazwę konta u góry, kliknij ikonę zębatki.
3. **Orders.** Wybierz zakładkę **Orders**. Ustaw zakres dat (Today, This Week, This Month albo Custom z polami From i To). Kliknij **Go**, potem **Download CSV** (w nowszych wersjach przycisk bywa opisany „Download Report”). Plik: `Orders.csv`.
4. **Cash History.** Zmień zakładkę na **Cash History**, te same daty i to samo konto, **Go**, **Download CSV**. Plik: `Cash History.csv` (z odstępem w nazwie, tak jak w Twoich próbkach).
5. **Zostaw oba pliki w folderze Pobrane.** Dziennik ma je tam znaleźć (ADR-034, `tj watch-exports`).
6. **Zapisz notatkę w dzienniku.** Orders daje ceny i czasy wejścia i wyjścia, Cash History daje prowizje i wynik brutto. Z nich dziennik liczy wynik netto.

To są tylko trzy kliknięcia na plik po otwarciu Reports (zakładka, Go, Download). Mniej się nie da, bo żaden raport Tradovate nie daje wszystkiego w jednym pliku (patrz niżej).

## Co jest w Twoich plikach (POTWIERDZONE na próbkach z 13.10.2026)

**Orders.csv.** Kolumny: `orderId, Account, Order ID, B/S, Contract, Product, Product Description, avgPrice, filledQty, Fill Time, lastCommandId, Status, ... Timestamp, Date, Quantity, Text, Type, Limit Price, Stop Price, ..., Filled Qty, Avg Fill Price, ..., Notional Value, Currency`.
- Wiersz to **zlecenie**, nie pojedyncze wypełnienie. Cena to `avgPrice` (średnia ważona całego zlecenia), ilość to `filledQty`, czas wypełnienia to `Fill Time`.
- W pliku są też zlecenia anulowane (`Status` = Canceled, bez ceny i bez czasu wypełnienia). Dziennik bierze tylko `Filled`.
- Kolumna `Text` = „Tradingview” oznacza, że zlecenie przyszło z TradingView. To dobry znacznik źródła.
- Uwaga dla parsera: wartości `B/S`, `Status`, `Type` zaczynają się od spacji (np. „ Sell”, „ Filled”). Trzeba je przyciąć.

**Cash History.csv.** Kolumny: `Account, Transaction ID, Timestamp, Date, Delta, Amount, Cash Change Type, Currency, Contract`.
- `Cash Change Type` ma trzy wartości w próbce: `Fund Transaction` (saldo startowe), `Commission` (opłata za jedną stronę), `Trade Paired` (zamknięty trade, kwota to wynik **brutto** pary wejście-wyjście).
- Kwoty mają przecinek tysięcy w cudzysłowie (np. „24,995.50”). Znowu spacja na początku typu.
- Wiersz `Commission` nie ma numeru zlecenia. Z Orders łączy go **ta sama sekunda** (`Timestamp` prowizji = `Fill Time` zlecenia) i ten sam `Contract`. W próbce zgadza się to co do sekundy.
- W próbce jedyny typ opłaty to `Commission`. Brak osobnych wierszy opłat giełdy czy NFA.
- Czasy w obu plikach mają format `MM/DD/YYYY HH:MM:SS`, bez strefy. Strefa nie jest podana (do potwierdzenia, ADR-034). Wygląda na Twój czas lokalny (16:03 u Ciebie to 10:03 w Nowym Jorku, a tam NQ właśnie handluje), ale to WYWNIOSKOWANE.

## Czy jest eksport „Fills” z pojedynczymi wypełnieniami

**Tak, zakładka Fills istnieje, ale nie wiem, co jest w jej pliku.**
- Oficjalna pomoc Tradovate wymienia raporty: Performance, Orders, Position History, Cash History, Order Details, Chat History, **Fills**, Account Balance History (CZĘŚCIOWE, odczyt pośredni). Pomoc: Fills to wypełnione zlecenia, grupowane po kontrakcie.
- Dokumentacja partnerska Tradovate (dla firm, nie dla traderów) Fills nie wymienia. Poradniki dzienników twierdzą, że plik Fills ma czas, cenę, ilość, prowizję i konto (niepotwierdzone oficjalnie, bez daty).
- Czy Twoje konto prop pokazuje zakładkę Fills i jakie ma kolumny, wiadomo dopiero po jednym eksporcie.

**Dlaczego to ma znaczenie.** Orders daje średnią cenę zlecenia. Gdy zlecenie wypełni się partiami po różnych cenach (typowo przy większym rozmiarze albo zleceniu limit w cieniutkim rynku), Orders ukrywa pojedyncze wypełnienia, a Fills je pokazuje. W próbce z 13.10 każde zlecenie to jedno wypełnienie 9 sztuk, więc tam średnia = cena i Orders wystarcza.

**Co proponuję.**
- **Teraz: Orders + Cash History.** Jest potwierdzone, że razem dają: konto, kontrakt, stronę, średnią cenę, ilość, czas, źródło zlecenia, prowizję i wynik brutto pary.
- **Raz, do sprawdzenia: eksport Fills** z tego samego dnia i konta. Jeśli ma pojedyncze wypełnienia z prowizją i kontem, przejdziemy na Fills + Cash History (Cash History zostaje dla wyniku brutto pary i salda). Jeśli nie ma pojedynczych wypełnień, zostajemy przy Orders.
- Orders + Cash History może zaniżyć dokładność tylko przy częściowych wypełnieniach. Wynik netto (prowizje) i tak jest dokładny, bo prowizje są w Cash History na każdą stronę.

## Opłaty w próbce, dla porządku

Z Cash History: wejście 9 MNQ = 4,50 USD, wyjście 9 MNQ = 4,50 USD. To 0,50 USD na kontrakt na stronę, 1,00 USD za MNQ w obie strony. Zgadza się to z tabelą opłat Lucid (patrz `docs/research/prop-presety.md`, sekcja „Opłaty transakcyjne”).

## TradingView Desktop z brokerem Tradovate (droga zapasowa)

1. Na dole wykresu otwórz panel **Trading** (zakładka z podłączonym kontem Tradovate).
2. Przełącz na kartę z historią zleceń (poradniki podają „Order History”; przy Tradovate nazwa może być inna).
3. Kliknij ikonę ustawień kolumn i zaznacz wszystkie kolumny (poradnik TradeZella: kolumna **Commission** jest na liście).
4. Kliknij **Download data** (albo menu brokera, **Export data…**), wybierz kartę i **Download**. Format to CSV.

Co wiem (oficjalna pomoc TradingView): eksport działa osobno dla każdej karty, plik to CSV, a przycisk jest tylko dla brokera podłączonego do panelu. Czego nie wiem: czy przy Tradovate plik ma opłaty i identyfikator konta prop. Pomoc nie podaje kolumn ani nazwy pliku (przykład z poradnika dla paper tradingu: `Tradingview_paper-trading-history-all-2025-02-15T20_11_00.219Z.csv`). Nie polecam tej drogi jako głównej: Tradovate daje Cash History z opłatami i kontem, TradingView nie potwierdza opłat.

## Telefon

Tradovate reklamuje podgląd raportów w aplikacji mobilnej. **Nie znalazłem źródła mówiącego o eksporcie CSV z telefonu**, poradniki opisują tylko przeglądarkę i desktop. Załóż, że eksport robisz na komputerze.

## Konta prop na Tradovate: ograniczony dostęp do raportów

- Twoje pliki dowodzą, że z konta prop **da się** wyeksportować Orders i Cash History. Nie znalazłem oficjalnej informacji o ukrytych raportach dla kont prop. Nie potwierdziłem też istnienia osobnej strony `prop.tradovate.com` dla traderów.
- Ograniczenie dotyczy czego innego: konta prop są pod kontrolą firmy, a **Twój osobisty klucz API Tradovate zwykle ich nie widzi** (wątek community Tradovate „API Access for PropFirm Accounts”; wtórnie PickMyTrade). Pełny dostęp do raportów organizacji ma firma (Organization Admin), nie trader. Dlatego ręczny eksport z okna Reports jest dziś najpewniejszą drogą, a automat przez OAuth (etap B) wymaga odpowiedzi Tradovate.

## Co jeszcze od Ciebie potrzebuję

1. Eksport **Fills** z tego samego dnia i konta (albo informację, że zakładki nie widzisz). Lokalnie, poza repo.
2. Potwierdzenie **strefy czasowej** czasów w plikach (np. wejście, które pamiętasz z TradingView, porównaj z `Fill Time`).
3. W panelu firmy: **program i faza** konta o prefiksie `LFE` (Flex, Pro albo Daily; evaluation czy funded). Z plików nie wynika.
4. Jeśli handlujesz też NQ lub ES: jedna transakcja mini, żeby potwierdzić stawkę (z tabeli firmy wynika 3,50 USD za NQ w obie strony, niepotwierdzone).

## Źródła (odczyt 2026-10-16)

- Twoje pliki Orders.csv i Cash History.csv z 13.10.2026 (lokalnie, poza repo; nie cytuję numeru konta).
- Tradovate, lista raportów, okno „Reports”, eksport CSV albo PDF: https://support.tradovate.com/s/article/Tradovate-Account-Reports?language=en_US i https://tradovate.zendesk.com/hc/en-us/articles/115009508188-How-do-I-access-my-account-reports (oba 403, treść z podsumowań wyszukiwarki; bez daty)
- Tradovate, raporty Orders, Cash History, Performance (dokumentacja partnerska): https://partner.tradovate.com/resources/admin-dashboards/reports (odczytane, bez daty)
- Tradovate community, „Orders Export- Fees per transaction” (wrz. 2021, `[NIEAKTUALNE?]`, zgodne z Twoimi plikami): https://community.tradovate.com/t/orders-export-fees-per-transaction/3019
- Poradniki dzienników (wtórne, bez dat): https://traderinsight.pro/blog/import-tradovate , https://www.tradesviz.com/brokers/Tradovate , https://www.tradevia.app/workflows/import-trades-from-tradovate/ (Fills z prowizją, niepotwierdzone)
- TradingView: https://www.tradingview.com/support/solutions/43000663814-how-can-i-download-trading-data/ (bez daty), https://www.tradingview.com/blog/en/export-trading-data-into-a-csv-file-30748/ (6.04.2022 `[NIEAKTUALNE?]`), https://help.tradezella.com/en/articles/6992227-tradingview-how-to-import-trades-from-tradingview-into-tradezella (luty 2025, paper trading)
- Konta prop a klucze API: https://community.tradovate.com/t/api-access-for-propfirm-accounts/10348 (podsumowanie wyszukiwarki)
