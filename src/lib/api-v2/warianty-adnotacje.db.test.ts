import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { kanonicznyJson } from "@/lib/domain/kanoniczny";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

const sha = (t: string) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

/*
 * Licznik wariantow (MUST 5) i adnotacje wykresu z tekstem 1:1 (MUST 13). Tekst porownujemy z bazy BAJT W BAJT.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("warianty hipotez i adnotacje wykresu (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let imp: Par;
  let instrumentId = 0;
  let kontoId = 0;
  const znacznik = unikat("war");
  const DZIEN = "1983-09-09";

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    imp = await nowyToken(sql, ["read", "write", "import"]);
    const [k] = await sql`insert into accounts (name, type) values (${`WAR-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
  });
  afterAll(async () => {
    await sql`delete from chart_annotations where day = ${DZIEN} or trade_id in (select id from trades where account_id = ${kontoId})`;
    await sql`delete from hypothesis_variants where hypothesis_id in (select h.id from hypotheses h join notes n on n.id = h.note_id where n.created_by_token_id = ${imp.id})`;
    await sql`delete from hypotheses where note_id in (select id from notes where created_by_token_id = ${imp.id})`;
    // lancuch poprawek slow: od najnowszych do najstarszych (supersedes_id NO ACTION)
    await sql`delete from user_words where supersedes_id is not null and created_by_token_id = ${rw.id}`;
    await sql`delete from trades where account_id = ${kontoId}`;
    await sprzatnijNowe(sql, [rw.id, ro.id, imp.id]);
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id, imp.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("warianty hipotezy", () => {
    let kod = "";

    beforeAll(async () => {
      const h = await wywolaj(import("@/app/api/v2/hypotheses/route"), "POST", "/hypotheses", {
        token: imp.token,
        cialo: { title: unikat("Hipoteza wariantow"), origin: "vault-import", externalRef: `vault:${unikat("h")}`, nImported: 24, progN: 20 },
      });
      expect(h.status, JSON.stringify(h.json)).toBe(201);
      kod = h.json.code as string;
    });

    const dodaj = (cialo: Record<string, unknown>, c = kod, token = rw.token) =>
      wywolaj(import("@/app/api/v2/hypotheses/[code]/variants/route"), "POST", `/hypotheses/${c}/variants`, { token, cialo }, PARAMS({ code: c }));
    const podsumowanie = (c = kod) => wywolaj(import("@/app/api/v2/hypotheses/[code]/variants/route"), "GET", `/hypotheses/${c}/variants`, { token: ro.token }, PARAMS({ code: c }));

    it("licznik rosnie tylko dla NOWEGO zestawu parametrow; kolejnosc kluczy nie ma znaczenia; skrot to SHA-256 kanonicznego JSON-a", async () => {
      const pierwszy = await dodaj({ label: "SL 10, TP 30, okno 9:30", params: { sl: 10, tp: 30, okno: "09:30-10:00" }, nTested: 24 });
      expect(pierwszy.status, JSON.stringify(pierwszy.json)).toBe(201);
      zgodneZKontraktem("post", "/hypotheses/{code}/variants", pierwszy.json);
      expect(pierwszy.json.count).toBe(1);
      expect(pierwszy.json.warning.inflated).toBe(false);
      expect(pierwszy.json.variant.paramsHash).toBe(sha(kanonicznyJson({ sl: 10, tp: 30, okno: "09:30-10:00" })));

      const ten = await dodaj({ label: "to samo, inna kolejnosc", params: { okno: "09:30-10:00", tp: 30, sl: 10 }, nTested: 24 });
      expect(ten.status).toBe(200);
      expect(ten.json.created).toBe(false);
      expect(ten.json.variant.id).toBe(pierwszy.json.variant.id);
      expect(ten.json.count).toBe(1);

      const inny = await dodaj({ label: "SL 12", params: { sl: 12, tp: 30, okno: "09:30-10:00" }, nTested: 24, result: { expectancyR: 0.4 } });
      expect(inny.status).toBe(201);
      expect(inny.json.count).toBe(2);
      expect(inny.json.warning.inflated).toBe(true);
      expect(inny.json.warning.inflationSigma).toBeGreaterThan(0.5);
      expect(inny.json.warning.text).toContain("Testowano 2 wariantów na 24 trade'ach");
      const [{ n }] = await sql`select count(*)::int as n from hypothesis_variants hv join hypotheses h on h.id = hv.hypothesis_id where h.code = ${kod}`;
      expect(n).toBe(2);
    });

    it("lista wariantow z ostrzezeniem o zawyzeniu najlepszego wyniku; zgodna z kontraktem; hipoteza z n z sejfu", async () => {
      const r = await podsumowanie();
      expect(r.status).toBe(200);
      zgodneZKontraktem("get", "/hypotheses/{code}/variants", r.json);
      expect(r.json.hypothesis).toMatchObject({ code: kod, n: 24, progN: 20 });
      expect(r.json.count).toBe(2);
      expect(r.json.warning.inflated).toBe(true);
    });

    it("nieznana hipoteza = 404, zly kod = 400, pusty zestaw parametrow = 400, token tylko do odczytu = 403", async () => {
      expect((await dodaj({ label: "x", params: { a: 1 }, nTested: 1 }, "H-999999")).status).toBe(404);
      expect((await podsumowanie("H-999999")).status).toBe(404);
      expect((await dodaj({ label: "x", params: { a: 1 }, nTested: 1 }, "R-001")).status).toBe(400);
      expect((await dodaj({ label: "x", params: {}, nTested: 1 })).status).toBe(400);
      expect((await dodaj({ label: "x", params: { a: 1 }, nTested: -1 })).status).toBe(400);
      expect((await dodaj({ label: "x", params: { a: 1 }, nTested: 1 }, kod, ro.token)).status).toBe(403);
    });

    it("zmiana progu hipotezy po zobaczeniu wyniku jest logowana przez baze (nawet gdy zmienia ja agent przez SQL)", async () => {
      const { zapisZAktorem } = await import("./zapis");
      const { sql: dsql } = await import("drizzle-orm");
      await zapisZAktorem(`api:${rw.id}`, (tx) => tx.execute(dsql`update hypotheses set prog_n = 30 where code = ${kod}`));
      const [log] = await sql`select tc.field, tc.old_value, tc.new_value, tc.n_at_change, tc.result_was_visible, tc.actor
                                from threshold_changes tc join hypotheses h on h.id = tc.hypothesis_id where h.code = ${kod}`;
      expect(log).toMatchObject({ field: "prog_n", old_value: 20, new_value: 30, n_at_change: 24, result_was_visible: true, actor: `api:${rw.id}` });
      let kod409: string | undefined;
      try {
        await sql`update threshold_changes set new_value = '99'::jsonb`;
      } catch (e) {
        kod409 = (e as { code?: string }).code;
      }
      expect(kod409).toBe("TJ409");
    });
  });

  describe("adnotacje wykresu", () => {
    let tradeId = 0;
    beforeAll(async () => {
      tradeId = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open" });
    });

    const zapisz = (cialo: Record<string, unknown>, token = rw.token) => wywolaj(import("@/app/api/v2/chart-annotations/route"), "POST", "/chart-annotations", { token, cialo });
    const rysunek = (id: string, tekst?: string, nadpisz: Record<string, unknown> = {}) => ({
      externalId: id,
      shape: tekst === undefined ? "hline" : "text",
      price: 20015.25,
      interval: "5m",
      timeFrom: `${DZIEN}T14:30:00Z`,
      raw: { id, kolor: "#ff0" },
      capturedAt: "2026-10-15T10:00:00+02:00",
      ...(tekst === undefined ? {} : { text: tekst, sha256: sha(tekst) }),
      ...nadpisz,
    });
    const slowaRysunku = async (externalId: string) => {
      const [w] = await sql`select uw.id, uw.text, uw.sha256, uw.supersedes_id, uw.source, uw.role, uw.trade_id
                              from chart_annotations ca join user_words uw on uw.id = ca.words_id
                             where ca.external_id = ${externalId} and ca.trade_id = ${tradeId}`;
      return w;
    };

    it("tekst rysunku zapisuje sie BAJT W BAJT: polskie znaki, emoji, CRLF, spacje na koncach; skrot w bazie = skrot klienta", async () => {
      const tekst = "Zażółć gęślą jaźń 🙂\r\nDrugi wiersz  z podwójną spacją i spacją na końcu   ";
      const r = await zapisz({ platform: "fxreplay", tradeId, annotations: [rysunek("d-1", tekst)] });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      zgodneZKontraktem("post", "/chart-annotations", r.json);
      expect(r.json.results[0].status).toBe("created");
      const [w] = await sql`select uw.text, uw.sha256, uw.byte_len, uw.source, uw.role, uw.trade_id, encode(convert_to(uw.text, 'UTF8'), 'hex') as hex
                              from chart_annotations ca join user_words uw on uw.id = ca.words_id where ca.external_id = 'd-1'`;
      expect(w.text).toBe(tekst);
      expect(Buffer.from(w.hex, "hex").equals(Buffer.from(tekst, "utf8"))).toBe(true);
      expect(w.sha256).toBe(sha(tekst));
      expect(w.byte_len).toBe(Buffer.byteLength(tekst, "utf8"));
      expect(w).toMatchObject({ source: "chart", role: "chart.annotation", trade_id: tradeId });
      // ten sam tekst czytany zwyklym endpointem slow uzytkownika wraca bez zmiany bajtu
      const lista = await wywolaj(import("@/app/api/v2/user-words/route"), "GET", `/user-words?tradeId=${tradeId}&role=chart.annotation`, { token: ro.token });
      expect(lista.json.words.find((x: { text: string }) => x.text === tekst)).toBeDefined();
    });

    it("NFC i NFD to rozne teksty (zadnej normalizacji): kazdy zostaje taki, jaki przyszedl", async () => {
      const nfc = "zażółć".normalize("NFC");
      const nfd = "zażółć".normalize("NFD");
      expect(nfc).not.toBe(nfd);
      const r = await zapisz({ platform: "tradingview", tradeId, annotations: [rysunek("nfc", nfc), rysunek("nfd", nfd)] });
      expect(r.json.summary.created).toBe(2);
      expect((await slowaRysunku("nfc")).text).toBe(nfc);
      expect((await slowaRysunku("nfd")).text).toBe(nfd);
      expect((await slowaRysunku("nfd")).sha256).not.toBe((await slowaRysunku("nfc")).sha256);
    });

    it("rysunek AI ([AI] ) i niezgodny skrot sa odrzucane PER RYSUNEK, reszta paczki wchodzi", async () => {
      const r = await zapisz({
        platform: "fxreplay",
        tradeId,
        annotations: [rysunek("ok-1", "Mój poziom"), rysunek("ai-1", "[AI] zbiór poziomów AI"), rysunek("zly-hash", "Tekst", { sha256: "0".repeat(64) }), rysunek("nul", "a\u0000b")],
      });
      expect(r.status).toBe(201);
      const wynik = Object.fromEntries(r.json.results.map((x: { externalId: string; status: string; error?: string }) => [x.externalId, x]));
      expect(wynik["ok-1"].status).toBe("created");
      expect(wynik["ai-1"].status).toBe("refused");
      expect(wynik["ai-1"].error).toContain("rysunek AI");
      expect(wynik["zly-hash"].status).toBe("refused");
      expect(wynik["zly-hash"].error).toContain("sha256");
      expect(wynik.nul.status).toBe("refused");
      expect(r.json.summary).toMatchObject({ created: 1, refused: 3 });
      expect((await sql`select count(*)::int as n from chart_annotations where external_id in ('ai-1', 'zly-hash', 'nul')`)[0].n).toBe(0);
    });

    it("ponowne wyslanie nie dubluje; zmiana polozenia to »updated«; zmiana tekstu to NOWA wersja slow wskazujaca poprzednia, adnotacja przepieta", async () => {
      const t1 = "Pierwsza wersja opisu";
      await zapisz({ platform: "fxreplay", tradeId, annotations: [rysunek("ver", t1)] });
      const pierwsze = await slowaRysunku("ver");
      const ponownie = await zapisz({ platform: "fxreplay", tradeId, annotations: [rysunek("ver", t1)] });
      expect(ponownie.status).toBe(200);
      expect(ponownie.json.results[0].status).toBe("unchanged");
      expect((await sql`select count(*)::int as n from chart_annotations where external_id = 'ver'`)[0].n).toBe(1);

      const przesuniety = await zapisz({ platform: "fxreplay", tradeId, annotations: [rysunek("ver", t1, { price: 20020.5 })] });
      expect(przesuniety.json.results[0].status).toBe("updated");
      expect(Number((await sql`select price from chart_annotations where external_id = 'ver'`)[0].price)).toBe(20020.5);

      const t2 = "Druga wersja opisu";
      const zmieniony = await zapisz({ platform: "fxreplay", tradeId, annotations: [rysunek("ver", t2)] });
      expect(zmieniony.json.results[0].status).toBe("text_changed");
      const drugie = await slowaRysunku("ver");
      expect(drugie.text).toBe(t2);
      expect(drugie.supersedes_id).toBe(pierwsze.id);
      // poprzednia wersja zostaje w historii nietknieta
      const [stare] = await sql`select text from user_words where id = ${pierwsze.id}`;
      expect(stare.text).toBe(t1);
      const powtorka = await zapisz({ platform: "fxreplay", tradeId, annotations: [rysunek("ver", t2)] });
      expect(powtorka.json.results[0].status).toBe("unchanged");
    });

    it("rysunek bez tekstu (hline) zapisuje sie bez slow; lista zwraca slowa z adnotacja; zgodna z kontraktem", async () => {
      const r = await zapisz({ platform: "tradingview", tradeId, annotations: [rysunek("linia")] });
      expect(r.json.results[0]).toMatchObject({ status: "created", wordsId: null });
      const lista = await wywolaj(import("@/app/api/v2/chart-annotations/route"), "GET", `/chart-annotations?tradeId=${tradeId}`, { token: ro.token });
      zgodneZKontraktem("get", "/chart-annotations", lista.json);
      const linia = lista.json.annotations.find((a: { externalId: string }) => a.externalId === "linia");
      expect(linia).toMatchObject({ shape: "hline", price: 20015.25, interval: "5m", words: null });
      const zTekstem = lista.json.annotations.find((a: { externalId: string }) => a.externalId === "d-1");
      expect(zTekstem.words.text).toContain("Zażółć gęślą jaźń 🙂\r\n");
    });

    it("wymaga tradeId albo dnia (400), nieznany trade = 422, ten sam rysunek na dniu to osobna adnotacja, token tylko do odczytu = 403; GET /trades/:id widzi adnotacje", async () => {
      const bez = await zapisz({ platform: "fxreplay", annotations: [rysunek("x")] });
      expect(bez.status).toBe(400);
      expect(bez.json.error).toContain("tradeId albo day");
      expect((await zapisz({ platform: "fxreplay", tradeId: 999999999, annotations: [rysunek("x")] })).status).toBe(422);
      const dzien = await zapisz({ platform: "fxreplay", day: DZIEN, annotations: [rysunek("ver", "Opis dnia")] });
      expect(dzien.json.results[0].status).toBe("created");
      expect((await zapisz({ platform: "fxreplay", tradeId, annotations: [rysunek("y")] }, ro.token)).status).toBe(403);
      const dwa = await zapisz({ platform: "fxreplay", tradeId, annotations: [rysunek("p", "a"), rysunek("p", "b")] });
      expect(dwa.status).toBe(400);
      const t = await wywolaj(import("@/app/api/v2/trades/[id]/route"), "GET", `/trades/${tradeId}`, { token: ro.token }, PARAMS({ id: String(tradeId) }));
      zgodneZKontraktem("get", "/trades/{id}", t.json);
      expect(t.json.chartAnnotations.length).toBeGreaterThanOrEqual(5);
    });
  });
});
