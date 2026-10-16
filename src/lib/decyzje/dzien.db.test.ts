import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MOZNA_NA_BAZIE, polacz, type Sql } from "@/lib/api-v2/test/db-pomocnik";
import { podpisPol } from "@/lib/trades/podpis-notatki";

vi.mock("server-only", () => ({}));

/*
 * Code review fazy 5, P1 (16.10.2026) i review potwierdzające, B1: notatka dnia nie może się nadpisać, a zmiana
 * w tle innych pól nie może unieważniać formularza.
 *  - wersja = skrót wartości pól TEGO formularza (podpisPol);
 *  - zmiana tych samych pól w tle = odmowa (konflikt); „scal” zachowuje oba teksty;
 *  - zmiana innych pól w tle nie jest konfliktem;
 *  - dwa „pierwsze” zapisy równolegle: jeden przechodzi, drugi dostaje konflikt;
 *  - szybka notatka dopisuje atomowo: równoległe dopiski nie gubią się nawzajem.
 * Zapisy idą jako aktor `ui` (P3). Notatka dnia jest jedna i bez konta («Tak, zawsze jedna»).
 */
describe.skipIf(!MOZNA_NA_BAZIE)("notatka dnia: wersja pól formularza i dopisek atomowy (baza lokalna)", () => {
  let sql: Sql;
  const DZIEN = "1979-06-11";
  const DZIEN2 = "1979-06-12";
  const notatka = async (d: string) =>
    (await sql`select pre_session, post_session from day_notes where day = ${d} and account_id is null and backtest_session_id is null`)[0];

  beforeAll(async () => {
    sql = polacz();
    await sql`delete from day_notes where day in (${DZIEN}, ${DZIEN2}) and backtest_session_id is null`;
  });
  afterAll(async () => {
    await sql`delete from day_notes where day in (${DZIEN}, ${DZIEN2}) and backtest_session_id is null`;
    await sql.end();
  });

  it("zmiana tych samych pól w tle: odmowa i nic nie nadpisane; scal zachowuje oba teksty; inne pola nie są konfliktem", async () => {
    const { zapiszNotatkeDniaUi } = await import("./dzien");
    const PRZED = ["preSession"];
    const PO = ["postSession"];
    expect((await zapiszNotatkeDniaUi(DZIEN, { preSession: "Plan A" }, podpisPol(null, PRZED))).ok).toBe(true);

    // Formularz „Po sesji” otwarty przed zapisem „Przed sesją”: inne pole, więc nie ma konfliktu (B1).
    expect((await zapiszNotatkeDniaUi(DZIEN, { postSession: "Wniosek z drugiej karty" }, podpisPol(null, PO))).ok).toBe(true);

    // Formularz otwarty, gdy „Po sesji” było puste: te same pola zmieniły się w tle, więc odmowa.
    const w = await zapiszNotatkeDniaUi(DZIEN, { postSession: "Stary tekst" }, podpisPol(null, PO));
    expect(w.ok).toBe(false);
    expect(w.ok === false && w.konflikt).toBe(true);
    expect(await notatka(DZIEN)).toMatchObject({ pre_session: "Plan A", post_session: "Wniosek z drugiej karty" });

    // „Scal”: aktualny tekst zostaje, pod nim mój.
    expect((await zapiszNotatkeDniaUi(DZIEN, { postSession: "Mój wniosek" }, podpisPol(null, PO), null, true)).ok).toBe(true);
    expect((await notatka(DZIEN)).post_session).toBe("Wniosek z drugiej karty\n\nMój wniosek");
  });

  it("dwa pierwsze zapisy naraz: jeden przechodzi, drugi dostaje konflikt; dopiski równoległe nie giną", async () => {
    const { dopiszDoPoSesjiUi, zapiszNotatkeDniaUi } = await import("./dzien");
    const v = podpisPol(null, ["postSession"]);
    const wyniki = await Promise.all([zapiszNotatkeDniaUi(DZIEN2, { postSession: "Karta 1" }, v), zapiszNotatkeDniaUi(DZIEN2, { postSession: "Karta 2" }, v)]);
    expect(wyniki.filter((w) => w.ok)).toHaveLength(1);
    expect(wyniki.filter((w) => !w.ok)).toHaveLength(1);

    await Promise.all(Array.from({ length: 8 }, (_, i) => dopiszDoPoSesjiUi(DZIEN2, `Dopisek ${i}`)));
    const n = await notatka(DZIEN2);
    for (let i = 0; i < 8; i += 1) expect(n.post_session).toContain(`Dopisek ${i}`);
    expect(n.post_session.startsWith("Karta ")).toBe(true);
    const wierszy = await sql`select count(*)::int as n from day_notes where day = ${DZIEN2} and backtest_session_id is null`;
    expect(wierszy[0].n).toBe(1);
  });
});
