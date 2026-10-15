import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, zapiszSlowa, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Slepa ocena w KAZDYM odczycie (audyt S1, 15.10.2026): dopoki trade jest otwarty i ma werdykt AI wydany przed wynikiem,
 * nic, co powstalo PO wejsciu i moze zdradzic wynik, nie wychodzi z API: ani z GET /trades/:id, ani z /user-words,
 * /days/:date, /chart-annotations, /search. To, co napisano PRZED wejsciem (plan), zostaje widoczne. Po zamknieciu trade'a
 * wszystko wraca. Dowodem jest odczyt prawdziwych tras na lokalnej bazie.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("slepa ocena we wszystkich odczytach (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let instrumentId = 0;
  let kontoId = 0;
  const znacznik = unikat("slepa");
  const DZIEN = "1985-02-11";
  const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
  const TOKEN = `ZLOTYKLUCZ${Date.now().toString(36)}`;

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    const [k] = await sql`insert into accounts (name, type) values (${`SLEPA-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
  });
  afterAll(async () => {
    await sql`delete from chart_annotations where trade_id in (select id from trades where account_id = ${kontoId})`;
    await sql`delete from day_notes where day = ${DZIEN}`;
    await sql`delete from trades where account_id = ${kontoId}`;
    await sprzatnijNowe(sql, [rw.id, ro.id]);
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const swiece = () => [
    { t: `${DZIEN}T14:20:00Z`, o: 20000, h: 20010, l: 19995, c: 20005 },
    { t: `${DZIEN}T14:25:00Z`, o: 20005, h: 20015, l: 20000, c: 20012 },
  ];
  const get = (modul: Promise<Record<string, unknown>>, sciezka: string, ctx?: ReturnType<typeof PARAMS>) => wywolaj(modul, "GET", sciezka, { token: ro.token }, ctx);
  const ocena = (id: number) =>
    wywolaj(import("@/app/api/v2/trades/[id]/reviews/route"), "POST", `/trades/${id}/reviews`, { token: rw.token, cialo: { basis: "chart", brainVerdict: "wejdz", model: "claude-opus-5-5", evidence: { intervalMinutes: 5, candles: swiece() } } }, PARAMS({ id: String(id) }));

  async function przygotuj() {
    const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open", wejscie: 20000, sl: 19990 });
    await sql`update trades set entry_time = ${`${DZIEN}T14:35:00Z`}::timestamptz, note = ${`Notatka ${TOKEN} z wynikiem`} where id = ${id}`;
    const przed = await zapiszSlowa(rw.token, `Plan przed wejsciem: czekam na sweep ${TOKEN}`, { tradeId: id, capturedAt: `${DZIEN}T14:00:00Z` });
    const po = await zapiszSlowa(rw.token, `Po fakcie wygralem dwa R ${TOKEN}`, { tradeId: id, capturedAt: `${DZIEN}T15:00:00Z` });
    const dnia = await zapiszSlowa(rw.token, `Podsumowanie dnia: +2R ${TOKEN}`, { day: DZIEN, capturedAt: `${DZIEN}T16:00:00Z` });
    const dniaPrzed = await zapiszSlowa(rw.token, `Rano: plan dnia ${TOKEN}`, { day: DZIEN, capturedAt: `${DZIEN}T13:00:00Z` });
    const adn = await wywolaj(import("@/app/api/v2/chart-annotations/route"), "POST", "/chart-annotations", {
      token: rw.token,
      cialo: {
        platform: "fxreplay",
        tradeId: id,
        annotations: [
          { externalId: `po-${znacznik}`, shape: "text", price: 20040, text: `Cel osiagniety ${TOKEN}`, sha256: sha(`Cel osiagniety ${TOKEN}`), raw: {}, capturedAt: `${DZIEN}T15:10:00Z` },
          { externalId: `przed-${znacznik}`, shape: "text", price: 19990, text: `Stop tu ${TOKEN}`, sha256: sha(`Stop tu ${TOKEN}`), raw: {}, capturedAt: `${DZIEN}T14:10:00Z` },
        ],
      },
    });
    expect(adn.status, JSON.stringify(adn.json)).toBe(201);
    const pd = await wywolaj(import("@/app/api/v2/days/[date]/route"), "PUT", `/days/${DZIEN}`, { token: rw.token, cialo: { accountId: kontoId, preSession: "Rano", postSession: `Review po sesji ${TOKEN}: wygrana` } }, PARAMS({ date: DZIEN }));
    expect(pd.status, JSON.stringify(pd.json)).toBeLessThan(300);
    const o = await ocena(id);
    expect(o.status, JSON.stringify(o.json)).toBe(201);
    return { id, przed, po, dnia, dniaPrzed };
  }

  it("otwarty trade z werdyktem: /user-words, /days, /chart-annotations, /search i /trades/:id nie zdradzaja nic z czasu po wejsciu; po zamknieciu wszystko wraca", async () => {
    const { id, przed, po, dnia, dniaPrzed } = await przygotuj();
    const idy = (r: { json: { words?: { id: number }[]; userWords?: { id: number }[] } }) => (r.json.words ?? r.json.userWords ?? []).map((w) => w.id);

    // --- ukryte ---
    const slowaTradu = await get(import("@/app/api/v2/user-words/route"), `/user-words?tradeId=${id}`);
    expect(idy(slowaTradu)).toContain(przed.id);
    expect(idy(slowaTradu)).not.toContain(po.id);
    const slowaDnia = await get(import("@/app/api/v2/user-words/route"), `/user-words?day=${DZIEN}`);
    expect(idy(slowaDnia)).toEqual(expect.arrayContaining([dniaPrzed.id]));
    expect(idy(slowaDnia)).not.toContain(po.id);
    expect(idy(slowaDnia)).not.toContain(dnia.id);

    const dzien = await get(import("@/app/api/v2/days/[date]/route"), `/days/${DZIEN}?accountId=${kontoId}`, PARAMS({ date: DZIEN }));
    expect(dzien.status).toBe(200);
    zgodneZKontraktem("get", "/days/{date}", dzien.json);
    expect(dzien.json.resultHidden).toBe(true);
    expect(dzien.json.dayNote.postSession).toBeNull();
    expect(dzien.json.dayNote.preSession).toBe("Rano");
    expect(idy({ json: dzien.json })).toEqual(expect.arrayContaining([dniaPrzed.id]));
    expect(idy({ json: dzien.json })).not.toContain(dnia.id);

    const adn = await get(import("@/app/api/v2/chart-annotations/route"), `/chart-annotations?tradeId=${id}`);
    const poAdn = adn.json.annotations.find((a: { externalId: string }) => a.externalId === `po-${znacznik}`);
    const przedAdn = adn.json.annotations.find((a: { externalId: string }) => a.externalId === `przed-${znacznik}`);
    expect(poAdn.words).toBeNull();
    expect(przedAdn.words.text).toContain("Stop tu");

    const szukaj = await get(import("@/app/api/v2/search/route"), `/search?q=${TOKEN}`);
    expect(szukaj.status).toBe(200);
    const znalezione = szukaj.json.results.map((r: { type: string; id: number }) => `${r.type}:${r.id}`);
    expect(znalezione).toContain(`user_words:${przed.id}`);
    expect(znalezione).toContain(`user_words:${dniaPrzed.id}`);
    expect(znalezione).not.toContain(`user_words:${po.id}`);
    expect(znalezione).not.toContain(`user_words:${dnia.id}`);
    expect(znalezione).not.toContain(`trade:${id}`); // notatka trade'a z wynikiem

    const szczegoly = await get(import("@/app/api/v2/trades/[id]/route"), `/trades/${id}`, PARAMS({ id: String(id) }));
    zgodneZKontraktem("get", "/trades/{id}", szczegoly.json);
    expect(szczegoly.json.resultHidden).toBe(true);
    const wTradzie = szczegoly.json.userWords.map((w: { id: number }) => w.id);
    expect(wTradzie).toContain(przed.id);
    expect(wTradzie).not.toContain(po.id);
    expect(szczegoly.json.chartAnnotations.find((a: { externalId: string }) => a.externalId === `po-${znacznik}`).words).toBeNull();
    expect(JSON.stringify(szczegoly.json)).not.toContain("wygralem dwa R");
    expect(JSON.stringify(szczegoly.json)).not.toContain("Cel osiagniety");

    // --- po zamknieciu wszystko wraca ---
    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where id = ${id}`;
    expect(idy(await get(import("@/app/api/v2/user-words/route"), `/user-words?tradeId=${id}`))).toEqual(expect.arrayContaining([przed.id, po.id]));
    const dzienPo = await get(import("@/app/api/v2/days/[date]/route"), `/days/${DZIEN}?accountId=${kontoId}`, PARAMS({ date: DZIEN }));
    expect(dzienPo.json.resultHidden).toBe(false);
    expect(dzienPo.json.dayNote.postSession).toContain("wygrana");
    expect(idy({ json: dzienPo.json })).toContain(dnia.id);
    const adnPo = await get(import("@/app/api/v2/chart-annotations/route"), `/chart-annotations?tradeId=${id}`);
    expect(adnPo.json.annotations.find((a: { externalId: string }) => a.externalId === `po-${znacznik}`).words.text).toContain("Cel osiagniety");
    const szukajPo = await get(import("@/app/api/v2/search/route"), `/search?q=${TOKEN}`);
    const znalezionePo = szukajPo.json.results.map((r: { type: string; id: number }) => `${r.type}:${r.id}`);
    expect(znalezionePo).toEqual(expect.arrayContaining([`user_words:${po.id}`, `user_words:${dnia.id}`, `trade:${id}`]));
  });

  it("GET /trades/:id: zrzuty zrobione po wejsciu traca podpis, czas i stan wykresu; tresc korekty uzytkownika (summaryMd) jest ukryta", async () => {
    const { id } = await przygotuj();
    const [{ id: ocenaId }] = await sql`select id from trade_reviews where trade_id = ${id} and kind = 'ai'`;
    await sql`insert into screenshots (trade_id, file, thumbnail, width, height, sort_order, origin, sha256, captured_at, chart_state, caption)
              values (${id}, ${`t/${id}/po.webp`}, ${`t/${id}/po-mini.webp`}, 10, 10, 0, 'manual', ${sha("po")}, ${`${DZIEN}T15:30:00Z`}, ${sql.json({ symbol: "NQ1!", zakres: "po wyniku" })}, ${`Cel zrealizowany ${TOKEN}`}),
                     (${id}, ${`t/${id}/przed.webp`}, ${`t/${id}/przed-mini.webp`}, 10, 10, 1, 'manual', ${sha("przed")}, ${`${DZIEN}T14:00:00Z`}, ${sql.json({ symbol: "NQ1!" })}, ${"Setup przed wejsciem"})`;
    const slowa = await zapiszSlowa(rw.token, `Nie zgadzam sie, bo wygralem ${TOKEN}`, { tradeId: id, role: "review.override", capturedAt: `${DZIEN}T14:20:00Z` });
    const k = await wywolaj(import("@/app/api/v2/trades/[id]/reviews/[reviewId]/override/route"), "POST", `/trades/${id}/reviews/${ocenaId}/override`, { token: rw.token, cialo: { wordsId: slowa.id, brainVerdict: "odpusc", summaryMd: `Wygralem dwa R ${TOKEN}` } }, PARAMS({ id: String(id), reviewId: String(ocenaId) }));
    expect(k.status, JSON.stringify(k.json)).toBe(201);

    const t = await get(import("@/app/api/v2/trades/[id]/route"), `/trades/${id}`, PARAMS({ id: String(id) }));
    zgodneZKontraktem("get", "/trades/{id}", t.json);
    expect(t.json.resultHidden).toBe(true);
    const po = t.json.screenshots.find((s: { file: string }) => s.file.endsWith("po.webp"));
    const przed = t.json.screenshots.find((s: { file: string }) => s.file.endsWith("przed.webp"));
    expect(po).toMatchObject({ caption: null, capturedAt: null, chartState: null });
    expect(przed.caption).toBe("Setup przed wejsciem");
    expect(przed.capturedAt).not.toBeNull();
    const korekta = t.json.reviews.find((r: { kind: string }) => r.kind === "user_override");
    expect(korekta.summaryMd).toBeNull();
    expect(JSON.stringify(t.json)).not.toContain("Cel zrealizowany");
    expect(JSON.stringify(t.json)).not.toContain("Wygralem dwa R");
  });
});
