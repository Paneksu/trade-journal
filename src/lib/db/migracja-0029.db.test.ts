import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MOZNA_NA_BAZIE, polacz, type Sql } from "@/lib/api-v2/test/db-pomocnik";

/*
 * Migracja 0029 (ADR-033, Slowa uzytkownika 16.10.2026: «Scal w migracji»): notatka dnia jest jedna i bez konta.
 * Test na prawdziwej bazie, w JEDNEJ transakcji wycofywanej na koncu: cofamy 0029 (docs/v2/rollback/0029_down.sql),
 * wstawiamy dzien z dwoma wpisami na dwoch kontach (i zrzutami), drugi dzien z jednym wpisem na koncie i trzeci z
 * notatka sesji backtestu, stosujemy 0029 jeszcze raz i sprawdzamy wynik; potem cofniecie przywraca stan sprzed.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const migracja = readFileSync(path.join(ROOT, "drizzle", "0029_notatka_dnia_bez_konta.sql"), "utf8");
const cofniecie = readFileSync(path.join(ROOT, "docs", "v2", "rollback", "0029_down.sql"), "utf8");
const instrukcje = migracja.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

class Wycofaj extends Error {}

describe.skipIf(!MOZNA_NA_BAZIE)("migracja 0029: jedna notatka dnia bez konta (baza lokalna)", () => {
  let sql: Sql;
  beforeAll(() => {
    sql = polacz();
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("dwa konta w tym samym dniu: jeden wiersz bez konta z obiema treściami i przepiętymi zrzutami; cofnięcie przywraca", async () => {
    const DZIEN = "1977-03-07";
    const SAM = "1977-03-08";
    await sql
      .begin(async (tx) => {
        await tx.unsafe(cofniecie);
        const [a] = await tx`insert into accounts (name, sort_order) values ('Konto A 0029', -2) returning id`;
        const [b] = await tx`insert into accounts (name, sort_order) values ('Konto B 0029', -1) returning id`;
        const [s] = await tx`insert into backtest_sessions (name) values ('Sesja 0029') returning id`;
        const [na] = await tx`insert into day_notes (day, account_id, pre_session, post_session, mood, energy)
          values (${DZIEN}, ${a.id}, 'Plan A', 'Wnioski A', 3, 4) returning id`;
        const [nb] = await tx`insert into day_notes (day, account_id, pre_session, post_session, mood, day_rating, no_trade, no_trade_reason)
          values (${DZIEN}, ${b.id}, null, 'Wnioski B', 5, 2, true, 'no_setup') returning id`;
        const [ns] = await tx`insert into day_notes (day, account_id, post_session) values (${SAM}, ${b.id}, 'Sam wpis') returning id`;
        const [nsesja] = await tx`insert into day_notes (day, backtest_session_id, post_session) values (${DZIEN}, ${s.id}, 'Sesja') returning id`;
        await tx`insert into screenshots (file, day_note_id, sort_order) values ('dzien-x/a0.webp', ${na.id}, 0), ('dzien-x/b0.webp', ${nb.id}, 0), ('dzien-x/b1.webp', ${nb.id}, 1)`;
        await tx`insert into screenshots (file, day_note_id, sort_order) values ('dzien-x/s0.webp', ${nsesja.id}, 0)`;

        for (const i of instrukcje) await tx.unsafe(i);

        const dzien = await tx`select * from day_notes where day = ${DZIEN} and backtest_session_id is null`;
        expect(dzien).toHaveLength(1);
        const n = dzien[0];
        expect(n.account_id).toBeNull();
        expect(n.id).toBe(na.id);
        expect(n.pre_session).toBe("Plan A — [Konto A 0029]");
        expect(n.post_session).toContain("Wnioski A — [Konto A 0029]\n\nWnioski B — [Konto B 0029]");
        // Pola liczbowe z pierwszego konta; inne wartości z drugiego wpisu nie giną (linia z dopiskiem konta).
        expect([n.mood, n.energy, n.day_rating, n.no_trade]).toEqual([3, 4, 2, false]);
        expect(n.post_session).toContain("Inne wartosci z tego dnia: nastroj 5, dzien bez transakcji (no_setup) — [Konto B 0029]");
        const zrzuty = await tx`select file, day_note_id, sort_order from screenshots where file like 'dzien-x/%' order by sort_order, id`;
        expect(zrzuty.filter((z) => z.file !== "dzien-x/s0.webp").map((z) => [z.file, z.day_note_id, z.sort_order])).toEqual([
          ["dzien-x/a0.webp", na.id, 0],
          ["dzien-x/b0.webp", na.id, 1],
          ["dzien-x/b1.webp", na.id, 2],
        ]);
        // Jeden wpis na koncie: ten sam wiersz, tylko bez konta i bez dopisku.
        const [sam] = await tx`select id, account_id, post_session from day_notes where day = ${SAM} and backtest_session_id is null`;
        expect([sam.id, sam.account_id, sam.post_session]).toEqual([ns.id, null, "Sam wpis"]);
        // Notatka sesji backtestu bez zmian.
        const [sesja] = await tx`select account_id, backtest_session_id, post_session from day_notes where id = ${nsesja.id}`;
        expect([sesja.backtest_session_id, sesja.post_session]).toEqual([s.id, "Sesja"]);
        expect((await tx`select day_note_id from screenshots where file = 'dzien-x/s0.webp'`)[0].day_note_id).toBe(nsesja.id);

        // Cofnięcie: dwa wpisy na kontach i zrzuty wracają na swoje miejsce.
        await tx.unsafe(cofniecie);
        const poCofnieciu = await tx`select id, account_id, post_session from day_notes where day = ${DZIEN} and backtest_session_id is null order by id`;
        expect(poCofnieciu.map((w) => [w.id, w.account_id, w.post_session])).toEqual([
          [na.id, a.id, "Wnioski A"],
          [nb.id, b.id, "Wnioski B"],
        ]);
        const zrzutyPo = await tx`select file, day_note_id from screenshots where file in ('dzien-x/b0.webp', 'dzien-x/b1.webp')`;
        expect(zrzutyPo.every((z) => z.day_note_id === nb.id)).toBe(true);
        throw new Wycofaj();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Wycofaj)) throw e;
      });
  });
});
