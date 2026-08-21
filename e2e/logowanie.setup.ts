import { expect, test as setup } from "@playwright/test";

const SESJA = "e2e/.sesja.json";

/** Logujemy sie raz i zapisujemy ciasteczko dla pozostalych testow. */
setup("logowanie hasłem", async ({ page }) => {
  const haslo = process.env.E2E_PASSWORD ?? process.env.OWNER_PASSWORD;
  if (!haslo) throw new Error("Ustaw E2E_PASSWORD albo OWNER_PASSWORD, żeby testy mogły się zalogować.");

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Wpisz hasło/ })).toBeVisible();

  await page.getByLabel("Hasło").fill(haslo);
  await page.getByRole("button", { name: "Wejdź" }).click();

  await expect(page).toHaveURL("/");
  await page.context().storageState({ path: SESJA });
});
