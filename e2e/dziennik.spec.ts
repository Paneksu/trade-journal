import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

/*
 * Scenariusze przechodzace przez cala aplikacje: od formularza, przez zapis,
 * po liczby na pulpicie. Sprawdzamy nie to, ze "cos sie wyswietlilo",
 * tylko czy wynik zgadza sie co do centa.
 */

/** Wyciaga liczbe z tekstu w formacie polskim: "+1 020,00 USD" -> 1020.00 */
function liczbaZTekstu(tekst: string): number {
  const oczyszczony = tekst
    .replace(/−/g, "-")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(oczyszczony);
  if (!Number.isFinite(n)) throw new Error(`Nie umiem odczytać liczby z "${tekst}"`);
  return n;
}

async function wynik(page: Page): Promise<number> {
  const kafelek = page.locator("div.panel").filter({ hasText: "Wynik" }).first();
  const wartosc = await kafelek.locator("p.liczba").first().innerText();
  return liczbaZTekstu(wartosc);
}

/**
 * Dzien z szerokiego, praktycznie niekolidujacego zakresu lat - do testow,
 * ktore licza DOKLADNA liczbe trade'ow za dany dzien (np. sekcja "Pominiete").
 * Testy w tym pliku nie sprzataja trade'ow po sobie, wiec dwa przebiegi na
 * tej samej bazie na STALYM dniu podwoilyby taka liczbe.
 *
 * Zakres CELOWO konczy sie przed rokiem 2020: /trades sortuje po
 * `entryTime` malejaco (queries/trades.ts), a inne testy tego pliku klikaja
 * "pierwszy wiersz" tabeli zakladajac, ze to zwykly zamkniety trade. Losowy
 * dzien z przyszlosci wzgledem tamtych stalych dat (np. 2026) potrafilby
 * wskoczyc na czolo listy i podmienic im ten wiersz pod noga.
 */
function losowyDzien(): string {
  const bazowy = new Date(Date.UTC(1995, 0, 1));
  bazowy.setUTCDate(bazowy.getUTCDate() + Math.floor(Math.random() * 9000));
  return bazowy.toISOString().slice(0, 10);
}

test("nowy trade liczy wynik zgodnie z parametrami kontraktu", async ({ page }) => {
  await page.goto("/trades/new");

  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-05-12T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2026-05-12T16:17");
  await page.locator("#wy-0-cena").fill("20025.50");
  await page.locator("#stopLoss").fill("19990");

  // Podglad liczony w przegladarce tym samym modulem co zapis na serwerze.
  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });
  await expect(podglad.getByText("102", { exact: true })).toBeVisible();
  await expect(podglad.getByText(/\+1\s?020,00\s?USD/)).toBeVisible();
  await expect(podglad.getByText("+2.55R")).toBeVisible();

  await page.getByRole("button", { name: "Zapisz trade" }).click();

  // Karta trade'a musi pokazac dokladnie to samo, co podglad.
  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByRole("heading").first()).toContainText("NQ");
  await expect(page.getByText(/\+1\s?020,00\s?USD/).first()).toBeVisible();
  await expect(page.getByText("+2.55R").first()).toBeVisible();
  await expect(page.getByText(/^400,00\s?USD$/).first()).toBeVisible();
});

test("zapisany trade zmienia wynik netto na pulpicie o swoją kwotę", async ({ page }) => {
  await page.goto("/?zakres=wszystko");
  const przed = await wynik(page);

  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2026-05-13T16:00");
  await page.locator("#entryPrice").fill("5000");
  await page.locator("#wy-0-czas").fill("2026-05-13T16:30");
  await page.locator("#wy-0-cena").fill("5010");
  await page.locator("#stopLoss").fill("4995");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  await page.goto("/?zakres=wszystko");
  const po = await wynik(page);

  // 40 tickow ES po 12,50 USD = 500 USD.
  expect(Number((po - przed).toFixed(2))).toBe(500);
});

test("nowe pole własne pojawia się w formularzu i w filtrach", async ({ page }) => {
  const znacznik = Date.now();
  const nazwa = `Test pola ${znacznik}`;
  // Klucz powstaje z nazwy tak samo jak w `toKey`.
  const klucz = `test_pola_${znacznik}`;

  await page.goto("/settings/fields");
  await page.getByRole("button", { name: "Nowe pole własne" }).click();
  await page.locator("#fld-label-new").fill(nazwa);
  await page.locator("#fld-type-new").selectOption("select");
  await page.locator("#fld-options-new").fill("alfa\nbeta");
  await page.getByRole("button", { name: "Zapisz" }).first().click();
  await expect(page.getByText("Zapisano pole.").first()).toBeVisible();

  // Formularz trade'a podchwytuje pole bez zmian w kodzie.
  await page.goto("/trades/new");
  const pole = page.locator(`select[name="field__${klucz}"]`);
  await expect(pole).toBeVisible();
  await expect(pole.getByRole("option", { name: "beta" })).toHaveCount(1);

  // I to samo pole filtruje tabelę.
  await page.goto("/trades");
  await page.getByRole("button", { name: /Filtry/ }).click();
  await expect(page.locator(`select[name="pole_${klucz}"]`)).toBeVisible();
});

