# Presety reguł prop firm (futures), research do modułu prop

Data odczytu: **2026-10-14** (wszystkie wartości). Zlecenie: MUST 7, ADR-033, tabela `prop_firm_presets` (model-danych.md, sekcja 5.6). Seed: `prop-presety.json`, 138 wierszy, 9 firm, 28 programów.

## Jak czytać

- Kwoty w tabelach w USD, w JSON w centach. Klucze pominięte w JSON nie występują: wszystkie kolumny modelu są obecne, `effective_from` zawsze `NULL` (daty stron są w `extra.page_date`, to nie są daty wejścia w życie).
- **Typ DD** wg modelu: `eod` = trailing EOD bez znanego punktu blokady, `intraday`, `trailing_to_static` = trailing do progu, potem stały. Dla `trailing_to_static` podstawa trailingu (EOD albo intraday) jest w `extra.trail_basis`.
- **Blokada (zysk)** = zysk szczytowy od salda startowego, przy którym próg DD przestaje rosnąć. Gdy firma podaje blokadę "saldo startowe + $100", wpisano DD + $100. To jest WYWNIOSKOWANE z reguły, nie podane wprost, tam gdzie tak zaznaczono.
- **DLL**: kolumna wypełniona tylko gdy limit jest obowiązkowy w programie. DLL opcjonalny (Topstep, Lucid, wybór przy zakupie) jest w `extra.dll_optional_usd`.
- **Consistency**: % w kolumnie. Podstawa liczenia (łączny zysk, cel, zysk od ostatniej wypłaty) i skutek (`fail`, `raise_target`, `block_payout`) w `extra`.
- Oznaczenia: `[DO WERYFIKACJI]` = sprzeczne źródła albo tylko blog/afiliacja. `[DO WERYFIKACJI: odczyt pośredni]` = oficjalna strona zwróciła HTTP 403, wartość pochodzi z podsumowania wyszukiwarki cytującego help center. `[BEZ DATY]` = strona nie podaje daty. `[NIEAKTUALNE]` = źródło stare.
- W JSON `verified` = `NOT needs_verification`, `read_at` = `read_on` (aliasy z prośby; kolumny modelu to `needs_verification` i `read_on`). Seed wstawia kolumny modelu, `verified` i `read_at` można zignorować.
- Rozróżnienie: **obserwacja** = odczytana wartość. **WYWNIOSKOWANE** = wyliczone z reguły.

## Podsumowanie

| Firma | Programy | Wiersze | Wiersze `[DO WERYFIKACJI]` | Jak odczytane |
|---|---|---|---|---|
| Topstep | 3 | 9 | 6 (limit kontraktów XFA) | bezpośrednio, help center |
| Apex Trader Funding | 4 | 16 | 16 | pośrednio (403) |
| Tradeify | 5 | 21 | 21 | pośrednio (403) |
| Lucid Trading | 3 | 24 | 1 | bezpośrednio, help center |
| MyFundedFutures | 4 | 26 | 8 | bezpośrednio, help center |
| Take Profit Trader | 2 | 10 | 10 | pośrednio (403) |
| Alpha Futures | 4 | 22 | 6 | bezpośrednio, help center |
| Bulenox | 2 | 8 | 8 | bezpośrednio, ale zwijane sekcje puste |
| Earn2Trade | 1 | 2 | 0 | bezpośrednio |
| **Razem** | **28** | **138** | **76** | |

Poza wierszami `needs_verification` jest jeszcze 13 wierszy z uwagą w `extra.verify_fields` (np. rozbieżność cen u Topstep, sprzeczność marketing/help u MFFU). Razem 89 wierszy ma jakąkolwiek adnotację do weryfikacji.

## Największe pułapki (2026)

1. **Apex 4.0 od 2026-03-01.** Stare 75K/250K/300K, "8-dniowa wypłata", 30% windfall i 5:1 to legacy, ale strony legacy wciąż są w help center. Konta kupione przed marcem 2026 mogą działać na starych regułach: preset trzeba przypiąć do daty zakupu.
2. **Trzy firmy blokują odczyt automatyczny** (Apex, Tradeify, Take Profit Trader, HTTP 403). 47 wierszy z tych firm ma wartości z cytatów wyszukiwarki. Pierwsze potwierdzenie konta (`prop_rules.confirmed_at`) rób z otwartym regulaminem.
3. **"Consistency" znaczy trzy różne rzeczy:** największy dzień względem łącznego zysku (Topstep, Lucid, Apex, Alpha, MFFU), względem CELU zysku (Take Profit Trader) i względem zysku od ostatniej wypłaty (Apex PA, Alpha qualified, Lucid Pro). Skutek też inny: oblewa evala, podnosi cel (Topstep Combine, nie oblewa) albo tylko blokuje wypłatę (większość kont funded).
4. **Tradeify zmienia reguły co kilka tygodni:** limity wypłat Flex od 2026-09-01, consistency Lightning 20/25/30% dla kont po 2025-09-12 08:00 EST, 50K Select z celem $2 500 dla kont sprzed nowego dashboardu.
5. **Alpha Futures Standard:** posty firmy mówią o wycofaniu 2026-05-01 (zastąpiony przez "Premium"), a artykuł help center z 2026-07-27 pisze "Standard Account is back". Premium nie ma artykułu w help center, więc nie ma go w seedzie.
6. **MFFU Rapid:** eval liczy DD EOD, konto sim funded liczy intraday z blokadą po +$100. Marketing (strona główna) mówi "brak consistency", help center "50% w evalu". Wygrywa help center.
7. **Topstep:** DLL opcjonalny przy zakupie i niezmienny, w Live Funded obowiązkowy. Consistency Combine podnosi cel zamiast oblewać. Tabela Scaling Plan XFA jest tylko obrazkiem.
8. **Bulenox:** zwijane sekcje Master/Funded/Consistency w help center i FAQ po odczycie zostały puste. Reguł Master nie udało się odczytać, a ceny i DD są sprzeczne między `accounts-pricing` a help center.
9. **Zmiany w 2026 poza regułami:** MFFU tylko płatność jednorazowa od 2026-08-25, Earn2Trade nowy podział zysku od 2026-07-06 (50/50 poniżej progu, 80/20 powyżej), Lucid wprowadził LucidDaily (sierpień 2026), Alpha dodał Direct (2026-07-07).
10. **Zamknięte firmy futures w 2026 (nie dodawać):** FundingTicks (styczeń 2026), FundedSeat (koniec września 2026), Seacrest/MyFundedFX (luty 2026, wyjście z prop). Źródła wtórne: financemagnates.com, propfirmmap.com (blog Q2 2026), proptradingvibes.com (Q2 2026). `[DO WERYFIKACJI]`

