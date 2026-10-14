import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

const DOWOD = { video: "yt123", t: 754, quote: "after eleven you are donating" };

/*
 * Reszta funkcji 2b na prawdziwej bazie: decyzje uzytkownika o regulach i setupach (modul UI),
 * filtr externalRef, eksport v2 bez kolumn `search` oraz zgodnosc zrodla danych TS z SQL.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("decyzje o regulach, externalRef, eksport i zrodlo danych (baza lokalna)", () => {
  let sql: Sql;
  let imp: Par;
  let rw: Par;
  let instrumentId = 0;
  const kontaId: number[] = [];
  let sesjaId = 0;
  const znacznik = unikat("dee");

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    imp = await nowyToken(sql, ["read", "write", "propose", "import"]);
    rw = await nowyToken(sql, ["read", "write", "propose"]);
  });
  afterAll(async () => {
    await sql`delete from trades where account_id = any(${kontaId})`;
    if (sesjaId) await sql`delete from backtest_sessions where id = ${sesjaId}`;
    await sprzatnijNowe(sql, [imp.id, rw.id]);
    await sql`delete from accounts where id = any(${kontaId})`;
    await sprzatnijPoTokenach(sql, [imp.id, rw.id]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const propozycja = (tytul: string, tekst = "Po 11:00 nie otwieram nowych pozycji.") =>
    wywolaj(import("@/app/api/v2/rules/proposals/route"), "POST", "/rules/proposals", { token: imp.token, cialo: { title: `${tytul} ${znacznik}`, textMd: tekst, origin: "mentor", evidence: DOWOD } });
  const wersjaId = async (kod: string) => (await sql`select rv.id from rule_versions rv join rules r on r.id = rv.rule_id where r.code = ${kod} order by rv.id desc limit 1`)[0].id as number;
  const zestaw = async () => (await sql`select ruleset_version as v from settings where id = 1`)[0].v as number;

  it("przyjecie reguly (UI): wersja approved, podbity zestaw, a API nie ma jak przyjac", async () => {
    const { przyjmijWersjeReguly } = await import("@/lib/decyzje/wersje");
    const p = await propozycja("Przyjmij");
    expect(p.status, JSON.stringify(p.json)).toBe(201);
    const id = await wersjaId(p.json.rule);
    const przed = await zestaw();
    const w = await przyjmijWersjeReguly(id);
    expect(w.ok, JSON.stringify(w)).toBe(true);
    const [po] = await sql`select status, ruleset_version, decided_at is not null as datowana from rule_versions where id = ${id}`;
    expect(po).toMatchObject({ status: "approved", ruleset_version: przed + 1, datowana: true });
    expect(await zestaw()).toBe(przed + 1);
    const drugi = await przyjmijWersjeReguly(id);
    expect(drugi.ok).toBe(false);
    expect(await zestaw()).toBe(przed + 1); // nieudana proba nie podbija zestawu
    expect((await przyjmijWersjeReguly(999999999)).ok).toBe(false);
  });

  it("przyjecie z poprawka: oryginal odrzucony, nowa wersja uzytkownika approved, tekst regula zapisany bajt w bajt; ten sam tekst = odmowa", async () => {
    const { przyjmijWersjeRegulyZPoprawka } = await import("@/lib/decyzje/wersje");
    const p = await propozycja("Poprawka", "Wersja mentora.");
    const id = await wersjaId(p.json.rule);
    expect((await przyjmijWersjeRegulyZPoprawka(id, "   ")).ok).toBe(false);
    expect((await przyjmijWersjeRegulyZPoprawka(id, "Wersja mentora.")).ok).toBe(false);
    const nowy = "Po 11:00 nie otwieram nowych pozycji,\r\nchyba że A+ setup. Zażółć 🙂 ";
    const w = await przyjmijWersjeRegulyZPoprawka(id, nowy);
    expect(w.ok, JSON.stringify(w)).toBe(true);
    const wersje = await sql`select id, status, origin, text_md from rule_versions where rule_id = (select rule_id from rule_versions where id = ${id}) order by version`;
    expect(wersje.map((x) => [x.status, x.origin])).toEqual([["rejected", "mentor"], ["approved", "user"]]);
    expect(wersje[1].text_md).toBe(nowy);
  });

  it("odrzucenie wymaga powodu; po odrzuceniu nie ma juz czego przyjac", async () => {
    const { odrzucWersjeReguly, przyjmijWersjeReguly } = await import("@/lib/decyzje/wersje");
    const p = await propozycja("Odrzuc");
    const id = await wersjaId(p.json.rule);
    expect((await odrzucWersjeReguly(id, "  ")).ok).toBe(false);
    expect((await sql`select status from rule_versions where id = ${id}`)[0].status).toBe("proposed");
    expect((await odrzucWersjeReguly(id, "Za ogólne.")).ok).toBe(true);
    const [po] = await sql`select status, decision_reason from rule_versions where id = ${id}`;
    expect(po).toEqual({ status: "rejected", decision_reason: "Za ogólne." });
    expect((await przyjmijWersjeReguly(id)).ok).toBe(false);
  });

  it("setup: propozycja AI zastepuje obowiazujaca dopiero po przyjeciu przez UI; odrzucenie wymaga powodu", async () => {
    const { przyjmijWersjeSetupu, odrzucWersjeSetupu } = await import("@/lib/decyzje/wersje");
    const nazwa = unikat("Setup do decyzji");
    const ai = { origin: "ai", counterargument: "Szum próby.", evidence: { n: 12 } };
    const z = await wywolaj(import("@/app/api/v2/setups/route"), "POST", "/setups", { token: rw.token, cialo: { name: nazwa, bodyMd: "x", ...ai, preconditions: [], entryChecklist: [{ id: "a", text: "A" }] } });
    expect(z.status, JSON.stringify(z.json)).toBe(201);
    const slug = z.json.slug as string;
    const [w1] = await sql`select sv.id, sv.status from setup_versions sv join setups s on s.id = sv.setup_id where s.slug = ${slug}`;
    expect(w1.status).toBe("proposed");
    expect((await odrzucWersjeSetupu(w1.id, "")).ok).toBe(false);
    expect((await przyjmijWersjeSetupu(w1.id)).ok).toBe(true);
    const n = await wywolaj(import("@/app/api/v2/setups/[slug]/versions/route"), "POST", `/setups/${slug}/versions`, { token: rw.token, cialo: { ...ai, entryChecklist: [{ id: "a", text: "A" }, { id: "b", text: "B" }] } }, PARAMS({ slug }));
    expect(n.status, JSON.stringify(n.json)).toBe(201);
    const [w2] = await sql`select sv.id from setup_versions sv join setups s on s.id = sv.setup_id where s.slug = ${slug} and sv.status = 'proposed'`;
    expect((await sql`select status from setup_versions where id = ${w1.id}`)[0].status).toBe("approved"); // propozycja nie rusza obowiazujacej
    expect((await przyjmijWersjeSetupu(w2.id)).ok).toBe(true);
    expect((await sql`select status from setup_versions where id = ${w1.id}`)[0].status).toBe("superseded");
    expect((await przyjmijWersjeSetupu(w2.id)).ok).toBe(false);
  });

  it("externalRef: filtr list regul i hipotez zwraca tylko dopasowane wpisy (i pusta liste dla nieznanego)", async () => {
    const ref = `vault:Reguly/${znacznik}-filtr.md`;
    const r = await wywolaj(import("@/app/api/v2/rules/proposals/route"), "POST", "/rules/proposals", { token: imp.token, cialo: { title: `Filtr ${znacznik}`, textMd: "t", origin: "vault-import", externalRef: ref } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    await propozycja("Inna reguła bez refa");
    const l = await wywolaj(import("@/app/api/v2/rules/route"), "GET", `/rules?status=all&externalRef=${encodeURIComponent(ref)}`, { token: imp.token });
    expect(l.status).toBe(200);
    expect(l.json.rules.map((x: { code: string }) => x.code)).toEqual([r.json.rule]);
    const pusta = await wywolaj(import("@/app/api/v2/rules/route"), "GET", `/rules?status=all&externalRef=${encodeURIComponent("vault:nie-ma")}`, { token: imp.token });
    expect(pusta.json.rules).toEqual([]);

    const hRef = `vault:Hipotezy/${znacznik}-filtr.md`;
    const h = await wywolaj(import("@/app/api/v2/hypotheses/route"), "POST", "/hypotheses", { token: imp.token, cialo: { title: `Hip ${znacznik}`, origin: "vault-import", externalRef: hRef, nImported: 5 } });
    expect(h.status, JSON.stringify(h.json)).toBe(201);
    const hl = await wywolaj(import("@/app/api/v2/hypotheses/route"), "GET", `/hypotheses?externalRef=${encodeURIComponent(hRef)}`, { token: imp.token });
    expect(hl.json.hypotheses.map((x: { code: string }) => x.code)).toEqual([h.json.code]);
    const hAll = await wywolaj(import("@/app/api/v2/hypotheses/route"), "GET", "/hypotheses", { token: imp.token });
    expect(hAll.json.hypotheses.length).toBeGreaterThan(1 - 1);
    expect((await wywolaj(import("@/app/api/v2/hypotheses/route"), "GET", `/hypotheses?externalRef=${encodeURIComponent("vault:nie-ma")}`, { token: imp.token })).json.hypotheses).toEqual([]);
  });

  it("eksport v2 zawiera tabele funkcji 2b, a wygenerowanej kolumny search nie ma w zadnym wierszu", async () => {
    await propozycja("Do eksportu");
    const { pobierzTabeleV2 } = await import("@/lib/export/tabele-v2");
    const t = (await pobierzTabeleV2()) as Record<string, unknown[]>;
    expect(Object.keys(t).length).toBeGreaterThanOrEqual(20);
    const wiersze = Object.values(t).flat() as Record<string, unknown>[];
    expect(wiersze.length).toBeGreaterThan(0);
    expect(wiersze.some((w) => "search" in w)).toBe(false);
    expect(t.notes?.length ?? 0).toBeGreaterThan(0);
  });

  it("zrodlo danych: funkcja TS i wyrazenie SQL daja to samo dla kazdej kombinacji sesji i typu konta", async () => {
    const { zrodloDanych, sqlZrodloDanych } = await import("@/lib/domain/zrodla");
    const { sql: dsql } = await import("drizzle-orm");
    const { db } = await import("@/lib/db");
    const typy = ["live", "demo", "prop", "paper"] as const;
    const rodzaje = [null, "backtest", "forward"] as const;
    const oczekiwane = new Map<number, string>();
    for (const typ of typy) {
      const [k] = await sql`insert into accounts (name, type) values (${`ZR-${znacznik}-${typ}`}, ${typ}) returning id`;
      kontaId.push(k.id);
      for (const rodzaj of rodzaje) {
        let sid: number | null = null;
        if (rodzaj) {
          const [s] = await sql`insert into backtest_sessions (name, kind) values (${`ZRS-${znacznik}-${typ}-${rodzaj}`}, ${rodzaj}) returning id`;
          sid = s.id;
          sesjaId = sesjaId || s.id; // sprzatanie: trade'y znikaja z kontem, sesje czyscimy po nazwie
        }
        const id = await wstawTrade(sql, { kontoId: k.id, instrumentId, dzien: "1981-03-03", sesjaId: sid });
        oczekiwane.set(id, zrodloDanych({ rodzajSesji: rodzaj, wSesji: sid !== null, typKonta: typ }));
      }
    }
    const ids = [...oczekiwane.keys()];
    const wynik = await db.execute<{ id: number; zrodlo: string }>(dsql`
      select t.id, ${sqlZrodloDanych({ backtestSessionId: dsql`t.backtest_session_id`, rodzajSesji: dsql`bs.kind`, typKonta: dsql`a.type` })} as zrodlo
      from trades t join accounts a on a.id = t.account_id left join backtest_sessions bs on bs.id = t.backtest_session_id
      where t.id in (${dsql.join(ids.map((i) => dsql`${i}`), dsql`, `)})`);
    expect(wynik.length).toBe(12);
    for (const w of wynik) expect(w.zrodlo, `trade ${w.id}`).toBe(oczekiwane.get(Number(w.id)));
    expect(new Set(wynik.map((w) => w.zrodlo))).toEqual(new Set(["backtest", "forward", "demo", "live"]));
    await sql`delete from trades where account_id = any(${kontaId})`;
    await sql`delete from backtest_sessions where name like ${`ZRS-${znacznik}-%`}`;
  });
});
