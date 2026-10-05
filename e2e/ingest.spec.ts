import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

import { wymagajLokalnych } from "./lokalne";
import sharp from "sharp";

/*
 * API synchronizacji (/api/ingest/**, ADR-026) przeciw zywemu serwerowi z
 * prawdziwa, LOKALNA baza. Dowodem zapisu jest odczyt z bazy po zapisie, nie
 * sama odpowiedz HTTP.
 *
 * Wymaga zmiennych (tych samych, z ktorymi wstal serwer):
 *   E2E_INGEST_TOKEN   - token; serwer ma INGEST_TOKEN_SHA256 = sha256(token)
 *   DATABASE_URL       - baza LOKALNA (127.0.0.1/localhost); inna = test sie przerywa
 *
 * Sprzata po sobie: kasuje wszystko, co ma klucz zaczynajacy sie od "e2e-"
 * (takze pozostalosci po przerwanych przebiegach) oraz pliki zrzutow.
 * Trady maja daty z 1991 roku, zeby nie wchodzic w droge testom, ktore klikaja
 * "pierwszy wiersz" listy (patrz losowyDzien w dziennik.spec.ts).
 */

const TOKEN = process.env.E2E_INGEST_TOKEN ?? "";
const DB_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
/** Tag testowy: lokalna baza nie musi miec tagow uzytkownika, a API nie zaklada tagow samo. */
const TAG = "E2E ingest FVG";
/** Adresy testowe zmieniaja sie z kazdym przebiegiem: blokada po 8 bledach trzyma sie 10 minut w pamieci serwera. */
const PREFIKS = `198.51.${1 + Math.floor(Math.random() * 250)}`;

test.describe.configure({ mode: "serial" });