## Status dziewięciu firm

Wszystkie działają: oficjalne artykuły help center z lipca-września 2026 (lub odczyty pośrednie z 2026 dla Apex, Tradeify, TPT). Zmian nazw nie wykryto. Nowe produkty/zmiany struktury w 2026 wymienione wyżej.

## Dodatkowe firmy (limit 2)

Nie dodano żadnej. Rankingi 2026 (propfirmmap, track360, tradezella, źródła afiliacyjne i wtórne, `[DO WERYFIKACJI]`) wymieniają te same marki, a FundedNext Futures, Phidias, Funded Futures Network i Elite Trader Funding nie pojawiły się w żadnym z nich. Brak dowodu popularności, więc nie dopisuję.

---

## Topstep

**Status:** działa, help center aktualizowany w 2026 (Express Funded Account Parameters z 2026-08-05; DLL z 2026-06-30; Scaling Plan z 2026-07-16). Większość artykułów ma tylko względną datę ("Updated over 2 weeks ago"): `[BEZ DATY]`.
**Źródła:** https://help.topstep.com/en/articles/8284197-trading-combine-parameters , https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit , https://help.topstep.com/en/articles/8284208-consistency-at-topstep , https://help.topstep.com/en/articles/10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account , https://help.topstep.com/en/articles/8284215-express-funded-account-parameters , https://help.topstep.com/en/articles/8284233-topstep-payout-policy , https://help.topstep.com/en/articles/14289835-topstep-pricing-and-payment-questions , https://www.topstep.com/no-activation-fee (cele zysku i ceny, strona firmy). Odczyt 2026-10-14.

| Program | Rozmiar | Typ DD | Max DD | Blokada (zysk) | DLL | Cel | Consistency | Min dni | Mini/Micro |
|---|---|---|---|---|---|---|---|---|---|
| Trading Combine (eval) | 50K | trailing_to_static (EOD) | $2 000 | $2 000 | opcjonalny $1 000 | $3 000 | 55% (podnosi cel) | brak | 5 / 50 |
| | 100K | | $3 000 | $3 000 | opcjonalny $2 000 | $6 000 | 55% | brak | 10 / 100 |
| | 150K | | $4 500 | $4 500 | opcjonalny $3 000 | $9 000 | 55% | brak | 15 / 150 |
| XFA Standard (funded) | 50K / 100K / 150K | trailing_to_static (EOD) | $2 000 / $3 000 / $4 500 | = max DD | opcjonalny $1 000 / $2 000 / $3 000 | brak | brak | brak | `[DO WERYFIKACJI]` (Scaling Plan tylko obrazek) |
| XFA Consistency (funded) | 50K / 100K / 150K | jw. | jw. | jw. | jw. | brak | 40% (blokuje wypłatę) | 3 | `[DO WERYFIKACJI]` |

- Consistency Combine: najlepszy dzień / łączny zysk, twarda granica 55%. Po przekroczeniu cel rośnie do `najlepszy dzień / 0,55`, konto nie oblewa. Najlepszy dzień zamyka się o 15:10 CT.
- MLL Combine: start poniżej salda o wartość MLL, trailing po saldzie EOD, blokada na saldzie startowym. XFA: saldo startuje od $0, MLL od minus DD, blokada na $0 (zysk = DD); po pierwszej wypłacie MLL = $0.
- DLL (opcjonalny, wybór przy zakupie, niezmienny): po trafieniu flatten pozycji i blokada do 17:00 CT, to nie naruszenie reguł. Live Funded: DLL obowiązkowy.
- Sesja: 17:00 CT do 15:10 CT następnego dnia.
- Wypłaty XFA: Standard: 5 dni z zyskiem netto >= $150, limit 50% salda do $2 000 / $3 000 / $5 000. Consistency: min. 3 dni z transakcją i consistency <= 40%, limit do $3 000 / $4 000 / $6 000 (resetuje się po wypłacie). Min. wypłata $125, podział 90/10 (konta na nowym dashboardzie przed 2026-01-12: 100% pierwszych $10 000).
- Ceny Combine miesięcznie (reset = ta sama kwota): ścieżka standardowa $49 / $99 / $199, aktywacja XFA $149. Ścieżka "No Activation Fee": help center $95 / $149 / $229, strona topstep.com $85 / $129 / $199 `[DO WERYFIKACJI]`. Back2Funded: $599 / $699 / $829. Dane Level 2: $38/mies.
- Nie w seedzie: Live Funded Account (zaproszenie, saldo 20% dostępne + 80% rezerwa, DLL obowiązkowy, podłoga $1 000), bo model `prop_rules` tego nie opisuje.

## Apex Trader Funding

**Status:** działa. Od 2026-03-01 reguły "4.0": EOD albo intraday trailing. `[DO WERYFIKACJI: odczyt pośredni]` dla wszystkich wierszy (HTTP 403 przy odczycie help center; wartości z podsumowań wyszukiwarki cytujących strony poniżej). Wszystkie strony `[BEZ DATY]`.
**Źródła:** https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-evaluations/ , https://apextraderfunding.com/help-center/evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/ , https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-performance-accounts-pa/ , https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-performance-accounts-pa/ , https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/ , https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-payouts/ , https://apextraderfunding.com/help-center/additional-helpful-items/50-consistency-requirement/ . Odczyt 2026-10-14.

