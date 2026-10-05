import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

/*
 * Interfejs ocen AI (ADR-026 do 028): karta trade'a, filtry, panel zgodnosci,
 * faza prop przy koncie i rodzaj sesji. Dane wstawiamy SQL-em prosto do bazy
 * LOKALNEJ (DATABASE_URL, ta sama, z ktora wstal serwer) - trade'y z API
 * dostaja tu prawdziwe wiersze, bez tokenu. Dowodem zapisu jest odczyt z bazy.
 *
 * Wszystko, co wstawiamy, ma w nazwie albo kluczu "e2e-ocena" i znika po
 * tescie (takze pozostalosci po przerwanych przebiegach). Trady maja daty z
 * 1992 roku, zeby nie wchodzic w droge testom klikajacym "pierwszy wiersz".
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const NAZWA_KONTA = "E2E ocena konto";
const PREFIKS_REF = "tv:e2e-ocena";

function dbLokalna(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

const AXE_TAGI = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe.configure({ mode: "serial" });

test.describe("ocena AI w interfejsie", () => {
  let sql: ReturnType<typeof postgres>;
  let kontoId: number;
  let tradeZgodny: number; // pass + pass, +2R, dwie oceny (wykres nowszy, historia starsza)
  let tradeNiezgodny: number; // fail na E2E-R1, -1R, tylko wykres
  let tradeBezOceny: number; // z API, bez oceny

  async function posprzataj() {
    await sql`delete from trades where external_ref like ${PREFIKS_REF + "%"}`;
    await sql`delete from backtest_sessions where name like 'E2E ocena%'`;
    await sql`delete from accounts where name like ${NAZWA_KONTA + "%"}`;
  }

  async function wstawTrade(nr: number, r: number, dzien: string): Promise<number> {
    const pnl = Math.round(r * 40000);
    const [w] = await sql`
      insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts,
                          stop_loss, take_profit, exit_time, exit_price, pnl, risk_amount, r_multiple,
                          trading_day, market_session, exit_count, closed_contracts, source, external_ref, ingested_at)
      values (${kontoId}, 1, 'long', 'closed', ${dzien + "T14:35:00Z"}, 20000, 2,
              19990, 20020, ${dzien + "T14:45:00Z"}, ${r > 0 ? 20020 : 19990}, ${pnl}, 40000, ${r},
              ${dzien}, 'rth', 1, 2, 'tradingview', ${`${PREFIKS_REF}-${nr}`}, now())
      returning id`;
    return w.id as number;
  }

  async function wstawOcene(
    tradeId: number,
    basis: "chart" | "history",
    przesuniecieMin: number,
    reguly: [string, string, "pass" | "fail" | "na" | "unclear", string][],
    nadpisz: { summary?: string } = {},
  ) {
    const [o] = await sql`
      insert into trade_reviews (trade_id, basis, setup_type, summary_md, lesson, brain_verdict, brain_plan, brain_version, model, created_at)
      values (${tradeId}, ${basis}, 'FVG po sweepie',
              ${nadpisz.summary ?? "Wszedłem 4 ticki niżej niż plan.\n<b>Pogrubienie</b> ma zostać tekstem."},
              'Czekaj na zamknięcie świecy.', 'wejdz',
              ${sql.json({ entry: 20000, stopLoss: 19990, takeProfit: 20020, interwalWejscia: "5m", interwalyKontekstu: ["1h", "15m"] })},
              'abcdef1234567890', 'e2e',
              now() - ${przesuniecieMin} * interval '1 minute')
      returning id`;
    for (const [id, tekst, werdykt, dowod] of reguly) {
      await sql`insert into trade_rule_checks (review_id, rule_id, rule_text, verdict, evidence)
                values (${o.id}, ${id}, ${tekst}, ${werdykt}, ${dowod})`;
    }
  }

  test.beforeAll(async () => {
    if (!dbLokalna(DB_URL)) {
      throw new Error(
        `DATABASE_URL (${DB_URL.replace(/:[^:@/]*@/, ":***@") || "brak"}) nie wskazuje na bazę lokalną - testy wstawiają dane do bazy i nie wolno ich puszczać na produkcji.`,
      );
    }
    sql = postgres(DB_URL, { max: 2 });
    await posprzataj();

    const [k] = await sql`insert into accounts (name, type, prop_phase, currency, starting_balance)
                          values (${NAZWA_KONTA}, 'prop', 'eval', 'USD', 5000000) returning id`;
    kontoId = k.id;

    tradeZgodny = await wstawTrade(1, 2, "1992-03-10");
    tradeNiezgodny = await wstawTrade(2, -1, "1992-03-11");
    tradeBezOceny = await wstawTrade(3, 1, "1992-03-12");

    await wstawOcene(tradeZgodny, "chart", 0, [
      ["E2E-R1", "Wejście tylko po sweepie płynności.", "pass", "Sweep na 19995 o 14:31."],
      ["E2E-R2", "Stop za swingiem.", "pass", "Stop 19990 poniżej swingu 19992."],
    ]);
    await wstawOcene(tradeZgodny, "history", 60, [
      ["E2E-R1", "Wejście tylko po sweepie płynności.", "pass", "Potwierdzone po fakcie."],
    ]);
    await wstawOcene(tradeNiezgodny, "chart", 0, [
      ["E2E-R1", "Wejście tylko po sweepie płynności.", "fail", "Wejście bez sweepu."],
      ["E2E-R3", "Brak wejść w pierwszych 5 minutach sesji.", "na", "Wejście o 14:35."],
    ]);
  });

  test.afterAll(async () => {
    if (!sql) return;
    await posprzataj();
    await sql.end();
  });

  test("karta trade'a: plakietka źródła, plan mózgu obok planu użytkownika i tekst AI jako tekst", async ({ page }) => {
    await page.goto(`/trades/${tradeZgodny}`);
    await expect(page.getByText("TradingView", { exact: true })).toBeVisible();
    await expect(page.getByText("Prop: ocena", { exact: true })).toBeVisible();

    const caly = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Ocena AI" }) });
    // Najnowsza ocena (rozwinięta); starsza siedzi w <details>.
    const panel = caly.locator("div.space-y-4").first();
    await expect(panel.getByText("Wejdź", { exact: true })).toBeVisible();
    await expect(panel.getByText("Mózg radził wejść, wszedłeś.")).toBeVisible();
    await expect(panel.getByText("Z wykresu, przed wynikiem").first()).toBeVisible();
    await expect(panel.getByText("FVG po sweepie")).toBeVisible();
    await expect(panel.getByText("wersja mózgu abcdef12")).toBeVisible();

    // Plan mózgu obok ceny użytkownika, różnica w tickach (20000 = 20000, SL i TP bez różnicy).
    const wiersz = panel.getByRole("row", { name: /Wejście/ }).first();
    await expect(wiersz).toContainText("20 000,00");

    // Tekst AI to zwykły tekst: znaczniki widać dosłownie i nie powstał element <b>.
    await expect(panel.getByText("<b>Pogrubienie</b> ma zostać tekstem.")).toBeVisible();
    expect(await panel.locator("b").count()).toBe(0);

    // Reguły z dowodami i lekcja.
    await expect(panel.getByRole("listitem").filter({ hasText: "E2E-R1" })).toContainText("Sweep na 19995 o 14:31.");
    await expect(panel.getByText("Czekaj na zamknięcie świecy.")).toBeVisible();

    // Starsza ocena (po fakcie) zwinięta.
    const starsza = caly.locator("details");
    await expect(starsza).toHaveCount(1);
    await expect(starsza).not.toHaveAttribute("open", "");
    await starsza.locator("summary").click();
    await expect(starsza.getByText("Potwierdzone po fakcie.")).toBeVisible();
  });

  test("trade z API bez oceny pokazuje pusty stan, a ręczny trade bez oceny nie ma panelu", async ({ page }) => {
    await page.goto(`/trades/${tradeBezOceny}`);
    await expect(page.getByText("Ten trade nie ma jeszcze oceny.")).toBeVisible();

    const [reczny] = await sql`select id from trades where source = 'form' and external_ref is null limit 1`;
    test.skip(!reczny, "baza nie ma trade'a z formularza");
    await page.goto(`/trades/${reczny.id}`);
    await expect(page.getByRole("heading", { name: "Ocena AI" })).toHaveCount(0);
  });

  test("zgadzam się / nie zgadzam się zapisuje zdanie w bazie, ponowny klik je cofa", async ({ page }) => {
    await page.goto(`/trades/${tradeNiezgodny}`);
    const zgadzam = page.getByRole("button", { name: "Zgadzam się: reguła E2E-R1", exact: true });
    const nie = page.getByRole("button", { name: "Nie zgadzam się: reguła E2E-R1", exact: true });
    const odczyt = async () =>
      (
        await sql`select c.user_verdict from trade_rule_checks c join trade_reviews r on r.id = c.review_id
                  where r.trade_id = ${tradeNiezgodny} and c.rule_id = 'E2E-R1'`
      )[0].user_verdict as string | null;

    await zgadzam.click();
    await expect(zgadzam).toHaveAttribute("aria-pressed", "true");
    await expect.poll(odczyt).toBe("agree");

    await nie.click();
    await expect(nie).toHaveAttribute("aria-pressed", "true");
    await expect(zgadzam).toHaveAttribute("aria-pressed", "false");
    await expect.poll(odczyt).toBe("disagree");

    await nie.click();
    await expect(nie).toHaveAttribute("aria-pressed", "false");
    await expect.poll(odczyt).toBeNull();

    // Po odświeżeniu stan pochodzi z bazy.
    await zgadzam.click();
    await expect.poll(odczyt).toBe("agree");
    await page.reload();
    await expect(page.getByRole("button", { name: "Zgadzam się: reguła E2E-R1", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("filtry: kategoria, zgodność, reguła i werdykt zawężają listę", async ({ page }) => {
    const wierszeTradow = async (query: string) => {
      await page.goto(`/trades?konto=${kontoId}&${query}`);
      await page.waitForLoadState("networkidle");
      return page.locator(`a[href^="/trades/"]`).evaluateAll((a) =>
        a.map((x) => Number((x as HTMLAnchorElement).getAttribute("href")!.split("/")[2])).filter(Number.isInteger),
      );
    };

    const wszystkie = await wierszeTradow("kategoria=prop_eval");
    expect(wszystkie).toEqual(expect.arrayContaining([tradeZgodny, tradeNiezgodny, tradeBezOceny]));

    expect(await wierszeTradow("kategoria=prop_funded")).not.toEqual(expect.arrayContaining([tradeZgodny]));
    expect(await wierszeTradow("zgodnosc=niezgodne")).toEqual(expect.arrayContaining([tradeNiezgodny]));
    expect(await wierszeTradow("zgodnosc=niezgodne")).not.toEqual(expect.arrayContaining([tradeZgodny, tradeBezOceny]));
    expect(await wierszeTradow("zgodnosc=zgodne")).toEqual(expect.arrayContaining([tradeZgodny]));
    expect(await wierszeTradow("zgodnosc=zgodne")).not.toEqual(expect.arrayContaining([tradeNiezgodny, tradeBezOceny]));
    expect(await wierszeTradow("zgodnosc=nieocenione")).toEqual(expect.arrayContaining([tradeBezOceny]));
    expect(await wierszeTradow("regula=E2E-R1&werdykt=fail")).toEqual([tradeNiezgodny]);
  });

  test("pasek filtrów ma kategorię, zgodność i regułę; zastosowanie trafia do adresu", async ({ page }) => {
    await page.goto(`/trades?konto=${kontoId}`);
    // Z aktywnym filtrem konta panel startuje rozwinięty - przełącznik tylko, gdy zwinięty.
    const przelacznik = page.getByRole("button", { name: /Filtry/ });
    if ((await przelacznik.getAttribute("aria-expanded")) !== "true") await przelacznik.click();
    await page.getByText("Prop: ocena", { exact: true }).click();
    await page.getByLabel("Zgodność z regułami").selectOption("niezgodne");
    await page.getByLabel("Reguła", { exact: true }).fill("E2E-R1");
    await page.getByLabel("Werdykt reguły").selectOption("fail");
    await page.getByRole("button", { name: "Zastosuj" }).click();
    await expect(page).toHaveURL(/kategoria=prop_eval/);
    await expect(page).toHaveURL(/zgodnosc=niezgodne/);
    await expect(page).toHaveURL(/regula=E2E-R1/);
    await expect(page).toHaveURL(/werdykt=fail/);
  });

  test("przełącznik źródła zna forward", async ({ page }) => {
    await page.goto("/trades?zrodlo=forward");
    const link = page.getByRole("group", { name: "Źródło danych" }).getByRole("link", { name: "forward" });
    await expect(link).toHaveAttribute("aria-current", "true");
    await page.goto("/galeria?zrodlo=forward");
    await expect(
      page.getByRole("group", { name: "Źródło danych" }).getByRole("link", { name: "forward" }),
    ).toHaveAttribute("aria-current", "true");
  });

  test("statystyki: panel zgodności z uczciwym mianownikiem, R i linkiem do złamanej reguły", async ({ page }) => {
    await page.goto(`/stats?konto=${kontoId}&kategoria=prop_eval&od=1992-03-01&do=1992-03-31`);
    const panel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Zgodność z regułami" }) });
    await expect(panel).toBeVisible();

    // 2 ocenione trady (1 zgodny, 1 z odstępstwem) = 50%, trade bez oceny poza procentem.
    await expect(panel.getByText(/50,0\s%/).first()).toBeVisible();
    await expect(panel.getByText("1 z 2").first()).toBeVisible();
    await expect(panel.getByText("1 trade", { exact: false }).first()).toBeVisible();
    await expect(panel.getByText("poza procentem")).toBeVisible();

    // R: zgodny +2R, z odstępstwem -1R.
    await expect(panel.getByText("+2.00R").first()).toBeVisible();
    await expect(panel.getByText("−1.00R").first()).toBeVisible();

    // Najczęściej łamana reguła i link do listy.
    const link = panel.getByRole("link", { name: /Pokaż trade'y ze złamaną regułą E2E-R1/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /regula=E2E-R1/);
    await expect(link).toHaveAttribute("href", /werdykt=fail/);
    await link.click();
    await expect(page).toHaveURL(/\/trades\?/);
    await expect(page.locator(`a[href="/trades/${tradeNiezgodny}"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/trades/${tradeZgodny}"]`)).toHaveCount(0);
  });

  test("statystyki: przełącznik podstawy oceny", async ({ page }) => {
    await page.goto(`/stats?konto=${kontoId}&kategoria=prop_eval&podstawa=history`);
    await expect(
      page.getByRole("group", { name: "Podstawa oceny AI" }).getByRole("link", { name: "po fakcie" }),
    ).toHaveAttribute("aria-current", "true");
    // Z samej historii oceniony jest tylko trade zgodny (jedna reguła).
    const panel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Zgodność z regułami" }) });
    await expect(panel.getByText("1 z 1").first()).toBeVisible();
  });

  test("ustawienia: faza prop widoczna tylko dla konta prop i zapisuje się w bazie", async ({ page }) => {
    await page.goto("/settings/accounts");
    const sekcja = page
      .locator("section.panel")
      .filter({ has: page.getByRole("heading", { name: NAZWA_KONTA }) });
    const faza = sekcja.getByLabel("Faza konta prop");
    await expect(faza).toHaveValue("eval");

    await faza.selectOption("funded");
    await sekcja.getByRole("button", { name: /Zapisz/ }).click();
    await expect(sekcja.getByText("Zapisano konto.")).toBeVisible();
    const [po] = await sql`select prop_phase from accounts where id = ${kontoId}`;
    expect(po.prop_phase).toBe("funded");

    // Zmiana typu chowa pole, a zapis czyści fazę (CHECK w bazie trzyma ją tylko przy prop).
    await sekcja.getByLabel("Typ").selectOption("demo");
    await expect(sekcja.getByLabel("Faza konta prop")).toHaveCount(0);
    await sekcja.getByRole("button", { name: /Zapisz/ }).click();
    await expect(sekcja.getByText("Zapisano konto.")).toBeVisible();
    // Komunikat "Zapisano" z poprzedniego zapisu wisi dalej, więc czekamy na bazę, nie na komunikat.
    const konto = async () =>
      (await sql`select type::text as type, prop_phase from accounts where id = ${kontoId}`)[0];
    await expect.poll(konto).toMatchObject({ type: "demo", prop_phase: null });

    // Powrót do prop bez wybranej fazy jest dozwolony, konto nie należy wtedy do żadnej kategorii.
    await sekcja.getByLabel("Typ").selectOption("prop");
    await expect(sekcja.getByLabel("Faza konta prop")).toHaveValue("");
    await sekcja.getByLabel("Faza konta prop").selectOption("eval");
    await sekcja.getByRole("button", { name: /Zapisz/ }).click();
    await expect(sekcja.getByText("Zapisano konto.")).toBeVisible();
    await expect.poll(konto).toMatchObject({ type: "prop", prop_phase: "eval" });
  });

  test("sesja forward: rodzaj w formularzu, plakietka na liście, kategoria nie dotyczy", async ({ page }) => {
    await page.goto("/backtest");
    await page.getByRole("button", { name: "Nowa sesja backtestu" }).click();
    await page.locator("#name").fill("E2E ocena sesja forward");
    await page.getByLabel("Rodzaj sesji").selectOption("forward");
    await page.getByRole("button", { name: "Utwórz sesję" }).click();
    await expect(page).toHaveURL(/\/backtest\/\d+$/);
    const [s] = await sql`select kind from backtest_sessions where name = 'E2E ocena sesja forward'`;
    expect(s.kind).toBe("forward");

    await page.goto("/backtest");
    const karta = page.getByRole("link", { name: /E2E ocena sesja forward/ });
    await expect(karta.getByText("forward", { exact: true })).toBeVisible();
  });

  test("dostępność: karta trade'a z oceną i statystyki z panelem zgodności", async ({ page }) => {
    for (const adres of [
      `/trades/${tradeZgodny}`,
      `/trades/${tradeNiezgodny}`,
      `/stats?konto=${kontoId}&kategoria=prop_eval&od=1992-03-01&do=1992-03-31`,
      "/settings/accounts",
      "/backtest",
    ]) {
      await page.goto(adres);
      await page.waitForLoadState("networkidle");
      if (adres.startsWith(`/trades/${tradeZgodny}`)) {
        await page.locator("details > summary").first().click();
      }
      const wynik = await new AxeBuilder({ page }).withTags(AXE_TAGI).analyze();
      const opis = wynik.violations.map(
        (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el.: ${v.nodes.map((n) => `${n.target} ${n.any[0]?.message ?? ""}`).join(" | ")}`,
      );
      expect(opis, `${adres}\n${opis.join("\n")}`).toEqual([]);
    }
  });

  test("zrzuty ekranu do przeglądu", async ({ page }) => {
    test.skip(!process.env.E2E_ZRZUTY, "ustaw E2E_ZRZUTY=katalog, żeby zapisać zrzuty");
    const katalog = process.env.E2E_ZRZUTY as string;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/trades/${tradeZgodny}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${katalog}/karta-z-ocena-1440.png`, fullPage: true });
    await page.goto(`/stats?konto=${kontoId}&kategoria=prop_eval&od=1992-03-01&do=1992-03-31`);
    await page.waitForLoadState("networkidle");
    await page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Zgodność z regułami" }) }).screenshot({ path: `${katalog}/panel-zgodnosci-1440.png` });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/trades/${tradeZgodny}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${katalog}/karta-z-ocena-375.png`, fullPage: true });
  });
});