test.describe("API synchronizacji", () => {
  test.skip(!TOKEN, "Ustaw E2E_INGEST_TOKEN (i INGEST_TOKEN_SHA256 na serwerze), żeby uruchomić testy API.");

  let sql: ReturnType<typeof postgres>;
  let api: APIRequestContext;
  const utworzoneTrady: number[] = [];

  /** Klient z wlasnym adresem (X-Forwarded-For): blokady i limity sa per adres. */
  async function klient(adres: string, token: string | null = TOKEN): Promise<APIRequestContext> {
    return pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: {
        "x-forwarded-for": adres,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  function trade(nr: number, nadpisz: Record<string, unknown> = {}) {
    return {
      externalRef: `fxr:e2e-${RUN}-${nr}`,
      accountId: 1,
      symbol: "NQ1!",
      direction: "long",
      entryTime: `1991-03-12T09:3${nr % 10}:00-05:00`,
      entryPrice: 20000,
      contracts: 2,
      stopLoss: 19990,
      takeProfit: 20020,
      exits: [{ time: "1991-03-12T09:50:00-05:00", price: 20010 }],
      ...nadpisz,
    };
  }

  async function wierszTradu(ref: string) {
    const [w] = await sql`
      select id, source, external_ref, ingested_at, updated_at, pnl, r_multiple, risk_amount, market_session,
             trading_day::text as trading_day, entry_time, exit_count, note, source_snapshot->>'hash' as hash,
             backtest_session_id, account_id
      from trades where external_ref = ${ref}`;
    // postgres.js oddaje bigint jako tekst - liczymy na liczbach.
    if (w) {
      w.pnl = w.pnl === null ? null : Number(w.pnl);
      w.risk_amount = w.risk_amount === null ? null : Number(w.risk_amount);
    }
    return w as
      | undefined
      | {
          id: number;
          source: string;
          external_ref: string;
          ingested_at: Date | null;
          updated_at: Date;
          pnl: number | null;
          r_multiple: string | null;
          risk_amount: number | null;
          market_session: string | null;
          trading_day: string | null;
          entry_time: Date;
          exit_count: number;
          note: string | null;
          hash: string | null;
          backtest_session_id: number | null;
          account_id: number;
        };
  }

  async function ileTradow(): Promise<number> {
    const [w] = await sql`select count(*)::int as n from trades where external_ref like ${"%e2e-" + RUN + "%"}`;
    return w.n;
  }

  async function posprzataj(wszystkieE2e: boolean) {
    const wzorzec = wszystkieE2e ? "%e2e-%" : `%e2e-${RUN}%`;
    const idy = await sql`select id from trades where external_ref like ${wzorzec}`;
    await sql`delete from trades where external_ref like ${wzorzec}`;
    await sql`delete from ingest_skips where external_ref like ${wzorzec}`;
    await sql`delete from backtest_sessions where external_ref like ${wzorzec}`;
    await sql`delete from accounts where name like 'E2E ingest %'`;
    await sql`delete from tags where name like 'E2E ingest %'`;
    const katalog = path.resolve(process.env.UPLOADS_DIR ?? "./.dane/zrzuty");
    for (const { id } of [...idy, ...utworzoneTrady.map((id) => ({ id }))]) {
      await rm(path.join(katalog, String(id)), { recursive: true, force: true });
    }
  }

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, process.env.E2E_URL);
    sql = postgres(DB_URL, { max: 2 });
    api = await klient(`${PREFIKS}.200`);
    await posprzataj(true); // pozostalosci po przerwanych przebiegach
    await sql`insert into tags (category_id, name) select id, ${TAG} from tag_categories where key = 'confluence' on conflict do nothing`;
  });

  test.afterAll(async () => {
    if (!sql) return;
    await posprzataj(true);
    await sql.end();
    await api?.dispose();
  });

  /* --- brama ---------------------------------------------------------------- */

  test("brak tokenu i zły token dają 401 z komunikatem po polsku", async () => {
    const bez = await klient(`${PREFIKS}.1`, null);
    const r1 = await bez.get("/api/ingest/meta");
    expect(r1.status()).toBe(401);
    expect(r1.headers()["www-authenticate"]).toContain("Bearer");
    expect((await r1.json()).error).toContain("Authorization: Bearer");

    const zly = await klient(`${PREFIKS}.1`, "zly-token");
    expect((await zly.get("/api/ingest/meta")).status()).toBe(401);
    await bez.dispose();
    await zly.dispose();
  });

  test("po 8 błędnych tokenach adres dostaje 429, także z poprawnym tokenem; inny adres nie", async () => {
    const zly = await klient(`${PREFIKS}.2`, "zly-token");
    for (let i = 0; i < 8; i += 1) expect((await zly.get("/api/ingest/meta")).status()).toBe(401);

    const poprawnyZTegoSamegoAdresu = await klient(`${PREFIKS}.2`);
    const r = await poprawnyZTegoSamegoAdresu.get("/api/ingest/meta");
    expect(r.status()).toBe(429);
    expect(Number(r.headers()["retry-after"])).toBeGreaterThan(0);

    const innyAdres = await klient(`${PREFIKS}.3`);
    expect((await innyAdres.get("/api/ingest/meta")).status()).toBe(200);
    await Promise.all([zly.dispose(), poprawnyZTegoSamegoAdresu.dispose(), innyAdres.dispose()]);
  });

  test("121. zapytanie w ciągu minuty dostaje 429 z Retry-After", async () => {
    const szybki = await klient(`${PREFIKS}.4`);
    let pierwszeOdrzucone = 0;
    for (let i = 1; i <= 121; i += 1) {
      const r = await szybki.get("/api/ingest/trades?limit=1&refs=tv:e2e-nic");
      if (r.status() === 429) {
        pierwszeOdrzucone = i;
        expect(Number(r.headers()["retry-after"])).toBeGreaterThan(0);
        break;
      }
      expect(r.status()).toBe(200);
    }
    expect(pierwszeOdrzucone).toBe(121);
    await szybki.dispose();
  });

  test("za duże ciało: JSON ponad 1 MB i multipart ponad 11 MB dają 413", async () => {
    const c = await klient(`${PREFIKS}.5`);

    const duzyJson = JSON.stringify({ trades: [{ externalRef: "tv:e2e-x", note: "x".repeat(1024 * 1024 + 10) }] });
    const r1 = await c.post("/api/ingest/trades", { data: duzyJson, headers: { "content-type": "application/json" } });
    expect(r1.status()).toBe(413);
    expect((await r1.json()).code).toBe("payload_too_large");

    const duzyMultipart = Buffer.alloc(11 * 1024 * 1024 + 1024, 65);
    const r2 = await c.post("/api/ingest/trades/1/screenshots", {
      data: duzyMultipart,
      headers: { "content-type": "multipart/form-data; boundary=xyz" },
    });
    expect(r2.status()).toBe(413);

    const zlyTyp = await c.post("/api/ingest/trades", { data: "{}", headers: { "content-type": "text/plain" } });
    expect(zlyTyp.status()).toBe(415);
    await c.dispose();
  });

  test("meta opisuje konta, instrumenty, interwały i limity", async () => {
    const r = await api.get("/api/ingest/meta");
    expect(r.status()).toBe(200);
    const meta = await r.json();
    expect(meta.accounts.length).toBeGreaterThan(0);
    expect(meta.instruments.map((i: { symbol: string }) => i.symbol)).toContain("NQ");
    expect(meta.intervals).toEqual(expect.arrayContaining(["30s", "1m", "5m", "1h", "4h", "D"]));
    expect(meta.htfThreshold).toBe("1h");
    expect(meta.limits.maxTradesPerRequest).toBe(50);
    expect(meta.limits.requestsPerMinute).toBe(120);
  });

  /* --- sesje ---------------------------------------------------------------- */

  let sesjaBacktestId = 0;
  let sesjaForwardId = 0;

  test("backtest-sessions: tworzy sesję i odnajduje ją po externalRef (idempotentnie), forward osobno", async () => {
    const ref = `fxr:e2e-${RUN}-sesja`;
    const r1 = await api.post("/api/ingest/backtest-sessions", {
      data: { externalRef: ref, name: `E2E sesja ${RUN}`, symbol: "NQ1!", startingBalance: 50000, dataFrom: "1991-01-01" },
    });
    expect(r1.status()).toBe(201);
    const s1 = await r1.json();
    expect(s1.created).toBe(true);
    expect(s1.kind).toBe("backtest");
    sesjaBacktestId = s1.id;

    const r2 = await api.post("/api/ingest/backtest-sessions", {
      data: { externalRef: ref, name: "inna nazwa", kind: "forward" },
    });
    expect(r2.status()).toBe(200);
    const s2 = await r2.json();
    expect(s2.id).toBe(s1.id);
    expect(s2.created).toBe(false);
    expect(s2.kind).toBe("backtest"); // rodzaj się nie zmienia
    expect(s2.warnings.join(" ")).toContain("Rodzaj nie został zmieniony");

    const [w] = await sql`select kind, external_ref, starting_balance, instrument_id from backtest_sessions where id = ${s1.id}`;
    expect(w.kind).toBe("backtest");
    expect(Number(w.starting_balance)).toBe(5_000_000);
    expect(w.instrument_id).not.toBeNull();
    const [ile] = await sql`select count(*)::int as n from backtest_sessions where external_ref = ${ref}`;
    expect(ile.n).toBe(1);

    const rf = await api.post("/api/ingest/backtest-sessions", {
      data: { externalRef: `fxr:e2e-${RUN}-forward`, name: `E2E forward ${RUN}`, kind: "forward" },
    });
    expect(rf.status()).toBe(201);
    sesjaForwardId = (await rf.json()).id;
    const [wf] = await sql`select kind from backtest_sessions where id = ${sesjaForwardId}`;
    expect(wf.kind).toBe("forward");
  });

  /* --- trady: create -> unchanged -> update -> conflict --------------------- */

  test("dryRun waliduje i liczy, ale nic nie zapisuje", async () => {
    const przed = await sql`select (select count(*) from trades)::int as t, (select count(*) from backtest_sessions)::int as s,
      (select count(*) from ingest_skips)::int as k`;
    const r = await api.post("/api/ingest/trades", { data: { dryRun: true, trades: [trade(1)] } });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.dryRun).toBe(true);
    expect(body.results[0].status).toBe("created");
    expect(body.results[0].id).toBeUndefined();
    // NQ, 40 ticków po 5 USD na kontrakt, 2 kontrakty = 400 USD = 40000 centów, ryzyko 400 USD -> 1R
    expect(body.results[0].preview.pnl).toBe(40000);
    expect(body.results[0].preview.rMultiple).toBe(1);
    expect(body.results[0].preview.marketSession).toBe("rth");

    const po = await sql`select (select count(*) from trades)::int as t, (select count(*) from backtest_sessions)::int as s,
      (select count(*) from ingest_skips)::int as k`;
    expect(po[0]).toEqual(przed[0]);
    expect(await wierszTradu(trade(1).externalRef)).toBeUndefined();
  });

  test("create zapisuje trade przez computeTrade; powtórka daje unchanged bez duplikatu", async () => {
    const dane = trade(1, {
      sessionId: sesjaBacktestId,
      note: "notatka z API",
      readiness: 7,
      tags: [{ category: "confluence", name: TAG, interval: "5m" }, { category: "confluence", name: TAG, interval: "1h" }],
    });
    const r1 = await api.post("/api/ingest/trades", { data: { trades: [dane] } });
    expect(r1.status()).toBe(200);
    const b1 = await r1.json();
    expect(b1.summary).toMatchObject({ created: 1, error: 0 });
    expect(b1.results[0].status).toBe("created");
    const id = b1.results[0].id as number;
    utworzoneTrady.push(id);

    // Dowód: odczyt z bazy po zapisie.
    const w = (await wierszTradu(dane.externalRef))!;
    expect(w.id).toBe(id);
    expect(w.source).toBe("fxreplay");
    expect(w.pnl).toBe(40000);
    expect(Number(w.r_multiple)).toBe(1);
    expect(Number(w.risk_amount)).toBe(40000);
    expect(w.market_session).toBe("rth");
    expect(w.trading_day).toBe("1991-03-12");
    expect(w.entry_time.toISOString()).toBe("1991-03-12T14:31:00.000Z"); // 09:31 w Nowym Jorku (EST, -05:00)
    expect(w.exit_count).toBe(1);
    expect(w.ingested_at).not.toBeNull();
    expect(w.updated_at.getTime()).toBe(w.ingested_at!.getTime());
    expect(w.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(w.backtest_session_id).toBe(sesjaBacktestId);
    const tagi = await sql`select tt.interval from trade_tags tt join tags t on t.id = tt.tag_id where tt.trade_id = ${id} order by tt.interval`;
    expect(tagi.map((x) => x.interval)).toEqual(["1h", "5m"]);
    const [shot] = await sql`select readiness from trades where id = ${id}`;
    expect(shot.readiness).toBe(7);

    // Powtórka (create) - bez duplikatu i bez zmiany wiersza.
    const r2 = await api.post("/api/ingest/trades", { data: { trades: [dane] } });
    const b2 = await r2.json();
    expect(b2.results[0]).toMatchObject({ status: "unchanged", id });
    expect(await ileTradow()).toBe(1);
    const po = (await wierszTradu(dane.externalRef))!;
    expect(po.updated_at.getTime()).toBe(w.updated_at.getTime());
  });

  test("update bez zmian daje unchanged, ze zmianą updated; lista GET pokazuje skrót i brak edycji w aplikacji", async () => {
    const dane = trade(1, {
      sessionId: sesjaBacktestId,
      note: "notatka z API",
      readiness: 7,
      tags: [{ category: "confluence", name: TAG, interval: "5m" }, { category: "confluence", name: TAG, interval: "1h" }],
    });
    const przed = (await wierszTradu(dane.externalRef))!;

    const bez = await (await api.post("/api/ingest/trades", { data: { mode: "update", trades: [dane] } })).json();
    expect(bez.results[0].status).toBe("unchanged");

    const zmieniony = { ...dane, exits: [{ time: "1991-03-12T09:50:00-05:00", price: 20020 }], note: "poprawka z API" };
    const r = await (await api.post("/api/ingest/trades", { data: { mode: "update", trades: [zmieniony] } })).json();
    expect(r.results[0]).toMatchObject({ status: "updated", id: przed.id });

    const po = (await wierszTradu(dane.externalRef))!;
    expect(po.pnl).toBe(80000); // 80 ticków * 5 USD * 2 kontrakty
    expect(Number(po.r_multiple)).toBe(2);
    expect(po.note).toBe("poprawka z API");
    expect(po.hash).not.toBe(przed.hash);
    expect(po.updated_at.getTime()).toBe(po.ingested_at!.getTime());
    const [wyj] = await sql`select count(*)::int as n, max(exit_price)::float as cena from trade_exits where trade_id = ${po.id}`;
    expect(wyj).toEqual({ n: 1, cena: 20020 });

    const lista = await (await api.get(`/api/ingest/trades?refs=${encodeURIComponent(dane.externalRef)}`)).json();
    expect(lista.trades).toHaveLength(1);
    expect(lista.trades[0]).toMatchObject({ id: po.id, externalRef: dane.externalRef, source: "fxreplay", editedInApp: false });
    expect(lista.trades[0].hash).toBe(po.hash);
  });

  test("edycja w aplikacji wygrywa: kolejny update dostaje conflict i niczego nie nadpisuje", async ({ page }) => {
    const ref = trade(1).externalRef;
    const przed = (await wierszTradu(ref))!;

    // Prawdziwa edycja przez formularz aplikacji (zalogowana sesja z projektu "dziennik").
    await page.goto(`/trades/${przed.id}/edit`);
    // Dev-serwer hydratuje formularz po chwili; fill przed hydratacja gubi sie lub skleja z wartoscia domyslna.
    await page.waitForLoadState("networkidle");
    await page.locator("#note").fill("Moja ręczna poprawka w aplikacji");
    await expect(page.locator("#note")).toHaveValue("Moja ręczna poprawka w aplikacji");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page).toHaveURL(/\/trades\/\d+$/);

    const poEdycji = (await wierszTradu(ref))!;
    expect(poEdycji.note).toBe("Moja ręczna poprawka w aplikacji");
    // Formularz nie dotyka pól synchronizacji (ADR-026) ...
    expect(poEdycji.source).toBe("fxreplay");
    expect(poEdycji.external_ref).toBe(ref);
    expect(poEdycji.ingested_at!.getTime()).toBe(przed.ingested_at!.getTime());
    expect(poEdycji.hash).toBe(przed.hash);
    // ... ale podbija updated_at ponad ingested_at.
    expect(poEdycji.updated_at.getTime()).toBeGreaterThan(poEdycji.ingested_at!.getTime());

    const lista = await (await api.get(`/api/ingest/trades?refs=${encodeURIComponent(ref)}`)).json();
    expect(lista.trades[0].editedInApp).toBe(true);

    const inny = trade(1, {
      sessionId: sesjaBacktestId,
      exits: [{ time: "1991-03-12T09:50:00-05:00", price: 20040 }],
      note: "to nie ma prawa wejść",
    });
    const r = await (await api.post("/api/ingest/trades", { data: { mode: "update", trades: [inny] } })).json();
    expect(r.results[0].status).toBe("conflict");
    expect(r.results[0].note).toContain("edytowano w aplikacji");

    const po = (await wierszTradu(ref))!;
    expect(po.pnl).toBe(poEdycji.pnl);
    expect(po.note).toBe("Moja ręczna poprawka w aplikacji");
    expect(po.updated_at.getTime()).toBe(poEdycji.updated_at.getTime());
  });

  test("błąd jednej pozycji nie blokuje reszty; komunikaty mówią co, dlaczego i jak poprawić", async () => {
    const paczka = [
      trade(2),
      trade(3, { symbol: "US100" }),
      trade(4, { entryTime: "1991-03-12T09:35" }),
      trade(5, { stoploss: 1 }),
      trade(6, { accountId: 999 }),
      trade(7, { exits: [{ price: 20010 }] }), // zamknięty bez czasu wyjścia
      trade(8, { tags: [{ category: "confluence", name: "nie-ma-takiego" }] }),
      trade(9),
    ];
    const b = await (await api.post("/api/ingest/trades", { data: { trades: paczka } })).json();
    const statusy = b.results.map((x: { status: string }) => x.status);
    expect(statusy).toEqual(["created", "error", "error", "error", "error", "error", "error", "created"]);
    expect(b.summary).toMatchObject({ created: 2, error: 6 });

    expect(b.results[1].error).toContain("US100");
    expect(b.results[1].error).toContain("nie kontrakt futures");
    expect(b.results[2].error).toContain("entryTime");
    expect(b.results[2].error).toContain("offsetem");
    expect(b.results[3].error).toContain("stoploss");
    expect(b.results[4].error).toContain("»999«");
    expect(b.results[4].error).toContain("Dostępne");
    expect(b.results[5].error).toContain("podaj czas wyjścia");
    expect(b.results[6].error).toContain("nie-ma-takiego");

    expect(await wierszTradu(trade(3).externalRef)).toBeUndefined();
    expect(await wierszTradu(trade(2).externalRef)).toBeDefined();
    expect(await wierszTradu(trade(9).externalRef)).toBeDefined();
    for (const nr of [2, 9]) utworzoneTrady.push((await wierszTradu(trade(nr).externalRef))!.id);

    // Ten sam externalRef dwa razy w jednej paczce to błąd drugiej pozycji.
    const dubel = await (await api.post("/api/ingest/trades", { data: { trades: [trade(2), trade(2)] } })).json();
    expect(dubel.results.map((x: { status: string }) => x.status)).toEqual(["unchanged", "error"]);
    expect(dubel.results[1].error).toContain("drugi raz");
  });

  test("symbole z TradingView i FX Replay: NQ1!, CME_MINI:NQZ2026, MNQ1! trafiają do właściwych instrumentów", async () => {
    const symbole: [string, string][] = [
      ["CME_MINI:NQZ2026", "NQ"],
      ["MNQ1!", "MNQ"],
      ["NQ", "NQ"],
      ["CME_MINI:NQ1", "NQ"], // FX Replay: kontrakt ciagly bez "!" (N+Q+1 to nie miesiac Q)
      ["CME_MINI:MNQ1", "MNQ"],
    ];
    const paczka = symbole.map(([s], i) => trade(20 + i, { symbol: s }));
    const b = await (await api.post("/api/ingest/trades", { data: { trades: paczka } })).json();
    expect(b.results.map((x: { status: string }) => x.status)).toEqual(Array(symbole.length).fill("created"));
    for (const [i, [, oczekiwany]] of symbole.entries()) {
      const w = (await wierszTradu(paczka[i].externalRef))!;
      utworzoneTrady.push(w.id);
      const [instr] = await sql`select i.symbol from trades t join instruments i on i.id = t.instrument_id where t.id = ${w.id}`;
      expect(instr.symbol).toBe(oczekiwany);
    }
  });

  /* --- zrzuty --------------------------------------------------------------- */

  async function png(kolor: string): Promise<Buffer> {
    return sharp({ create: { width: 320, height: 200, channels: 3, background: kolor } }).png().toBuffer();
  }

  function formularzZrzutow(pliki: { kolor: string; interval: string }[], bufory: Buffer[]): FormData {
    const f = new FormData();
    pliki.forEach((p, i) => {
      f.append("shot", new Blob([new Uint8Array(bufory[i])], { type: "image/png" }), `zrzut-${i}.png`);
      f.append("interval", p.interval);
    });
    return f;
  }

  test("zrzuty: zastępują wyłącznie zrzuty swojego pochodzenia, ręcznych nie ruszają, pliki znikają z dysku", async () => {
    const id = (await wierszTradu(trade(2).externalRef))!.id;
    const katalog = path.resolve(process.env.UPLOADS_DIR ?? "./.dane/zrzuty");

    // Zrzut ręczny (origin = manual), wstawiony wprost - tak jak zrobiłby go użytkownik w aplikacji.
    await sql`insert into screenshots (trade_id, file, origin, sort_order) values (${id}, ${`${id}/reczny.webp`}, 'manual', 0)`;

    const pliki1 = [{ kolor: "#cc3333", interval: "5m" }, { kolor: "#33cc33", interval: "1h" }];
    const r1 = await api.post(`/api/ingest/trades/${id}/screenshots`, {
      multipart: formularzZrzutow(pliki1, [await png("#cc3333"), await png("#33cc33")]),
    });
    expect(r1.status(), await r1.text()).toBe(200);
    const b1 = await r1.json();
    expect(b1.origin).toBe("fxreplay");
    expect(b1.replaced).toBe(0);
    expect(b1.screenshots.map((s: { interval: string }) => s.interval)).toEqual(["5m", "1h"]);

    const wiersze1 = await sql`select id, file, thumbnail, origin, interval from screenshots where trade_id = ${id} order by sort_order, id`;
    expect(wiersze1.map((w) => w.origin)).toEqual(["manual", "fxreplay", "fxreplay"]);
    const stare = wiersze1.filter((w) => w.origin === "fxreplay");
    for (const s of stare) expect(existsSync(path.join(katalog, s.file))).toBe(true);

    // Ponowne wysłanie: zastępuje oba zrzuty API jednym nowym.
    const r2 = await api.post(`/api/ingest/trades/${id}/screenshots`, {
      multipart: formularzZrzutow([{ kolor: "#3333cc", interval: "15m" }], [await png("#3333cc")]),
    });
    expect(r2.status()).toBe(200);
    expect((await r2.json()).replaced).toBe(2);
    const wiersze2 = await sql`select id, file, origin, interval from screenshots where trade_id = ${id} order by sort_order, id`;
    expect(wiersze2.map((w) => [w.origin, w.interval])).toEqual([["manual", null], ["fxreplay", "15m"]]);
    for (const s of stare) {
      expect(wiersze2.some((w) => w.id === s.id)).toBe(false);
      expect(existsSync(path.join(katalog, s.file))).toBe(false); // plik usunięty z dysku
      expect(existsSync(path.join(katalog, s.thumbnail))).toBe(false);
    }
    const nowy = wiersze2.find((w) => w.origin === "fxreplay")!;
    expect(existsSync(path.join(katalog, nowy.file))).toBe(true);

    // Zły interwał i zły typ pliku: 422 i stan bez zmian.
    const zlyInterwal = await api.post(`/api/ingest/trades/${id}/screenshots`, {
      multipart: formularzZrzutow([{ kolor: "#000000", interval: "7m" }], [await png("#000000")]),
    });
    expect(zlyInterwal.status()).toBe(422);
    expect((await zlyInterwal.json()).error).toContain("»7m«");

    const tekst = new FormData();
    tekst.append("shot", new Blob(["to nie jest obraz"], { type: "text/plain" }), "x.txt");
    const zlyTyp = await api.post(`/api/ingest/trades/${id}/screenshots`, { multipart: tekst });
    expect(zlyTyp.status()).toBe(422);
    expect((await zlyTyp.json()).error).toContain("PNG, JPEG, WEBP");
    const [ile] = await sql`select count(*)::int as n from screenshots where trade_id = ${id}`;
    expect(ile.n).toBe(2);

    // Nieistniejący trade.
    const brak = await api.post("/api/ingest/trades/99999999/screenshots", {
      multipart: formularzZrzutow([{ kolor: "#000000", interval: "" }], [await png("#000000")]),
      headers: {},
    });
    expect([400, 404]).toContain(brak.status());
  });

  /* --- oceny ---------------------------------------------------------------- */

  test("review: zapisuje ocenę z treścią reguł; ponowne wysłanie zachowuje zdanie użytkownika tylko przy niezmienionym werdykcie", async () => {
    const id = (await wierszTradu(trade(2).externalRef))!.id;
    const ocena = {
      basis: "chart",
      setupType: "kontynuacja",
      summaryMd: "FVG 5m w kierunku trendu",
      lesson: "Poczekać na domknięcie świecy",
      brainVerdict: "wejdz",
      brainPlan: { entry: 20000, stopLoss: 19990, takeProfit: 20020, interwalWejscia: "5m" },
      brainVersion: "abc1234",
      evidenceCutoff: "1991-03-12T09:34:00-05:00",
      model: "test-model",
      ruleChecks: [
        { ruleId: "R-001", ruleText: "Wchodzimy tylko w oknie 9:30-10:30", verdict: "pass", evidence: "09:35" },
        { ruleId: "R-002", ruleText: "Cel to niezapełniony FVG", verdict: "fail", evidence: "brak celu" },
        { ruleId: "R-003", ruleText: "ES potwierdza", verdict: "na" },
      ],
    };
    const r1 = await api.post(`/api/ingest/trades/${id}/reviews`, { data: ocena });
    expect(r1.status()).toBe(201);
    const b1 = await r1.json();
    expect(b1).toMatchObject({ created: true, ruleChecks: 3, userVerdictsKept: 0 });

    const [rev] = await sql`select * from trade_reviews where id = ${b1.reviewId}`;
    expect(rev).toMatchObject({ trade_id: id, basis: "chart", brain_verdict: "wejdz", brain_version: "abc1234", setup_type: "kontynuacja" });
    expect(rev.brain_plan).toMatchObject({ stopLoss: 19990, interwalWejscia: "5m" });
    expect(rev.evidence_cutoff.toISOString()).toBe("1991-03-12T14:34:00.000Z");
    const reguly = await sql`select rule_id, rule_text, verdict, evidence, user_verdict from trade_rule_checks where review_id = ${b1.reviewId} order by rule_id`;
    expect(reguly.map((x) => [x.rule_id, x.verdict, x.rule_text])).toEqual([
      ["R-001", "pass", "Wchodzimy tylko w oknie 9:30-10:30"],
      ["R-002", "fail", "Cel to niezapełniony FVG"],
      ["R-003", "na", "ES potwierdza"],
    ]);

    // Użytkownik zgadza się z oceną dwóch reguł (UI jeszcze nie ma - robi to samo, co zrobi przycisk).
    await sql`update trade_rule_checks set user_verdict = 'agree' where review_id = ${b1.reviewId} and rule_id in ('R-001', 'R-002')`;

    // Ponowne wysłanie: R-001 zmienia werdykt, R-002 bez zmian, R-003 znika, R-004 dochodzi.
    const druga = {
      ...ocena,
      ruleChecks: [
        { ruleId: "R-001", ruleText: "Wchodzimy tylko w oknie 9:30-10:30", verdict: "fail", evidence: "po przemyśleniu: 10:45" },
        { ruleId: "R-002", ruleText: "Cel to niezapełniony FVG (nowa treść)", verdict: "fail", evidence: "brak celu" },
        { ruleId: "R-004", ruleText: "SL za swingiem", verdict: "pass" },
      ],
    };
    const r2 = await api.post(`/api/ingest/trades/${id}/reviews`, { data: druga });
    expect(r2.status()).toBe(200);
    const b2 = await r2.json();
    expect(b2).toMatchObject({ created: false, reviewId: b1.reviewId, userVerdictsKept: 1 });
    const po = await sql`select rule_id, verdict, rule_text, user_verdict from trade_rule_checks where review_id = ${b1.reviewId} order by rule_id`;
    expect(po.map((x) => [x.rule_id, x.verdict, x.user_verdict])).toEqual([
      ["R-001", "fail", null], // werdykt się zmienił - zdanie użytkownika dotyczyło czego innego
      ["R-002", "fail", "agree"], // werdykt ten sam - zdanie zostaje
      ["R-004", "pass", null],
    ]);
    expect(po[1].rule_text).toBe("Cel to niezapełniony FVG (nowa treść)");
    const [ile] = await sql`select count(*)::int as n from trade_reviews where trade_id = ${id}`;
    expect(ile.n).toBe(1);

    // Druga podstawa to osobna ocena.
    const hist = await api.post(`/api/ingest/trades/${id}/reviews`, { data: { basis: "history", ruleChecks: [] } });
    expect(hist.status()).toBe(201);
    const [ile2] = await sql`select count(*)::int as n from trade_reviews where trade_id = ${id}`;
    expect(ile2.n).toBe(2);

    // Walidacja: reguła bez treści, zduplikowane id, nieznany trade.
    const bezTresci = await api.post(`/api/ingest/trades/${id}/reviews`, {
      data: { basis: "chart", ruleChecks: [{ ruleId: "R-9", verdict: "pass" }] },
    });
    expect(bezTresci.status()).toBe(400);
    expect((await bezTresci.json()).error).toContain("ruleText");
    const dubel = await api.post(`/api/ingest/trades/${id}/reviews`, {
      data: { basis: "chart", ruleChecks: [druga.ruleChecks[0], druga.ruleChecks[0]] },
    });
    expect(dubel.status()).toBe(400);
    const nieznany = await api.post("/api/ingest/trades/99999999/reviews", { data: { basis: "chart" } });
    expect(nieznany.status()).toBe(404);
    expect((await nieznany.json()).error).toContain("nie istnieje");
  });

  /* --- filtry w aplikacji (na prawdziwych danych z powyższych testów) -------- */

  test("filtry regula/werdykt/zgodnosc zawężają listę trade'ów w aplikacji", async ({ page }) => {
    const id = (await wierszTradu(trade(2).externalRef))!.id;
    const id9 = (await wierszTradu(trade(9).externalRef))!.id; // bez oceny AI
    const wiersz = (i: number) => page.locator(`a[href="/trades/${i}"]`);
    const lista = (q: string) => `/trades?zrodlo=wszystko&od=1991-03-01&do=1991-03-31&${q}`;

    await page.goto(lista(""));
    await expect(wiersz(id).first()).toBeVisible();
    await expect(wiersz(id9).first()).toBeVisible();

    // trade 2 ma R-002 = fail (ocena z wykresu) i R-001 = fail
    await page.goto(lista("regula=R-002&werdykt=fail"));
    await expect(wiersz(id).first()).toBeVisible();
    await expect(wiersz(id9)).toHaveCount(0);

    await page.goto(lista("regula=R-002&werdykt=pass"));
    await expect(wiersz(id)).toHaveCount(0);

    await page.goto(lista("zgodnosc=niezgodne"));
    await expect(wiersz(id).first()).toBeVisible();
    await expect(wiersz(id9)).toHaveCount(0);

    await page.goto(lista("zgodnosc=zgodne"));
    await expect(wiersz(id)).toHaveCount(0);

    await page.goto(lista("zgodnosc=nieocenione"));
    await expect(wiersz(id9).first()).toBeVisible();
    await expect(wiersz(id)).toHaveCount(0);

    await page.goto(lista("kategoria=realne"));
    await expect(wiersz(id).first()).toBeVisible();
  });

  test("kategorie kont i zrodlo=forward: prop_eval, CHECK fazy na koncie, rodzaj sesji", async ({ page }) => {
    // CHECK: faza prop tylko przy koncie prop - dowód na prawdziwej bazie.
    await expect(
      sql`insert into accounts (name, type, prop_phase) values ('E2E ingest zle', 'live', 'eval')`,
    ).rejects.toThrow(/accounts_prop_phase/);
    await expect(
      sql`insert into accounts (name, type, prop_phase) values ('E2E ingest zle2', 'prop', 'zly')`,
    ).rejects.toThrow(/accounts_prop_phase/);

    const [konto] = await sql`insert into accounts (name, type, prop_phase, currency) values ('E2E ingest prop eval', 'prop', 'eval', 'USD') returning id`;
    const [kontoBezFazy] = await sql`insert into accounts (name, type, currency) values ('E2E ingest prop bez fazy', 'prop', 'USD') returning id`;
    const [kontoDemo] = await sql`insert into accounts (name, type, currency) values ('E2E ingest demo', 'demo', 'USD') returning id`;

    const meta = await (await api.get("/api/ingest/meta")).json();
    expect(meta.accounts.find((a: { id: number }) => a.id === konto.id)).toMatchObject({ type: "prop", propPhase: "eval" });

    const paczka = [
      trade(30, { accountId: konto.id }),
      trade(31, { accountId: kontoBezFazy.id }),
      trade(32, { accountId: kontoDemo.id }),
      trade(33, { sessionId: sesjaForwardId }),
    ];
    const b = await (await api.post("/api/ingest/trades", { data: { trades: paczka } })).json();
    expect(b.results.map((x: { status: string }) => x.status)).toEqual(["created", "created", "created", "created"]);
    const ids = b.results.map((x: { id: number }) => x.id) as number[];
    utworzoneTrady.push(...ids);
    const wiersz = (i: number) => page.locator(`a[href="/trades/${i}"]`);
    const lista = (q: string) => `/trades?od=1991-03-01&do=1991-03-31&${q}`;

    await page.goto(lista("zrodlo=wszystko&kategoria=prop_eval"));
    await expect(wiersz(ids[0]).first()).toBeVisible();
    await expect(wiersz(ids[1])).toHaveCount(0);
    await expect(wiersz(ids[2])).toHaveCount(0);

    await page.goto(lista("zrodlo=wszystko&kategoria=prop_funded"));
    await expect(wiersz(ids[0])).toHaveCount(0);
    await expect(wiersz(ids[1])).toHaveCount(0); // prop bez fazy nie należy do żadnej kategorii

    await page.goto(lista("zrodlo=wszystko&kategoria=demo"));
    await expect(wiersz(ids[2]).first()).toBeVisible();
    await expect(wiersz(ids[0])).toHaveCount(0);

    // forward: tylko sesje rodzaju forward; backtest: tylko rodzaju backtest
    await page.goto(lista("zrodlo=forward"));
    await expect(wiersz(ids[3]).first()).toBeVisible();
    await expect(wiersz(utworzoneTrady[0])).toHaveCount(0);

    await page.goto(lista("zrodlo=backtest"));
    await expect(wiersz(utworzoneTrady[0]).first()).toBeVisible();
    await expect(wiersz(ids[3])).toHaveCount(0);
  });

  /* --- pominięcia i nagrobki ------------------------------------------------- */

  test("skips: pominięty ref daje skipped przy POST trades; istniejący trade nie jest pomijany", async () => {
    const refPominiety = `fxr:e2e-${RUN}-pomin`;
    const r = await api.post("/api/ingest/skips", {
      data: { skips: [{ externalRef: refPominiety, note: "otwarty przez pomyłkę" }, { externalRef: trade(2).externalRef }] },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.results.map((x: { status: string }) => x.status)).toEqual(["recorded", "trade_exists"]);

    const [w] = await sql`select reason, note from ingest_skips where external_ref = ${refPominiety}`;
    expect(w).toEqual({ reason: "client", note: "otwarty przez pomyłkę" });
    const [brak] = await sql`select count(*)::int as n from ingest_skips where external_ref = ${trade(2).externalRef}`;
    expect(brak.n).toBe(0);

    const t = await (await api.post("/api/ingest/trades", { data: { trades: [trade(40, { externalRef: refPominiety })] } })).json();
    expect(t.results[0].status).toBe("skipped");
    expect(await wierszTradu(refPominiety)).toBeUndefined();

    // Powtórka pominięcia jest idempotentna.
    const again = await (await api.post("/api/ingest/skips", { data: { skips: [{ externalRef: refPominiety }] } })).json();
    expect(again.results[0].status).toBe("already_skipped");
  });

  test("tag masowy z tabeli to edycja w aplikacji: kolejny update z API dostaje conflict (dodanie; zdjęcie pokrywa test na bazie)", async ({ page }) => {
    const dane = trade(70);
    const b = await (await api.post("/api/ingest/trades", { data: { trades: [dane] } })).json();
    expect(b.results[0].status).toBe("created");
    const id = b.results[0].id as number;
    utworzoneTrady.push(id);
    const przed = (await wierszTradu(dane.externalRef))!;
    expect(przed.updated_at.getTime()).toBe(przed.ingested_at!.getTime());

    const [tag] = await sql`select id from tags where name = ${TAG}`;
    const oznacz = async (tryb: "dodaj" | "zdejmij") => {
      // Tabela dziennika realnego: trade z konta glownego, dzien z 1991.
      await page.goto("/trades?od=1991-03-01&do=1991-03-31");
      await page.waitForLoadState("networkidle");
      await page.getByLabel(`Zaznacz trade ${id}`).check();
      if (tryb === "dodaj") {
        await page.getByLabel("Dodaj tag do zaznaczonych").selectOption(String(tag.id));
        await expect.poll(async () => {
          const [w] = await sql`select count(*)::int as n from trade_tags where trade_id = ${id} and tag_id = ${tag.id}`;
          return w.n;
        }).toBe(1);
      }
    };

    await oznacz("dodaj");
    let po = (await wierszTradu(dane.externalRef))!;
    expect(po.updated_at.getTime()).toBeGreaterThan(po.ingested_at!.getTime());
    let r = await (await api.post("/api/ingest/trades", {
      data: { mode: "update", trades: [{ ...dane, exits: [{ time: "1991-03-12T09:50:00-05:00", price: 20030 }] }] },
    })).json();
    expect(r.results[0].status).toBe("conflict");
    expect((await wierszTradu(dane.externalRef))!.pnl).toBe(przed.pnl); // nic nie nadpisano

  });

  test("skasowanie trade'a w aplikacji zostawia nagrobek, a kolejne wysłanie daje skipped", async ({ page }) => {
    const dane = trade(50);
    const b = await (await api.post("/api/ingest/trades", { data: { trades: [dane] } })).json();
    expect(b.results[0].status).toBe("created");
    const id = b.results[0].id as number;
    utworzoneTrady.push(id);

    page.once("dialog", (d) => d.accept());
    await page.goto(`/trades/${id}`);
    await page.getByRole("button", { name: "Usuń trade" }).click();
    await expect(page).toHaveURL(/\/trades$/);

    expect(await wierszTradu(dane.externalRef)).toBeUndefined();
    const [nagrobek] = await sql`select reason, note from ingest_skips where external_ref = ${dane.externalRef}`;
    expect(nagrobek.reason).toBe("deleted");

    for (const mode of ["create", "update"]) {
      const r = await (await api.post("/api/ingest/trades", { data: { mode, trades: [dane] } })).json();
      expect(r.results[0].status).toBe("skipped");
      expect(r.results[0].note).toContain("skasowany w aplikacji");
    }
    expect(await wierszTradu(dane.externalRef)).toBeUndefined();
  });

  test("skasowanie sesji z tradami z API zostawia nagrobki ich kluczy", async ({ page }) => {
    const sesja = await (
      await api.post("/api/ingest/backtest-sessions", { data: { externalRef: `fxr:e2e-${RUN}-do-skasowania`, name: `E2E do skasowania ${RUN}` } })
    ).json();
    const dane = trade(60, { sessionId: sesja.id });
    const b = await (await api.post("/api/ingest/trades", { data: { trades: [dane] } })).json();
    expect(b.results[0].status).toBe("created");

    page.once("dialog", (d) => d.accept());
    await page.goto(`/backtest/${sesja.id}`);
    await page.getByRole("button", { name: /Usuń sesję/ }).click();
    await expect(page).toHaveURL(/\/backtest$/);

    const [s] = await sql`select count(*)::int as n from backtest_sessions where id = ${sesja.id}`;
    expect(s.n).toBe(0);
    expect(await wierszTradu(dane.externalRef)).toBeUndefined();
    const [nagrobek] = await sql`select reason from ingest_skips where external_ref = ${dane.externalRef}`;
    expect(nagrobek.reason).toBe("deleted");
  });

  test("eksport z aplikacji (Ustawienia -> Dane) zawiera oceny, reguły i nagrobki", async ({ page }) => {
    await page.goto("/settings/data");
    const [pobranie] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Pobierz kopię w JSON" }).click(),
    ]);
    const sciezka = await pobranie.path();
    const eksport = JSON.parse(await (await import("node:fs/promises")).readFile(sciezka, "utf8"));
    expect(Array.isArray(eksport.tradeReviews)).toBe(true);
    expect(Array.isArray(eksport.tradeRuleChecks)).toBe(true);
    expect(Array.isArray(eksport.ingestSkips)).toBe(true);
    expect(eksport.tradeReviews.length).toBeGreaterThan(0);
    expect(eksport.tradeRuleChecks.some((r: { ruleText: string }) => r.ruleText.includes("niezapełniony FVG"))).toBe(true);
    expect(eksport.ingestSkips.some((x: { externalRef: string }) => x.externalRef.includes("e2e-"))).toBe(true);
  });
});