| Program | Rozmiar | Typ DD | Max DD | Blokada (zysk) | DLL | Cel | Consistency | Mini/Micro |
|---|---|---|---|---|---|---|---|---|
| EOD Evaluation | 25K / 50K / 100K / 150K | eod | $1 000 / $2 000 / $3 000 / $4 000 | nieopisana | $500 / $1 000 / $1 500 / $2 000 | $1 500 / $3 000 / $6 000 / $9 000 | brak | 4/40, 6/60, 8/80, 12/120 |
| Intraday Trailing Evaluation | jw. | intraday | jw. | zależnie od platformy | brak | jw. | brak | jw. |
| EOD Performance Account | jw. | eod | jw. | nieopisana | tiers: tylko 50K startowy $1 000 | brak | 50% (blokuje wypłatę) | 2/20, 4/40, 6/60, 10/100 |
| Intraday Trailing PA | jw. | trailing_to_static (intraday) | jw. | DD + $100: 1 100 / 2 100 / 3 100 / 4 100 (WYWNIOSKOWANE) | nieodczytany | brak | 50% | jw. |

- Eval: brak consistency i minimum dni; 30 dni kalendarzowych na cel. DLL w EOD evalu pauzuje sesję, nie oblewa. Intraday eval nie ma DLL.
- Trailing intraday eval: Rithmic/WealthCharts zatrzymują trailing na progu celu (50K: $53 000), Tradovate trailing bez zatrzymania `[DO WERYFIKACJI]`.
- PA, wypłaty: 5 dni z minimalnym zyskiem dnia (EOD: 25K $100, 50K $250; intraday: 25K $100, 50K $200; 100K i 150K nieodczytane), min. wypłata $500, max 6 wypłat na PA, split 100% wg strony. Consistency 50%: żaden dzień >= 50% zysku od ostatniej zatwierdzonej wypłaty, dni stratne wliczają się do sumy.
- Safety net = limit DD + $100 (25K saldo 26 100, 50K 52 100; min. saldo do żądania 26 600 / 52 600). Czas obowiązywania sprzeczny: dożywotni vs pierwsze 3 wypłaty `[DO WERYFIKACJI]`.
- DLL w PA stopniowany: 50K startuje od $1 000, szczyty 25K $1 250, 100K $3 500, 150K $4 000. Startowe dla 25K/100K/150K nieodczytane.
- Godziny: dzień 18:00 ET do 16:59 ET, flat przed 16:59 ET. Newsy: strony niespójne (dozwolone w ramach strategii, zakaz pozycji dwukierunkowych vs starsza strona "zakaz news tradingu") `[DO WERYFIKACJI]`.
- Ceny: sprzeczne (aktywacja PA $125/$149/$179 wg jednej strony, $140/$220/$260 wg innej, zależnie od platformy), nie wpisane. Nowe evale nie mają resetu (trzeba kupić nowy).

## Tradeify

**Status:** działa. `[DO WERYFIKACJI: odczyt pośredni]` dla wszystkich wierszy (help.tradeify.co i tradeify.co/post zwracają 403). Strona tradeify.co/select-plan została odczytana, ale karty zawierają tekst zastępczy i niedopasowane etykiety: odrzucona jako źródło. Wszystkie `[BEZ DATY]`.
**Źródła:** https://help.tradeify.co/en/articles/12853921-select-evaluation-accounts , https://help.tradeify.co/en/articles/12853966-select-flex-and-select-daily-payout-policies , https://help.tradeify.co/en/articles/10495915-growth-evaluation-accounts , https://help.tradeify.co/en/articles/11083796-advanced-and-growth-funded-account-payout-policies , https://help.tradeify.co/en/articles/10495938-lightning-funded-accounts , https://help.tradeify.co/en/articles/10495932-lightning-funded-account-payout-policy , https://help.tradeify.co/en/articles/10468320-rules-consistency-rule , https://help.tradeify.co/en/articles/13252431-select-vs-growth-choosing-your-evaluation-type , https://help.tradeify.co/en/articles/10495897-rules-trailing-max-drawdowns . Odczyt 2026-10-14.

| Program | Faza | Rozmiar | Typ DD | Max DD | Blokada (zysk) | DLL | Cel | Consistency | Min dni | Mini/Micro |
|---|---|---|---|---|---|---|---|---|---|---|
| Select | eval | 25K / 50K / 100K / 150K | eod | $1 000 / $2 000 / $3 000 / $4 500 | brak w evalu | brak | $1 500 / $3 000 / $6 000 / $9 000 | 40% | 3 | -, 4/40, 8/80, 12/120 |
| Select Flex | funded | jw. | trailing_to_static (EOD) | jw. | DD + $100 | brak | brak | brak | brak | -, 4/40, 8/80, 12/120 |
| Select Daily | funded | tylko 50K | trailing_to_static (EOD) | $2 000 | $2 100 | $1 000 (soft) | brak | brak | brak | 4/40 |
| Growth | eval | 25K / 50K / 100K / 150K | eod | $1 000 / $2 000 / $3 500 / $5 000 | brak | $600 / $1 250 / $2 500 / $3 750 (soft) | $1 500 / $3 000 / $6 000 / $9 000 | brak | brak | 1/10, 4/40, 8/80, 12/120 |
| Growth | funded | jw. | trailing_to_static (EOD) | jw. | DD + $100 | jw. | brak | 35% (wg blogu) | brak | jw. |
| Lightning | funded | jw. | eod | $1 000 / $2 000 / $4 000 / $6 000 | brak | -, $1 250, $2 500, $3 750 | brak | 20% (rosnąco 20/25/30) | brak | 1/10, 4/40, 8/80, - |