test("sesja backtestu ma statystyki osobne od dziennika", async ({ page }) => {
  const nazwa = `Sesja testowa ${Date.now()}`;

  await page.goto("/backtest");
  await page.getByRole("button", { name: "Nowa sesja backtestu" }).click();
  await page.locator("#name").fill(nazwa);
  await page.locator("#targetTrades").fill("20");
  await page.getByRole("button", { name: "Utwórz sesję" }).click();

  await expect(page).toHaveURL(/\/backtest\/\d+$/);
  await expect(page.getByRole("heading", { name: nazwa })).toBeVisible();
  await expect(page.getByText(/Tylko 0 z 20 trade'ów/)).toBeVisible();

  const adresSesji = page.url();

  await page.getByRole("link", { name: "Dodaj trade do sesji" }).click();
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2026-04-01T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2026-04-01T15:55");
  await page.locator("#wy-0-cena").fill("20010");
  await page.locator("#stopLoss").fill("19995");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByText(`Trade z sesji backtestu: ${nazwa}`)).toBeVisible();

  // Sesja widzi swój trade...
  await page.goto(adresSesji);
  await expect(page.getByText(/Tylko 1 z 20 trade'ów/)).toBeVisible();

  // ...a dziennik realny go nie liczy.
  await page.goto("/trades");
  await expect(page.getByText(nazwa)).toHaveCount(0);
});

test("zrzut wykresu wgrywa się i jest widoczny tylko po zalogowaniu", async ({
  page,
  browser,
}) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2026-04-20T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2026-04-20T15:45");
  await page.locator("#wy-0-cena").fill("20005");
  await page.locator("#stopLoss").fill("19995");

  // Obrazki generowane w locie - bez plikow pomocniczych w repozytorium.
  const png = async (kolor: string) =>
    sharp({ create: { width: 32, height: 32, channels: 3, background: kolor } })
      .png()
      .toBuffer();

  // Jedno pole na wszystkie zrzuty (ADR-009) - dwa pliki naraz.
  await page.locator("#shot").setInputFiles([
    { name: "wykres-1.png", mimeType: "image/png", buffer: await png("#1d3a33") },
    { name: "wykres-2.png", mimeType: "image/png", buffer: await png("#3a1d33") },
  ]);

  // Interwal per plik (ADR-015) - kazdy zrzut w podgladzie dostaje wlasny
  // wybor, drugi zostaje bez interwalu ("—"), zeby test pokryl tez brak
  // wartosci obok wartosci ustawionej.
  await page
    .getByRole("combobox", { name: "Interwał zrzutu 1" })
    .selectOption("5m");

  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  const obrazy = page.locator('img[src^="/api/screenshots/"]');
  await expect(obrazy).toHaveCount(2);

  const obraz = obrazy.first();
  await expect(obraz).toBeVisible();

  // Siatka ciagnie miniatury, nie pelne pliki - inaczej osiem zrzutow to
  // kilkanascie megabajtow na jedno wejscie na strone.
  const adres = await obraz.getAttribute("src");
  expect(adres).toContain("-mini.webp");

  // Interwal zapisany przy pierwszym zrzucie jest widoczny na kaflu (jako
  // edytowalny select, bo tu wolno tez kasowac - ADR-015), drugi zostal bez
  // wyboru i pokazuje pusta opcje.
  const wyborInterwalu1 = page.getByRole("combobox", { name: "Interwał zrzutu 1" });
  await expect(wyborInterwalu1).toHaveValue("5m");
  const wyborInterwalu2 = page.getByRole("combobox", { name: "Interwał zrzutu 2" });
  await expect(wyborInterwalu2).toHaveValue("");

  // Poprawka interwalu po fakcie, bez przeladowania strony ani zagniezdzonego
  // formularza (wzorzec z tag-manager.tsx).
  await wyborInterwalu2.selectOption("1h");
  await expect(wyborInterwalu2).toHaveValue("1h");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Interwał zrzutu 2" })).toHaveValue("1h");

  // Powiekszenie: strzalki przewijaja, Escape zamyka, interwal widoczny.
  await page.getByRole("button", { name: /Powiększ zrzut 1 z 2/ }).click();
  const okno = page.locator("dialog[open]");
  await expect(okno).toBeVisible();
  await expect(okno.getByText("1 / 2")).toBeVisible();
  await expect(okno.getByText("5m", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(okno.getByText("2 / 2")).toBeVisible();
  await expect(okno.getByText("1h", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Zalogowany dostaje plik...
  const zalogowany = await page.request.get(adres as string);
  expect(zalogowany.status()).toBe(200);
  expect(zalogowany.headers()["content-type"]).toContain("image/webp");

  // ...a ktos bez sesji zostaje zawrocony na logowanie. Bez `maxRedirects`
  // Playwright poszedlby za przekierowaniem i zobaczyl 200 na stronie logowania.
  const czysty = await browser.newContext({ storageState: undefined });
  const bezSesji = await czysty.request.get(`http://localhost:3000${adres}`, { maxRedirects: 0 });
  expect(bezSesji.status()).toBe(307);
  expect(bezSesji.headers().location).toContain("/login");
  await czysty.close();
});

test("dziennik nie wpuszcza bez hasła", async ({ browser }) => {
  // `storageState: undefined` jest konieczne: Playwright dokleja do recznie
  // tworzonych kontekstow opcje z konfiguracji projektu, w tym zapisana sesje.
  const czysty = await browser.newContext({ storageState: undefined });
  const strona = await czysty.newPage();
  await strona.goto("/stats");
  await expect(strona).toHaveURL(/\/login/);
  await czysty.close();
});

/*
 * ETAP 4a przeniosl przeliczanie "kwota brokera -> cena wyjscia" z gornego,
 * calotradeowego pola #brokerAmount na pole PER KAWALEK (#wy-0-kwota, pod
 * "kwota i notatka"). Ten test byl kiedys zawieszony na #brokerAmount - dziś
 * ten mechanizm siedzi gdzie indziej, wiec test zostal przepisany na nowe
 * pole. Liczby (siatka tickow, znak przy stracie/short, zaokraglenie do
 * najblizszego ticku) sa dokladnie te same co przed zmiana - sprawdzone
 * reczne uruchomienie na tej samej bazie potwierdza identyczne wartosci co
 * do centa.
 */
test("kwota z brokera na kawałku liczy cenę wyjścia zgodnie z siatką tickową", async ({
  page,
}) => {
  await page.goto("/trades/new");

  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-05-12T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2026-05-12T16:17");

  const exit = page.locator("#wy-0-cena");
  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });

  // Kwota per-kawalek zyje pod "kwota i notatka" - trzeba ja rozwinac,
  // zanim pole #wy-0-kwota w ogole jest w DOM widoczne dla uzytkownika.
  await page.getByRole("button", { name: "kwota i notatka" }).click();
  const kwota = page.locator("#wy-0-kwota");

  // Kwota lezaca na siatce: 25 tickow po 10 USD na 2 kontraktach = 250.
  await kwota.fill("250");
  await expect(exit).toHaveValue("20006.25");
  await expect(podglad.getByText(/\+250,00\s?USD/)).toBeVisible();

  // Kwota miedzy tickami (ADR-016, teraz per kawalek): cena idzie na
  // najblizszy tick, ale wynik zostaje taki, jak wpisany - siatka nie ma
  // prawa dopisac uzytkownikowi 5 USD.
  await kwota.fill("255");
  await expect(exit).toHaveValue("20006.5");
  await expect(podglad.getByText(/\+255,00\s?USD/)).toBeVisible();

  // Zmiana liczby kontraktow przelicza cene bez ruszania pola kwoty.
  await page.locator("#contracts").fill("1");
  await expect(kwota).toHaveValue("255");
  await expect(exit).toHaveValue("20012.75");
  await expect(podglad.getByText(/\+255,00\s?USD/)).toBeVisible();

  // Short liczy w druga strone.
  await page.locator("#contracts").fill("2");
  await page.getByText("Short", { exact: true }).click();
  await kwota.fill("250");
  await expect(exit).toHaveValue("19993.75");
  await expect(podglad.getByText(/\+250,00\s?USD/)).toBeVisible();
  await page.getByText("Long", { exact: true }).click();

  // Strata: cena po przeciwnej stronie wejscia.
  await kwota.fill("-250");
  await expect(exit).toHaveValue("19993.75");
  await expect(podglad.getByText(/−250,00\s?USD/)).toBeVisible();

  // Brak ceny wejscia: pole ceny wyjscia PUSTE, nie cichy powrot do
  // poprzedniej ceny - to zapisalby liczbe, ktorej podglad nie potwierdza.
  await kwota.fill("250");
  await page.locator("#entryPrice").fill("");
  await expect(exit).toHaveValue("");
  await page.locator("#entryPrice").fill("20000");
  await expect(exit).toHaveValue("20006.25");

  // Reczna edycja ceny gasi wyliczenie.
  await exit.fill("20010");
  await expect(kwota).toHaveValue("");
  await expect(exit).toHaveValue("20010");

  // Skasowanie kwoty przywraca ostatnia reczna cene - kwota jest nakladka,
  // nie kasuje tego, co uzytkownik wpisal sam.
  await kwota.fill("250");
  await expect(exit).toHaveValue("20006.25");
  await kwota.fill("");
  await expect(exit).toHaveValue("20010");

  // Zapis kwoty spoza siatki - karta trade'a musi pokazac ja, nie 260,00.
  await kwota.fill("255");
  await expect(exit).toHaveValue("20006.5");
  await page.getByRole("button", { name: "Zapisz trade" }).click();

  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByText(/\+255,00\s?USD/).first()).toBeVisible();
  await expect(page.getByText(/\+260,00\s?USD/)).toHaveCount(0);

  // Edycja wraca z wypelniona kwota (po rozwinieciu "kwota i notatka"), a
  // jej skasowanie oddaje wynik siatce.
  const adres = page.url();
  await page.goto(`${adres}/edit`);
  await page.getByRole("button", { name: "kwota i notatka" }).click();
  await expect(page.locator("#wy-0-kwota")).toHaveValue("255");
  await expect(page.locator("#wy-0-cena")).toHaveValue("20006.5");

  await page.locator("#wy-0-kwota").fill("");
  await page.getByRole("button", { name: "Zapisz zmiany" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByText(/\+260,00\s?USD/).first()).toBeVisible();
});

test("kwota z brokera dla całego trade'a nadal nadpisuje wynik, ale nie rusza ceny kawałka (ADR-016)", async ({
  page,
}) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-05-14T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2026-05-14T16:00");
  await page.locator("#wy-0-cena").fill("20010");

  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });
  // Bez kwoty trade'a: 40 tickow * 2 kontrakty * 5,00 USD = 400.
  await expect(podglad.getByText(/\+400,00\s?USD/)).toBeVisible();

  // Kwota trade'a bije nawet cene juz wpisana w wierszu (ADR-016) - sama
  // cena w polu #wy-0-cena NIE zmienia sie, zmienia sie tylko wynik.
  await page.locator("#brokerAmount").fill("300");
  await expect(podglad.getByText(/\+300,00\s?USD/)).toBeVisible();
  await expect(page.locator("#wy-0-cena")).toHaveValue("20010");

  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByText(/\+300,00\s?USD/).first()).toBeVisible();
});

