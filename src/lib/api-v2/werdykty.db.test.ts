import { createHash } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { kanonicznyJson } from "@/lib/domain/kanoniczny";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, wywolajMultipart, zapiszSlowa, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Werdykt AI przed wynikiem (MUST 2): niezmienny z as_of, dowod w skrocie, korekta jako user_override,
 * wynik ukryty do zamkniecia trade'a. Dowodem sa odczyty z bazy i proby zmiany prosto w SQL (trigger).
 */
describe.skipIf(!MOZNA_NA_BAZIE)("werdykt niezmienny i ukrywanie wyniku (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let instrumentId = 0;
  let kontoId = 0;
  const znacznik = unikat("werdykt");
  const DZIEN = "1988-03-15";
  const WEJSCIE = `${DZIEN}T14:35:00.000Z`;

  const swiece = (ostatnia = "14:30") => [
    { t: `${DZIEN}T14:20:00Z`, o: 20000, h: 20010, l: 19995, c: 20005 },
    { t: `${DZIEN}T14:25:00Z`, o: 20005, h: 20015, l: 20000, c: 20012 },
    { t: `${DZIEN}T${ostatnia}:00Z`, o: 20012, h: 20020, l: 20008, c: 20018 },
  ];

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    const [k] = await sql`insert into accounts (name, type) values (${`WERD-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
  });
  afterAll(async () => {
    await sql`delete from trades where account_id = ${kontoId}`;
    await sprzatnijNowe(sql, [rw.id, ro.id]);
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id]);
    if (importowy) {
      // hipoteza dopiero po wersjach regul, ktore na nia wskazywaly
      await sql`delete from hypotheses where note_id in (select id from notes where created_by_token_id = ${importowy.id})`;
      await sprzatnijPoTokenach(sql, [importowy.id]);
    }
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const nowyOtwarty = async () => wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open", wejscie: 20000, sl: 19990 });
  const ocena = (tradeId: number, cialo: Record<string, unknown>, token = rw.token) =>
    wywolaj(import("@/app/api/v2/trades/[id]/reviews/route"), "POST", `/trades/${tradeId}/reviews`, { token, cialo }, PARAMS({ id: String(tradeId) }));
  const trade = (id: number) => wywolaj(import("@/app/api/v2/trades/[id]/route"), "GET", `/trades/${id}`, { token: ro.token }, PARAMS({ id: String(id) }));

  async function blad(zapytanie: PromiseLike<unknown>): Promise<{ code?: string }> {
    try {
      await zapytanie;
    } catch (e) {
      return e as { code?: string };
    }
    throw new Error("Oczekiwano bledu SQL, a zapytanie przeszlo");
  }

  let kolorZrzutu = Math.floor(Math.random() * 100); // kolejne zrzuty roznia sie kolorem (kolizja sha256 w obrebie trade'a dawala flaky)
  // Domyslnie zrzut jest z chwili PRZED wejsciem (14:30Z przy wejsciu 14:35Z): ocena »chart« nie moze miec zrzutow po wejsciu.
  async function wgrajZrzut(tradeId: number, origin: string, capturedAt = `${DZIEN}T14:30:00+00:00`, chartState?: Record<string, unknown>): Promise<{ id: number; sha256: string }> {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: (kolorZrzutu += 7) % 250, g: 10, b: 20 } } }).png().toBuffer();
    const form = new FormData();
    form.append("shot", new File([new Uint8Array(png)], "wykres.png", { type: "image/png" }));
    form.append("interval", "5m");
    form.append("origin", origin);
    form.append("capturedAt", capturedAt);
    if (chartState) form.append("chartState", JSON.stringify(chartState));
    const r = await wywolajMultipart(import("@/app/api/v2/trades/[id]/screenshots/route"), `/trades/${tradeId}/screenshots`, rw.token, form, PARAMS({ id: String(tradeId) }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    // Odpowiedz listuje wszystkie zrzuty tego pochodzenia (manual sie dopisuje): nowy jest ostatni.
    const nowy = r.json.screenshots[r.json.screenshots.length - 1];
    return { id: nowy.id, sha256: nowy.sha256 };
  }

  it("werdykt z dowodem: as_of stawia serwer, evidence_hash to SHA-256 kanonicznego JSON-a swiec i zrzutow, odpowiedz zgodna z kontraktem", async () => {
    const id = await nowyOtwarty();
    const zrzut = await wgrajZrzut(id, "tradingview");
    const r = await ocena(id, {
      basis: "chart",
      brainVerdict: "wejdz",
      summaryMd: "FVG po sweepie, bias long.",
      model: "claude-opus-5-5",
      evidence: { intervalMinutes: 5, candles: swiece(), screenshots: [{ sha256: zrzut.sha256 }] },
      ruleChecks: [{ ruleId: "E2E-R1", ruleText: "Wejście po sweepie", verdict: "pass", evidence: "świeca 14:25" }],
    });
    expect(r.status).toBe(201);
    zgodneZKontraktem("post", "/trades/{id}/reviews", r.json);
    expect(r.json.immutable).toBe(true);
    expect(r.json.unknownRules).toEqual(["E2E-R1"]);

    const manifest = {
      intervalMinutes: 5,
      candles: swiece().map((s) => ({ t: new Date(s.t).toISOString(), o: s.o, h: s.h, l: s.l, c: s.c })),
      screenshots: [{ sha256: zrzut.sha256 }],
    };
    const oczekiwany = createHash("sha256").update(kanonicznyJson(manifest), "utf8").digest("hex");
    const [w] = await sql`select as_of, evidence_hash, evidence_cutoff, ruleset_version, created_by_token_id,
                                 as_of > now() - interval '1 minute' as swiezy, evidence_manifest
                            from trade_reviews where id = ${r.json.reviewId}`;
    expect(w.evidence_hash).toBe(oczekiwany);
    expect(r.json.evidenceHash).toBe(oczekiwany);
    expect(w.swiezy).toBe(true);
    expect(w.created_by_token_id).toBe(rw.id);
    expect(new Date(w.evidence_cutoff).toISOString()).toBe(`${DZIEN}T14:30:00.000Z`);
    expect(w.evidence_manifest.candles).toHaveLength(3);
  });

  it("ta sama tresc wyslana ponownie = ten sam werdykt (200); inna tresc = 409; kazda zmiana w SQL = TJ409, poza zdaniem uzytkownika", async () => {
    const id = await nowyOtwarty();
    const cialo = {
      basis: "chart",
      brainVerdict: "wejdz",
      summaryMd: "Pierwsza ocena.",
      evidence: { intervalMinutes: 5, candles: swiece() },
      ruleChecks: [{ ruleId: "E2E-R2", ruleText: "Reguła testowa", verdict: "fail", evidence: "brak sweepu" }],
    };
    const pierwszy = await ocena(id, cialo);
    expect(pierwszy.status).toBe(201);
    const powtorka = await ocena(id, cialo);
    expect(powtorka.status).toBe(200);
    expect(powtorka.json.created).toBe(false);
    expect(powtorka.json.reviewId).toBe(pierwszy.json.reviewId);
    expect(powtorka.json.asOf).toBe(pierwszy.json.asOf);

    const inna = await ocena(id, { ...cialo, summaryMd: "Zmieniona po fakcie." });
    expect(inna.status).toBe(409);
    expect(inna.json.code).toBe("verdict_immutable");
    expect(inna.json.error).toContain("override");
    const innyWerdykt = await ocena(id, { ...cialo, brainVerdict: "odpusc" });
    expect(innyWerdykt.status).toBe(409);

    const rid = pierwszy.json.reviewId as number;
    expect((await blad(sql`update trade_reviews set summary_md = 'x' where id = ${rid}`)).code).toBe("TJ409");
    expect((await blad(sql`update trade_reviews set brain_verdict = 'odpusc' where id = ${rid}`)).code).toBe("TJ409");
    expect((await blad(sql`update trade_reviews set as_of = now() - interval '2 hours' where id = ${rid}`)).code).toBe("TJ409");
    expect((await blad(sql`update trade_reviews set evidence_hash = ${"0".repeat(64)} where id = ${rid}`)).code).toBe("TJ409");
    expect((await blad(sql`update trade_rule_checks set verdict = 'pass' where review_id = ${rid}`)).code).toBe("TJ409");
    expect((await blad(sql`insert into trade_rule_checks (review_id, rule_id, rule_text, verdict) values (${rid}, 'E2E-R9', 'dopisana pozniej', 'pass')`)).code).toBe("TJ409");
    // zdanie uzytkownika to jedyna zmiana, ktora wolno wykonac po as_of
    await sql`update trade_rule_checks set user_verdict = 'disagree' where review_id = ${rid}`;
    const [po] = await sql`select summary_md, brain_verdict from trade_reviews where id = ${rid}`;
    expect(po).toEqual({ summary_md: "Pierwsza ocena.", brain_verdict: "wejdz" });
  });

  it("PATCH i PUT werdyktu = 409 z odeslaniem do korekty", async () => {
    const id = await nowyOtwarty();
    const r = await ocena(id, { basis: "chart", brainVerdict: "czekaj", evidence: { intervalMinutes: 5, candles: swiece() } });
    for (const metoda of ["PATCH", "PUT"] as const) {
      const odm = await wywolaj(
        import("@/app/api/v2/trades/[id]/reviews/[reviewId]/route"),
        metoda,
        `/trades/${id}/reviews/${r.json.reviewId}`,
        { token: rw.token, cialo: { summaryMd: "x" } },
        PARAMS({ id: String(id), reviewId: String(r.json.reviewId) }),
      );
      expect(odm.status).toBe(409);
      expect(odm.json.code).toBe("immutable");
      expect(odm.json.error).toContain("/override");
    }
  });

  it("look-ahead granice: swieca musi SKONCZYC sie przed wejsciem (t + interwal <= wejscie); t == wejscie i 15-minutowa swieca obejmujaca wejscie = 422; brak intervalMinutes = 400", async () => {
    const c = (t: string) => [{ t: `${DZIEN}T${t}:00Z`, o: 20000, h: 20010, l: 19995, c: 20005 }];
    const id = await nowyOtwarty(); // wejscie 14:35
    const rowne = await ocena(id, { basis: "chart", evidence: { intervalMinutes: 5, candles: c("14:35") } });
    expect(rowne.status).toBe(422);
    expect(rowne.json.code).toBe("look_ahead");
    const obejmuje = await ocena(id, { basis: "chart", evidence: { intervalMinutes: 15, candles: c("14:30") } });
    expect(obejmuje.status).toBe(422);
    expect(obejmuje.json.error).toContain("kończy się");
    const bez = await ocena(id, { basis: "chart", evidence: { candles: c("14:30") } });
    expect(bez.status).toBe(400);
    expect(bez.json.error).toContain("intervalMinutes");
    const odciecie = await ocena(id, { basis: "chart", evidenceCutoff: `${DZIEN}T14:36:00Z`, evidence: { intervalMinutes: 5, candles: c("14:25") } });
    expect(odciecie.status).toBe(422);
    expect(odciecie.json.error).toContain("evidenceCutoff");
    expect((await sql`select count(*)::int as n from trade_reviews where trade_id = ${id}`)[0].n).toBe(0);
    const ok = await ocena(id, { basis: "chart", evidenceCutoff: `${DZIEN}T14:35:00Z`, evidence: { intervalMinutes: 5, candles: c("14:30") } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201); // swieca konczy sie dokladnie o wejsciu
    const hist = await ocena(await nowyOtwarty(), { basis: "history", evidence: { intervalMinutes: 15, candles: c("14:30") } });
    expect(hist.status).toBe(201); // po fakcie wolno
  });

  it("ocena »chart« nie moze widziec swiec pozniejszych niz wejscie (look-ahead); »history« moze; odciecie nie moze byc przed swieca", async () => {
    const id = await nowyOtwarty();
    const zaPozno = await ocena(id, { basis: "chart", evidence: { intervalMinutes: 5, candles: swiece("14:40") } });
    expect(zaPozno.status).toBe(422);
    expect(zaPozno.json.code).toBe("look_ahead");
    expect(zaPozno.json.error).toContain("14:40");
    const historia = await ocena(id, { basis: "history", evidence: { intervalMinutes: 5, candles: swiece("14:40") } });
    expect(historia.status).toBe(201);
    const odciecie = await ocena(await nowyOtwarty(), { basis: "history", evidenceCutoff: `${DZIEN}T14:00:00Z`, evidence: { intervalMinutes: 5, candles: swiece() } });
    expect(odciecie.status).toBe(422);
    expect(odciecie.json.error).toContain("evidenceCutoff");
    const [{ ile }] = await sql`select count(*)::int as ile from trade_reviews where trade_id = ${id}`;
    expect(ile).toBe(1);
  });

  it("zrzut z dowodu musi nalezec do trade'a (sha256 z odpowiedzi wgrywania), inaczej 422", async () => {
    const id = await nowyOtwarty();
    const cudzy = await nowyOtwarty();
    const zrzutCudzy = await wgrajZrzut(cudzy, "tradingview");
    const r = await ocena(id, { basis: "chart", evidence: { intervalMinutes: 5, candles: swiece(), screenshots: [{ sha256: zrzutCudzy.sha256 }] } });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("unknown_screenshot");
    expect(r.json.missing).toEqual([zrzutCudzy.sha256]);
    const zly = await ocena(id, { basis: "chart", evidence: { intervalMinutes: 5, candles: swiece(), screenshots: [{ sha256: "XYZ" }] } });
    expect(zly.status).toBe(400);
  });

  it("wersja reguly wskazana przez werdykt = wersja obowiazujaca w zestawie; numer zestawu zapisany; za nowy zestaw = 422", async () => {
    const tytul = unikat("Reguła werdyktu");
    const prop = await wywolaj(import("@/app/api/v2/rules/proposals/route"), "POST", "/rules/proposals", {
      token: rw.token,
      cialo: { title: tytul, textMd: "Wchodzę tylko po sweepie.", origin: "ai", counterargument: "Może za rzadko.", evidence: { trades: [1] }, hypothesisId: await hipotezaPowyzejProgu() },
    });
    expect(prop.status, JSON.stringify(prop.json)).toBe(201);
    const kod = prop.json.rule as string;
    const { przyjmijWersjeReguly } = await import("@/lib/decyzje/wersje");
    const [wersja] = await sql`select rv.id from rule_versions rv join rules r on r.id = rv.rule_id where r.code = ${kod} and rv.status = 'proposed'`;
    expect((await przyjmijWersjeReguly(wersja.id)).ok).toBe(true);
    const [zestaw] = await sql`select ruleset_version from settings where id = 1`;

    const id = await nowyOtwarty();
    const r = await ocena(id, {
      basis: "chart",
      evidence: { intervalMinutes: 5, candles: swiece() },
      ruleChecks: [{ ruleId: kod, ruleText: "Wchodzę tylko po sweepie.", verdict: "pass" }],
    });
    expect(r.status).toBe(201);
    expect(r.json.rulesetVersion).toBe(zestaw.ruleset_version);
    expect(r.json.unknownRules).toEqual([]);
    const [c] = await sql`select rule_version_id from trade_rule_checks where review_id = ${r.json.reviewId}`;
    expect(c.rule_version_id).toBe(wersja.id);

    const przyszly = await ocena(await nowyOtwarty(), { basis: "chart", rulesetVersion: zestaw.ruleset_version + 5, evidence: { intervalMinutes: 5, candles: swiece() } });
    expect(przyszly.status).toBe(422);
    expect(przyszly.json.code).toBe("unknown_ruleset");
  });

  async function hipotezaPowyzejProgu(): Promise<number> {
    const h = await wywolaj(import("@/app/api/v2/hypotheses/route"), "POST", "/hypotheses", {
      token: (await tokenImportu()).token,
      cialo: { title: unikat("Hipoteza werdyktu"), origin: "vault-import", externalRef: `vault:${unikat("h")}`, nImported: 25, progN: 20 },
    });
    expect(h.status, JSON.stringify(h.json)).toBe(201);
    return h.json.id as number;
  }
  let importowy: Par | null = null;
  async function tokenImportu(): Promise<Par> {
    importowy ??= await nowyToken(sql, ["read", "write", "propose", "import"]);
    return importowy;
  }
  it("werdykt »chart« odrzuca zrzut zrobiony PO wejsciu (look_ahead); ta sama podstawa »history« go przyjmuje", async () => {
    const id = await nowyOtwarty();
    const poWejsciu = await wgrajZrzut(id, "tradingview", "2099-01-01T10:00:00+00:00");
    const przedWejsciem = await wgrajZrzut(id, "fxreplay");
    const zly = await ocena(id, { basis: "chart", brainVerdict: "wejdz", evidence: { intervalMinutes: 5, candles: swiece(), screenshots: [{ sha256: przedWejsciem.sha256 }, { sha256: poWejsciu.sha256 }] } });
    expect(zly.status, JSON.stringify(zly.json)).toBe(422);
    expect(zly.json.code).toBe("look_ahead");
    expect(zly.json.error).toContain(poWejsciu.sha256);
    // zrzut bez znacznika czasu zrobienia tez nie jest dowodem »sprzed wejscia« (decyzja klasy gustu, 15.10.2026: bezpieczniej)
    const bezCzasu = await wgrajZrzut(id, "manual");
    await sql`update screenshots set captured_at = null where id = ${bezCzasu.id}`;
    const nieznany = await ocena(id, { basis: "chart", brainVerdict: "wejdz", evidence: { intervalMinutes: 5, candles: swiece(), screenshots: [{ sha256: bezCzasu.sha256 }] } });
    expect(nieznany.status, JSON.stringify(nieznany.json)).toBe(422);
    expect(nieznany.json.error).toContain("bez znacznika czasu");
    const dobry = await ocena(id, { basis: "chart", brainVerdict: "wejdz", evidence: { intervalMinutes: 5, candles: swiece(), screenshots: [{ sha256: przedWejsciem.sha256 }] } });
    expect(dobry.status, JSON.stringify(dobry.json)).toBe(201);
    const historia = await ocena(id, { basis: "history", summaryMd: "Po fakcie.", evidence: { intervalMinutes: 5, candles: swiece("14:40"), screenshots: [{ sha256: poWejsciu.sha256 }] } });
    expect(historia.status, JSON.stringify(historia.json)).toBe(201);
  });

  it("backtest (20.10.2026): zrzut z replayu jest dowodem »chart«, gdy chartState.replayTime <= wejscie; captured_at (zegar sciany) sie nie liczy; brak replayTime = look_ahead", async () => {
    const id = await nowyOtwarty();
    await sql`update trades set source = 'fxreplay' where id = ${id}`;
    const teraz = new Date().toISOString(); // czas zegarowy zrobienia: lata po wejsciu z replayu (1988)
    const przed = await wgrajZrzut(id, "fxreplay", teraz, { symbol: "NQ1!", replayTime: `${DZIEN}T14:30:00Z` });
    const rowno = await wgrajZrzut(id, "manual", teraz, { replayTime: `${DZIEN}T09:35:00-05:00` });
    const po = await wgrajZrzut(id, "manual", teraz, { replayTime: `${DZIEN}T14:40:00Z` });
    const bez = await wgrajZrzut(id, "manual", `${DZIEN}T14:00:00+00:00`, { symbol: "NQ1!" });
    const dowod = (sha: string[]) => ({ basis: "chart", brainVerdict: "wejdz", evidence: { intervalMinutes: 5, candles: swiece(), screenshots: sha.map((s) => ({ sha256: s })) } });

    const zPo = await ocena(id, dowod([przed.sha256, po.sha256]));
    expect(zPo.status, JSON.stringify(zPo.json)).toBe(422);
    expect(zPo.json.code).toBe("look_ahead");
    expect(zPo.json.afterEntry).toEqual([po.sha256]);
    expect(zPo.json.error).toContain("zegar replayu");
    // captured_at przed wejsciem NIE wystarcza przy backteście: liczy sie wylacznie zegar replayu (fail-closed)
    const zBez = await ocena(id, dowod([bez.sha256]));
    expect(zBez.status, JSON.stringify(zBez.json)).toBe(422);
    expect(zBez.json.error).toContain("chartState.replayTime");
    const dobry = await ocena(id, dowod([przed.sha256, rowno.sha256]));
    expect(dobry.status, JSON.stringify(dobry.json)).toBe(201);
  });

  it("sesja backtestu rodzaju »backtest« tez wymaga replayTime; sesja »forward« liczy captured_at", async () => {
    const [bt] = await sql`insert into backtest_sessions (name, kind) values (${`WERD-BT-${znacznik}`}, 'backtest') returning id`;
    const [fw] = await sql`insert into backtest_sessions (name, kind) values (${`WERD-FW-${znacznik}`}, 'forward') returning id`;
    try {
      const idBt = await nowyOtwarty();
      await sql`update trades set backtest_session_id = ${bt.id} where id = ${idBt}`;
      const zwykly = await wgrajZrzut(idBt, "tradingview");
      const r1 = await ocena(idBt, { basis: "chart", brainVerdict: "wejdz", evidence: { intervalMinutes: 5, candles: swiece(), screenshots: [{ sha256: zwykly.sha256 }] } });
      expect(r1.status, JSON.stringify(r1.json)).toBe(422);
      expect(r1.json.code).toBe("look_ahead");

      const idFw = await nowyOtwarty();
      await sql`update trades set backtest_session_id = ${fw.id} where id = ${idFw}`;
      const zFw = await wgrajZrzut(idFw, "tradingview");
      const r2 = await ocena(idFw, { basis: "chart", brainVerdict: "wejdz", evidence: { intervalMinutes: 5, candles: swiece(), screenshots: [{ sha256: zFw.sha256 }] } });
      expect(r2.status, JSON.stringify(r2.json)).toBe(201);
    } finally {
      await sql`delete from trades where backtest_session_id in (${bt.id}, ${fw.id})`;
      await sql`delete from backtest_sessions where id in (${bt.id}, ${fw.id})`;
    }
  });

  it("nieczytelne chartState.replayTime przy wgrywaniu zrzutu = 400", async () => {
    const id = await nowyOtwarty();
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const form = new FormData();
    form.append("shot", new File([new Uint8Array(png)], "wykres.png", { type: "image/png" }));
    form.append("origin", "fxreplay");
    form.append("chartState", JSON.stringify({ replayTime: "10 marca" }));
    const r = await wywolajMultipart(import("@/app/api/v2/trades/[id]/screenshots/route"), `/trades/${id}/screenshots`, rw.token, form, PARAMS({ id: String(id) }));
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(r.json.error).toContain("replayTime");
  });

  it("korekta uzytkownika to NOWY wiersz user_override; werdykt AI zostaje; wymaga slow; kolejna korekta wskazuje werdykt AI", async () => {
    const id = await nowyOtwarty();
    const r = await ocena(id, {
      basis: "chart",
      brainVerdict: "wejdz",
      summaryMd: "AI: wejdź.",
      evidence: { intervalMinutes: 5, candles: swiece() },
      ruleChecks: [{ ruleId: "E2E-R3", ruleText: "Reguła", verdict: "pass" }],
    });
    const rid = r.json.reviewId as number;
    const mod = import("@/app/api/v2/trades/[id]/reviews/[reviewId]/override/route");
    const sciezka = `/trades/${id}/reviews/${rid}/override`;
    const ctx = PARAMS({ id: String(id), reviewId: String(rid) });

    const bezSlow = await wywolaj(mod, "POST", sciezka, { token: rw.token, cialo: { brainVerdict: "odpusc" } }, ctx);
    expect(bezSlow.status).toBe(400);
    const slowa = await zapiszSlowa(rw.token, "Nie zgadzam się: sweep był fałszywy.", { tradeId: id, role: "review.override" });
    const k = await wywolaj(mod, "POST", sciezka, { token: rw.token, cialo: { wordsId: slowa.id, brainVerdict: "odpusc", ruleChecks: [{ ruleId: "E2E-R3", ruleText: "Reguła", verdict: "fail" }] } }, ctx);
    expect(k.status, JSON.stringify(k.json)).toBe(201);
    zgodneZKontraktem("post", "/trades/{id}/reviews/{reviewId}/override", k.json);
    expect(k.json.overridesReviewId).toBe(rid);

    const [oryginal] = await sql`select brain_verdict, summary_md, kind from trade_reviews where id = ${rid}`;
    expect(oryginal).toEqual({ brain_verdict: "wejdz", summary_md: "AI: wejdź.", kind: "ai" });
    const [nowy] = await sql`select kind, overrides_review_id, brain_verdict, summary_md, as_of is not null as datowany from trade_reviews where id = ${k.json.reviewId}`;
    expect(nowy).toMatchObject({ kind: "user_override", overrides_review_id: rid, brain_verdict: "odpusc", summary_md: "AI: wejdź.", datowany: true });
    const [kontrola] = await sql`select verdict from trade_rule_checks where review_id = ${k.json.reviewId}`;
    expect(kontrola.verdict).toBe("fail");

    // korekta korekty nie jest dozwolona: koryguje sie werdykt AI
    const nad = await wywolaj(mod, "POST", `/trades/${id}/reviews/${k.json.reviewId}/override`, { token: rw.token, cialo: { wordsId: slowa.id } }, PARAMS({ id: String(id), reviewId: String(k.json.reviewId) }));
    expect(nad.status).toBe(422);
    expect(nad.json.code).toBe("not_ai_verdict");
    // werdykt cudzego trade'a nie istnieje dla tej trasy
    const cudzy = await nowyOtwarty();
    const zlyTrade = await wywolaj(mod, "POST", `/trades/${cudzy}/reviews/${rid}/override`, { token: rw.token, cialo: { wordsId: slowa.id } }, PARAMS({ id: String(cudzy), reviewId: String(rid) }));
    expect(zlyTrade.status).toBe(404);

    // miara »ile werdyktow uzytkownik zmienil« w szczegolach trade'a
    const t = await trade(id);
    const ai = t.json.reviews.find((x: { id: number }) => x.id === rid);
    expect(ai.overriddenBy).toEqual([k.json.reviewId]);
    expect(ai.changedByUser).toBe(1);
  });

  it("korekta jest idempotentna (ten sam wiersz, 200) i stoi tylko na slowach o tym trade'u albo jego dniu handlowym", async () => {
    const id = await nowyOtwarty();
    const r = await ocena(id, { basis: "chart", brainVerdict: "wejdz", evidence: { intervalMinutes: 5, candles: swiece() } });
    const rid = r.json.reviewId as number;
    const mod = import("@/app/api/v2/trades/[id]/reviews/[reviewId]/override/route");
    const ctx = PARAMS({ id: String(id), reviewId: String(rid) });
    const wyslij = (wordsId: number, extra: Record<string, unknown> = {}) => wywolaj(mod, "POST", `/trades/${id}/reviews/${rid}/override`, { token: rw.token, cialo: { wordsId, brainVerdict: "odpusc", ...extra } }, ctx);

    const swoje = await zapiszSlowa(rw.token, "Korekta: fałszywy sweep.", { tradeId: id });
    const pierwsza = await wyslij(swoje.id);
    expect(pierwsza.status, JSON.stringify(pierwsza.json)).toBe(201);
    const druga = await wyslij(swoje.id);
    expect(druga.status).toBe(200);
    expect(druga.json.reviewId).toBe(pierwsza.json.reviewId);
    zgodneZKontraktem("post", "/trades/{id}/reviews/{reviewId}/override", druga.json);
    expect((await sql`select count(*)::int as n from trade_reviews where overrides_review_id = ${rid}`)[0].n).toBe(1);
    // inna tresc korekty to nowa korekta
    expect((await wyslij(swoje.id, { summaryMd: "Inne podsumowanie." })).status).toBe(201);

    const dniowe = await zapiszSlowa(rw.token, "Uwaga dnia: ten dzień był nerwowy.", { day: DZIEN });
    expect((await wyslij(dniowe.id, { brainVerdict: "czekaj" })).status).toBe(201); // slowa z dnia handlowego trade'a
    const cudzyTrade = await nowyOtwarty();
    const cudze = await zapiszSlowa(rw.token, "To dotyczy innego trade'a.", { tradeId: cudzyTrade });
    const odm = await wyslij(cudze.id, { brainVerdict: "czekaj" });
    expect(odm.status).toBe(422);
    expect(odm.json.code).toBe("words_not_for_trade");
    const innyDzien = await zapiszSlowa(rw.token, "Słowa z zupełnie innego dnia.", { day: "1988-03-14" });
    expect((await wyslij(innyDzien.id, { brainVerdict: "czekaj" })).json.code).toBe("words_not_for_trade");
  });

  it("GET /trades/:id ukrywa wynik, dopoki trade z werdyktem nie jest zamkniety (logika w API, flaga dla widoku); po zamknieciu pokazuje", async () => {
    const id = await nowyOtwarty();
    // bez werdyktu otwarty trade nie ma co ukrywac
    const bez = await trade(id);
    expect(bez.status).toBe(200);
    zgodneZKontraktem("get", "/trades/{id}", bez.json);
    expect(bez.json.resultHidden).toBe(false);

    await ocena(id, { basis: "chart", brainVerdict: "wejdz", model: "claude-opus-5-5", lesson: "Wniosek po fakcie.", evidence: { intervalMinutes: 5, candles: swiece() } });
    const poFakcie = await ocena(id, { basis: "history", summaryMd: "Wynik: wygral dwa R.", evidence: { intervalMinutes: 5, candles: swiece("14:40") } });
    expect(poFakcie.status, JSON.stringify(poFakcie.json)).toBe(201);
    await sql`update trades set note = 'Notatka po wyniku: +2R' where id = ${id}`;
    // trade dostaje wynik (np. wpis z FX Replay), ale status jeszcze nie jest zamkniety
    await sql`update trades set pnl = 80000, r_multiple = 2, exit_price = 20020, exit_time = ${WEJSCIE} where id = ${id}`;
    const ukryty = await trade(id);
    zgodneZKontraktem("get", "/trades/{id}", ukryty.json);
    expect(ukryty.json.resultHidden).toBe(true);
    expect(ukryty.json.result).toBeNull();
    expect(JSON.stringify(ukryty.json)).not.toContain("80000");
    expect(ukryty.json.reviews).toHaveLength(1);
    // razem z wynikiem schowane sa oceny po fakcie, wnioski i notatki trade'a (review: slepa ocena ma byc slepa)
    expect(ukryty.json.hiddenReviews).toBe(1);
    expect(ukryty.json.hiddenFields).toContain("reviews.basis=history");
    expect(ukryty.json.trade.note).toBeNull();
    expect(ukryty.json.reviews[0].lesson).toBeNull();
    expect(ukryty.json.reviews.some((r: { basis: string }) => r.basis === "history")).toBe(false);
    expect(JSON.stringify(ukryty.json)).not.toContain("Wynik: wygral dwa R");
    expect(ukryty.json.reviews[0].immutable).toBe(true);
    // historyczny dzien (1988) sprzed odciecia wiedzy modelu: flaga »model mogl znac ten dzien«
    expect(ukryty.json.reviews[0].lookAhead.moglZnacDzien).toBe(true);

    await sql`update trades set status = 'closed', exit_count = 1, closed_contracts = 2 where id = ${id}`;
    const odslonity = await trade(id);
    zgodneZKontraktem("get", "/trades/{id}", odslonity.json);
    expect(odslonity.json.resultHidden).toBe(false);
    expect(odslonity.json.hiddenFields).toEqual([]);
    expect(odslonity.json.hiddenReviews).toBe(0);
    expect(odslonity.json.reviews).toHaveLength(2);
    expect(odslonity.json.trade.note).toBe("Notatka po wyniku: +2R");
    expect(odslonity.json.reviews.find((r: { basis: string }) => r.basis === "chart").lesson).toBe("Wniosek po fakcie.");
    expect(odslonity.json.result).toMatchObject({ pnlCents: 80000, rMultiple: 2, exitPrice: 20020 });
  });

  it("GET /trades/:id: nieistniejacy = 404, zly id = 400, token bez odczytu = 401/403", async () => {
    expect((await trade(999999999)).status).toBe(404);
    const zly = await wywolaj(import("@/app/api/v2/trades/[id]/route"), "GET", "/trades/abc", { token: ro.token }, PARAMS({ id: "abc" }));
    expect(zly.status).toBe(400);
    const bezToken = await wywolaj(import("@/app/api/v2/trades/[id]/route"), "GET", "/trades/1", { token: "tj_zzzzzzzz_" + "A".repeat(43) }, PARAMS({ id: "1" }));
    expect(bezToken.status).toBe(401);
  });

  it("werdykt BEZ evidence tez jest niezmienny (Slowa uzytkownika 15.10.2026: «Niezmienny zawsze»): ta sama tresc 200, inna 409; stary werdykt bez as_of zostaje czytelny", async () => {
    const id = await nowyOtwarty();
    const pierwsza = await ocena(id, { basis: "chart", brainVerdict: "czekaj", summaryMd: "v1" });
    expect(pierwsza.status, JSON.stringify(pierwsza.json)).toBe(201);
    expect(pierwsza.json.immutable).toBe(true);
    expect(pierwsza.json.asOf).not.toBeNull();
    expect(pierwsza.json.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    zgodneZKontraktem("post", "/trades/{id}/reviews", pierwsza.json);
    const powtorka = await ocena(id, { basis: "chart", brainVerdict: "czekaj", summaryMd: "v1" });
    expect(powtorka.status).toBe(200);
    expect(powtorka.json.created).toBe(false);
    const inna = await ocena(id, { basis: "chart", brainVerdict: "wejdz", summaryMd: "v2" });
    expect(inna.status).toBe(409);
    expect(inna.json.code).toBe("verdict_immutable");
    const [w] = await sql`select summary_md, as_of is not null as datowany from trade_reviews where trade_id = ${id}`;
    expect(w).toEqual({ summary_md: "v1", datowany: true });
    // dopisanie dowodu to tez inna tresc: korekta idzie przez user_override
    const zDowodem = await ocena(id, { basis: "chart", brainVerdict: "czekaj", summaryMd: "v1", evidence: { intervalMinutes: 5, candles: swiece() } });
    expect(zDowodem.status).toBe(409);

    // werdykt sprzed zmiany (bez as_of) zostaje czytelny; powstaje tylko z SQL, bo API takich juz nie tworzy
    const id2 = await nowyOtwarty();
    await sql`insert into trade_reviews (trade_id, basis, kind, summary_md, brain_verdict) values (${id2}, 'chart', 'ai', 'stary', 'czekaj')`;
    const t = await trade(id2);
    expect(t.json.reviews[0]).toMatchObject({ summaryMd: "stary", immutable: false, asOf: null });
  });
});
