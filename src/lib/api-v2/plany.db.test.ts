import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, zapiszSlowa, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Plan zamrozony (MUST 1): POST raz, potem tylko dopiski. Dowodem jest odczyt z bazy i proba zmiany
 * prosto w SQL (trigger), nie sam kod HTTP. Ryzyko planu to migawka z computeTrade.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("plan zamrozony przed wejsciem (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let instrumentId = 0;
  let kontoId = 0;
  let inneKontoId = 0;
  const DZIEN = "1989-05-10";
  const znacznik = unikat("plan");
  const tradeIds: number[] = [];

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    const [k] = await sql`insert into accounts (name, type) values (${`PLAN-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
    const [k2] = await sql`insert into accounts (name, type) values (${`PLAN2-${znacznik}`}, 'live') returning id`;
    inneKontoId = k2.id;
  });
  afterAll(async () => {
    await sql`delete from trades where account_id in (${kontoId}, ${inneKontoId})`;
    await sprzatnijNowe(sql, [rw.id, ro.id]);
    await sql`delete from accounts where id in (${kontoId}, ${inneKontoId})`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const plan = (nadpisz: Record<string, unknown> = {}) => ({
    accountId: kontoId,
    symbol: "NQ1!",
    day: DZIEN,
    direction: "long",
    bias: "long",
    entryPrice: 20000,
    stopLoss: 19990,
    takeProfit: 20040,
    contracts: 2,
    ...nadpisz,
  });
  const utworz = (cialo: Record<string, unknown>, token = rw.token) =>
    wywolaj(import("@/app/api/v2/trade-plans/route"), "POST", "/trade-plans", { token, cialo });
  const szczegoly = (id: number) => wywolaj(import("@/app/api/v2/trade-plans/[id]/route"), "GET", `/trade-plans/${id}`, { token: ro.token }, PARAMS({ id: String(id) }));

  async function blad(zapytanie: PromiseLike<unknown>): Promise<{ code?: string; message?: string }> {
    try {
      await zapytanie;
    } catch (e) {
      return e as { code?: string };
    }
    throw new Error("Oczekiwano bledu SQL, a zapytanie przeszlo");
  }

  it("zamraza plan: ryzyko z computeTrade (10 pkt NQ x 2 kontrakty = 40000 c), origin ai, czas zegarowy, zestaw regul; odpowiedz zgodna z kontraktem", async () => {
    const teza = await zapiszSlowa(rw.token, "Wchodzę po sweepie PDL, żeby zebrać płynność 🙂\nSL pod knotem.", { day: DZIEN, role: "plan.thesis" });
    const uniew = await zapiszSlowa(rw.token, "Unieważnione, jeśli 5m zamknie się pod 19985.", { day: DZIEN, role: "plan.invalidation" });
    const r = await utworz(plan({ thesisWordsId: teza.id, invalidationWordsId: uniew.id }));
    expect(r.status).toBe(201);
    zgodneZKontraktem("post", "/trade-plans", r.json);
    expect(r.json.created).toBe(true);
    const p = r.json.plan;
    expect(p).toMatchObject({ riskCents: 40000, origin: "ai", direction: "long", entryPrice: 20000, stopLoss: 19990, takeProfit: 20040, contracts: 2, tradeId: null });
    expect(p.thesis.text).toBe("Wchodzę po sweepie PDL, żeby zebrać płynność 🙂\nSL pod knotem.");
    expect(p.thesis.sha256).toBe(teza.sha256);

    const [w] = await sql`select risk_cents::float8 as risk, origin, created_by_token_id, frozen_at > now() - interval '1 minute' as swiezy, ruleset_version
                            from trade_plans where id = ${p.id}`;
    expect(w).toMatchObject({ risk: 40000, origin: "ai", created_by_token_id: rw.id, swiezy: true });
    const [u] = await sql`select ruleset_version from settings where id = 1`;
    expect(w.ruleset_version).toBe(u.ruleset_version);
  });

  it("ten sam plan wyslany ponownie to ten sam wiersz (200), bez duplikatu", async () => {
    const cialo = plan({ entryPrice: 20100, stopLoss: 20090, takeProfit: 20140 });
    const pierwszy = await utworz(cialo);
    expect(pierwszy.status).toBe(201);
    const drugi = await utworz(cialo);
    expect(drugi.status).toBe(200);
    expect(drugi.json.created).toBe(false);
    expect(drugi.json.plan.id).toBe(pierwszy.json.plan.id);
    const [{ ile }] = await sql`select count(*)::int as ile from trade_plans where account_id = ${kontoId} and entry_price = 20100`;
    expect(ile).toBe(1);
  });

  it("zamrozony plan nie daje sie zmienic: PATCH i PUT = 409 ze wskazaniem dopiskow, a UPDATE w SQL odrzuca baza (TJ409)", async () => {
    const r = await utworz(plan({ entryPrice: 20200, stopLoss: 20190, takeProfit: 20240 }));
    const id = r.json.plan.id as number;
    for (const metoda of ["PATCH", "PUT"] as const) {
      const odm = await wywolaj(import("@/app/api/v2/trade-plans/[id]/route"), metoda, `/trade-plans/${id}`, { token: rw.token, cialo: { stopLoss: 20000 } }, PARAMS({ id: String(id) }));
      expect(odm.status).toBe(409);
      expect(odm.json.code).toBe("immutable");
      expect(odm.json.error).toContain(`/addenda`);
    }
    const e1 = await blad(sql`update trade_plans set stop_loss = 20000 where id = ${id}`);
    expect(e1.code).toBe("TJ409");
    const e2 = await blad(sql`update trade_plans set contracts = 9 where id = ${id}`);
    expect(e2.code).toBe("TJ409");
    const [po] = await sql`select stop_loss::float8 as sl, contracts::float8 as k from trade_plans where id = ${id}`;
    expect(po).toEqual({ sl: 20190, k: 2 });
  });

  it("zmiana idzie jako dopisek ze slowami uzytkownika; dopisku nie da sie zmienic; plan zostaje nietkniety", async () => {
    const r = await utworz(plan({ entryPrice: 20300, stopLoss: 20290, takeProfit: 20340 }));
    const id = r.json.plan.id as number;
    const slowa = await zapiszSlowa(rw.token, "Przesuwam SL pod ostatni knot, bo zmienił się układ.", { day: DZIEN });
    const d = await wywolaj(import("@/app/api/v2/trade-plans/[id]/addenda/route"), "POST", `/trade-plans/${id}/addenda`, { token: rw.token, cialo: { field: "stop_loss", newValue: 20285, wordsId: slowa.id } }, PARAMS({ id: String(id) }));
    expect(d.status).toBe(201);
    zgodneZKontraktem("post", "/trade-plans/{id}/addenda", d.json);
    const e = await blad(sql`update trade_plan_addenda set new_value = '1'::jsonb where id = ${d.json.id}`);
    expect(e.code).toBe("TJ409");
    const s = await szczegoly(id);
    zgodneZKontraktem("get", "/trade-plans/{id}", s.json);
    expect(s.json.stopLoss).toBe(20290);
    expect(s.json.addenda).toHaveLength(1);
    expect(s.json.addenda[0]).toMatchObject({ field: "stop_loss", newValue: 20285, words: { text: "Przesuwam SL pod ostatni knot, bo zmienił się układ." } });
  });

  it("dopisek bez istniejacych slow = 422, bez slow = 400; plan nieistniejacy = 404", async () => {
    const r = await utworz(plan({ entryPrice: 20400, stopLoss: 20390, takeProfit: 20440 }));
    const id = r.json.plan.id as number;
    const mod = import("@/app/api/v2/trade-plans/[id]/addenda/route");
    const brakSlow = await wywolaj(mod, "POST", `/trade-plans/${id}/addenda`, { token: rw.token, cialo: { field: "other", wordsId: 999999999 } }, PARAMS({ id: String(id) }));
    expect(brakSlow.status).toBe(422);
    expect(brakSlow.json.error).toContain("999999999");
    const bezSlow = await wywolaj(mod, "POST", `/trade-plans/${id}/addenda`, { token: rw.token, cialo: { field: "other" } }, PARAMS({ id: String(id) }));
    expect(bezSlow.status).toBe(400);
    const brakPlanu = await wywolaj(mod, "POST", "/trade-plans/999999999/addenda", { token: rw.token, cialo: { field: "other", wordsId: 1 } }, PARAMS({ id: "999999999" }));
    expect(brakPlanu.status).toBe(404);
  });

  it("poziomy bez sensu: stop powyzej wejscia dla long = 422 z wartosciami, nic nie zapisano", async () => {
    const przed = await sql`select count(*)::int as ile from trade_plans where account_id = ${kontoId}`;
    const r = await utworz(plan({ stopLoss: 20010 }));
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("invalid_levels");
    expect(r.json.error).toContain("20010");
    const tp = await utworz(plan({ takeProfit: 19990 }));
    expect(tp.status).toBe(422);
    const po = await sql`select count(*)::int as ile from trade_plans where account_id = ${kontoId}`;
    expect(po[0].ile).toBe(przed[0].ile);
  });

  it("stop mniejszy niz tick od wejscia nie ma ryzyka = 422 no_risk", async () => {
    const r = await utworz(plan({ entryPrice: 20500, stopLoss: 20499.9, takeProfit: 20520 }));
    expect(r.status).toBe(422);
    expect(["no_risk", "invalid_levels"]).toContain(r.json.code);
  });

  it("nieznane konto i symbol = 422; token tylko do odczytu = 403; zle pole = 400", async () => {
    expect((await utworz(plan({ accountId: 999999999 }))).status).toBe(422);
    const symbol = await utworz(plan({ symbol: "US100" }));
    expect(symbol.status).toBe(422);
    expect(symbol.json.error).toContain("CFD");
    expect((await utworz(plan(), ro.token)).status).toBe(403);
    const literowka = await utworz({ ...plan(), stopLos: 1 });
    expect(literowka.status).toBe(400);
  });

  it("plan wskazujacy trade: kopiuje setup, wersje i zestaw do trade'a RAZ; drugi plan na ten sam trade = 409", async () => {
    const tradeId = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open", wejscie: 20600, sl: 20590 });
    tradeIds.push(tradeId);
    const r = await utworz(plan({ entryPrice: 20600, stopLoss: 20590, takeProfit: 20640, tradeId }));
    expect(r.status).toBe(201);
    const [t] = await sql`select ruleset_version from trades where id = ${tradeId}`;
    expect(t.ruleset_version).toBe(r.json.plan.rulesetVersion);
    const drugi = await utworz(plan({ entryPrice: 20601, stopLoss: 20591, takeProfit: 20641, tradeId }));
    expect(drugi.status).toBe(409);
    expect(drugi.json.code).toBe("plan_exists");
  });

  it("przypiecie planu do trade'a: raz, tylko gdy konto, kierunek i dzien pasuja", async () => {
    const r = await utworz(plan({ entryPrice: 20700, stopLoss: 20690, takeProfit: 20740 }));
    const id = r.json.plan.id as number;
    const przypnij = (tradeId: number) =>
      wywolaj(import("@/app/api/v2/trade-plans/[id]/attach/route"), "POST", `/trade-plans/${id}/attach`, { token: rw.token, cialo: { tradeId } }, PARAMS({ id: String(id) }));

    const innyDzien = await wstawTrade(sql, { kontoId, instrumentId, dzien: "1989-05-11", status: "open", wejscie: 20700, sl: 20690 });
    const innaStrona = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open", kierunek: "short", wejscie: 20700, sl: 20710 });
    const inneKonto = await wstawTrade(sql, { kontoId: inneKontoId, instrumentId, dzien: DZIEN, status: "open", wejscie: 20700, sl: 20690 });
    const pasuje = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open", wejscie: 20700, sl: 20690 });
    tradeIds.push(innyDzien, innaStrona, inneKonto, pasuje);

    for (const zly of [innyDzien, innaStrona, inneKonto]) {
      const odm = await przypnij(zly);
      expect(odm.status, `trade #${zly}`).toBe(422);
      expect(odm.json.code).toBe("plan_trade_mismatch");
    }
    const ok = await przypnij(pasuje);
    expect(ok.status).toBe(200);
    zgodneZKontraktem("post", "/trade-plans/{id}/attach", ok.json);
    expect(ok.json.tradeId).toBe(pasuje);
    const [w] = await sql`select trade_id from trade_plans where id = ${id}`;
    expect(w.trade_id).toBe(pasuje);

    // ponowne przypiecie do tego samego = to samo; do innego = 409
    expect((await przypnij(pasuje)).status).toBe(200);
    const inny = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open", wejscie: 20700, sl: 20690 });
    tradeIds.push(inny);
    const drugi = await przypnij(inny);
    expect(drugi.status).toBe(409);
    expect(drugi.json.code).toBe("plan_attached");
  });

  it("lista planow filtruje po trade'u i koncie; odpowiedz zgodna z kontraktem", async () => {
    const r = await wywolaj(import("@/app/api/v2/trade-plans/route"), "GET", `/trade-plans?accountId=${kontoId}&day=${DZIEN}`, { token: ro.token });
    expect(r.status).toBe(200);
    // wywolaj nie przekazuje query przez zadanie(): adres w zadaniu jest pelny, wiec filtry dzialaja
    zgodneZKontraktem("get", "/trade-plans", r.json);
    expect(r.json.plans.length).toBeGreaterThan(0);
    for (const p of r.json.plans) {
      expect(p.accountId).toBe(kontoId);
      expect(p.day).toBe(DZIEN);
    }
  });

  it("setup bez zatwierdzonej wersji: plan z ostrzezeniem; po zatwierdzeniu przez UI plan wskazuje wersje", async () => {
    const nazwa = unikat("Setup planu");
    const s = await wywolaj(import("@/app/api/v2/setups/route"), "POST", "/setups", {
      token: rw.token,
      cialo: { name: nazwa, origin: "ai", counterargument: "Może to szum.", evidence: { trades: [1], n: 3 }, entryChecklist: [{ id: "a", text: "Sweep PDL" }] },
    });
    expect(s.status).toBe(201);
    const slug = s.json.slug as string;
    const bez = await utworz(plan({ entryPrice: 20800, stopLoss: 20790, takeProfit: 20840, setupSlug: slug }));
    expect(bez.status).toBe(201);
    expect(bez.json.warnings.join(" ")).toContain("nie ma jeszcze zatwierdzonej wersji");
    expect(bez.json.plan.setupVersionId).toBeNull();
    expect(bez.json.plan.setup.slug).toBe(slug);

    const { przyjmijWersjeSetupu } = await import("@/lib/decyzje/wersje");
    const [wersja] = await sql`select sv.id from setup_versions sv join setups s on s.id = sv.setup_id where s.slug = ${slug} and sv.status = 'proposed'`;
    const decyzja = await przyjmijWersjeSetupu(wersja.id);
    expect(decyzja.ok).toBe(true);
    const z = await utworz(plan({ entryPrice: 20810, stopLoss: 20800, takeProfit: 20850, setupSlug: slug }));
    expect(z.status).toBe(201);
    expect(z.json.plan.setupVersionId).toBe(wersja.id);
    expect(z.json.plan.setup.version).toBe(1);
    expect(z.json.warnings).toEqual([]);
    await sql`delete from trade_plans where setup_id = (select id from setups where slug = ${slug})`;
  });
});