/*
 * ZNALEZISKO QA (zgloszone w raporcie, nie naprawiane tutaj): przed ETAP 4a
 * samo wpisanie kwoty z brokera w gornym polu #brokerAmount, bez dotykania
 * pola ceny wyjscia, wyliczalo i wypelnialo cene automatycznie (byla to
 * jedna z podstawowych sciezek wpisywania trade'a - "wiem ile zarobilem,
 * nie wiem po ile dokladnie wyszedlem"). Po przejsciu na repeater wyjsc ta
 * sciezka jest rozlaczona: #brokerAmount juz NIE dotyka #wy-0-cena (patrz
 * trade-form.tsx - wyliczanie ceny z kwoty jest teraz WYLACZNIE per kawalek,
 * przez #wy-0-kwota). Serwer (czytajWyjscia, actions/trades.ts:103-105)
 * odrzuca kazdy wiersz bez ceny bezwarunkowo, wiec ten wczesniej dzialajacy
 * przypadek dzis konczy sie bledem walidacji zamiast zapisem. Test
 * dokumentuje DZISIEJSZE zachowanie - nie twierdzi, ze jest ono pozadane.
 */
test("kwota z brokera dla całego trade'a wypełnia cenę jedynego wyjścia (ADR-016)", async ({
  page,
}) => {
  /* Sciezka "znam kwote z rachunku, nie znam ceny wypelnienia". Przy JEDNYM
     wyjsciu kwota calego trade'a podpowiada cene tego kawalka - przy kilku
     wyjsciach nie ma jak jej przypisac i pole zostaje puste.
     NQ: 300 USD przy 2 kontraktach to 30 tickow, czyli 20000 + 30 * 0,25. */
  const dzien = losowyDzien();
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill(`${dzien}T15:35`);
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill(`${dzien}T16:00`);
  await page.locator("#brokerAmount").fill("300");

  await expect(page.locator("#wy-0-cena")).toHaveValue("20007.5");

  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });
  await expect(podglad.getByText("30", { exact: true })).toBeVisible();
  await expect(podglad.getByText(/\+300,00\s?USD/)).toBeVisible();

  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByText(/\+300,00\s?USD/).first()).toBeVisible();
});

test("dzień bez transakcji zapisuje się i liczy w pokryciu dziennika", async ({ page }) => {
  // Miesiac bez zadnych danych, zeby liczby nie zalezaly od reszty zestawu.
  await page.goto("/calendar?miesiac=2020-03&dzien=2020-03-03");

  // Stan wyjsciowy wymuszony, a nie zalozony - inaczej przerwany przebieg
  // zostawia flage i nastepne uruchomienie startuje od jedynki.
  await page.getByLabel("Dzień bez transakcji").uncheck();
  await page.getByRole("button", { name: "Zapisz notatkę" }).click();
  await expect(page.getByText("Zapisano notatkę dnia.")).toBeVisible();

  const kafelPauz = page.locator("div.panel").filter({ hasText: "Dni bez transakcji" }).first();
  await expect(kafelPauz.locator("p.liczba").first()).toHaveText("0");

  await page.getByLabel("Dzień bez transakcji").check();
  await page.locator("#noTradeReason").selectOption({ label: "Brak setupu" });
  await page.getByRole("button", { name: "Zapisz notatkę" }).click();
  await expect(page.getByText("Zapisano notatkę dnia.")).toBeVisible();

  await page.goto("/calendar?miesiac=2020-03");
  await expect(kafelPauz.locator("p.liczba").first()).toHaveText("1");
  await expect(page.getByText("Brak setupu 1")).toBeVisible();

  // Kafel dnia mowi wprost, ze to pauza, a nie dziura w dzienniku.
  const kafelDnia = page.getByRole("link", { name: /bez transakcji/ });
  await expect(kafelDnia).toContainText("Brak setupu");
  await expect(kafelDnia).toHaveAttribute("href", "/calendar?dzien=2020-03-03");

  // Odznaczenie wraca do stanu wyjsciowego - test nie zostawia sladu.
  await page.goto("/calendar?miesiac=2020-03&dzien=2020-03-03");
  await page.getByLabel("Dzień bez transakcji").uncheck();
  await page.getByRole("button", { name: "Zapisz notatkę" }).click();
  await expect(page.getByText("Zapisano notatkę dnia.")).toBeVisible();

  await page.goto("/calendar?miesiac=2020-03");
  await expect(kafelPauz.locator("p.liczba").first()).toHaveText("0");
});

