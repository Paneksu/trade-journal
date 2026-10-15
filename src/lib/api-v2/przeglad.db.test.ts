import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, zapiszSlowa, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Przeglad tygodnia procesowy (MUST 9): 3 najlepsze i 3 najgorsze wg PROCESU, rozklad A/B/C, siatka 2x2, koszt gry C
 * i lamania regul, JEDNO zobowiazanie z rozliczeniem poprzedniego. Szkic AI zapisuje API, zatwierdza tylko UI.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("przeglad tygodnia procesowy (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let instrumentId = 0;
  let kontoId = 0;
  const znacznik = unikat("tydz");
  /** Poniedzialki z 1986: nie wchodza w droge innym danym lokalnej bazy. */
  const T1 = "1986-03-03";
  const T2 = "1986-03-10";
  const tradeIds: Record<string, number> = {};

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write"]);
    ro = await nowyToken(sql, ["read"]);
    const [k] = await sql`insert into accounts (name, type) values (${`TYDZ-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
    await sql`delete from weekly_reviews where week_start in (${T1}, ${T2})`;
  });
  afterAll(async () => {
    await sql.begin(async (t) => {
      await t`select set_config('tj.actor', 'ui', true)`; // zobowiazanie i rozliczenie zmienia tylko UI (trigger tj_weekly_once)
      await t`update weekly_reviews set prev_review_id = null, prev_commitment_result = null, prev_result_words_id = null where week_start in (${T1}, ${T2})`;
    });
    await sql`delete from weekly_reviews where week_start in (${T1}, ${T2})`;
    await sql`delete from day_notes where day between ${T1} and '1986-03-09'`;
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

  const odczyt = (week: string) => wywolaj(import("@/app/api/v2/reviews/weekly/route"), "GET", `/reviews/weekly?weekStart=${week}`, { token: ro.token });
  const zapisz = (week: string, cialo: Record<string, unknown>, token = rw.token) =>
    wywolaj(import("@/app/api/v2/reviews/weekly/[weekStart]/route"), "PUT", `/reviews/weekly/${week}`, { token, cialo }, PARAMS({ weekStart: week }));

  /** Plan zamrozony PRZED wejsciem (frozen_at ustawione SQL-em, bo wejscia sa historyczne). */
  async function plan(tradeId: number, dzien: string, sl: number, zamrozony = `${dzien}T14:00:00Z`) {
    await sql`insert into trade_plans (trade_id, account_id, instrument_id, day, ruleset_version, direction, entry_price, stop_loss, take_profit, contracts, risk_cents, origin, frozen_at)
              values (${tradeId}, ${kontoId}, ${instrumentId}, ${dzien}, 0, 'long', 20000, ${sl}, 20040, 2, 40000, 'ai', ${zamrozony})`;
  }

  it("metryki tygodnia: siatka 2x2, rozklad A/B/C, koszt gry C, najlepsze/najgorsze wg procesu (nie wyniku), naruszenia twardych regul", async () => {
    // pon: A zysk (plan ok), B strata (plan, ale SL ruszony)
    // wt: C zysk bez planu ("szczescie"), C strata bez planu ponad limit 1 trade'a dnia
    // sr: A strata (plan ok)
    const t1 = await wstawTrade(sql, { kontoId, instrumentId, dzien: "1986-03-03", r: 2, godzinaUtc: 14 });
    const t2 = await wstawTrade(sql, { kontoId, instrumentId, dzien: "1986-03-03", r: -1, godzinaUtc: 15 });
    const t3 = await wstawTrade(sql, { kontoId, instrumentId, dzien: "1986-03-04", r: 3, godzinaUtc: 14 });
    const t4 = await wstawTrade(sql, { kontoId, instrumentId, dzien: "1986-03-04", r: -1, godzinaUtc: 15 });
    const t5 = await wstawTrade(sql, { kontoId, instrumentId, dzien: "1986-03-05", r: -1, godzinaUtc: 14 });
    Object.assign(tradeIds, { t1, t2, t3, t4, t5 });
    const oceny: [number, string][] = [[t1, "A"], [t2, "B"], [t3, "C"], [t4, "C"], [t5, "A"]];
    for (const [id, g] of oceny) await sql`update trades set process_grade = ${g}, process_graded_at = now() where id = ${id}`;
    await plan(t1, "1986-03-03", 19980);
    await plan(t2, "1986-03-03", 19970); // plan z SL 19970, a trade ma SL 19980 (domyslnie wejscie-20) => ruszony SL
    await plan(t5, "1986-03-05", 19980);
    await sql`insert into day_notes (day, max_trades, post_session) values ('1986-03-04', 1, 'Dzień spisany.') on conflict do nothing`;

    const r = await odczyt(T1);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    zgodneZKontraktem("get", "/reviews/weekly", r.json);
    const m = r.json.metrics;
    expect(m.trades).toBe(5);
    expect(m.grid.graded).toBe(5);
    expect(m.grid.goodProcessWin.tradeIds).toEqual([t1]);
    expect(m.grid.goodProcessLoss.tradeIds.sort()).toEqual([t2, t5].sort());
    expect(m.grid.badProcessWin.tradeIds).toEqual([t3]); // »szczescie«: zly proces, dobry wynik
    expect(m.grid.badProcessLoss.tradeIds).toEqual([t4]);
    expect(m.grid.distribution.A.count).toBe(2);
    expect(m.grid.distribution.B.count).toBe(1);
    expect(m.grid.distribution.C.count).toBe(2);
    expect(m.grid.distribution.C.share).toBeCloseTo(0.4, 12);
    expect(m.grid.costOfC).toEqual({ count: 2, sumR: 2, sumPnlCents: 80000 });
    // wg PROCESU: najlepsze to A (t1, t5) i B (t2); najgorsze C (t3 z wielkim zyskiem nadal najgorszy procesowo, t4)
    expect(m.bestAndWorst.best).toEqual([t1, t5, t2]);
    expect(m.bestAndWorst.worst).toEqual([t3, t4]);

    const d = m.discipline;
    const kod = (k: string) => d.violations.find((v: { code: string }) => v.code === k);
    expect(kod("brak_planu").tradeIds.sort()).toEqual([t3, t4].sort());
    expect(kod("ruszony_sl").tradeIds).toEqual([t2]);
    expect(kod("limit_tradeow").tradeIds).toEqual([t4]);
    expect(d.shareA).toBeCloseTo(0.4, 12);
    expect(d.tradeIdsWithViolation.sort()).toEqual([t2, t3, t4].sort());
    // koszt lamania regul = suma wyniku trade'ow z naruszeniem: t2 (-1R) + t3 (+3R) + t4 (-1R)
    expect(d.violationCost).toEqual({ count: 3, sumR: 1, sumPnlCents: 40000 });
    expect(d.reviews).toEqual({ daysRequired: 3, daysCompleted: 1, weeksRequired: 1, weeksApproved: 0 });
    expect(d.perDay).toHaveLength(3);
  });

  it("plan zamrozony PO wejsciu nie liczy sie jako plan przed wejsciem (brak_planu)", async () => {
    const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: "1986-03-06", r: 1 });
    await sql`update trades set process_grade = 'A', process_graded_at = now() where id = ${id}`;
    await plan(id, "1986-03-06", 19980, "1986-03-06T20:00:00Z");
    const r = await odczyt(T1);
    const brak = r.json.metrics.discipline.violations.find((v: { code: string }) => v.code === "brak_planu");
    expect(brak.tradeIds).toContain(id);
  });

  it("szkic przegladu: draftMd z migawka liczb i as_of; PUT tworzy (201), kolejny aktualizuje (200); zobowiazanie raz", async () => {
    const slowaWnioski = await zapiszSlowa(rw.token, "Za często łamię limit trade'ów po stracie.", { day: T1, role: "weekly.conclusions" });
    const slowaZobow = await zapiszSlowa(rw.token, "W przyszłym tygodniu: po stracie 15 minut przerwy.", { day: T1, role: "weekly.commitment" });
    const inneZobow = await zapiszSlowa(rw.token, "Albo jednak max 2 trade'y dziennie.", { day: T1, role: "weekly.commitment" });

    const pierwszy = await zapisz(T1, { draftMd: "## Szkic AI\nTydzień: 5 trade'ów.", conclusionsWordsId: slowaWnioski.id });
    expect(pierwszy.status, JSON.stringify(pierwszy.json)).toBe(201);
    zgodneZKontraktem("put", "/reviews/weekly/{weekStart}", pierwszy.json);
    expect(pierwszy.json.review).toMatchObject({ status: "draft", draftSignature: "szkic AI", conclusions: { text: "Za często łamię limit trade'ów po stracie." } });
    expect(pierwszy.json.review.statsSnapshot.trades).toBe(6); // 5 z pierwszego testu + 1 z drugiego
    expect(pierwszy.json.review.asOf).not.toBeNull();

    const ustaw = await zapisz(T1, { commitmentWordsId: slowaZobow.id });
    expect(ustaw.status).toBe(200);
    expect(ustaw.json.review.commitment.text).toBe("W przyszłym tygodniu: po stracie 15 minut przerwy.");
    expect((await zapisz(T1, { commitmentWordsId: slowaZobow.id })).status).toBe(200); // to samo zobowiazanie = ok
    const drugie = await zapisz(T1, { commitmentWordsId: inneZobow.id });
    expect(drugie.status).toBe(409);
    expect(drugie.json.code).toBe("commitment_set");
    const [w] = await sql`select commitment_words_id, status from weekly_reviews where week_start = ${T1}`;
    expect(w).toEqual({ commitment_words_id: slowaZobow.id, status: "draft" });
  });

  it("slowa przypiete do trade'u nie moga stac pod przegladem (blokowalyby kasowanie trade'u): 422", async () => {
    const slowa = await zapiszSlowa(rw.token, "Zobowiązanie przypięte do trade'u.", { tradeId: tradeIds.t1 });
    const r = await zapisz(T2, { commitmentWordsId: slowa.id });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("words_anchored_to_trade");
    expect((await sql`select count(*)::int as n from weekly_reviews where week_start = ${T2}`)[0].n).toBe(0);
  });

  it("rozliczenie zobowiazania poprzedniego tygodnia: wymaga zobowiazania w poprzednim przegladzie; GET pokazuje, co rozliczyc", async () => {
    const bezPoprzedniego = await zapisz("1986-03-17", { prevCommitmentResult: "kept" });
    expect(bezPoprzedniego.status).toBe(422);
    expect(bezPoprzedniego.json.code).toBe("no_commitment_to_settle");

    const przed = await odczyt(T2);
    expect(przed.json.commitmentToSettle).toMatchObject({ weekStart: T1 });
    expect(przed.json.previousReview.commitment.text).toContain("15 minut przerwy");

    const wynikSlowa = await zapiszSlowa(rw.token, "Dotrzymałem 3 razy z 4.", { day: T2, role: "weekly.result" });
    const rozliczone = await zapisz(T2, { prevCommitmentResult: "partial", prevResultWordsId: wynikSlowa.id, draftMd: "Rozliczenie." });
    expect(rozliczone.status, JSON.stringify(rozliczone.json)).toBe(201);
    expect(rozliczone.json.review).toMatchObject({ prevCommitmentResult: "partial", prevResult: { text: "Dotrzymałem 3 razy z 4." } });
    const [w] = await sql`select r2.prev_review_id = r1.id as powiazany from weekly_reviews r2, weekly_reviews r1 where r2.week_start = ${T2} and r1.week_start = ${T1}`;
    expect(w.powiazany).toBe(true);
    const po = await odczyt(T2);
    expect(po.json.commitmentToSettle).toBeNull();
  });

  it("zobowiazanie i rozliczenie raz ustawione nie zmieniaja sie: null = 400, inna wartosc = 409, a SQL bez aktora ui dostaje TJ409 z bazy", async () => {
    const [stan] = await sql`select commitment_words_id, prev_commitment_result, prev_result_words_id from weekly_reviews where week_start = ${T2}`;
    expect(stan.prev_commitment_result).toBe("partial");
    const inne = await zapiszSlowa(rw.token, "Inny wynik rozliczenia.", { day: T2, role: "weekly.result" });
    const innyWynik = await zapisz(T2, { prevCommitmentResult: "kept" });
    expect(innyWynik.status).toBe(409);
    expect(innyWynik.json.code).toBe("commitment_set");
    expect(innyWynik.json.field).toBe("prevCommitmentResult");
    expect((await zapisz(T2, { prevResultWordsId: inne.id })).status).toBe(409);
    expect((await zapisz(T2, { prevCommitmentResult: "partial", prevResultWordsId: stan.prev_result_words_id })).status).toBe(200); // to samo = ok
    for (const pole of ["commitmentWordsId", "prevCommitmentResult", "prevResultWordsId"]) {
      const nul = await zapisz(T1, { [pole]: null });
      expect(nul.status, pole).toBe(400); // null nie kasuje
    }
    const [po] = await sql`select prev_commitment_result, prev_result_words_id from weekly_reviews where week_start = ${T2}`;
    expect(po).toEqual({ prev_commitment_result: "partial", prev_result_words_id: stan.prev_result_words_id });

    const { zapisZAktorem } = await import("./zapis");
    const { sql: dsql } = await import("drizzle-orm");
    let kod: string | undefined;
    try {
      await zapisZAktorem(`api:${rw.id}`, (tx) => tx.execute(dsql`update weekly_reviews set commitment_words_id = null where week_start = ${T1}`));
    } catch (e) {
      kod = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
    }
    expect(kod).toBe("TJ409");
  });

  it("niespojne dane z triggera (TJ422) dostaja kod inconsistent_data, nie below_threshold (prawdziwy blad bazy)", async () => {
    const { opiszBladBazy } = await import("./bledy-bazy");
    const [t1] = await sql`select id from weekly_reviews where week_start = ${T2}`;
    let e: unknown;
    try {
      // przeglad z 24.02 rozlicza przeglad z 10.03, czyli z PRZYSZLOSCI
      await sql`insert into weekly_reviews (week_start, prev_review_id) values ('1986-02-24', ${t1.id})`;
    } catch (err) {
      e = err;
    }
    expect(e, "trigger powinien odrzucic zly prev_review_id").toBeDefined();
    expect((e as { code?: string }).code).toBe("TJ422");
    expect(opiszBladBazy(e)).toMatchObject({ status: 422, kod: "inconsistent_data" });
  });

  it("zatwierdzony przeglad zatwierdza tylko UI; potem API go nie zmienia (409); poniedzialek wymagany", async () => {
    // API nie ma zakresu approve: proba ustawienia statusu z aktorem api:* konczy sie TJ403
    const { zapisZAktorem, zapisJakoUi } = await import("./zapis");
    const { sql: dsql } = await import("drizzle-orm");
    const sprobuj = async (aktor: string) => {
      try {
        await zapisZAktorem(aktor, (tx) => tx.execute(dsql`update weekly_reviews set status = 'approved', approved_at = now() where week_start = ${T2}`));
        return null;
      } catch (e) {
        return (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code ?? null;
      }
    };
    expect(await sprobuj(`api:${rw.id}`)).toBe("TJ403");
    await zapisJakoUi((tx) => tx.execute(dsql`update weekly_reviews set status = 'approved', approved_at = now() where week_start = ${T2}`));
    expect((await sql`select status from weekly_reviews where week_start = ${T2}`)[0].status).toBe("approved");
    const zablokowany = await zapisz(T2, { draftMd: "Poprawka po zatwierdzeniu." });
    expect(zablokowany.status).toBe(409);
    expect(zablokowany.json.code).toBe("review_approved");
    expect((await sql`select draft_md from weekly_reviews where week_start = ${T2}`)[0].draft_md).toBe("Rozliczenie.");

    const wtorek = await zapisz("1986-03-18", { draftMd: "x" });
    expect(wtorek.status).toBe(422);
    expect(wtorek.json.code).toBe("not_monday");
    expect(wtorek.json.error).toContain("1986-03-17");
    const zlaData = await wywolaj(import("@/app/api/v2/reviews/weekly/route"), "GET", "/reviews/weekly?weekStart=1986-03-18", { token: ro.token });
    expect(zlaData.status).toBe(400);
    expect((await zapisz(T1, { draftMd: "x" }, ro.token)).status).toBe(403);
  });
});
