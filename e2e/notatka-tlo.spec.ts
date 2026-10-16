import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";

/*
 * Review potwierdzające fazy 5, B1 (16.10.2026): niezapisany tekst w formularzu notatki dnia nie może zniknąć, gdy
 * notatka zmieni się w tle. Przed poprawką pola miały `key={updatedAt}`: zrzut dnia albo zapis drugiej części rytuału
 * podbijał `updatedAt`, pola się przemontowywały i wpisany tekst przepadał (albo zapis kończył się konfliktem).
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test.describe.configure({ mode: "serial" });

test.describe("Notatka dnia: tekst w polu przeżywa zmiany w tle", () => {
  let sql: ReturnType<typeof postgres>;
  const DZIEN = "2015-05-05";

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    await sql`delete from day_notes where day = ${DZIEN} and backtest_session_id is null`;
  });
  test.afterAll(async () => {
    await sql`delete from day_notes where day = ${DZIEN} and backtest_session_id is null`;
    await sql.end();
  });

  test("kalendarz: wpisz tekst, wklej zrzut dnia, tekst dalej jest w polu i zapisuje się bez konfliktu", async ({ page }) => {
    await page.goto(`/calendar?miesiac=2015-05&dzien=${DZIEN}`);
    const tekst = `Po sesji w toku ${RUN}`;
    await page.locator("#postSession").fill(tekst);
    await expect(page.locator('[data-wklejanie="gotowe"]')).toBeVisible();
    await page.evaluate((png) => {
      const bajty = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const dane = new DataTransfer();
      dane.items.add(new File([bajty], "wykres.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dane, bubbles: true }));
    }, PNG);
    await expect(page.getByAltText(new RegExp(`Zrzut \\d+ z \\d+ — dzień ${DZIEN}`))).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#postSession")).toHaveValue(tekst);

    await page.getByRole("button", { name: "Zapisz notatkę" }).click();
    await expect(page.getByText("Zapisano notatkę dnia.")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-konflikt-notatki]")).toHaveCount(0);
    const [n] = await sql`select post_session from day_notes where day = ${DZIEN} and account_id is null and backtest_session_id is null`;
    expect(n.post_session).toBe(tekst);
  });

  test("Dziś: wpisz „Po sesji”, zapisz „Przed sesją”; tekst „Po sesji” zostaje w polu i zapisuje się", async ({ page }) => {
    await page.goto("/");
    const po = page.locator("#rytual-po");
    test.skip((await po.count()) === 0, "Dzień handlowy ma otwarty trade z werdyktem: „Po sesji” jest zablokowane.");
    const [dzis] = await sql<{ d: string }[]>`select to_char((now() at time zone 'America/New_York' + interval '7 hours')::date, 'YYYY-MM-DD') as d`;
    const [przed] = await sql`select id, pre_session, post_session from day_notes where day = ${dzis.d} and account_id is null and backtest_session_id is null`;
    try {
      const tekstPo = `Wniosek w toku ${RUN}`;
      await po.fill(tekstPo);
      await page.locator("#rytual-plan").fill(`Plan ${RUN}`);
      const formPrzed = page.locator("form").filter({ has: page.locator("#rytual-plan") });
      await formPrzed.getByRole("button", { name: "Zapisz rytuał" }).click();
      await expect(formPrzed.getByText("Zapisano.")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(po).toHaveValue(tekstPo);

      const formPo = page.locator("form").filter({ has: po });
      await formPo.getByRole("button", { name: "Zapisz po sesji" }).click();
      await expect(formPo.getByText("Zapisano.")).toBeVisible();
      await expect(page.locator("[data-konflikt-notatki]")).toHaveCount(0);
    } finally {
      // Przywracamy notatkę dnia sprzed testu (dzień handlowy liczy serwer: po 17:00 NY to następny dzień).
      if (przed) await sql`update day_notes set pre_session = ${przed.pre_session}, post_session = ${przed.post_session} where id = ${przed.id}`;
      else await sql`delete from day_notes where account_id is null and backtest_session_id is null and post_session like ${`%${RUN}%`}`;
    }
  });
});
