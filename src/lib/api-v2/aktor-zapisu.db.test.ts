import { rm } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, parametry, polacz, sprzatnijPoTokenach, unikalnyIp, zadanie, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * ADR-030: KAZDY zapis v2 idzie w transakcji z `tj.actor = api:<id tokenu>`
 * (uzytkownik 15.10.2026: «Wymog zostaje, poprawiamy»). Dowod: na tabelach, do
 * ktorych pisza trasy, stoi tymczasowy trigger odrzucajacy zapis bez takiego aktora.
 * Gdy trasa pisze poza `api.zapis`, trigger rzuca i test jest czerwony.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("kazdy zapis v2 niesie tj.actor (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let kontoId = 0;
  const znacznik = Date.now().toString(36);
  const DZIEN = "1991-05-14";
  const TABELE = ["trades", "trade_exits", "trade_reviews", "trade_rule_checks", "ingest_skips", "backtest_sessions", "screenshots", "day_notes"];

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
    rw = await nowyToken(sql, ["read", "write"]);
    const [k] = await sql`insert into accounts (name, type) values (${`AKTOR-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
    await sql.unsafe(`
      create or replace function tj_test_wymagaj_aktora() returns trigger language plpgsql as $$
      begin
        if coalesce(current_setting('tj.actor', true), '') not like 'api:%' then
          raise exception 'zapis do % bez tj.actor (aktor: %)', TG_TABLE_NAME, coalesce(current_setting('tj.actor', true), '(brak)') using errcode = 'TJ403';
        end if;
        return coalesce(new, old);
      end $$`);
    for (const t of TABELE) {
      await sql.unsafe(`create trigger tj_test_aktor before insert or update on ${t} for each row execute function tj_test_wymagaj_aktora()`);
    }
  });
  afterAll(async () => {
    for (const t of TABELE) await sql.unsafe(`drop trigger if exists tj_test_aktor on ${t}`);
    await sql.unsafe("drop function if exists tj_test_wymagaj_aktora()");
    await sql`delete from trades where account_id = ${kontoId}`;
    await sql`delete from day_notes where day = ${DZIEN}`;
    await sql`delete from ingest_skips where external_ref like ${`%aktor-${znacznik}%`}`;
    await sql`delete from backtest_sessions where external_ref like ${`%aktor-${znacznik}%`}`;
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id]);
    await sql.end();
    await rm(`${process.env.UPLOADS_DIR ?? "./.dane/zrzuty"}`, { recursive: true, force: true }).catch(() => {});
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const trade = (nr: number) => ({
    externalRef: `fxr:aktor-${znacznik}-${nr}`,
    accountId: kontoId,
    symbol: "NQ1!",
    direction: "long",
    entryTime: `${DZIEN}T14:35:00Z`,
    entryPrice: 20000,
    contracts: 1,
    stopLoss: 19990,
    exits: [{ time: `${DZIEN}T14:50:00Z`, price: 20020 }],
  });
  const post = async (modul: string, sciezka: string, cialo: unknown, ctx?: unknown) => {
    const { POST } = (await import(/* @vite-ignore */ modul)) as { POST: (r: Request, c: unknown) => Promise<Response> };
    return POST(zadanie(sciezka, { metoda: "POST", token: rw.token, cialo }), ctx);
  };

  it("sanity: trigger testowy naprawdę blokuje zapis bez aktora", async () => {
    await expect(sql`insert into ingest_skips (external_ref, reason) values (${`tv:aktor-${znacznik}-sanity`}, 'client')`).rejects.toMatchObject({ code: "TJ403" });
  });

  it("POST /trades zapisuje trade, wyjscia (trade_exits) przez tx z aktorem", async () => {
    const res = await post("@/app/api/v2/trades/route", "/trades", { trades: [trade(1)] });
    const d = await res.json();
    expect(d.results[0].status, JSON.stringify(d)).toBe("created");
    const [w] = await sql`select (select count(*)::int from trade_exits where trade_id = t.id) as wyjscia from trades t where external_ref = ${trade(1).externalRef}`;
    expect(w.wyjscia).toBe(1);
  });

  it("POST /backtest-sessions", async () => {
    const res = await post("@/app/api/v2/backtest-sessions/route", "/backtest-sessions", { externalRef: `fxr:aktor-${znacznik}-s`, name: `Aktor ${znacznik}` });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("POST /skips", async () => {
    const res = await post("@/app/api/v2/skips/route", "/skips", { skips: [{ externalRef: `tv:aktor-${znacznik}-skip` }] });
    expect((await res.json()).results[0].status).toBe("recorded");
  });

  it("POST /trades/:id/reviews", async () => {
    const id = (await (await post("@/app/api/v2/trades/route", "/trades", { trades: [trade(2)] })).json()).results[0].id;
    const res = await post("@/app/api/v2/trades/[id]/reviews/route", `/trades/${id}/reviews`, { basis: "chart", ruleChecks: [{ ruleId: "R-007", ruleText: "x", verdict: "pass" }] }, parametry({ id: String(id) }));
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("POST /trades/:id/screenshots (wstawienie i zastapienie)", async () => {
    const id = (await (await post("@/app/api/v2/trades/route", "/trades", { trades: [trade(3)] })).json()).results[0].id;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#336699" } }).png().toBuffer();
    const { POST } = await import("@/app/api/v2/trades/[id]/screenshots/route");
    for (let i = 0; i < 2; i += 1) {
      const fd = new FormData();
      fd.append("shot", new File([new Uint8Array(png)], "a.png", { type: "image/png" }));
      fd.append("interval", "5m");
      const req = new Request(`http://localhost/api/v2/trades/${id}/screenshots`, {
        method: "POST",
        headers: { authorization: `Bearer ${rw.token}`, "x-forwarded-for": unikalnyIp() },
        body: fd,
      });
      const res = await POST(req, parametry({ id: String(id) }));
      expect(res.status, await res.clone().text()).toBe(200);
    }
    const [{ ile }] = await sql`select count(*)::int as ile from screenshots where trade_id = ${id}`;
    expect(ile).toBe(1);
  });

  it("PUT /days/:date", async () => {
    const { PUT } = await import("@/app/api/v2/days/[date]/route");
    const res = await PUT(zadanie(`/days/${DZIEN}`, { metoda: "PUT", token: rw.token, cialo: { accountId: kontoId, preSession: "plan" } }), parametry({ date: DZIEN }));
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("stare trasy /api/ingest tez piszą z aktorem 'ingest' (nie z pustym)", async () => {
    // trigger akceptuje tylko api:*, wiec ingest musi dostac 500 - dowod, ze aktor jest ustawiony na 'ingest', a nie pusty
    const { POST } = await import("@/app/api/ingest/skips/route");
    vi.stubEnv("INGEST_TOKEN_SHA256", "");
    const res = await POST(
      zadanie("/skips", { metoda: "POST", token: rw.token, baza: "http://localhost/api/ingest", cialo: { skips: [{ externalRef: `tv:aktor-${znacznik}-ing` }] } }),
      undefined,
    );
    expect(res.status).toBe(500);
    const [{ ile }] = await sql`select count(*)::int as ile from ingest_skips where external_ref = ${`tv:aktor-${znacznik}-ing`}`;
    expect(ile).toBe(0);
    vi.unstubAllEnvs();
  });
});