- Select eval: dotknięcie floor w trakcie dnia oblewa, choć floor aktualizuje się EOD; blokada tylko na funded (50K: floor $50 100 po EOD >= $52 100 albo po wypłacie). 50K z celem $2 500 dla kont sprzed nowego dashboardu. Funded Select bez consistency.
- Select Flex: bez DLL i bez bufora. Wypłata co 5 dni wygranych (min. zysk dnia 25K $100, 50K $150, 100K $200, 150K $250), 50% zysku do limitu, min. $250. Limity: przed 2026-09-01 $1 250 / $3 000 / $4 000 / $5 000, po $1 250 / $2 500 / $3 500 / $4 500 `[DO WERYFIKACJI]` (artykuły się różnią). Start 1/2/3/3 miniów, skalowanie wg salda EOD. Wybór Flex/Daily jest nieodwracalny.
- Select Daily: DLL soft 25K $500 / 50K $1 000 / 100K $1 250 / 150K $1 750, wypłata codziennie ponad buforem ($2 100 dla 50K), do 2x zysk cyklu. W seedzie tylko 50K (jedyny jawny DD).
- Growth: DLL rośnie po 6% zysku (50K do $2 000). DD 100K/150K ($3 500/$5 000) ze stron innych niż artykuł Growth Evaluation `[DO WERYFIKACJI]`. Consistency 35% funded tylko wg blogu Tradeify, artykuł help nie potwierdza. Wypłata po 5 dniach z zyskiem.
- Lightning: bez evalu i bez resetu; min. wypłata $1 000, split 90%. Consistency 20% (1. wypłata), 25% (2.), 30% (3. i dalsze) dla kont po 2025-09-12 08:00 EST, starsze 20%.
- Ceny: nie wpisane (strona select-plan niewiarygodna).

## Lucid Trading

**Status:** działa. Produkty: LucidFlex, LucidPro, LucidDaily (nowy), LucidDirect, LucidMaxx; LucidBlack = legacy. Odczyt bezpośredni help center. Artykuły z 2026-05-06 do 2026-08-31 (daty w `extra.page_date`).
**Źródła:** https://support.lucidtrading.com/en/articles/12945790-lucidflex-evaluation-account , .../12945795-lucidflex-funded-account , .../12945796-lucidflex-payouts , .../12945805-lucidflex-consistency-percentage , .../12945808-lucidflex-scaling-plan , .../12945815-lucidflex-drawdown , .../12890029-lucidpro-evaluation-account , .../12890069-lucidpro-funded-account , .../12890092-lucidpro-payouts , .../12890109-lucidpro-consistency-percentage , .../12890136-lucidpro-drawdown , .../15996664-luciddaily-evaluation , .../15997244-luciddaily-funded-account , .../15997266-luciddaily-payouts , .../15998425-luciddaily-drawdown , .../16085900-luciddaily-daily-loss-limit , .../11404729-allowed-trading-times (wszystkie pod https://support.lucidtrading.com/en/articles/). Odczyt 2026-10-14.

Wspólne dla wszystkich programów: rozmiary 25K / 50K / 100K / 150K, MLL $1 000 / $2 000 / $3 000 / $4 500, trailing do blokady na saldzie startowym + $100 (zysk szczytowy $1 100 / $2 100 / $3 100 / $4 600, WYWNIOSKOWANE z "Initial Trail Balance"), kontrakty 2/20, 4/40, 6/60, 10/100.

| Program | Faza | Podstawa DD | DLL | Cel | Consistency |
|---|---|---|---|---|---|
| LucidFlex | eval | EOD | opcjonalny przy zakupie (kwoty Flex nieopublikowane) | $1 250 / $3 000 / $6 000 / $9 000 | 50% (oblewa) |
| LucidFlex | funded | EOD | opcjonalny | brak | brak |
| LucidPro | eval | EOD (lub intraday do wyboru) | opcjonalny: 50K $1 200, 100K $1 800, 150K $2 700 (25K sprzeczne `[DO WERYFIKACJI]`) | jw. | brak |
| LucidPro | funded | EOD | opcjonalny $600 / $1 200 / $1 800 / $2 700 | brak | 40% w cyklu wypłaty (35% dla kont do 2025-11-28 15:00 EST) |
| LucidDaily | eval | EOD lub intraday (wybór) | opcjonalny $600 / $1 200 / $1 800 / $2 700 | jw. | 50% |
| LucidDaily | funded | intraday (zawsze) | opcjonalny | brak | brak |

- LucidFlex funded: scaling plan (min 1-4 mini na starcie do 2/4/6/10 przy zysku $2 000-$4 500+), wypłata po 5 dniach z zyskiem (min. dzień $100 / $150 / $200 / $250), 50% zysku do $1 000 / $2 000 / $2 500 / $3 000, min. $500, split 90/10, bez bufora, po 5 wypłatach konto live. Blogi twierdzą o 40% consistency przy wypłacie Flex; oficjalna strona funded: "no Consistency Percentage".
- LucidPro funded: bufor = MLL + $100 (26 100 / 52 100 / 103 100 / 154 600), cel zysku w cyklu $250 / $500 / $750 / $1 000, max wypłata 1. / kolejne: $1 000/$1 500, $2 000/$2 500, $2 500/$3 000, $3 000/$3 500, min. $500. Split 90/10 (100% pierwszych $10 000 tylko dla kont do 2025-11-28 15:00 EST). Bez scalingu.
- LucidDaily funded: wypłata codziennie ponad buforem (MLL + $100), min. $500, bez limitu na żądanie; dzienny zysk $6 000 / $8 000 / $10 000 / $12 000 przenosi automatycznie na live.
- Godziny: flat przed 16:45 EST (Pro/Flex/Direct), wznowienie 18:00 EST; live na Rithmic 16:15 EST. Newsy: brak ograniczeń na stronie Allowed Trading Times.
- Ceny evali: nieopublikowane w artykule "Simulated Account Fees" (brak aktywacji, reset płatny bez kwoty). Nie wpisane.
- Nie w seedzie: LucidDirect, LucidMaxx, struktura Live.

