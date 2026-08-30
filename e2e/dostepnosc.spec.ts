import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/*
 * Audyt dostepnosci na kazdym ekranie. Sprawdzamy WCAG 2.0/2.1/2.2 na poziomie
 * A i AA - te same reguly, ktore sprawdza audytor przed publikacja.
 * Test jest czescia zestawu, wiec regresja dostepnosci lamie build tak samo
 * jak regresja obliczen.
 */

const EKRANY = [
  { nazwa: "pulpit", adres: "/" },
  { nazwa: "trade'y", adres: "/trades" },
  { nazwa: "statystyki", adres: "/stats" },
  { nazwa: "kalendarz", adres: "/calendar" },
  { nazwa: "backtesting", adres: "/backtest" },
  { nazwa: "strategie", adres: "/strategies" },
  { nazwa: "nowy trade", adres: "/trades/new" },
  /* Galeria i formularz z rozwinietymi chipami interwalow: 13 checkboxow na
     kazda konfluencje to duzo kontrolek i kazda musi miec etykiete (ADR-017). */
  { nazwa: "galeria", adres: "/galeria" },
  { nazwa: "ustawienia", adres: "/settings" },
  { nazwa: "pola własne", adres: "/settings/fields" },
  { nazwa: "dzień w kalendarzu", adres: "/calendar?miesiac=2020-03&dzien=2020-03-03" },
];

for (const ekran of EKRANY) {
  test(`dostępność: ${ekran.nazwa}`, async ({ page }) => {
    await page.goto(ekran.adres);
    await page.waitForLoadState("networkidle");

    const wynik = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const opis = wynik.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el.`,
    );
    expect(opis, opis.join("\n")).toEqual([]);
  });
}

test("dostępność: sesja backtestu", async ({ page }) => {
  // Sesja zakladana w locie - adres sesji nie jest staly miedzy bazami.
  await page.goto("/backtest");
  await page.getByRole("button", { name: "Nowa sesja backtestu" }).click();
  await page.locator("#name").fill(`Sesja do audytu ${Date.now()}`);
  await page.locator("#dataFrom").fill("2020-07-01");
  await page.locator("#dataTo").fill("2020-07-03");
  await page.getByRole("button", { name: "Utwórz sesję" }).click();
  await expect(page).toHaveURL(/\/backtest\/\d+$/);

  await page.locator("#ntd-day").fill("2020-07-02");
  await page.getByRole("button", { name: "Zapisz dzień bez sygnału" }).click();
  await expect(page.getByText("Zapisano dzień bez sygnału.")).toBeVisible();
  await page.getByRole("link", { name: "2 lipca 2020" }).click();
  await page.waitForLoadState("networkidle");

  const wynik = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const opis = wynik.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el.`,
  );
  expect(opis, opis.join("\n")).toEqual([]);
});

/*
 * Status "missed" ("nie wzięty") dorzuca nowe elementy wizualne, ktorych
 * EKRANY powyzej nie widzą, bo lecą po pustym stanie: pasek koloru "accent"
 * na kaflu galerii (etykieta "NIE WZIĘTY") i sekcja "Pominięte" na /stats.
 * Oba testuje sie tylko wtedy, gdy dany trade faktycznie istnieje na
 * ekranie - inaczej audyt przechodziłby bez sprawdzenia niczego nowego.
 */
test("dostępność: /stats z sekcją Pominięte", async ({ page }) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2021-09-01T15:30");
  await page.locator("#entryPrice").fill("5000");
  await page.locator("#wy-0-czas").fill("2021-09-01T16:00");
  await page.locator("#wy-0-cena").fill("5010");
  await page.locator("#status").selectOption("missed");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  await page.goto("/stats?od=2021-09-01&do=2021-09-01");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Pominięte" })).toBeVisible();

  const wynik = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const opis = wynik.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el.`,
  );
  expect(opis, opis.join("\n")).toEqual([]);
});

test("dostępność: /galeria z kaflem trade'a nie wziętego", async ({ page }) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "ES — E-mini S&P 500" });
  await page.locator("#contracts").fill("1");
  await page.locator("#entryTime").fill("2021-09-02T15:30");
  await page.locator("#entryPrice").fill("5000");
  await page.locator("#wy-0-czas").fill("2021-09-02T16:00");
  await page.locator("#wy-0-cena").fill("5010");
  await page.locator("#status").selectOption("missed");
  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  // Kafel bez zrzutu tez ma sie pojawic - "zezrzutem=wszystko" zdejmuje
  // domyslny filtr ADR-019, inaczej ten trade nie trafiłby na ekran wcale.
  // Filtr na dokladnie ten dzien (od/do): galeria stronicuje po 60 kafli, a
  // baza ma ich juz wiecej po dluzszym przebiegu zestawu - bez zawezenia
  // trade z 2021 roku spadlby poza pierwsza strone (sortowanie od najnowszych).
  await page.goto("/galeria?zezrzutem=wszystko&od=2021-09-02&do=2021-09-02");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("NIE WZIĘTY").first()).toBeVisible();

  const wynik = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const opis = wynik.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el.`,
  );
  expect(opis, opis.join("\n")).toEqual([]);
});

