import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";

/*
 * UI v2, etap 3: Przegląd tygodnia (zatwierdzenie jako aktor `ui` z rozliczeniem poprzedniego zobowiązania),
 * Prop (przypięcie presetu z potwierdzeniem, wpis księgi, bufory na liście) i Statystyki v2 (kafle z n
 * i przedziałem). Dane testowe na LOKALNEJ bazie, w tygodniach z 2001 r. i na własnym koncie (znacznik RUN);
 * sprzątamy po sobie. Dostępność: axe przy 1440 i 375 oraz brak poziomego przewijania przy 375.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const AXE_TAGI = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const POPRZEDNI = "2000-12-25";
const TYDZIEN = "2001-01-01";

test.describe.configure({ mode: "serial" });

async function axe(page: Page, opis: string) {
  await page.waitForLoadState("networkidle");
  const wynik = await new AxeBuilder({ page }).withTags(AXE_TAGI).analyze();
  const bledy = wynik.violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el. [${v.nodes[0]?.target.join(" ")}]`);
  expect(bledy, `${opis}\n${bledy.join("\n")}`).toEqual([]);
}

async function bezPoziomegoScrolla(page: Page, opis: string) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `${opis}: scrollWidth ${sw} > ${cw}`).toBeLessThanOrEqual(cw);
}

test.describe("UI v2: Przegląd, Prop, Statystyki", () => {
  let sql: ReturnType<typeof postgres>;
  let kontoId = 0;

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      const [w] = await tx`insert into user_words (text, source, role, day, captured_at) values (${`Zobowiązanie e2e ${RUN}`}, 'ui', 'weekly.commitment', ${POPRZEDNI}, now()) returning id`;
      await tx`insert into weekly_reviews (week_start, status, commitment_words_id, approved_at) values (${POPRZEDNI}, 'approved', ${w.id}, now())`;
      const [k] = await tx`insert into accounts (name, type, starting_balance, default_risk_amount, prop_phase) values (${`E2E prop ${RUN}`}, 'prop', 5000000, 25000, 'eval') returning id`;
      kontoId = k.id;
    });
  });

  test.afterAll(async () => {
    if (!sql) return;
    const ciche = (p: Promise<unknown>) => p.catch(() => undefined);
    const przeglady = await sql<{ conclusions_words_id: number | null; commitment_words_id: number | null; prev_result_words_id: number | null }[]>`
      select conclusions_words_id, commitment_words_id, prev_result_words_id from weekly_reviews where week_start in (${POPRZEDNI}, ${TYDZIEN})`;
    const slowa = przeglady.flatMap((p) => [p.conclusions_words_id, p.commitment_words_id, p.prev_result_words_id]).filter((x): x is number => x !== null);
    await ciche(sql`delete from weekly_reviews where week_start = ${TYDZIEN}`);
    await ciche(sql`delete from weekly_reviews where week_start = ${POPRZEDNI}`);
    if (slowa.length) await ciche(sql`delete from user_words where id in ${sql(slowa)}`);
    await ciche(sql`delete from prop_ledger where account_id = ${kontoId}`);
    await ciche(sql`delete from prop_rules where account_id = ${kontoId}`);
    await ciche(sql`delete from accounts where id = ${kontoId}`);
    await sql.end();
  });

  test("Przegląd: rozliczenie poprzedniego zobowiązania i zatwierdzenie zapisują się jako aktor ui", async ({ page }) => {
    await page.goto(`/przeglad?tydzien=${TYDZIEN}`);
    await expect(page.getByRole("heading", { level: 1, name: "Przegląd" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Przegląd", exact: true }).first()).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(`Zobowiązanie e2e ${RUN}`)).toBeVisible();
    await page.getByText("Częściowo", { exact: true }).click();
    await page.getByLabel("Co się stało (Twoimi słowami)").fill(`Dwa razy przed planem ${RUN}`);
    await page.getByLabel(/Wnioski z tygodnia/).fill(`Wnioski e2e ${RUN}\ndruga linia`);
    await page.getByLabel(/Zobowiązanie na następny tydzień/).fill(`Nowe zobowiązanie ${RUN}`);
    await page.getByRole("button", { name: "Zatwierdź przegląd" }).click();
    // Po zapisie strona odświeża się sama: zamiast formularza widok zatwierdzonego przeglądu.
    await expect(page.getByRole("heading", { name: "Wnioski i zobowiązanie" })).toBeVisible();

    const [r] = await sql`select w.status, w.approved_at, w.prev_commitment_result, c.text as wnioski, c.source as zrodlo, z.text as zob
      from weekly_reviews w join user_words c on c.id = w.conclusions_words_id join user_words z on z.id = w.commitment_words_id where w.week_start = ${TYDZIEN}`;
    expect(r.status).toBe("approved");
    expect(r.approved_at).not.toBeNull();
    expect(r.prev_commitment_result).toBe("partial");
    expect(r.wnioski).toBe(`Wnioski e2e ${RUN}\ndruga linia`);
    expect(r.zrodlo).toBe("ui");
    expect(r.zob).toBe(`Nowe zobowiązanie ${RUN}`);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Wnioski i zobowiązanie" })).toBeVisible();
    await expect(page.getByText(`Nowe zobowiązanie ${RUN}`)).toBeVisible();
  });

  test("Przegląd miesiąca: podziały z n, komórki n<20 opisane", async ({ page }) => {
    await page.goto("/przeglad?widok=miesiac");
    await expect(page.getByRole("region", { name: "Long i short" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Okno wejścia (czas NY, co 30 min)" })).toBeVisible();
    await expect(page.getByText("Komórki z n < 20 są wyszarzone", { exact: false })).toBeVisible();
  });

  test("Prop: przypięcie presetu z potwierdzeniem i wpis księgi; lista pokazuje konto z buforami", async ({ page }) => {
    await page.goto(`/prop/${kontoId}`);
    await expect(page.getByRole("heading", { level: 1, name: `E2E prop ${RUN}` })).toBeVisible();
    const wybor = page.getByLabel("Preset firmy");
    const pierwszy = await wybor.locator("option").nth(1).getAttribute("value");
    await wybor.selectOption(pierwszy!);
    await page.getByLabel(/Obowiązuje od/).fill("2026-01-02");
    await page.getByLabel("Sprawdziłem te wartości z regulaminem firmy").check();
    await page.getByRole("button", { name: "Przypnij reguły" }).click();
    await expect(page.getByText("Reguły przypięte i potwierdzone.")).toBeVisible();
    const [reg] = await sql`select preset_id, valid_from::text vf, confirmed_at from prop_rules where account_id = ${kontoId}`;
    expect(reg.preset_id).toBe(Number(pierwszy));
    expect(reg.vf).toBe("2026-01-02");
    expect(reg.confirmed_at).not.toBeNull();

    await page.getByLabel("Kwota ($)").fill("149,50");
    await page.getByLabel("Notatka").fill(`eval e2e ${RUN}`);
    await page.getByRole("button", { name: "Dodaj wpis" }).click();
    await expect(page.getByText("Dodano wpis do księgi.")).toBeVisible();
    const [wpis] = await sql`select kind, amount_cents from prop_ledger where account_id = ${kontoId}`;
    expect(wpis.kind).toBe("eval_fee");
    expect(Number(wpis.amount_cents)).toBe(-14950);

    await page.goto("/prop");
    const wiersz = page.locator(`[data-konto="${kontoId}"]`);
    await expect(wiersz).toBeVisible();
    await expect(wiersz.getByRole("meter").first()).toBeVisible();
    await expect(wiersz.getByText("reguły niepotwierdzone")).toHaveCount(0);
    await page.goto("/prop?widok=presety");
    await expect(page.getByText("do weryfikacji", { exact: false }).first()).toBeVisible();
  });

  test("Statystyki v2: kafle z n i przedziałem, źródła, setupy, hipotezy; stare panele zostają", async ({ page }) => {
    await page.goto("/stats");
    const kafle = page.locator("[data-kafle-v2]");
    await expect(kafle).toBeVisible();
    await expect(kafle.getByText(/n=\d+/).first()).toBeVisible();
    await expect(kafle.getByText(/95%:/).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Źródła danych (oczekiwane R)" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Setupy (status)" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Dyscyplina" })).toBeVisible();
    await expect(page.locator("div.panel").filter({ has: page.locator("p.etykieta", { hasText: "Wynik" }) }).first()).toBeVisible();
  });

  for (const [szer, wys] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`Dostępność i brak poziomego przewijania przy ${szer}`, async ({ page }) => {
      await page.setViewportSize({ width: szer, height: wys });
      for (const adres of [`/przeglad?tydzien=${TYDZIEN}`, "/przeglad", "/przeglad?widok=miesiac", "/prop", "/prop?widok=presety", "/prop?widok=ksiega", `/prop/${kontoId}`, "/stats"]) {
        await page.goto(adres);
        await axe(page, `${adres} @${szer}`);
        await bezPoziomegoScrolla(page, `${adres} @${szer}`);
      }
    });
  }
});
