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
- **R liczymy z wyniku netto, ryzyko bez prowizji.** Ryzyko to odległość do stopa razy
  wartość ticku. Prowizja obciąża wynik, a nie ryzyko.

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
