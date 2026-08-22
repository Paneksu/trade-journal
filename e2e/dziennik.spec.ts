import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

/*
 * Scenariusze przechodzace przez cala aplikacje: od formularza, przez zapis,
 * po liczby na pulpicie. Sprawdzamy nie to, ze "cos sie wyswietlilo",
 * tylko czy wynik zgadza sie co do centa.
 */

/** Wyciaga liczbe z tekstu w formacie polskim: "+1 011,92 USD" -> 1011.92 */
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

async function wynikNetto(page: Page): Promise<number> {
  const kafelek = page.locator("div.panel").filter({ hasText: "Wynik netto" }).first();
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
  await expect(podglad.getByText(/\+1\s?011,92\s?USD/)).toBeVisible();
  await expect(podglad.getByText("+2.53R")).toBeVisible();

  await page.getByRole("button", { name: "Zapisz trade" }).click();

  // Karta trade'a musi pokazac dokladnie to samo, co podglad.
  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByRole("heading").first()).toContainText("NQ");
  await expect(page.getByText(/\+1\s?011,92\s?USD/).first()).toBeVisible();
  await expect(page.getByText("+2.53R").first()).toBeVisible();
  await expect(page.getByText(/^400,00\s?USD$/).first()).toBeVisible();
});

test("zapisany trade zmienia wynik netto na pulpicie o swoją kwotę", async ({ page }) => {
  await page.goto("/?zakres=wszystko");
  const przed = await wynikNetto(page);

  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2026-05-13T16:00");
  await page.locator("#entryPrice").fill("5000");
  await page.locator("#exitTime").fill("2026-05-13T16:30");
  await page.locator("#exitPrice").fill("5010");
  await page.locator("#stopLoss").fill("4995");
  await page.locator("#commission").fill("0");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  await page.goto("/?zakres=wszystko");
  const po = await wynikNetto(page);

  // 40 tickow ES po 12,50 USD = 500 USD, prowizja zero.
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

  // Obrazek generowany w locie - bez plikow pomocniczych w repozytorium.
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#1d3a33" },
  })
    .png()
    .toBuffer();
  await page.locator("#shot_before").setInputFiles({
    name: "wykres.png",
    mimeType: "image/png",
    buffer: png,
  });

  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  const obraz = page.locator('img[src^="/api/screenshots/"]').first();
  await expect(obraz).toBeVisible();

  const adres = await obraz.getAttribute("src");
  expect(adres).toBeTruthy();

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

test("wpisana kwota netto wylicza cenę wyjścia i zgadza się z podglądem", async ({ page }) => {
  await page.goto("/trades/new");

  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-05-12T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#exitTime").fill("2026-05-12T16:17");
  await page.locator("#commission").fill("5");

  const exit = page.locator("#exitPrice");
  const netto = page.locator("#netTarget");
  const podglad = page.locator("section", { hasText: "Podgląd wyniku" });

  // Trafienie co do centa: 25 tickow po 10 USD = 250 brutto, minus 5 prowizji.
  await netto.fill("245");
  await expect(exit).toHaveValue("20006.25");
  await expect(podglad.getByText(/\+245,00\s?USD/)).toBeVisible();
  await expect(page.locator("#netTarget-hint")).toHaveCount(0);

  // Kwota miedzy tickami: zaokraglenie w gore i komunikat o roznicy.
  await netto.fill("250");
  await expect(exit).toHaveValue("20006.5");
  await expect(page.locator("#netTarget-hint")).toContainText("więcej");
  await expect(podglad.getByText(/\+255,00\s?USD/)).toBeVisible();

  // Zmiana liczby kontraktow przelicza cene bez ruszania pola kwoty.
  await page.locator("#contracts").fill("1");
  await expect(netto).toHaveValue("250");
  await expect(exit).toHaveValue("20012.75");
  await expect(podglad.getByText(/\+250,00\s?USD/)).toBeVisible();

  // Short liczy w druga strone.
  await page.locator("#contracts").fill("2");
  await page.getByText("Short", { exact: true }).click();
  await netto.fill("245");
  await expect(exit).toHaveValue("19993.75");
  await expect(podglad.getByText(/\+245,00\s?USD/)).toBeVisible();
  await page.getByText("Long", { exact: true }).click();

  // Strata: cena po przeciwnej stronie wejscia.
  await netto.fill("-245");
  await expect(exit).toHaveValue("19994");
  await expect(podglad.getByText(/−245,00\s?USD/)).toBeVisible();

  // Nieczytelna kwota nazywa powod po imieniu, nie odsyla do innych pol.
  await netto.fill("−");
  await expect(page.locator("#netTarget-hint")).toContainText("Nie umiem odczytać");

  // Brak ceny wejscia: komunikat zamiast ciszy, a pole ceny wyjscia PUSTE.
  // Cichy powrot do poprzedniej ceny zapisalby liczbe wbrew komunikatowi.
  await netto.fill("245");
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
  await netto.fill("245");
  await expect(exit).toHaveValue("20006.25");
  await netto.fill("");
  await expect(exit).toHaveValue("20010");

  // Powrot do kwoty i zapis - karta trade'a musi pokazac te sama liczbe.
  await netto.fill("245");
  await expect(exit).toHaveValue("20006.25");
  await page.getByRole("button", { name: "Zapisz trade" }).click();

  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByText(/\+245,00\s?USD/).first()).toBeVisible();
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

  const zrzut = page.getByAltText("Zrzut z dnia 2020-03-03");

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