test("dnia z trade'ami nie da się oznaczyć jako bez transakcji", async ({ page }) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2020-04-06T15:30");
  await page.locator("#entryPrice").fill("4000");
  await page.locator("#wy-0-czas").fill("2020-04-06T16:00");
  await page.locator("#wy-0-cena").fill("4002");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  await page.goto("/calendar?miesiac=2020-04&dzien=2020-04-06");
  const znacznik = page.getByLabel("Dzień bez transakcji");
  await expect(znacznik).toBeDisabled();
  await expect(page.getByText("Tego dnia są już zapisane trade'y.")).toBeVisible();
});

test("zrzut wklejony ze schowka ląduje w dniu bez transakcji", async ({ page }) => {
  await page.goto("/calendar?miesiac=2020-03&dzien=2020-03-03");

  const zrzut = page.getByAltText(/Zrzut \d+ z \d+ — dzień 2020-03-03/);

  // Stan wyjsciowy wymuszony, a nie zalozony - przerwany przebieg zostawia zrzut.
  page.on("dialog", (d) => d.accept());
  while ((await zrzut.count()) > 0) {
    await page.getByRole("button", { name: "Usuń zrzut" }).first().click();
    await expect(page.getByRole("button", { name: "Usuń zrzut" })).toHaveCount(
      (await zrzut.count()) - 1,
    );
  }
  await expect(zrzut).toHaveCount(0);

  // Znacznik mowi, ze nasluch wklejania jest juz podpiety. Bez tego zdarzenie
  // potrafi wyprzedzic hydratacje i przepasc bez sladu.
  await expect(page.locator('[data-wklejanie="gotowe"]')).toBeVisible();

  // Ctrl+V z platformy: zdarzenie wklejenia z plikiem, bez zapisywania go na dysk.
  await page.evaluate(() => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const dane = new DataTransfer();
    dane.items.add(new File([png], "zrzut.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dane, bubbles: true }));
  });

  await expect(zrzut).toHaveCount(1);

  // Plik musi byc realnie do pobrania spod adresu, ktory trafil do miniatury.
  const adres = await zrzut.getAttribute("src");
  const odpowiedz = await page.request.get(adres!);
  expect(odpowiedz.status()).toBe(200);
  expect(odpowiedz.headers()["content-type"]).toBe("image/webp");

  // Sprzatanie - test nie zostawia sladu w dzienniku.
  await page.getByRole("button", { name: "Usuń zrzut" }).click();
  await expect(zrzut).toHaveCount(0);
});

test("sesja backtestu dokumentuje dzień bez sygnału razem ze zrzutem", async ({ page }) => {
  const nazwa = `Sesja pauz ${Date.now()}`;

  await page.goto("/backtest");
  await page.getByRole("button", { name: "Nowa sesja backtestu" }).click();
  await page.locator("#name").fill(nazwa);
  await page.locator("#dataFrom").fill("2020-06-01");
  await page.locator("#dataTo").fill("2020-06-05");
  await page.getByRole("button", { name: "Utwórz sesję" }).click();
  await expect(page).toHaveURL(/\/backtest\/\d+$/);

  const panel = page.locator("section.panel").filter({ hasText: "Dni bez sygnału" });
  // Piec dni roboczych w zakresie, zero zapisow.
  await expect(panel).toContainText("0/5");

  await page.locator("#ntd-day").fill("2020-06-02");
  await page.locator("#ntd-reason").selectOption("no_setup");
  await page.locator("#ntd-note").fill("Zakres otwarcia węższy niż 10 ticków, brak wybicia.");
  await page.getByRole("button", { name: "Zapisz dzień bez sygnału" }).click();
  await expect(page.getByText("Zapisano dzień bez sygnału.")).toBeVisible();

  await expect(panel).toContainText("2 czerwca 2020");
  await expect(panel).toContainText("Brak setupu");
  await expect(panel).toContainText("1/5");

  // Zrzut wkleja sie w wybrany dzien sesji.
  await panel.getByRole("link", { name: "2 czerwca 2020" }).click();
  await expect(page.locator('[data-wklejanie="gotowe"]')).toBeVisible();
  await page.evaluate(() => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const dane = new DataTransfer();
    dane.items.add(new File([png], "wykres.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dane, bubbles: true }));
  });
  await expect(page.getByAltText(/Zrzut \d+ z \d+ — dzień 2020-06-02/)).toHaveCount(1);

  // Dzien, w ktorym sesja ma trade, nie moze udawac dnia bez sygnalu.
  await page.getByRole("link", { name: "Dodaj trade do sesji" }).click();
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2020-06-03T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2020-06-03T15:55");
  await page.locator("#wy-0-cena").fill("20010");
  await page.locator("#stopLoss").fill("19995");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  await page.goto(`/backtest?szukaj=`);
  await page.getByRole("link", { name: nazwa }).click();
  await page.locator("#ntd-day").fill("2020-06-03");
  await page.getByRole("button", { name: "Zapisz dzień bez sygnału" }).click();
  await expect(page.getByText(/Ta sesja ma tego dnia zapisany trade/)).toBeVisible();

  // Trade i zapisana pauza razem daja dwa z pieciu dni.
  await expect(panel).toContainText("2/5");
});

test("filtr wynik=be zgadza sie z liczba trade'ow ze statystyk na granicy progu (ADR-011)", async ({
  page,
}) => {
  // ES, tick 0,25 = 12,50 USD. Stop 20 punktow (80 tickow) = ryzyko 1000,00 USD.
  // Domyslny prog BE to 0,100R, wiec dokladnie 100,00 USD - dokladnie 8 tickow.
  // Trzy trade'y siadaja przy tej granicy: -9 tickow (-112,50 USD, ~-0,11R,
  // pod progiem -> strata), +8 tickow (100,00 USD, dokladnie prog -> be,
  // granica jest domknieta) i +9 tickow (112,50 USD, ~0,11R, nad progiem -> zysk).
  // Wariant "7 tickow" byloby BE, nie strata - prog dziala co do modulu.
  const dzien = "2026-07-01";
  const warianty = [
    { minuta: "09:30", ticki: -9, exit: "4997.75" },
    { minuta: "09:31", ticki: 8, exit: "5002.00" },
    { minuta: "09:32", ticki: 9, exit: "5002.25" },
  ];

  for (const w of warianty) {
    await page.goto("/trades/new");
    await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
    await page.locator("#contracts").fill("1");
    await page.locator("#entryTime").fill(`${dzien}T${w.minuta}`);
    await page.locator("#entryPrice").fill("5000");
    await page.locator("#wy-0-czas").fill(`${dzien}T09:45`);
    await page.locator("#wy-0-cena").fill(w.exit);
    await page.locator("#stopLoss").fill("4980");
    await page.getByRole("button", { name: "Zapisz trade" }).click();
    await expect(page).toHaveURL(/\/trades\/\d+$/);
  }

  /* Sedno testu: prog BE liczy sie raz w SQL (filtr) i raz w TypeScripcie
     (statystyki). Porownujemy obie liczby zamiast wpisywac na sztywno jedna -
     kolejne uruchomienia dokladaja trade'y do tego samego dnia, a rozjazd
     miedzy filtrem a statystykami zlapie sie przy kazdej ich liczbie. */
  await page.goto(`/trades?od=${dzien}&do=${dzien}&wynik=be`);
  const podpisTabeli = await page.getByText(/\d+ .* w widoku$/).innerText();
  const zTabeli = Number(podpisTabeli.match(/\d+/)?.[0]);
  // Wariant "+8 tickow" musi tu byc, inaczej granica przestala byc domknieta.
  expect(zTabeli).toBeGreaterThan(0);

  await page.goto(`/stats?od=${dzien}&do=${dzien}&wynik=be`);
  /* Kafelek KPI, nie panel filtrow - slowo "Wynik" pada takze w etykiecie
     filtra, wiec zwykly `hasText` trafialby w panel obok. */
  const kafelekWynik = page.locator("div.panel").filter({
    has: page.locator("p.etykieta", { hasText: /^Wynik$/ }),
  });
  await expect(kafelekWynik).toContainText(new RegExp(`${zTabeli}\\s*trade`));
});

test("ta sama konfluencja na dwoch interwalach przezywa edycje", async ({ page }) => {
  /*
   * Sedno ADR-017. Sprawdzamy trzy rzeczy naraz, bo kazda osobno wygladalaby
   * na dzialajaca:
   *  1. chipy interwalow odslaniaja sie po zaznaczeniu tagu (czysty CSS),
   *  2. dwa interwaly zapisuja sie jako DWA przypisania, nie jedno,
   *  3. ponowny zapis bez zmian nie mnozy wierszy.
   */
  await page.goto("/trades");
  const wiersz = page.locator("table tbody tr").first();
  await wiersz.locator("a").first().click();
  await page.getByRole("link", { name: /edytuj/i }).first().click();
  await page.waitForURL(/\/edit$/);

  const pierwszaKonfluencja = page.locator('input[name="tag"]').first();
  const idTagu = await pierwszaKonfluencja.getAttribute("value");

  /* Klikamy w `<label>`, ale TYLKO gdy pole nie jest jeszcze zaznaczone:
     klikniecie PRZELACZA, wiec przy trade'cie, ktory te interwaly juz ma
     (choćby z poprzedniego przebiegu tego testu na tej samej bazie), test
     odznaczalby je i sprawdzal wlasna szkode. `check()` wprost na kontrolce
     tez nie przejdzie - checkbox jest `sr-only`, klikalny jest tylko label. */
  const wlacz = async (id: string) => {
    const pole = page.locator(`#${id}`);
    if (!(await pole.isChecked())) await page.locator(`label[for="${id}"]`).click();
    await expect(pole).toBeChecked();
  };

  await wlacz(`tag-${idTagu}`);

  const grupa = page.locator(`[aria-label^="Interwały dla konfluencji"]`).first();
  await expect(grupa).toBeVisible();

  await wlacz(`tagint-${idTagu}-4h`);
  await wlacz(`tagint-${idTagu}-5m`);
  await page.getByRole("button", { name: /zapisz zmiany/i }).click();
  await page.waitForURL(/\/trades\/\d+$/);

  /* Na karcie trade'a ta sama nazwa tagu ma pojawic sie DWA razy - raz na
     kazdym interwale. Jeden chip znaczylby, ze drugi interwal przepadl.

     Szukamy po `title` chipa, nie po tekscie "4h": na tej samej stronie stoi
     lista wyboru interwalu dla nowych zrzutow, a jej `<option>4h</option>` jest
     ukryta - `getByText("4h").first()` trafial wlasnie w nia i test przewracal
     sie mimo poprawnego zapisu. */
  await expect(page.locator('[title$="· 4h"]').first()).toBeVisible();
  await expect(page.locator('[title$="· 5m"]').first()).toBeVisible();

  const adresKarty = page.url();
  await page.goto(`${adresKarty}/edit`);
  await expect(page.locator(`#tagint-${idTagu}-4h`)).toBeChecked();
  await expect(page.locator(`#tagint-${idTagu}-5m`)).toBeChecked();

  // Ponowny zapis bez zmian: nadal dwa przypisania, nie cztery.
  await page.getByRole("button", { name: /zapisz zmiany/i }).click();
  await page.waitForURL(/\/trades\/\d+$/);
  await page.goto(`${adresKarty}/edit`);
  const zaznaczone = await page.locator(`input[name="tagint:${idTagu}"]:checked`).count();
  expect(zaznaczone).toBe(2);
});

test("pole kierunku pojawia sie tylko przy stracie, nie przy wygranej", async ({ page }) => {
  // ADR-018: przy wygranej pytanie nie ma sensu, bo trafnosc wynika z wyniku.
  await page.goto("/trades?wynik=zysk");
  await page.locator("table tbody tr").first().locator("a").first().click();
  await page.getByRole("link", { name: /edytuj/i }).first().click();
  await page.waitForURL(/\/edit$/);
  await expect(page.locator('input[name="directionCorrect"]')).toHaveCount(0);
  await expect(page.getByText(/kierunek trafiony/i).first()).toBeVisible();

  await page.goto("/trades?wynik=strata");
  await page.locator("table tbody tr").first().locator("a").first().click();
  await page.getByRole("link", { name: /edytuj/i }).first().click();
  await page.waitForURL(/\/edit$/);
  await expect(page.locator('input[name="directionCorrect"]')).toHaveCount(1);
  // Ukryte pole odrozniajace "kierunek chybiony" od "nie pytalismy" (ADR-018).
  await expect(page.locator('input[name="kierunek_oceniany"]')).toHaveCount(1);
});

test("galeria pokazuje kafle ze zrzutem i filtruje po tagu", async ({ page }) => {
  await page.goto("/galeria");
  await expect(page.getByRole("heading", { name: "Galeria" })).toBeVisible();

  const kafle = page.locator("main ul > li");
  const ile = await kafle.count();
  if (ile > 0) {
    // Domyslnie tylko trade'y ze zrzutem (ADR-019), wiec kazdy kafel ma obraz.
    await expect(kafle.first().locator("img")).toHaveAttribute("loading", "lazy");
    await kafle.first().locator("a").click();
    await expect(page).toHaveURL(/\/trades\/\d+$/);
  }
});

/*
 * Status "missed" ("nie wzięty"): setup byl, ale uzytkownik go nie wzial.
 * Ma pelny wynik hipotetyczny (pnl, rMultiple), ale nie liczy sie do
 * statystyk - bariera to doslownie `status === "closed"` (closedOnly,
 * queries/trades.ts). Testy nizej pilnuja tej granicy z obu stron: ze
 * "missed" NIE wchodzi tam, gdzie nie powinien, i ze WCHODZI tam, gdzie ma
 * (sekcja "Pominiete", galeria, kafel pauzy w kalendarzu).
 */

test("trade nie wzięty z dodatnim wynikiem nie rusza KPI pulpitu, ale liczy się w sekcji Pominięte", async ({
  page,
}) => {
  // Dzien losowany przy kazdym przebiegu (szeroki, niewykorzystywany przez
  // zaden inny test zakres lat) - testy tego pliku nie sprzataja po sobie
  // trade'ow (konwencja calego zestawu), wiec dwa kolejne przebiegi na tej
  // samej bazie lokalnej na STALYM dniu podwoilyby liczbe "Pominietych" i
  // asercja "dokladnie 1" pekalaby przy kazdym powtornym uruchomieniu.
  const dzien = losowyDzien();

  await page.goto("/?zakres=wszystko");
  const przed = await wynik(page);

  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill(`${dzien}T15:30`);
  await page.locator("#entryPrice").fill("5000");
  await page.locator("#wy-0-czas").fill(`${dzien}T16:00`);
  await page.locator("#wy-0-cena").fill("5010");
  await page.locator("#status").selectOption("missed");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);
  // Karta pokazuje wynik hipotetyczny mimo statusu "nie wzięty" (maWynik).
  await expect(page.getByText(/\+500,00\s?USD/).first()).toBeVisible();

  // Pulpit: dokladnie ta sama kwota co przed zapisem - "missed" nie wchodzi
  // do closedOnly, wiec KPI nie moze drgnac.
  await page.goto("/?zakres=wszystko");
  const po = await wynik(page);
  expect(Number((po - przed).toFixed(2))).toBe(0);

  // /stats: filtr na dokladnie ten dzien, zeby liczba "Pominietych" byla
  // policzalna niezaleznie od reszty danych w bazie.
  await page.goto(`/stats?od=${dzien}&do=${dzien}`);
  const panel = page.locator("section.panel").filter({ hasText: "Pominięte" });
  await expect(page.getByRole("heading", { name: "Pominięte" })).toBeVisible();
  await expect(panel).toContainText(/1\s?trade/);
});

test("dzień z samym pominiętym trade'em da się oznaczyć jako bez transakcji", async ({ page }) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2021-02-10T15:30");
  await page.locator("#entryPrice").fill("5000");
  await page.locator("#wy-0-czas").fill("2021-02-10T16:00");
  await page.locator("#wy-0-cena").fill("4990");
  await page.locator("#status").selectOption("missed");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  // Lustrzane wobec "dnia z trade'ami nie da się oznaczyć jako bez transakcji"
  // (ok. l. 368): tam prawdziwy trade blokuje znacznik, tu sam "missed" go
  // NIE blokuje, bo countTradesOnDay (queries/journal.ts) go pomija.
  await page.goto("/calendar?miesiac=2021-02&dzien=2021-02-10");
  const znacznik = page.getByLabel("Dzień bez transakcji");
  await expect(znacznik).toBeEnabled();
  await expect(page.getByText("Tego dnia są już zapisane trade'y.")).toHaveCount(0);

  await znacznik.check();
  await page.locator("#noTradeReason").selectOption({ label: "Brak setupu" });
  await page.getByRole("button", { name: "Zapisz notatkę" }).click();
  await expect(page.getByText("Zapisano notatkę dnia.")).toBeVisible();

  // Sprzatanie - test nie zostawia notatki dnia w bazie (sam trade zostaje,
  // tak jak w pozostalych testach tego pliku).
  await page.goto("/calendar?miesiac=2021-02&dzien=2021-02-10");
  await page.getByLabel("Dzień bez transakcji").uncheck();
  await page.getByRole("button", { name: "Zapisz notatkę" }).click();
  await expect(page.getByText("Zapisano notatkę dnia.")).toBeVisible();
});

