import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MOZNA_NA_BAZIE, polacz, type Sql } from "@/lib/api-v2/test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Code review fazy 5, P1 (16.10.2026): notatka dnia nie może się nadpisać.
 *  - formularz z wersją sprzed cudzej zmiany dostaje odmowę (konflikt), a nie nadpisuje;
 *  - dwa „pierwsze” zapisy równolegle: jeden przechodzi, drugi dostaje konflikt;
 *  - szybka notatka dopisuje atomowo: równoległe dopiski nie gubią się nawzajem.
 * Zapisy idą jako aktor `ui` (P3). Notatka dnia jest jedna i bez konta («Tak, zawsze jedna»).
 */
describe.skipIf(!MOZNA_NA_BAZIE)("notatka dnia: wersja i dopisek atomowy (baza lokalna)", () => {
  let sql: Sql;
  const DZIEN = "1979-06-11";
  const DZIEN2 = "1979-06-12";

  beforeAll(async () => {
    sql = polacz();
    await sql`delete from day_notes where day in (${DZIEN}, ${DZIEN2}) and backtest_session_id is null`;
  });
  afterAll(async () => {
    await sql`delete from day_notes where day in (${DZIEN}, ${DZIEN2}) and backtest_session_id is null`;
    await sql.end();
  });

  it("formularz z nieaktualną wersją dostaje odmowę i nie nadpisuje cudzej zmiany", async () => {
    const { zapiszNotatkeDniaUi } = await import("./dzien");
    expect((await zapiszNotatkeDniaUi(DZIEN, { preSession: "Plan A" }, "")).ok).toBe(true);
    const [n1] = await sql`select updated_at from day_notes where day = ${DZIEN} and account_id is null and backtest_session_id is null`;
    const wersja1 = new Date(n1.updated_at).toISOString();

    // Ktoś inny (np. AI przez API albo druga karta) zmienia notatkę.
    expect((await zapiszNotatkeDniaUi(DZIEN, { postSession: "Wniosek z drugiej karty" }, wersja1)).ok).toBe(true);

    // Formularz otwarty przed tą zmianą: odmowa, treść z drugiej karty zostaje.
    const w = await zapiszNotatkeDniaUi(DZIEN, { postSession: "Stary tekst" }, wersja1);
    expect(w.ok).toBe(false);
    expect(w.ok === false && w.konflikt).toBe(true);
    // Formularz otwarty, gdy notatki „nie było”: też odmowa.
    expect((await zapiszNotatkeDniaUi(DZIEN, { postSession: "Z pustego formularza" }, "")).ok).toBe(false);
    const [n] = await sql`select pre_session, post_session from day_notes where day = ${DZIEN} and account_id is null and backtest_session_id is null`;
    expect([n.pre_session, n.post_session]).toEqual(["Plan A", "Wniosek z drugiej karty"]);
  });

  it("dwa pierwsze zapisy naraz: jeden przechodzi, drugi dostaje konflikt; dopiski równoległe nie giną", async () => {
    const { dopiszDoPoSesjiUi, zapiszNotatkeDniaUi } = await import("./dzien");
    const wyniki = await Promise.all([zapiszNotatkeDniaUi(DZIEN2, { postSession: "Karta 1" }, ""), zapiszNotatkeDniaUi(DZIEN2, { postSession: "Karta 2" }, "")]);
    expect(wyniki.filter((w) => w.ok)).toHaveLength(1);
    expect(wyniki.filter((w) => !w.ok)).toHaveLength(1);

    await Promise.all(Array.from({ length: 8 }, (_, i) => dopiszDoPoSesjiUi(DZIEN2, `Dopisek ${i}`)));
    const [n] = await sql`select post_session from day_notes where day = ${DZIEN2} and account_id is null and backtest_session_id is null`;
    for (let i = 0; i < 8; i += 1) expect(n.post_session).toContain(`Dopisek ${i}`);
    expect(n.post_session.startsWith("Karta ")).toBe(true);
    const wierszy = await sql`select count(*)::int as n from day_notes where day = ${DZIEN2} and backtest_session_id is null`;
    expect(wierszy[0].n).toBe(1);
  });
});
