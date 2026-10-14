import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Playbook jako struktura (MUST 4) ze statystyka uczciwa (MUST 5, 6): przedzialy, break-even z wlasnych W/L,
 * status wg progow zadeklarowanych z gory, osobno dla zrodel danych i »ile R znika miedzy backtestem a live«.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("setupy, wersje i statystyka z przedzialami (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let instrumentId = 0;
  let kontoId = 0;
  let sesjaId = 0;
  const znacznik = unikat("setup");
  const DZIEN = "1984-06-12";

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    const [k] = await sql`insert into accounts (name, type) values (${`SETUP-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
    const [s] = await sql`insert into backtest_sessions (name, kind) values (${`SES-${znacznik}`}, 'backtest') returning id`;
    sesjaId = s.id;
  });
  afterAll(async () => {
    await sql`delete from trades where account_id = ${kontoId}`;
    await sql`delete from backtest_sessions where id = ${sesjaId}`;
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

  const zaloz = (cialo: Record<string, unknown>, token = rw.token) => wywolaj(import("@/app/api/v2/setups/route"), "POST", "/setups", { token, cialo });
  const szczegoly = (slug: string) => wywolaj(import("@/app/api/v2/setups/[slug]/route"), "GET", `/setups/${slug}`, { token: ro.token }, PARAMS({ slug }));
  const wersja = (slug: string, cialo: Record<string, unknown>) =>
    wywolaj(import("@/app/api/v2/setups/[slug]/versions/route"), "POST", `/setups/${slug}/versions`, { token: rw.token, cialo }, PARAMS({ slug }));
  const ai = { origin: "ai", counterargument: "Może to szum próby.", evidence: { trades: [1, 2], n: 12 } };

  it("agent zaklada setup jako PROPOZYCJE: karta (notatka rodzaju setup) + wersja 1 w stanie proposed; odpowiedz zgodna z kontraktem", async () => {
    const nazwa = unikat("Setup FVG po sweepie");
    const r = await zaloz({
      name: nazwa,
      bodyMd: "Opis karty.",
      ...ai,
      preconditions: [{ id: "bias", text: "HTF bias zgodny" }],
      entryChecklist: [{ id: "sweep", text: "Sweep PDL", rule_code: "R-004" }, { id: "fvg", text: "FVG na 5m" }],
      stopRule: "Pod knotem sweepu",
      thresholds: { minN: 5, potwierdzenieN: 50 },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    zgodneZKontraktem("post", "/setups", r.json);
    expect(r.json).toMatchObject({ version: 1, status: "proposed", signature: "propozycja AI" });
    const [w] = await sql`select sv.status, sv.origin, sv.thresholds, sv.created_by_token_id, n.kind, n.title
                            from setup_versions sv join setups s on s.id = sv.setup_id join notes n on n.id = s.note_id where s.slug = ${r.json.slug}`;
    expect(w).toMatchObject({ status: "proposed", origin: "ai", kind: "setup", title: nazwa, created_by_token_id: rw.id });
    expect(w.thresholds).toEqual({ minN: 5, potwierdzenieN: 50 });

    const lista = await wywolaj(import("@/app/api/v2/setups/route"), "GET", "/setups", { token: ro.token });
    zgodneZKontraktem("get", "/setups", lista.json);
    expect(lista.json.setups.find((s: { slug: string }) => s.slug === r.json.slug)).toMatchObject({ currentVersion: null, pendingProposal: { version: 1 } });
    const sz = await szczegoly(r.json.slug);
    zgodneZKontraktem("get", "/setups/{slug}", sz.json);
    expect(sz.json.current).toBeNull();
    expect(sz.json.proposal.entryChecklist[0]).toEqual({ id: "sweep", text: "Sweep PDL", rule_code: "R-004" });
    expect(sz.json.stats.bySource).toEqual({ backtest: null, forward: null, demo: null, live: null });
  });

  it("propozycja AI bez kontrargumentu albo dowodu = 400; mentor wymaga cytatu; import wymaga zakresu import; ta sama nazwa = 409", async () => {
    expect((await zaloz({ name: unikat("S1"), origin: "ai" })).status).toBe(400);
    expect((await zaloz({ name: unikat("S2"), origin: "ai", counterargument: "x" })).status).toBe(400);
    const mentor = await zaloz({ name: unikat("S3"), origin: "mentor" });
    expect(mentor.status).toBe(400);
    expect(mentor.json.error).toContain("evidence");
    const import1 = await zaloz({ name: unikat("S4"), origin: "mentor", evidence: { video: "abc123", t: 10, quote: "x" } });
    expect(import1.status).toBe(403);
    expect(import1.json.missingScope).toBe("import");
    const nazwa = unikat("Setup unikalny");
    expect((await zaloz({ name: nazwa, ...ai })).status).toBe(201);
    const dubel = await zaloz({ name: nazwa.toUpperCase(), ...ai });
    expect(dubel.status).toBe(409);
    expect(dubel.json.code).toBe("title_taken");
    expect((await zaloz({ name: unikat("S5"), ...ai }, ro.token)).status).toBe(403);
  });

  it("niezmienna tresc wersji i jedna propozycja naraz: druga nowa propozycja = 409, ta sama tresc = ta sama wersja (200), odrzucona nie wraca", async () => {
    const s = await zaloz({ name: unikat("Setup wersji"), ...ai, stopRule: "v1" });
    const slug = s.json.slug as string;
    const [wers] = await sql`select sv.id from setup_versions sv join setups st on st.id = sv.setup_id where st.slug = ${slug}`;
    const e1 = await sql`update setup_versions set stop_rule = 'zmienione' where id = ${wers.id}`.catch((e: { code?: string }) => e);
    expect((e1 as { code?: string }).code).toBe("TJ409");

    const powtorka = await wersja(slug, { ...ai, stopRule: "v1" });
    expect(powtorka.status).toBe(200);
    expect(powtorka.json).toMatchObject({ version: 1, created: false, status: "proposed" });
    const druga = await wersja(slug, { ...ai, stopRule: "v2" });
    expect(druga.status).toBe(409);
    expect(druga.json.code).toBe("proposal_pending");

    const { odrzucWersjeSetupu, przyjmijWersjeSetupu } = await import("@/lib/decyzje/wersje");
    expect((await odrzucWersjeSetupu(wers.id, "")).ok).toBe(false); // powod wymagany
    expect((await odrzucWersjeSetupu(wers.id, "Za wcześnie na ocenę.")).ok).toBe(true);
    const [po] = await sql`select status, decision_reason from setup_versions where id = ${wers.id}`;
    expect(po).toEqual({ status: "rejected", decision_reason: "Za wcześnie na ocenę." });
    const wraca = await wersja(slug, { ...ai, stopRule: "v1" });
    expect(wraca.status).toBe(409);
    expect(wraca.json.code).toBe("previously_rejected");

    const nowa = await wersja(slug, { ...ai, stopRule: "v2" });
    expect(nowa.status).toBe(201);
    expect(nowa.json.version).toBe(2);
    const [w2] = await sql`select id from setup_versions where setup_id = (select id from setups where slug = ${slug}) and version = 2`;
    expect((await przyjmijWersjeSetupu(w2.id)).ok).toBe(true);
    const sz = await szczegoly(slug);
    expect(sz.json.current.version).toBe(2);
    expect(sz.json.versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(["2:approved", "1:rejected"]);
    // zatwierdzona wersja zostaje nastepnie zastapiona kolejna zatwierdzona
    const trzecia = await wersja(slug, { ...ai, stopRule: "v3" });
    const [w3] = await sql`select id from setup_versions where setup_id = (select id from setups where slug = ${slug}) and version = ${trzecia.json.version}`;
    await przyjmijWersjeSetupu(w3.id);
    const po3 = await szczegoly(slug);
    expect(po3.json.versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(["3:approved", "2:superseded", "1:rejected"]);
    expect((await przyjmijWersjeSetupu(w3.id)).ok).toBe(false); // juz nie jest propozycja
  });

  it("agent nie zatwierdzi wersji setupu: SQL z aktorem api:* = TJ403", async () => {
    const s = await zaloz({ name: unikat("Setup bez zatwierdzenia"), ...ai });
    const { zapisZAktorem } = await import("./zapis");
    const { sql: dsql } = await import("drizzle-orm");
    let kod: string | undefined;
    try {
      await zapisZAktorem(`api:${rw.id}`, (tx) => tx.execute(dsql`update setup_versions set status = 'approved', decided_at = now() where setup_id = (select id from setups where slug = ${s.json.slug})`));
    } catch (e) {
      kod = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
    }
    expect(kod).toBe("TJ403");
    const sz = await szczegoly(s.json.slug);
    expect(sz.json.current).toBeNull();
  });

  it("statystyka setupu: osobno live i backtest, Wilson i bootstrap z n, break-even z wlasnych W/L, status wg progow z gory, ile R znika backtest -> live", async () => {
    const s = await zaloz({ name: unikat("Setup ze statystyka"), ...ai, thresholds: { minN: 5, potwierdzenieN: 50 } });
    const slug = s.json.slug as string;
    const [w] = await sql`select sv.id, st.id as setup_id from setup_versions sv join setups st on st.id = sv.setup_id where st.slug = ${slug}`;
    const { przyjmijWersjeSetupu } = await import("@/lib/decyzje/wersje");
    await przyjmijWersjeSetupu(w.id);

    const wstaw = async (r: number, sesja: number | null) => {
      const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "closed", r, sesjaId: sesja });
      await sql`update trades set setup_id = ${w.setup_id} where id = ${id}`;
    };
    for (let i = 0; i < 8; i += 1) await wstaw(2, null); // live: 8 x +2R
    for (let i = 0; i < 4; i += 1) await wstaw(-1, null); // live: 4 x -1R
    for (let i = 0; i < 3; i += 1) await wstaw(1, sesjaId); // backtest: 3 x +1R
    for (let i = 0; i < 3; i += 1) await wstaw(-1, sesjaId); // backtest: 3 x -1R

    const sz = await szczegoly(slug);
    zgodneZKontraktem("get", "/setups/{slug}", sz.json);
    expect(sz.json.thresholdsUsed).toEqual({ minN: 5, potwierdzenieN: 50 });
    const live = sz.json.stats.bySource.live;
    expect(live).toMatchObject({ n: 12, wins: 8, losses: 4, status: "obiecujacy", statusNazwa: "obiecujący" });
    expect(live.breakEvenWinRate).toBeCloseTo(1 / 3, 9);
    expect(live.winRate.p).toBeCloseTo(8 / 12, 9);
    expect(live.winRate.low).toBeGreaterThan(1 / 3); // dolna granica Wilsona nad break-even, ale n < 50 => nie »potwierdzony«
    expect(live.winRate.low).toBeCloseTo(0.3902, 3);
    expect(live.expectancyR.mean).toBeCloseTo(1, 9);
    expect(live.expectancyR.orientacyjnie).toBe(true);
    expect(live.expectancyR.low).toBeLessThan(1);
    expect(live.expectancyR.high).toBeGreaterThan(1);
    expect(live.opis).toContain("n = 12 < 50");

    const bt = sz.json.stats.bySource.backtest;
    expect(bt).toMatchObject({ n: 6, wins: 3, losses: 3, status: "niejednoznaczny" });
    expect(bt.expectancyR.mean).toBeCloseTo(0, 9);
    expect(sz.json.stats.bySource.demo).toBeNull();
    expect(sz.json.stats.bySource.forward).toBeNull();
    expect(sz.json.stats.backtestToLive).toMatchObject({ backtestN: 6, liveN: 12, orientacyjnie: true });
    expect(sz.json.stats.backtestToLive.diffR).toBeCloseTo(-1, 9);
    expect(sz.json.tradesLinked).toBe(18);
  });

  it("n ponizej progu zadeklarowanego z gory = »nieważny«, nawet gdy wszystko wygrywa; bez zatwierdzonej wersji obowiazuja progi domyslne 20/100", async () => {
    const s = await zaloz({ name: unikat("Setup malej proby"), ...ai, thresholds: { minN: 30, potwierdzenieN: 100 } });
    const [w] = await sql`select sv.id, st.id as setup_id from setup_versions sv join setups st on st.id = sv.setup_id where st.slug = ${s.json.slug}`;
    for (let i = 0; i < 10; i += 1) {
      const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "closed", r: 2 });
      await sql`update trades set setup_id = ${w.setup_id} where id = ${id}`;
    }
    const bezWersji = await szczegoly(s.json.slug);
    expect(bezWersji.json.thresholdsUsed).toEqual({ minN: 20, potwierdzenieN: 100 }); // wersja jeszcze nie zatwierdzona
    expect(bezWersji.json.stats.bySource.live).toMatchObject({ n: 10, status: "niewazny", statusPowod: "za_malo_danych" });
    const { przyjmijWersjeSetupu } = await import("@/lib/decyzje/wersje");
    await przyjmijWersjeSetupu(w.id);
    const z = await szczegoly(s.json.slug);
    expect(z.json.thresholdsUsed).toEqual({ minN: 30, potwierdzenieN: 100 });
    expect(z.json.stats.bySource.live.opis).toContain("10 z wymaganych 30");
  });

  it("karta setupu to rodzaj zarzadzany: POST /notes z kind=setup = 422 z odeslaniem, PATCH takiej notatki = 409; nieznany slug = 404", async () => {
    const dubel = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "setup", title: unikat("Karta bokiem"), bodyMd: "" } });
    expect(dubel.status).toBe(422);
    expect(dubel.json.useInstead).toBe("/api/v2/setups");
    const s = await zaloz({ name: unikat("Setup zarzadzany"), ...ai });
    const [n] = await sql`select n.id, n.rev from notes n join setups st on st.note_id = n.id where st.slug = ${s.json.slug}`;
    const patch = await wywolaj(import("@/app/api/v2/notes/[id]/route"), "PATCH", `/notes/${n.id}`, { token: rw.token, cialo: { bodyMd: "podmiana" }, naglowki: { "if-match": String(n.rev) } }, PARAMS({ id: String(n.id) }));
    expect(patch.status).toBe(409);
    expect(patch.json.code).toBe("managed_note");
    expect((await szczegoly("nie-ma-takiego-setupu")).status).toBe(404);
  });
});
