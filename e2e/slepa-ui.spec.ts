import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";

/*
 * Ślepa ocena w UI (blokery code review fazy 5, 16.10.2026). Otwarty trade z wyjściem częściowym, werdyktem AI
 * i notatką dnia „Po sesji” zapisaną po wejściu. Pobieramy ekrany z nagłówkiem `RSC: 1` (ładunek komponentów
 * serwera, który dostaje przeglądarka przy nawigacji) i bez niego (HTML). W żadnej odpowiedzi nie może być kwoty
 * wyniku, R, tekstu notatki dnia ani tytułu notatki z dnia po wejściu.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const DZIEN = "2016-02-09";
const PNL = 77_777; // 777,77 USD z wyjścia częściowego
const SEKRET_NOTATKI = `Po sesji tajne ${RUN}`;
const SEKRET_TYTUL = `Tytuł po wejściu ${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Ślepa ocena: wynik i treści po wejściu nie wychodzą w HTML ani RSC", () => {
  let sql: ReturnType<typeof postgres>;
  let kontoId = 0;
  let tradeId = 0;
  let notatkaId = 0;
  let notaDniaId = 0;

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    const [i] = await sql`select id from instruments where symbol = 'NQ' limit 1`;
    const [k] = await sql`insert into accounts (name, type, sort_order) values (${`E2E ślepa ${RUN}`}, 'live', 999) returning id`;
    kontoId = k.id;
    const [t] = await sql`
      insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, stop_loss, take_profit,
                          pnl, risk_amount, r_multiple, trading_day, market_session, exit_count, closed_contracts, source)
      values (${kontoId}, ${i.id}, 'long', 'open', ${`${DZIEN}T14:45:00Z`}, 20000, 2, 19990, 20040,
              ${PNL}, 40000, 1.9444, ${DZIEN}, 'rth', 1, 1, 'tradingview')
      returning id`;
    tradeId = t.id;
    await sql.begin(async (tx) => {
      const [r] = await tx`
        insert into trade_reviews (trade_id, setup_type, summary_md, basis, brain_verdict, model, kind, as_of, evidence_hash, evidence_cutoff)
        values (${tradeId}, 'FVG po sweepie', 'Uzasadnienie', 'chart', 'wejdz', 'claude-opus-4', 'ai',
                ${`${DZIEN}T14:40:00Z`}, ${createHash("sha256").update(RUN).digest("hex")}, ${`${DZIEN}T14:40:00Z`})
        returning id`;
      await tx`insert into trade_rule_checks (review_id, rule_id, rule_text, verdict, evidence) values (${r.id}, 'E2E-S', 'Bias', 'pass', 'Dowód')`;
    });
    // Notatka dnia zapisana teraz, czyli po wejściu: jej treść jest ukryta.
    await sql`delete from day_notes where day = ${DZIEN} and backtest_session_id is null`;
    const [d] = await sql`insert into day_notes (day, account_id, post_session) values (${DZIEN}, null, ${SEKRET_NOTATKI}) returning id`;
    notaDniaId = d.id;
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      const [n] = await tx`insert into notes (kind, slug, title, body_md, origin, day) values ('concept', ${`e2e-slepa-${RUN}`}, ${SEKRET_TYTUL}, 'x', 'user', ${DZIEN}) returning id`;
      notatkaId = n.id;
    });
  });

  test.afterAll(async () => {
    if (!sql) return;
    const ciche = (p: Promise<unknown>) => p.catch(() => undefined);
    await ciche(sql`delete from trade_rule_checks where review_id in (select id from trade_reviews where trade_id = ${tradeId})`);
    await ciche(sql`delete from trade_reviews where trade_id = ${tradeId}`);
    await ciche(sql`delete from trades where id = ${tradeId}`);
    await ciche(sql`delete from day_notes where id = ${notaDniaId}`);
    await ciche(sql`delete from note_revisions where note_id = ${notatkaId}`);
    await ciche(sql`delete from notes where id = ${notatkaId}`);
    await ciche(sql`delete from accounts where id = ${kontoId}`);
    await sql.end();
  });

  test("kalendarz, księga, galeria, nowa notatka i edycja: bez kwoty, R i treści po wejściu", async ({ page }) => {
    test.setTimeout(180_000);
    const adresy = [
      `/calendar?miesiac=2016-02&dzien=${DZIEN}`,
      `/trades?od=${DZIEN}&do=${DZIEN}`,
      `/galeria?zezrzutem=wszystko&zrodlo=wszystko&od=${DZIEN}&do=${DZIEN}`,
      "/mozg/notatki/nowa",
      `/trades/${tradeId}/edit`,
    ];
    const zakazane = ["777,77", "777.77", "77777", "1.94R", "1,94R", "1.9444", SEKRET_NOTATKI, SEKRET_TYTUL];
    // Zbieramy wszystkie wycieki naraz, żeby czerwony przebieg pokazał pełną listę, a nie tylko pierwszy.
    const wycieki: string[] = [];
    for (const adres of adresy) {
      for (const naglowki of [{}, { RSC: "1" }] as Record<string, string>[]) {
        const odp = await page.request.get(adres, { headers: naglowki });
        expect(odp.status(), `${adres} ${JSON.stringify(naglowki)}`).toBe(200);
        const tresc = await odp.text();
        for (const z of zakazane) if (tresc.includes(z)) wycieki.push(`${adres} ${"RSC" in naglowki ? "RSC" : "HTML"}: „${z}”`);
      }
    }
    expect(wycieki).toEqual([]);
    // Ekran edycji mówi wprost, dlaczego jest zablokowany, a karta trade'a nie ma linku „Edytuj”.
    await page.goto(`/trades/${tradeId}/edit`);
    await expect(page.getByRole("heading", { level: 1, name: "Edycja zablokowana" })).toBeVisible();
    await page.goto(`/trades/${tradeId}`);
    await expect(page.getByRole("link", { name: "Edytuj" })).toHaveCount(0);
    // Kalendarz: panel notatki dnia zablokowany, bez formularza.
    await page.goto(`/calendar?miesiac=2016-02&dzien=${DZIEN}`);
    await expect(page.locator("[data-zablokowany-dzien]")).toBeVisible();
    await expect(page.locator("#postSession")).toHaveCount(0);
  });
});
