import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";

/*
 * UI v2, etap 4: Kalendarz (siatka miesiąca, dziś w akcencie, panel dnia), Backtest (porównanie źródeł z deltą,
 * sesja, dzień sesji), Ustawienia (zakładki w nowym wyglądzie), PWA (manifest, ikony, service worker bez cache
 * danych, strona offline) i arkusz „+” (notatka dnia, zdjęcie z aparatu). Dane na LOKALNEJ bazie; po sobie sprzątamy.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const AXE_TAGI = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test.describe.configure({ mode: "serial" });

async function axe(page: Page, opis: string) {
  await page.waitForLoadState("networkidle");
  // Dolny pasek telefonu jest przyklejony (sticky) i w chwili pomiaru przykrywa dolny rząd siatki kalendarza;
  // axe liczy wtedy target-size z widocznego skrawka. Użytkownik przewija, więc do pomiaru pasek wraca do przepływu.
  await page.addStyleTag({ content: 'nav[aria-label="Dolna"] { position: static !important; }' });
  const wynik = await new AxeBuilder({ page }).withTags(AXE_TAGI).analyze();
  const bledy = wynik.violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el. [${v.nodes[0]?.target.join(" ")}]`);
  expect(bledy, `${opis}\n${bledy.join("\n")}`).toEqual([]);
}

async function bezPoziomegoScrolla(page: Page, opis: string) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `${opis}: scrollWidth ${sw} > ${cw}`).toBeLessThanOrEqual(cw);
}

test.describe("UI v2: Kalendarz, Backtest, Ustawienia, PWA", () => {
  let sql: ReturnType<typeof postgres>;
  let sesjaId = 0;

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    const [s] = await sql`insert into backtest_sessions (name, data_from, data_to) values (${`E2E etap4 ${RUN}`}, '2019-03-04', '2019-03-08') returning id`;
    sesjaId = s.id;
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`delete from backtest_sessions where id = ${sesjaId}`.catch(() => undefined);
    await sql.end();
  });

  test("Nawigacja: Kalendarz i Backtest aktywne, żadnej pozycji „wkrótce”", async ({ page }) => {
    await page.goto("/calendar");
    const pasek = page.getByRole("navigation", { name: "Główna" });
    await expect(pasek.getByRole("link", { name: "Kalendarz" })).toHaveAttribute("aria-current", "page");
    await expect(pasek.getByRole("link", { name: "Backtest" })).toHaveAttribute("href", "/backtest");
    await expect(page.getByText("wkrótce")).toHaveCount(0);
  });

  test("Kalendarz: siatka miesiąca, dziś w akcencie, panel dnia z trade'ami, zrzutami i notatką", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.locator("[data-siatka-miesiaca]")).toBeVisible();
    const dzis = page.locator("[data-siatka-miesiaca] a").filter({ has: page.locator(".sr-only", { hasText: "(dziś)" }) });
    await expect(dzis).toHaveCount(1);
    const tlo = await dzis.locator("span.rounded-full").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const akcent = await page.evaluate(() => {
      const p = document.createElement("span");
      p.style.backgroundColor = "var(--color-accent)";
      document.body.appendChild(p);
      const k = getComputedStyle(p).backgroundColor;
      p.remove();
      return k;
    });
    expect(tlo).toBe(akcent);
    await dzis.click();
    await expect(page).toHaveURL(/dzien=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByText("Zrzuty dnia")).toBeVisible();
    await expect(page.getByText("Notatka dnia", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Dzień bez transakcji")).toBeVisible();
  });

  test("Backtest: porównanie źródeł z deltą i przełącznikiem, lista sesji, sesja i dzień sesji", async ({ page }) => {
    await page.goto("/backtest");
    const tabela = page.locator("[data-tabela-zrodel]");
    await expect(tabela.locator("tbody tr")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "Live" })).toHaveAttribute("aria-current", "true");
    await page.getByRole("navigation", { name: "Porównaj z" }).getByRole("link", { name: "Backtest" }).click();
    await expect(page).toHaveURL(/porownaj=backtest/);
    await expect(page.getByText("Delta przy liczbie: różnica względem źródła „Backtest”.", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`E2E etap4 ${RUN}`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: `E2E etap4 ${RUN}` })).toBeVisible();
    await expect(page.locator("section.panel").filter({ hasText: "Dni bez sygnału" })).toBeVisible();
    await page.goto(`/backtest/${sesjaId}/dzien/2019-03-05`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("Ustawienia: pionowe zakładki, każda sekcja się otwiera", async ({ page }) => {
    for (const [adres, nazwa] of [
      ["/settings", "Ogólne"],
      ["/settings/security", "Bezpieczeństwo"],
      ["/settings/devices", "Urządzenia"],
      ["/settings/accounts", "Konta"],
      ["/settings/instruments", "Instrumenty"],
      ["/settings/tags", "Tagi"],
      ["/settings/fields", "Pola własne"],
      ["/settings/data", "Dane i kopia"],
    ] as const) {
      await page.goto(adres);
      await expect(page.getByRole("heading", { level: 1, name: "Ustawienia" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Sekcje ustawień" }).getByRole("link", { name: nazwa })).toHaveAttribute("aria-current", "page");
    }
    await page.goto("/settings/security");
    await expect(page.getByText("Unieważnij też wszystkie tokeny urządzeń", { exact: false })).toBeVisible();
  });

  test("PWA: manifest i ikony, service worker cache'uje tylko stronę offline, offline pokazuje „Brak połączenia”", async ({ page, context, request }) => {
    const m = await (await request.get("/manifest.webmanifest")).json();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    const rozmiary = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`);
    for (const r of ["192x192/any", "512x512/any", "192x192/maskable", "512x512/maskable"]) expect(rozmiary).toContain(r);
    for (const i of m.icons as { src: string }[]) expect((await request.get(i.src)).status(), i.src).toBe(200);

    const sw = await (await request.get("/sw.js")).text();
    expect(sw).toContain('url.pathname.startsWith("/api/")');
    expect(sw).not.toMatch(/cache\.put|caches\.open\([^)]*\)\.then\([^)]*put/);

    await page.goto("/");
    const stan = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      return Boolean(r.active);
    });
    expect(stan).toBe(true);
    // W pamięci podręcznej tylko strona offline i ikony, nic z danych ani z /api.
    await page.waitForFunction(async () => (await caches.keys()).length > 0);
    const wpisy = await page.evaluate(async () => {
      const wynik: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) wynik.push(new URL(r.url).pathname);
      return wynik.sort();
    });
    expect(wpisy).toEqual(["/icons/favicon.svg", "/icons/icon-192.png", "/offline.html"]);

    await page.reload();
    await context.setOffline(true);
    try {
      await page.goto("/trades").catch(() => undefined);
      await expect(page.getByRole("heading", { name: "Brak połączenia" })).toBeVisible();
      await expect(page.getByText(/\d+[,.]\d{2}\s?USD/)).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test("Arkusz „+” na telefonie: notatka dopisuje się do dnia, zdjęcie z aparatu trafia do dnia jako manual", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const [konto] = await sql`select id from accounts order by sort_order, id limit 1`;
    await page.goto("/");
    await page.getByRole("button", { name: "Szybki wpis" }).click();
    await expect(page.getByRole("dialog", { name: "Szybki wpis" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nowy trade" })).toHaveAttribute("href", "/trades/new");

    // Dzień handlowy liczy serwer (futures: po 17:00 NY to już kolejny dzień), więc wpis znajdujemy po znaczniku RUN.
    const wpis = `Szybki wpis ${RUN}`;
    let notatka: { id: number; day: string; post_session: string } | undefined;

    try {
      await page.getByRole("button", { name: "Notatka dnia" }).click();
      await page.getByRole("textbox", { name: /Notatka dnia/ }).fill(`Szybki wpis ${RUN}`);
      await page.getByRole("button", { name: "Dopisz do dnia" }).click();
      await expect(page.getByText("Dopisano do notatki dnia.")).toBeVisible();
      ;[notatka] = await sql<{ id: number; day: string; post_session: string }[]>`select id, day::text, post_session from day_notes where account_id = ${konto.id} and backtest_session_id is null and post_session like ${`%${wpis}`}`;
      expect(notatka?.post_session.endsWith(wpis)).toBe(true);

      await page.getByRole("button", { name: "Wróć do wyboru" }).click();
      await page.getByRole("button", { name: "Zdjęcie" }).click();
      const pole = page.locator("#szybkie-zdjecie");
      await expect(pole).toHaveAttribute("capture", "environment");
      await expect(pole).toHaveAttribute("accept", "image/*");
      await page.getByLabel("Do czego").selectOption("dzien");
      await pole.setInputFiles({ name: `aparat-${RUN}.png`, mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
      await page.getByRole("button", { name: "Dodaj zdjęcie" }).click();
      await expect(page.getByText("Zdjęcie dodane do dnia.")).toBeVisible();
      const zrzuty = await sql`select s.id, s.origin from screenshots s join day_notes n on n.id = s.day_note_id
        where n.id = ${notatka!.id} order by s.id desc limit 1`;
      expect(zrzuty[0].origin).toBe("manual");
      await sql`delete from screenshots where id = ${zrzuty[0].id}`;
      await axe(page, "arkusz szybkiego wpisu @375");
    } finally {
      // Przywracamy notatkę sprzed testu: zdejmujemy dopisek; jeśli był jedyną treścią, kasujemy wpis.
      const [n] = await sql<{ id: number; post_session: string }[]>`select id, post_session from day_notes where account_id = ${konto.id} and post_session like ${`%${wpis}`}`;
      if (n) {
        const reszta = n.post_session.slice(0, -wpis.length).replace(/\n\n$/, "");
        await sql`update day_notes set post_session = ${reszta || null} where id = ${n.id}`;
      }
    }
  });

  for (const [szer, wys] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`Dostępność i brak poziomego przewijania przy ${szer}`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: szer, height: wys });
      const adresy = [
        "/calendar",
        "/calendar?miesiac=2026-10&dzien=2026-10-13",
        "/backtest",
        `/backtest/${sesjaId}`,
        `/backtest/${sesjaId}/dzien/2019-03-05`,
        "/settings",
        "/settings/security",
        "/settings/devices",
        "/settings/accounts",
        "/settings/instruments",
        "/settings/tags",
        "/settings/fields",
        "/settings/data",
        "/offline.html",
      ];
      for (const adres of adresy) {
        await page.goto(adres);
        await axe(page, `${adres} @${szer}`);
        await bezPoziomegoScrolla(page, `${adres} @${szer}`);
      }
    });
  }
});
