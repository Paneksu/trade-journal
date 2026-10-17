import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";

/*
 * UI v2, etap 2: Mózg (kolejka „Do decyzji”, listy, notatka z backlinkami, edytor z [[, poprawka słów
 * z rewizją, korekta interpretacji AI, profil) i Playbook (lista, karta setupu). Dane testowe wstawiamy
 * SQL-em na LOKALNEJ bazie (znacznik RUN) i sprzątamy po sobie. Dostępność: axe przy 1440 i 375.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const AXE_TAGI = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe.configure({ mode: "serial" });

async function axe(page: Page, opis: string) {
  await page.waitForLoadState("networkidle");
  const wynik = await new AxeBuilder({ page }).withTags(AXE_TAGI).analyze();
  // 17.10.2026: przy 375 px dolny pasek (position: fixed, decyzja 22 w kierunek.md: zostaje) przykrywa to, co lezy tuz przy dolnej
  // krawedzi pierwszego ekranu, a axe liczy wtedy cel dotyku jako zasloniety. Taki cel przewijamy na srodek ekranu i sprawdzamy ponownie
  // TYLKO regule target-size: element naprawde za maly albo przykryty czymkolwiek innym niz pasek nadal jest bledem.
  const bledy: string[] = [];
  for (const v of wynik.violations) {
    if (v.id !== "target-size") {
      bledy.push(`${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} el. [${v.nodes[0]?.target.join(" ")}] ${v.nodes[0]?.html.slice(0, 160)}`);
      continue;
    }
    for (const n of v.nodes) {
      const sel = String(n.target[0]);
      await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), sel);
      const ponownie = await new AxeBuilder({ page }).include(sel).withRules(["target-size"]).analyze();
      if (ponownie.violations.length > 0) bledy.push(`${v.id} (${v.impact}): ${v.help} — [${sel}] ${n.html.slice(0, 160)}`);
    }
  }
  expect(bledy, `${opis}\n${bledy.join("\n")}`).toEqual([]);
}

test.describe("UI v2: Mózg i Playbook", () => {
  let sql: ReturnType<typeof postgres>;
  let notaA = 0;
  let slowaId = 0;
  let regulaId = 0;
  let wersjaId = 0;
  let setupId = 0;
  const TYTUL_A = `E2E pojęcie ${RUN}`;
  const TYTUL_B = `E2E notatka z linkiem ${RUN}`;
  const SLUG = `e2e-setup-${RUN}`;

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      const [a] = await tx`insert into notes (kind, slug, title, body_md, origin) values ('concept', ${`e2e-pojecie-${RUN}`}, ${TYTUL_A}, ${"Treść **pojęcia** <b>bez HTML</b>."}, 'user') returning id`;
      notaA = a.id;
      const [w] = await tx`insert into user_words (text, source, role, note_id, captured_at, ai_interpretation, interpretation_model, interpretation_at)
        values (${`Mój „czysty” FVG ${RUN} 🙂\nwejście na CE`}, 'chat', 'note.body', ${notaA}, now(), ${"Interpretacja do poprawy."}, 'claude-opus', now()) returning id`;
      slowaId = w.id;
      const [rn] = await tx`insert into notes (kind, slug, title, body_md, origin) values ('rule', ${`e2e-r-${RUN}`}, ${`E2E reguła ${RUN}`}, 'propozycja', 'mentor') returning id`;
      const [r] = await tx`insert into rules (code, note_id) values (${`R-9${String(Date.now()).slice(-5)}`}, ${rn.id}) returning id`;
      regulaId = r.id;
      const [v] = await tx`insert into rule_versions (rule_id, version, text_md, status, origin, counterargument, evidence)
        values (${regulaId}, 1, ${`Treść reguły ${RUN}`}, 'proposed', 'mentor', ${`Kontrargument ${RUN}`}, ${tx.json([{ type: "quote", note: `Cytat mentora ${RUN}` }] as never)}) returning id`;
      wersjaId = v.id;
      const [sn] = await tx`insert into notes (kind, slug, title, body_md) values ('setup', ${SLUG}, ${`E2E setup ${RUN}`}, 'Karta setupu e2e.') returning id`;
      const [s] = await tx`insert into setups (slug, name, note_id) values (${SLUG}, ${`E2E setup ${RUN}`}, ${sn.id}) returning id`;
      setupId = s.id;
      await tx`insert into setup_versions (setup_id, version, status, preconditions, entry_checklist, stop_rule, thresholds, origin, decided_at)
        values (${setupId}, 1, 'approved', ${tx.json([{ id: "p", text: `Warunek ${RUN}` }] as never)}, ${tx.json([{ id: "c", text: "świeca zamknięta" }] as never)}, 'za knotem', '{}', 'user', now())`;
    });
  });

  test.afterAll(async () => {
    if (!sql) return;
    const ciche = (p: Promise<unknown>) => p.catch(() => undefined);
    await ciche(sql`delete from interpretation_corrections where words_id = ${slowaId}`);
    await ciche(sql`delete from ai_suggestions where kind = 'profile_term' and claim like ${`%${RUN}%`}`);
    await ciche(sql`delete from user_words where note_id in (select id from notes where title like ${`%${RUN}%`}) and supersedes_id is not null`);
    await ciche(sql`delete from user_words where note_id in (select id from notes where title like ${`%${RUN}%`})`);
    await ciche(sql`delete from setup_versions where setup_id = ${setupId}`);
    await ciche(sql`delete from setups where id = ${setupId}`);
    await ciche(sql`delete from rule_versions where rule_id = ${regulaId}`);
    await ciche(sql`delete from rules where id = ${regulaId}`);
    await ciche(sql`delete from note_links where from_note_id in (select id from notes where title like ${`%${RUN}%`})`);
    await ciche(sql`delete from notes where title like ${`%${RUN}%`}`);
    await sql.end();
  });

  test("Do decyzji: jedna pozycja z licznikiem, kontrargument i dowody; odrzucenie z powodem zapisuje się jako decyzja", async ({ page }) => {
    await page.goto(`/decyzje?poz=r-${wersjaId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Do decyzji" })).toBeVisible();
    await expect(page.getByRole("heading", { name: new RegExp(`E2E reguła ${RUN}`) })).toBeVisible();
    await expect(page.getByText(/^\d+ \/ \d+$/)).toBeVisible();
    await expect(page.getByText(`Kontrargument ${RUN}`)).toBeVisible();
    await expect(page.getByText(`Cytat mentora ${RUN}`)).toBeVisible();
    await page.getByLabel("Powód odrzucenia").fill(`Odrzucam w teście ${RUN}`);
    await page.getByRole("button", { name: "Odrzuć z powodem" }).click();
    await expect.poll(async () => (await sql`select status from rule_versions where id = ${wersjaId}`)[0].status).toBe("rejected");
  });

  test("Mózg: zakładki widoków, filtr reguł, przejście do notatki", async ({ page }) => {
    await page.goto("/mozg");
    await expect(page.getByRole("heading", { level: 1, name: "Mózg" })).toBeVisible();
    await page.getByRole("navigation", { name: "Widoki Mózgu" }).getByRole("link", { name: /Pojęcia ICT/ }).click();
    await expect(page).toHaveURL(/widok=pojecia/);
    await page.getByRole("link", { name: new RegExp(TYTUL_A) }).click();
    await expect(page.getByRole("heading", { level: 1, name: TYTUL_A })).toBeVisible();
    // Markdown bez surowego HTML: znacznik widać jako tekst, element <b> nie powstaje.
    await expect(page.getByText("<b>bez HTML</b>")).toBeVisible();
    expect(await page.locator("main b").count()).toBe(0);
  });

  test("edytor: nowa notatka z [[ i podpowiedzią tytułu; backlink pojawia się w notatce docelowej", async ({ page }) => {
    await page.goto("/mozg/notatki/nowa");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Tytuł").fill(TYTUL_B);
    const tresc = page.getByLabel(/Treść/);
    await tresc.click();
    await tresc.pressSequentially(`Zobacz [[E2E pojęcie ${RUN.slice(0, 3)}`);
    const podpowiedz = page.getByRole("option", { name: TYTUL_A });
    await expect(podpowiedz).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(tresc).toHaveValue(`Zobacz [[${TYTUL_A}]]`);
    await page.getByRole("button", { name: "Podgląd" }).click();
    await expect(page.getByRole("link", { name: TYTUL_A })).toBeVisible();
    await page.getByRole("button", { name: "Zapisz" }).click();
    await expect(page.getByRole("heading", { level: 1, name: TYTUL_B })).toBeVisible();
    await page.goto(`/mozg/notatki/${notaA}`);
    await expect(page.getByRole("complementary", { name: "Linki" }).getByRole("link", { name: TYTUL_B })).toBeVisible();
  });

  test("słowa użytkownika: poprawka tworzy rewizję (stary wiersz zostaje), korekta interpretacji trafia do rejestru", async ({ page }) => {
    await page.goto(`/mozg/notatki/${notaA}`);
    await page.waitForLoadState("networkidle");
    await page.getByText("Popraw słowa").click();
    const nowe = `Poprawione słowa ${RUN}`;
    await page.getByLabel("Nowa wersja (stara zostaje w historii)").fill(nowe);
    await page.getByRole("button", { name: "Zapisz rewizję" }).click();
    // Po zapisie strona przeładowuje dane: wpis zastępuje nowa rewizja (stary formularz znika razem z komunikatem).
    await expect(page.locator("blockquote").filter({ hasText: nowe })).toBeVisible();
    const [w] = await sql`select text, supersedes_id from user_words where supersedes_id = ${slowaId}`;
    expect(w).toEqual({ text: nowe, supersedes_id: slowaId });
    const [stary] = await sql`select text from user_words where id = ${slowaId}`;
    expect(stary.text).toBe(`Mój „czysty” FVG ${RUN} 🙂\nwejście na CE`);

    await page.reload();
    await expect(page.locator("blockquote").filter({ hasText: nowe })).toBeVisible();
    await expect(page.getByText(/rewizja 2/)).toBeVisible();

    // Korekta interpretacji: słowa ze starego wiersza mają interpretację, nowy (rewizja) jej nie ma, więc korygujemy przez SQL-owy stan wyjściowy.
    await sql`update user_words set ai_interpretation = 'Interpretacja rewizji do poprawy.', interpretation_model = 'claude-opus', interpretation_at = now() where supersedes_id = ${slowaId}`;
    await page.reload();
    await page.getByText("Popraw interpretację AI").click();
    await page.getByLabel("O co Ci chodziło (zapisane dosłownie)").fill(`Nie, chodziło mi o świecę 2 ${RUN}`);
    await page.getByLabel("Poprawiona interpretacja").fill(`Interpretacja po poprawce ${RUN}`);
    await page.getByRole("button", { name: "Zapisz poprawkę" }).click();
    await expect(page.getByRole("status").last()).toContainText("poprawkę");
    const [k] = await sql`select after_interpretation from interpretation_corrections c join user_words w on w.id = c.words_id where w.supersedes_id = ${slowaId}`;
    expect(k.after_interpretation).toBe(`Interpretacja po poprawce ${RUN}`);
    await page.goto("/mozg/profil");
    await expect(page.getByText(`Interpretacja po poprawce ${RUN}`)).toBeVisible();
  });

  test("Playbook: lista i karta setupu z zakładkami", async ({ page }) => {
    await page.goto("/playbook");
    await page.getByRole("link", { name: new RegExp(`E2E setup ${RUN}`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: `E2E setup ${RUN}` })).toBeVisible();
    await expect(page.getByText(`Warunek ${RUN}`)).toBeVisible();
    await page.getByRole("navigation", { name: "Zakładki karty" }).getByRole("link", { name: "Historia" }).click();
    await expect(page.getByText(/wersja 1 · obowiązuje/)).toBeVisible();
  });

  test("Ctrl+K: notatka w wynikach jest klikalna", async ({ page }) => {
    await page.goto("/mozg");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Szukaj w dzienniku" }).fill(TYTUL_A);
    await page.getByRole("option").filter({ hasText: TYTUL_A }).first().click();
    await expect(page).toHaveURL(new RegExp(`/mozg/notatki/${notaA}`));
  });

  for (const [szer, wys] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`dostępność Mózgu i Playbooka przy ${szer}px`, async ({ page }) => {
      await page.setViewportSize({ width: szer, height: wys });
      const adresy = [
        "/decyzje",
        ...["reguly", "hipotezy", "pojecia", "system", "wzorce", "nauka", "decyzje", "luki"].map((w) => `/mozg?widok=${w}`),
        "/mozg/profil",
        `/mozg/notatki/${notaA}`,
        `/mozg/notatki/${notaA}?tryb=edycja`,
        "/mozg/notatki/nowa",
        "/playbook",
        `/playbook/${SLUG}`,
        `/playbook/${SLUG}?zakladka=statystyka`,
        `/playbook/${SLUG}?zakladka=historia`,
      ];
      for (const adres of adresy) {
        await page.goto(adres);
        await axe(page, `${adres} @ ${szer}`);
        if (szer === 375) {
          const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
          expect(sw, `${adres}: poziome przewijanie przy 375 px`).toBeLessThanOrEqual(cw);
        }
      }
    });
  }
});