## MyFundedFutures (MFFU)

**Status:** działa. Aktualna oferta: Builder, Rapid, Rapid EOD, Pro (przeprojektowany). Core i Flex = legacy. Od 2026-08-25 tylko płatność jednorazowa dla nowych zakupów. Odczyt bezpośredni help center, artykuły z 2026-07-01 do 2026-09-08, część `[BEZ DATY]` ("Updated over 2 weeks ago").
**Źródła:** https://help.myfundedfutures.com/en/articles/ + 14116402-rapid-plan-25k-a-comprehensive-look , 13134709-rapid-plan-50k-a-comprehensive-look , 13286542-rapid-plan-100k-a-comprehensive-look , 13286582-rapid-plan-150k-a-comprehensive-look , 16727601-rapid-eod-25k-a-comprehensive-look , 16158363-rapid-eod-50k-a-comprehensive-look , 17036130-builder-plan-25k-a-comprehensive-look , 14290805-builder-plan-50k-a-comprehensive-guide , 17005296-builder-plan-100k-comprehensive-guide , 17035331-builder-plan-150k-comprehensive-guide , 17573707-comprehensive-look-into-redesigned-pro-plan , 13745661-payout-policy-overview-best-and-fastest-prop-firm-payouts , 13134718-understanding-rapid-live ; ceny: https://myfundedfutures.com (strona firmy, `[BEZ DATY]`). Odczyt 2026-10-14.

| Program | Faza | Rozmiar | Typ DD | Max DD | Blokada (zysk) | DLL | Cel | Consistency | Min dni | Mini/Micro |
|---|---|---|---|---|---|---|---|---|---|---|
| Rapid | eval | 25K / 50K / 100K / 150K | 25K trailing_to_static EOD ($1 100), reszta eod | $1 000 / $2 000 / $3 000 / $4 500 | 25K: $1 100, reszta niepodana | brak | $1 500 / $3 000 / $6 000 / $9 000 | 50% (oblewa) | 2 | 3/30, 5/50, 8/80, 10/100 |
| Rapid | funded | jw. | trailing_to_static (intraday) | jw. | DD + $100 | niepodany | brak | brak | brak | jw. |
| Rapid EOD | eval | 25K / 50K | eod | $1 000 / $2 000 | niepodana | brak | $1 500 / $3 000 | 30% | 4 | 2/20, 3/30 |
| Rapid EOD | funded | jw. | trailing_to_static (EOD) | jw. | DD + $100 | brak | brak | brak | brak | jw. |
| Builder | eval | 25K / 50K / 100K / 150K | trailing_to_static (EOD) | $1 000 / $2 000 / $3 000 / $4 500 | DD + $100 | soft $600 / $1 000 / $1 750 / $2 500 | $1 500 / $3 000 / $6 000 / $9 000 | brak | 1 | 2/20, 4/40, 6/60, 9/90 |
| Builder | funded | jw. | jw. | jw. | jw. | jw. | brak | 50% (blokuje wypłatę) | 2 | jw. |
| Pro | eval | 50K / 100K / 150K | eod | $2 000 / $3 000 / $4 500 | niepodana | brak | $3 000 / $6 000 / $9 000 | 50% | 2 | 3/30, 6/60, 9/90 |
| Pro | funded | jw. | eod | jw. | statyczny po 1. wypłacie | brak | brak | brak | brak | 3, 6, 9 mini; micro `[DO WERYFIKACJI]` |

- Wypłaty: Rapid i Rapid EOD codziennie, min. $500, split 90/10, bufor w zrealizowanym zysku (Rapid $1 100 / $2 100 / $3 100 / $4 600), bez consistency. Builder: split 80/20, bufor MLL + $100, 2 dni kwalifikujące, consistency 50% w cyklu, min./max wypłaty $250/$1 000 (25K), $500/$2 000 (50K), $1 000/$3 000 (100K), $1 500/$4 500 (150K), max 5 wypłat sim, potem live. Pro: co 14 dni kalendarzowych od pierwszej transakcji, bufor $2 100 / $3 100 / $4 600, min. $1 000, split 80/20.
- Newsy T1: dozwolone w evalu, zakaz na funded. Nieaktywność: konto sim zamykane po 7 dniach bez transakcji. Przekroczenie kontraktów = breach.
- Rapid Live: DD EOD, MLL $1 000 / $2 000 / $3 000 / $4 500, kontrakty 2 / 3 / 6 / 8 mini, trigger: $10 000 zysku netto w jeden dzień (nadwyżka przepada) lub decyzja Risk Management.
- Ceny (strona główna, za plan, nie za rozmiar; ze znacznikiem promocji): Builder $92 (lista $153), Rapid $125 ($209), Rapid EOD $135 ($225), Pro $159 ($265). Reset nie podany. `[DO WERYFIKACJI]`
- `[DO WERYFIKACJI]`: Builder 25K (strona sprzeczna: MLL $1 000/bufor $1 100 vs FAQ z wariantem $2 000/$2 100), Pro (typ DD podany ogólnie, mikro funded wygląda na błąd "3 mini / 3 micro"), Rapid 100K (strona sama zaznacza rozbieżność EOD vs intraday). Builder 50K ma dwa warianty MLL ($2 000 domyślny, $1 500 add-on).

## Take Profit Trader

