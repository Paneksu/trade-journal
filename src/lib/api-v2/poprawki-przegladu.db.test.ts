import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, zapiszSlowa, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Poprawki po audycie i review fazy 2b (15.10.2026), cz. 2:
 *  - «Plan z moich slow = zatwierdzenie»: setup trade'a liczy sie od razu tylko z planu przed wejsciem z moimi
 *    slowami; kazde inne przypisanie przez AI czeka w kolejce (rodzaj trade_setup);
 *  - cofniecie oceny procesu nie nadpisuje pozniejszej zmiany uzytkownika (P4);
 *  - «popraw i przyjmij» dla wersji setupu (P6);
 *  - limity dlugosci i NUL w decyzjach uzytkownika (audyt 8).
 */
describe.skipIf(!MOZNA_NA_BAZIE)("poprawki po przegladzie: setup z planu, cofanie, popraw i przyjmij (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let instrumentId = 0;
  let kontoId = 0;
  let setupId = 0;
  let slug = "";
  let wersjaId = 0;
  const znacznik = unikat("poprpr");
  const PRZYSZLOSC = "2099-01-05"; // wejscie PO zamrozeniu planu (plan powstaje teraz)
  const PRZESZLOSC = "1983-04-04"; // wejscie PRZED zamrozeniem planu

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    const [k] = await sql`insert into accounts (name, type) values (${`POPRPR-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
    const z = await wywolaj(import("@/app/api/v2/setups/route"), "POST", "/setups", {
      token: rw.token,
      cialo: { name: unikat("Setup poprawki"), bodyMd: "x", origin: "ai", counterargument: "Szum próby.", evidence: { n: 12 }, preconditions: [], entryChecklist: [{ id: "a", text: "A" }], stopRule: "Stop pod knotem", targetRule: "Cel 2R" },
    });
    expect(z.status, JSON.stringify(z.json)).toBe(201);
    slug = z.json.slug;
    const [w] = await sql`select sv.id, st.id as setup_id from setup_versions sv join setups st on st.id = sv.setup_id where st.slug = ${slug}`;
    setupId = w.setup_id;
    wersjaId = w.id;
    const { przyjmijWersjeSetupu } = await import("@/lib/decyzje/wersje");
    expect((await przyjmijWersjeSetupu(wersjaId)).ok).toBe(true);
  });
  afterAll(async () => {
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

  const plan = (dzien: string, nadpisz: Record<string, unknown> = {}) => ({
    accountId: kontoId,
    symbol: "NQ1!",
    day: dzien,
    direction: "long",
    entryPrice: 20000 + Math.floor(Math.random() * 1000),
    stopLoss: 19000,
    contracts: 1,
    setupSlug: slug,
    ...nadpisz,
  });
  const utworzPlan = (cialo: Record<string, unknown>) => wywolaj(import("@/app/api/v2/trade-plans/route"), "POST", "/trade-plans", { token: rw.token, cialo });
  const trade = async (dzien: string) => wstawTrade(sql, { kontoId, instrumentId, dzien, status: "open" });
  const setupTradu = async (id: number) => (await sql`select setup_id, setup_version_id from trades where id = ${id}`)[0];
  const sugestieSetupu = async (id: number) => sql`select id, status, payload from ai_suggestions where kind = 'trade_setup' and target = ${sql.json({ type: "trade", id })}`;

  describe("«Plan z moich slow = zatwierdzenie»", () => {
    it("plan z tezą ze slow uzytkownika zamrozony PRZED wejsciem: setup i jego wersja wchodza do trade'a od razu, bez kolejki", async () => {
      const id = await trade(PRZYSZLOSC);
      const teza = await zapiszSlowa(rw.token, "Wchodzę po sweepie PDL, bo to płynność.", { day: PRZYSZLOSC, role: "plan.thesis" });
      const p = await utworzPlan(plan(PRZYSZLOSC, { thesisWordsId: teza.id, tradeId: id }));
      expect(p.status, JSON.stringify(p.json)).toBe(201);
      zgodneZKontraktem("post", "/trade-plans", p.json);
      expect(await setupTradu(id)).toEqual({ setup_id: setupId, setup_version_id: wersjaId });
      expect(await sugestieSetupu(id)).toHaveLength(0);
    });

    it("plan BEZ tezy ze slow uzytkownika: trade nie dostaje setupu, powstaje sugestia trade_setup; statystyki setupu go nie licza", async () => {
      const id = await trade(PRZYSZLOSC);
      const p = await utworzPlan(plan(PRZYSZLOSC, { tradeId: id }));
      expect(p.status, JSON.stringify(p.json)).toBe(201);
      expect(await setupTradu(id)).toEqual({ setup_id: null, setup_version_id: null });
      const sug = await sugestieSetupu(id);
      expect(sug).toHaveLength(1);
      expect(sug[0].status).toBe("pending");
      expect(sug[0].payload).toEqual({ setupSlug: slug, setupId, setupVersionId: wersjaId });

      // zamkniety trade z takim planem nie wchodzi do statystyk setupu przed zatwierdzeniem
      await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 1, exit_price = 20100, exit_time = now(), pnl = 100000, r_multiple = 2 where id = ${id}`;
      const sz = await wywolaj(import("@/app/api/v2/setups/[slug]/route"), "GET", `/setups/${slug}`, { token: ro.token }, PARAMS({ slug }));
      const przed = sz.json.tradesLinked;

      const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
      const ok = await zatwierdzSugestie(sug[0].id);
      expect(ok.ok, JSON.stringify(ok)).toBe(true);
      expect(await setupTradu(id)).toEqual({ setup_id: setupId, setup_version_id: wersjaId });
      const po = await wywolaj(import("@/app/api/v2/setups/[slug]/route"), "GET", `/setups/${slug}`, { token: ro.token }, PARAMS({ slug }));
      expect(po.json.tradesLinked).toBe(przed + 1);
      expect(po.json.statsByVersion.find((x: { version: number }) => x.version === 1).stats.bySource.live.n).toBeGreaterThanOrEqual(1);

      expect((await cofnijSugestie(sug[0].id)).ok).toBe(true);
      expect(await setupTradu(id)).toEqual({ setup_id: null, setup_version_id: null });
    });

    it("plan z tezą, ale zamrozony PO wejsciu (trade z przeszlosci): tez idzie kolejka; ponowny przypisek nie dubluje sugestii", async () => {
      const id = await trade(PRZESZLOSC);
      const teza = await zapiszSlowa(rw.token, "Teza napisana po fakcie.", { day: PRZESZLOSC, role: "plan.thesis" });
      const p = await utworzPlan(plan(PRZESZLOSC, { thesisWordsId: teza.id, tradeId: id }));
      expect(p.status, JSON.stringify(p.json)).toBe(201);
      expect(await setupTradu(id)).toEqual({ setup_id: null, setup_version_id: null });
      expect(await sugestieSetupu(id)).toHaveLength(1);
      const jeszczeRaz = await wywolaj(import("@/app/api/v2/trade-plans/[id]/attach/route"), "POST", `/trade-plans/${p.json.plan.id}/attach`, { token: rw.token, cialo: { tradeId: id } }, PARAMS({ id: String(p.json.plan.id) }));
      expect(jeszczeRaz.status).toBeLessThan(300);
      expect(await sugestieSetupu(id)).toHaveLength(1);
    });

    it("cofniecie sugestii nie nadpisuje pozniejszej decyzji: jesli trade ma juz inny setup, UI odmawia", async () => {
      const id = await trade(PRZYSZLOSC);
      await utworzPlan(plan(PRZYSZLOSC, { tradeId: id }));
      const [s] = await sugestieSetupu(id);
      const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
      expect((await zatwierdzSugestie(s.id)).ok).toBe(true);
      const drugi = await wywolaj(import("@/app/api/v2/setups/route"), "POST", "/setups", {
        token: rw.token,
        cialo: { name: unikat("Drugi setup"), bodyMd: "x", origin: "ai", counterargument: "Szum.", evidence: { n: 1 }, preconditions: [], entryChecklist: [{ id: "a", text: "A" }] },
      });
      expect(drugi.status, JSON.stringify(drugi.json)).toBe(201);
      const [inny] = await sql`select id from setups where slug = ${drugi.json.slug}`;
      await sql`update trades set setup_id = ${inny.id} where id = ${id}`;
      const odmowa = await cofnijSugestie(s.id);
      expect(odmowa.ok).toBe(false);
      expect(odmowa.komunikat).toContain("inny setup");
      expect((await setupTradu(id)).setup_id).toBe(inny.id);
      expect((await sql`select status from ai_suggestions where id = ${s.id}`)[0].status).toBe("accepted");
      await sql`update trades set setup_id = ${setupId} where id = ${id}`;
      expect((await cofnijSugestie(s.id)).ok).toBe(true); // gdy setup nadal jest ten z sugestii, cofniecie dziala
      expect((await setupTradu(id)).setup_id).toBeNull();
    });
  });

  describe("warunki »moich slow« dla tezy planu (audyt, 15.10.2026)", () => {
    const kolejka = async (id: number) => (await sugestieSetupu(id)).length;

    it("zla rola, cudzy trade, zly dzien albo przyszle captured_at: przypisanie idzie do kolejki, nie do trade'a", async () => {
      const przypadki: { opis: string; slowa: () => Promise<{ id: number }> }[] = [
        { opis: "rola inna niz plan.thesis", slowa: async () => zapiszSlowa(rw.token, `Teza bez roli ${unikat("a")}`, { day: PRZYSZLOSC }) },
        { opis: "slowa z innego dnia", slowa: async () => zapiszSlowa(rw.token, `Teza z innego dnia ${unikat("b")}`, { day: "2099-01-04", role: "plan.thesis" }) },
        { opis: "slowa przypisane do cudzego trade'a", slowa: async () => zapiszSlowa(rw.token, `Teza cudza ${unikat("c")}`, { day: PRZYSZLOSC, role: "plan.thesis", tradeId: await trade(PRZYSZLOSC) }) },
        { opis: "captured_at w przyszlosci", slowa: async () => zapiszSlowa(rw.token, `Teza z przyszlosci ${unikat("d")}`, { day: PRZYSZLOSC, role: "plan.thesis", capturedAt: new Date(Date.now() + 3_600_000).toISOString() }) },
      ];
      for (const p of przypadki) {
        const id = await trade(PRZYSZLOSC);
        const teza = await p.slowa();
        const r = await utworzPlan(plan(PRZYSZLOSC, { thesisWordsId: teza.id, tradeId: id }));
        expect(r.status, `${p.opis}: ${JSON.stringify(r.json)}`).toBe(201);
        expect(await setupTradu(id), p.opis).toEqual({ setup_id: null, setup_version_id: null });
        expect(await kolejka(id), p.opis).toBe(1);
      }
    });

    it("te same slowa w drugim planie: pierwszy plan byl zatwierdzeniem, drugi idzie do kolejki", async () => {
      const wspolne = await zapiszSlowa(rw.token, `Jedna teza dla dwoch planow ${unikat("e")}`, { day: PRZYSZLOSC, role: "plan.thesis" });
      const a = await trade(PRZYSZLOSC);
      expect((await utworzPlan(plan(PRZYSZLOSC, { thesisWordsId: wspolne.id, tradeId: a }))).status).toBe(201);
      expect((await setupTradu(a)).setup_id).toBe(setupId);
      const b = await trade(PRZYSZLOSC);
      expect((await utworzPlan(plan(PRZYSZLOSC, { thesisWordsId: wspolne.id, tradeId: b }))).status).toBe(201);
      expect(await setupTradu(b)).toEqual({ setup_id: null, setup_version_id: null });
      expect(await kolejka(b)).toBe(1);
    });
  });

  describe("zmiana entry_time po planie (audyt N3)", () => {
    it("plan zapamietuje czas wejscia z przypiecia; pozniejsza zmiana entry_time nie zmienia zapamietanej wartosci ani decyzji", async () => {
      const id = await trade(PRZESZLOSC); // plan powstaje PO wejsciu
      const [{ wejscie }] = await sql`select entry_time as wejscie from trades where id = ${id}`;
      const teza = await zapiszSlowa(rw.token, `Teza po fakcie ${unikat("f")}`, { day: PRZESZLOSC, role: "plan.thesis" });
      const p = await utworzPlan(plan(PRZESZLOSC, { thesisWordsId: teza.id, tradeId: id }));
      expect(p.status, JSON.stringify(p.json)).toBe(201);
      expect((await sugestieSetupu(id)).length).toBe(1);
      const [przed] = await sql`select entry_time_at_attach as t from trade_plans where id = ${p.json.plan.id}`;
      expect(new Date(przed.t).getTime()).toBe(new Date(wejscie).getTime());

      await sql`update trades set entry_time = now() + interval '30 days' where id = ${id}`;
      const [po] = await sql`select entry_time_at_attach as t from trade_plans where id = ${p.json.plan.id}`;
      expect(new Date(po.t).getTime()).toBe(new Date(wejscie).getTime());
      const jeszcze = await wywolaj(import("@/app/api/v2/trade-plans/[id]/attach/route"), "POST", `/trade-plans/${p.json.plan.id}/attach`, { token: rw.token, cialo: { tradeId: id } }, PARAMS({ id: String(p.json.plan.id) }));
      expect(jeszcze.status).toBeLessThan(300);
      expect((await setupTradu(id)).setup_id).toBeNull();
      // straznik planu nadal blokuje inne zmiany, takze tej kolumny
      const e = await sql`update trade_plans set entry_time_at_attach = now() where id = ${p.json.plan.id}`.then(() => null, (x: { code?: string }) => x.code);
      expect(e).toBe("TJ409");
    });
  });

  describe("sugestia trade_setup niesie wersje z chwili wejscia (review, bloker)", () => {
    it("wersja 2 przyjeta MIEDZY wejsciem a zatwierdzeniem: trade trafia do wersji 1", async () => {
      const { przyjmijWersjeSetupu } = await import("@/lib/decyzje/wersje");
      const { zatwierdzSugestie } = await import("@/lib/decyzje/sugestie");
      const nowy = await wywolaj(import("@/app/api/v2/setups/route"), "POST", "/setups", {
        token: rw.token,
        cialo: { name: unikat("Setup wersje czasu"), bodyMd: "x", origin: "ai", counterargument: "Szum.", evidence: { n: 12 }, preconditions: [], entryChecklist: [{ id: "a", text: "A" }], stopRule: "S1", targetRule: "T1" },
      });
      expect(nowy.status, JSON.stringify(nowy.json)).toBe(201);
      const slugN = nowy.json.slug as string;
      const [{ id: sId }] = await sql`select id from setups where slug = ${slugN}`;
      const [{ id: v1 }] = await sql`select id from setup_versions where setup_id = ${sId} and status = 'proposed'`;
      expect((await przyjmijWersjeSetupu(v1)).ok).toBe(true);
      const prop = await wywolaj(import("@/app/api/v2/setups/[slug]/versions/route"), "POST", `/setups/${slugN}/versions`, { token: rw.token, cialo: { origin: "ai", counterargument: "Szum.", evidence: { n: 20 }, preconditions: [], entryChecklist: [{ id: "a", text: "A" }], stopRule: "S2" } }, PARAMS({ slug: slugN }));
      expect(prop.status, JSON.stringify(prop.json)).toBe(201);
      const [{ id: v2 }] = await sql`select id from setup_versions where setup_id = ${sId} and status = 'proposed'`;
      expect((await przyjmijWersjeSetupu(v2)).ok).toBe(true);
      const wersje = await sql`select id, decided_at, superseded_at from setup_versions where setup_id = ${sId} order by version`;
      expect(wersje[0].superseded_at).not.toBeNull();
      const t1 = new Date(wersje[0].decided_at).getTime();
      const t2 = new Date(wersje[1].decided_at).getTime();
      expect(t2).toBeGreaterThan(t1);
      const polowa = new Date(Math.floor((t1 + t2) / 2)).toISOString();
      const id = await trade(PRZYSZLOSC);
      await sql`update trades set entry_time = ${polowa}::timestamptz where id = ${id}`;

      const sug = await wywolaj(import("@/app/api/v2/ai-suggestions/route"), "POST", "/ai-suggestions", {
        token: rw.token,
        cialo: { kind: "trade_setup", target: { type: "trade", id }, payload: { setupSlug: slugN }, claim: "Wejscie pasuje do setupu.", evidence: [{ type: "trade", ref: id, note: "wejscie" }], evidenceLevel: "partial", n: 3 },
      });
      expect(sug.status, JSON.stringify(sug.json)).toBe(201);
      const [{ payload }] = await sql`select payload from ai_suggestions where id = ${sug.json.suggestion.id}`;
      expect(payload.setupVersionId).toBe(v1);
      expect((await zatwierdzSugestie(sug.json.suggestion.id)).ok).toBe(true);
      expect(await setupTradu(id)).toEqual({ setup_id: sId, setup_version_id: v1 });

      // stara sugestia bez setupVersionId w payloadzie tez liczy wersje z chwili wejscia, nie dzisiejsza
      const id2 = await trade(PRZYSZLOSC);
      await sql`update trades set entry_time = ${polowa}::timestamptz where id = ${id2}`;
      const [stara] = await sql`insert into ai_suggestions (kind, target, payload, claim, evidence, evidence_level, status) values ('trade_setup', ${sql.json({ type: "trade", id: id2 })}, ${sql.json({ setupSlug: slugN, setupId: sId })}, 'stara', ${sql.json([{ type: "trade", ref: id2, note: "x" }])}, 'inferred', 'pending') returning id`;
      expect((await zatwierdzSugestie(stara.id)).ok).toBe(true);
      expect((await setupTradu(id2)).setup_version_id).toBe(v1);
    });
  });

  describe("sugestia oceny procesu (P4)", () => {
    it("cofniecie przywraca poprzednia ocene tylko, gdy obecna wartosc jest ta z sugestii; po zmianie uzytkownika odmawia z komunikatem", async () => {
      const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: PRZESZLOSC, status: "closed" });
      const sug = await wywolaj(import("@/app/api/v2/ai-suggestions/route"), "POST", "/ai-suggestions", {
        token: rw.token,
        cialo: { kind: "process_grade", target: { type: "trade", id }, payload: { grade: "A" }, claim: "Proces zgodny z planem.", evidence: [{ type: "trade", ref: id, note: "plan i SL zgodne" }], evidenceLevel: "partial", n: 5 },
      });
      expect(sug.status, JSON.stringify(sug.json)).toBe(201);
      const { zatwierdzSugestie, cofnijSugestie } = await import("@/lib/decyzje/sugestie");
      expect((await zatwierdzSugestie(sug.json.suggestion.id)).ok).toBe(true);
      expect((await sql`select process_grade from trades where id = ${id}`)[0].process_grade).toBe("A");

      // uzytkownik zmienia ocene na C: cofniecie sugestii nie moze jej skasowac ani zamienic
      await sql`update trades set process_grade = 'C', process_graded_at = now() where id = ${id}`;
      const odmowa = await cofnijSugestie(sug.json.suggestion.id);
      expect(odmowa.ok).toBe(false);
      expect(odmowa.komunikat).toContain("ocenę procesu C");
      expect((await sql`select process_grade from trades where id = ${id}`)[0].process_grade).toBe("C");
      expect((await sql`select status from ai_suggestions where id = ${sug.json.suggestion.id}`)[0].status).toBe("accepted");

      // gdy wartosc nadal jest ta z sugestii, cofniecie dziala
      await sql`update trades set process_grade = 'A', process_graded_at = now() where id = ${id}`;
      expect((await cofnijSugestie(sug.json.suggestion.id)).ok).toBe(true);
      expect((await sql`select process_grade from trades where id = ${id}`)[0].process_grade).toBeNull();
    });
  });

  describe("«popraw i przyjmij» dla wersji setupu (P6)", () => {
    const nowaPropozycja = (cialo: Record<string, unknown>) =>
      wywolaj(import("@/app/api/v2/setups/[slug]/versions/route"), "POST", `/setups/${slug}/versions`, { token: rw.token, cialo: { origin: "ai", counterargument: "Szum próby.", evidence: { n: 15 }, preconditions: [], entryChecklist: [{ id: "a", text: "A" }], ...cialo } }, PARAMS({ slug }));

    it("oryginal idzie do odrzuconych, poprawiona wersja uzytkownika jest obowiazujaca, progi i lista zostaja; ta sama tresc i puste pola = odmowa", async () => {
      const { przyjmijWersjeSetupuZPoprawka } = await import("@/lib/decyzje/wersje");
      const p = await nowaPropozycja({ stopRule: "Stop 10 pkt", targetRule: "Cel 3R", thresholds: { minN: 7, potwierdzenieN: 70 } });
      expect(p.status, JSON.stringify(p.json)).toBe(201);
      const [prop] = await sql`select id, version from setup_versions where setup_id = ${setupId} and status = 'proposed'`;

      expect((await przyjmijWersjeSetupuZPoprawka(prop.id, {})).ok).toBe(false); // nic nie zmieniono
      expect((await przyjmijWersjeSetupuZPoprawka(prop.id, { stopRule: "Stop 10 pkt" })).ok).toBe(false); // ta sama tresc
      const poprawka = "Stop pod knotem sweepu,\r\nnie mniej niż 8 pkt. Zażółć 🙂";
      const w = await przyjmijWersjeSetupuZPoprawka(prop.id, { stopRule: poprawka, avoid: "  " });
      expect(w.ok, JSON.stringify(w)).toBe(true);

      const wersje = await sql`select version, status, origin, stop_rule, target_rule, avoid, thresholds, decision_reason from setup_versions where setup_id = ${setupId} order by version`;
      const orygin = wersje.find((x) => x.version === prop.version);
      expect(orygin).toMatchObject({ status: "rejected" });
      expect(orygin?.decision_reason).toContain("Poprawiona przez użytkownika");
      const nowa = wersje[wersje.length - 1];
      expect(nowa).toMatchObject({ status: "approved", origin: "user", target_rule: "Cel 3R", thresholds: { minN: 7, potwierdzenieN: 70 } });
      expect(nowa.stop_rule).toBe(poprawka);
      expect(nowa.avoid).toBeNull();
      expect(wersje.filter((x) => x.status === "approved")).toHaveLength(1);
      expect((await przyjmijWersjeSetupuZPoprawka(prop.id, { stopRule: "Jeszcze raz" })).ok).toBe(false); // propozycji juz nie ma
    });
  });

  describe("limity tekstow z formularzy (audyt 8)", () => {
    it("poprawiony tekst reguly, powod odrzucenia i pola setupu: NUL i za dlugi tekst odrzuca serwer, zanim cokolwiek zapisze", async () => {
      const { przyjmijWersjeRegulyZPoprawka, odrzucWersjeReguly, odrzucWersjeSetupu, przyjmijWersjeSetupuZPoprawka, MAX_TEKST_REGULY, MAX_POWOD } = await import("@/lib/decyzje/wersje");
      const nul = String.fromCharCode(0);
      const r1 = await przyjmijWersjeRegulyZPoprawka(1, `tekst${nul}z nul`);
      expect(r1.ok).toBe(false);
      expect(r1.komunikat).toContain("NUL");
      const r2 = await przyjmijWersjeRegulyZPoprawka(1, "x".repeat(MAX_TEKST_REGULY + 1));
      expect(r2.komunikat).toContain(`limit to ${MAX_TEKST_REGULY}`);
      expect((await odrzucWersjeReguly(1, "y".repeat(MAX_POWOD + 1))).komunikat).toContain(`limit to ${MAX_POWOD}`);
      expect((await odrzucWersjeReguly(1, `powod${nul}`)).komunikat).toContain("NUL");
      expect((await odrzucWersjeSetupu(1, "z".repeat(MAX_POWOD + 1))).komunikat).toContain(`limit to ${MAX_POWOD}`);
      expect((await przyjmijWersjeSetupuZPoprawka(1, { stopRule: `a${nul}b` })).komunikat).toContain("NUL");
      expect((await przyjmijWersjeSetupuZPoprawka(1, { avoid: "q".repeat(MAX_TEKST_REGULY + 1) })).komunikat).toContain("limit to");
    });
  });
});
