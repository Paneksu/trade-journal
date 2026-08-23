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

test("nowy trade liczy wynik zgodnie z parametrami kontraktu", async ({ page }) => {
  await page.goto("/trades/new");

  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-05-12T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#exitTime").fill("2026-05-12T16:17");
  await page.locator("#exitPrice").fill("20025.50");
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
  await page.locator("#exitTime").fill("2026-05-13T16:30");
  await page.locator("#exitPrice").fill("5010");
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
  await page.locator("#exitTime").fill("2026-04-01T15:55");
  await page.locator("#exitPrice").fill("20010");
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
  await page.locator("#exitTime").fill("2026-04-20T15:45");
  await page.locator("#exitPrice").fill("20005");
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

test("wpisana kwota z brokera wylicza cenę wyjścia i zgadza się z podglądem", async ({ page }) => {
  await page.goto("/trades/new");

  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-05-12T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#exitTime").fill("2026-05-12T16:17");

  const exit = page.locator("#exitPrice");
  const netto = page.locator("#netTarget");
  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });

  // Trafienie co do centa: 25 tickow po 10 USD na 2 kontraktach = 250.
  await netto.fill("250");
  await expect(exit).toHaveValue("20006.25");
  await expect(podglad.getByText(/\+250,00\s?USD/)).toBeVisible();
  await expect(page.locator("#netTarget-hint")).toHaveCount(0);

  // Kwota miedzy tickami: zaokraglenie w gore i komunikat o roznicy.
  await netto.fill("255");
  await expect(exit).toHaveValue("20006.5");
  await expect(page.locator("#netTarget-hint")).toContainText("więcej");
  await expect(podglad.getByText(/\+260,00\s?USD/)).toBeVisible();

  // Zmiana liczby kontraktow przelicza cene bez ruszania pola kwoty.
  await page.locator("#contracts").fill("1");
  await expect(netto).toHaveValue("255");
  await expect(exit).toHaveValue("20012.75");
  await expect(podglad.getByText(/\+255,00\s?USD/)).toBeVisible();

  // Short liczy w druga strone.
  await page.locator("#contracts").fill("2");
  await page.getByText("Short", { exact: true }).click();
  await netto.fill("250");
  await expect(exit).toHaveValue("19993.75");
  await expect(podglad.getByText(/\+250,00\s?USD/)).toBeVisible();
  await page.getByText("Long", { exact: true }).click();

  // Strata: cena po przeciwnej stronie wejscia.
  await netto.fill("-250");
  await expect(exit).toHaveValue("19993.75");
  await expect(podglad.getByText(/−250,00\s?USD/)).toBeVisible();

  // Nieczytelna kwota nazywa powod po imieniu, nie odsyla do innych pol.
  await netto.fill("−");
  await expect(page.locator("#netTarget-hint")).toContainText("Nie umiem odczytać");

  // Brak ceny wejscia: komunikat zamiast ciszy, a pole ceny wyjscia PUSTE.
  // Cichy powrot do poprzedniej ceny zapisalby liczbe wbrew komunikatowi.
  await netto.fill("250");
  await page.locator("#entryPrice").fill("");
  await expect(page.locator("#netTarget-hint")).toContainText("Podaj cenę wejścia");
  await expect(exit).toHaveValue("");
  await page.locator("#entryPrice").fill("20000");
  await expect(exit).toHaveValue("20006.25");

  // Reczna edycja ceny gasi wyliczenie.
  await exit.fill("20010");
  await expect(netto).toHaveValue("");
  await expect(exit).toHaveValue("20010");

  // Skasowanie kwoty przywraca ostatnia reczna cene - kwota jest nakladka,
  // nie kasuje tego, co uzytkownik wpisal sam.
  await netto.fill("250");
  await expect(exit).toHaveValue("20006.25");
  await netto.fill("");
  await expect(exit).toHaveValue("20010");

  // Powrot do kwoty i zapis - karta trade'a musi pokazac te sama liczbe.
  await netto.fill("250");
  await expect(exit).toHaveValue("20006.25");
  await page.getByRole("button", { name: "Zapisz trade" }).click();

  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByText(/\+250,00\s?USD/).first()).toBeVisible();
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
  await page.locator("#exitTime").fill("2020-04-06T16:00");
  await page.locator("#exitPrice").fill("4002");
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
  await page.locator("#exitTime").fill("2020-06-03T15:55");
  await page.locator("#exitPrice").fill("20010");
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
    await page.locator("#exitTime").fill(`${dzien}T09:45`);
    await page.locator("#exitPrice").fill(w.exit);
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