/*
 * ETAP 4a - repeater wyjsc. Elementy nizej pokrywa petla EKRANY tylko czesciowo
 * (pusty formularz ma jeden zwiniety wiersz) - trzeba osobno rozwinac drugi
 * wiersz i sekcje "kwota i notatka", inaczej audyt nigdy nie zobaczy checkboxow
 * i pol, ktore realnie sa w DOM dopiero po interakcji uzytkownika.
 */
test("dostępność: /trades/new z rozwiniętym drugim wyjściem i sekcją kwoty", async ({ page }) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-06-05T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#wy-0-czas").fill("2026-06-05T15:45");
  await page.locator("#wy-0-cena").fill("20010");
  await page.locator("#wy-0-kontrakty").fill("1");

  // Drugi wiersz wyjscia.
  await page.getByRole("button", { name: "Dodaj wyjście" }).click();
  await page.locator("#wy-1-czas").fill("2026-06-05T15:55");
  await page.locator("#wy-1-cena").fill("20030");
  await page.locator("#wy-1-kontrakty").fill("1");

  // Rozwiniete sekcje "kwota i notatka" na OBU wierszach naraz.
  await page.getByRole("button", { name: "kwota i notatka" }).first().click();
  await page.getByRole("button", { name: "kwota i notatka" }).click();
  await expect(page.locator("#wy-0-kwota")).toBeVisible();
  await expect(page.locator("#wy-1-kwota")).toBeVisible();

  await page.waitForLoadState("networkidle");

  const wynik = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const opis = wynik.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el.`,
  );
  expect(opis, opis.join("\n")).toEqual([]);
});

test("dostępność: widok trade'a z tabelą wyjść (dwa kawałki)", async ({ page }) => {
  await page.goto("/trades/new");
  await page.locator("#instrumentId").selectOption({ label: "NQ — E-mini Nasdaq 100" });
  await page.locator("#contracts").fill("2");
  await page.locator("#entryTime").fill("2026-06-06T15:35");
  await page.locator("#entryPrice").fill("20000");
  await page.locator("#stopLoss").fill("19990");
  await page.locator("#wy-0-czas").fill("2026-06-06T15:45");
  await page.locator("#wy-0-cena").fill("20010");
  await page.locator("#wy-0-kontrakty").fill("1");

  await page.getByRole("button", { name: "Dodaj wyjście" }).click();
  await page.locator("#wy-1-czas").fill("2026-06-06T15:55");
  await page.locator("#wy-1-cena").fill("20030");
  await page.locator("#wy-1-kontrakty").fill("1");

  await page.getByRole("button", { name: "Zapisz trade" }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  // Panel "Wyjścia" z tabela dwoch kawalkow i wierszem sumy w stopce -
  // dopiero teraz jest w DOM (pusty EKRANY.trade'y w petli wyzej go nie widzi).
  const panelWyjsc = page
    .locator("section", { hasText: "Wyjścia" })
    .filter({ has: page.locator("table") });
  await expect(panelWyjsc.locator("tbody tr")).toHaveCount(2);
  await expect(panelWyjsc.locator("tfoot tr")).toHaveCount(1);

  await page.waitForLoadState("networkidle");

  const wynik = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const opis = wynik.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el.`,
  );
  expect(opis, opis.join("\n")).toEqual([]);
});

test("dostępność: logowanie", async ({ browser }) => {
  const czysty = await browser.newContext({ storageState: undefined });
  const strona = await czysty.newPage();
  await strona.goto("/login");

  const wynik = await new AxeBuilder({ page: strona })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const opis = wynik.violations.map((v) => `${v.id} (${v.impact}): ${v.help}`);
  expect(opis, opis.join("\n")).toEqual([]);
  await czysty.close();
});
