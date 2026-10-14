/**
 * Dowod na prawdziwej bazie dla migracji 0017 i 0018 (ADR-029, ADR-030, ADR-033):
 *  (a) migracje od zera daja to samo, co deklaruje schema.ts,
 *  (b) triggery niezmiennosci, zatwierdzen i bramki n,
 *  (c) f_unaccent i wyszukiwanie ("zarzadzanie" znajduje "Zarzadzanie"),
 *  (d) slowa uzytkownika bajt w bajt (skrot w bazie == skrot z Node),
 *  (e) odwracalnosc (skrypty docs/v2/rollback/*.sql) i ponowne zastosowanie.
 *
 * Uruchamia sie WYLACZNIE, gdy ustawiona jest TEST_DATABASE_URL, np.
 *   TEST_DATABASE_URL=postgres://journal:journal@127.0.0.1:55433/tj_faza2_migracje npx vitest run src/lib/db/migracje-v2.db.test.ts
 * albo po prostu `npm run test:db` (skrypt sam zaklada baze `<DATABASE_URL>_migracje` i ustawia zmienna).
 * NIE wskazuj tej zmiennej na baze, z ktorej korzystaja pozostale testy db (tj_faza2): test ja skasuje.
 * Bez niej caly plik jest pominiety (describe.skip) - to NIE jest zielony wynik, tylko brak dowodu.
 *
 * !!! Test KASUJE schematy `public` i `drizzle` w bazie z TEST_DATABASE_URL i buduje je od zera.
 * Dlatego odmawia pracy, gdy baza nie lezy na tym komputerze (127.0.0.1 / localhost / ::1)
 * albo jej nazwa nie pasuje do ^tj_[a-z0-9_]+$. Produkcja i baza `journal` odpadaja.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TEST_URL = process.env.TEST_DATABASE_URL;

/** Zwraca powod odmowy albo null, gdy adres wolno uzyc. */
function powodOdmowy(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "TEST_DATABASE_URL nie jest poprawnym adresem";
  }
  if (!["postgres:", "postgresql:"].includes(u.protocol)) return "oczekiwano postgres://";
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(u.hostname)) {
    return `host ${u.hostname} nie jest lokalny - test kasuje schematy bazy`;
  }
  const baza = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!/^tj_[a-z0-9_]+$/.test(baza)) {
    return `baza "${baza}" nie zaczyna sie od tj_ - test kasuje schematy bazy`;
  }
  return null;
}

type Blad = { code: string; message: string; constraint_name?: string };

/** Zapytanie ma sie wywalic; zwraca blad (kod SQLSTATE w `code`). */
async function blad(zapytanie: PromiseLike<unknown>): Promise<Blad> {
  try {
    await zapytanie;
  } catch (e) {
    return e as Blad;
  }
  throw new Error("Oczekiwano bledu SQL, a zapytanie przeszlo");
}

/** schema.ts pisze kolumny camelCase; baza ma snake_case (drizzle: casing "snake_case"). */
const snake = (s: string) => s.replace(/[A-Z]/g, (z) => `_${z.toLowerCase()}`);
const sha256Node = (tekst: string) =>
  createHash("sha256").update(Buffer.from(tekst, "utf8")).digest("hex");