**Status:** działa. Ścieżka: Test, PRO (sim funded), PRO+ (live, na zaproszenie, EOD, 90/10, bez bufora). `[DO WERYFIKACJI: odczyt pośredni]` wszystkie wiersze: oficjalny help center (takeprofittraderhelp.zendesk.com) zwraca 403, artykuł Rule 1 jest `[NIEAKTUALNE?]` (ok. 335 dni).
**Źródła:** https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/15169070804125-Rule-1-Hit-Your-Profit-Target , .../15170265979165-Rule-3-Do-Not-Hit-End-Of-Day-EOD-Maximum-Trailing-Drawdown , .../15170316538013-Rule-5-Be-Consistent , .../15171769361053-PRO-Account-Rules , .../15172219527581-PRO-Account-Profit-Split-Withdrawal-Rules , .../15171820366109-How-to-Keep-Track-Of-Your-Drawdown ; FAQ firmy https://try.takeprofittrader.com/TPT-FAQs-nf40-4-0725 (`[BEZ DATY]`, prawa autorskie 2025). Odczyt 2026-10-14.

| Program | Rozmiar | Typ DD | Max DD | Blokada (zysk) | DLL | Cel | Consistency | Min dni | Mini |
|---|---|---|---|---|---|---|---|---|---|
| Test (eval) | 25K / 50K / 75K / 100K / 150K | trailing_to_static (EOD) | $1 500 / $2 000 / $2 500 / $3 000 / $4 500 | = max DD | brak | $1 500 / $3 000 / $4 500 / $6 000 / $9 000 | 50% CELU (nie oblewa) | 3 `[DO WERYFIKACJI: 3 vs 5]` | 3 / 6 / 9 / 12 / 15 |
| PRO (funded) | jw. | trailing_to_static (intraday) | jw. | = max DD | nieodczytany | brak | brak | brak | jw. `[DO WERYFIKACJI]` (tabela dotyczy Test) |

- Min. dni: FAQ firmy mówi 3 (blog firmy: zmiana z 5 na 3 od 17 sierpnia, rok niepotwierdzony), starsze strony help 5. Przyjęto 3 z oznaczeniem.
- Consistency Test: żaden dzień nie może dać >= 50% **celu zysku**; nie oblewa, trzeba handlować dalej. PRO: brak.
- DD Test liczony tylko na koniec dnia, minimum rośnie z najwyższym saldem EOD i staje na saldzie startowym; artykuł dodaje jednak, że dotknięcie minimum w trakcie dnia likwiduje konto (niejasne).
- PRO: DD intraday od szczytu salda (z niezrealizowanym), staje na saldzie startowym. Bufor = max DD (saldo bufora 26 500 / 52 000 / 77 500 / 103 000 / 154 500). Wypłata od pierwszego dnia, codziennie, split 80/20. Wypłata z bufora zamyka konto i płaci 50% (<= 60 dni handlu) albo 80% (> 60).
- Newsy PRO: flat i brak zleceń 1 min przed, w trakcie i 1 min po FOMC (środy 14:00 ET), NFP, CPI. Test: newsy dozwolone. Godziny: niedz. 17:00 CT do pt. 16:00 CT, przerwa 16:00-17:00 CT.
- Mikro: kolumna NULL (zasada 10:1 niepotwierdzona oficjalnie). Reset od $79; PRO jednorazowo $130 wg strony FAQ `[DO WERYFIKACJI]`; cena testu per rozmiar nieopublikowana.
- Nie w seedzie: PRO+ i PRO+ Development.

## Alpha Futures

**Status:** działa. Plany: Zero, Standard, Advanced, Direct (od 2026-07-07). Odczyt bezpośredni help center, artykuły z 2026-07-09 do 2026-08-21.
**Źródła:** https://help.alpha-futures.com/en/articles/11771813-zero-account-overview (2026-08-12), .../11632512-standard-account-overview (2026-07-27), .../11634907-advanced-account-overview (2026-07-22), .../15838742-direct-account-overview (2026-07-09), .../9491999-maximum-loss-limit-mll (2026-07-15), .../9492014-daily-loss-guard , .../9492048-consistency-rule (2026-07-27), .../9492063-news-trading-policy (2026-07-27), .../9492025-scaling-plan (2026-07-24), .../10743344-path-to-live (2026-08-21). Strona Terms and Conditions (ok. 765 dni) `[NIEAKTUALNE]`, nie użyta. Odczyt 2026-10-14.

MLL: EOD trailing na wszystkich kontach, stoi na saldzie startowym (blokada = DD). Daily Loss Guard to blokada do 18:00 ET następnego dnia, nie breach.

| Program | Faza | Rozmiar | Max DD | DLL (Daily Loss Guard) | Cel | Consistency | Mini/Micro |
|---|---|---|---|---|---|---|---|
| Zero | eval | 25K / 50K / 100K | $1 000 / $2 000 / $3 000 | $500 / $1 000 / $2 000 | $1 500 / $3 000 / $6 000 | brak | 1/10, 3/30, 6/60 |
| Zero | funded | jw. | jw. | jw. | brak | 40% (blokuje wypłatę) | jw. (scaling od 1/2 miniów) |
| Standard `[DO WERYFIKACJI]` | eval | 50K / 100K / 150K | $2 000 / $3 000 / $4 500 | brak | $3 000 / $6 000 / $9 000 | 50% | 5/50, 10/100, 15/150 |
| Standard `[DO WERYFIKACJI]` | funded | jw. | jw. | $1 000 / $2 000 / $3 000 | brak | 40% | jw. |
| Advanced | eval | 50K / 100K / 150K | $1 750 / $3 500 / $5 250 | brak | $4 000 / $8 000 / $12 000 | 40% (oblewa) | 5/50, 10/100, 15/150 |
| Advanced | funded | jw. | jw. | brak | brak | brak | jw. |
| Direct | funded (bez evalu) | 25K / 50K / 100K / 150K | $1 000 / $2 000 / $3 000 / $4 500 | $500 / $1 000 / $2 000 / $3 000 | brak | 20% | 2/20, 4/40, 8/80, 10/100 |

