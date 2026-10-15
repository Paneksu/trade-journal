import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";

/*
 * UI v2, faza 5, etap 1: szkielet (pasek boczny, dolny pasek, Ctrl+K, manifest), ekran Dziś, lista
 * trade'ów (księga + szuflada + przełącznik galerii) i szczegół trade'a z zakładkami. Dane testowe
 * wstawiamy SQL-em na LOKALNEJ bazie (dzień z 1979 roku, znacznik RUN w tekstach) i sprzątamy po sobie.
 * Dostępność: axe (WCAG 2.0-2.2 A i AA) przy 1440 i 375, plus brak poziomego przewijania przy 375.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const DZIEN = "1979-06-12";
const AXE_TAGI = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/* Słowa użytkownika z polskimi znakami, emoji i nową linią: UI ma je pokazać bajt w bajt. */
const TEZA = `Sweep PDL ${RUN} o 9:35 🙂\nLong do PDH, SL pod knotem — „bez ruszania”.`;

test.describe.configure({ mode: "serial" });

async function axe(page: Page, opis: string) {
  await page.waitForLoadState("networkidle");
  const wynik = await new AxeBuilder({ page }).withTags(AXE_TAGI).analyze();
  const bledy = wynik.violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el. [${v.nodes[0]?.target.join(" ")}]`);
  expect(bledy, `${opis}\n${bledy.join("\n")}`).toEqual([]);
}

async function bezPoziomegoScrolla(page: Page) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, "poziome przewijanie przy 375 px").toBeLessThanOrEqual(cw);
}

test.describe("UI v2: szkielet, Dziś, lista i szczegół trade'a", () => {
  let sql: ReturnType<typeof postgres>;
  let kontoId = 0;
  let tradeZamkniety = 0;
  let tradeUkryty = 0;
  let planId = 0;
  const slowa: number[] = [];

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    const [i] = await sql`select id from instruments where symbol = 'NQ' limit 1`;
    if (!i) throw new Error("Brak instrumentu NQ w lokalnej bazie. Uruchom `npm run seed`.");
    const [k] = await sql`insert into accounts (name, type) values (${`E2E UI v2 ${RUN}`}, 'live') returning id`;
    kontoId = k.id;

    const trade = async (status: "open" | "closed", minuta: number, notatka: string | null) => {
      const czas = `${DZIEN}T14:${minuta}:00Z`;
      const [t] = await sql`
        insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, stop_loss, take_profit,
                            exit_time, exit_price, pnl, risk_amount, r_multiple, trading_day, market_session, exit_count, closed_contracts,
                            source, note)
        values (${kontoId}, ${i.id}, 'long', ${status}, ${czas}, 20000, 2, 19990, 20040,
                ${status === "closed" ? `${DZIEN}T14:59:00Z` : null}, ${status === "closed" ? 20020 : null}, ${status === "closed" ? 60000 : 80000},
                40000, ${status === "closed" ? 2 : null}, ${DZIEN}, 'rth', ${status === "closed" ? 1 : 0}, ${status === "closed" ? 2 : 0},
                'tradingview', ${notatka})
        returning id`;
      return t.id as number;
    };
    tradeZamkniety = await trade("closed", 31, `Notatka UI v2 ${RUN}: wszedłem po sweepie.`);
    // Otwarty z werdyktem: wynik w bazie celowo wpisany (jak w funkcje-2b), UI nie może go pokazać.
    tradeUkryty = await trade("open", 45, null);

    const slowo = async (tekst: string, rola: string, czas: string) => {
      const [w] = await sql`insert into user_words (text, source, role, day, captured_at) values (${tekst}, 'chat', ${rola}, ${DZIEN}, ${czas}) returning id`;
      slowa.push(w.id);
      return w.id as number;
    };
    const teza = await slowo(TEZA, "plan.thesis", `${DZIEN}T14:25:00Z`);
    const [p] = await sql`
      insert into trade_plans (trade_id, account_id, instrument_id, day, ruleset_version, direction, bias, entry_price, stop_loss, take_profit,
                               contracts, risk_cents, thesis_words_id, origin, frozen_at, entry_time_at_attach)
      values (${tradeZamkniety}, ${kontoId}, ${i.id}, ${DZIEN}, 0, 'long', 'long', 20000, 19990, 20040, 2, 40000, ${teza}, 'user',
              ${`${DZIEN}T14:26:00Z`}, ${`${DZIEN}T14:31:00Z`})
      returning id`;
    planId = p.id;
    const dopisek = await slowo(`Dopisek ${RUN}: SL na BE po +1R.`, "plan.addendum", `${DZIEN}T14:40:00Z`);
    await sql`insert into trade_plan_addenda (plan_id, field, new_value, words_id, created_at) values (${planId}, 'stop_loss', '20000', ${dopisek}, ${`${DZIEN}T14:40:00Z`})`;

    // Werdykt z as_of jest niezmienny razem ze sprawdzeniami: oba w jednej transakcji (trigger 0021).
    for (const id of [tradeZamkniety, tradeUkryty]) await sql.begin(async (sql) => {
      const [r] = await sql`
        insert into trade_reviews (trade_id, setup_type, summary_md, basis, brain_verdict, model, kind, as_of, evidence_hash, evidence_cutoff)
        values (${id}, 'FVG po sweepie', ${`**Uzasadnienie ${RUN}** <b>bez HTML</b>`}, 'chart', 'wejdz', 'claude-opus-4', 'ai',
                ${`${DZIEN}T14:29:00Z`}, ${createHash("sha256").update(String(id)).digest("hex")}, ${`${DZIEN}T14:29:00Z`})
        returning id`;
      await sql`insert into trade_rule_checks (review_id, rule_id, rule_text, verdict, evidence) values (${r.id}, 'E2E-UI', 'Bias z 1h przed wejściem', 'pass', ${`Dowód ${RUN}`})`;
    });
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`delete from trade_rule_checks where review_id in (select id from trade_reviews where trade_id = any(${[tradeZamkniety, tradeUkryty]}))`;
    await sql`delete from trade_reviews where trade_id = any(${[tradeZamkniety, tradeUkryty]})`;
    await sql`delete from trade_plan_addenda where plan_id = ${planId}`;
    await sql`delete from trade_plans where id = ${planId}`;
    await sql`delete from user_words where id = any(${slowa})`;
    await sql`delete from trades where account_id = ${kontoId}`;
    await sql`delete from accounts where id = ${kontoId}`;
    await sql.end();
  });

  test("szkielet: nawigacja z planu, znak, manifest i ikony PWA bez logowania", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Główna" });
    for (const nazwa of ["Dziś", "Do decyzji", "Trade'y", "Playbook", "Statystyki", "Kalendarz", "Backtest"]) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${nazwa}`) })).toBeVisible();
    }
    // Ekrany z kolejnych etapów są widoczne, ale nie udają linków.
    for (const nazwa of ["Przegląd", "Prop", "Mózg"]) await expect(nav.getByText(nazwa, { exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Dziś" })).toHaveAttribute("aria-current", "page");

    const anonim = await pwRequest.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
    const m = await anonim.get("/manifest.webmanifest");
    expect(m.status()).toBe(200);
    const manifest = await m.json();
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const ikona of ["/icons/icon-192.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon-180.png", "/favicon.ico"]) {
      expect((await anonim.get(ikona)).status(), ikona).toBe(200);
    }
    await anonim.dispose();
  });

  test("Ctrl+K: paleta szuka w trade'ach i prowadzi do karty", async ({ page }) => {
    await page.goto("/trades");
    await page.keyboard.press("Control+k");
    const pole = page.getByRole("combobox", { name: "Szukaj w dzienniku" });
    await expect(pole).toBeFocused();
    await pole.fill(`Notatka UI v2 ${RUN}`);
    const wynik = page.getByRole("option").filter({ hasText: `#${tradeZamkniety}` });
    await expect(wynik).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/trades/${tradeZamkniety}`));
  });

  test("Dziś: rytuał zapisuje unieważnienie bajt w bajt i nie zmienia go bez zmiany treści", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Dziś" })).toBeVisible();
    const tekst = `Zamknięcie 1h pod 20 080 ${RUN} 🙂\nkończy long`;
    const [przed] = await sql`select max(id) as id from user_words where role = 'day.invalidation'`;
    await page.waitForLoadState("networkidle");
    const pole = page.getByLabel(/^Unieważnienie/);
    await pole.fill(tekst);
    await expect(pole).toHaveValue(tekst);
    await page.getByRole("button", { name: "Zapisz rytuał" }).click();
    await expect(page.getByRole("status")).toContainText("Zapisano");
    const nowe = await sql`select id, text from user_words where role = 'day.invalidation' and id > ${przed.id ?? 0}`;
    try {
      expect(nowe).toHaveLength(1);
      expect(nowe[0].text).toBe(tekst);
      // Drugi zapis tej samej treści nie mnoży wpisów.
      await page.getByRole("button", { name: "Zapisz rytuał" }).click();
      await expect(page.getByRole("status")).toContainText("Zapisano");
      const [{ n }] = await sql`select count(*)::int as n from user_words where role = 'day.invalidation' and id > ${przed.id ?? 0}`;
      expect(n).toBe(1);
    } finally {
      await sql`delete from user_words where id = any(${nowe.map((w) => w.id)})`;
    }
  });

  test("lista: księga z datą w pierwszym wierszu dnia, szuflada podglądu i przełącznik galerii z filtrami", async ({ page }) => {
    await page.goto(`/trades?od=${DZIEN}&do=${DZIEN}&konto=${kontoId}`);
    const wiersze = page.locator("table tbody tr");
    await expect(wiersze).toHaveCount(2);
    // Ślepa ocena na liście: otwarty trade z werdyktem nie pokazuje 800,00.
    await expect(page.locator("table")).not.toContainText("800,00");
    await expect(wiersze.filter({ hasText: "ukryty" })).toHaveCount(1);

    await page.getByRole("button", { name: `Podgląd trade'a #${tradeZamkniety}` }).click();
    const szuflada = page.getByRole("dialog", { name: `Podgląd trade'a #${tradeZamkniety}` });
    await expect(szuflada).toBeVisible();
    await expect(szuflada).toContainText("+2.00R");
    await expect(szuflada).toContainText("Plan zamrożony");
    await page.keyboard.press("Escape");
    await expect(szuflada).toHaveCount(0);

    await page.getByRole("button", { name: `Podgląd trade'a #${tradeUkryty}` }).click();
    const ukryta = page.getByRole("dialog", { name: `Podgląd trade'a #${tradeUkryty}` });
    await expect(ukryta).toContainText("Wynik ukryty");
    await expect(ukryta).not.toContainText("800,00");
    await page.getByRole("button", { name: "Zamknij podgląd" }).click();

    await page.getByRole("group", { name: "Widok" }).getByRole("link", { name: "Galeria" }).click();
    await expect(page).toHaveURL(new RegExp(`/galeria\\?.*konto=${kontoId}`));
    await expect(page.getByRole("group", { name: "Widok" }).getByRole("link", { name: "Galeria" })).toHaveAttribute("aria-current", "true");
  });

  test("szczegół: zakładka Plan pokazuje zamrożoną tezę dosłownie i dopisek z godziną", async ({ page }) => {
    await page.goto(`/trades/${tradeZamkniety}`);
    await expect(page.getByRole("navigation", { name: "Zakładki trade'a" }).getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    const teza = page.locator("blockquote").first();
    expect(await teza.innerText()).toBe(TEZA);
    await expect(page.getByText(`Dopisek ${RUN}: SL na BE po +1R.`)).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Właściwości" })).toContainText("zamrożony");
  });

  test("szczegół: werdykt AI ukrywa wynik do zamknięcia, markdown bez surowego HTML, po zamknięciu wynik wraca", async ({ page }) => {
    await page.goto(`/trades/${tradeUkryty}?zakladka=werdykt`);
    await expect(page.getByText("Wynik ukryty do zamknięcia trade'a")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("800,00");
    await expect(page.getByText(`Uzasadnienie ${RUN}`, { exact: true })).toBeVisible();
    await expect(page.getByText("<b>bez HTML</b>")).toBeVisible();
    expect(await page.locator("main [data-ocena] b").count()).toBe(0);

    await sql`update trades set status = 'closed', exit_time = ${`${DZIEN}T14:59:00Z`}, exit_price = 20020, r_multiple = 2, exit_count = 1, closed_contracts = 2 where id = ${tradeUkryty}`;
    await page.reload();
    await expect(page.getByText("Wynik ukryty do zamknięcia trade'a")).toHaveCount(0);
    await expect(page.locator("header").getByText(/\+800,00\s?USD/)).toBeVisible();
  });

  test("szczegół: ocena procesu A/B/C zapisuje się jako decyzja użytkownika", async ({ page }) => {
    await page.goto(`/trades/${tradeZamkniety}?zakladka=proces`);
    const b = page.getByRole("group", { name: "Ocena procesu" }).getByRole("button", { name: /^B/ });
    await b.click();
    await expect(b).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await sql`select process_grade from trades where id = ${tradeZamkniety}`)[0].process_grade).toBe("B");
    await expect(page.getByText("Zasłużony zysk")).toBeVisible();
  });

  for (const [szer, wys] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`dostępność UI v2 przy ${szer}px: Dziś, lista, szczegół (każda zakładka)`, async ({ page }) => {
      await page.setViewportSize({ width: szer, height: wys });
      const adresy = [
        "/",
        `/trades?od=${DZIEN}&do=${DZIEN}&konto=${kontoId}`,
        ...["plan", "werdykt", "przebieg", "zrzuty", "proces", "notatka"].map((z) => `/trades/${tradeZamkniety}?zakladka=${z}`),
      ];
      for (const adres of adresy) {
        await page.goto(adres);
        await axe(page, `${adres} @ ${szer}`);
        if (szer === 375) await bezPoziomegoScrolla(page);
      }
      // Paleta i szuflada to warstwy: też przez axe.
      await page.goto(`/trades?od=${DZIEN}&do=${DZIEN}&konto=${kontoId}`);
      if (szer === 1440) {
        await page.getByRole("button", { name: `Podgląd trade'a #${tradeZamkniety}` }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await axe(page, `szuflada @ ${szer}`);
        await page.keyboard.press("Escape");
      }
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: "Szukaj w dzienniku" }).fill("sweep");
      await axe(page, `paleta @ ${szer}`);
    });
  }
});
