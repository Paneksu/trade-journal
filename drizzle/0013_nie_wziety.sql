-- Status "nie wziety" - setup byl, ale uzytkownik go nie wzial (2026-08-30).
--
-- Trade nie wziety ma pelny wynik hipotetyczny (wejscie, stop, wyjscie -> R
-- i PnL liczone normalnie), ale nie liczy sie do statystyk. Nowa wartosc
-- enuma, nie kolumna boolean - closedOnly (trades.ts) zostaje doslownie
-- status === "closed" i caly aparat statystyk znika "missed" bez zmiany w
-- zadnym module domeny.
--
-- Plik musi zawierac WYLACZNIE ten jeden statement, bez statement-breakpoint
-- na koncu. Migrator wykonuje plik w transakcji, a Postgres nie pozwala
-- uzyc swiezo dodanej wartosci enuma w tej samej transakcji, w ktorej ja
-- dodano. Kazdy UPDATE/CHECK/indeks z literalem 'missed' idzie do 0014.

ALTER TYPE "trade_status" ADD VALUE IF NOT EXISTS 'missed';
