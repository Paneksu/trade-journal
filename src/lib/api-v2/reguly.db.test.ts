import { sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zadanie, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Reguły, hipotezy, propozycje i zasada «agent NIE zatwierdza reguły»
 * (trzy warstwy z ADR-030) - na prawdziwej bazie lokalnej.
 * Decyzje użytkownika 14.10.2026: import z sejfu = propozycje; mentor bez progu n,
 * podpisany n=0; agent nie zatwierdzi reguły.
 */
const DOWOD = { video: "yt123", t: 754, quote: "after eleven you are donating" };

describe.skipIf(!MOZNA_NA_BAZIE)("reguły, hipotezy i zakaz zatwierdzania przez agenta (baza lokalna)", () => {
  let sql: Sql;
  let pelny: Par; // read + write + propose
  let bezPropose: Par; // read + write
  let ro: Par;
  const znacznik = Date.now().toString(36);
  const t = (nazwa: string) => `${nazwa} ${znacznik}`;

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
    pelny = await nowyToken(sql, ["read", "write", "propose"]);
    bezPropose = await nowyToken(sql, ["read", "write"]);
    ro = await nowyToken(sql, ["read"]);
  });
  afterAll(async () => {
    await sprzatnijPoTokenach(sql, [pelny.id, bezPropose.id, ro.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  async function zaproponuj(cialo: Record<string, unknown>, token = pelny.token) {
    const { POST } = await import("@/app/api/v2/rules/proposals/route");
    return POST(zadanie("/rules/proposals", { metoda: "POST", token, cialo }), undefined);
  }
  async function reguly(query = "", token = ro.token) {
    const { GET } = await import("@/app/api/v2/rules/route");
    return GET(zadanie(`/rules${query}`, { token }), undefined);
  }
  async function hipoteza(cialo: Record<string, unknown>, token = pelny.token) {
    const { POST } = await import("@/app/api/v2/hypotheses/route");
    return POST(zadanie("/hypotheses", { metoda: "POST", token, cialo }), undefined);
  }

  describe("propozycje", () => {
    it("mentor: bez progu n, podpisana «wg mentora, n = 0», status proponowana", async () => {
      const res = await zaproponuj({ title: t("Nie wchodzę po 11:00"), textMd: "Po 11:00 nie otwieram nowych pozycji.", origin: "mentor", evidence: DOWOD });
      expect(res.status).toBe(201);
      const dane = await res.json();
      expect(dane.status).toBe("proposed");
      expect(dane.n).toBe(0);
      expect(dane.signature).toBe("wg mentora, n = 0");
      expect(dane.rule).toMatch(/^R-\d{3,}$/);
      expect(dane.note).toContain("użytkownik");

      const lista = await (await reguly("?status=proposed")).json();
      const r = lista.rules.find((x: { code: string }) => x.code === dane.rule);
      expect(r.status).toBe("proposed");
      expect(r.proposal.podpis).toBe("wg mentora, n = 0");
      expect(r.current).toBeNull();
    });

    it("mentor bez cytatu (evidence) = 400", async () => {
      const res = await zaproponuj({ title: t("Bez cytatu"), textMd: "x", origin: "mentor" });
      expect(res.status).toBe(400);
      expect((await res.json()).errors[0]).toContain("evidence");
    });

    it("import z sejfu: reguła «zatwierdzona» w sejfie wchodzi jako PROPOZYCJA, status z sejfu tylko jako informacja", async () => {
      const res = await zaproponuj({
        title: t("R-004 z sejfu"),
        textMd: "Stop loss nigdy nie przesuwa się w stronę ceny.",
        origin: "vault-import",
        vaultStatus: "zatwierdzona",
        externalRef: `vault:Reguly/${znacznik}-R-004.md`,
        hard: true,
      });
      expect(res.status).toBe(201);
      const dane = await res.json();
      expect(dane.status).toBe("proposed");
      expect(dane.signature).toContain("import z sejfu");

      const lista = await (await reguly("?status=all")).json();
      const r = lista.rules.find((x: { code: string }) => x.code === dane.rule);
      expect(r.status).toBe("proposed"); // NIE active
      expect(r.vaultStatus).toBe("zatwierdzona");
      expect(r.hard).toBe(true);
      expect(r.current).toBeNull();
      const [w] = await sql`select status, origin, ruleset_version from rule_versions rv join rules r on r.id = rv.rule_id where r.code = ${dane.rule}`;
      expect(w).toMatchObject({ status: "proposed", origin: "vault-import", ruleset_version: null });
    });

    it("powtórny import tej samej reguły nie mnoży propozycji (200, ta sama wersja)", async () => {
      const cialo = { title: t("Powtórny import"), textMd: "Treść.", origin: "vault-import", externalRef: `vault:Reguly/${znacznik}-powtorka.md` };
      const a = await (await zaproponuj(cialo)).json();
      const res = await zaproponuj(cialo);
      expect(res.status).toBe(200);
      const b = await res.json();
      expect(b.created).toBe(false);
      expect([b.rule, b.version]).toEqual([a.rule, a.version]);
      const [{ ile }] = await sql`select count(*)::int as ile from rule_versions rv join rules r on r.id = rv.rule_id where r.code = ${a.rule}`;
      expect(ile).toBe(1);
    });

    it("druga propozycja do reguły z oczekującą = 409 (jedna naraz)", async () => {
      const a = await (await zaproponuj({ title: t("Jedna naraz"), textMd: "v1", origin: "mentor", evidence: DOWOD })).json();
      const res = await zaproponuj({ ruleCode: a.rule, textMd: "v2", origin: "mentor", evidence: DOWOD });
      expect(res.status).toBe(409);
      const dane = await res.json();
      expect(dane.code).toBe("proposal_pending");
      expect(dane.pendingVersion).toBe(1);
    });

    it("propozycja do nieistniejącej reguły = 404", async () => {
      const res = await zaproponuj({ ruleCode: "R-998877", textMd: "x", origin: "mentor", evidence: DOWOD });
      expect(res.status).toBe(404);
    });

    it("nowa wersja istniejącej reguły po decyzji użytkownika dostaje kolejny numer", async () => {
      const a = await (await zaproponuj({ title: t("Wersjonowana"), textMd: "v1", origin: "mentor", evidence: DOWOD })).json();
      // Użytkownik odrzuca w UI (aktor 'ui'), więc można zgłosić następną.
      await sql.begin(async (tx) => {
        await tx`select set_config('tj.actor', 'ui', true)`;
        await tx`update rule_versions set status = 'rejected', decided_at = now() where rule_id = (select id from rules where code = ${a.rule})`;
      });
      const res = await zaproponuj({ ruleCode: a.rule, textMd: "v2", origin: "mentor", evidence: DOWOD });
      expect(res.status).toBe(201);
      expect((await res.json()).version).toBe(2);
    });

    it("ta sama treść po odrzuceniu przez użytkownika = 409 previously_rejected z decidedAt (nie 200 «unchanged»)", async () => {
      const cialo = { title: t("Odrzucona i wracająca"), textMd: "Treść, którą użytkownik odrzucił.", origin: "mentor", evidence: DOWOD };
      const a = await (await zaproponuj(cialo)).json();
      await sql.begin(async (tx) => {
        await tx`select set_config('tj.actor', 'ui', true)`;
        await tx`update rule_versions set status = 'rejected', decided_at = now() where rule_id = (select id from rules where code = ${a.rule})`;
      });
      const res = await zaproponuj({ ruleCode: a.rule, textMd: cialo.textMd, origin: "mentor", evidence: DOWOD });
      expect(res.status).toBe(409);
      const d = await res.json();
      expect(d.code).toBe("previously_rejected");
      expect(d.version).toBe(1);
      expect(new Date(d.decidedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
      const [{ ile }] = await sql`select count(*)::int as ile from rule_versions rv join rules r on r.id = rv.rule_id where r.code = ${a.rule}`;
      expect(ile).toBe(1);
    });

    it("powtórzenie treści zatwierdzonej wersji zwraca jej PRAWDZIWY status (approved), nie «proposed»", async () => {
      const cialo = { title: t("Zatwierdzona i powtarzana"), textMd: "Treść zatwierdzona.", origin: "mentor", evidence: DOWOD };
      const a = await (await zaproponuj(cialo)).json();
      await sql.begin(async (tx) => {
        await tx`select set_config('tj.actor', 'ui', true)`;
        await tx`update rule_versions set status = 'approved', ruleset_version = 1, decided_at = now() where rule_id = (select id from rules where code = ${a.rule})`;
      });
      const res = await zaproponuj({ ruleCode: a.rule, textMd: cialo.textMd, origin: "mentor", evidence: DOWOD });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.status).toBe("approved");
      expect(d.created).toBe(false);
      expect(d.note).toContain("approved");
    });

    it("powtórzenie starszej odrzuconej treści jest wykrywane także wtedy, gdy najnowsza wersja jest inna", async () => {
      const a = await (await zaproponuj({ title: t("Starsza odrzucona"), textMd: "v1", origin: "mentor", evidence: DOWOD })).json();
      const ui = (sqlTx: string) =>
        sql.begin(async (tx) => {
          await tx`select set_config('tj.actor', 'ui', true)`;
          await tx.unsafe(sqlTx.replace("$RULE", a.rule));
        });
      await ui("update rule_versions set status = 'rejected', decided_at = now() where rule_id = (select id from rules where code = '$RULE')");
      expect((await zaproponuj({ ruleCode: a.rule, textMd: "v2", origin: "mentor", evidence: DOWOD })).status).toBe(201);
      const res = await zaproponuj({ ruleCode: a.rule, textMd: "v1", origin: "mentor", evidence: DOWOD });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("previously_rejected");
    });

    it("tytuł zajęty przy nowej regule = 409, bez osieroconej notatki", async () => {
      await zaproponuj({ title: t("Zajęty tytuł reguły"), textMd: "x", origin: "mentor", evidence: DOWOD });
      const res = await zaproponuj({ title: t("ZAJETY TYTUL REGULY"), textMd: "y", origin: "mentor", evidence: DOWOD });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("title_taken");
    });

    it("nieznane pola i próba przekazania statusu są odrzucone (strictObject)", async () => {
      const res = await zaproponuj({ title: t("Z statusem"), textMd: "x", origin: "mentor", evidence: DOWOD, status: "approved" });
      expect(res.status).toBe(400);
      expect((await res.json()).errors[0]).toContain("status");
    });
  });

  describe("propozycje AI: kontrargument, dowody i próg n", () => {
    async function nowaHipoteza(nImported: number, progN = 20) {
      const res = await hipoteza({ title: t(`Hipoteza n${nImported}`), progN, nImported, bodyMd: "Czy sweep low + FVG działa?", origin: "vault-import", externalRef: `vault:Hipotezy/${znacznik}-n${nImported}.md` });
      expect(res.status).toBe(201);
      return (await res.json()) as { id: number; code: string };
    }

    it("AI bez kontrargumentu, dowodów i hipotezy = 400 z nazwą brakującego pola", async () => {
      const res = await zaproponuj({ title: t("AI gołe"), textMd: "x", origin: "ai" });
      expect(res.status).toBe(400);
      const dane = await res.json();
      expect(dane.errors.join(" ")).toContain("counterargument");
      expect(dane.errors.join(" ")).toContain("hypothesisId");
    });

    it("AI poniżej progu n = 422 below_threshold z faktycznymi liczbami", async () => {
      const h = await nowaHipoteza(12);
      const res = await zaproponuj({ title: t("AI za wcześnie"), textMd: "x", origin: "ai", counterargument: "Próba za mała.", evidence: { n: 12 }, hypothesisId: h.id });
      expect(res.status).toBe(422);
      const dane = await res.json();
      expect(dane.code).toBe("below_threshold");
      expect(dane.n).toBe(12);
      expect(dane.progN).toBe(20);
      expect(dane.error).toContain("n = 12");
      const [{ ile }] = await sql`select count(*)::int as ile from notes where title = ${t("AI za wcześnie")}`;
      expect(ile).toBe(0); // żadnej osieroconej notatki
    });

    it("AI na progu n przechodzi i dostaje podpis z kontrargumentem w bazie", async () => {
      const h = await nowaHipoteza(25);
      const res = await zaproponuj({ title: t("AI w terminie"), textMd: "Wchodzę tylko po sweepie.", origin: "ai", counterargument: "Edge może wynikać z jednego reżimu rynku.", evidence: { n: 25, level: "tested" }, hypothesisId: h.id });
      expect(res.status).toBe(201);
      const dane = await res.json();
      expect(dane.n).toBe(25);
      expect(dane.signature).toBe("propozycja AI");
      const [w] = await sql`select counterargument, hypothesis_id, status from rule_versions rv join rules r on r.id = rv.rule_id where r.code = ${dane.rule}`;
      expect(w).toMatchObject({ counterargument: "Edge może wynikać z jednego reżimu rynku.", hypothesis_id: h.id, status: "proposed" });
    });

    it("nieistniejąca hipoteza = 404", async () => {
      const res = await zaproponuj({ title: t("AI bez hipotezy"), textMd: "x", origin: "ai", counterargument: "k", evidence: { v: 1 }, hypothesisId: 999_999_999 });
      expect(res.status).toBe(404);
    });

    it("mentor i import nie mogą podać hipotezy (nie mają progu)", async () => {
      const h = await nowaHipoteza(30);
      const res = await zaproponuj({ title: t("Mentor z hipotezą"), textMd: "x", origin: "mentor", evidence: DOWOD, hypothesisId: h.id });
      expect(res.status).toBe(400);
    });

    it("baza powtarza bramkę n: INSERT z pominięciem API też daje TJ422", async () => {
      const h = await nowaHipoteza(3);
      const [nota] = await sql`insert into notes (kind, slug, title, origin) values ('rule', ${`bramka-${znacznik}`}, ${t("Bramka SQL")}, 'ai') returning id`;
      const [r] = await sql`insert into rules (code, note_id) values (${`R-${900000 + Math.floor(Math.random() * 90000)}`}, ${nota.id}) returning id`;
      await expect(
        sql`insert into rule_versions (rule_id, version, text_md, status, origin, counterargument, evidence, hypothesis_id)
            values (${r.id}, 1, 'x', 'proposed', 'ai', 'k', '{"n":3}'::jsonb, ${h.id})`,
      ).rejects.toMatchObject({ code: "TJ422" });
      await sql`delete from rules where id = ${r.id}`;
      await sql`delete from notes where id = ${nota.id}`;
    });
  });

  describe("walidacja pochodzenia i progu n (Słowa użytkownika 15.10.2026: «Walidacja danych»)", () => {
    const bledy = async (res: Response) => ((await res.json()).errors as string[]).join(" | ");

    it("evidence mentora jest ścisłe: video, t i quote, wszystkie niepuste, bez dodatkowych pól", async () => {
      const baza = { title: t("Mentor ścisły"), textMd: "x", origin: "mentor" };
      const zle: Record<string, unknown>[] = [
        { video: "yt", t: 1 }, // brak quote
        { video: "", t: 1, quote: "q" },
        { video: "yt", t: "", quote: "q" },
        { video: "yt", t: 1, quote: "   " },
        { t: 1, quote: "q" },
        { video: "yt", t: 1, quote: "q", dodatkowe: 1 },
        { v: 1 },
        {},
      ];
      for (const evidence of zle) {
        const res = await zaproponuj({ ...baza, evidence });
        expect(res.status, JSON.stringify(evidence)).toBe(400);
        expect(await bledy(res)).toContain("evidence");
      }
      const [{ ile }] = await sql`select count(*)::int as ile from notes where title = ${baza.title}`;
      expect(ile).toBe(0);
      expect((await zaproponuj({ ...baza, evidence: { video: "yt", t: "12:34", quote: "q" } })).status).toBe(201);
    });

    it("vault-import bez externalRef «vault:» jest traktowany jak ai: wymaga kontrargumentu, dowodów i hipotezy", async () => {
      for (const extra of [{ externalRef: "inny:klucz" }, {}]) {
        const res = await zaproponuj({ title: t("Fałszywy import"), textMd: "x", origin: "vault-import", ...extra });
        expect(res.status).toBe(400);
        const b = await bledy(res);
        expect(b).toContain("counterargument");
        expect(b).toContain("hypothesisId");
      }
    });

    it("vault-import bez «vault:» podlega progowi n jak ai: 422 poniżej progu, a po przejściu zapisuje się jako ai", async () => {
      const wolna = await (await hipoteza({ title: t("H mało danych"), nImported: 0 })).json();
      const cialo = { textMd: "Reguła od agenta podszywającego się pod import.", origin: "vault-import", counterargument: "k", evidence: { n: 0 } };
      const za = await zaproponuj({ ...cialo, title: t("Podszycie importu"), hypothesisId: wolna.id });
      expect(za.status).toBe(422);
      expect((await za.json()).code).toBe("below_threshold");

      const pelna = await (await hipoteza({ title: t("H n=25"), nImported: 25, origin: "vault-import", externalRef: `vault:Hipotezy/${znacznik}-25.md` })).json();
      const ok = await zaproponuj({ ...cialo, title: t("Podszycie importu 2"), hypothesisId: pelna.id, externalRef: "nie-vault:x" });
      expect(ok.status).toBe(201);
      const d = await ok.json();
      expect(d.signature).toBe("propozycja AI");
      const [w] = await sql`select rv.origin, n.origin as nota from rule_versions rv join rules r on r.id = rv.rule_id join notes n on n.id = r.note_id where r.code = ${d.rule}`;
      expect(w).toMatchObject({ origin: "ai", nota: "ai" });
    });

    it("vaultStatus tylko przy vault-import z kluczem vault:", async () => {
      expect((await zaproponuj({ title: t("Status mentora"), textMd: "x", origin: "mentor", evidence: DOWOD, vaultStatus: "zatwierdzona" })).status).toBe(400);
      const res = await zaproponuj({ title: t("Status bez klucza"), textMd: "x", origin: "vault-import", vaultStatus: "zatwierdzona", externalRef: "x:y", counterargument: "k", evidence: { n: 1 }, hypothesisId: 1 });
      expect(res.status).toBe(400);
      expect(await bledy(res)).toContain("vaultStatus");
      expect((await zaproponuj({ title: t("Status poprawny"), textMd: "x", origin: "vault-import", vaultStatus: "zatwierdzona", externalRef: `vault:Reguly/${znacznik}-st.md` })).status).toBe(201);
    });

    it("hipoteza: nImported > 0 tylko przy vault-import z kluczem vault:", async () => {
      for (const cialo of [
        { title: t("n bez importu"), nImported: 10 },
        { title: t("n mentor"), nImported: 10, origin: "mentor" },
        { title: t("n import bez klucza"), nImported: 10, origin: "vault-import" },
        { title: t("n import zły klucz"), nImported: 10, origin: "vault-import", externalRef: "x:y" },
      ]) {
        const res = await hipoteza(cialo);
        expect(res.status, JSON.stringify(cialo)).toBe(400);
        expect(await bledy(res)).toContain("nImported");
      }
      expect((await hipoteza({ title: t("n zero ok"), nImported: 0 })).status).toBe(201);
      expect((await hipoteza({ title: t("n z sejfu ok"), nImported: 10, origin: "vault-import", externalRef: `vault:Hipotezy/${znacznik}-ok.md` })).status).toBe(201);
    });

    it("hipoteza: progN przez API nie niższy niż 20 (niższy ustawia tylko UI); domyślnie 20", async () => {
      for (const progN of [1, 5, 19, 0, -3]) {
        const res = await hipoteza({ title: t(`prog ${progN}`), progN });
        expect(res.status, `progN=${progN}`).toBe(400);
        expect(await bledy(res)).toContain("20");
      }
      const dom = await (await hipoteza({ title: t("prog domyślny") })).json();
      const [h] = await sql`select prog_n from hypotheses where id = ${dom.id}`;
      expect(h.prog_n).toBe(20);
      const wysoki = await (await hipoteza({ title: t("prog 50"), progN: 50 })).json();
      expect((await sql`select prog_n from hypotheses where id = ${wysoki.id}`)[0].prog_n).toBe(50);
    });

    it("notatka z origin vault-import bez klucza vault: zapisuje się jako ai (z kluczem zostaje vault-import)", async () => {
      const { POST } = await import("@/app/api/v2/notes/route");
      const wyslij = async (title: string, extra: Record<string, unknown>) =>
        (await (await POST(zadanie("/notes", { metoda: "POST", token: pelny.token, cialo: { kind: "concept", title, origin: "vault-import", ...extra } }), undefined)).json()) as { origin: string };
      expect((await wyslij(t("Notatka bez klucza"), {})).origin).toBe("ai");
      expect((await wyslij(t("Notatka zły klucz"), { externalRef: "inny:1" })).origin).toBe("ai");
      expect((await wyslij(t("Notatka z sejfu"), { externalRef: `vault:Pojecia/${znacznik}.md` })).origin).toBe("vault-import");
    });
  });

  describe("agent NIE zatwierdza reguły: trzy niezależne warstwy", () => {
    it("warstwa 1: zakresu «approve» nie ma ani w kodzie, ani w bazie (CHECK)", async () => {
      await expect(
        sql`insert into api_tokens (name, prefix, token_sha256, scopes, created_via) values ('x', 'abcdefgh', ${"0".repeat(64)}, ${["read", "approve"]}, 'device_code')`,
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        sql`insert into device_codes (device_code_sha256, user_code, client_name, requested_scopes, expires_at)
            values (${"1".repeat(64)}, 'BCDF-GHJK', 'x', ${["approve"]}, now() + interval '10 minutes')`,
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("warstwa 1b: token bez zakresu propose nie złoży nawet propozycji (403 z nazwą zakresu)", async () => {
      const res = await zaproponuj({ title: t("Bez propose"), textMd: "x", origin: "mentor", evidence: DOWOD }, bezPropose.token);
      expect(res.status).toBe(403);
      expect((await res.json()).missingScope).toBe("propose");
    });

    it("warstwa 2: próba przestawienia statusu przez body trasy propozycji nie działa; brak trasy zatwierdzającej pilnuje guard.test.ts", async () => {
      const a = await (await zaproponuj({ title: t("Do zatwierdzenia"), textMd: "x", origin: "mentor", evidence: DOWOD })).json();
      const proba = await zaproponuj({ ruleCode: a.rule, textMd: "y", origin: "mentor", evidence: DOWOD, status: "approved", approved: true });
      expect(proba.status).toBe(400);
      const [w] = await sql`select status from rule_versions rv join rules r on r.id = rv.rule_id where r.code = ${a.rule} and rv.version = 1`;
      expect(w.status).toBe("proposed");
    });

    it("warstwa 3: trigger odrzuca zatwierdzenie od aktora api:<id> i od zapisu bez aktora (TJ403), przepuszcza 'ui'", async () => {
      const a = await (await zaproponuj({ title: t("Trigger"), textMd: "x", origin: "mentor", evidence: DOWOD })).json();
      const zatwierdz = (aktor: string | null) =>
        sql.begin(async (tx) => {
          if (aktor) await tx`select set_config('tj.actor', ${aktor}, true)`;
          await tx`update rule_versions set status = 'approved', ruleset_version = 1, decided_at = now() where rule_id = (select id from rules where code = ${a.rule})`;
        });
      await expect(zatwierdz(`api:${pelny.id}`)).rejects.toMatchObject({ code: "TJ403" });
      await expect(zatwierdz("import")).rejects.toMatchObject({ code: "TJ403" });
      await expect(zatwierdz(null)).rejects.toMatchObject({ code: "TJ403" });
      const [przed] = await sql`select status from rule_versions rv join rules r on r.id = rv.rule_id where r.code = ${a.rule}`;
      expect(przed.status).toBe("proposed");

      await zatwierdz("ui"); // użytkownik w aplikacji: jedyna droga
      const lista = await (await reguly()).json();
      const r = lista.rules.find((x: { code: string }) => x.code === a.rule);
      expect(r.status).toBe("active");
      expect(r.current.rulesetVersion).toBe(1);
    });

    it("warstwa 3 przez bramkę HTTP: błąd we własnym kodzie handlera kończy się 403, nie sukcesem", async () => {
      const a = await (await zaproponuj({ title: t("Przez HTTP"), textMd: "x", origin: "vault-import", vaultStatus: "zatwierdzona", externalRef: `vault:Reguly/${znacznik}-http.md` })).json();
      const { withApi } = await import("./with-api");
      const res = await withApi({ scopes: ["propose"] }, async (_r, api) => {
        await api.zapis((tx) =>
          tx.execute(dsql`update rule_versions set status = 'approved', ruleset_version = 1 where rule_id = (select id from rules where code = ${a.rule})`),
        );
        return Response.json({ ok: true });
      })(zadanie("/x", { token: pelny.token }), undefined);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("approval_forbidden");
    });

    it("agent nie cofnie też odrzucenia ani nie zastąpi wersji (wyjście ze stanu strzeżonego też wymaga 'ui')", async () => {
      const a = await (await zaproponuj({ title: t("Zastąpienie"), textMd: "x", origin: "mentor", evidence: DOWOD })).json();
      await sql.begin(async (tx) => {
        await tx`select set_config('tj.actor', 'ui', true)`;
        await tx`update rule_versions set status = 'rejected', decided_at = now() where rule_id = (select id from rules where code = ${a.rule})`;
      });
      await expect(
        sql.begin(async (tx) => {
          await tx`select set_config('tj.actor', ${`api:${pelny.id}`}, true)`;
          await tx`update rule_versions set status = 'proposed' where rule_id = (select id from rules where code = ${a.rule})`;
        }),
      ).rejects.toMatchObject({ code: "TJ403" });
    });

    it("treść wersji reguły nie zmienia się nigdy: UPDATE text_md daje TJ409 nawet od 'ui'", async () => {
      const a = await (await zaproponuj({ title: t("Niezmienna treść"), textMd: "oryginał", origin: "mentor", evidence: DOWOD })).json();
      await expect(
        sql.begin(async (tx) => {
          await tx`select set_config('tj.actor', 'ui', true)`;
          await tx`update rule_versions set text_md = 'podmiana' where rule_id = (select id from rules where code = ${a.rule})`;
        }),
      ).rejects.toMatchObject({ code: "TJ409" });
    });
  });

  describe("hipotezy i lista reguł", () => {
    it("hipoteza: n = n_imported, faza wyliczana z progu (zbieranie / do oceny), decyzja 'active'", async () => {
      const a = await (await hipoteza({ title: t("Zbieranie"), progN: 20, nImported: 5, origin: "vault-import", externalRef: `vault:Hipotezy/${znacznik}-zb.md` })).json();
      const b = await (await hipoteza({ title: t("Do oceny"), progN: 20, nImported: 20, origin: "vault-import", externalRef: `vault:Hipotezy/${znacznik}-do.md` })).json();
      expect(a.code).toMatch(/^H-\d{3,}$/);
      expect(b.code).not.toBe(a.code);
      const { GET } = await import("@/app/api/v2/hypotheses/route");
      const lista = await (await GET(zadanie("/hypotheses", { token: ro.token }), undefined)).json();
      const ha = lista.hypotheses.find((x: { id: number }) => x.id === a.id);
      const hb = lista.hypotheses.find((x: { id: number }) => x.id === b.id);
      expect(ha).toMatchObject({ n: 5, progN: 20, phase: "zbieranie", decision: "active" });
      expect(hb).toMatchObject({ n: 20, progN: 20, phase: "do_oceny", decision: "active" });
    });

    it("agent nie potwierdzi hipotezy: decision != 'active' tylko z UI (TJ403)", async () => {
      const h = await (await hipoteza({ title: t("Potwierdzana"), nImported: 30, origin: "vault-import", externalRef: `vault:Hipotezy/${znacznik}-pot.md` })).json();
      await expect(
        sql.begin(async (tx) => {
          await tx`select set_config('tj.actor', ${`api:${pelny.id}`}, true)`;
          await tx`update hypotheses set decision = 'confirmed', decided_at = now() where id = ${h.id}`;
        }),
      ).rejects.toMatchObject({ code: "TJ403" });
    });

    it("powtórne założenie hipotezy z tym samym externalRef zwraca istniejącą (200)", async () => {
      const cialo = { title: t("Z sejfu H"), externalRef: `vault:Hipotezy/${znacznik}.md`, nImported: 7, origin: "vault-import" };
      const a = await hipoteza(cialo);
      const b = await hipoteza(cialo);
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      expect((await b.json()).created).toBe(false);
    });

    it("GET /rules zwraca rulesVersion i filtruje po statusie (na niepustych listach, nie na pustce)", async () => {
      // Dane własne testu: jedna aktywna i jedna proponowana reguła, żeby «every» nie przechodziło na pustej liście.
      const aktywna = await (await zaproponuj({ title: t("Do filtra aktywna"), textMd: "a", origin: "mentor", evidence: DOWOD })).json();
      await sql.begin(async (tx) => {
        await tx`select set_config('tj.actor', 'ui', true)`;
        await tx`update rule_versions set status = 'approved', ruleset_version = 1, decided_at = now() where rule_id = (select id from rules where code = ${aktywna.rule})`;
      });
      const oczekujaca = await (await zaproponuj({ title: t("Do filtra oczekująca"), textMd: "b", origin: "mentor", evidence: DOWOD })).json();

      const wszystkie = await (await reguly()).json();
      expect(wszystkie.rulesVersion).toBeGreaterThanOrEqual(0);
      const proponowane = await (await reguly("?status=proposed")).json();
      expect(proponowane.rules.length).toBeGreaterThan(0);
      expect(proponowane.rules.map((r: { code: string }) => r.code)).toContain(oczekujaca.rule);
      expect(proponowane.rules.map((r: { code: string }) => r.code)).not.toContain(aktywna.rule);
      expect(proponowane.rules.every((r: { pendingProposal: boolean }) => r.pendingProposal)).toBe(true);
      const aktywne = await (await reguly("?status=active")).json();
      expect(aktywne.rules.length).toBeGreaterThan(0);
      expect(aktywne.rules.map((r: { code: string }) => r.code)).toContain(aktywna.rule);
      expect(aktywne.rules.every((r: { status: string }) => r.status === "active")).toBe(true);
      expect((await reguly("?status=zatwierdzone")).status).toBe(400);
    });
  });
});
