import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";

/*
 * Ruch UI v2 (faza 2d): czasy i krzywe z tokenów, gest zamknięcia arkusza, reduced-motion (wszystko wyłączone,
 * treść widoczna), CLS = 0 przy zmianach treści oraz wynik ukryty do zamknięcia, którego żadna klatka nie może zdradzić.
 * Dane: konto i dwa trade'y na LOKALNEJ bazie (dzień z 1979 roku), sprzątane po teście.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const DZIEN = "1979-06-13";
const WYNIK_UKRYTY = "800,00";

test.describe.configure({ mode: "serial" });

/** Najdłuższy czas trwania (ms) animacji i przejść, które teraz trwają w dokumencie. */
async function najdluzszaAnimacja(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(0, ...document.getAnimations().map((a) => Number(a.effect?.getTiming().duration ?? 0)).filter((d) => Number.isFinite(d))),
  );
}

/** Podsłuch: czy w którejkolwiek klatce (rAF + zmiany DOM) w tekście strony pojawiła się fraza; do tego suma CLS. */
async function zalozPodsluch(page: Page, fraza: string) {
  await page.evaluate((f) => {
    const w = window as unknown as { __wyciek: string[]; __cls: number };
    w.__wyciek = [];
    w.__cls = 0;
    const sprawdz = () => {
      if (document.body.innerText.includes(f) || document.body.textContent?.includes(f)) w.__wyciek.push(performance.now().toFixed(0));
    };
    new MutationObserver(sprawdz).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    const petla = () => {
      sprawdz();
      requestAnimationFrame(petla);
    };
    requestAnimationFrame(petla);
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  }, fraza);
}

async function odczytPodsluchu(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __wyciek: string[]; __cls: number };
    return { wyciek: w.__wyciek, cls: w.__cls };
  });
}