test("kafel kalendarza z samym pominiętym trade'em pokazuje dalej pauzę, nie dzień handlowy", async ({
  page,
}) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2021-02-11T15:30");
  await page.locator("#entryPrice").fill("5000");
  await page.locator("#wy-0-czas").fill("2021-02-11T16:00");
  await page.locator("#wy-0-cena").fill("4990");
  await page.locator("#status").selectOption("missed");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  await page.goto("/calendar?miesiac=2021-02&dzien=2021-02-11");
  await page.getByLabel("Dzień bez transakcji").check();
  await page.locator("#noTradeReason").selectOption({ label: "Brak setupu" });
  await page.getByRole("button", { name: "Zapisz notatkę" }).click();
  await expect(page.getByText("Zapisano notatkę dnia.")).toBeVisible();

  await page.goto("/calendar?miesiac=2021-02");
  // Kafel gridu: dalej "bez transakcji" (pauza), z dyskretnym znacznikiem
  // pominietego setupu - nie zamienia sie w kafel dnia handlowego.
  // Filtr po href, nie samej roli - gdyby w miesiacu byla wiecej niz jedna
  // pauza, `getByRole("link", { name: /bez transakcji/ })` trafilby w kilka
  // naraz i test padlby na "strict mode violation" zamiast na sedno sprawy.
  const kafelDnia = page.locator('a[href="/calendar?dzien=2021-02-11"]');
  await expect(kafelDnia).toContainText("bez transakcji");
  await expect(kafelDnia).toHaveAttribute("title", /1 trade nie wzięty/);
  await expect(kafelDnia.locator(".sr-only", { hasText: "1 trade nie wzięty" })).toHaveCount(1);

  // Sprzatanie.
  await page.goto("/calendar?miesiac=2021-02&dzien=2021-02-11");
  await page.getByLabel("Dzień bez transakcji").uncheck();
  await page.getByRole("button", { name: "Zapisz notatkę" }).click();
  await expect(page.getByText("Zapisano notatkę dnia.")).toBeVisible();
});

