import { expect, test } from "@playwright/test";

/*
 * CSP (audyt bezpieczeństwa fazy 5, pkt 6): każda strona ma nagłówek z nonce w script-src, bez 'unsafe-inline'
 * dla skryptów, z frame-ancestors 'none'; ekrany ładują się i działają bez naruszeń polityki w konsoli.
 */
test("CSP z nonce na stronach i bez naruszeń w konsoli", async ({ page }) => {
  const naruszenia: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) naruszenia.push(m.text().slice(0, 200));
  });
  for (const adres of ["/", "/trades", "/calendar", "/mozg", "/settings"]) {
    const odp = await page.goto(adres);
    const csp = odp?.headers()["content-security-policy"] ?? "";
    expect(csp, adres).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp, adres).toContain("frame-ancestors 'none'");
    expect(csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "", adres).not.toContain("'unsafe-inline'");
    await page.waitForLoadState("networkidle");
  }
  // Hydratacja działa: paleta otwiera się skrótem (komponent kliencki).
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(naruszenia).toEqual([]);
});