test.describe("ruch UI v2", () => {
  let sql: ReturnType<typeof postgres>;
  let kontoId = 0;
  let tradeZamkniety = 0;
  let tradeUkryty = 0;

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    const [i] = await sql`select id from instruments where symbol = 'NQ' limit 1`;
    if (!i) throw new Error("Brak instrumentu NQ w lokalnej bazie. Uruchom `npm run seed`.");
    const [k] = await sql`insert into accounts (name, type) values (${`E2E ruch ${RUN}`}, 'live') returning id`;
    kontoId = k.id;
    const trade = async (status: "open" | "closed", minuta: number) => {
      const czas = `${DZIEN}T14:${minuta}:00Z`;
      const [t] = await sql`
        insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, stop_loss, take_profit,
                            exit_time, exit_price, pnl, risk_amount, r_multiple, trading_day, market_session, exit_count, closed_contracts, source)
        values (${kontoId}, ${i.id}, 'long', ${status}, ${czas}, 20000, 2, 19990, 20040,
                ${status === "closed" ? `${DZIEN}T14:59:00Z` : null}, ${status === "closed" ? 20020 : null}, ${status === "closed" ? 60000 : 80000},
                40000, ${status === "closed" ? 2 : null}, ${DZIEN}, 'rth', ${status === "closed" ? 1 : 0}, ${status === "closed" ? 2 : 0}, 'tradingview')
        returning id`;
      return t.id as number;
    };
    tradeZamkniety = await trade("closed", 31);
    // Otwarty z werdyktem AI: wynik w bazie celowo wpisany (800,00), UI nie może go pokazać w żadnej klatce.
    tradeUkryty = await trade("open", 45);
    for (const id of [tradeZamkniety, tradeUkryty])
      await sql.begin(async (sql) => {
        const [r] = await sql`
          insert into trade_reviews (trade_id, setup_type, summary_md, basis, brain_verdict, model, kind, as_of, evidence_hash, evidence_cutoff)
          values (${id}, 'FVG po sweepie', ${`Uzasadnienie ${RUN}`}, 'chart', 'wejdz', 'claude-opus-4', 'ai',
                  ${`${DZIEN}T14:29:00Z`}, ${createHash("sha256").update(String(id)).digest("hex")}, ${`${DZIEN}T14:29:00Z`})
          returning id`;
        await sql`insert into trade_rule_checks (review_id, rule_id, rule_text, verdict, evidence) values (${r.id}, 'E2E-RUCH', 'Bias z 1h', 'pass', ${`Dowód ${RUN}`})`;
      });
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`delete from trade_rule_checks where review_id in (select id from trade_reviews where trade_id = any(${[tradeZamkniety, tradeUkryty]}))`;
    await sql`delete from trade_reviews where trade_id = any(${[tradeZamkniety, tradeUkryty]})`;
    await sql`delete from trades where account_id = ${kontoId}`;
    await sql`delete from accounts where id = ${kontoId}`;
    await sql.end();
  });

  const lista = () => `/trades?od=${DZIEN}&do=${DZIEN}&konto=${kontoId}`;

  test("czasy i krzywe: paleta 220 ms, szuflada 150 ms, tokeny w :root", async ({ page }) => {
    await page.goto(lista());
    // Tokeny rozwiązujemy przez computed style (CSS jest zminifikowany: 160ms -> .16s).
    const tokeny = await page.evaluate(() => {
      const czasy = ["--czas-stan", "--czas-szuflada", "--czas-warstwa", "--czas-wyjscie", "--czas-arkusz", "--czas-tresc"];
      const el = document.createElement("div");
      document.body.append(el);
      const wynik: Record<string, string> = {};
      for (const n of czasy) {
        el.style.transitionDuration = `var(${n})`;
        wynik[n] = getComputedStyle(el).transitionDuration;
      }
      for (const n of ["--ease-wejscie", "--ease-wyjscie"]) {
        el.style.transitionTimingFunction = `var(${n})`;
        wynik[n] = getComputedStyle(el).transitionTimingFunction;
      }
      el.remove();
      return wynik;
    });
    expect(tokeny).toEqual({
      "--czas-stan": "0.16s",
      "--czas-szuflada": "0.15s",
      "--czas-warstwa": "0.22s",
      "--czas-wyjscie": "0.12s",
      "--czas-arkusz": "0.28s",
      "--czas-tresc": "0.16s",
      "--ease-wejscie": "cubic-bezier(0.16, 1, 0.3, 1)",
      "--ease-wyjscie": "cubic-bezier(0.7, 0, 0.84, 0)",
    });

    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    const paleta = page.getByRole("dialog", { name: "Szukaj w dzienniku" });
    await expect(paleta).toBeVisible();
    const p = await paleta.evaluate((el) => {
      const c = getComputedStyle(el);
      return { nazwa: c.animationName, czas: c.animationDuration, krzywa: c.animationTimingFunction };
    });
    expect(p).toEqual({ nazwa: "tj-paleta-wejscie", czas: "0.22s", krzywa: "cubic-bezier(0.16, 1, 0.3, 1)" });
    await page.keyboard.press("Escape");
    await expect(paleta).toHaveCount(0);

    await page.getByRole("button", { name: `Podgląd trade'a #${tradeZamkniety}` }).click();
    const szuflada = page.getByRole("dialog", { name: `Podgląd trade'a #${tradeZamkniety}` });
    await expect(szuflada).toBeVisible();
    const s = await szuflada.evaluate((el) => {
      const c = getComputedStyle(el);
      return { nazwa: c.animationName, czas: c.animationDuration };
    });
    expect(s).toEqual({ nazwa: "tj-szuflada-wejscie", czas: "0.15s" });
    // Hover, focus i active: przejście tła i koloru 160 ms ease-out (wzór) na pigułce.
    const przejscie = await page.getByRole("link", { name: /Otwórz kartę/ }).evaluate((el) => {
      const c = getComputedStyle(el);
      return `${c.transitionProperty}|${c.transitionDuration}|${c.transitionTimingFunction}`;
    });
    expect(przejscie).toBe("background-color, color, border-color|0.16s|cubic-bezier(0, 0, 0.58, 1)");
    await page.keyboard.press("Escape");
    await expect(szuflada).toHaveCount(0);
  });

  test("wynik ukryty i CLS: żadna klatka (szuflada, zakładki, paleta) nie zawiera wyniku, układ stoi", async ({ page }) => {
    await page.goto(lista());
    await expect(page.locator("table tbody tr[data-trade]")).toHaveCount(2);
    await page.waitForLoadState("networkidle");
    await zalozPodsluch(page, WYNIK_UKRYTY);

    // Szuflada ukrytego trade'a: szkielet, treść, przełączenie wiersza bez ponownego wjazdu, zamknięcie.
    await page.getByRole("button", { name: `Podgląd trade'a #${tradeUkryty}` }).click();
    const ukryta = page.getByRole("dialog", { name: `Podgląd trade'a #${tradeUkryty}` });
    await expect(ukryta).toContainText("Wynik ukryty");
    await page.getByRole("button", { name: `Podgląd trade'a #${tradeZamkniety}` }).click();
    await expect(page.getByRole("dialog", { name: `Podgląd trade'a #${tradeZamkniety}` })).toContainText("+2.00R");
    await page.getByRole("button", { name: `Podgląd trade'a #${tradeUkryty}` }).click();
    await expect(page.getByRole("dialog", { name: `Podgląd trade'a #${tradeUkryty}` })).toContainText("Wynik ukryty");
    await page.keyboard.press("Escape");
    await expect(ukryta).toHaveCount(0);

    // Paleta: wyszukanie ukrytego trade'a.
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Szukaj w dzienniku" }).fill(`#${tradeUkryty}`);
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");

    const lista1 = await odczytPodsluchu(page);
    expect(lista1.wyciek, "wynik ukrytego trade'a pojawił się w którejś klatce listy").toEqual([]);
    expect(lista1.cls, "CLS przy szufladzie i palecie").toBeLessThan(0.001);

    // Karta ukrytego trade'a: wszystkie zakładki kolejno (nawigacja w aplikacji, podsłuch zostaje).
    await page.goto(`/trades/${tradeUkryty}?zakladka=werdykt`);
    await page.waitForLoadState("networkidle");
    await zalozPodsluch(page, WYNIK_UKRYTY);
    const nav = page.getByRole("navigation", { name: "Zakładki trade'a" });
    for (const z of ["Przebieg", "Zrzuty", "Proces", "Notatka", "Plan", "Werdykt AI"]) {
      await nav.getByRole("link", { name: new RegExp(`^${z}`) }).click();
      await expect(nav.getByRole("link", { name: new RegExp(`^${z}`) })).toHaveAttribute("aria-current", "page");
      await page.waitForTimeout(250);
    }
    const { wyciek, cls } = await odczytPodsluchu(page);
    expect(wyciek, "wynik ukrytego trade'a pojawił się w którejś klatce karty").toEqual([]);
    expect(cls, "CLS przy zmianie zakładek").toBeLessThan(0.001);
  });

  test("zakładki: zmiana odtwarza wejście 160 ms, pełne ładowanie bez ruchu", async ({ page }) => {
    await page.goto(`/trades/${tradeZamkniety}?zakladka=werdykt`);
    await page.waitForLoadState("networkidle");
    expect(await page.locator(".tj-tresc-wejscie, .tj-strona-wejscie").count(), "pełne ładowanie nie animuje").toBe(0);
    const nav = page.getByRole("navigation", { name: "Zakładki trade'a" });
    await nav.getByRole("link", { name: /^Przebieg/ }).click();
    await expect(nav.getByRole("link", { name: /^Przebieg/ })).toHaveAttribute("aria-current", "page");
    const animacja = await page.evaluate(() => {
      const el = document.querySelector(".tj-tresc-wejscie");
      return el ? getComputedStyle(el).animationDuration : null;
    });
    expect(animacja).toBe("0.16s");
    await page.waitForTimeout(300);
    // W spoczynku nic z tekstem nie jest przezroczyste.
    const przezroczyste = await page.evaluate(
      () =>
        [...document.querySelectorAll("main *")].filter(
          (e) => e.children.length === 0 && (e.textContent ?? "").trim() && Number(getComputedStyle(e).opacity) < 0.5 && !e.closest("[aria-hidden]"),
        ).length,
    );
    expect(przezroczyste).toBe(0);
  });

  test("arkusz plus na telefonie: wysunięcie od dołu, długi gest w dół zamyka, krótki wraca", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Szybki wpis" }).click();
    const arkusz = page.getByRole("dialog", { name: "Szybki wpis" });
    await expect(arkusz).toBeVisible();
    const a = await arkusz.evaluate((el) => {
      const c = getComputedStyle(el);
      return { nazwa: c.animationName, czas: c.animationDuration, krzywa: c.animationTimingFunction };
    });
    expect(a).toEqual({ nazwa: "tj-arkusz-wejscie", czas: "0.28s", krzywa: "cubic-bezier(0.16, 1, 0.3, 1)" });
    await page.waitForTimeout(450);

    const uchwyt = arkusz.locator("[data-uchwyt-arkusza]");
    const box = (await uchwyt.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Krótki, wolny gest (40 px): arkusz podąża za palcem, po puszczeniu wraca i zostaje.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 20, { steps: 4 });
    await page.mouse.move(x, y + 40, { steps: 4 });
    expect(await arkusz.evaluate((el) => el.style.getPropertyValue("--przeciagniecie"))).toBe("40px");
    await page.waitForTimeout(450);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(arkusz).toBeVisible();
    expect(await arkusz.evaluate((el) => el.style.getPropertyValue("--przeciagniecie"))).toBe("0px");
    expect((await arkusz.boundingBox())!.y).toBeLessThan(box.y);

    // Długi gest (160 px): zamyka.
    const box2 = (await uchwyt.boundingBox())!;
    await page.mouse.move(box2.x + box2.width / 2, box2.y + 10);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + 170, { steps: 8 });
    await page.mouse.up();
    await expect(arkusz).toHaveCount(0);
  });

  test("reduced motion: wszystko wyłączone, treść widoczna, okna działają", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(lista());
    await expect(page.locator("table tbody tr[data-trade]")).toHaveCount(2);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Podgląd trade'a #${tradeZamkniety}` }).click();
    const szuflada = page.getByRole("dialog", { name: `Podgląd trade'a #${tradeZamkniety}` });
    await expect(szuflada).toBeVisible();
    const czasMs = await szuflada.evaluate((el) => {
      const c = getComputedStyle(el).animationDuration;
      return c.endsWith("ms") ? Number.parseFloat(c) : Number.parseFloat(c) * 1000;
    });
    expect(czasMs).toBeLessThan(0.1);
    const przejscieMs = await page.getByRole("link", { name: /Otwórz kartę/ }).evaluate((el) => {
      const c = getComputedStyle(el).transitionDuration.split(",")[0].trim();
      return c.endsWith("ms") ? Number.parseFloat(c) : Number.parseFloat(c) * 1000;
    });
    expect(przejscieMs).toBeLessThan(0.1);
    await page.keyboard.press("Escape");
    await expect(szuflada).toHaveCount(0);

    await page.keyboard.press("Control+k");
    const paleta = page.getByRole("dialog", { name: "Szukaj w dzienniku" });
    await expect(paleta).toBeVisible();
    expect(await najdluzszaAnimacja(page)).toBeLessThan(1);
    await page.keyboard.press("Escape");
    await expect(paleta).toHaveCount(0);

    // Zakładki bez ruchu, treść w spoczynku nieprzezroczysta.
    await page.goto(`/trades/${tradeZamkniety}?zakladka=werdykt`);
    await page.getByRole("navigation", { name: "Zakładki trade'a" }).getByRole("link", { name: /^Przebieg/ }).click();
    await page.waitForTimeout(100);
    expect(await najdluzszaAnimacja(page)).toBeLessThan(1);
    const przezroczyste = await page.evaluate(
      () =>
        [...document.querySelectorAll("main *")].filter(
          (e) => e.children.length === 0 && (e.textContent ?? "").trim() && Number(getComputedStyle(e).opacity) < 0.5 && !e.closest("[aria-hidden]"),
        ).length,
    );
    expect(przezroczyste).toBe(0);

    // Arkusz na telefonie zamyka się bez czekania na animację.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByRole("button", { name: "Szybki wpis" }).click();
    const arkusz = page.getByRole("dialog", { name: "Szybki wpis" });
    await expect(arkusz).toBeVisible();
    await page.getByRole("button", { name: "Zamknij" }).click();
    await expect(arkusz).toHaveCount(0);
  });
});