test("galeria ma więcej kafli niż widok tylko dziennika żywego (backtesty się liczą)", async ({
  page,
}) => {
  // Wlasny trade w sesji backtestu, zeby test nie zalezal od tego, czy
  // reszta zestawu zostawila jakis w bazie.
  const nazwa = `Sesja galerii ${Date.now()}`;
  await page.goto("/backtest");
  await page.getByRole("button", { name: "Nowa sesja backtestu" }).click();
  await page.locator("#name").fill(nazwa);
  await page.locator("#dataFrom").fill("2021-03-01");
  await page.locator("#dataTo").fill("2021-03-05");
  await page.getByRole("button", { name: "Utwórz sesję" }).click();
  await expect(page).toHaveURL(/\/backtest\/\d+$/);

  await page.getByRole("link", { name: "Dodaj trade do sesji" }).click();
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2021-03-02T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2021-03-02T15:55");
  await page.locator("#wy-0-cena").fill("20010");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  // "zezrzutem=wszystko" w obu adresach, zeby porownanie mierzylo TYLKO
  // roznice zrodla (ADR-019 inaczej odfiltrowalby ten trade, bo jest bez
  // zrzutu) - /galeria bez parametrow domyslnie i tak startuje z "wszystko"
  // zrodel, ale test ustawia to jawnie, zeby nie zalezec od domyslnej wartosci.
  //
  // Filtr na dokladnie ten dzien (od/do): galeria stronicuje po 60 kafli
  // (ROZMIAR_STRONY), a baza po dluzszym przebiegu zestawu ma ich wiecej -
  // bez zawezenia porownanie liczyloby dwie strony ucięte do tego samego
  // limitu i wygladaloby na rowne, mimo realnej roznicy w danych.
  await page.goto("/galeria?zezrzutem=wszystko&zrodlo=wszystko&od=2021-03-02&do=2021-03-02");
  const ileWszystko = await page.locator("main ul > li").count();

  await page.goto("/galeria?zezrzutem=wszystko&zrodlo=live&od=2021-03-02&do=2021-03-02");
  const ileLive = await page.locator("main ul > li").count();

  expect(ileWszystko).toBeGreaterThan(ileLive);
});