if (!TEST_URL) {
  describe.skip("migracje v2 na prawdziwej bazie - POMINIETE: brak TEST_DATABASE_URL (to nie jest dowod)", () => {
    it("pominiete", () => {});
  });
} else if (powodOdmowy(TEST_URL)) {
  describe("migracje v2 na prawdziwej bazie - ODMOWA", () => {
    it("odmawia pracy na tej bazie", () => {
      throw new Error(`Odmowa: ${powodOdmowy(TEST_URL)}`);
    });
  });
} else {
  const url = TEST_URL;
  let sql: ReturnType<typeof postgres>;
  let odciskDrizzle = "";
  let odciskSkrypt = "";

  async function reset() {
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await admin.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
      await admin.unsafe("CREATE SCHEMA public");
    } finally {
      await admin.end();
    }
  }

  /** Odcisk calego katalogu bazy: kolumny, ograniczenia, indeksy, funkcje, triggery. */
  async function odcisk(): Promise<string> {
    const k = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const kolumny = await k`
        SELECT c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
               || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
               || CASE WHEN a.attgenerated <> '' THEN ' GENERATED ' || pg_get_expr(d.adbin, d.adrelid) ELSE
                    coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') END AS x
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped ORDER BY 1`;
      const ograniczenia = await k`
        SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS x
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1`;
      const indeksy = await k`SELECT indexdef AS x FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`;
      const funkcje = await k`
        SELECT proname || ' ' || provolatile::text || proparallel::text || proisstrict::text || ' ' || md5(prosrc) AS x
        FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = pg_proc.oid AND d.deptype = 'e')
        ORDER BY 1`;
      const triggery = await k`
        SELECT pg_get_triggerdef(oid) AS x FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1`;
      return JSON.stringify({
        kolumny: kolumny.map((r) => r.x),
        ograniczenia: ograniczenia.map((r) => r.x),
        indeksy: indeksy.map((r) => r.x),
        funkcje: funkcje.map((r) => r.x),
        triggery: triggery.map((r) => r.x),
      });
    } finally {
      await k.end();
    }
  }

  function migrateSkryptem() {
    const wynik = spawnSync(process.execPath, [path.join(ROOT, "scripts", "migrate.mjs")], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    if (wynik.status !== 0) {
      throw new Error(`scripts/migrate.mjs padl (${wynik.status}):\n${wynik.stdout}\n${wynik.stderr}`);
    }
    return wynik.stdout;
  }

  /** Wykonuje fn w transakcji i zawsze ja wycofuje. */
  const WYCOFAJ = new Error("wycofaj");
  async function wycofywalna(fn: (tx: postgres.TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await fn(tx);
        throw WYCOFAJ;
      });
    } catch (e) {
      if (e !== WYCOFAJ) throw e;
    }
  }

  async function aktor(tx: postgres.TransactionSql, kto: string) {
    await tx`SELECT set_config('tj.actor', ${kto}, true)`;
  }

  /** Zatwierdzona transakcja z podanym aktorem (set_config lokalny dla transakcji). */
  async function jako<T>(kto: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await sql.begin(async (tx) => {
      await aktor(tx, kto);
      return fn(tx);
    })) as T;
  }

  type Db = postgres.Sql | postgres.TransactionSql;
  let seq = 0;
  const unik = (prefiks: string) => `${prefiks}-${++seq}`;

  async function nowaNotatka(
    tx: Db,
    tytul: string,
    opcje: { body?: string; kind?: string; tradeId?: number | null } = {},
  ): Promise<number> {
    const [n] = await tx`
      INSERT INTO notes (kind, slug, title, body_md, trade_id)
      VALUES (${opcje.kind ?? "concept"}, ${unik("n")}, ${tytul}, ${opcje.body ?? ""}, ${opcje.tradeId ?? null})
      RETURNING id`;
    return n.id as number;
  }

  async function nowyTrade(tx: Db): Promise<number> {
    const [a] = await tx`INSERT INTO accounts (name) VALUES (${unik("konto")}) RETURNING id`;
    const [i] = await tx`
      INSERT INTO instruments (symbol, name, tick_size, tick_value)
      VALUES (${unik("SYM")}, 'Test', 0.25, 5000) RETURNING id`;
    const [t] = await tx`
      INSERT INTO trades (account_id, instrument_id, direction, entry_time, entry_price, contracts)
      VALUES (${a.id}, ${i.id}, 'long', now(), 100, 1) RETURNING id`;
    return t.id as number;
  }

  describe("migracje 0017-0018 na prawdziwej bazie", () => {
    beforeAll(async () => {
      // 1) migrator drizzle (jak `npm run db:migrate`: jedna transakcja na cala serie)
      await reset();
      const klient = postgres(url, { max: 1, onnotice: () => {} });
      await migrate(drizzle(klient), { migrationsFolder: path.join(ROOT, "drizzle") });
      await klient.end();
      odciskDrizzle = await odcisk();
      // 2) scripts/migrate.mjs (jak start kontenera: transakcja na plik); to ta baza zostaje do testow
      await reset();
      const wyjscie1 = migrateSkryptem();
      expect(wyjscie1).toContain("0018_notatki");
      odciskSkrypt = await odcisk();
      const wyjscie2 = migrateSkryptem();
      expect(wyjscie2).toContain("nic nowego");
      sql = postgres(url, { max: 1, onnotice: () => {} });
    }, 180_000);

    afterAll(async () => {
      await sql?.end();
    });

    /* ------------------------------------------------------------------ (a) */
    describe("(a) migracje od zera vs schema.ts", () => {
      it("oba migratory daja identyczny katalog bazy", () => {
        expect(odciskSkrypt).toBe(odciskDrizzle);
      });

      const tabeleSchema = () =>
        (Object.values(schema) as unknown[])
          .filter((x): x is PgTable => is(x, PgTable))
          .map((t) => getTableConfig(t));

      it("zbior tabel w bazie == zbior tabel w schema.ts", async () => {
        const wBazie = (
          await sql`SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`
        ).map((r) => r.relname as string);
        expect(wBazie.sort()).toEqual(tabeleSchema().map((t) => t.name).sort());
      });

      const normalizujTyp = (t: string) =>
        t
          .replace(/\s+/g, " ")
          .replace(/^serial$/, "integer")
          .replace(/^bigserial$/, "bigint")
          .replace(/^smallserial$/, "smallint")
          .replace(/,\s/g, ",");

      it("kolumny: nazwy, typy, NOT NULL, generowane", async () => {
        const wiersze = await sql`
          SELECT c.relname AS tabela, a.attname AS kolumna, format_type(a.atttypid, a.atttypmod) AS typ,
                 a.attnotnull AS nn, a.attgenerated <> '' AS gen
          FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped`;
        const rozbieznosci: string[] = [];
        for (const cfg of tabeleSchema()) {
          const wBazie = new Map(
            wiersze.filter((r) => r.tabela === cfg.name).map((r) => [r.kolumna as string, r]),
          );
          const wSchema = new Set(cfg.columns.map((c) => snake(c.name)));
          for (const nazwa of wBazie.keys()) {
            if (!wSchema.has(nazwa)) rozbieznosci.push(`${cfg.name}.${nazwa}: jest w bazie, brak w schema.ts`);
          }
          for (const c of cfg.columns) {
            const b = wBazie.get(snake(c.name));
            if (!b) {
              rozbieznosci.push(`${cfg.name}.${snake(c.name)}: jest w schema.ts, brak w bazie`);
              continue;
            }
            if (normalizujTyp(c.getSQLType()) !== normalizujTyp(b.typ as string)) {
              rozbieznosci.push(`${cfg.name}.${c.name}: typ schema=${c.getSQLType()} baza=${b.typ}`);
            }
            if (c.notNull !== b.nn) rozbieznosci.push(`${cfg.name}.${c.name}: notNull schema=${c.notNull} baza=${b.nn}`);
            const generowana = c.generated !== undefined;
            if (generowana !== b.gen) rozbieznosci.push(`${cfg.name}.${c.name}: generowana schema=${generowana} baza=${b.gen}`);
          }
        }
        expect(rozbieznosci).toEqual([]);
      });

      it("CHECK-i: te same nazwy w bazie i w schema.ts", async () => {
        const wiersze = await sql`
          SELECT conrelid::regclass::text AS tabela, conname FROM pg_constraint
          WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
        const rozbieznosci: string[] = [];
        for (const cfg of tabeleSchema()) {
          const baza = new Set(wiersze.filter((r) => r.tabela === cfg.name).map((r) => r.conname as string));
          const schemat = new Set(cfg.checks.map((c) => c.name));
          for (const n of baza) if (!schemat.has(n)) rozbieznosci.push(`${cfg.name}: CHECK ${n} jest w bazie, brak w schema.ts`);
          for (const n of schemat) if (!baza.has(n)) rozbieznosci.push(`${cfg.name}: CHECK ${n} jest w schema.ts, brak w bazie`);
        }
        expect(rozbieznosci).toEqual([]);
      });

      it("indeksy i unikaty: nazwy, unikalnosc, czesciowosc, metoda", async () => {
        const wiersze = await sql`
          SELECT t.relname AS tabela, i.relname AS indeks, x.indisunique AS uniq,
                 x.indpred IS NOT NULL AS czesciowy, am.amname AS metoda
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
          JOIN pg_class t ON t.oid = x.indrelid
          JOIN pg_am am ON am.oid = i.relam
          WHERE t.relnamespace = 'public'::regnamespace AND NOT x.indisprimary`;
        const rozbieznosci: string[] = [];
        for (const cfg of tabeleSchema()) {
          const baza = new Map(wiersze.filter((r) => r.tabela === cfg.name).map((r) => [r.indeks as string, r]));
          const schemat = new Map<string, { uniq: boolean; czesciowy: boolean; metoda: string }>();
          for (const i of cfg.indexes) {
            schemat.set(i.config.name as string, {
              uniq: Boolean(i.config.unique),
              czesciowy: i.config.where !== undefined,
              metoda: (i.config.method as string | undefined) ?? "btree",
            });
          }
          for (const u of cfg.uniqueConstraints) {
            schemat.set(u.name as string, { uniq: true, czesciowy: false, metoda: "btree" });
          }
          for (const [n, b] of baza) {
            const s = schemat.get(n);
            if (!s) {
              rozbieznosci.push(`${cfg.name}: indeks ${n} jest w bazie, brak w schema.ts`);
              continue;
            }
            if (s.uniq !== b.uniq) rozbieznosci.push(`${cfg.name}.${n}: unique schema=${s.uniq} baza=${b.uniq}`);
            if (s.czesciowy !== b.czesciowy) rozbieznosci.push(`${cfg.name}.${n}: czesciowy schema=${s.czesciowy} baza=${b.czesciowy}`);
            if (s.metoda !== b.metoda) rozbieznosci.push(`${cfg.name}.${n}: metoda schema=${s.metoda} baza=${b.metoda}`);
          }
          for (const n of schemat.keys()) if (!baza.has(n)) rozbieznosci.push(`${cfg.name}: indeks ${n} jest w schema.ts, brak w bazie`);
        }
        expect(rozbieznosci).toEqual([]);
      });

      it("klucze obce: kolumny, tabela docelowa i akcja przy kasowaniu", async () => {
        const akcje: Record<string, string> = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };
        const wiersze = await sql`
          SELECT c.conrelid::regclass::text AS tabela, c.confrelid::regclass::text AS cel,
                 (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(n, ord)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS kolumny,
                 c.confdeltype AS akcja
          FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`;
        const opis = (t: string, k: string, cel: string, a: string) => `${t}(${k}) -> ${cel} ON DELETE ${a}`;
        const baza = wiersze.map((r) => opis(r.tabela, r.kolumny, r.cel, akcje[r.akcja as string])).sort();
        const schemat: string[] = [];
        for (const cfg of tabeleSchema()) {
          for (const fk of cfg.foreignKeys) {
            const ref = fk.reference();
            schemat.push(
              opis(
                cfg.name,
                ref.columns.map((c) => snake(c.name)).join(","),
                getTableConfig(ref.foreignTable).name,
                fk.onDelete ?? "no action",
              ),
            );
          }
        }
        expect(baza).toEqual(schemat.sort());
      });

      it("tabele niezmienne nie maja FK z SET NULL / SET DEFAULT (pulapka z modelu, sekcja 6)", async () => {
        const wiersze = await sql`
          SELECT c.conrelid::regclass::text AS tabela, c.conname FROM pg_constraint c
          WHERE c.contype = 'f' AND c.confdeltype IN ('n', 'd')
            AND c.conrelid IN (
              SELECT tgrelid FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE NOT t.tgisinternal AND p.proname IN ('tj_forbid_update', 'tj_guard_columns'))`;
        expect(wiersze.map((r) => `${r.tabela}.${r.conname}`)).toEqual([]);
      });

      it("jesli istnieje auth_events (faza 1), ma FK token_id -> api_tokens", async () => {
        const [t] = await sql`SELECT to_regclass('public.auth_events') IS NOT NULL AS jest`;
        if (!t.jest) {
          console.warn("auth_events nie istnieje w tej galezi: sprawdzenie FK token_id nie dotyczy (zob. naglowek 0017)");
          return;
        }
        const fk = await sql`
          SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conrelid = 'public.auth_events'::regclass
            AND confrelid = 'public.api_tokens'::regclass AND confdeltype = 'a'`;
        expect(fk.length).toBe(1);
      });
    });

    /* ------------------------------------------------------------------ (b) */
    describe("(b) triggery i ograniczenia", () => {
      it("TJ409, TJ403 i TJ422 to poprawne SQLSTATE (5 znakow, przyjmowane przez Postgresa)", async () => {
        const [r] = await sql`
          SELECT current_setting('tj.nieistnieje', true) IS NULL AS brak`;
        expect(r.brak).toBe(true);
        for (const kod of ["TJ409", "TJ403", "TJ422"]) {
          const e = await blad(sql.unsafe(`DO $$ BEGIN RAISE EXCEPTION 'proba' USING ERRCODE = '${kod}'; END $$`));
          expect(e.code).toBe(kod);
        }
      });

      it("user_words: UPDATE text / sha256 / byte_len / source / role / captured_at -> TJ409; ai_interpretation wolno", async () => {
        const [w] = await sql`
          INSERT INTO user_words (text, source, role, captured_at)
          VALUES ('wszedlem, bo FVG', 'chat', 'trade.note', now()) RETURNING id`;
        const zmiany: Record<string, string> = {
          text: "text = 'cos innego'",
          sha256: `sha256 = '${"a".repeat(64)}'`,
          byte_len: "byte_len = 999",
          source: "source = 'ui'",
          role: "role = 'correction'",
          captured_at: "captured_at = now() + interval '1 day'",
          created_at: "created_at = now() + interval '1 day'",
        };
        for (const [kolumna, set] of Object.entries(zmiany)) {
          const e = await blad(sql.unsafe(`UPDATE user_words SET ${set} WHERE id = ${w.id}`));
          expect(e.code, kolumna).toBe("TJ409");
          expect(e.message, kolumna).toContain(kolumna);
        }
        // UPDATE na tej samej wartosci nie jest zmiana
        await sql`UPDATE user_words SET text = text WHERE id = ${w.id}`;
        // jedyna zmienna tresc
        await sql`
          UPDATE user_words SET ai_interpretation = 'AI: wejscie po FVG', interpretation_model = 'm',
                 interpretation_at = now() WHERE id = ${w.id}`;
        const [po] = await sql`SELECT ai_interpretation FROM user_words WHERE id = ${w.id}`;
        expect(po.ai_interpretation).toBe("AI: wejscie po FVG");
      });

      it("user_words: skrot od klienta jest nadpisywany wlasnym (trigger nie ufa)", async () => {
        const tekst = "Zażółć gęślą jaźń";
        const [w] = await sql`
          INSERT INTO user_words (text, source, captured_at, sha256, byte_len)
          VALUES (${tekst}, 'chat', now(), ${"b".repeat(64)}, 1) RETURNING sha256, byte_len`;
        expect(w.sha256).toBe(sha256Node(tekst));
        expect(w.byte_len).toBe(Buffer.byteLength(tekst, "utf8"));
      });

      it("slowa uzytkownika: FK NO ACTION, nie SET NULL - kasowanie tokenu jest blokowane (23503), a nie psuje sie triggerem", async () => {
        const [tok] = await sql`
          INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via)
          VALUES ('test', ${"abcd" + String(seq++).padStart(4, "0")}, ${sha256Node(unik("t"))}, ARRAY['read','write'], 'ui')
          RETURNING id`;
        await sql`
          INSERT INTO user_words (text, source, captured_at, created_by_token_id)
          VALUES ('od tokenu', 'chat', now(), ${tok.id})`;
        const e = await blad(sql`DELETE FROM api_tokens WHERE id = ${tok.id}`);
        expect(e.code).toBe("23503");
      });

      it("kasowanie trade'u: user_words kasuje sie kaskada (DELETE nie jest blokowany), notatka przezywa z trade_id NULL bez rewizji", async () => {
        const tradeId = await nowyTrade(sql);
        const nid = await nowaNotatka(sql, unik("Notatka trade"), { kind: "trade_note", tradeId, body: "tresc" });
        await sql`INSERT INTO user_words (text, source, captured_at, trade_id) VALUES ('opis trade', 'chat', now(), ${tradeId})`;
        const [przed] = await sql`SELECT rev, content_hash, updated_at FROM notes WHERE id = ${nid}`;
        await sql`DELETE FROM trades WHERE id = ${tradeId}`;
        const [po] = await sql`SELECT rev, content_hash, updated_at, trade_id FROM notes WHERE id = ${nid}`;
        expect(po.trade_id).toBeNull();
        expect(po.rev).toBe(przed.rev);
        expect(po.content_hash).toBe(przed.content_hash);
        expect(po.updated_at).toEqual(przed.updated_at);
        const rew = await sql`SELECT 1 FROM note_revisions WHERE note_id = ${nid}`;
        expect(rew.length).toBe(0);
        const slowa = await sql`SELECT 1 FROM user_words WHERE trade_id = ${tradeId}`;
        expect(slowa.length).toBe(0);
      });

      it("notes: rewizje rosna z rev, tylko przy zmianie title/body_md/meta; aktor z tj.actor; historia niezmienna", async () => {
        const nid = await jako("api:7", (tx) => nowaNotatka(tx, unik("Rewizje"), { body: "v1" }));
        const [n1] = await sql`SELECT rev, content_hash FROM notes WHERE id = ${nid}`;
        expect(n1.rev).toBe(1);
        expect(n1.content_hash).toBe(sha256Node("v1"));

        await jako("api:7", (tx) => tx`UPDATE notes SET body_md = 'v2 zażółć' WHERE id = ${nid}`);
        await jako("ui", (tx) => tx`UPDATE notes SET meta = '{"a":1}'::jsonb WHERE id = ${nid}`);
        // zmiana, ktora nie jest trescia: archiwizacja - bez rewizji i bez ruszania rev
        await jako("ui", (tx) => tx`UPDATE notes SET archived_at = now() WHERE id = ${nid}`);
        // proba oszustwa: reczne rev i content_hash bez zmiany tresci
        await jako("ui", (tx) => tx`UPDATE notes SET rev = 99, content_hash = ${"c".repeat(64)} WHERE id = ${nid}`);

        const [n3] = await sql`SELECT rev, content_hash, body_md FROM notes WHERE id = ${nid}`;
        expect(n3.rev).toBe(3);
        expect(n3.content_hash).toBe(sha256Node("v2 zażółć"));
        const rew = await sql`SELECT rev, body_md, meta, content_hash, actor FROM note_revisions WHERE note_id = ${nid} ORDER BY rev`;
        expect(rew.map((r) => r.rev)).toEqual([1, 2]);
        expect(rew[0].body_md).toBe("v1");
        expect(rew[0].content_hash).toBe(sha256Node("v1"));
        expect(rew[1].body_md).toBe("v2 zażółć");
        expect(rew.map((r) => r.actor)).toEqual(["api:7", "ui"]);

        const e = await blad(sql`UPDATE note_revisions SET title = 'x' WHERE note_id = ${nid}`);
        expect(e.code).toBe("TJ409");
        // tj_forbid_update nie blokuje DELETE (kaskada z kasowania notatki)
        await sql`DELETE FROM notes WHERE id = ${nid}`;
        expect((await sql`SELECT 1 FROM note_revisions WHERE note_id = ${nid}`).length).toBe(0);
      });

      it("notes: brak tj.actor zapisuje sie jako 'unknown', zapis nie pada", async () => {
        const nid = await nowaNotatka(sql, unik("Bez aktora"), { body: "a" });
        await sql`UPDATE notes SET body_md = 'b' WHERE id = ${nid}`;
        const [r] = await sql`SELECT actor FROM note_revisions WHERE note_id = ${nid}`;
        expect(r.actor).toBe("unknown");
      });

      async function nowaRegula(db: Db = sql): Promise<number> {
        const nid = await nowaNotatka(db, unik("Regula"), { kind: "rule" });
        const [r] = await db`
          INSERT INTO rules (code, note_id) VALUES (${"R-" + String(1000 + seq++)}, ${nid}) RETURNING id`;
        return r.id as number;
      }
      async function nowaHipoteza(opcje: { nImported: number; progN: number }, db: Db = sql): Promise<number> {
        const nid = await nowaNotatka(db, unik("Hipoteza"), { kind: "hypothesis" });
        const [h] = await db`
          INSERT INTO hypotheses (code, note_id, prog_n, n_imported)
          VALUES (${"H-" + String(1000 + seq++)}, ${nid}, ${opcje.progN}, ${opcje.nImported}) RETURNING id`;
        return h.id as number;
      }

      it("rule_versions: import z sejfu wchodzi jako proposed; approved bez aktora UI -> TJ403, z UI -> OK", async () => {
        const rid = await nowaRegula();
        const [v] = await jako("import", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin)
          VALUES (${rid}, 1, 'tresc z sejfu', 'proposed', 'vault-import') RETURNING id`);

        for (const kto of [null, "import", "api:5"]) {
          const e = await blad(
            kto === null
              ? sql`UPDATE rule_versions SET status = 'approved', ruleset_version = 1 WHERE id = ${v.id}`
              : jako(kto, (tx) => tx`UPDATE rule_versions SET status = 'approved', ruleset_version = 1 WHERE id = ${v.id}`),
          );
          expect(e.code, `aktor ${kto}`).toBe("TJ403");
        }
        const eRej = await blad(jako("api:5", (tx) => tx`UPDATE rule_versions SET status = 'rejected' WHERE id = ${v.id}`));
        expect(eRej.code).toBe("TJ403");
        // INSERT od razu jako approved tez przez UI
        const rid2 = await nowaRegula();
        const eIns = await blad(jako("import", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, ruleset_version)
          VALUES (${rid2}, 1, 'x', 'approved', 'vault-import', 1)`));
        expect(eIns.code).toBe("TJ403");

        // z UI przechodzi
        await jako("ui", (tx) => tx`
          UPDATE rule_versions SET status = 'approved', ruleset_version = 1, decided_at = now() WHERE id = ${v.id}`);
        const [po] = await sql`SELECT status FROM rule_versions WHERE id = ${v.id}`;
        expect(po.status).toBe("approved");

        // agent nie cofnie ani nie zastapi zatwierdzonej wersji
        const eBack = await blad(jako("api:5", (tx) => tx`
          UPDATE rule_versions SET status = 'proposed', ruleset_version = NULL WHERE id = ${v.id}`));
        expect(eBack.code).toBe("TJ403");
        const eSup = await blad(jako("api:5", (tx) => tx`
          UPDATE rule_versions SET status = 'superseded', superseded_at = now() WHERE id = ${v.id}`));
        expect(eSup.code).toBe("TJ403");

        // tresci wersji nie zmieni nawet UI
        const eTresc = await blad(jako("ui", (tx) => tx`UPDATE rule_versions SET text_md = 'podmiana' WHERE id = ${v.id}`));
        expect(eTresc.code).toBe("TJ409");
      });

      it("rule_versions: origin='ai' bez kontrargumentu -> CHECK; poniżej progu n -> TJ422; od progu -> OK", async () => {
        const rid = await nowaRegula();
        const hOk = await nowaHipoteza({ nImported: 20, progN: 20 });
        const eCheck = await blad(jako("api:5", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, evidence, hypothesis_id)
          VALUES (${rid}, 1, 'regula AI', 'proposed', 'ai', '{"n":20}'::jsonb, ${hOk})`));
        expect(eCheck.code).toBe("23514");
        expect(eCheck.constraint_name).toBe("rule_versions_ai_proof");
        // pusty kontrargument tez nie
        const ePusty = await blad(jako("api:5", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, counterargument, evidence, hypothesis_id)
          VALUES (${rid}, 1, 'regula AI', 'proposed', 'ai', '', '{"n":20}'::jsonb, ${hOk})`));
        expect(ePusty.constraint_name).toBe("rule_versions_ai_proof");
        // bez hipotezy tez nie
        const eBezH = await blad(jako("api:5", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, counterargument, evidence)
          VALUES (${rid}, 1, 'regula AI', 'proposed', 'ai', 'kontra', '{"n":20}'::jsonb)`));
        expect(eBezH.constraint_name).toBe("rule_versions_ai_proof");

        const hNiski = await nowaHipoteza({ nImported: 19, progN: 20 });
        const eN = await blad(jako("api:5", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, counterargument, evidence, hypothesis_id)
          VALUES (${rid}, 1, 'regula AI', 'proposed', 'ai', 'kontra', '{"n":19}'::jsonb, ${hNiski})`));
        expect(eN.code).toBe("TJ422");
        expect(eN.message).toContain("n = 19");

        await jako("api:5", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, counterargument, evidence, hypothesis_id)
          VALUES (${rid}, 1, 'regula AI', 'proposed', 'ai', 'kontra', '{"n":20}'::jsonb, ${hOk})`);
        // FK RESTRICT: hipotezy uzytej w wersji reguly nie da sie skasowac
        const eDel = await blad(sql`DELETE FROM hypotheses WHERE id = ${hOk}`);
        expect(eDel.code).toBe("23503");
      });

      it("rule_versions: propozycja mentora bez progu n i bez hipotezy (n=0), ale z dowodem", async () => {
        const rid = await nowaRegula();
        const eBez = await blad(jako("api:5", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin)
          VALUES (${rid}, 1, 'wg mentora', 'proposed', 'mentor')`));
        expect(eBez.constraint_name).toBe("rule_versions_mentor_proof");
        await jako("api:5", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, evidence)
          VALUES (${rid}, 1, 'wg mentora', 'proposed', 'mentor', '{"quote":"...","video":"x","t":12}'::jsonb)`);
        // jedna propozycja naraz na regule
        const eDruga = await blad(jako("api:5", (tx) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, evidence)
          VALUES (${rid}, 2, 'druga', 'proposed', 'mentor', '{"q":1}'::jsonb)`));
        expect(eDruga.code).toBe("23505");
      });

      it("bramka n liczy trade'y z trade_note_links, gdy tabela istnieje (galaz dynamiczna; tabela-zaslepka w wycofanej transakcji)", async () => {
        await wycofywalna(async (tx) => {
          await tx`CREATE TABLE trade_note_links (trade_id integer NOT NULL, note_id integer NOT NULL, role text NOT NULL)`;
          const hid = await nowaHipoteza({ nImported: 17, progN: 20 }, tx);
          const [h] = await tx`SELECT note_id FROM hypotheses WHERE id = ${hid}`;
          const t1 = await nowyTrade(tx);
          const t2 = await nowyTrade(tx);
          const t3 = await nowyTrade(tx);
          const tOtwarty = await nowyTrade(tx);
          await tx`UPDATE trades SET status = 'open' WHERE id = ${tOtwarty}`;
          for (const t of [t1, t2, tOtwarty]) {
            await tx`INSERT INTO trade_note_links VALUES (${t}, ${h.note_id}, 'hypothesis')`;
          }
          await tx`INSERT INTO trade_note_links VALUES (${t3}, ${h.note_id}, 'concept')`; // zla rola
          const [n] = await tx`SELECT public.tj_hypothesis_n(${hid}) AS n`;
          expect(n.n).toBe(19); // 17 + 2 zamkniete, bez otwartego i bez roli concept
          await tx`UPDATE trade_note_links SET role = 'hypothesis' WHERE trade_id = ${t3}`;
          const [n2] = await tx`SELECT public.tj_hypothesis_n(${hid}) AS n`;
          expect(n2.n).toBe(20);
        });
        // po wycofaniu tabela-zaslepka nie istnieje, a n = n_imported
        const hid = await nowaHipoteza({ nImported: 5, progN: 20 });
        const [n] = await sql`SELECT public.tj_hypothesis_n(${hid}) AS n`;
        expect(n.n).toBe(5);
      });

      it("hypotheses: zmiana decision tylko z UI; INSERT z decyzja inna niz active tez", async () => {
        const hid = await nowaHipoteza({ nImported: 0, progN: 20 });
        const e1 = await blad(sql`UPDATE hypotheses SET decision = 'confirmed' WHERE id = ${hid}`);
        expect(e1.code).toBe("TJ403");
        const e2 = await blad(jako("api:5", (tx) => tx`UPDATE hypotheses SET decision = 'rejected' WHERE id = ${hid}`));
        expect(e2.code).toBe("TJ403");
        // inne pola agent zmieniac moze
        await jako("api:5", (tx) => tx`UPDATE hypotheses SET n_imported = 3 WHERE id = ${hid}`);
        await jako("ui", (tx) => tx`UPDATE hypotheses SET decision = 'confirmed', decided_at = now() WHERE id = ${hid}`);
        const e3 = await blad(jako("api:5", (tx) => tx`UPDATE hypotheses SET decision = 'active' WHERE id = ${hid}`));
        expect(e3.code).toBe("TJ403");
        const nid = await nowaNotatka(sql, unik("H z decyzja"), { kind: "hypothesis" });
        const e4 = await blad(jako("api:5", (tx) => tx`
          INSERT INTO hypotheses (code, note_id, decision) VALUES ('H-9999', ${nid}, 'confirmed')`));
        expect(e4.code).toBe("TJ403");
      });

      it("api_tokens: zakresu 'approve' nie da sie zapisac; device_codes pilnuja stanow", async () => {
        const wstaw = (scopes: string[], prefix: string) =>
          sql`INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via)
              VALUES ('t', ${prefix}, ${sha256Node(prefix + unik("s"))}, ${"{" + scopes.join(",") + "}"}::text[], 'device_code')`;
        expect((await blad(wstaw(["read", "approve"], "zzzz0001"))).constraint_name).toBe("api_tokens_scopes");
        expect((await blad(wstaw(["approve"], "zzzz0002"))).constraint_name).toBe("api_tokens_scopes");
        expect((await blad(wstaw([], "zzzz0003"))).constraint_name).toBe("api_tokens_scopes");
        expect((await blad(wstaw(["read", "write", "propose", "read"], "zzzz0004"))).constraint_name).toBe("api_tokens_scopes");
        await wstaw(["read", "write", "propose"], "zzzz0005");

        const kod = (u: string) =>
          sql`INSERT INTO device_codes (device_code_sha256, user_code, client_name, requested_scopes, expires_at)
              VALUES (${sha256Node(u)}, ${u}, 'tj', ARRAY['read'], now() + interval '10 minutes')`;
        expect((await blad(kod("KTWM-4HQP"))).constraint_name).toBe("device_codes_user_code");
        await kod("KTWM-HQPB");
        // granted_scopes bez approved_at oraz consumed bez tokenu odpadaja
        const e1 = await blad(sql`UPDATE device_codes SET granted_scopes = ARRAY['read'] WHERE user_code = 'KTWM-HQPB'`);
        expect(e1.constraint_name).toBe("device_codes_granted_when_approved");
        const e2 = await blad(sql`UPDATE device_codes SET consumed_at = now() WHERE user_code = 'KTWM-HQPB'`);
        expect(e2.constraint_name).toBe("device_codes_consumed");
        const e3 = await blad(sql`
          UPDATE device_codes SET approved_at = now(), granted_scopes = ARRAY['write'] WHERE user_code = 'KTWM-HQPB'`);
        expect(e3.constraint_name).toBe("device_codes_granted_scopes");
      });

      it("screenshots: dokladnie jeden wlasciciel z trzech (trade, dzien, notatka)", async () => {
        const nid = await nowaNotatka(sql, unik("Przyklad ICT"), { kind: "concept" });
        const tid = await nowyTrade(sql);
        const wstaw = (kolumny: string, wartosci: string) =>
          sql.unsafe(`INSERT INTO screenshots (file, ${kolumny}) VALUES ('f.webp', ${wartosci})`);
        await wstaw("note_id", String(nid));
        expect((await blad(wstaw("note_id, trade_id", `${nid}, ${tid}`))).constraint_name).toBe("screenshots_owner");
        expect((await blad(sql.unsafe(`INSERT INTO screenshots (file) VALUES ('f.webp')`))).constraint_name).toBe("screenshots_owner");
        expect((await blad(wstaw("note_id, sha256", `${nid}, 'nie-hex'`))).constraint_name).toBe("screenshots_sha256");
        // kasowana notatka zabiera swoje zrzuty
        await sql`DELETE FROM notes WHERE id = ${nid}`;
        expect((await sql`SELECT 1 FROM screenshots WHERE note_id = ${nid}`).length).toBe(0);
        await sql`DELETE FROM trades WHERE id = ${tid}`;
      });

      it("notes: kind/slug/origin/tytul pilnowane CHECK-ami; slug i tytul unikalne", async () => {
        const tytul = unik("Unikat");
        await nowaNotatka(sql, tytul);
        const wstaw = (kind: string, slug: string, title: string, origin = "user") =>
          sql`INSERT INTO notes (kind, slug, title, origin) VALUES (${kind}, ${slug}, ${title}, ${origin})`;
        expect((await blad(wstaw("nieznany", unik("s"), unik("t")))).constraint_name).toBe("notes_kind");
        expect((await blad(wstaw("concept", "Zly Slug", unik("t")))).constraint_name).toBe("notes_slug");
        expect((await blad(wstaw("concept", unik("s"), unik("t"), "robot"))).constraint_name).toBe("notes_origin");
        expect((await blad(wstaw("concept", unik("s"), ""))).constraint_name).toBe("notes_title");
        const eTytul = await blad(wstaw("concept", unik("s"), tytul.toUpperCase()));
        expect(eTytul.code).toBe("23505");
        expect(eTytul.constraint_name).toBe("notes_title_norm_idx");
      });
    });

    /* ------------------------------------------------------------------ (c) */
    describe("(c) f_unaccent i wyszukiwanie", () => {
      it("f_unaccent('Zarządzanie łódź') = 'Zarzadzanie lodz'; IMMUTABLE PARALLEL SAFE STRICT", async () => {
        const [r] = await sql`SELECT public.f_unaccent('Zarządzanie łódź') AS a, public.f_unaccent('ŁÓDŹ Żółć') AS b`;
        expect(r.a).toBe("Zarzadzanie lodz");
        expect(r.b).toBe("LODZ Zolc");
        const [p] = await sql`
          SELECT provolatile, proparallel, proisstrict, prosrc FROM pg_proc WHERE proname = 'f_unaccent'`;
        expect(p.provolatile).toBe("i");
        expect(p.proparallel).toBe("s");
        expect(p.proisstrict).toBe(true);
        expect(p.prosrc).toContain("public.unaccent('public.unaccent'::regdictionary");
        const [nul] = await sql`SELECT public.f_unaccent(NULL) IS NULL AS ok`;
        expect(nul.ok).toBe(true);
      });

      it("pelnotekstowo: 'zarzadzanie' znajduje 'Zarządzanie' (tytul, tresc, user_words) i odwrotnie", async () => {
        await nowaNotatka(sql, "Zarządzanie ryzykiem (c)", { body: "Reguły zarządzania kapitałem" });
        await nowaNotatka(sql, "Plan dnia (c)", { body: "Kontrola zarządzanie pozycją" });
        await nowaNotatka(sql, "Zarzadzanie bez ogonkow (c)", { body: "x" });
        const tytuly = async (q: string) =>
          (
            await sql`
              SELECT title FROM notes
              WHERE search @@ websearch_to_tsquery('simple', public.f_unaccent(${q})) AND title LIKE '%(c)'
              ORDER BY title`
          ).map((r) => r.title as string);
        expect((await tytuly("zarzadzanie")).sort()).toEqual(
          ["Plan dnia (c)", "Zarządzanie ryzykiem (c)", "Zarzadzanie bez ogonkow (c)"].sort(),
        );
        expect(await tytuly("ZARZĄDZANIE")).toEqual(await tytuly("zarzadzanie"));
        // NFD: 'a' + ogonek (U+0328), tak jak z nazw plikow macOS
        expect(await tytuly("zarządzanie")).toEqual(await tytuly("zarzadzanie"));
        // zapisany tekst w NFD tez jest znajdowany
        await nowaNotatka(sql, "Zarządzanie w NFD (c)", { body: "x" });
        expect((await tytuly("zarzadzanie")).length).toBe(4);

        await sql`INSERT INTO user_words (text, source, captured_at) VALUES ('Zarządzanie ryzykiem było złe', 'chat', now())`;
        const slowa = await sql`
          SELECT 1 FROM user_words WHERE search @@ websearch_to_tsquery('simple', public.f_unaccent('zarzadzanie')) `;
        expect(slowa.length).toBeGreaterThan(0);
        const waga = await sql`
          SELECT ts_rank(search, websearch_to_tsquery('simple', 'ryzykiem')) AS r FROM notes WHERE title LIKE 'Zarządzanie ryzykiem (c)'`;
        expect(Number(waga[0].r)).toBeGreaterThan(0);
      });

      it("trigramowo: 'zarzadzanie' (i literowka) znajduje 'Zarządzanie' przez % oraz ILIKE na tym samym wyrazeniu", async () => {
        const dopasowania = async (warunek: string, q: string) =>
          (
            await sql.unsafe(
              `SELECT title FROM notes WHERE ${warunek} AND title LIKE '%(c)' ORDER BY title`,
              [q],
            )
          ).map((r) => r.title as string);
        const podobne = await dopasowania("lower(public.f_unaccent(title)) % lower(public.f_unaccent($1))", "zarzadzanie");
        expect(podobne).toContain("Zarządzanie ryzykiem (c)");
        expect(podobne).toContain("Zarzadzanie bez ogonkow (c)");
        const literowka = await dopasowania("lower(public.f_unaccent(title)) % lower(public.f_unaccent($1))", "zarzadzanei ryzykiem");
        expect(literowka).toContain("Zarządzanie ryzykiem (c)");
        const ilike = await dopasowania("lower(public.f_unaccent(title)) ILIKE '%' || lower(public.f_unaccent($1)) || '%'", "ZARZĄDZANIE");
        expect(ilike).toContain("Zarządzanie ryzykiem (c)");
        const wTresci = await dopasowania("lower(public.f_unaccent(body_md)) ILIKE '%' || lower(public.f_unaccent($1)) || '%'", "zarządzania kapitalem");
        expect(wTresci).toContain("Zarządzanie ryzykiem (c)");
      });

      it("indeksy GIN sa faktycznie uzywane przez te zapytania (EXPLAIN z wylaczonym seqscan)", async () => {
        const plan = async (zapytanie: string) => {
          let tekst = "";
          await wycofywalna(async (tx) => {
            await tx`SET LOCAL enable_seqscan = off`;
            const w = await tx.unsafe(`EXPLAIN ${zapytanie}`);
            tekst = w.map((r) => r["QUERY PLAN"]).join("\n");
          });
          return tekst;
        };
        expect(await plan("SELECT 1 FROM notes WHERE search @@ websearch_to_tsquery('simple', public.f_unaccent('zarzadzanie'))")).toContain("notes_search_idx");
        expect(await plan("SELECT 1 FROM notes WHERE lower(public.f_unaccent(title)) % lower(public.f_unaccent('zarzadzanie'))")).toContain("notes_title_trgm_idx");
        expect(await plan("SELECT 1 FROM notes WHERE lower(public.f_unaccent(body_md)) ILIKE '%zarzadz%'")).toContain("notes_body_trgm_idx");
        expect(await plan("SELECT 1 FROM user_words WHERE search @@ websearch_to_tsquery('simple', 'x')")).toContain("user_words_search_idx");
        expect(await plan("SELECT 1 FROM notes WHERE lower(public.f_unaccent(title)) = 'zarzadzanie ryzykiem'")).toContain("notes_title_norm_idx");
      });
    });

    /* ------------------------------------------------------------------ (d) */
    describe("(d) slowa uzytkownika bajt w bajt", () => {
      const przypadki: Record<string, string> = {
        "polskie znaki": "Zażółć gęślą jaźń. ŁÓDŹ, ĆŚŻ.",
        emoji: "📈 wejście 🚀 👨‍👩‍👧 🇵🇱 ❤️",
        "nowe linie LF": "linia 1\nlinia 2\n\nlinia 4\n",
        "CRLF ze schowka Windows": "a\r\nb\r\n\r\nc",
        "samo CR": "a\rb",
        "NFD (ł nie rozklada sie)": "Zażółć gęślą".normalize("NFD"),
        "spacje i tabulatory na brzegach": "  \t spacje \t \n ",
        "BOM w srodku": "przed﻿po",
        "pojedynczy znak": "ą",
        "cudzyslowy i backslash": "\"x\" 'y' \\n \\ $1 $$ -- komentarz --> statement-breakpoint",
        "dlugi tekst": "zażółć ".repeat(5000),
      };

      for (const [nazwa, tekst] of Object.entries(przypadki)) {
        it(`${nazwa}: sha256 i byte_len w bazie == z bajtow UTF-8 w Node; tekst wraca bez zmian`, async () => {
          const [w] = await sql`
            INSERT INTO user_words (text, source, captured_at) VALUES (${tekst}, 'chat', now())
            RETURNING id, sha256, byte_len`;
          expect(w.sha256).toBe(sha256Node(tekst));
          expect(w.byte_len).toBe(Buffer.byteLength(tekst, "utf8"));
          const [odczyt] = await sql`SELECT text, encode(convert_to(text, 'UTF8'), 'hex') AS hex FROM user_words WHERE id = ${w.id}`;
          expect(Buffer.from(odczyt.text as string, "utf8").equals(Buffer.from(tekst, "utf8"))).toBe(true);
          expect(odczyt.hex).toBe(Buffer.from(tekst, "utf8").toString("hex"));
          // skrot obliczony przez sama baze z zapisanego tekstu tez sie zgadza
          const [wBazie] = await sql`SELECT encode(sha256(convert_to(text, 'UTF8')), 'hex') AS h FROM user_words WHERE id = ${w.id}`;
          expect(wBazie.h).toBe(w.sha256);
        });
      }

      it("NFC i NFD tego samego napisu maja rozne skroty (zadnej normalizacji)", async () => {
        const nfc = "Zażółć gęślą jaźń".normalize("NFC");
        const nfd = nfc.normalize("NFD");
        expect(nfc).not.toBe(nfd);
        const [a] = await sql`INSERT INTO user_words (text, source, captured_at) VALUES (${nfc}, 'chat', now()) RETURNING sha256`;
        const [b] = await sql`INSERT INTO user_words (text, source, captured_at) VALUES (${nfd}, 'chat', now()) RETURNING sha256`;
        expect(a.sha256).not.toBe(b.sha256);
        expect(a.sha256).toBe(sha256Node(nfc));
        expect(b.sha256).toBe(sha256Node(nfd));
      });

      it("pusty tekst odrzuca CHECK; bajt NUL odrzuca Postgres (API ma to zlapac wczesniej: 400, nie 500)", async () => {
        const ePusty = await blad(sql`INSERT INTO user_words (text, source, captured_at) VALUES ('', 'chat', now())`);
        expect(ePusty.code).toBe("23514"); // user_words_text i user_words_byte_len
        const eNul = await blad(sql`INSERT INTO user_words (text, source, captured_at) VALUES (${"a\u0000b"}, 'chat', now())`);
        expect(eNul.code).toBe("22021");
      });
    });

    /* ------------------------------------------------------------------ (e) */
    describe("(e) odwracalnosc", () => {
      it("0018_down i 0017_down przywracaja stan sprzed, a ponowne migracje daja identyczny katalog", async () => {
        const przed = await odcisk();
        const admin = postgres(url, { max: 1, onnotice: () => {} });
        try {
          const down18 = readFileSync(path.join(ROOT, "docs", "v2", "rollback", "0018_down.sql"), "utf8");
          const down17 = readFileSync(path.join(ROOT, "docs", "v2", "rollback", "0017_down.sql"), "utf8");
          await admin.begin(async (tx) => {
            await tx.unsafe(down18);
          });
          const tabele18 = await admin`
            SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
              AND relname IN ('notes', 'note_revisions', 'note_links', 'user_words', 'hypotheses', 'rules', 'rule_versions')`;
          expect(tabele18.length).toBe(0);
          const kol = await admin`
            SELECT 1 FROM information_schema.columns WHERE table_name = 'screenshots' AND column_name IN ('note_id', 'sha256', 'captured_at', 'chart_state')
            UNION ALL SELECT 1 FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'ruleset_version'`;
          expect(kol.length).toBe(0);
          const [owner] = await admin`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'screenshots_owner'`;
          expect(owner.d).toContain("(trade_id IS NULL) <> (day_note_id IS NULL)");
          const fun = await admin`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'tj\\_%' AND proname <> 'tj_forbid_update'`;
          expect(fun.map((f) => f.proname)).toEqual([]);

          await admin.begin(async (tx) => {
            await tx.unsafe(down17);
          });
          const tabele17 = await admin`
            SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname IN ('api_tokens', 'device_codes')`;
          expect(tabele17.length).toBe(0);
          const wpisy = await admin`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= 1787620000000`;
          expect(wpisy.length).toBe(0);
        } finally {
          await admin.end();
        }
        // ponowne zastosowanie przez scripts/migrate.mjs
        const wyjscie = migrateSkryptem();
        expect(wyjscie).toContain("0017_api_tokens");
        expect(wyjscie).toContain("0018_notatki");
        expect(await odcisk()).toBe(przed);
      }, 120_000);
    });
  });
}
