import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, zapiszSlowa, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

const sha = (t: string) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

/*
 * Profil tradera (MUST 14), luki i »Do rozstrzygniecia« (MUST 15, 16), mentor tylko z zakresem import (MUST 16).
 * AI nie rozstrzyga sprzecznosci: odpowiada wylacznie UI, a baza odrzuca kazda inna sciezke.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("profil, luki, mentor i rozstrzyganie sprzecznosci (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par; // bez import
  let ro: Par;
  let imp: Par; // z import
  let instrumentId = 0;
  let kontoId = 0;
  let tradeId = 0;
  const znacznik = unikat("mlp");
  const VIDEO = `vid${Date.now().toString(36)}`.slice(0, 14).padEnd(8, "x");
  const DZIEN = "1982-02-02";

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write", "propose"]);
    ro = await nowyToken(sql, ["read"]);
    imp = await nowyToken(sql, ["read", "write", "propose", "import"]);
    const [k] = await sql`insert into accounts (name, type) values (${`MLP-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
    tradeId = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN });
  });
  afterAll(async () => {
    await sql`delete from strategy_gaps where origin in ('ai', 'mentor') and question like ${`%${znacznik}%`}`;
    await sql`delete from mentor_sources where video_id like ${`${VIDEO}%`}`;
    await sql`delete from interpretation_corrections where words_id in (select id from user_words where created_by_token_id = any(${[rw.id, imp.id]}))`;
    await sql`delete from user_words where role = 'conflict.answer' and day = current_date`;
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

  describe("mentor wymaga zakresu import", () => {
    const zrodlo = (nr = 1, token = imp.token) =>
      wywolaj(import("@/app/api/v2/mentor/sources/route"), "POST", "/mentor/sources", {
        token,
        cialo: { videoId: `${VIDEO}${nr}`, playlistId: "PLtest", position: nr, title: `Film ${nr} ${znacznik}`, url: `https://www.youtube.com/watch?v=${VIDEO}${nr}`, durationS: 600 },
      });

    it("kazda trasa mentora bez zakresu import = 403 z nazwa brakujacego zakresu (takze odczyt)", async () => {
      const zad = [
        () => zrodlo(1, rw.token),
        () => wywolaj(import("@/app/api/v2/mentor/sources/route"), "GET", "/mentor/sources", { token: rw.token }),
        () => wywolaj(import("@/app/api/v2/mentor/sources/[videoId]/route"), "PUT", `/mentor/sources/${VIDEO}1`, { token: rw.token, cialo: { status: "no_captions" } }, PARAMS({ videoId: `${VIDEO}1` })),
        () => wywolaj(import("@/app/api/v2/mentor/claims/route"), "GET", "/mentor/claims", { token: rw.token }),
        () => wywolaj(import("@/app/api/v2/mentor/claims/route"), "POST", "/mentor/claims", { token: rw.token, cialo: { videoId: `${VIDEO}1`, claims: [] } }),
        () => wywolaj(import("@/app/api/v2/mentor/claims/[id]/route"), "PATCH", "/mentor/claims/1", { token: rw.token, cialo: { setupSlug: null } }, PARAMS({ id: "1" })),
      ];
      for (const z of zad) {
        const r = await z();
        expect(r.status).toBe(403);
        expect(r.json.missingScope ?? r.json.code).toBeDefined();
      }
      const ro1 = await wywolaj(import("@/app/api/v2/mentor/sources/route"), "GET", "/mentor/sources", { token: ro.token });
      expect(ro1.status).toBe(403);
      expect((await sql`select count(*)::int as n from mentor_sources where video_id like ${`${VIDEO}%`}`)[0].n).toBe(0);
    });

    it("film rejestrowany idempotentnie (201 potem 200), status przetwarzania wymaga zrodla transkrypcji albo opisu bledu; odpowiedzi zgodne z kontraktem", async () => {
      const a = await zrodlo(2);
      expect(a.status, JSON.stringify(a.json)).toBe(201);
      zgodneZKontraktem("post", "/mentor/sources", a.json);
      expect(a.json.source.status).toBe("pending");
      const b = await zrodlo(2);
      expect(b.status).toBe(200);
      expect(b.json.created).toBe(false);
      expect(b.json.source.id).toBe(a.json.source.id);

      const put = (cialo: Record<string, unknown>) =>
        wywolaj(import("@/app/api/v2/mentor/sources/[videoId]/route"), "PUT", `/mentor/sources/${VIDEO}2`, { token: imp.token, cialo }, PARAMS({ videoId: `${VIDEO}2` }));
      expect((await put({ status: "processed" })).status).toBe(422);
      expect((await put({ status: "error" })).status).toBe(422);
      const ok = await put({ status: "processed", transcriptSource: "captions", transcriptPath: "R:/transkrypcje/film2.vtt" });
      expect(ok.status).toBe(200);
      zgodneZKontraktem("put", "/mentor/sources/{videoId}", ok.json);
      expect(ok.json).toMatchObject({ status: "processed", transcriptSource: "captions" });
      expect(ok.json.processedAt).not.toBeNull();
      const lista = await wywolaj(import("@/app/api/v2/mentor/sources/route"), "GET", "/mentor/sources?status=processed", { token: imp.token });
      zgodneZKontraktem("get", "/mentor/sources", lista.json);
      expect(lista.json.sources.some((s: { videoId: string }) => s.videoId === `${VIDEO}2`)).toBe(true);
      expect((await put({ status: "pending", transcriptSource: "captions" })).json.processedAt).toBeNull();
    });

    it("twierdzenia: cytat bajt w bajt (skrot sprawdzany), idempotentnie po (film, skrot, t), link z t=, scalenie; streszczenie nie zastepuje cytatu; cytatu nie zmieni nawet SQL", async () => {
      await zrodlo(3);
      const cytat = "After eleven you are donating. \"Nie wchodź po 11:00\" 🙂";
      const post = (claims: unknown[], video = `${VIDEO}3`) =>
        wywolaj(import("@/app/api/v2/mentor/claims/route"), "POST", "/mentor/claims", { token: imp.token, cialo: { videoId: video, claims } });
      const r = await post([
        { quote: cytat, quoteSha256: sha(cytat), tStartS: 754, tEndS: 770, claimType: "management", paraphrase: "Po 11:00 nie otwiera nowych pozycji." },
        { quote: "Zły skrót", quoteSha256: "0".repeat(64), tStartS: 800, claimType: "other" },
      ]);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      zgodneZKontraktem("post", "/mentor/claims", r.json);
      expect(r.json.results.map((x: { status: string }) => x.status)).toEqual(["created", "refused"]);
      expect(r.json.results[1].error).toContain("quoteSha256");

      const ponownie = await post([{ quote: cytat, quoteSha256: sha(cytat), tStartS: 754, claimType: "management" }]);
      expect(ponownie.status).toBe(200);
      expect(ponownie.json.results[0]).toMatchObject({ status: "unchanged", claimId: r.json.results[0].claimId });

      const lista = await wywolaj(import("@/app/api/v2/mentor/claims/route"), "GET", `/mentor/claims?videoId=${VIDEO}3`, { token: imp.token });
      zgodneZKontraktem("get", "/mentor/claims", lista.json);
      const c = lista.json.claims[0];
      expect(c.quote).toBe(cytat);
      expect(c.link).toBe(`https://www.youtube.com/watch?v=${VIDEO}3&t=754`);
      expect(c.paraphraseSignature).toBe("streszczenie AI");

      const [w] = await sql`select quote_sha256, quote from mentor_claims where id = ${c.id}`;
      expect(w.quote_sha256).toBe(sha(cytat));
      let kod: string | undefined;
      try {
        await sql`update mentor_claims set quote = 'podmieniony' where id = ${c.id}`;
      } catch (e) {
        kod = (e as { code?: string }).code;
      }
      expect(kod).toBe("TJ409");

      const scal = await wywolaj(import("@/app/api/v2/mentor/claims/[id]/route"), "PATCH", `/mentor/claims/${c.id}`, { token: imp.token, cialo: { mergedNoteId: await jakasNotatka() } }, PARAMS({ id: String(c.id) }));
      expect(scal.status, JSON.stringify(scal.json)).toBe(200);
      zgodneZKontraktem("patch", "/mentor/claims/{id}", scal.json);
      expect(scal.json.status).toBe("merged");
      // ocena zgodnosci z filmem to decyzja uzytkownika: po niej API nie scala
      await sql`update mentor_claims set status = 'review_ok' where id = ${c.id}`;
      const po = await wywolaj(import("@/app/api/v2/mentor/claims/[id]/route"), "PATCH", `/mentor/claims/${c.id}`, { token: imp.token, cialo: { setupSlug: null } }, PARAMS({ id: String(c.id) }));
      expect(po.status).toBe(409);
      expect((await post([{ quote: "x", quoteSha256: sha("x"), tStartS: 1, claimType: "other" }], "nieistniejacy1")).status).toBe(404);
    });

    async function jakasNotatka(): Promise<number> {
      const w = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: imp.token, cialo: { kind: "concept", title: unikat("Pojęcie mentora"), bodyMd: "x" } });
      return w.json.id as number;
    }
  });

  describe("luki i sprzecznosci mentor kontra praktyka", () => {
    let claimId = 0;
    const pytanie = `Co robię, gdy FVG jest w discount, a HTF bias short? ${znacznik}`;

    beforeAll(async () => {
      await wywolaj(import("@/app/api/v2/mentor/sources/route"), "POST", "/mentor/sources", {
        token: imp.token,
        cialo: { videoId: `${VIDEO}9`, title: `Film konfliktu ${znacznik}`, url: `https://www.youtube.com/watch?v=${VIDEO}9` },
      });
      const cytat = "Never trade against the higher timeframe.";
      const r = await wywolaj(import("@/app/api/v2/mentor/claims/route"), "POST", "/mentor/claims", {
        token: imp.token,
        cialo: { videoId: `${VIDEO}9`, claims: [{ quote: cytat, quoteSha256: sha(cytat), tStartS: 3723, claimType: "setup_condition" }] },
      });
      claimId = r.json.results[0].claimId;
    });

    const luka = (cialo: Record<string, unknown>, token = rw.token) => wywolaj(import("@/app/api/v2/strategy-gaps/route"), "POST", "/strategy-gaps", { token, cialo });

    it("luka (gap): zgloszona, bez dubla (200), zadana w rytuale (open -> asked); AI nie rozstrzyga (SQL api:* = TJ403)", async () => {
      const q = `Co robię z szumem przed NY? ${znacznik}`;
      const a = await luka({ kind: "gap", question: q });
      expect(a.status, JSON.stringify(a.json)).toBe(201);
      zgodneZKontraktem("post", "/strategy-gaps", a.json);
      const ten = await luka({ kind: "gap", question: q.toUpperCase().replace("SZUMEM", "szumem") });
      expect(ten.status).toBe(200); // te same slowa bez wielkosci liter i ogonkow = to samo pytanie
      expect(ten.json.id).toBe(a.json.id);
      const zadaj = () => wywolaj(import("@/app/api/v2/strategy-gaps/[id]/ask/route"), "POST", `/strategy-gaps/${a.json.id}/ask`, { token: rw.token }, PARAMS({ id: String(a.json.id) }));
      const z = await zadaj();
      expect(z.status).toBe(200);
      zgodneZKontraktem("post", "/strategy-gaps/{id}/ask", z.json);
      expect(z.json.status).toBe("asked");
      expect((await zadaj()).json.status).toBe("asked");

      const { zapisZAktorem } = await import("./zapis");
      const { sql: dsql } = await import("drizzle-orm");
      let kod: string | undefined;
      try {
        await zapisZAktorem(`api:${rw.id}`, (tx) => tx.execute(dsql`update strategy_gaps set status = 'dismissed' where id = ${a.json.id}`));
      } catch (e) {
        kod = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
      }
      expect(kod).toBe("TJ403");
      expect((await sql`select status from strategy_gaps where id = ${a.json.id}`)[0].status).toBe("asked");
    });

    it("sprzecznosc wymaga cytatu mentora; pochodzenie mentor wymaga zakresu import; nieznany cytat = 422", async () => {
      const bez = await luka({ kind: "mentor_conflict", question: `Bez cytatu ${znacznik}` });
      expect(bez.status).toBe(400);
      expect(bez.json.error).toContain("mentorClaimId");
      const zlyRodzaj = await luka({ kind: "gap", question: `Luka z cytatem ${znacznik}`, mentorClaimId: claimId });
      expect(zlyRodzaj.status).toBe(400);
      const mentor = await luka({ kind: "mentor_conflict", question: `Pytanie mentora ${znacznik}`, mentorClaimId: claimId, origin: "mentor" });
      expect(mentor.status).toBe(403);
      expect(mentor.json.missingScope).toBe("import");
      expect((await luka({ kind: "mentor_conflict", question: `Nieznany cytat ${znacznik}`, mentorClaimId: 999999999 })).status).toBe(422);
    });

    it("»Do rozstrzygniecia«: pytanie z cytatem mentora i linkiem t=, obok slow uzytkownika; rozstrzyga tylko UI, jego slowa zapisane bajt w bajt; potem pytanie nie wraca", async () => {
      const slowaPraktyki = await zapiszSlowa(rw.token, "Gram FVG nawet pod HTF, jeśli sweep był na 1h.", { tradeId });
      const r = await luka({ kind: "mentor_conflict", question: pytanie, mentorClaimId: claimId, tradeId });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      const gapId = r.json.id as number;

      const lista = await wywolaj(import("@/app/api/v2/strategy-gaps/route"), "GET", "/strategy-gaps?kind=mentor_conflict&status=open", { token: ro.token });
      zgodneZKontraktem("get", "/strategy-gaps", lista.json);
      const g = lista.json.gaps.find((x: { id: number }) => x.id === gapId);
      expect(g.mentorClaim).toMatchObject({ quote: "Never trade against the higher timeframe.", tStartS: 3723, videoId: `${VIDEO}9` });
      expect(g.mentorClaim.link).toBe(`https://www.youtube.com/watch?v=${VIDEO}9&t=3723`);

      // kolejka w UI: cytat mentora + link t= + Twoje slowa z kotwicy sprzecznosci
      const { sprzecznosciDoRozstrzygniecia, licznikiDoDecyzji } = await import("@/lib/queries/decyzje");
      const doRozstrzygniecia = await sprzecznosciDoRozstrzygniecia();
      const wKolejce = doRozstrzygniecia.find((x) => x.id === gapId);
      expect(wKolejce?.mentor.link).toContain("t=3723");
      expect(wKolejce?.slowaUzytkownika.map((s) => s.id)).toContain(slowaPraktyki.id);
      expect((await licznikiDoDecyzji()).rozstrzygniecia).toBeGreaterThanOrEqual(1);

      const { rozstrzygnijSprzecznosc } = await import("@/lib/decyzje/rozstrzygniecia");
      expect((await rozstrzygnijSprzecznosc(gapId, "nie_wiem", "x")).ok).toBe(false);
      expect((await rozstrzygnijSprzecznosc(gapId, "keep_mine", "   \n ")).ok).toBe(false);
      const warunek = "Gram pod HTF tylko po sweepie 1h,\r\na poza tym wg mentora. Zażółć 🙂  ";
      const brak = await rozstrzygnijSprzecznosc(gapId, "both_conditional", warunek);
      expect(brak.ok, JSON.stringify(brak)).toBe(true);

      const [po] = await sql`select g.status, g.resolution, g.answer_words_id, g.answered_at is not null as datowana,
                                    uw.text, uw.sha256, uw.source, uw.role, uw.trade_id
                               from strategy_gaps g join user_words uw on uw.id = g.answer_words_id where g.id = ${gapId}`;
      expect(po).toMatchObject({ status: "answered", resolution: "both_conditional", datowana: true, source: "ui", role: "conflict.answer", trade_id: null });
      expect(po.text).toBe(warunek);
      expect(po.sha256).toBe(sha(warunek));

      expect((await rozstrzygnijSprzecznosc(gapId, "take_mentor", "druga proba")).ok).toBe(false); // juz rozstrzygniete
      const wraca = await luka({ kind: "mentor_conflict", question: pytanie, mentorClaimId: claimId });
      expect(wraca.status).toBe(409);
      expect(wraca.json.code).toBe("already_resolved");
      expect((await sprzecznosciDoRozstrzygniecia()).find((x) => x.id === gapId)).toBeUndefined();
      const zadana = await wywolaj(import("@/app/api/v2/strategy-gaps/[id]/ask/route"), "POST", `/strategy-gaps/${gapId}/ask`, { token: rw.token }, PARAMS({ id: String(gapId) }));
      expect(zadana.status).toBe(409);
      await sql`update strategy_gaps set trade_id = null where id = ${gapId}`;
    });

    it("zwykla luka nie jest sprzecznoscia: nie da sie jej rozstrzygnac ekranem »Do rozstrzygniecia«", async () => {
      const g = await luka({ kind: "gap", question: `Luka nie do rozstrzygania ${znacznik}` });
      const { rozstrzygnijSprzecznosc } = await import("@/lib/decyzje/rozstrzygniecia");
      const w = await rozstrzygnijSprzecznosc(g.json.id, "keep_mine", "powód");
      expect(w.ok).toBe(false);
      expect(w.komunikat).toContain("luka w strategii");
    });
  });

  describe("profil tradera i poprawki interpretacji", () => {
    it("poprawka zapisuje pare przed -> po w rejestrze i podmienia interpretacje; slowa zostaja nietkniete; haslo trafia do kolejki potwierdzen; miara poprawek w profilu", async () => {
      const tekst = `Wszedłem po sweepie na 5m ${znacznik}`;
      const slowa = await zapiszSlowa(rw.token, tekst, { day: DZIEN });
      const ustaw = await wywolaj(import("@/app/api/v2/user-words/[id]/interpretation/route"), "PUT", `/user-words/${slowa.id}/interpretation`, { token: rw.token, cialo: { text: "Wejście po sweepie PDL", model: "claude-opus-5-5" } }, PARAMS({ id: String(slowa.id) }));
      expect(ustaw.status).toBe(200);
      const korekta = await zapiszSlowa(rw.token, "Nie, chodziło mi o sweep na 5m, nie na PDL.", { day: DZIEN, role: "correction" });
      const post = (cialo: Record<string, unknown>) => wywolaj(import("@/app/api/v2/profile/corrections/route"), "POST", "/profile/corrections", { token: rw.token, cialo });

      const r = await post({ wordsId: slowa.id, correctionWordsId: korekta.id, afterInterpretation: "Wejście po sweepie lokalnego low na 5m", term: `sweep-5m ${znacznik}`, termMeaning: "FVG@5m po sweepie lokalnego low" });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      zgodneZKontraktem("post", "/profile/corrections", r.json);
      expect(r.json.termSuggestionId).toBeGreaterThan(0);

      const [uw] = await sql`select text, sha256, ai_interpretation, interpretation_model from user_words where id = ${slowa.id}`;
      expect(uw.text).toBe(tekst);
      expect(uw.sha256).toBe(sha(tekst));
      expect(uw.ai_interpretation).toBe("Wejście po sweepie lokalnego low na 5m");
      const [rej] = await sql`select before_interpretation, after_interpretation, correction_words_id from interpretation_corrections where id = ${r.json.correctionId}`;
      expect(rej).toEqual({ before_interpretation: "Wejście po sweepie PDL", after_interpretation: "Wejście po sweepie lokalnego low na 5m", correction_words_id: korekta.id });
      const [sug] = await sql`select kind, status, payload from ai_suggestions where id = ${r.json.termSuggestionId}`;
      expect(sug).toMatchObject({ kind: "profile_term", status: "pending" });
      expect(sug.payload.wordsIds).toEqual([slowa.id, korekta.id]);

      // rejestr jest tylko do dopisywania
      let kod: string | undefined;
      try {
        await sql`update interpretation_corrections set after_interpretation = 'x' where id = ${r.json.correctionId}`;
      } catch (e) {
        kod = (e as { code?: string }).code;
      }
      expect(kod).toBe("TJ409");

      const ta = await post({ wordsId: slowa.id, correctionWordsId: korekta.id, afterInterpretation: "Wejście po sweepie lokalnego low na 5m" });
      expect(ta.status).toBe(422);
      expect(ta.json.code).toBe("no_change");
      const bezInterpretacji = await zapiszSlowa(rw.token, `Bez interpretacji ${znacznik}`, { day: DZIEN });
      expect((await post({ wordsId: bezInterpretacji.id, correctionWordsId: korekta.id, afterInterpretation: "x" })).json.code).toBe("no_interpretation");
      expect((await post({ wordsId: slowa.id, correctionWordsId: slowa.id, afterInterpretation: "y" })).json.code).toBe("same_words");
      expect((await post({ wordsId: slowa.id, correctionWordsId: korekta.id, afterInterpretation: "z", term: "samo-haslo" })).json.code).toBe("term_meaning_required");

      const profil = await wywolaj(import("@/app/api/v2/profile/route"), "GET", "/profile", { token: ro.token });
      expect(profil.status).toBe(200);
      zgodneZKontraktem("get", "/profile", profil.json);
      expect(profil.json.corrections[0]).toMatchObject({ wordsId: slowa.id, words: tekst, correction: "Nie, chodziło mi o sweep na 5m, nie na PDL." });
      const miesiac = new Date().toISOString().slice(0, 7);
      const wMiesiacu = profil.json.correctionRate.find((x: { month: string }) => x.month === miesiac);
      expect(wMiesiacu.corrected).toBeGreaterThanOrEqual(1);
      expect(wMiesiacu.interpreted).toBeGreaterThanOrEqual(1);
      expect(wMiesiacu.rate).toBeCloseTo(wMiesiacu.corrected / wMiesiacu.interpreted, 12);
    });

    it("zdanie uzytkownika »nie zgadzam sie« i korekty werdyktu liczy profil jako werdykty zmienione przez uzytkownika", async () => {
      const przed = await wywolaj(import("@/app/api/v2/profile/route"), "GET", "/profile", { token: ro.token });
      const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open" });
      const o = await wywolaj(import("@/app/api/v2/trades/[id]/reviews/route"), "POST", `/trades/${id}/reviews`, {
        token: rw.token,
        cialo: { basis: "history", evidence: { candles: [{ t: `${DZIEN}T14:00:00Z`, o: 1, h: 2, l: 0.5, c: 1.5 }] }, ruleChecks: [{ ruleId: "E2E-R7", ruleText: "x", verdict: "pass" }] },
      }, PARAMS({ id: String(id) }));
      expect(o.status, JSON.stringify(o.json)).toBe(201);
      await sql`update trade_rule_checks set user_verdict = 'disagree' where review_id = ${o.json.reviewId}`;
      const po = await wywolaj(import("@/app/api/v2/profile/route"), "GET", "/profile", { token: ro.token });
      expect(po.json.verdicts.aiVerdicts).toBe(przed.json.verdicts.aiVerdicts + 1);
      expect(po.json.verdicts.ruleDisagreements).toBe(przed.json.verdicts.ruleDisagreements + 1);
      expect(po.json.verdicts.changedByUser).toBe(przed.json.verdicts.changedByUser + 1);
    });
  });
});