- Consistency qualified: największy dzień / zysk netto od ostatniego żądania wypłaty; przekroczenie blokuje wypłatę, nie konto; reset po wypłacie.
- Wypłaty (Zero, Standard, Advanced): 50% zysku po każdych 5 dniach wygranych >= $200, do 4 razy w miesiącu, split 90%. Limity: Zero $200 min. / $1 000 / $1 500 / $2 500 max; Standard $500 min. / $3 000 / $4 000 / $5 000; Advanced $1 000 min. / $15 000 max. Direct: cele zysku 1. wypłaty $1 500 / $3 000 / $6 000 / $9 000, 2. wypłaty $1 000 / $2 000 / $4 000 / $6 000, min. $500, max $1 000 / $2 000 / $2 500 / $3 000.
- Newsy: eval bez ograniczeń; Zero/Standard/Direct qualified: brak zleceń w oknie +-2 min od wydarzeń z czerwonym folderem (ForexFactory), pierwsze naruszenie to ostrzeżenie, kolejne breach; Advanced qualified bez ograniczeń. Dla przemówień strona podaje okno 4 minut, sprzeczne z 2 minutami `[DO WERYFIKACJI]`.
- Ceny: Zero miesięcznie $89 / $139 / $279, reset $79 / $119 / $249; Standard $129 / $239 / $349, reset $109 / $199 / $289; Advanced $209 / $349 / $489, reset $189 / $319 / $449; Direct jednorazowo $349 / $519 / $689 / $859. Aktywacja $0.
- Advanced: posty marketingowe podają 50% consistency, help i strona główna 40%. Przyjęto 40%.
- Nie w seedzie: Live (DD EOD, split 80%, brak consistency), Alpha Prime, "Premium" (brak artykułu help).

## Bulenox

**Status:** działa. Ścieżka: Qualification / Fast Track / Momentum, potem Master, potem Funded (po 3 wypłatach, decyzja Bulenox). Wszystkie wiersze `[DO WERYFIKACJI]`. Strony `[BEZ DATY]` (tylko prawa autorskie 2026). Terms of Use (PDF z lipca 2021) `[NIEAKTUALNE]`, nie użyte.
**Źródła:** https://bulenox.com/help-center/momentum , https://bulenox.com/help-center/fast-track , https://bulenox.com/help-center/qualification , https://bulenox.com/help-center/master , https://bulenox.com/help-center/funded , https://bulenox.com/accounts-pricing , https://bulenox.com/faq . Odczyt 2026-10-14.

| Program | Rozmiar | Typ DD | Max DD | Blokada (zysk) | DLL | Cel | Mini/Micro | Cena |
|---|---|---|---|---|---|---|---|---|
| Momentum Option 1 (eval) | 25K / 50K / 100K / 150K | trailing_to_static (intraday, HWM z otwartymi pozycjami) | $1 000 / $2 250 / $4 000 / $5 500 | DD + $100 (WYWNIOSKOWANE) | brak | $1 500 / $3 000 / $6 000 / $9 000 | 3/30, 7/70, 12/120, 15/150 | $94 / $143 / $248 / $358 jednorazowo |
| Momentum Option 2 (eval) | jw. | trailing_to_static (EOD) | jw. | jw. | $600 / $1 200 / $2 500 / $3 300 | jw. | 2/20, 4/40, 8/80, 12/120 | jw. |

- Opcja 1: pełny rozmiar od startu, bez scalingu. Opcja 2: EOD, stałe kontrakty, DLL pauzuje dzień. Wybór opcji trwały dla konta. Dostęp 30 dni od aktywacji. Flat przed 15:59 CT, zakaz trzymania przez noc, dzień 17:00-16:00 CT. Brak minimum dni.
- Konflikt: `accounts-pricing` podaje ceny $145 / $175 / $215 / $325 i DD "do" $1 500 / $2 500 / $3 000 / $4 500 pod każdą zakładką (te same karty pod Qualification, Fast Track i Momentum); help Momentum $94 / $143 / $248 / $358 i DD do $4 000 / $5 500 dla 100K/150K; help Fast Track $338 / $488 / $648 / $788. Wpisano help Momentum, całość `[DO WERYFIKACJI]`.
- DLL 25K: Momentum $600, Fast Track brak `[DO WERYFIKACJI]`.
- Consistency Master: tylko nagłówek "35% Consistency Rule" na stronie Momentum, bez treści `[DO WERYFIKACJI]`. FAQ: najlepszy dzień nie powinien być zbyt dużym udziałem zysku w okresie wypłaty; przekroczenie nie narusza reguł i nie zamyka konta.
- Wypłaty: split 90/10, pierwsze $10 000 bez prowizji (francuska strona help i accounts-pricing dla 25K/100K/150K); Master płatności w środy, Fast Track/Momentum codziennie; aktywacja Master jednorazowa wg rozmiaru, za Momentum $0. Kwoty i progi nieodczytane.
- Nie w seedzie: Fast Track (brak celu zysku na stronie, tabela DD i cen jak w Momentum), Qualification, Master, Funded.

## Earn2Trade

**Status:** działa. Produkty: Gauntlet Mini (GAU50/100/150/200) i Trader Career Path (TCP25/50/100). Reguły: artykuł z 2026-07-06. W seedzie tylko GAU50: tabele DD i progression ladder dla pozostałych rozmiarów są wyłącznie obrazkami `[DO WERYFIKACJI]`.
**Źródła:** https://www.earn2trade.com/gauntlet-mini (`[BEZ DATY]`), https://help.earn2trade.com/en/articles/5941958-what-are-the-trader-career-path-rules (2026-07-06), https://help.earn2trade.com/en/articles/3292351-what-is-the-progression-ladder-in-the-gauntlet-mini (2026-07-06), https://help.earn2trade.com/en/articles/3224507-what-is-the-maximum-drawdown-on-the-trader-career-path-and-the-gauntlet-mini-challenges (2026-05-08), https://help.earn2trade.com/en/articles/5452472-what-is-the-withdrawal-policy (`[BEZ DATY]`), https://help.earn2trade.com/en/articles/11183609-reset-pricing-for-earn2trade-accounts (2025-05-08, `[NIEAKTUALNE?]`). Odczyt 2026-10-14.

