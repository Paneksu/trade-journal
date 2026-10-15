import { sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { sprzatnijNowe, unikat, wstawTrade, wywolaj, zapiszSlowa, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Kolejka potwierdzen AI (MUST 10): agent tworzy, tylko UI zatwierdza, niezatwierdzone nie wchodzi do statystyk.
 * Dowodem jest odczyt tych samych zapytan, z ktorych korzystaja statystyki (getTrades), przed i po zatwierdzeniu.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("kolejka sugestii AI i zatwierdzanie przez UI (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let bezPropose: Par;
  let instrumentId = 0;
  let kontoId = 0;
  let tagId = 0;
  const znacznik = unikat("sug");
  const DZIEN = "1985-02-04";

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    bezPropose = await nowyToken(sql, ["read", "write"]);
    const [k] = await sql`insert into accounts (name, type) values (${`SUG-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
    const [tg] = await sql`select id from tags where archived = false order by id limit 1`;
    tagId = tg.id;
  });
  afterAll(async () => {
    await sql`delete from profile_term_sources where term_id in (select id from profile_terms where term like ${`%${znacznik}%`})`;
    await sql`delete from profile_terms where term like ${`%${znacznik}%`}`;
    await sql`delete from trades where account_id = ${kontoId}`;
    await sprzatnijNowe(sql, [rw.id, ro.id, bezPropose.id]);
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id, bezPropose.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const sugeruj = (cialo: Record<string, unknown>, token = rw.token) =>
    wywolaj(import("@/app/api/v2/ai-suggestions/route"), "POST", "/ai-suggestions", { token, cialo });
  const dowod = [{ type: "trade", ref: 1, note: "FVG po sweepie na 5m" }];
  const baza = { claim: "Ten trade to wejście po sweepie.", evidence: dowod, evidenceLevel: "partial", n: 12 };
  const nowyTrade = () => wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "closed" });

  async function tagiWStatystykach(tradeId: number): Promise<string[]> {
    const { getTrades } = await import("@/lib/queries/trades");
    const { EMPTY_FILTERS } = await import("@/lib/queries/filters");
    const lista = await getTrades({ ...EMPTY_FILTERS, source: "all", accounts: [kontoId] });
    return lista.find((t) => t.id === tradeId)?.tags.map((x) => x.name) ?? [];
  }
  async function liczbaZTagiem(): Promise<number> {
    const { getTrades } = await import("@/lib/queries/trades");
    const { EMPTY_FILTERS } = await import("@/lib/queries/filters");
    return (await getTrades({ ...EMPTY_FILTERS, source: "all", accounts: [kontoId], tags: [tagId] })).length;
  }

  it("sugestia tagu nie wchodzi do statystyk przed zatwierdzeniem; po zatwierdzeniu przez UI wchodzi z pochodzeniem ai; cofniecie ja usuwa", async () => {
    const tradeId = await nowyTrade();
    const przed = await liczbaZTagiem();
    const r = await sugeruj({ kind: "tag", target: { type: "trade", id: tradeId }, payload: { tagId, interval: "5m" }, ...baza });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    zgodneZKontraktem("post", "/ai-suggestions", r.json);
    expect(r.json.suggestion).toMatchObject({ status: "pending", kind: "tag", signature: "propozycja AI", evidenceLevel: "partial", n: 12 });
    const id = r.json.suggestion.id as number;

    // kolejka widzi sugestie, ale nic nie dotarlo do tabel docelowych ani do zapytan statystyk
    const [{ ile }] = await sql`select count(*)::int as ile from trade_tags where trade_id = ${tradeId}`;
    expect(ile).toBe(0);
    expect(await tagiWStatystykach(tradeId)).toEqual([]);
    expect(await liczbaZTagiem()).toBe(przed);

    const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
    const ok = await zatwierdzSugestie(id);
    expect(ok.ok).toBe(true);
    const [w] = await sql`select origin, interval from trade_tags where trade_id = ${tradeId} and tag_id = ${tagId}`;
    expect(w).toEqual({ origin: "ai", interval: "5m" });
    expect((await tagiWStatystykach(tradeId)).length).toBe(1);
    expect(await liczbaZTagiem()).toBe(przed + 1);
    const [s] = await sql`select status, decided_at is not null as datowana from ai_suggestions where id = ${id}`;
    expect(s).toEqual({ status: "accepted", datowana: true });

    const cofniete = await cofnijSugestie(id);
    expect(cofniete.ok).toBe(true);
    expect(await tagiWStatystykach(tradeId)).toEqual([]);
    expect(await liczbaZTagiem()).toBe(przed);
    expect((await sql`select status from ai_suggestions where id = ${id}`)[0].status).toBe("reverted");
    // zatwierdzenie cofnietej nie przejdzie: kolejna decyzja wymaga nowej sugestii
    expect((await zatwierdzSugestie(id)).ok).toBe(false);
  });

  it("agent nie zatwierdzi: SQL z aktorem api:* dostaje TJ403 (baza), a zatwierdzenie z aktorem ui przechodzi", async () => {
    const tradeId = await nowyTrade();
    const r = await sugeruj({ kind: "process_grade", target: { type: "trade", id: tradeId }, payload: { grade: "A" }, ...baza });
    const id = r.json.suggestion.id as number;
    const { zapisZAktorem, zapisJakoUi } = await import("./zapis");
    const probuj = async (aktor: string) => {
      try {
        await zapisZAktorem(aktor, (tx) => tx.execute(dsql`update ai_suggestions set status = 'accepted', decided_at = now() where id = ${id}`));
        return null;
      } catch (e) {
        return ((e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code) ?? null;
      }
    };
    expect(await probuj(`api:${rw.id}`)).toBe("TJ403");
    expect(await probuj("ingest")).toBe("TJ403");
    expect((await sql`select status from ai_suggestions where id = ${id}`)[0].status).toBe("pending");
    // zapisZAktorem nie przyjmuje aktora »ui« (audyt 6); zatwierdza modul decyzji przez zapisJakoUi
    expect(await probuj("ui")).toBeNull();
    expect((await sql`select status from ai_suggestions where id = ${id}`)[0].status).toBe("pending");
    await zapisJakoUi((tx) => tx.execute(dsql`update ai_suggestions set status = 'accepted', decided_at = now() where id = ${id}`));
    expect((await sql`select status from ai_suggestions where id = ${id}`)[0].status).toBe("accepted");
  });

  it("twierdzenie bez dowodu odrzucone (400), bez poziomu pewnosci tez; token bez zakresu propose = 403, tylko odczyt = 403", async () => {
    const tradeId = await nowyTrade();
    const cel = { type: "trade", id: tradeId };
    const bez = await sugeruj({ kind: "tag", target: cel, payload: { tagId }, claim: "x", evidenceLevel: "tested" });
    expect(bez.status).toBe(400);
    expect(bez.json.error).toContain("evidence");
    const pusty = await sugeruj({ kind: "tag", target: cel, payload: { tagId }, claim: "x", evidence: [], evidenceLevel: "tested" });
    expect(pusty.status).toBe(400);
    const bezPoziomu = await sugeruj({ kind: "tag", target: cel, payload: { tagId }, claim: "x", evidence: dowod });
    expect(bezPoziomu.status).toBe(400);
    expect((await sugeruj({ kind: "tag", target: cel, payload: { tagId }, ...baza }, bezPropose.token)).status).toBe(403);
    expect((await sugeruj({ kind: "tag", target: cel, payload: { tagId }, ...baza }, ro.token)).status).toBe(403);
    expect((await sql`select count(*)::int as n from ai_suggestions where target = ${JSON.stringify(cel)}::jsonb`)[0].n).toBe(0);
  });

  it("ta sama sugestia nie mnozy sie (200), odrzucona nie wraca (409), to co juz jest w danych nie jest sugerowane (409)", async () => {
    const tradeId = await nowyTrade();
    const cialo = { kind: "trade_link", target: { type: "trade", id: tradeId }, payload: { noteId: await jakasNotatka(), role: "concept" }, ...baza };
    const pierwsza = await sugeruj(cialo);
    expect(pierwsza.status).toBe(201);
    const druga = await sugeruj(cialo);
    expect(druga.status).toBe(200);
    expect(druga.json.created).toBe(false);
    expect(druga.json.suggestion.id).toBe(pierwsza.json.suggestion.id);

    const { odrzucSugestie, zatwierdzSugestie } = await import("@/lib/decyzje/sugestie");
    expect((await odrzucSugestie(pierwsza.json.suggestion.id)).ok).toBe(true);
    const wraca = await sugeruj(cialo);
    expect(wraca.status).toBe(409);
    expect(wraca.json.code).toBe("previously_rejected");

    const inna = await sugeruj({ ...cialo, payload: { ...cialo.payload, role: "mistake" } });
    expect(inna.status).toBe(201);
    expect((await zatwierdzSugestie(inna.json.suggestion.id)).ok).toBe(true);
    const juz = await sugeruj({ ...cialo, payload: { ...cialo.payload, role: "mistake" }, claim: "Inne zdanie, ta sama treść." });
    expect(juz.status).toBe(409);
    expect(juz.json.code).toBe("already_present");
  });

  async function jakasNotatka(): Promise<number> {
    const w = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: unikat("Pojęcie sugestii"), bodyMd: "treść" } });
    return w.json.id as number;
  }

  it("ocena procesu: zatwierdzenie zapisuje A/B/C z czasem, cofniecie przywraca poprzednia (takze brak oceny)", async () => {
    const tradeId = await nowyTrade();
    await sql`update trades set process_grade = 'B', process_graded_at = now() - interval '1 day' where id = ${tradeId}`;
    const r = await sugeruj({ kind: "process_grade", target: { type: "trade", id: tradeId }, payload: { grade: "C" }, ...baza });
    const id = r.json.suggestion.id as number;
    const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
    await zatwierdzSugestie(id);
    const [po] = await sql`select process_grade, process_graded_at > now() - interval '1 minute' as swieza from trades where id = ${tradeId}`;
    expect(po).toEqual({ process_grade: "C", swieza: true });
    await cofnijSugestie(id);
    const [wrocila] = await sql`select process_grade, process_graded_at < now() - interval '1 hour' as stara from trades where id = ${tradeId}`;
    expect(wrocila).toEqual({ process_grade: "B", stara: true });

    const bezOceny = await nowyTrade();
    const r2 = await sugeruj({ kind: "process_grade", target: { type: "trade", id: bezOceny }, payload: { grade: "A" }, ...baza });
    await zatwierdzSugestie(r2.json.suggestion.id);
    expect((await sql`select process_grade from trades where id = ${bezOceny}`)[0].process_grade).toBe("A");
    await cofnijSugestie(r2.json.suggestion.id);
    expect((await sql`select process_grade, process_graded_at from trades where id = ${bezOceny}`)[0]).toEqual({ process_grade: null, process_graded_at: null });
    const taSama = await sugeruj({ kind: "process_grade", target: { type: "trade", id: tradeId }, payload: { grade: "B" }, ...baza });
    expect(taSama.status).toBe(409);
  });

  it("dopisek strategii (strategy_detail) wchodzi od razu jako obserwacja z cytatem i linkiem do trade'a, jest widoczny w kolejce i cofalny; regula nie przyjmuje dopiskow", async () => {
    const tradeId = await nowyTrade();
    const nota = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "strategy", title: unikat("Strategia sugestii"), bodyMd: "" } });
    const noteId = nota.json.id as number;
    const slowa = await zapiszSlowa(rw.token, "Czekam na zamknięcie 5m nad FVG.", { tradeId });
    const r = await sugeruj({ kind: "strategy_detail", target: { type: "note", id: noteId }, payload: { bodyMd: "Warunek wejścia: zamknięcie 5m nad FVG.", tradeId, quoteWordsId: slowa.id }, ...baza });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.suggestion.status).toBe("applied");
    expect(r.json.noteAdditionId).toBeGreaterThan(0);
    const [d] = await sql`select origin, trade_id, quote_words_id, suggestion_id, reverted_at from note_additions where id = ${r.json.noteAdditionId}`;
    expect(d).toMatchObject({ origin: "ai", trade_id: tradeId, quote_words_id: slowa.id, suggestion_id: r.json.suggestion.id, reverted_at: null });

    const { cofnijSugestie, zatwierdzSugestie } = await import("@/lib/decyzje/sugestie");
    expect((await zatwierdzSugestie(r.json.suggestion.id)).ok).toBe(false);
    expect((await cofnijSugestie(r.json.suggestion.id)).ok).toBe(true);
    const [po] = await sql`select reverted_at is not null as cofniety from note_additions where id = ${r.json.noteAdditionId}`;
    expect(po.cofniety).toBe(true);
    await sql`delete from note_additions where note_id = ${noteId}`;
  });

  it("wniosek dnia po zatwierdzeniu to notatka »learning« z pochodzeniem ai zakotwiczona w dniu; cofniecie ja archiwizuje (nie kasuje)", async () => {
    const tytul = unikat("Wniosek dnia");
    const r = await sugeruj({ kind: "day_conclusion", target: { type: "day", date: DZIEN }, payload: { title: tytul, bodyMd: "Dzień zgodny z planem." }, ...baza });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
    expect((await zatwierdzSugestie(r.json.suggestion.id)).ok).toBe(true);
    const [n] = await sql`select id, kind, origin, day::text as dzien, archived_at from notes where title = ${tytul}`;
    expect(n).toMatchObject({ kind: "learning", origin: "ai", dzien: DZIEN, archived_at: null });
    await cofnijSugestie(r.json.suggestion.id);
    const [po] = await sql`select archived_at is not null as zarchiwizowana from notes where id = ${n.id}`;
    expect(po.zarchiwizowana).toBe(true);
    await sql`delete from notes where id = ${n.id}`;
  });

  it("haslo slownika: zatwierdzenie dodaje potwierdzone haslo ze zrodlami, drugie takie samo = blad, cofniecie usuwa", async () => {
    const haslo = `FVG-moje ${znacznik}`;
    const slowa = await zapiszSlowa(rw.token, `To jest ${haslo}`, { day: DZIEN });
    const r = await sugeruj({ kind: "profile_term", target: { type: "profile" }, payload: { term: haslo, meaning: "FVG@5m po sweepie", wordsIds: [slowa.id] }, ...baza });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
    expect((await zatwierdzSugestie(r.json.suggestion.id)).ok).toBe(true);
    const [t] = await sql`select id, status, origin from profile_terms where term = ${haslo}`;
    expect(t).toMatchObject({ status: "confirmed", origin: "ai" });
    expect((await sql`select count(*)::int as n from profile_term_sources where term_id = ${t.id}`)[0].n).toBe(1);

    const drugie = await sugeruj({ kind: "profile_term", target: { type: "profile" }, payload: { term: haslo.toUpperCase(), meaning: "inne", wordsIds: [] }, ...baza });
    const odm = await zatwierdzSugestie(drugie.json.suggestion.id);
    expect(odm.ok).toBe(false);
    expect(odm.komunikat).toContain("jest już w słowniku");

    await cofnijSugestie(r.json.suggestion.id);
    expect((await sql`select count(*)::int as n from profile_terms where term = ${haslo}`)[0].n).toBe(0);
  });

  it("przyklad setupu: zatwierdzenie wstawia przyklad z pochodzeniem ai, cofniecie go usuwa; lista sugestii zgodna z kontraktem", async () => {
    const nazwa = unikat("Setup sugestii");
    const s = await wywolaj(import("@/app/api/v2/setups/route"), "POST", "/setups", {
      token: rw.token,
      cialo: { name: nazwa, origin: "ai", counterargument: "Może szum.", evidence: { n: 3 } },
    });
    const slug = s.json.slug as string;
    const tradeId = await nowyTrade();
    const r = await sugeruj({ kind: "setup_example", target: { type: "trade", id: tradeId }, payload: { setupSlug: slug, exampleKind: "a_plus" }, ...baza });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.suggestion.payload.setupId).toBeGreaterThan(0);
    const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
    await zatwierdzSugestie(r.json.suggestion.id);
    const [p] = await sql`select kind, origin from setup_examples where trade_id = ${tradeId}`;
    expect(p).toEqual({ kind: "a_plus", origin: "ai" });
    await cofnijSugestie(r.json.suggestion.id);
    expect((await sql`select count(*)::int as n from setup_examples where trade_id = ${tradeId}`)[0].n).toBe(0);

    const lista = await wywolaj(import("@/app/api/v2/ai-suggestions/route"), "GET", "/ai-suggestions?status=reverted&limit=5", { token: ro.token });
    expect(lista.status).toBe(200);
    zgodneZKontraktem("get", "/ai-suggestions", lista.json);
    expect(lista.json.suggestions.every((x: { status: string }) => x.status === "reverted")).toBe(true);
    await sql`delete from setup_examples where setup_id = (select id from setups where slug = ${slug})`;
  });

  it("nieznany trade, tag i setup = 422 z wartoscia; zly typ celu dla rodzaju = 400", async () => {
    expect((await sugeruj({ kind: "tag", target: { type: "trade", id: 999999999 }, payload: { tagId }, ...baza })).status).toBe(422);
    const tradeId = await nowyTrade();
    const tag = await sugeruj({ kind: "tag", target: { type: "trade", id: tradeId }, payload: { tagId: 999999999 }, ...baza });
    expect(tag.status).toBe(422);
    expect(tag.json.error).toContain("999999999");
    expect((await sugeruj({ kind: "setup_example", target: { type: "trade", id: tradeId }, payload: { setupSlug: "nie-ma-takiego", exampleKind: "anti" }, ...baza })).status).toBe(422);
    expect((await sugeruj({ kind: "tag", target: { type: "day", date: DZIEN }, payload: { tagId }, ...baza })).status).toBe(400);
  });
});
