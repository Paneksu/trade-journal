import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Modul prop (MUST 7): presety jako dane, reguly konta z data obowiazywania, bufory, ostrzezenia 50/75/90%,
 * bufor »gdy trafi SL«, ksiega i laczna ekspozycja NQ. Liczby sprawdzane na danych z bazy, nie na atrapie.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("moduł prop: presety, reguly konta, bufory i ksiega (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let instrumentId = 0;
  let mnqId = 0;
  const znacznik = unikat("prop");
  const konta: number[] = [];
  let dzis = "";

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    const [m] = await sql`select id from instruments where symbol = 'MNQ' limit 1`;
    if (m) mnqId = m.id;
    else {
      const [n] = await sql`insert into instruments (symbol, name, exchange, tick_size, tick_value, sort_order) values ('MNQ', 'Micro NQ', 'CME', 0.25, 500, 2) returning id`;
      mnqId = n.id;
    }
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    const { dzienHandlowyTeraz } = await import("./prop-konta");
    dzis = dzienHandlowyTeraz();
  });
  afterAll(async () => {
    await sql`delete from trades where account_id = any(${konta})`;
    await sql`delete from trade_plans where account_id = any(${konta})`;
    await sql`delete from prop_ledger where account_id = any(${konta})`;
    await sprzatnijNowe(sql, [rw.id, ro.id]);
    await sql`delete from accounts where id = any(${konta})`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  async function kontoProp(start = 5_000_000, typ: "prop" | "live" = "prop"): Promise<number> {
    const [k] = await sql`insert into accounts (name, type, prop_phase, starting_balance) values (${unikat(`PROP-${znacznik}`)}, ${typ}, ${typ === "prop" ? "eval" : null}, ${start}) returning id`;
    konta.push(k.id);
    return k.id as number;
  }
  const reguly = (id: number, cialo: Record<string, unknown>) =>
    wywolaj(import("@/app/api/v2/prop/accounts/[id]/rules/route"), "POST", `/prop/accounts/${id}/rules`, { token: rw.token, cialo }, PARAMS({ id: String(id) }));
  const status = (id: number, query = "") =>
    wywolaj(import("@/app/api/v2/prop/accounts/[id]/status/route"), "GET", `/prop/accounts/${id}/status${query}`, { token: ro.token }, PARAMS({ id: String(id) }));
  const strata = (kontoId: number, centy: number, dzien = dzis) => wstawTrade(sql, { kontoId, instrumentId, dzien, status: "closed", r: -centy / 40000 });

  it("presety to dane: 138 wierszy z seeda, needsVerification widoczne, wiek i zrodlo przy kazdym; filtr po firmie", async () => {
    const wszystkie = await wywolaj(import("@/app/api/v2/prop/presets/route"), "GET", "/prop/presets", { token: ro.token });
    expect(wszystkie.status).toBe(200);
    zgodneZKontraktem("get", "/prop/presets", wszystkie.json);
    expect(wszystkie.json.count).toBeGreaterThanOrEqual(138);
    expect(wszystkie.json.presets.some((p: { needsVerification: boolean }) => p.needsVerification)).toBe(true);
    expect(wszystkie.json.presets.some((p: { needsVerification: boolean }) => !p.needsVerification)).toBe(true);
    for (const p of wszystkie.json.presets) {
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(p.ageDays).toBeGreaterThanOrEqual(0);
    }
    const topstep = await wywolaj(import("@/app/api/v2/prop/presets/route"), "GET", "/prop/presets?firm=topstep", { token: ro.token });
    expect(topstep.json.count).toBe(9);
    expect(topstep.json.presets.every((p: { firm: string }) => p.firm === "Topstep")).toBe(true);
    const zlyFiltr = await wywolaj(import("@/app/api/v2/prop/presets/route"), "GET", "/prop/presets?phase=live", { token: ro.token });
    expect(zlyFiltr.status).toBe(400);
  });

  it("przypiecie presetu do konta od daty zakupu kopiuje wartosci, pozwala nadpisac kazda, nie ustawia confirmedAt; ta sama data = 409", async () => {
    const id = await kontoProp();
    const [p] = await sql`select id, max_dd_cents::float8 as dd, dd_lock_cents::float8 as lock from prop_firm_presets where firm = 'Topstep' and program = 'Trading Combine' and account_size_cents = 5000000`;
    const r = await reguly(id, { presetId: p.id, validFrom: "2026-08-01", dailyLossCents: 100000, consistencyPct: 50 });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    zgodneZKontraktem("post", "/prop/accounts/{id}/rules", r.json);
    expect(r.json).toMatchObject({ maxDdCents: p.dd, ddLockCents: p.lock, dailyLossCents: 100000, consistencyPct: 50, confirmedAt: null, presetId: p.id });
    expect(r.json.preset).toMatchObject({ firm: "Topstep", needsVerification: false });
    expect(r.json.extra.trail_basis).toBe("eod");
    const [w] = await sql`select max_dd_cents::float8 as dd, confirmed_at from prop_rules where account_id = ${id}`;
    expect(w).toEqual({ dd: p.dd, confirmed_at: null });

    const dubel = await reguly(id, { presetId: p.id, validFrom: "2026-08-01" });
    expect(dubel.status).toBe(409);
    expect(dubel.json.code).toBe("rules_exist");
    const lista = await wywolaj(import("@/app/api/v2/prop/accounts/[id]/rules/route"), "GET", `/prop/accounts/${id}/rules`, { token: ro.token }, PARAMS({ id: String(id) }));
    zgodneZKontraktem("get", "/prop/accounts/{id}/rules", lista.json);
    expect(lista.json.rules).toHaveLength(1);
  });

  it("konto inne niz prop = 422; nieznane konto = 404; nieznany preset = 422; trailing_to_static bez zysku blokady = 422; bez presetu wymagane ddType i maxDdCents", async () => {
    const live = await kontoProp(0, "live");
    expect((await reguly(live, { validFrom: "2026-08-01", ddType: "static", maxDdCents: 100000 })).json.code).toBe("not_prop_account");
    expect((await reguly(999999999, { validFrom: "2026-08-01", ddType: "static", maxDdCents: 100000 })).status).toBe(404);
    const id = await kontoProp();
    expect((await reguly(id, { validFrom: "2026-08-01", presetId: 999999999 })).status).toBe(422);
    const bezBlokady = await reguly(id, { validFrom: "2026-08-01", ddType: "trailing_to_static", maxDdCents: 200000 });
    expect(bezBlokady.status).toBe(422);
    expect(bezBlokady.json.code).toBe("dd_lock_required");
    const bez = await reguly(id, { validFrom: "2026-08-01" });
    expect(bez.status).toBe(400);
    expect(bez.json.error).toContain("ddType");
    expect((await sql`select count(*)::int as n from prop_rules where account_id = ${id}`)[0].n).toBe(0);
  });

  it("ostrzezenie przy 75% limitu dziennego (granica: 74,5% -> 50%, 75% -> 75%), tekst z liczbami; bufory w centach", async () => {
    const id = await kontoProp();
    expect((await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 500_000, dailyLossCents: 200_000 })).status).toBe(201);
    await strata(id, 149_000);
    const przed = await status(id);
    expect(przed.status, JSON.stringify(przed.json)).toBe(200);
    zgodneZKontraktem("get", "/prop/accounts/{id}/status", przed.json);
    expect(przed.json.state.dailyLossBufferCents).toBe(51_000);
    expect(przed.json.state.warnings.filter((w: { code: string }) => w.code === "dll").map((w: { level: number }) => w.level)).toEqual([50]);

    await strata(id, 1_000); // razem 150 000 = dokladnie 75% limitu 200 000
    const po = await status(id);
    const ostrzezenie = po.json.state.warnings.find((w: { code: string }) => w.code === "dll");
    expect(ostrzezenie.level).toBe(75);
    expect(ostrzezenie.text).toContain("75%");
    expect(ostrzezenie.text).toContain("500,00 USD");
    expect(po.json.state.dailyLossBufferCents).toBe(50_000);
    expect(po.json.state.drawdownBufferCents).toBe(350_000);
    expect(po.json.state.balanceCents).toBe(5_000_000 - 150_000);
    expect(po.json.state.nearestLimit).toBe("dll");
  });

  it("bufor »gdy trafi SL« w centach i w R: z riskCents albo z planu; riskCents i planId naraz = 400", async () => {
    const id = await kontoProp();
    await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 500_000, dailyLossCents: 100_000 });
    await strata(id, 70_000);
    const zQuery = await status(id, "?riskCents=40000");
    expect(zQuery.json.riskSource).toBe("query");
    expect(zQuery.json.state.ifStopHit).toMatchObject({ riskCents: 40_000, dailyLossBufferAfterCents: -10_000, exceedsLimit: true });
    expect(zQuery.json.state.ifStopHit.dailyLossBufferInR).toBeCloseTo(30_000 / 40_000, 12);
    expect(zQuery.json.state.warnings.some((w: { code: string; level: number }) => w.code === "po_sl_dll" && w.level === 100)).toBe(true);

    const plan = await wywolaj(import("@/app/api/v2/trade-plans/route"), "POST", "/trade-plans", {
      token: rw.token,
      cialo: { accountId: id, symbol: "NQ", day: dzis, direction: "long", entryPrice: 20000, stopLoss: 19990, contracts: 1 },
    });
    expect(plan.status, JSON.stringify(plan.json)).toBe(201);
    const zPlanu = await status(id, `?planId=${plan.json.plan.id}`);
    expect(zPlanu.json.riskSource).toBe("plan");
    expect(zPlanu.json.state.ifStopHit.riskCents).toBe(20_000);
    expect(zPlanu.json.state.ifStopHit.exceedsLimit).toBe(false);

    const oba = await status(id, `?planId=${plan.json.plan.id}&riskCents=1000`);
    expect(oba.status).toBe(400);
    const cudzy = await kontoProp();
    await reguly(cudzy, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 500_000 });
    const innyPlan = await status(cudzy, `?planId=${plan.json.plan.id}`);
    expect(innyPlan.status).toBe(422);
    expect(innyPlan.json.code).toBe("plan_account_mismatch");
  });

  it("konto bez regul obowiazujacych w danym dniu = 422 no_rules; reguly wybiera data: starsza dla wczesniejszego dnia", async () => {
    const id = await kontoProp();
    const brak = await status(id);
    expect(brak.status).toBe(422);
    expect(brak.json.code).toBe("no_rules");
    await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 300_000 });
    await reguly(id, { validFrom: "2026-09-01", ddType: "static", maxDdCents: 150_000 });
    const wczesniej = await status(id, "?day=2026-05-01");
    expect(wczesniej.json.rules.maxDdCents).toBe(300_000);
    const pozniej = await status(id, "?day=2026-10-01");
    expect(pozniej.json.rules.maxDdCents).toBe(150_000);
    const przedZakupem = await status(id, "?day=2025-12-31");
    expect(przedZakupem.status).toBe(422);
  });

  it("drawdown EOD: dzisiejszy zysk nie podnosi progu, wczorajszy tak; blokada trailing_to_static zatrzymuje prog na saldzie startowym", async () => {
    const eod = await kontoProp();
    await reguly(eod, { validFrom: "2026-01-01", ddType: "eod", maxDdCents: 200_000 });
    await wstawTrade(sql, { kontoId: eod, instrumentId, dzien: "2026-09-01", status: "closed", r: 2 }); // +80 000 wczoraj
    const dzienPo = await status(eod, "?day=2026-09-02");
    expect(dzienPo.json.state.drawdownFloorCents).toBe(5_000_000 + 80_000 - 200_000);
    const wDniuZysku = await status(eod, "?day=2026-09-01");
    expect(wDniuZysku.json.state.drawdownFloorCents).toBe(5_000_000 - 200_000);

    const tts = await kontoProp();
    await reguly(tts, { validFrom: "2026-01-01", ddType: "trailing_to_static", maxDdCents: 200_000, ddLockCents: 200_000, extra: { trail_basis: "eod" } });
    await wstawTrade(sql, { kontoId: tts, instrumentId, dzien: "2026-09-01", status: "closed", r: 7 }); // +280 000
    const zablokowane = await status(tts, "?day=2026-09-02");
    expect(zablokowane.json.state).toMatchObject({ drawdownFloorCents: 5_000_000, lockReached: true, drawdownBufferCents: 280_000 });
  });

  it("consistency w trzech znaczeniach z presetow: laczny zysk, cel i zysk od ostatniej wyplaty", async () => {
    const id = await kontoProp();
    await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 800_000, consistencyPct: 40, profitTargetCents: 600_000, extra: { consistency_basis: "żaden dzień >= 40% CELU zysku", consistency_effect: "fail (tylko eval)" } });
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-09-01", status: "closed", r: 7 }); // +280 000 = 46,7% celu 600 000
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-09-02", status: "closed", r: 1 }); // +40 000
    const s = await status(id, "?day=2026-09-03");
    zgodneZKontraktem("get", "/prop/accounts/{id}/status", s.json);
    expect(s.json.state.consistency).toMatchObject({ basis: "goal", effect: "fail", violated: true, bestDayCents: 280_000, denominatorCents: 600_000 });
    expect(s.json.state.warnings.some((w: { code: string; level: number }) => w.code === "consistency" && w.level === 100)).toBe(true);
  });

  it("ksiega: koszty ujemne, wyplaty dodatnie, zwrot netto; znak niezgodny z rodzajem = 422; identyczny wpis w minute = ten sam (200)", async () => {
    const id = await kontoProp();
    const wpisz = (cialo: Record<string, unknown>) =>
      wywolaj(import("@/app/api/v2/prop/accounts/[id]/ledger/route"), "POST", `/prop/accounts/${id}/ledger`, { token: rw.token, cialo }, PARAMS({ id: String(id) }));
    const eval1 = await wpisz({ kind: "eval_fee", amountCents: -16_500, occurredOn: "2026-08-01", note: "Combine 50K" });
    expect(eval1.status, JSON.stringify(eval1.json)).toBe(201);
    zgodneZKontraktem("post", "/prop/accounts/{id}/ledger", eval1.json);
    const dubel = await wpisz({ kind: "eval_fee", amountCents: -16_500, occurredOn: "2026-08-01", note: "Combine 50K" });
    expect(dubel.status).toBe(200);
    expect(dubel.json.created).toBe(false);
    expect(dubel.json.entry.id).toBe(eval1.json.entry.id);
    await wpisz({ kind: "reset_fee", amountCents: -9_900, occurredOn: "2026-08-10" });
    await wpisz({ kind: "payout", amountCents: 120_000, occurredOn: "2026-09-15" });
    const zly = await wpisz({ kind: "payout", amountCents: -100, occurredOn: "2026-09-15" });
    expect(zly.status).toBe(422);
    expect(zly.json.code).toBe("invalid_sign");
    expect((await wpisz({ kind: "eval_fee", amountCents: 0, occurredOn: "2026-08-01" })).status).toBe(400);
    const ksiega = await wywolaj(import("@/app/api/v2/prop/accounts/[id]/ledger/route"), "GET", `/prop/accounts/${id}/ledger`, { token: ro.token }, PARAMS({ id: String(id) }));
    zgodneZKontraktem("get", "/prop/accounts/{id}/ledger", ksiega.json);
    expect(ksiega.json.entries).toHaveLength(3);
    expect(ksiega.json.summary).toMatchObject({ costsCents: -26_400, inflowsCents: 120_000, netCents: 93_600 });
    expect(ksiega.json.summary.byKind).toEqual({ eval_fee: -16_500, reset_fee: -9_900, payout: 120_000 });
    // wyplata z PRZYSZLOSCI wzgledem dnia statusu nie moze przesunac poczatku cyklu (review 15.10.2026, pkt 8)
    expect((await wpisz({ kind: "payout", amountCents: 50_000, occurredOn: "2026-12-31" })).status).toBe(201);
    // data wyplaty wyznacza poczatek cyklu consistency (nie liczymy dni sprzed wyplaty)
    await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 800_000, consistencyPct: 40, extra: { consistency_basis: "największy dzień/zysk w cyklu wypłaty", consistency_effect: "block_payout" } });
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-09-10", status: "closed", r: 10 });
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-09-20", status: "closed", r: 1 });
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-09-21", status: "closed", r: 1 });
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-09-22", status: "closed", r: 1 });
    const cykl = await status(id, "?day=2026-09-23");
    expect(cykl.json.state.consistency.basis).toBe("cycle");
    // dzien 09-10 (+400 000) lezy PRZED wyplata z 09-15, wiec nie wchodzi do cyklu: 3 x 40 000
    expect(cykl.json.state.consistency.denominatorCents).toBe(120_000);
    expect(cykl.json.state.consistency.share).toBeCloseTo(1 / 3, 12);
    expect(cykl.json.state.consistency.violated).toBe(false);
  });

  it("przeglad kont i laczna ekspozycja NQ: otwarte pozycje i dzisiejsze plany bez trade'u, micro jako 0,1 mini, symbole spoza NQ pominiete", async () => {
    const a = await kontoProp();
    const b = await kontoProp();
    for (const id of [a, b]) await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 500_000, maxContractsMini: 3 });
    await wstawTrade(sql, { kontoId: a, instrumentId, dzien: dzis, status: "open", kontrakty: 2 });
    await wstawTrade(sql, { kontoId: b, instrumentId: mnqId, dzien: dzis, status: "open", kontrakty: 10 });
    const p = await wywolaj(import("@/app/api/v2/trade-plans/route"), "POST", "/trade-plans", {
      token: rw.token,
      cialo: { accountId: b, symbol: "NQ", day: dzis, direction: "short", entryPrice: 20000, stopLoss: 20010, contracts: 2 },
    });
    expect(p.status, JSON.stringify(p.json)).toBe(201);

    const przeglad = await wywolaj(import("@/app/api/v2/prop/overview/route"), "GET", `/prop/overview?day=${dzis}`, { token: ro.token });
    expect(przeglad.status, JSON.stringify(przeglad.json)).toBe(200);
    zgodneZKontraktem("get", "/prop/overview", przeglad.json);
    const wKontach = (id: number) => przeglad.json.exposureNq.perAccount.find((x: { accountId: number }) => x.accountId === id);
    expect(wKontach(a)).toMatchObject({ nqEquivalent: 2, nqContracts: 2, mnqContracts: 0 });
    expect(wKontach(b)).toMatchObject({ nqContracts: 2, mnqContracts: 10 });
    expect(wKontach(b).nqEquivalent).toBeCloseTo(3, 9);
    expect(przeglad.json.exposureNq.total).toBeGreaterThanOrEqual(5);
    const status3 = przeglad.json.accounts.find((x: { accountId: number }) => x.accountId === b);
    expect(status3.contractWarnings).toEqual([]);
    // limit 3 mini przekroczony na koncie b? 2 NQ + 10 MNQ: mini = 2 <= 3, nie ma ostrzezenia; na koncie a: 2 <= 3
    await wstawTrade(sql, { kontoId: a, instrumentId, dzien: dzis, status: "open", kontrakty: 2 });
    const po = await wywolaj(import("@/app/api/v2/prop/overview/route"), "GET", `/prop/overview?day=${dzis}`, { token: ro.token });
    const sa = po.json.accounts.find((x: { accountId: number }) => x.accountId === a);
    expect(sa.contractWarnings[0].text).toContain("4 przy limicie 3");
  });

  it("niepotwierdzone reguly: bufory na OSTRZEJSZEJ z dwoch (potwierdzonej i nowej), rulesConfirmed=false ze znacznikiem; po potwierdzeniu w UI liczy sie nowa", async () => {
    const id = await kontoProp();
    const stara = await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 200_000, dailyLossCents: 80_000 });
    const nowa = await reguly(id, { validFrom: "2026-06-01", ddType: "static", maxDdCents: 400_000, dailyLossCents: 150_000 });
    expect(stara.status).toBe(201);
    expect(nowa.status).toBe(201);
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-07-01", status: "closed", r: -50_000 / 40000 });

    const { potwierdzReguleKonta } = await import("@/lib/decyzje/prop");
    // brak potwierdzonych: liczy na nowej, ale mowi, ze niepotwierdzona
    const bez = await status(id, "?day=2026-07-01");
    zgodneZKontraktem("get", "/prop/accounts/{id}/status", bez.json);
    expect(bez.json.rulesConfirmed).toBe(false);
    expect(bez.json.rulesUsed.source).toBe("unconfirmed_only");
    // same niepotwierdzone: NAJOSTRZEJSZA ze wszystkich (stara 200 000 < nowa 400 000), nie tylko najnowsza («Zawsze bezpieczniej dla mnie»)
    expect(bez.json.rulesUsed.maxDdCents).toBe(200_000);
    expect(bez.json.rulesNote).toContain("najostrzejszej");
    expect(bez.json.state.drawdownBufferCents).toBe(150_000);

    expect((await potwierdzReguleKonta(stara.json.id)).ok).toBe(true);
    const ostrzejsza = await status(id, "?day=2026-07-01");
    zgodneZKontraktem("get", "/prop/accounts/{id}/status", ostrzejsza.json);
    expect(ostrzejsza.json.rulesConfirmed).toBe(false);
    expect(ostrzejsza.json.rulesNote).toContain("ostrzejszej");
    expect(ostrzejsza.json.rulesUsed).toMatchObject({ source: "stricter_of_confirmed_and_unconfirmed", confirmedRuleId: stara.json.id, maxDdCents: 200_000, dailyLossCents: 80_000 });
    expect(ostrzejsza.json.state.drawdownBufferCents).toBe(150_000); // 200 000 - 50 000, nie 350 000 z luzniejszej nowej
    expect(ostrzejsza.json.state.dailyLossBufferCents).toBe(30_000);
    expect(ostrzejsza.json.rules.maxDdCents).toBe(400_000); // regula zapisana jest taka, jaka przyszla; ostrzejsza to tylko podstawa liczenia

    expect((await potwierdzReguleKonta(nowa.json.id)).ok).toBe(true);
    expect((await potwierdzReguleKonta(nowa.json.id)).ok).toBe(false); // drugi raz
    const po = await status(id, "?day=2026-07-01");
    expect(po.json.rulesConfirmed).toBe(true);
    expect(po.json.rulesUsed.source).toBe("confirmed");
    expect(po.json.state.drawdownBufferCents).toBe(350_000);
    expect(po.json.rulesNote).toBeNull();
  });

  it("«Zawsze bezpieczniej dla mnie»: cel do zdobycia z WIEKSZEGO z dwoch, consistency z MNIEJSZEGO (niepotwierdzone reguly)", async () => {
    const id = await kontoProp();
    const stara = await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 300_000, profitTargetCents: 500_000, consistencyPct: 50 });
    const nowa = await reguly(id, { validFrom: "2026-06-01", ddType: "static", maxDdCents: 300_000, profitTargetCents: 300_000, consistencyPct: 40 });
    expect(stara.status).toBe(201);
    expect(nowa.status).toBe(201);
    const { potwierdzReguleKonta } = await import("@/lib/decyzje/prop");
    expect((await potwierdzReguleKonta(stara.json.id)).ok).toBe(true);
    const s = await status(id, "?day=2026-07-01");
    zgodneZKontraktem("get", "/prop/accounts/{id}/status", s.json);
    expect(s.json.rulesUsed.source).toBe("stricter_of_confirmed_and_unconfirmed");
    expect(s.json.rulesUsed.profitTargetCents).toBe(500_000);
    expect(s.json.rulesUsed.consistencyPct).toBe(40);
  });

  it("niepotwierdzona regula ze STARA data validFrom nie cofa historii konta (poczatek liczony z potwierdzonych i tej obowiazujacej)", async () => {
    const id = await kontoProp();
    const biezaca = await reguly(id, { validFrom: "2026-03-01", ddType: "static", maxDdCents: 300_000 });
    expect(biezaca.status).toBe(201);
    const { potwierdzReguleKonta } = await import("@/lib/decyzje/prop");
    expect((await potwierdzReguleKonta(biezaca.json.id)).ok).toBe(true);
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-02-02", status: "closed", r: -50_000 / 40000 });
    const przed = await status(id, "?day=2026-04-01");
    expect(przed.status).toBe(200);
    // agent dopisuje niepotwierdzona regule sprzed trade'a: historia nie moze sie rozszerzyc
    expect((await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 999_000 })).status).toBe(201);
    const po = await status(id, "?day=2026-04-01");
    expect(po.json.state.drawdownBufferCents).toBe(przed.json.state.drawdownBufferCents);
    expect(po.json.state.balanceCents ?? po.json.state.equityCents ?? 0).toBe(przed.json.state.balanceCents ?? przed.json.state.equityCents ?? 0);
  });

  it("kolejka »Do decyzji«: tylko regula obowiazujaca dzis i nowsze, zastapione niepotwierdzone nie wchodza", async () => {
    const id = await kontoProp();
    const stara = await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 200_000 });
    const biezaca = await reguly(id, { validFrom: "2026-06-01", ddType: "static", maxDdCents: 300_000 });
    const przyszla = await reguly(id, { validFrom: "2026-12-01", ddType: "static", maxDdCents: 250_000 });
    const { regulyKontDoPotwierdzenia } = await import("@/lib/queries/decyzje");
    const lista = (await regulyKontDoPotwierdzenia("2026-07-01")).filter((r) => r.accountId === id).map((r) => r.id);
    expect(lista).toEqual(expect.arrayContaining([biezaca.json.id, przyszla.json.id]));
    expect(lista).not.toContain(stara.json.id);
  });

  it("najostrzejsza wartosc pole po polu z ostatniej potwierdzonej, obowiazujacej i WSZYSTKICH niepotwierdzonych (obie galezie, «Zawsze bezpieczniej dla mnie»)", async () => {
    const id = await kontoProp();
    const r1 = await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 300_000, dailyLossCents: 100_000, profitTargetCents: 500_000 });
    const r2 = await reguly(id, { validFrom: "2026-02-01", ddType: "static", maxDdCents: 250_000, dailyLossCents: 200_000, profitTargetCents: 600_000 });
    const r3 = await reguly(id, { validFrom: "2026-03-01", ddType: "static", maxDdCents: 400_000, dailyLossCents: 150_000, profitTargetCents: 300_000 });
    for (const r of [r1, r2, r3]) expect(r.status).toBe(201);
    const { potwierdzReguleKonta } = await import("@/lib/decyzje/prop");

    // galaz »same niepotwierdzone«: R1, R2, R3 niepotwierdzone, obowiazuje R3
    const same = await status(id, "?day=2026-04-01");
    expect(same.json.rulesUsed).toMatchObject({ source: "unconfirmed_only", maxDdCents: 250_000, dailyLossCents: 100_000, profitTargetCents: 600_000 });

    // galaz »potwierdzona + niepotwierdzone«: R1 potwierdzona, R2 i R3 nie: ta sama najostrzejsza wartosc, nie tylko para R1 i R3
    expect((await potwierdzReguleKonta(r1.json.id)).ok).toBe(true);
    const mieszana = await status(id, "?day=2026-04-01");
    expect(mieszana.json.rulesUsed).toMatchObject({ source: "stricter_of_confirmed_and_unconfirmed", confirmedRuleId: r1.json.id, maxDdCents: 250_000, dailyLossCents: 100_000, profitTargetCents: 600_000 });
    expect(mieszana.json.rulesNote).toContain(`#${r2.json.id}`);
  });

  it("potwierdzic reguly moze tylko UI: SQL z aktorem api:* dostaje TJ403, a wstawienie juz potwierdzonej reguly tez", async () => {
    const id = await kontoProp();
    const r = await reguly(id, { validFrom: "2026-02-01", ddType: "static", maxDdCents: 300_000 });
    const { zapisZAktorem } = await import("./zapis");
    const { sql: dsql } = await import("drizzle-orm");
    const probuj = async (f: () => Promise<unknown>) => {
      try {
        await f();
        return null;
      } catch (e) {
        return (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code ?? null;
      }
    };
    expect(await probuj(() => zapisZAktorem(`api:${rw.id}`, (tx) => tx.execute(dsql`update prop_rules set confirmed_at = now() where id = ${r.json.id}`)))).toBe("TJ403");
    expect(await probuj(() => zapisZAktorem(`api:${rw.id}`, (tx) => tx.execute(dsql`insert into prop_rules (account_id, valid_from, dd_type, max_dd_cents, confirmed_at) values (${id}, '2026-03-01', 'static', 100000, now())`)))).toBe("TJ403");
    expect((await sql`select confirmed_at from prop_rules where id = ${r.json.id}`)[0].confirmed_at).toBeNull();
  });

  it("stan na dzien z przeszlosci nie widzi pozniejszych trade'ow (P3): trade z dnia po zapytaniu nie rusza salda ani buforow", async () => {
    const id = await kontoProp();
    expect((await reguly(id, { validFrom: "2026-01-01", ddType: "static", maxDdCents: 500_000 })).status).toBe(201);
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-03-02", status: "closed", r: -1 });
    await wstawTrade(sql, { kontoId: id, instrumentId, dzien: "2026-03-10", status: "closed", r: -2 });
    const wtedy = await status(id, "?day=2026-03-05");
    expect(wtedy.json.state.balanceCents).toBe(5_000_000 - 40_000);
    const pozniej = await status(id, "?day=2026-03-10");
    expect(pozniej.json.state.balanceCents).toBe(5_000_000 - 120_000);
  });
});
