import { createHash, randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

import { wymagajLokalnych } from "./lokalne";

/*
 * Funkcje MUST (faza 2b) przeciw zywemu serwerowi z prawdziwa, LOKALNA baza (E2E_URL, np. :3228).
 * Dowodem zapisu jest odczyt z bazy po zapisie, nie sama odpowiedz HTTP. Zatwierdzenie sugestii AI
 * klika sie w interfejsie (aktor `ui`), bo agent nie ma jak go wykonac.
 * Dane testowe maja dzien z 1979 roku i znacznik w nazwach; sprzatamy po sobie.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const DZIEN = "1979-05-05";
const sha = (t: string) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

const AXE_TAGI = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe.configure({ mode: "serial" });

test.describe("funkcje MUST: plan, werdykt, sugestie, prop, adnotacje, zalaczniki", () => {
  let sql: ReturnType<typeof postgres>;
  let api: APIRequestContext;
  let tokenId = 0;
  let kontoId = 0;
  let propId = 0;
  let tagId = 0;
  let tagUtworzony = false;
  let instrumentId = 0;
  const trady: number[] = [];

  async function trade(status: "open" | "closed", nr: number): Promise<number> {
    const czas = `${DZIEN}T14:3${nr}:00Z`;
    const [t] = await sql`
      insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, stop_loss,
                          exit_time, exit_price, pnl, risk_amount, r_multiple, trading_day, market_session, exit_count,
                          closed_contracts, source, external_ref)
      values (${kontoId}, ${instrumentId}, 'long', ${status}, ${czas}, 20000, 2, 19990,
              ${status === "closed" ? czas : null}, ${status === "closed" ? 20020 : null}, ${status === "closed" ? 80000 : null},
              40000, ${status === "closed" ? 2 : null}, ${DZIEN}, 'rth', ${status === "closed" ? 1 : 0}, ${status === "closed" ? 2 : 0},
              'tradingview', ${`tv:e2e-2b-${RUN}-${nr}`})
      returning id`;
    trady.push(t.id);
    return t.id as number;
  }

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, BASE);
    sql = postgres(DB_URL, { max: 2 });
    await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
    const [i] = await sql`select id from instruments where symbol = 'NQ' limit 1`;
    if (!i) throw new Error("Brak instrumentu NQ w lokalnej bazie. Uruchom `npm run seed`.");
    instrumentId = i.id;
    const [k] = await sql`insert into accounts (name, type) values (${`E2E 2b ${RUN}`}, 'live') returning id`;
    kontoId = k.id;
    const [p] = await sql`insert into accounts (name, type, prop_phase, starting_balance) values (${`E2E 2b prop ${RUN}`}, 'prop', 'eval', 5000000) returning id`;
    propId = p.id;
    const [tg] = await sql`select id from tags where archived = false order by id limit 1`;
    if (tg) tagId = tg.id;
    else {
      const [n] = await sql`insert into tags (name, category) values (${`e2e-2b-${RUN}`}, 'setup') returning id`;
      tagId = n.id;
      tagUtworzony = true;
    }

    const prefix = Array.from(randomBytes(8), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
    const token = `tj_${prefix}_${randomBytes(32).toString("base64url")}`;
    const [t] = await sql`
      insert into api_tokens (name, prefix, token_sha256, scopes, created_via)
      values (${`e2e-2b-${RUN}`}, ${prefix}, ${createHash("sha256").update(token, "utf8").digest("hex")}, ${["read", "write", "propose"]}, 'device_code')
      returning id`;
    tokenId = t.id;
    api = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { authorization: `Bearer ${token}`, "x-forwarded-for": `198.51.${100 + Math.floor(Math.random() * 100)}.${1 + Math.floor(Math.random() * 250)}` },
    });
  });

  test.afterAll(async () => {
    await api?.dispose();
    if (!sql) return;
    await sql`delete from chart_annotations where trade_id = any(${trady})`;
    await sql`delete from trade_reviews where created_by_token_id = ${tokenId}`;
    await sql`delete from trade_plans where created_by_token_id = ${tokenId}`;
    await sql`delete from user_words where created_by_token_id = ${tokenId}`;
    await sql`delete from ai_suggestions where created_by_token_id = ${tokenId}`;
    await sql`delete from screenshots where trade_id = any(${trady})`;
    await sql`delete from trade_tags where trade_id = any(${trady})`;
    await sql`delete from trades where account_id = any(${[kontoId, propId]})`;
    await sql`delete from accounts where id = any(${[kontoId, propId]})`;
    if (tagUtworzony) await sql`delete from tags where id = ${tagId}`;
    await sql`delete from api_tokens where id = ${tokenId}`;
    await sql.end();
  });

  test("plan po zapisie jest niezmienny: PATCH i PUT = 409, zmiana tylko dopiskiem, baza trzyma pierwotne wartosci", async () => {
    const dane = { accountId: kontoId, symbol: "NQ1!", day: DZIEN, direction: "long", bias: "long", entryPrice: 20000, stopLoss: 19990, takeProfit: 20040, contracts: 2 };
    const r = await api.post("/api/v2/trade-plans", { data: dane });
    expect(r.status(), await r.text()).toBe(201);
    const id = (await r.json()).plan.id as number;

    for (const metoda of ["patch", "put"] as const) {
      const odm = await api[metoda](`/api/v2/trade-plans/${id}`, { data: { stopLoss: 19900 } });
      expect(odm.status()).toBe(409);
    }
    const [w] = await sql`select stop_loss::float8 as sl, entry_price::float8 as ep from trade_plans where id = ${id}`;
    expect(w).toEqual({ sl: 19990, ep: 20000 });

    const slowa = await api.post("/api/v2/user-words", { data: { text: "Przesuwam SL, bo wykres się zmienił.", source: "chat", capturedAt: new Date().toISOString(), day: DZIEN, sha256: sha("Przesuwam SL, bo wykres się zmienił.") } });
    expect(slowa.status(), await slowa.text()).toBeLessThan(300);
    const dopisek = await api.post(`/api/v2/trade-plans/${id}/addenda`, { data: { field: "stop_loss", newValue: 19985, wordsId: (await slowa.json()).id } });
    expect(dopisek.status(), await dopisek.text()).toBe(201);
    const [po] = await sql`select stop_loss::float8 as sl from trade_plans where id = ${id}`;
    expect(po.sl).toBe(19990); // dopisek nie nadpisuje planu
    const [{ n }] = await sql`select count(*)::int as n from trade_plan_addenda where plan_id = ${id}`;
    expect(n).toBe(1);
  });

  test("werdykt: wynik schowany do zamkniecia trade'u; po zamknieciu odslonieta; wynik nie wycieka w JSON", async () => {
    const id = await trade("open", 1);
    const rev = await api.post(`/api/v2/trades/${id}/reviews`, {
      data: {
        basis: "chart",
        brainVerdict: "wejdz",
        model: "claude-opus-5-5",
        evidence: { intervalMinutes: 5, candles: [{ t: `${DZIEN}T14:20:00Z`, o: 20000, h: 20010, l: 19995, c: 20005 }] },
      },
    });
    expect(rev.status(), await rev.text()).toBe(201);
    await sql`update trades set pnl = 80000, r_multiple = 2, exit_price = 20020, exit_time = ${`${DZIEN}T14:45:00Z`} where id = ${id}`;
    const ukryty = await (await api.get(`/api/v2/trades/${id}`)).json();
    expect(ukryty.resultHidden).toBe(true);
    expect(ukryty.result).toBeNull();
    expect(JSON.stringify(ukryty)).not.toContain("80000");
    expect(JSON.stringify(ukryty)).not.toContain("20020"); // cena wyjscia tez nie wycieka

    const zmiana = await api.patch(`/api/v2/trades/${id}/reviews/${(await rev.json()).reviewId}`, { data: { brainVerdict: "pomin" } });
    expect(zmiana.status()).toBe(409);

    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 2 where id = ${id}`;
    const odslonity = await (await api.get(`/api/v2/trades/${id}`)).json();
    expect(odslonity.resultHidden).toBe(false);
    expect(odslonity.result.pnlCents).toBe(80000);
  });

  test("sugestia AI nie wchodzi do statystyk przed zatwierdzeniem; zatwierdzenie klikane w interfejsie wstawia tag z origin ai", async ({ browser }) => {
    const id = await trade("closed", 2);
    const claim = `E2E sugestia ${RUN}: ten trade to wejście po sweepie.`;
    const s = await api.post("/api/v2/ai-suggestions", {
      data: { kind: "tag", target: { type: "trade", id }, payload: { tagId, interval: "5m" }, claim, evidence: [{ type: "trade", ref: id, note: "FVG po sweepie" }], evidenceLevel: "partial", n: 12 },
    });
    expect(s.status(), await s.text()).toBe(201);
    const sugestiaId = (await s.json()).suggestion.id as number;

    const [{ przed }] = await sql`select count(*)::int as przed from trade_tags where trade_id = ${id}`;
    expect(przed).toBe(0);
    expect((await sql`select status from ai_suggestions where id = ${sugestiaId}`)[0].status).toBe("pending");

    const ctx = await browser.newContext({ storageState: "e2e/.sesja.json", baseURL: BASE, locale: "pl-PL" });
    const page = await ctx.newPage();
    await page.goto("/decyzje");
    await expect(page.getByRole("heading", { name: "Do decyzji" })).toBeVisible();
    const karta = page.locator("li").filter({ hasText: claim });
    await expect(karta).toBeVisible();
    await expect(karta.getByText("propozycja AI")).toBeVisible();
    const wyniki = await new AxeBuilder({ page }).withTags(AXE_TAGI).analyze();
    expect(wyniki.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await karta.getByRole("button", { name: "Zatwierdź" }).click();
    await expect(page.locator("li").filter({ hasText: claim }).getByRole("button", { name: "Cofnij" })).toBeVisible();

    const [t] = await sql`select origin, interval from trade_tags where trade_id = ${id} and tag_id = ${tagId}`;
    expect(t).toEqual({ origin: "ai", interval: "5m" });
    expect((await sql`select status from ai_suggestions where id = ${sugestiaId}`)[0].status).toBe("accepted");

    await page.locator("li").filter({ hasText: claim }).getByRole("button", { name: "Cofnij" }).click();
    await expect.poll(async () => (await sql`select count(*)::int as n from trade_tags where trade_id = ${id}`)[0].n).toBe(0);
    await ctx.close();
  });

  test("prop: ostrzezenie przy 75% dziennego limitu straty, z liczbami w tekscie", async () => {
    const reguly = await api.post(`/api/v2/prop/accounts/${propId}/rules`, { data: { validFrom: "2026-01-01", ddType: "static", maxDdCents: 500_000, dailyLossCents: 200_000 } });
    expect(reguly.status(), await reguly.text()).toBe(201);
    const dzis = "2026-10-09"; // dzien podany wprost: dzien handlowy »dzisiaj« zalezy od zegara gieldy, a test ma byc deterministyczny
    const strata = async (centy: number, nr: number) => {
      const czas = `${dzis}T14:${10 + nr}:00Z`;
      const [t] = await sql`
        insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, stop_loss, exit_time, exit_price,
                            pnl, risk_amount, r_multiple, trading_day, market_session, exit_count, closed_contracts, source)
        values (${propId}, ${instrumentId}, 'long', 'closed', ${czas}, 20000, 2, 19990, ${czas}, 19990, ${-centy}, 40000, ${-centy / 40000}, ${dzis}, 'rth', 1, 2, 'form')
        returning id`;
      trady.push(t.id);
    };
    await strata(149_000, 1);
    const przed = await (await api.get(`/api/v2/prop/accounts/${propId}/status?day=${dzis}`)).json();
    expect(przed.state.warnings.filter((w: { code: string }) => w.code === "dll").map((w: { level: number }) => w.level)).toEqual([50]);
    await strata(1_000, 2);
    const po = await (await api.get(`/api/v2/prop/accounts/${propId}/status?day=${dzis}`)).json();
    const o = po.state.warnings.find((w: { code: string }) => w.code === "dll");
    expect(o.level).toBe(75);
    expect(o.text).toContain("75%");
    expect(po.state.dailyLossBufferCents).toBe(50_000);
  });

  test("adnotacja z wykresu: tekst bajt w bajt (sha256 z klienta), rozne bajty = odmowa", async () => {
    const id = await trade("open", 3);
    const tekst = "Zażółć gęślą jaźń 🙂\r\nDrugi wiersz  z dwiema spacjami i spacją na końcu   ";
    const rysunek = { externalId: `e2e-${RUN}`, shape: "text", price: 20015.25, interval: "5m", timeFrom: `${DZIEN}T14:30:00Z`, raw: { kolor: "#ff0" }, capturedAt: "2026-10-15T10:00:00+02:00", text: tekst, sha256: sha(tekst) };
    const r = await api.post("/api/v2/chart-annotations", { data: { platform: "fxreplay", tradeId: id, annotations: [rysunek] } });
    expect(r.status(), await r.text()).toBe(201);
    const [w] = await sql`select uw.text, encode(convert_to(uw.text, 'UTF8'), 'hex') as hex, uw.sha256
                            from chart_annotations ca join user_words uw on uw.id = ca.words_id where ca.external_id = ${rysunek.externalId}`;
    expect(Buffer.from(w.hex, "hex").equals(Buffer.from(tekst, "utf8"))).toBe(true);
    expect(w.sha256).toBe(sha(tekst));

    const zly = await api.post("/api/v2/chart-annotations", { data: { platform: "fxreplay", tradeId: id, annotations: [{ ...rysunek, externalId: `e2e-zly-${RUN}`, text: tekst.trim() }] } });
    const wynik = (await zly.json()).results?.[0];
    expect(wynik?.status).toBe("refused");
    expect((await sql`select count(*)::int as n from chart_annotations where external_id = ${`e2e-zly-${RUN}`}`)[0].n).toBe(0);
  });

  test("reczne zdjecie dopisuje sie i NIE kasuje zrzutow AI", async () => {
    const id = await trade("open", 4);
    const png = (k: number) => sharp({ create: { width: 24, height: 24, channels: 3, background: { r: k, g: 40, b: 90 } } }).png().toBuffer();
    const wyslij = async (origin: string, k: number) => {
      const r = await api.post(`/api/v2/trades/${id}/screenshots`, {
        multipart: { shot: { name: `z${k}.png`, mimeType: "image/png", buffer: await png(k) }, interval: "5m", origin },
      });
      expect(r.status(), await r.text()).toBe(200);
    };
    const ile = async () => Object.fromEntries((await sql`select origin, count(*)::int as n from screenshots where trade_id = ${id} group by origin`).map((x) => [x.origin, x.n]));
    await wyslij("tradingview", 10);
    expect(await ile()).toEqual({ tradingview: 1 });
    await wyslij("manual", 12);
    expect(await ile()).toEqual({ tradingview: 1, manual: 1 });
    await wyslij("manual", 13);
    expect(await ile()).toEqual({ tradingview: 1, manual: 2 });
  });

  test("ekran »Do rozstrzygniecia« otwiera sie i spelnia axe (stan pusty tez)", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.sesja.json", baseURL: BASE, locale: "pl-PL" });
    const page = await ctx.newPage();
    await page.goto("/decyzje/rozstrzygniecia");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const wyniki = await new AxeBuilder({ page }).withTags(AXE_TAGI).analyze();
    expect(wyniki.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await ctx.close();
  });
});