test("przełączenie trade'a closed → missed → closed w edycji zachowuje kwotę wyniku", async ({
  page,
}) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2021-04-06T15:30");
  await page.locator("#entryPrice").fill("5100");
  await page.locator("#wy-0-czas").fill("2021-04-06T16:00");
  await page.locator("#wy-0-cena").fill("5110");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  const adresKarty = page.url();
  const wynikPrzed = await page.getByText(/\+500,00\s?USD/).first().innerText();

  await page.goto(`${adresKarty}/edit`);
  await page.locator("#status").selectOption("missed");
  await page.getByRole("button", { name: /zapisz zmiany/i }).click();
  await page.waitForURL(adresKarty);
  // "missed" tez ma maWynik - kwota musi zostac dokladnie ta sama.
  await expect(page.getByText(wynikPrzed).first()).toBeVisible();

  await page.goto(`${adresKarty}/edit`);
  await page.locator("#status").selectOption("closed");
  await page.getByRole("button", { name: /zapisz zmiany/i }).click();
  await page.waitForURL(adresKarty);
  await expect(page.getByText(wynikPrzed).first()).toBeVisible();
});

/*
 * ETAP 4a - czesciowe realizacje zysku. Piatka testow nizej pokrywa repeater
 * wyjsc od strony uzytkownika: dwa kawalki z podgladem i kartą, pozycje
 * czesciowo zamkniete (bez wplywu na KPI), regule "puste = cala pozycja",
 * walidacje sumy i cofniecie skalowania w edycji. Liczby sprawdzone recznym
 * przebiegiem na tej samej bazie lokalnej przed wpisaniem do testu.
 */

test("trade z dwoma wyjściami liczy sumę, średnią cenę i wpływ skalowania", async ({ page }) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-06-01T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#stopLoss").fill("19990");

  // Pierwszy kawalek wychodzi WCZESNIEJ i DALEJ od wejscia (20050), drugi
  // POZNIEJ i BLIZEJ (20010) - wiekszy kawalek pierwszy daje DODATNI wplyw
  // skalowania (ten sam uklad co test jednostkowy calc.test.ts "scalingR
  // dodatnie"), wiec liczby da sie zweryfikowac co do centa niezaleznie.
  await page.locator("#wy-0-czas").fill("2026-06-01T15:40");
  await page.locator("#wy-0-cena").fill("20050");
  await page.locator("#wy-0-kontrakty").fill("1");

  await page.getByRole("button", { name: "Dodaj wyjście" }).click();
  await page.locator("#wy-1-czas").fill("2026-06-01T15:55");
  await page.locator("#wy-1-cena").fill("20010");
  await page.locator("#wy-1-kontrakty").fill("1");

  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });
  // pnl = 200 tickow*1*5,00 + 40 tickow*1*5,00 = 1000,00 + 200,00 = 1200,00 USD.
  await expect(podglad.getByText(/\+1\s?200,00\s?USD/)).toBeVisible();
  // Ryzyko: 40 tickow * 2 kontrakty * 5,00 = 400,00 USD -> R = 1200/400 = +3.00R.
  await expect(podglad.getByText("+3.00R")).toBeVisible();
  // Srednia cena wyjscia: (20050+20010)/2 = 20030.
  await expect(podglad.getByText(/20\s?030,00/)).toBeVisible();
  // Zrealizowana pozycja: 2 z 2.
  await expect(podglad.getByText("2 / 2", { exact: true })).toBeVisible();
  // Wplyw skalowania: wiekszy kawalek wyszedl pierwszy -> dodatni, +2.00R.
  await expect(podglad.getByText("+2.00R")).toBeVisible();

  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  await expect(page.getByText(/\+1\s?200,00\s?USD/).first()).toBeVisible();
  await expect(page.getByText("+3.00R").first()).toBeVisible();

  const panelWyjsc = page
    .locator("section", { hasText: "Wyjścia" })
    .filter({ has: page.locator("table") });
  await expect(panelWyjsc).toContainText("2 wyjść z pozycji, po kolei.");
  await expect(panelWyjsc.locator("tbody tr")).toHaveCount(2);

  // Kazdy kawalek ma swoje R - pierwszy (wiekszy ruch, 1 kontr.) +5.00R,
  // drugi (mniejszy ruch, 1 kontr.) +1.00R - ryzyko liczone proporcjonalnie
  // do wielkosci KAWALKA, nie calej pozycji (queries/trades.ts, exitsForTrade).
  await expect(panelWyjsc.getByText(/20\s?050,00/)).toBeVisible();
  await expect(panelWyjsc.getByText("+5.00R")).toBeVisible();
  await expect(panelWyjsc.getByText(/20\s?010,00/)).toBeVisible();
  await expect(panelWyjsc.getByText("+1.00R")).toBeVisible();

  // Suma kontraktow w stopce tabeli zgadza sie z wielkoscia pozycji.
  const stopka = panelWyjsc.locator("tfoot tr");
  await expect(stopka).toContainText("Suma");
  await expect(stopka).toContainText("2");
});

