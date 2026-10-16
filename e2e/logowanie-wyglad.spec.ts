import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/*
 * Ekran logowania i strona offline w nowym wyglądzie (Słowa użytkownika 16.10.2026: «ulepsz także wygląd na bardziej
 * stylowy pierwszego ekranu logowania»): dostępność (axe) i brak poziomego przewijania przy 1440 i 375, pełny znak
 * jako obraz z tego samego źródła (CSP img-src 'self'). Bez sesji: to widok po jej wygaśnięciu.
 */
const AXE_TAGI = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
test.use({ storageState: { cookies: [], origins: [] } });

for (const [szer, wys] of [
  [1440, 900],
  [375, 812],
] as const) {
  test(`logowanie i offline: axe i szerokość przy ${szer}`, async ({ page }) => {
    await page.setViewportSize({ width: szer, height: wys });
    for (const adres of ["/login", "/offline.html"]) {
      await page.goto(adres);
      await page.waitForLoadState("networkidle");
      const znak = page.locator('img[src="/icons/znak-pelny.svg"]');
      await expect(znak).toBeVisible();
      expect(await znak.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
      const wynik = await new AxeBuilder({ page }).withTags(AXE_TAGI).analyze();
      expect(wynik.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`), adres).toEqual([]);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw, adres).toBeLessThanOrEqual(cw);
    }
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: /Wpisz hasło/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zaloguj" })).toBeVisible();
  });
}
