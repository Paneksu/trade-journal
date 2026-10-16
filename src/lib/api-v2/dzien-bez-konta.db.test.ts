import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import sharp from "sharp";

import { PARAMS, wywolaj, wywolajMultipart } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Notatka dnia jest jedna i bez konta (ADR-033; Słowa użytkownika 16.10.2026: «Tak, zawsze jedna»). PUT /days/:date
 * z accountId i załącznik dnia z ?accountId= dostają 422 z komunikatem, zamiast po cichu tworzyć drugi wpis dnia.
 * Zapis bez konta trafia w jedyny wiersz dnia; notatka sesji backtestu zostaje osobna.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("notatka dnia bez konta w API v2 (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let kontoId = 0;
  let sesjaId = 0;
  const DZIEN = "1981-09-14";

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
    rw = await nowyToken(sql, ["read", "write"]);
    const [k] = await sql`insert into accounts (name, type) values (${`BEZKONTA-${Date.now()}`}, 'live') returning id`;
    kontoId = k.id;
    const [s] = await sql`insert into backtest_sessions (name) values ('Sesja bez konta') returning id`;
    sesjaId = s.id;
    await sql`delete from day_notes where day = ${DZIEN} and backtest_session_id is null`;
  });
  afterAll(async () => {
    await sql`delete from day_notes where day = ${DZIEN}`;
    await sql`delete from backtest_sessions where id = ${sesjaId}`;
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id]);
    await sql.end();
  });
  beforeEach(() => wyczyscLimiter());

  it("PUT z accountId: 422 day_note_has_no_account i żadnego wiersza; bez konta: jeden wiersz dnia; sesja osobno", async () => {
    const put = (cialo: Record<string, unknown>) =>
      wywolaj(import("@/app/api/v2/days/[date]/route"), "PUT", `/days/${DZIEN}`, { token: rw.token, cialo }, PARAMS({ date: DZIEN }));

    const z = await put({ accountId: kontoId, preSession: "Plan na koncie" });
    expect(z.status, JSON.stringify(z.json)).toBe(422);
    expect(JSON.stringify(z.json)).toContain("day_note_has_no_account");
    expect((await sql`select count(*)::int as n from day_notes where day = ${DZIEN}`)[0].n).toBe(0);

    // Załącznik dnia z ?accountId= też 422 (zakłada notatkę dnia przez ten sam zapis), bez żadnego wiersza.
    const form = new FormData();
    const bajty = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
    form.append("shot", new File([new Uint8Array(bajty)], "dzien.png", { type: "image/png" }));
    const zal = await wywolajMultipart(import("@/app/api/v2/days/[date]/attachments/route"), `/days/${DZIEN}/attachments?accountId=${kontoId}`, rw.token, form, PARAMS({ date: DZIEN }));
    expect(zal.status, JSON.stringify(zal.json)).toBe(422);
    expect(JSON.stringify(zal.json)).toContain("day_note_has_no_account");
    expect((await sql`select count(*)::int as n from day_notes where day = ${DZIEN}`)[0].n).toBe(0);

    expect((await put({ preSession: "Plan" })).status).toBe(201);
    expect((await put({ postSession: "Wniosek" })).status).toBe(200);
    expect((await put({ sessionId: sesjaId, postSession: "Sesja" })).status).toBe(201);
    const wiersze = await sql`select account_id, backtest_session_id, pre_session, post_session from day_notes where day = ${DZIEN} order by id`;
    expect(wiersze.map((w) => [w.account_id, w.backtest_session_id, w.pre_session, w.post_session])).toEqual([
      [null, null, "Plan", "Wniosek"],
      [null, sesjaId, null, "Sesja"],
    ]);
  });
});