| Program | Faza | Rozmiar | Typ DD | Max DD | DLL | Cel | Consistency | Min dni | Mini/Micro |
|---|---|---|---|---|---|---|---|---|---|
| Gauntlet Mini | eval | 50K | eod | $2 000 | $1 100 | $3 000 | 30% (oblewa) | brak (w praktyce 4 dni z zyskiem) | 6 / 60 (WYWNIOSKOWANE 10:1) |
| Gauntlet Mini (LiveSim) | funded | 50K | eod | $2 000 | $1 100 | brak | brak | brak | 6 / 60 |

- Przekroczenie limitu kontraktów to twardy fail, przekroczenie DLL lub minimum salda kończy podejście. Flat o 15:50 CT, brak trzymania przez noc.
- Wypłaty LiveSim: co tydzień (środa, wniosek do piątku 14:00 CT), min. $100, max LiveSim $5 000 (potem live), split zależny od wielkości pojedynczej wypłaty: 50% poniżej $2 250 (GM50), 80% od tej kwoty. Progi: GM100 $3 000, GM150 $4 000, GM200 $5 000. Opłata aktywacji $139 pobierana z pierwszej wypłaty. Od 2026-07-06 nowy podział dla evali kupionych po tej dacie `[DO WERYFIKACJI]`.
- Cena GAU50: od $170/mies. (strona bez daty). Reset: GAU100 $100, GAU150 $130, GAU200 $155 (artykuł z 2025-05-08).
- Strona zakupu z parametrem `plan=GAU100` zwróciła parametry TCP25 (cel $1 750, DD $1 500, DLL $550, 3 kontrakty, consistency 30%): nietypowe, nie wpisane do seeda.

---

## Wnioski dla projektu

**Przyjmujemy jako standard (sprawdzone, wszystkie firmy):**
- Każdy program ma DD jako trailing z blokadą na saldzie startowym (lub +$100) albo EOD bez blokady; czyste `static` w tej próbie nie występuje. Model `dd_type` + `dd_lock_cents` pokrywa wszystkie 138 wierszy.
- Cel zysku, max DD i limit kontraktów istnieją w każdym evalu. DLL jest bardzo często opcjonalny albo miękki (blokada dnia), więc UI ma go pokazywać jako ostrzeżenie, nie blokadę (zgodnie z założeniem planu: AI nie składa zleceń).

**Robimy inaczej niż wynika z samego modelu (warstwa trzecia):**
- Konta funded różnią się od evali znacząco, więc preset to **para** (program, faza), jak w modelu. Szczególnie: ta sama firma ma różny typ DD w evalu i na funded (MFFU Rapid, Lucid Daily, Apex), a consistency w evalu i na funded to inna reguła z innym skutkiem. Dziennik nie powinien pokazywać jednej liczby "consistency" bez `consistency_effect` (oblewa / podnosi cel / blokuje wypłatę) i podstawy liczenia.
- Wiek presetu i data zakupu konta są ważniejsze od samych wartości: reguły zależą od daty zakupu (Lucid 2025-11-28, Tradeify 2025-09-12 i 2026-09-01, Apex 2026-03-01, Topstep 2026-01-12, Earn2Trade 2026-07-06). `prop_rules.valid_from` powinno domyślnie przyjmować datę zakupu konta, nie dzień dodania w dzienniku.
- Dla Apex, Tradeify i Take Profit Trader (47 wierszy) pierwsze potwierdzenie ma wymagać otwarcia regulaminu: stąd `needs_verification = true`.

**Rekomendacje dla modelu (decyzja `web-architect` i backendu, modelu nie zmieniałem):**
1. Kontrakt kluczy w `extra` dla `lib/domain/prop.ts`: `trail_basis` (`eod` | `intraday`), `consistency_basis` (`total_profit` | `profit_target` | `since_last_payout`), `consistency_effect` (`fail` | `raise_target` | `block_payout`), `dll_optional_usd`. W seedzie są one dziś zapisane jako wolny tekst; jeśli `prop.ts` ma je liczyć, trzeba je ujednolicić.
2. `phase` ma tylko `eval` i `funded`. Live (Topstep LFA, MFFU Live, Alpha Live, Earn2Trade Live) i etapy pośrednie (PRO+, Master) są poza seedem. Jeśli Szymon będzie handlował na live, potrzebna czwarta wartość albo osobne programy.
3. UNIQUE `(firm, program, phase, account_size_cents, read_on)`: seed ma jedną datę odczytu; ponowny odczyt = nowe wiersze, stare zostają.
4. Pokazywać `read_on` i ostrzegać o wieku presetu po 30 dniach (Tradeify, Apex i Alpha zmieniały reguły w ostatnich 8 tygodniach).

**Do uzupełnienia przez Szymona:** które konta prop faktycznie ma (firma, program, rozmiar, data zakupu, ścieżka wypłat Topstep, wybór Option 1/2 w Bulenox, DLL przy zakupie w Topstep/Lucid). Bez tego preset nie da się przypiąć poprawnie.

**Do zebrania w kolejnym przebiegu (nie zgadywałem):** Topstep XFA Scaling Plan (obraz), Bulenox Master/Funded (zwijane sekcje), Earn2Trade GAU100/150/200 i TCP50/100 (obrazy), ceny evali Apex, Lucid i MFFU per rozmiar, DLL w Apex PA dla 25K/100K/150K, Tradeify Select Daily 25K/100K/150K, Alpha Standard/Premium.

## Zapisane pliki

- R:\PROJEKTY\web_developer\projekty\trade-journal\docs\research\prop-presety.md
- R:\PROJEKTY\web_developer\projekty\trade-journal\docs\research\prop-presety.json
