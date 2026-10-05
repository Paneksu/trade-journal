import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * tagMany na PRAWDZIWEJ lokalnej bazie: obie galezie (dodanie i zdjecie tagu)
 * podbijaja trades.updated_at, wiec zapis z API da `conflict` zamiast
 * nadpisac reczny tag (ADR-026). Pomijany, gdy DATABASE_URL nie jest lokalny.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/auth/guard", () => ({ requireSession: async () => ({}) }));

const URL_BAZY = process.env.DATABASE_URL ?? "";
function lokalna(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

describe.skipIf(!lokalna(URL_BAZY))("tagMany podbija updated_at", () => {
  const sql = postgres(URL_BAZY, { max: 2 });
  const PREFIKS = "TAGMANY-TEST";
  let tradeId = 0;
  let tagId = 0;

  const stan = async () => {
    const [w] = await sql`select updated_at, ingested_at from trades where id = ${tradeId}`;
    return w as { updated_at: Date; ingested_at: Date };
  };

  beforeAll(async () => {
    const [k] = await sql`insert into accounts (name, type) values (${PREFIKS}, 'live') returning id`;
    const stempel = new Date("2000-01-01T00:00:00Z");
    const [t] = await sql`
      insert into trades (account_id, instrument_id, direction, status, entry_time, entry_price, contracts, note,
                          source, external_ref, ingested_at, updated_at)
      values (${k.id}, (select id from instruments where symbol = 'NQ'), 'long', 'open', '1993-01-04T14:35:00Z',
              20000, 1, ${PREFIKS}, 'fxreplay', ${"fxr:" + PREFIKS}, ${stempel}, ${stempel}) returning id`;
    tradeId = t.id;
    const [tg] = await sql`insert into tags (category_id, name) select id, ${PREFIKS} from tag_categories where key = 'confluence' returning id`;
    tagId = tg.id;
  });

  afterAll(async () => {
    await sql`delete from trades where note = ${PREFIKS}`;
    await sql`delete from tags where name = ${PREFIKS}`;
    await sql`delete from accounts where name = ${PREFIKS}`;
    await sql.end();
  });

  it("dodanie tagu: updated_at > ingested_at, a ingested_at bez zmian", async () => {
    const { tagMany } = await import("./trades");
    const przed = await stan();
    expect(przed.updated_at.getTime()).toBe(przed.ingested_at.getTime());
    await tagMany([tradeId], tagId, true);
    const po = await stan();
    expect(po.updated_at.getTime()).toBeGreaterThan(po.ingested_at.getTime());
    expect(po.ingested_at.getTime()).toBe(przed.ingested_at.getTime());
    const [ile] = await sql`select count(*)::int as n from trade_tags where trade_id = ${tradeId}`;
    expect(ile.n).toBe(1);
  });

  it("zdjecie tagu tez podbija updated_at, a brak zmiany nie rusza wiersza", async () => {
    const { tagMany } = await import("./trades");
    await sql`update trades set updated_at = ingested_at where id = ${tradeId}`;
    await tagMany([tradeId], tagId, false);
    const po = await stan();
    expect(po.updated_at.getTime()).toBeGreaterThan(po.ingested_at.getTime());
    const [ile] = await sql`select count(*)::int as n from trade_tags where trade_id = ${tradeId}`;
    expect(ile.n).toBe(0);

    // Zdejmowanie tagu, ktorego trade nie ma: nic sie nie zmienilo, wiec nie ma edycji.
    await sql`update trades set updated_at = ingested_at where id = ${tradeId}`;
    await tagMany([tradeId], tagId, false);
    const bez = await stan();
    expect(bez.updated_at.getTime()).toBe(bez.ingested_at.getTime());
  });
});
