import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, request as pwRequest, test } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";

/*
 * Dane z rachunku (ADR-034, etap A) przeciw zywej aplikacji z LOKALNA baza. Dowodem zapisu jest odczyt z bazy po zapisie.
 * Fiksture (zmyslone wartosci, konto TST00000000001) bierzemy z repo; prawdziwych plikow uzytkownika tu nie ma.
 *
 *  1. import reczny: podglad niczego nie zapisuje, »Zapisz import« zapisuje, »Cofnij import« zeruje;
 *  2. ukrycie wyniku: trade z ukrytym wynikiem nie wypuszcza kwot z rachunku w HTML ani w RSC;
 *  3. automat: plik wyslany tokenem import_broker dopasowuje trade 1:1 bez klikniecia, a »Cofnij« zdejmuje dopasowanie.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const FIKSTURY = path.join(process.cwd(), "src", "lib", "domain", "brokerzy", "fixtures");
const ORDERS = readFileSync(path.join(FIKSTURY, "tradovate-orders.csv"), "utf8");
const DZIEN = "2026-10-14";

test.describe.configure({ mode: "serial" });

test.describe("Dane z rachunku: import, ukrycie wyniku, automat 1:1", () => {
  let sql: ReturnType<typeof postgres>;
  let kontoId = 0;
  let mnqId = 0;
  const tokenyDoSprzatania: number[] = [];
  let tokenBrokera = "";

  /** Sprzatanie jako uzytkownik (aktor ui): baza nie pozwala usuwac danych brokera nikomu innemu. */
  async function sprzatnijDaneBrokera() {
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      await tx`delete from broker_imports`;
      await tx`delete from broker_cash_events`;
      await tx`delete from broker_fills`;
      await tx`delete from broker_trades`;
    });
  }

  /** Trade A dziennika zgodny z fikstura: long 3 MNQ, wejscie 13:30:35Z, wyjscie 13:34:50Z (bez poslizgu ceny: 20100,00). */
  async function wstawTradeA(): Promise<number> {
    const [t] = await sql`
      insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, pnl, pnl_estimate,
                          trading_day, market_session, exit_count, closed_contracts, source)
      values (${kontoId}, ${mnqId}, 'long', 'closed', ${`${DZIEN}T13:30:35Z`}, 20100, 3, 7200, 7200, ${DZIEN}, 'rth', 1, 3, 'form')
      returning id`;
    await sql`insert into trade_exits (trade_id, sort_order, exit_time, exit_price, contracts) values (${t.id}, 0, ${`${DZIEN}T13:34:50Z`}, 20112.5, 3)`;
    return t.id as number;
  }

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    const [i] = await sql`select id from instruments where symbol = 'MNQ' limit 1`;
    if (!i) throw new Error("Brak instrumentu MNQ w lokalnej bazie: uruchom npm run seed.");
    mnqId = i.id;
    const [k] = await sql`insert into accounts (name, type, sort_order, fee_rt_mini_cents, fee_rt_micro_cents) values (${`E2E broker ${RUN}`}, 'live', 999, 350, 100) returning id`;
    kontoId = k.id;
    await sprzatnijDaneBrokera();
  });

  test.afterAll(async () => {
    if (!sql) return;
    const ciche = (p: Promise<unknown>) => p.catch(() => undefined);
    await ciche(sprzatnijDaneBrokera());
    await ciche(
      sql.begin(async (tx) => {
        await tx`select set_config('tj.actor', 'ui', true)`;
        await tx`delete from broker_accounts where account_id = ${kontoId}`;
        await tx`delete from broker_accounts where account_id is null`;
      }),
    );
    await ciche(sql`delete from trade_reviews where trade_id in (select id from trades where account_id = ${kontoId})`);
    await ciche(sql`delete from trade_exits where trade_id in (select id from trades where account_id = ${kontoId})`);
    await ciche(sql`delete from trades where account_id = ${kontoId}`);
    await ciche(sql`delete from day_accounts where account_id = ${kontoId}`);
    for (const id of tokenyDoSprzatania) {
      await ciche(sql`delete from auth_events where token_id = ${id}`);
      await ciche(sql`delete from api_tokens where id = ${id}`);
    }
    await ciche(sql`delete from accounts where id = ${kontoId}`);
    await sql.end();
  });

  test("import reczny: podglad niczego nie zapisuje, zapis wstawia wypelnienia i trade'y brokera, cofniecie zeruje", async ({ page }) => {
    test.setTimeout(120_000);
    await wstawTradeA();
    await page.goto("/prop/polaczenia");
    await page.getByTestId("broker-plik").setInputFiles({ name: "Orders.csv", mimeType: "text/csv", buffer: Buffer.from(ORDERS, "utf8") });
    await page.getByTestId("broker-podglad").click();
    await expect(page.getByTestId("broker-podglad-sekcja").or(page.locator('[aria-label="Podgląd importu"]'))).toBeVisible({ timeout: 30_000 });

    // dowod: podglad nie zostawil nic w bazie
    expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from broker_imports`)[0].n).toBe(0);

    // konto z pliku trzeba przypisac do konta dziennika (inaczej plik tylko zapisuje wypelnienia)
    const przypisz = page.locator('[data-testid^="broker-przypisz-"]').first();
    if (await przypisz.count()) await przypisz.selectOption(String(kontoId));
    await expect(page.getByTestId("broker-zapisz-import")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("broker-zapisz-import").click();
    await expect(page.getByTestId("broker-zapis-wynik")).toBeVisible({ timeout: 30_000 });

    const [imp] = await sql`select id, status, origin from broker_imports`;
    expect(imp).toMatchObject({ status: "committed", origin: "ui" });
    expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBeGreaterThan(0);
    expect((await sql`select count(*)::int as n from broker_trades`)[0].n).toBeGreaterThan(0);
    // numer konta z pliku nie leży w bazie jawnie: tylko skrot i ostatnie 4 znaki
    const [bk] = await sql`select external_account_hmac, label_last4 from broker_accounts order by id desc limit 1`;
    expect(bk.external_account_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(bk.label_last4).toHaveLength(4);

    // ten sam plik jeszcze raz: duplikat, nic nowego
    await page.goto("/prop/polaczenia");
    await page.getByTestId("broker-plik").setInputFiles({ name: "Orders.csv", mimeType: "text/csv", buffer: Buffer.from(ORDERS, "utf8") });
    await page.getByTestId("broker-podglad").click();
    await expect(page.getByTestId("broker-duplikat")).toBeVisible({ timeout: 30_000 });
    expect((await sql`select count(*)::int as n from broker_imports`)[0].n).toBe(1);

    // cofniecie importu z historii
    await page.goto("/prop/polaczenia");
    await page.getByTestId(`broker-cofnij-import-${imp.id}`).click();
    await page.getByTestId(`broker-cofnij-import-potwierdz-${imp.id}`).click();
    await expect.poll(async () => (await sql`select status from broker_imports where id = ${imp.id}`)[0].status, { timeout: 30_000 }).toBe("reverted");
    expect((await sql`select count(*)::int as n from broker_fills`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from broker_trades`)[0].n).toBe(0);
    const [a] = await sql`select broker_amount, pnl from trades where account_id = ${kontoId}`;
    expect([a.broker_amount, Number(a.pnl)]).toEqual([null, 7200]); // wynik wyliczony wraca
  });

  test("automat: plik z tokenem import_broker dopasowuje trade 1:1 bez klikniecia, »Cofnij« dopasowanie zdejmuje kwote", async ({ page }) => {
    test.setTimeout(120_000);
    await sprzatnijDaneBrokera();
    const a = await sql`select id from trades where account_id = ${kontoId} limit 1`.then((w) => w[0]?.id as number | undefined) ?? (await wstawTradeA());

    // konto z pliku zostalo przypisane do konta dziennika przez uzytkownika w kroku 1 (UI) i przypisanie przezyło cofniecie importu
    expect((await sql`select count(*)::int as n from broker_accounts where account_id = ${kontoId}`)[0].n).toBe(1);
    const prefix = Array.from(randomBytes(8), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
    const token = `tj_${prefix}_${randomBytes(32).toString("base64url")}`;
    const [t] = await sql`
      insert into api_tokens (name, prefix, token_sha256, scopes, created_via, expires_at)
      values (${`e2e-broker-${RUN}`}, ${prefix}, ${createHash("sha256").update(token, "utf8").digest("hex")}, ${["import_broker"]}, 'ui', ${new Date(Date.now() + 86_400_000)})
      returning id`;
    tokenyDoSprzatania.push(t.id);
    tokenBrokera = token;
    const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
    const wyslij = () =>
      api.post("/api/v2/broker/inbox", {
        headers: { "content-type": "text/csv", "x-file-sha256": createHash("sha256").update(ORDERS, "utf8").digest("hex") },
        data: Buffer.from(ORDERS, "utf8"),
      });

    const r1 = await wyslij();
    expect(r1.status(), await r1.text()).toBe(201);
    await api.dispose();

    // A dopasowany od razu, bez klikniecia (dowod: odczyt z bazy)
    const [bt] = await sql`select id, match_kind, match_state from broker_trades where trade_id = ${a}`;
    expect(bt).toMatchObject({ match_kind: "auto", match_state: "matched" });
    const [po] = await sql`select broker_amount, pnl from trades where id = ${a}`;
    expect(po.broker_amount).not.toBeNull();
    const [imp] = await sql`select origin, created_by_token_id from broker_imports`;
    expect(imp).toMatchObject({ origin: "tj_watch", created_by_token_id: tokenyDoSprzatania[0] });

    // »Cofnij« na liscie »Uzgodnione z rachunku«
    await page.goto("/prop/polaczenia");
    await page.getByTestId(`broker-cofnij-dopasowanie-${bt.id}`).click();
    await page.getByTestId(`broker-cofnij-dopasowanie-potwierdz-${bt.id}`).click();
    await expect.poll(async () => (await sql`select match_state from broker_trades where id = ${bt.id}`)[0].match_state, { timeout: 30_000 }).toBe("skipped");
    const [wrocil] = await sql`select broker_amount, pnl from trades where id = ${a}`;
    expect([wrocil.broker_amount, Number(wrocil.pnl)]).toEqual([null, 7200]);
  });

  test("ukrycie wyniku: otwarty trade z ukrytym wynikiem nie wypuszcza kwot z rachunku w HTML ani w RSC", async ({ page }) => {
    test.setTimeout(120_000);
    const a = (await sql`select id from trades where account_id = ${kontoId} limit 1`)[0].id as number;
    // dopasowanie wraca w stan matched (jak po imporcie), a trade dziennika dostaje ukryty wynik: otwarty, z wyjsciem czesciowym
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      await tx`update broker_trades set trade_id = ${a}, match_kind = 'user', match_state = 'matched' where id = (select id from broker_trades where match_state = 'skipped' limit 1)`;
    });
    await sql`update trades set status = 'open', broker_amount = 123456 where id = ${a}`;
    await sql`
      insert into trade_reviews (trade_id, setup_type, summary_md, basis, brain_verdict, model, kind, as_of, evidence_hash, evidence_cutoff)
      values (${a}, 'FVG po sweepie', 'Uzasadnienie', 'chart', 'wejdz', 'claude-opus-4', 'ai',
              ${`${DZIEN}T13:25:00Z`}, ${createHash("sha256").update(RUN).digest("hex")}, ${`${DZIEN}T13:25:00Z`})`;
    const zakazane = ["1 234,56", "1234,56", "1234.56", "123456"];
    const wycieki: string[] = [];
    for (const adres of [`/trades/${a}`, "/prop/polaczenia", `/trades?od=${DZIEN}&do=${DZIEN}`]) {
      for (const naglowki of [{}, { RSC: "1" }] as Record<string, string>[]) {
        const odp = await page.request.get(adres, { headers: naglowki });
        expect(odp.status(), `${adres} ${JSON.stringify(naglowki)}`).toBe(200);
        const tresc = await odp.text();
        for (const z of zakazane) if (tresc.includes(z)) wycieki.push(`${adres} ${"RSC" in naglowki ? "RSC" : "HTML"}: „${z}”`);
      }
    }
    expect(wycieki).toEqual([]);
  });

  test("ukrycie wyniku: niedopasowane trade'y brokera nie zdradzaja netto ani zamkniecia na Polaczeniach i Dzis (HTML i RSC)", async ({ page }) => {
    test.setTimeout(120_000);
    await sprzatnijDaneBrokera();
    await sql`delete from trade_reviews where trade_id in (select id from trades where account_id = ${kontoId})`;
    await sql`delete from trades where account_id = ${kontoId}`;
    // trade otwarty z werdyktem AI wydanym przed wynikiem, wejscie przed wypelnieniami z pliku: jego wynik jest ukryty
    const [t] = await sql`
      insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, trading_day, market_session, exit_count, closed_contracts, source)
      values (${kontoId}, ${mnqId}, 'long', 'open', ${`${DZIEN}T13:20:00Z`}, 20100, 3, ${DZIEN}, 'rth', 0, 0, 'form') returning id`;
    await sql`
      insert into trade_reviews (trade_id, setup_type, summary_md, basis, brain_verdict, model, kind, as_of, evidence_hash, evidence_cutoff)
      values (${t.id}, 'FVG po sweepie', 'Uzasadnienie', 'chart', 'wejdz', 'claude-opus-4', 'ai',
              ${`${DZIEN}T13:15:00Z`}, ${createHash("sha256").update(`${RUN}-ukryty`).digest("hex")}, ${`${DZIEN}T13:15:00Z`})`;
    const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${tokenBrokera}` } });
    for (const tresc of [ORDERS]) {
      const r = await api.post("/api/v2/broker/inbox", {
        headers: { "content-type": "text/csv", "x-file-sha256": createHash("sha256").update(tresc, "utf8").digest("hex") },
        data: Buffer.from(tresc, "utf8"),
      });
      expect(r.status(), await r.text()).toBe(201);
    }
    await api.dispose();
    // dowod z bazy: sa zamkniete trade'y brokera z netto, ale zadnego nie widac w interfejsie
    const [{ n }] = await sql`select count(*)::int as n from broker_trades where status = 'closed' and net_cents is not null`;
    expect(n).toBeGreaterThan(0);
    const netto = (await sql`select net_cents::int as c from broker_trades where status = 'closed' and net_cents is not null`).map((w) => Math.abs(w.c as number));
    const zakazane = [...new Set(netto.flatMap((c) => [String(c), (c / 100).toFixed(2).replace(".", ","), (c / 100).toFixed(2)]))];
    const wycieki: string[] = [];
    for (const adres of ["/prop/polaczenia", "/", "/prop"]) {
      for (const naglowki of [{}, { RSC: "1" }] as Record<string, string>[]) {
        const odp = await page.request.get(adres, { headers: naglowki });
        expect(odp.status(), `${adres} ${JSON.stringify(naglowki)}`).toBe(200);
        const tresc = await odp.text();
        for (const z of zakazane) if (tresc.includes(z)) wycieki.push(`${adres} ${"RSC" in naglowki ? "RSC" : "HTML"}: „${z}”`);
        // ani czas wyjscia (15:34 w strefie uzytkownika), ani liczba pozycji zamknietych w liczniku konta
        if (adres === "/prop/polaczenia" && /15:34/.test(tresc)) wycieki.push(`${adres}: czas wyjścia 15:34`);
      }
    }
    expect(wycieki).toEqual([]);
    await page.goto("/prop/polaczenia");
    await expect(page.getByTestId("broker-do-decyzji-puste")).toBeVisible();
  });

  /** Wspolny start dla scenariuszy »Do decyzji« i »Konta u brokera«: czysty stan brokera i dziennika konta testowego. */
  async function czystyStart() {
    await sprzatnijDaneBrokera();
    await sql`delete from trade_reviews where trade_id in (select id from trades where account_id = ${kontoId})`;
    await sql`delete from trade_exits where trade_id in (select id from trades where account_id = ${kontoId})`;
    await sql`delete from trades where account_id = ${kontoId}`;
  }

  async function wyslijPlikTokenem() {
    const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${tokenBrokera}` } });
    const r = await api.post("/api/v2/broker/inbox", {
      headers: { "content-type": "text/csv", "x-file-sha256": createHash("sha256").update(ORDERS, "utf8").digest("hex") },
      data: Buffer.from(ORDERS, "utf8"),
    });
    expect(r.status(), await r.text()).toBe(201);
    await api.dispose();
  }

  test("Do decyzji: dwa pasujace trade'y dziennika to »niejednoznaczne«, »Dopasuj do #id« dopasowuje wybrany jako reczne i ustawia kwote z rachunku", async ({ page }) => {
    test.setTimeout(120_000);
    await czystyStart();
    const a = await wstawTradeA();
    // drugi trade w oknie +-120 s od wejscia z rachunku: dopasowanie 1:1 jest niemozliwe, decyduje uzytkownik
    const [b2] = await sql`
      insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, pnl, pnl_estimate,
                          trading_day, market_session, exit_count, closed_contracts, source)
      values (${kontoId}, ${mnqId}, 'long', 'closed', ${`${DZIEN}T13:31:05Z`}, 20100, 3, 7200, 7200, ${DZIEN}, 'rth', 1, 3, 'form')
      returning id`;
    await sql`insert into trade_exits (trade_id, sort_order, exit_time, exit_price, contracts) values (${b2.id}, 0, ${`${DZIEN}T13:34:50Z`}, 20112.5, 3)`;
    expect((await sql`select count(*)::int as n from broker_accounts where account_id = ${kontoId}`)[0].n).toBe(1); // przypisanie przezylo sprzatanie

    await wyslijPlikTokenem();
    const dwuznaczne = await sql`select id from broker_trades where match_state = 'ambiguous' and trade_id is null`;
    expect(dwuznaczne.length, "plik ma dac dokladnie jeden trade brokera w oknie obu trade'ow dziennika").toBe(1);
    const btId = dwuznaczne[0].id as number;
    expect((await sql`select broker_amount from trades where id = ${a}`)[0].broker_amount).toBeNull(); // nic nie dopasowano samo

    await page.goto("/prop/polaczenia");
    const wiersz = page.getByTestId(`broker-do-decyzji-${btId}`);
    await expect(wiersz).toBeVisible({ timeout: 30_000 });
    await expect(wiersz).toContainText("Niejednoznaczne");
    // oba trade'y sa kandydatami, przycisk jest dla kazdego
    await expect(page.getByTestId(`broker-dopasuj-${btId}-${b2.id}`)).toBeVisible();
    await page.getByTestId(`broker-dopasuj-${btId}-${a}`).click();

    // dowod z bazy: dopasowanie reczne do WYBRANEGO trade'a, kwota z rachunku tylko u niego
    await expect.poll(async () => (await sql`select match_state from broker_trades where id = ${btId}`)[0].match_state, { timeout: 30_000 }).toBe("matched");
    const [bt] = await sql`select trade_id, match_kind, match_state from broker_trades where id = ${btId}`;
    expect(bt).toMatchObject({ trade_id: a, match_kind: "user", match_state: "matched" });
    expect((await sql`select broker_amount from trades where id = ${a}`)[0].broker_amount).not.toBeNull();
    expect((await sql`select broker_amount from trades where id = ${b2.id}`)[0].broker_amount).toBeNull();
    await expect(page.getByTestId(`broker-do-decyzji-${btId}`)).toHaveCount(0, { timeout: 30_000 }); // wiersz zniknal z »Do decyzji«
  });

  test("Konta u brokera: nowe konto z pliku przypisujemy do konta dziennika z listy, a trade'y brokera dopasowuja sie 1:1", async ({ page }) => {
    test.setTimeout(120_000);
    await czystyStart();
    const a = await wstawTradeA();
    // konto u brokera od zera: nieprzypisane (jak po pierwszym imporcie pliku z nowego rachunku)
    await sql.begin(async (tx) => {
      await tx`select set_config('tj.actor', 'ui', true)`;
      await tx`delete from broker_accounts where account_id = ${kontoId}`;
    });
    await wyslijPlikTokenem();
    const [ba] = await sql`select id, account_id from broker_accounts order by id desc limit 1`;
    expect(ba.account_id).toBeNull();
    expect((await sql`select count(*)::int as n from broker_trades where trade_id is not null`)[0].n).toBe(0); // bez konta nic sie nie dopasowalo
    expect((await sql`select broker_amount from trades where id = ${a}`)[0].broker_amount).toBeNull();

    await page.goto("/prop/polaczenia");
    const wiersz = page.getByTestId(`broker-konto-${ba.id}`);
    await expect(wiersz).toBeVisible({ timeout: 30_000 });
    await expect(wiersz).toContainText("Nie przypisane do konta dziennika");
    await expect(page.getByTestId(`broker-przypisz-zapisz-${ba.id}`)).toBeDisabled(); // bez wyboru z listy nie da sie zapisac
    await page.getByTestId(`broker-przypisz-konto-${ba.id}`).selectOption(String(kontoId));
    await page.getByTestId(`broker-przypisz-zapisz-${ba.id}`).click();

    // dowod z bazy: przypisanie zapisane, trade A dopasowany 1:1 z kwota z rachunku
    await expect.poll(async () => (await sql`select account_id from broker_accounts where id = ${ba.id}`)[0].account_id, { timeout: 30_000 }).toBe(kontoId);
    const [bt] = await sql`select id, match_kind, match_state from broker_trades where trade_id = ${a}`;
    expect(bt).toMatchObject({ match_state: "matched" });
    expect((await sql`select broker_amount from trades where id = ${a}`)[0].broker_amount).not.toBeNull();
    await expect(page.getByTestId(`broker-konto-${ba.id}`)).toContainText("E2E broker");
    await expect(page.getByTestId(`broker-odepnij-${ba.id}`)).toBeVisible();
  });

  test("telefon 375 px: Polaczenia, Dzis i ustawienia kont bez poziomego przewijania", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const przewiniete: string[] = [];
    for (const adres of ["/prop/polaczenia", "/", "/settings/accounts", "/settings/devices", "/prop"]) {
      await page.goto(adres);
      await page.waitForLoadState("networkidle");
      const [szer, okno] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      if (szer > okno) przewiniete.push(`${adres}: ${szer} > ${okno}`);
    }
    expect(przewiniete).toEqual([]);
  });
});