test("pozycja częściowo zamknięta zapisuje status „otwarty”, pokazuje wynik z etykietą „częściowo” i nie rusza KPI pulpitu", async ({
  page,
}) => {
  // Dzien nienuzywany przez zaden inny test w tym pliku (patrz konwencja
  // losowyDzien - tu wystarczy dzien staly, bo test nie liczy DOKLADNEJ
  // liczby trade'ow danego dnia, tylko deltę KPI globalnego pulpitu).
  const dzien = "2021-06-15";

  await page.goto("/?zakres=wszystko");
  const przed = await wynik(page);

  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("3");
  await page.locator("#entryTime").fill(`${dzien}T15:35`);
  await page.locator("#entryPrice").fill("5000");
  // Status "zamkniety" wpisany celowo - serwer i tak przemianuje go na
  // "otwarty", bo wyjscia nie sumuja sie do calej pozycji (actions/trades.ts).
  await page.locator("#status").selectOption("closed");
  await page.locator("#wy-0-czas").fill(`${dzien}T16:00`);
  await page.locator("#wy-0-cena").fill("5010");
  // Tylko 2 z 3 kontraktow - jawnie, bo puste pole przy jednym wierszu
  // znaczyloby "cala pozycja", a tu chodzi wlasnie o CZESC pozycji.
  await page.locator("#wy-0-kontrakty").fill("2");

  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });
  // 40 tickow * 2 kontrakty * 12,50 USD (ES) = 1000,00 USD zrealizowane.
  await expect(podglad.getByText(/\+1\s?000,00\s?USD/)).toBeVisible();
  await expect(podglad.getByText("2 / 3", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  // Karta: wynik zrealizowany widoczny, z etykieta "częściowo" (nie "hipot." -
  // to zarezerwowane dla statusu "missed").
  await expect(page.getByText(/\+1\s?000,00\s?USD/).first()).toBeVisible();
  await expect(page.getByText("częściowo").first()).toBeVisible();

  // Status faktycznie wrocil do "otwarty" - dowod wprost z formularza edycji,
  // nie z domyslu na podstawie samego wygladu karty.
  const adres = page.url();
  await page.goto(`${adres}/edit`);
  await expect(page.locator("#status")).toHaveValue("open");

  // Pulpit: dokladnie ta sama kwota co przed zapisem. Pozycja czesciowo
  // zamknieta ma status "open", wiec closedOnly (queries/trades.ts) ja
  // pomija - stan wyjsciowy zmierzony PRZED zapisem, nie zalozony.
  await page.goto("/?zakres=wszystko");
  const po = await wynik(page);
  expect(Number((po - przed).toFixed(2))).toBe(0);
});

test("puste kontrakty przy jednym wyjściu liczą się jak cała pozycja wpisana wprost", async ({
  page,
}) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2021-06-16T15:35");
  await page.locator("#entryPrice").fill("5000");
  await page.locator("#wy-0-czas").fill("2021-06-16T16:00");
  await page.locator("#wy-0-cena").fill("5020");

  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });
  // Kontrakty PUSTE - podpowiedz pola musi mowic wprost, ile to bedzie
  // (ADR: regula nie dziala po cichu).
  await expect(page.locator("#wy-0-kontrakty")).toHaveAttribute("placeholder", "2 (cała pozycja)");
  // 80 tickow * 2 kontrakty * 12,50 USD = 2000,00 USD.
  await expect(podglad.getByText(/\+2\s?000,00\s?USD/)).toBeVisible();
  await expect(podglad.getByText("2 / 2", { exact: true })).toBeVisible();
  const pustyWynik = await podglad.getByText(/\+2\s?000,00\s?USD/).innerText();

  // To samo, jawnie wpisane - wynik musi byc identyczny co do centa.
  await page.locator("#wy-0-kontrakty").fill("2");
  await expect(podglad.getByText(pustyWynik)).toBeVisible();

  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByText(/\+2\s?000,00\s?USD/).first()).toBeVisible();
});

test("suma kontraktów w dwóch wyjściach przekraczająca pozycję jest odrzucana z komunikatem po polsku", async ({
  page,
}) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("3");
  await page.locator("#entryTime").fill("2021-06-17T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2021-06-17T16:00");
  await page.locator("#wy-0-cena").fill("20010");
  await page.locator("#wy-0-kontrakty").fill("2");

  await page.getByRole("button", { name: "Dodaj wyjście" }).click();
  await page.locator("#wy-1-czas").fill("2021-06-17T16:10");
  await page.locator("#wy-1-cena").fill("20020");
  // 2 + 2 = 4 kontrakty na pozycji o wielkosci 3 - suma przekracza pozycje.
  await page.locator("#wy-1-kontrakty").fill("2");

  await page.getByRole("button", { name: "Zapisz trade" }).click();

  await expect(
    page.getByText("Suma kontraktów w wyjściach (4) przekracza wielkość pozycji (3)."),
  ).toBeVisible();
  // Zadnego zapisu - formularz zostaje na /trades/new, nie na karcie trade'a.
  await expect(page).toHaveURL(/\/trades\/new$/);
});

test("usunięcie drugiego wyjścia w edycji wraca do wyniku sprzed skalowania, „Wpływ skalowania” znika", async ({
  page,
}) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-06-02T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#stopLoss").fill("19990");
  await page.locator("#wy-0-czas").fill("2026-06-02T15:45");
  await page.locator("#wy-0-cena").fill("20010");
  // Kontrakty puste = cala pozycja (2) - zwykly, jednowyjsciowy trade.
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  const adres = page.url();
  // 40 tickow * 2 kontrakty * 5,00 USD = 400,00 USD, ryzyko 400 -> +1.00R.
  await expect(page.getByText(/\+400,00\s?USD/).first()).toBeVisible();
  await expect(page.getByText("+1.00R").first()).toBeVisible();

  // Edycja: rozbij pozycje na dwa kawalki (dopisz drugie wyjscie).
  await page.goto(`${adres}/edit`);
  await page.locator("#wy-0-kontrakty").fill("1");
  await page.getByRole("button", { name: "Dodaj wyjście" }).click();
  await page.locator("#wy-1-czas").fill("2026-06-02T15:55");
  await page.locator("#wy-1-cena").fill("20050");
  await page.locator("#wy-1-kontrakty").fill("1");

  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });
  await expect(podglad.getByText(/\+1\s?200,00\s?USD/)).toBeVisible();
  await expect(podglad.getByText("−2.00R")).toBeVisible();

  // Cofnij: usun drugi wiersz i wyczysc kontrakty pierwszego, zeby znow
  // znaczyly "cala pozycja" - tak jak przed rozbiciem.
  await page.getByRole("button", { name: "Usuń wyjście 2" }).click();
  await page.locator("#wy-0-kontrakty").fill("");

  // Podglad wraca DOKLADNIE do stanu sprzed skalowania.
  await expect(podglad.getByText(/\+400,00\s?USD/)).toBeVisible();
  await expect(podglad.getByText("+1.00R")).toBeVisible();
  await expect(podglad.getByText(/Wpływ skalowania/)).toHaveCount(0);

  await page.getByRole("button", { name: /zapisz zmiany/i }).click();
  await page.waitForURL(adres);

  // Karta: z powrotem jeden wpis w wynikach, dawna kwota, bez wplywu skalowania.
  await expect(page.getByText(/\+400,00\s?USD/).first()).toBeVisible();
  await expect(page.getByText("+1.00R").first()).toBeVisible();
  const panelWyjsc = page
    .locator("section", { hasText: "Wyjścia" })
    .filter({ has: page.locator("table") });
  await expect(panelWyjsc).toContainText("Jedno wyjście z pozycji.");
  await expect(panelWyjsc.locator("tbody tr")).toHaveCount(1);
});
