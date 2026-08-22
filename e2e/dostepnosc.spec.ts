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
