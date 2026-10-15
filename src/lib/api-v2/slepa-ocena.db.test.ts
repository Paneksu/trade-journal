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
    expect(poAdn).toBeUndefined(); // rysunek po wejsciu (geometria) nie wychodzi wcale
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
    expect(szczegoly.json.chartAnnotations.find((a: { externalId: string }) => a.externalId === `po-${znacznik}`)).toBeUndefined();
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

  it("dopiski planu (po zamrozeniu) i notatki przypiete do trade'a nie wychodza z /trade-plans/:id, /trades/:id, /notes i /search, dopoki wynik jest ukryty", async () => {
    const { id } = await przygotuj();
    const plan = await wywolaj(import("@/app/api/v2/trade-plans/route"), "POST", "/trade-plans", {
      token: rw.token,
      cialo: { accountId: kontoId, symbol: "NQ1!", day: DZIEN, direction: "long", entryPrice: 20000, stopLoss: 19990, contracts: 1, tradeId: id },
    });
    expect(plan.status, JSON.stringify(plan.json)).toBe(201);
    const planId = plan.json.plan.id as number;
    // dopisek PO wejsciu (przez API: created_at = teraz) i dopisek sprzed wejscia (wstawiony SQL-em z czasem sprzed wejscia)
    const slowaPo = await zapiszSlowa(rw.token, `SL na BE po +1R ${TOKEN}`, { tradeId: id, capturedAt: `${DZIEN}T15:00:00Z` });
    const slowaPrzed = await zapiszSlowa(rw.token, `Korekta planu przed wejsciem ${TOKEN}`, { tradeId: id, capturedAt: `${DZIEN}T14:10:00Z` });
    const po = await wywolaj(import("@/app/api/v2/trade-plans/[id]/addenda/route"), "POST", `/trade-plans/${planId}/addenda`, { token: rw.token, cialo: { field: "stop_loss", newValue: 20000, wordsId: slowaPo.id } }, PARAMS({ id: String(planId) }));
    expect(po.status, JSON.stringify(po.json)).toBe(201);
    await sql`insert into trade_plan_addenda (plan_id, field, new_value, words_id, created_at) values (${planId}, 'take_profit', ${sql.json(20050)}, ${slowaPrzed.id}, ${`${DZIEN}T14:11:00Z`})`;
    const nota = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: `Pojecie ${TOKEN}`, bodyMd: `Trade wygral dwa R ${TOKEN}`, tradeId: id } });
    expect(nota.status, JSON.stringify(nota.json)).toBe(201);
    const notaId = nota.json.id as number;

    const plan1 = await get(import("@/app/api/v2/trade-plans/[id]/route"), `/trade-plans/${planId}`, PARAMS({ id: String(planId) }));
    expect(plan1.status).toBe(200);
    zgodneZKontraktem("get", "/trade-plans/{id}", plan1.json);
    expect(plan1.json.addenda.map((a: { wordsId: number }) => a.wordsId)).toEqual([slowaPrzed.id]);
    expect(JSON.stringify(plan1.json)).not.toContain("SL na BE po +1R");
    const t = await get(import("@/app/api/v2/trades/[id]/route"), `/trades/${id}`, PARAMS({ id: String(id) }));
    expect(JSON.stringify(t.json.plan)).not.toContain("SL na BE po +1R");

    expect((await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${notaId}`, PARAMS({ id: String(notaId) }))).status).toBe(404);
    const lista = await get(import("@/app/api/v2/notes/route"), `/notes?tradeId=${id}`);
    expect(lista.json.notes.map((n: { id: number }) => n.id)).not.toContain(notaId);
    const szukaj = await get(import("@/app/api/v2/search/route"), `/search?q=${TOKEN}&types=notes`);
    expect(szukaj.json.results.map((r: { id: number }) => r.id)).not.toContain(notaId);

    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where id = ${id}`;
    const planPo = await get(import("@/app/api/v2/trade-plans/[id]/route"), `/trade-plans/${planId}`, PARAMS({ id: String(planId) }));
    expect(planPo.json.addenda).toHaveLength(2);
    expect((await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${notaId}`, PARAMS({ id: String(notaId) }))).status).toBe(200);
    const listaPo = await get(import("@/app/api/v2/notes/route"), `/notes?tradeId=${id}`);
    expect(listaPo.json.notes.map((n: { id: number }) => n.id)).toContain(notaId);
    const szukajPo = await get(import("@/app/api/v2/search/route"), `/search?q=${TOKEN}&types=notes`);
    expect(szukajPo.json.results.map((r: { id: number }) => r.id)).toContain(notaId);
  });

  it("notatki przypiete do trade'a: ukryte sa tylko te po wejsciu albo zmieniane po wejsciu; notatka sprzed wejscia i dopiski sprzed wejscia zostaja widoczne (Slowa uzytkownika, 15.10.2026)", async () => {
    const { id } = await przygotuj();
    const mk = async (kind: string, tytul: string) => {
      const r = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind, title: `${tytul} ${TOKEN}`, bodyMd: `Tresc ${TOKEN}`, tradeId: id } });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      return r.json.id as number;
    };
    const przed = await mk("concept", "Sprzed wejscia");
    const edytowana = await mk("concept", "Edytowana po wejsciu");
    const po = await mk("concept", "Po wejsciu");
    const strategia = await mk("strategy", "Strategia z dopiskami");
    const stempel = (nid: number, c: string, u: string) => sql`update notes set created_at = ${c}::timestamptz, updated_at = ${u}::timestamptz where id = ${nid}`;
    await stempel(przed, `${DZIEN}T14:00:00Z`, `${DZIEN}T14:05:00Z`);
    await stempel(edytowana, `${DZIEN}T14:00:00Z`, `${DZIEN}T15:00:00Z`);
    await stempel(strategia, `${DZIEN}T14:00:00Z`, `${DZIEN}T14:05:00Z`);
    await stempel(po, `${DZIEN}T15:00:00Z`, `${DZIEN}T15:00:00Z`);

    const status = async (nid: number) => (await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${nid}`, PARAMS({ id: String(nid) }))).status;
    expect(await status(przed)).toBe(200);
    expect(await status(edytowana)).toBe(404); // zmieniana po wejsciu: ukryta w calosci (wybor bezpieczniejszy)
    expect(await status(po)).toBe(404);
    const lista = (await get(import("@/app/api/v2/notes/route"), `/notes?tradeId=${id}`)).json.notes.map((n: { id: number }) => n.id);
    expect(lista).toContain(przed);
    expect(lista).not.toContain(edytowana);
    expect(lista).not.toContain(po);
    const znalezione = (await get(import("@/app/api/v2/search/route"), `/search?q=${TOKEN}&types=notes`)).json.results.map((r: { id: number }) => r.id);
    expect(znalezione).toContain(przed);
    expect(znalezione).not.toContain(edytowana);
    expect(znalezione).not.toContain(po);

    // dopiski do widocznej notatki: sprzed wejscia widoczny, po wejsciu ukryty
    const slowa = await zapiszSlowa(rw.token, `Cytat do dopiskow ${TOKEN}`, { tradeId: id, capturedAt: `${DZIEN}T14:00:00Z` });
    const dopisz = async (tresc: string) => {
      const r = await wywolaj(import("@/app/api/v2/notes/[id]/additions/route"), "POST", `/notes/${strategia}/additions`, { token: rw.token, cialo: { bodyMd: tresc, origin: "ai", tradeId: id, quoteWordsId: slowa.id } }, PARAMS({ id: String(strategia) }));
      expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
      return r.json.id as number;
    };
    const dopisekPo = await dopisz(`Dopisek po wejsciu ${TOKEN}`);
    // created_at jest niezmienne, wiec dopisek »sprzed wejscia« wstawiamy kopia wiersza z wczesniejszym czasem
    const [{ id: dopisekPrzed }] = await sql`insert into note_additions (note_id, body_md, origin, trade_id, quote_words_id, created_at)
      select note_id, ${`Dopisek sprzed wejscia ${TOKEN}`}, origin, trade_id, quote_words_id, ${`${DZIEN}T14:10:00Z`}::timestamptz from note_additions where id = ${dopisekPo} returning id`;
    await stempel(strategia, `${DZIEN}T14:00:00Z`, `${DZIEN}T14:05:00Z`); // dopisek mogl odswiezyc updated_at
    const dopiski = (await get(import("@/app/api/v2/notes/[id]/additions/route"), `/notes/${strategia}/additions`, PARAMS({ id: String(strategia) }))).json.additions.map((a: { id: number }) => a.id);
    expect(dopiski).toEqual([dopisekPrzed]);
    expect(dopiski).not.toContain(dopisekPo);

    // po zamknieciu trade'a wszystko wraca
    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where id = ${id}`;
    expect(await status(edytowana)).toBe(200);
    expect(await status(po)).toBe(200);
    const dopiskiPo = (await get(import("@/app/api/v2/notes/[id]/additions/route"), `/notes/${strategia}/additions`, PARAMS({ id: String(strategia) }))).json.additions.map((a: { id: number }) => a.id);
    expect([...dopiskiPo].sort()).toEqual([dopisekPrzed, dopisekPo].sort());
  });

  it("tytuly ukrytych notatek nie wyciekaja: lista notatek dnia, links w /trades/:id, backlinks i links w /notes/:id; additions ukrytej notatki = 404", async () => {
    const { id } = await przygotuj();
    const mk = async (tytul: string, bodyMd: string, tradeId?: number) => {
      const r = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: tytul, bodyMd, ...(tradeId ? { tradeId } : {}), day: DZIEN } });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      return r.json.id as number;
    };
    const widoczna = await mk(`Widoczna ${TOKEN}`, `Tresc widocznej ${TOKEN}`, id);
    const ukryta = await mk(`SekretnyTytul${TOKEN}`, `Odsyla do [[Widoczna ${TOKEN}]] ${TOKEN}`, id);
    const odsylajaca = await mk(`Odsylajaca ${TOKEN}`, `Patrz [[SekretnyTytul${TOKEN}]]`);
    const stempel = (nid: number, c: string, u: string) => sql`update notes set created_at = ${c}::timestamptz, updated_at = ${u}::timestamptz where id = ${nid}`;
    await stempel(widoczna, `${DZIEN}T14:00:00Z`, `${DZIEN}T14:05:00Z`);
    await stempel(ukryta, `${DZIEN}T15:00:00Z`, `${DZIEN}T15:00:00Z`);
    await stempel(odsylajaca, `${DZIEN}T12:00:00Z`, `${DZIEN}T12:00:00Z`);
    await sql`insert into trade_note_links (trade_id, note_id, role, origin) values (${id}, ${widoczna}, 'concept', 'user'), (${id}, ${ukryta}, 'mistake', 'ai')`;
    const SEKRET = `SekretnyTytul${TOKEN}`;

    const dzien = await get(import("@/app/api/v2/days/[date]/route"), `/days/${DZIEN}?accountId=${kontoId}`, PARAMS({ date: DZIEN }));
    const noteIds = dzien.json.notes.map((n: { id: number }) => n.id);
    expect(noteIds).toContain(widoczna);
    expect(noteIds).not.toContain(ukryta);
    expect(JSON.stringify(dzien.json)).not.toContain(SEKRET);

    const t = await get(import("@/app/api/v2/trades/[id]/route"), `/trades/${id}`, PARAMS({ id: String(id) }));
    zgodneZKontraktem("get", "/trades/{id}", t.json);
    expect(t.json.links.map((l: { noteId: number }) => l.noteId)).toEqual([widoczna]);
    expect(JSON.stringify(t.json)).not.toContain(SEKRET);
    expect(t.json.hiddenFields).toContain("links(notatki po wejsciu)");

    const wid = await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${widoczna}`, PARAMS({ id: String(widoczna) }));
    expect(wid.json.backlinks.map((b: { id: number }) => b.id)).not.toContain(ukryta);
    expect(JSON.stringify(wid.json)).not.toContain(SEKRET);
    const odsy = await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${odsylajaca}`, PARAMS({ id: String(odsylajaca) }));
    expect(odsy.json.links[0].resolved).toBeNull();

    // notatka ukryta w calosci: i ona sama, i jej dopiski to 404
    expect((await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${ukryta}`, PARAMS({ id: String(ukryta) }))).status).toBe(404);
    expect((await get(import("@/app/api/v2/notes/[id]/additions/route"), `/notes/${ukryta}/additions`, PARAMS({ id: String(ukryta) }))).status).toBe(404);

    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where id = ${id}`;
    const po = await get(import("@/app/api/v2/trades/[id]/route"), `/trades/${id}`, PARAMS({ id: String(id) }));
    expect(po.json.links.map((l: { noteId: number }) => l.noteId).sort()).toEqual([widoczna, ukryta].sort());
    expect((await get(import("@/app/api/v2/notes/[id]/additions/route"), `/notes/${ukryta}/additions`, PARAMS({ id: String(ukryta) }))).status).toBe(200);
  });

  for (const sc of [
    { opis: "wejscie przesuniete PO czasie przypiecia planu", nowe: "18:00", t: "15:00" },
    { opis: "wejscie przesuniete PRZED czas przypiecia planu", nowe: "13:00", t: "14:00" },
  ]) {
    it(`jedna definicja wejscia = najwczesniejsze znane (least): ${sc.opis}; slowa, notatki, dopiski notatek i dopiski planu z czasu po nim sa ukryte`, async () => {
      const { id } = await przygotuj();
      const plan = await wywolaj(import("@/app/api/v2/trade-plans/route"), "POST", "/trade-plans", {
        token: rw.token,
        cialo: { accountId: kontoId, symbol: "NQ1!", day: DZIEN, direction: "long", entryPrice: 20000, stopLoss: 19990, contracts: 1, tradeId: id },
      });
      expect(plan.status, JSON.stringify(plan.json)).toBe(201);
      const planId = plan.json.plan.id as number;
      // wejscie z przypiecia = 14:35; teraz entry_time trade'a zmienia sie
      await sql`update trades set entry_time = ${`${DZIEN}T${sc.nowe}:00Z`}::timestamptz where id = ${id}`;
      const T = `${DZIEN}T${sc.t}:00Z`;

      const slowo = await zapiszSlowa(rw.token, `Slowo z czasu po wejsciu ${unikat("sc")} ${TOKEN}`, { tradeId: id, capturedAt: T });
      const mkNote = async (tytul: string, tradeId?: number) => {
        const r = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: tytul, bodyMd: `Tresc ${TOKEN}`, ...(tradeId ? { tradeId } : {}) } });
        expect(r.status, JSON.stringify(r.json)).toBe(201);
        return r.json.id as number;
      };
      const notatka = await mkNote(`Notatka scen ${unikat("n")} ${TOKEN}`, id);
      await sql`update notes set created_at = ${T}::timestamptz, updated_at = ${T}::timestamptz where id = ${notatka}`;
      const bezTradu = await mkNote(`Strategia bez trade'a ${unikat("s")} ${TOKEN}`);
      await sql`update notes set kind = 'strategy', created_at = ${`${DZIEN}T11:00:00Z`}::timestamptz, updated_at = ${`${DZIEN}T11:00:00Z`}::timestamptz where id = ${bezTradu}`;
      // dopisek z tradeId ukrytego trade'a do notatki BEZ trade'a (created_at niezmienne: kopia wiersza z czasem T)
      const slowaCytat = await zapiszSlowa(rw.token, `Cytat sc ${unikat("q")}`, { tradeId: id, capturedAt: `${DZIEN}T14:00:00Z` });
      const dop = await wywolaj(import("@/app/api/v2/notes/[id]/additions/route"), "POST", `/notes/${bezTradu}/additions`, { token: rw.token, cialo: { bodyMd: `Dopisek ${unikat("d")}`, origin: "ai", tradeId: id, quoteWordsId: slowaCytat.id } }, PARAMS({ id: String(bezTradu) }));
      expect(dop.status, JSON.stringify(dop.json)).toBeLessThan(300);
      const [{ id: dopisekT }] = await sql`insert into note_additions (note_id, body_md, origin, trade_id, quote_words_id, created_at)
        select note_id, body_md || ' (czas T)', origin, trade_id, quote_words_id, ${T}::timestamptz from note_additions where id = ${dop.json.id} returning id`;
      const [{ id: dopisekPrzed }] = await sql`insert into note_additions (note_id, body_md, origin, trade_id, quote_words_id, created_at)
        select note_id, body_md || ' (przed)', origin, trade_id, quote_words_id, ${`${DZIEN}T12:00:00Z`}::timestamptz from note_additions where id = ${dop.json.id} returning id`;
      await sql`insert into trade_plan_addenda (plan_id, field, new_value, words_id, created_at) values (${planId}, 'stop_loss', ${sql.json(19995)}, ${slowaCytat.id}, ${T}::timestamptz)`;

      const slowa = (await get(import("@/app/api/v2/user-words/route"), `/user-words?tradeId=${id}`)).json.words.map((w: { id: number }) => w.id);
      expect(slowa).not.toContain(slowo.id);
      const noty = (await get(import("@/app/api/v2/notes/route"), `/notes?tradeId=${id}`)).json.notes.map((n: { id: number }) => n.id);
      expect(noty).not.toContain(notatka);
      const dopiski = (await get(import("@/app/api/v2/notes/[id]/additions/route"), `/notes/${bezTradu}/additions`, PARAMS({ id: String(bezTradu) }))).json.additions.map((a: { id: number }) => a.id);
      expect(dopiski).toContain(dopisekPrzed);
      expect(dopiski).not.toContain(dopisekT);
      const p = await get(import("@/app/api/v2/trade-plans/[id]/route"), `/trade-plans/${planId}`, PARAMS({ id: String(planId) }));
      expect(p.json.addenda.map((a: { newValue: unknown }) => a.newValue)).not.toContain(19995);
    });
  }

  it("B1/B2: PATCH ukrytej notatki i PUT interpretacji ukrytych slow to 404 przed jakimkolwiek odczytem (takze przed 409 z trescia)", async () => {
    const { id } = await przygotuj();
    const nota = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: `Do edycji ${unikat("e")} ${TOKEN}`, bodyMd: `Sekret ${TOKEN}`, tradeId: id } });
    expect(nota.status, JSON.stringify(nota.json)).toBe(201);
    const notaId = nota.json.id as number;
    await sql`update notes set created_at = ${`${DZIEN}T15:00:00Z`}::timestamptz, updated_at = ${`${DZIEN}T15:00:00Z`}::timestamptz where id = ${notaId}`;
    // zla rewizja: dla widocznej notatki to 409 z `current` (trescia); dla ukrytej ma byc 404 bez tresci
    const patch = await wywolaj(import("@/app/api/v2/notes/[id]/route"), "PATCH", `/notes/${notaId}`, { token: rw.token, cialo: { title: `Nowy ${unikat("n")}` }, naglowki: { "if-match": "999" } }, PARAMS({ id: String(notaId) }));
    expect(patch.status, JSON.stringify(patch.json)).toBe(404);
    expect(JSON.stringify(patch.json)).not.toContain("Sekret");

    const slowa = await zapiszSlowa(rw.token, `Slowa po wejsciu ${unikat("s")} ${TOKEN}`, { tradeId: id, capturedAt: `${DZIEN}T15:30:00Z` });
    const put = await wywolaj(import("@/app/api/v2/user-words/[id]/interpretation/route"), "PUT", `/user-words/${slowa.id}/interpretation`, { token: rw.token, cialo: { text: "Interpretacja", model: "claude-opus-5-5" } }, PARAMS({ id: String(slowa.id) }));
    expect(put.status, JSON.stringify(put.json)).toBe(404);
    expect((await sql`select ai_interpretation from user_words where id = ${slowa.id}`)[0].ai_interpretation).toBeNull();
    // po zamknieciu trade'a to znowu zwykla sciezka
    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where id = ${id}`;
    const po = await wywolaj(import("@/app/api/v2/user-words/[id]/interpretation/route"), "PUT", `/user-words/${slowa.id}/interpretation`, { token: rw.token, cialo: { text: "Interpretacja", model: "claude-opus-5-5" } }, PARAMS({ id: String(slowa.id) }));
    expect(po.status, JSON.stringify(po.json)).toBeLessThan(300);
  });

  it("B4: look-ahead liczy od NAJWCZESNIEJSZEGO wejscia: pozniejsza edycja entry_time nie poluzowuje kontroli swiec", async () => {
    const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open", wejscie: 20000, sl: 19990 });
    await sql`update trades set entry_time = ${`${DZIEN}T14:35:00Z`}::timestamptz where id = ${id}`;
    const plan = await wywolaj(import("@/app/api/v2/trade-plans/route"), "POST", "/trade-plans", {
      token: rw.token,
      cialo: { accountId: kontoId, symbol: "NQ1!", day: DZIEN, direction: "long", entryPrice: 20000, stopLoss: 19990, contracts: 1, tradeId: id },
    });
    expect(plan.status, JSON.stringify(plan.json)).toBe(201);
    await sql`update trades set entry_time = ${`${DZIEN}T18:00:00Z`}::timestamptz where id = ${id}`; // wejscie przesuniete PO swiecach
    const swiecePo = [
      { t: `${DZIEN}T14:45:00Z`, o: 20000, h: 20010, l: 19995, c: 20005 },
      { t: `${DZIEN}T14:55:00Z`, o: 20005, h: 20015, l: 20000, c: 20012 },
    ]; // ostatnia konczy sie 15:00 > 14:35 (najwczesniejsze wejscie), a < 18:00
    const r = await wywolaj(import("@/app/api/v2/trades/[id]/reviews/route"), "POST", `/trades/${id}/reviews`, { token: rw.token, cialo: { basis: "chart", brainVerdict: "wejdz", evidence: { intervalMinutes: 5, candles: swiecePo } } }, PARAMS({ id: String(id) }));
    expect(r.status, JSON.stringify(r.json)).toBe(422);
    expect(r.json.code).toBe("look_ahead");
    expect(r.json.error).toContain("14:35");
  });

  it("ta sama klasa odczytow: dzien (notatki dnia, mood, dayRating), slowa przypiete do ukrytej notatki, profil, luki, teza planu", async () => {
    const { id, po, dnia } = await przygotuj();
    // inne otwarte trade'y z werdyktem z tego samego dnia (z poprzednich testow) tez ukrywaja notatki dnia: zamykamy je dla izolacji
    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where account_id = ${kontoId} and trading_day = ${DZIEN} and id <> ${id}`;
    const sprzatanie: (() => Promise<unknown>)[] = [];
    try {
      // --- notatki z kotwica day ---
      const mkNote = async (tytul: string, kotwica: Record<string, unknown>, stamp: string) => {
        const r = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: tytul, bodyMd: `Tresc ${TOKEN}`, ...kotwica } });
        expect(r.status, JSON.stringify(r.json)).toBe(201);
        await sql`update notes set created_at = ${stamp}::timestamptz, updated_at = ${stamp}::timestamptz where id = ${r.json.id}`;
        return r.json.id as number;
      };
      const dzienPo = await mkNote(`DzienowaPo${TOKEN}`, { day: DZIEN }, `${DZIEN}T15:00:00Z`);
      const dzienPrzed = await mkNote(`DzienowaPrzed${TOKEN}`, { day: DZIEN }, `${DZIEN}T12:00:00Z`);
      expect((await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${dzienPo}`, PARAMS({ id: String(dzienPo) }))).status).toBe(404);
      expect((await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${dzienPrzed}`, PARAMS({ id: String(dzienPrzed) }))).status).toBe(200);
      const dzien = await get(import("@/app/api/v2/days/[date]/route"), `/days/${DZIEN}?accountId=${kontoId}`, PARAMS({ date: DZIEN }));
      const idyDnia = dzien.json.notes.map((n: { id: number }) => n.id);
      expect(idyDnia).toContain(dzienPrzed);
      expect(idyDnia).not.toContain(dzienPo);
      const szukaj = (await get(import("@/app/api/v2/search/route"), `/search?q=${TOKEN}&types=notes`)).json.results.map((r: { id: number }) => r.id);
      expect(szukaj).toContain(dzienPrzed);
      expect(szukaj).not.toContain(dzienPo);
      const lista = (await get(import("@/app/api/v2/notes/route"), `/notes?day=${DZIEN}`)).json.notes.map((n: { id: number }) => n.id);
      expect(lista).not.toContain(dzienPo);

      // --- mood i dayRating dnia ---
      const zapis = await wywolaj(import("@/app/api/v2/days/[date]/route"), "PUT", `/days/${DZIEN}`, { token: rw.token, cialo: { accountId: kontoId, mood: 4, dayRating: 5 } }, PARAMS({ date: DZIEN }));
      expect(zapis.status, JSON.stringify(zapis.json)).toBeLessThan(300);
      const dzien2 = await get(import("@/app/api/v2/days/[date]/route"), `/days/${DZIEN}?accountId=${kontoId}`, PARAMS({ date: DZIEN }));
      expect(dzien2.json.dayNote).toMatchObject({ mood: null, dayRating: null, postSession: null });

      // --- slowa przypiete do ukrytej notatki (bez trade'a i dnia) ---
      const slowaNotatki = await zapiszSlowa(rw.token, `Slowa przy ukrytej notatce ${unikat("sn")} ${TOKEN}`, { noteId: dzienPo, capturedAt: `${DZIEN}T11:00:00Z` });
      const wNotatce = (await get(import("@/app/api/v2/user-words/route"), `/user-words?noteId=${dzienPo}`)).json.words.map((w: { id: number }) => w.id);
      expect(wNotatce).not.toContain(slowaNotatki.id);
      const szukajSlow = (await get(import("@/app/api/v2/search/route"), `/search?q=Slowa+przy+ukrytej+notatce&types=words`)).json.results.map((r: { id: number }) => r.id);
      expect(szukajSlow).not.toContain(slowaNotatki.id);

      // --- profil: zrodla hasel i korekty interpretacji ---
      const [haslo] = await sql`insert into profile_terms (term, meaning, status, origin) values (${`Haslo ${znacznik} ${TOKEN}`}, 'znaczenie', 'proposed', 'user') returning id`;
      sprzatanie.push(() => sql`delete from profile_terms where id = ${haslo.id}`);
      await sql`insert into profile_term_sources (term_id, words_id) values (${haslo.id}, ${po.id})`;
      sprzatanie.unshift(() => sql`delete from profile_term_sources where term_id = ${haslo.id}`);
      const [kor] = await sql`insert into interpretation_corrections (words_id, before_interpretation, correction_words_id, after_interpretation) values (${po.id}, 'PRZED-INTERPRETACJA', ${dnia.id}, 'PO-INTERPRETACJI') returning id`;
      sprzatanie.unshift(() => sql`delete from interpretation_corrections where id = ${kor.id}`);
      const profil = await get(import("@/app/api/v2/profile/route"), "/profile");
      expect(profil.status).toBe(200);
      const tekstProfilu = JSON.stringify(profil.json);
      expect(tekstProfilu).not.toContain("Po fakcie wygralem dwa R");
      expect(tekstProfilu).not.toContain("PRZED-INTERPRETACJA");
      expect(profil.json.terms.find((t: { id: number }) => t.id === haslo.id).sources).toEqual([]);

      // --- luki: odpowiedz ---
      const luka = await wywolaj(import("@/app/api/v2/strategy-gaps/route"), "POST", "/strategy-gaps", { token: rw.token, cialo: { kind: "gap", question: `Pytanie ${unikat("g")} ${TOKEN}`, tradeId: id } });
      expect(luka.status, JSON.stringify(luka.json)).toBeLessThan(300);
      const lukaId = luka.json.id as number;
      sprzatanie.unshift(() => sql`delete from strategy_gaps where id = ${lukaId}`);
      const { zapisJakoUi } = await import("./zapis");
      const { sql: dsql } = await import("drizzle-orm");
      await zapisJakoUi((tx) => tx.execute(dsql`update strategy_gaps set status = 'answered', answered_at = now(), answer_words_id = ${po.id} where id = ${lukaId}`));
      const luki = await get(import("@/app/api/v2/strategy-gaps/route"), "/strategy-gaps?status=answered");
      expect(luki.json.gaps.find((g: { id: number }) => g.id === lukaId).answer).toBeNull();

      // --- teza planu ze slow po wejsciu ---
      const teza = await zapiszSlowa(rw.token, `Teza napisana po wejsciu ${unikat("t")} ${TOKEN}`, { day: DZIEN, role: "plan.thesis", capturedAt: `${DZIEN}T15:20:00Z` });
      const plan = await wywolaj(import("@/app/api/v2/trade-plans/route"), "POST", "/trade-plans", { token: rw.token, cialo: { accountId: kontoId, symbol: "NQ1!", day: DZIEN, direction: "long", entryPrice: 20000, stopLoss: 19990, contracts: 1, tradeId: id, thesisWordsId: teza.id } });
      expect(plan.status, JSON.stringify(plan.json)).toBe(201);
      const planId = plan.json.plan.id as number;
      const p = await get(import("@/app/api/v2/trade-plans/[id]/route"), `/trade-plans/${planId}`, PARAMS({ id: String(planId) }));
      expect(p.json.thesis).toBeNull();
      const t = await get(import("@/app/api/v2/trades/[id]/route"), `/trades/${id}`, PARAMS({ id: String(id) }));
      expect(JSON.stringify(t.json.plan)).not.toContain("Teza napisana po wejsciu");

      // --- po zamknieciu trade'a wszystko wraca ---
      await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where id = ${id}`;
      expect((await get(import("@/app/api/v2/notes/[id]/route"), `/notes/${dzienPo}`, PARAMS({ id: String(dzienPo) }))).status).toBe(200);
      const dzienPoZamknieciu = await get(import("@/app/api/v2/days/[date]/route"), `/days/${DZIEN}?accountId=${kontoId}`, PARAMS({ date: DZIEN }));
      expect(dzienPoZamknieciu.json.dayNote).toMatchObject({ mood: 4, dayRating: 5 });
      expect(JSON.stringify((await get(import("@/app/api/v2/profile/route"), "/profile")).json)).toContain("PRZED-INTERPRETACJA");
      expect((await get(import("@/app/api/v2/strategy-gaps/route"), "/strategy-gaps?status=answered")).json.gaps.find((g: { id: number }) => g.id === lukaId).answer).not.toBeNull();
      expect((await get(import("@/app/api/v2/trade-plans/[id]/route"), `/trade-plans/${planId}`, PARAMS({ id: String(planId) }))).json.thesis).not.toBeNull();
    } finally {
      for (const f of sprzatanie) await f().catch(() => {});
    }
  });

  it("przeglad tygodnia: ukryte slowa nie wychodza z GET (commitment = null) i nie da sie ich podpiac (422 unknown_reference); korekta interpretacji ukrytych slow = 404", async () => {
    const { id, po, dnia } = await przygotuj();
    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where account_id = ${kontoId} and trading_day = ${DZIEN} and id <> ${id}`;
    const sprzatanie: (() => Promise<unknown>)[] = [];
    try {
      // zapis przez API: slowa dnia napisane po wejsciu sa dla przegladu »nieistniejace«
      const zapis = await wywolaj(import("@/app/api/v2/reviews/weekly/[weekStart]/route"), "PUT", `/reviews/weekly/${DZIEN}`, { token: rw.token, cialo: { commitmentWordsId: dnia.id } }, PARAMS({ weekStart: DZIEN }));
      expect(zapis.status, JSON.stringify(zapis.json)).toBe(422);
      expect(zapis.json.code).toBe("unknown_reference");
      // odczyt: przeglad zapisany SQL-em (z ukrytymi slowami) nie oddaje ich tekstu
      const [r] = await sql`insert into weekly_reviews (week_start, commitment_words_id) values (${DZIEN}, ${dnia.id}) returning id`;
      sprzatanie.push(() => sql`delete from weekly_reviews where id = ${r.id}`);
      const odczyt = await get(import("@/app/api/v2/reviews/weekly/route"), `/reviews/weekly?weekStart=${DZIEN}`);
      expect(odczyt.status, JSON.stringify(odczyt.json)).toBe(200);
      expect(odczyt.json.review.commitment).toBeNull();
      expect(JSON.stringify(odczyt.json)).not.toContain("Podsumowanie dnia");

      // korekta interpretacji ukrytych slow: 404, nic nie zapisane
      await sql`update user_words set ai_interpretation = 'Interpretacja AI', interpretation_model = 'm', interpretation_at = now() where id = ${po.id}`;
      const kor = await wywolaj(import("@/app/api/v2/profile/corrections/route"), "POST", "/profile/corrections", { token: rw.token, cialo: { wordsId: po.id, afterInterpretation: "Inna interpretacja", correctionWordsId: dnia.id } });
      expect(kor.status, JSON.stringify(kor.json)).toBe(404);
      expect((await sql`select count(*)::int as n from interpretation_corrections where words_id = ${po.id}`)[0].n).toBe(0);

      // po zamknieciu trade'a przeglad pokazuje slowa
      await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1 where id = ${id}`;
      const po2 = await get(import("@/app/api/v2/reviews/weekly/route"), `/reviews/weekly?weekStart=${DZIEN}`);
      expect(po2.json.review.commitment.id).toBe(dnia.id);
    } finally {
      for (const f of sprzatanie) await f().catch(() => {});
    }
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
    expect(po).toBeUndefined(); // zrzut po wejsciu nie wychodzi wcale (ADR: na wykresie widac wynik)
    expect(przed.caption).toBe("Setup przed wejsciem");
    expect(przed.capturedAt).not.toBeNull();
    const korekta = t.json.reviews.find((r: { kind: string }) => r.kind === "user_override");
    expect(korekta.summaryMd).toBeNull();
    expect(JSON.stringify(t.json)).not.toContain("Cel zrealizowany");
    expect(JSON.stringify(t.json)).not.toContain("Wygralem dwa R");
  });
});
