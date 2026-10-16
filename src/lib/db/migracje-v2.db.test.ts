/**
 * Dowod na prawdziwej bazie dla migracji 0017-0027 (ADR-029, ADR-030, ADR-033):
 *  (a) migracje od zera daja to samo, co deklaruje schema.ts,
 *  (b) triggery niezmiennosci, zatwierdzen i bramki n (0018),
 *  (f) presety prop z badania: 138 wierszy zgodnych z JSON-em bajt w bajt (0024),
 *  (b2) playbook, kolejka AI, dopiski (0020), (b3) plan zamrozony, werdykt niezmienny, rytual dnia (0021),
 *  (b4) hipotezy, prop, przeglad tygodnia, wykres, slownik, mentor (0022-0027),
 *  (g) kasowanie trade'u nie jest blokowane przez nowe ograniczenia i triggery,
 *  (c) f_unaccent i wyszukiwanie ("zarzadzanie" znajduje "Zarzadzanie"),
 *  (d) slowa uzytkownika bajt w bajt (skrot w bazie == skrot z Node),
 *  (e) odwracalnosc (skrypty docs/v2/rollback/*.sql): po kazdym cofnieciu katalog bazy == katalog po poprzedniej
 *      migracji, potem ponowne zastosowanie.
 *
 * Asercje negatywne triggerow idą przez trigger(): blad MUSI pochodzic z tego triggera (po jego wylaczeniu
 * ta sama akcja przechodzi), wiec test czerwieni sie na zepsutym albo usunietym triggerze.
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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
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
      // Kopie danych sprzed migracji 0029 (scalenie notatek dnia) leza w osobnym schemacie.
      await admin.unsafe("DROP SCHEMA IF EXISTS tj_kopie CASCADE");
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

  /* ---- pomocnicze dla migracji 0020-0027 ---------------------------------------- */

  type Tx = postgres.TransactionSql;

  /**
   * Dowod, ze ASERCJA NEGATYWNA naprawde sprawdza trigger: akcja ma (1) paść z podanym SQLSTATE,
   * a (2) po wylaczeniu TEGO triggera (w transakcji, ktora i tak sie wycofuje) przejsc bez bledu.
   * Gdyby blad pochodzil z czegos innego (CHECK, FK, literowka w danych), druga faza by padla,
   * a gdyby trigger zniknal albo zepsul sie warunek, padnie pierwsza.
   */
  async function trigger(
    tabela: string,
    nazwa: string,
    kod: string,
    akcja: (tx: Tx) => Promise<unknown>,
    fragment?: string,
  ) {
    const w: { e?: Blad } = {};
    await wycofywalna(async (tx) => {
      w.e = await blad(akcja(tx));
    });
    expect(w.e?.code, `${tabela} / ${nazwa}: SQLSTATE (komunikat: ${w.e?.message})`).toBe(kod);
    if (fragment) expect(w.e?.message, `${tabela} / ${nazwa}: komunikat`).toContain(fragment);
    try {
      await wycofywalna(async (tx) => {
        await tx.unsafe(`ALTER TABLE ${tabela} DISABLE TRIGGER ${nazwa}`);
        await akcja(tx);
      });
    } catch (e) {
      throw new Error(
        `${tabela} / ${nazwa}: akcja pada tez po wylaczeniu triggera (${(e as Error).message}), wiec blad nie pochodzi z tego triggera`,
      );
    }
  }

  /** Akcja jako dany aktor (set_config lokalny dla transakcji, jak w API). */
  const jakoAktor =
    (kto: string, fn: (tx: Tx) => Promise<unknown>) =>
    async (tx: Tx) => {
      await aktor(tx, kto);
      return fn(tx);
    };

  async function kontoInstr(db: Db) {
    const [a] = await db`INSERT INTO accounts (name) VALUES (${unik("konto")}) RETURNING id`;
    const [i] = await db`
      INSERT INTO instruments (symbol, name, tick_size, tick_value)
      VALUES (${unik("SYM")}, 'Test', 0.25, 5000) RETURNING id`;
    return { accountId: a.id as number, instrumentId: i.id as number };
  }
  type KI = Awaited<ReturnType<typeof kontoInstr>>;

  async function tradeDla(db: Db, k: KI, status = "closed"): Promise<number> {
    const [t] = await db`
      INSERT INTO trades (account_id, instrument_id, direction, entry_time, entry_price, contracts, status)
      VALUES (${k.accountId}, ${k.instrumentId}, 'long', now(), 100, 1, ${status}::trade_status) RETURNING id`;
    return t.id as number;
  }

  async function slowa(
    db: Db,
    tekst: string,
    o: { tradeId?: number | null; day?: string | null; source?: string } = {},
  ): Promise<number> {
    const [w] = await db`
      INSERT INTO user_words (text, source, captured_at, trade_id, day)
      VALUES (${tekst}, ${o.source ?? "ui"}, now(), ${o.tradeId ?? null}, ${o.day ?? null}) RETURNING id`;
    return w.id as number;
  }

  async function nowyToken(db: Db): Promise<number> {
    const [t] = await db`
      INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via)
      VALUES ('2b', ${"tb" + String(100000 + ++seq)}, ${sha256Node(unik("tok"))}, ARRAY['read','write'], 'ui')
      RETURNING id`;
    return t.id as number;
  }

  async function nowySetup(db: Db): Promise<{ setupId: number; noteId: number }> {
    const noteId = await nowaNotatka(db, unik("Karta setupu"), { kind: "setup" });
    const [s] = await db`
      INSERT INTO setups (slug, name, note_id) VALUES (${unik("setup")}, 'Setup testowy', ${noteId}) RETURNING id`;
    return { setupId: s.id as number, noteId };
  }

  async function wersjaSetupu(db: Db, setupId: number, version = 1): Promise<number> {
    const [v] = await db`
      INSERT INTO setup_versions (setup_id, version, status, thresholds, origin)
      VALUES (${setupId}, ${version}, 'proposed', '{"min_n":20}'::jsonb, 'user') RETURNING id`;
    return v.id as number;
  }

  async function nowaHipotezaDb(db: Db, nImported = 0, progN = 20): Promise<{ id: number; noteId: number }> {
    const noteId = await nowaNotatka(db, unik("Hipoteza 2b"), { kind: "hypothesis" });
    const [h] = await db`
      INSERT INTO hypotheses (code, note_id, prog_n, n_imported)
      VALUES (${"H-" + String(5000 + ++seq)}, ${noteId}, ${progN}, ${nImported}) RETURNING id`;
    return { id: h.id as number, noteId };
  }

  async function nowaSesja(db: Db): Promise<number> {
    const [s] = await db`INSERT INTO backtest_sessions (name) VALUES (${unik("sesja")}) RETURNING id`;
    return s.id as number;
  }

  /** Werdykt AI z dowodem (as_of + skrot) albo stary, bez dowodu. */
  async function werdykt(
    db: Db,
    tradeId: number,
    o: { basis?: string; asOf?: boolean; kind?: string; overrides?: number | null } = {},
  ): Promise<number> {
    const asOf = o.asOf ?? true;
    const [r] = await db`
      INSERT INTO trade_reviews (trade_id, basis, summary_md, kind, overrides_review_id, as_of, evidence_hash)
      VALUES (${tradeId}, ${o.basis ?? "chart"}, 'ocena', ${o.kind ?? "ai"}, ${o.overrides ?? null},
              CASE WHEN ${asOf}::boolean THEN now() END, ${asOf ? sha256Node(unik("dowod")) : null})
      RETURNING id`;
    return r.id as number;
  }

  /** Pelny werdykt AI z jednym sprawdzeniem reguly, wstawiony TA SAMA transakcja. */
  const werdyktZSprawdzeniem = async (tx: Db, tradeId: number, basis = "chart", ruleId = "R-001") => {
    const rid = await werdykt(tx, tradeId, { basis });
    await tx`INSERT INTO trade_rule_checks (review_id, rule_id, rule_text, verdict) VALUES (${rid}, ${ruleId}, 'regula', 'pass')`;
    return rid;
  };



  describe("migracje 0017-0032 na prawdziwej bazie", () => {
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
      expect(wyjscie1).toContain("0032_firmy_platformy");
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
          // unikat zadeklarowany na kolumnie: `text().unique("nazwa")` (tak robi faza 1 w auth_backup_codes)
          for (const c of cfg.columns) {
            if (c.isUnique && c.uniqueName) schemat.set(c.uniqueName, { uniq: true, czesciowy: false, metoda: "btree" });
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

      /**
       * Pulapka z modelu (sekcja 6): FK ON DELETE SET NULL / SET DEFAULT to UPDATE kolumny, wiec na
       * tabeli pod ochrona triggera blokuje kasowanie rodzica. Naruszeniem jest SET NULL na kolumnie
       * chronionej: w tabeli z tj_forbid_update (kazda kolumna), tj_guard_columns (kolumny z argumentow
       * triggera), albo z funkcja chroniaca caly wiersz. Kolumny pod tj_guard_null_only wolno tylko
       * zerowac, wiec SET NULL jest tam dozwolony.
       */
      async function naruszeniaSetNull(db: Db): Promise<string[]> {
        const fk = await db`
          SELECT c.conrelid AS rel, c.conrelid::regclass::text AS tabela, c.conname, a.attname AS kolumna
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND c.confdeltype IN ('n', 'd') AND c.connamespace = 'public'::regnamespace`;
        const triggery = await db`
          SELECT t.tgrelid AS rel, p.proname AS funkcja, encode(t.tgargs, 'escape') AS argumenty
          FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal`;
        const calyWiersz = ["tj_plan_guard", "tj_rule_check_guard"];
        const wynik = new Set<string>();
        for (const f of fk) {
          for (const t of triggery.filter((x) => x.rel === f.rel)) {
            const argumenty = (t.argumenty as string).split("\\000");
            const chroni =
              t.funkcja === "tj_forbid_update" ||
              calyWiersz.includes(t.funkcja as string) ||
              (t.funkcja === "tj_guard_columns" && argumenty.includes(f.kolumna as string));
            if (chroni) wynik.add(`${f.tabela}.${f.kolumna} (${f.conname}) pod ${t.funkcja}`);
          }
        }
        return [...wynik].sort();
      }

      it("tabele niezmienne nie maja FK z SET NULL / SET DEFAULT na chronionych kolumnach (pulapka z modelu, sekcja 6)", async () => {
        expect(await naruszeniaSetNull(sql)).toEqual([]);
        // wyjatki sa celowe: kolumny pod tj_guard_null_only i kolumny poza lista tj_guard_columns
        const setNull = await sql`
          SELECT c.conrelid::regclass::text AS tabela, a.attname AS kolumna FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND c.confdeltype = 'n' AND c.conrelid IN ('note_additions'::regclass, 'mentor_claims'::regclass)
          ORDER BY 1, 2`;
        expect(setNull.map((r) => `${r.tabela}.${r.kolumna}`)).toEqual([
          "mentor_claims.merged_note_id",
          "mentor_claims.setup_id",
          "note_additions.quote_words_id",
          "note_additions.trade_id",
        ]);
      });

      it("kontrola pulapki czerwieni sie na zepsutym schemacie: SET NULL na chronionej kolumnie jest wykrywany", async () => {
        await wycofywalna(async (tx) => {
          await tx.unsafe(`ALTER TABLE note_additions DROP CONSTRAINT note_additions_suggestion_id_fkey,
            ADD FOREIGN KEY (suggestion_id) REFERENCES ai_suggestions (id) ON DELETE SET NULL`);
          await tx.unsafe(`ALTER TABLE trade_plans DROP CONSTRAINT trade_plans_thesis_words_id_fkey,
            ADD FOREIGN KEY (thesis_words_id) REFERENCES user_words (id) ON DELETE SET NULL`);
          await tx.unsafe(`ALTER TABLE interpretation_corrections DROP CONSTRAINT interpretation_corrections_term_id_fkey,
            ADD FOREIGN KEY (term_id) REFERENCES profile_terms (id) ON DELETE SET NULL`);
          const naruszenia = await naruszeniaSetNull(tx);
          expect(naruszenia.map((n) => n.split(" ")[0])).toEqual([
            "interpretation_corrections.term_id",
            "note_additions.suggestion_id",
            "trade_plans.thesis_words_id",
          ]);
        });
      });

      it("FK do user_words z wierszy, ktore gina razem z trade'em, sa odroczone (kolejnosc kaskad nie moze blokowac kasowania); reszta FK jest natychmiastowa", async () => {
        const wiersze = await sql`
          SELECT c.conrelid::regclass::text || '.' || a.attname AS kolumna, c.condeferrable, c.condeferred, c.confdeltype
          FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND (c.condeferrable OR c.condeferred)
          ORDER BY 1`;
        expect(wiersze.map((r) => r.kolumna)).toEqual([
          "chart_annotations.words_id",
          "interpretation_corrections.correction_words_id",
          "setup_examples.caption_words_id",
          "trade_plan_addenda.words_id",
          "trade_plans.invalidation_words_id",
          "trade_plans.thesis_words_id",
        ]);
        for (const r of wiersze) {
          expect(r.condeferred, r.kolumna).toBe(true);
          expect(r.confdeltype, r.kolumna).toBe("a"); // NO ACTION
        }
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

      it("bramka n liczy trade'y z trade_note_links (tylko zamkniete, tylko rola hypothesis); po wycofaniu n = n_imported", async () => {
        await wycofywalna(async (tx) => {
          const hid = await nowaHipoteza({ nImported: 17, progN: 20 }, tx);
          const [h] = await tx`SELECT note_id FROM hypotheses WHERE id = ${hid}`;
          const t1 = await nowyTrade(tx);
          const t2 = await nowyTrade(tx);
          const t3 = await nowyTrade(tx);
          const tOtwarty = await nowyTrade(tx);
          await tx`UPDATE trades SET status = 'open' WHERE id = ${tOtwarty}`;
          for (const t of [t1, t2, tOtwarty]) {
            await tx`INSERT INTO trade_note_links (trade_id, note_id, role, origin) VALUES (${t}, ${h.note_id}, 'hypothesis', 'user')`;
          }
          await tx`INSERT INTO trade_note_links (trade_id, note_id, role, origin) VALUES (${t3}, ${h.note_id}, 'concept', 'user')`; // zla rola
          const [n] = await tx`SELECT public.tj_hypothesis_n(${hid}) AS n`;
          expect(n.n).toBe(19); // 17 + 2 zamkniete, bez otwartego i bez roli concept
          await tx`UPDATE trade_note_links SET role = 'hypothesis' WHERE trade_id = ${t3}`;
          const [n2] = await tx`SELECT public.tj_hypothesis_n(${hid}) AS n`;
          expect(n2.n).toBe(20);
        });
        // po wycofaniu linkow nie ma, a n = n_imported
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

      it("tj_forbid_update (0016 -> 0018): jedna funkcja, auth_events i note_revisions odrzucaja UPDATE tym samym kodem TJ409", async () => {
        const [{ ile }] = await sql`SELECT count(*)::int AS ile FROM pg_proc WHERE proname = 'tj_forbid_update'`;
        expect(ile).toBe(1); // CREATE OR REPLACE w 0018 nie zrobil drugiej, osobnej funkcji
        await sql`INSERT INTO auth_events (kind, detail) VALUES ('login_ok', '{}'::jsonb)`;
        const e1 = await blad(sql`UPDATE auth_events SET ip = 'x'`);
        expect(e1.code).toBe("TJ409");
        const nid = await nowaNotatka(sql, unik("Forbid"), { kind: "concept" });
        await sql`UPDATE notes SET body_md = 'v2' WHERE id = ${nid}`;
        const e2 = await blad(sql`UPDATE note_revisions SET title = 'x' WHERE note_id = ${nid}`);
        expect(e2.code).toBe("TJ409");
        // oba triggery wskazuja te sama funkcje
        const trigery = await sql`SELECT tgrelid::regclass::text AS tabela FROM pg_trigger WHERE tgfoid = 'public.tj_forbid_update'::regproc AND NOT tgisinternal ORDER BY 1`;
        expect(trigery.map((t) => t.tabela)).toEqual(expect.arrayContaining(["auth_events", "note_revisions"]));
      });

      it("auth_events.token_id ma klucz obcy do api_tokens (0019, NO ACTION): token z wpisami nie da sie skasowac", async () => {
        const [t] = await sql`INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via)
          VALUES ('fk', 'fkfkfk01', ${sha256Node("fk-token")}, ARRAY['read'], 'ui') RETURNING id`;
        await sql`INSERT INTO auth_events (kind, token_id) VALUES ('token_created', ${t.id})`;
        expect((await blad(sql`INSERT INTO auth_events (kind, token_id) VALUES ('token_created', 999999999)`)).code).toBe("23503");
        expect((await blad(sql`DELETE FROM api_tokens WHERE id = ${t.id}`)).code).toBe("23503");
        await sql`DELETE FROM auth_events WHERE token_id = ${t.id}`;
        await sql`DELETE FROM api_tokens WHERE id = ${t.id}`;
      });

      it("api_tokens: zakresu 'approve' nie da sie zapisac; device_codes pilnuja stanow", async () => {
        const wstaw = (scopes: string[], prefix: string) =>
          sql`INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via)
              VALUES ('t', ${prefix}, ${sha256Node(prefix + unik("s"))}, ${"{" + scopes.join(",") + "}"}::text[], 'device_code')`;
        expect((await blad(wstaw(["read", "approve"], "zzzz0001"))).constraint_name).toBe("api_tokens_scopes");
        expect((await blad(wstaw(["approve"], "zzzz0002"))).constraint_name).toBe("api_tokens_scopes");
        expect((await blad(wstaw([], "zzzz0003"))).constraint_name).toBe("api_tokens_scopes");
        expect((await blad(wstaw(["read", "write", "propose", "import", "read"], "zzzz0004"))).constraint_name).toBe("api_tokens_scopes");
        await wstaw(["read", "write", "propose"], "zzzz0005");
        // «import» (Slowa uzytkownika 15.10.2026) jest czwartym, dodatkowym zakresem tokenu
        await wstaw(["read", "write", "propose", "import"], "zzzz0006");

        const kod = (u: string) =>
          sql`INSERT INTO device_codes (device_code_sha256, user_code, client_name, requested_scopes, expires_at)
              VALUES (${sha256Node(u)}, ${u}, 'tj', ARRAY['read'], now() + interval '10 minutes')`;
        expect((await blad(kod("KTWM-4HQP"))).constraint_name).toBe("device_codes_user_code");
        await kod("KTWM-HQPB");
        // logowanie urzadzenia nigdy nie zna zakresu import: CHECK jest drugim zabezpieczeniem obok API
        const zImportem = await blad(sql`INSERT INTO device_codes (device_code_sha256, user_code, client_name, requested_scopes, expires_at)
          VALUES (${sha256Node("import-kod")}, 'BBBB-DDDD', 'tj', ARRAY['read', 'import'], now() + interval '10 minutes')`);
        expect(zImportem.constraint_name).toBe("device_codes_requested_scopes");
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

    /* ------------------------------------------------------------------ (f) */
    describe("(f) presety prop z badania (0024): dane bajt w bajt", () => {
      type Wiersz = Record<string, unknown> & { extra: Record<string, unknown> };
      const json = JSON.parse(readFileSync(path.join(ROOT, "docs", "research", "prop-presety.json"), "utf8")) as Wiersz[];

      it("138 wierszy, 9 firm, 76 do weryfikacji (needs_verification widoczne, nie ukryte)", async () => {
        const [r] = await sql`
          SELECT count(*)::int AS n, count(DISTINCT firm)::int AS firmy,
                 count(*) FILTER (WHERE needs_verification)::int AS do_weryfikacji,
                 count(*) FILTER (WHERE effective_from IS NOT NULL)::int AS z_data_wejscia
          FROM prop_firm_presets`;
        expect(r).toEqual({ n: 138, firmy: 9, do_weryfikacji: 76, z_data_wejscia: 0 });
        expect(json.length).toBe(138);
        expect(json.filter((w) => w.needs_verification).length).toBe(76);
      });

      it("KAZDY z 138 wierszy zgadza sie z JSON-em: kolumny liczbowe, daty, napisy (bajty UTF-8) i extra", async () => {
        const wBazie = await sql`
          SELECT id, firm, program, phase, account_size_cents::text AS account_size_cents, dd_type, max_dd_cents::text AS max_dd_cents,
                 dd_lock_cents::text AS dd_lock_cents, daily_loss_cents::text AS daily_loss_cents,
                 profit_target_cents::text AS profit_target_cents, consistency_pct::float8 AS consistency_pct,
                 min_days, max_contracts_mini, max_contracts_micro, fee_rt_mini_cents::text AS fee_rt_mini_cents, fee_rt_micro_cents::text AS fee_rt_micro_cents,
                 fee_source_url, source_url, read_on::text AS read_on,
                 needs_verification, effective_from, extra, notes,
                 encode(convert_to(firm, 'UTF8'), 'hex') AS firm_hex, encode(convert_to(program, 'UTF8'), 'hex') AS program_hex,
                 encode(convert_to(source_url, 'UTF8'), 'hex') AS url_hex, encode(convert_to(coalesce(notes, ''), 'UTF8'), 'hex') AS notes_hex,
                 encode(convert_to(extra::text, 'UTF8'), 'hex') AS extra_hex
          FROM prop_firm_presets ORDER BY id`;
        expect(wBazie.length).toBe(json.length);
        const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
        const liczbaLubNull = (v: unknown) => (v === null ? null : String(v));
        const roznice: string[] = [];
        wBazie.forEach((b, i) => {
          const w = json[i];
          const oznacz = (co: string) => roznice.push(`#${i + 1} ${String(w.firm)} / ${String(w.program)}: ${co}`);
          for (const kolumna of ["firm", "program", "phase", "dd_type", "source_url", "read_on"]) {
            if (b[kolumna] !== w[kolumna]) oznacz(`${kolumna}: baza=${String(b[kolumna])} json=${String(w[kolumna])}`);
          }
          for (const kolumna of ["account_size_cents", "max_dd_cents", "dd_lock_cents", "daily_loss_cents", "profit_target_cents"]) {
            if (b[kolumna] !== liczbaLubNull(w[kolumna])) oznacz(`${kolumna}: baza=${String(b[kolumna])} json=${String(w[kolumna])}`);
          }
          for (const kolumna of ["consistency_pct", "min_days", "max_contracts_mini", "max_contracts_micro"]) {
            if (b[kolumna] !== w[kolumna]) oznacz(`${kolumna}: baza=${String(b[kolumna])} json=${String(w[kolumna])}`);
          }
          for (const kolumna of ["fee_rt_mini_cents", "fee_rt_micro_cents"]) {
            if (b[kolumna] !== liczbaLubNull(w[kolumna])) oznacz(`${kolumna}: baza=${String(b[kolumna])} json=${String(w[kolumna])}`);
          }
          if ((b.fee_source_url ?? null) !== ((w.fee_source_url as string | null | undefined) ?? null)) oznacz("fee_source_url");
          if (b.needs_verification !== w.needs_verification) oznacz("needs_verification");
          if (b.effective_from !== null) oznacz("effective_from nie jest NULL");
          if ((b.notes ?? null) !== (w.notes ?? null)) oznacz(`notes: baza=${String(b.notes)} json=${String(w.notes)}`);
          if (b.firm_hex !== hex(w.firm as string) || b.program_hex !== hex(w.program as string)) oznacz("bajty firm / program");
          if (b.url_hex !== hex(w.source_url as string)) oznacz("bajty source_url");
          if (b.notes_hex !== hex((w.notes as string | null) ?? "")) oznacz("bajty notes");
          if (JSON.stringify(b.extra) !== JSON.stringify(w.extra) && !isDeepStrictEqual(b.extra, w.extra)) oznacz("extra (struktura)");
        });
        expect(roznice).toEqual([]);
        // tekst extra (po normalizacji jsonb) zawiera te same napisy co JSON: polskie znaki i cudzyslowy przezyly
        const polskie = json.filter((w) => /[^\x00-\x7f]/.test(JSON.stringify(w)));
        expect(polskie.length, "test ma obejmowac wiersze z polskimi znakami").toBeGreaterThan(10);
      });

      it("wiersze kontrolne: Topstep 50K Trading Combine i Lucid LucidPro funded 100K", async () => {
        const [ts] = await sql`
          SELECT dd_type, max_dd_cents, dd_lock_cents, profit_target_cents, consistency_pct::float8 AS c, max_contracts_mini, max_contracts_micro, extra
          FROM prop_firm_presets WHERE firm = 'Topstep' AND program = 'Trading Combine' AND phase = 'eval' AND account_size_cents = 5000000`;
        expect(ts).toMatchObject({ dd_type: "trailing_to_static", max_dd_cents: "200000", dd_lock_cents: "200000", profit_target_cents: "300000", c: 55, max_contracts_mini: 5, max_contracts_micro: 50 });
        expect(ts.extra).toMatchObject({ trail_basis: "eod", dll_optional_usd: 1000, consistency_basis: "best_day/total_profit" });
        const lucid = json.find((w) => w.firm === "Lucid Trading" && w.program === "LucidPro" && w.phase === "funded" && w.account_size_cents === 10000000);
        expect(lucid, "wiersz Lucid LucidPro funded 100K w JSON").toBeTruthy();
        const [l] = await sql`
          SELECT max_dd_cents::text AS max_dd_cents, dd_type, extra, notes FROM prop_firm_presets
          WHERE firm = 'Lucid Trading' AND program = 'LucidPro' AND phase = 'funded' AND account_size_cents = 10000000`;
        expect(l.max_dd_cents).toBe(String(lucid!.max_dd_cents));
        expect(l.dd_type).toBe(lucid!.dd_type);
        expect(l.extra).toEqual(lucid!.extra);
        expect(l.notes ?? null).toBe((lucid!.notes as string | null) ?? null);
      });
    });



    /* ------------------------------------------------------------------ (b2) */
    describe("(b2) faza 2b: playbook, kolejka AI, dopiski (0020)", () => {
      it("setup_versions: tresc niezmienna, status i decision_reason zmienne; approved / rejected / superseded tylko z UI", async () => {
        const { setupId } = await nowySetup(sql);
        const inny = await nowySetup(sql);
        const tokenId = await nowyToken(sql);
        const vid = await jako("api:5", (tx) => wersjaSetupu(tx, setupId));
        const zmiany: Record<string, string> = {
          setup_id: `setup_id = ${inny.setupId}`,
          version: "version = 2",
          preconditions: `preconditions = '[{"id":"a","text":"b"}]'::jsonb`,
          entry_checklist: `entry_checklist = '[{"id":"a","text":"b"}]'::jsonb`,
          stop_rule: "stop_rule = 'inny'",
          target_rule: "target_rule = 'inny'",
          be_rule: "be_rule = 'inny'",
          invalidation: "invalidation = 'inne'",
          avoid: "avoid = 'inne'",
          thresholds: `thresholds = '{"min_n":99}'::jsonb`,
          origin: "origin = 'vault-import'",
          counterargument: "counterargument = 'kontra'",
          evidence: "evidence = '{}'::jsonb",
          proposed_at: "proposed_at = now() + interval '1 day'",
          created_by_token_id: `created_by_token_id = ${tokenId}`,
        };
        for (const [kolumna, set] of Object.entries(zmiany)) {
          await trigger("setup_versions", "setup_versions_immutable", "TJ409", (tx) =>
            tx.unsafe(`UPDATE setup_versions SET ${set} WHERE id = ${vid}`), kolumna);
        }
        // decision_reason nie jest niezmienne (zmienia sie razem ze statusem)
        await jako("api:5", (tx) => tx`UPDATE setup_versions SET decision_reason = 'uwaga' WHERE id = ${vid}`);

        // zatwierdzenie / odrzucenie / zastapienie tylko z UI
        for (const [status, extra] of [["approved", ""], ["rejected", ""], ["superseded", ""]] as const) {
          await trigger("setup_versions", "setup_versions_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
            tx.unsafe(`UPDATE setup_versions SET status = '${status}'${extra} WHERE id = ${vid}`)));
        }
        await trigger("setup_versions", "setup_versions_ui_actor", "TJ403", jakoAktor("import", (tx) => tx`
          INSERT INTO setup_versions (setup_id, version, status, thresholds, origin)
          VALUES (${inny.setupId}, 1, 'approved', '{}'::jsonb, 'vault-import')`));
        await jako("ui", (tx) => tx`
          UPDATE setup_versions SET status = 'approved', decided_at = now(), decision_reason = 'zatwierdzam' WHERE id = ${vid}`);
        const [po] = await sql`SELECT status, decision_reason FROM setup_versions WHERE id = ${vid}`;
        expect(po).toEqual({ status: "approved", decision_reason: "zatwierdzam" });
        // agent nie cofnie zatwierdzenia
        const e = await blad(jako("api:5", (tx) => tx`UPDATE setup_versions SET status = 'proposed' WHERE id = ${vid}`));
        expect(e.code).toBe("TJ403");
      });

      it("setup_versions: CHECK-i dowodu AI / mentora, typy JSON i unikaty approved / proposed", async () => {
        const { setupId } = await nowySetup(sql);
        const wstaw = (kolumny: string, wartosci: string) =>
          sql.unsafe(`INSERT INTO setup_versions (setup_id, version, status, thresholds, ${kolumny}) VALUES (${setupId}, ${++seq}, 'proposed', '{}'::jsonb, ${wartosci})`);
        expect((await blad(wstaw("origin", "'ai'"))).constraint_name).toBe("setup_versions_ai_proof");
        expect((await blad(wstaw("origin, counterargument", "'ai', ''"))).constraint_name).toBe("setup_versions_ai_proof");
        expect((await blad(wstaw("origin", "'mentor'"))).constraint_name).toBe("setup_versions_mentor_proof");
        expect((await blad(wstaw("origin, preconditions", "'user', '{}'::jsonb"))).constraint_name).toBe("setup_versions_preconditions");
        expect((await blad(sql.unsafe(`INSERT INTO setup_versions (setup_id, version, status, thresholds, origin) VALUES (${setupId}, 1, 'proposed', '[]'::jsonb, 'user')`))).constraint_name).toBe("setup_versions_thresholds");
        await sql.unsafe(`INSERT INTO setup_versions (setup_id, version, status, thresholds, origin, counterargument, evidence) VALUES (${setupId}, 1, 'proposed', '{}'::jsonb, 'ai', 'kontra', '{"n":1}'::jsonb)`);
        // druga propozycja naraz na setupie
        const eDruga = await blad(wstaw("origin", "'user'"));
        expect(eDruga.constraint_name).toBe("setup_versions_proposed_idx");
        // jedna obowiazujaca wersja
        await jako("ui", (tx) => tx`UPDATE setup_versions SET status = 'approved' WHERE setup_id = ${setupId}`);
        const eApp = await blad(jako("ui", (tx) => tx.unsafe(
          `INSERT INTO setup_versions (setup_id, version, status, thresholds, origin) VALUES (${setupId}, 77, 'approved', '{}'::jsonb, 'user')`)));
        expect(eApp.constraint_name).toBe("setup_versions_approved_idx");
      });

      const sugestia = (db: Db, kind: string, status = "pending") =>
        db`INSERT INTO ai_suggestions (kind, status, target, payload, claim, evidence, evidence_level, n, decided_at)
           VALUES (${kind}, ${status}, '{"type":"trade","id":1}'::jsonb, '{"tag":"fvg"}'::jsonb, 'FVG po sweepie',
                   '[{"trade":1}]'::jsonb, 'partial', 5, ${status === "pending" ? null : sql`now()`}) RETURNING id`;

      it("ai_suggestions: accepted / rejected / reverted tylko z UI (TJ403); applied tylko dla strategy_detail", async () => {
        const [s] = await jako("api:5", (tx) => sugestia(tx, "tag"));
        for (const status of ["accepted", "rejected"]) {
          await trigger("ai_suggestions", "ai_suggestions_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
            tx.unsafe(`UPDATE ai_suggestions SET status = '${status}', decided_at = now() WHERE id = ${s.id}`)));
        }
        // INSERT od razu jako accepted tez tylko z UI
        await trigger("ai_suggestions", "ai_suggestions_ui_actor", "TJ403", jakoAktor("api:5", (tx) => sugestia(tx, "tag", "accepted")));
        // 'applied' dla innego rodzaju niz strategy_detail - CHECK (takze z UI)
        const eApplied = await blad(jako("ui", (tx) => sugestia(tx, "tag", "applied")));
        expect(eApplied.constraint_name).toBe("ai_suggestions_applied_kind");
        // 'applied' dla strategy_detail ustawia API
        const [d] = await jako("api:5", (tx) => sugestia(tx, "strategy_detail", "applied"));
        expect(d.id).toBeGreaterThan(0);
        // z UI przechodzi
        await jako("ui", (tx) => tx`UPDATE ai_suggestions SET status = 'accepted', decided_at = now() WHERE id = ${s.id}`);
        // wyjscie z accepted (cofniecie) tez tylko z UI
        await trigger("ai_suggestions", "ai_suggestions_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
          tx`UPDATE ai_suggestions SET status = 'reverted' WHERE id = ${s.id}`));
        await jako("ui", (tx) => tx`UPDATE ai_suggestions SET status = 'reverted' WHERE id = ${s.id}`);
        // applied -> reverted (strategy_detail) tez UI
        await trigger("ai_suggestions", "ai_suggestions_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
          tx`UPDATE ai_suggestions SET status = 'reverted' WHERE id = ${d.id}`));
      });

      it("ai_suggestions: tresc niezmienna (UPDATE kazdej kolumny -> TJ409), status / decided_at / applied_ref zmienne; z rozstrzygnietej nie ma powrotu do pending", async () => {
        const tokenId = await nowyToken(sql);
        const [s] = await jako("api:5", (tx) => sugestia(tx, "tag"));
        const zmiany: Record<string, string> = {
          kind: "kind = 'trade_link'",
          target: `target = '{"type":"day"}'::jsonb`,
          payload: `payload = '{"x":1}'::jsonb`,
          claim: "claim = 'inne'",
          evidence: `evidence = '[{"a":1}]'::jsonb`,
          evidence_level: "evidence_level = 'tested'",
          n: "n = 6",
          created_by_token_id: `created_by_token_id = ${tokenId}`,
          created_at: "created_at = now() + interval '1 day'",
        };
        for (const [kolumna, set] of Object.entries(zmiany)) {
          await trigger("ai_suggestions", "ai_suggestions_immutable", "TJ409", (tx) =>
            tx.unsafe(`UPDATE ai_suggestions SET ${set} WHERE id = ${s.id}`), kolumna);
        }
        await jako("api:5", (tx) => tx`UPDATE ai_suggestions SET applied_ref = '{"tag_id":3}'::jsonb WHERE id = ${s.id}`);
        // rozstrzygnieta nie wraca do pending (nawet z UI)
        await jako("ui", (tx) => tx`UPDATE ai_suggestions SET status = 'rejected', decided_at = now() WHERE id = ${s.id}`);
        await trigger("ai_suggestions", "ai_suggestions_flow", "TJ409", jakoAktor("ui", (tx) =>
          tx`UPDATE ai_suggestions SET status = 'pending', decided_at = NULL WHERE id = ${s.id}`));
      });

      it("ai_suggestions: twierdzenie bez dowodu nie wejdzie (CHECK evidence), pending musi byc bez decided_at", async () => {
        const wstaw = (evidence: string, status = "pending", decided = "NULL") =>
          sql.unsafe(`INSERT INTO ai_suggestions (kind, status, target, payload, claim, evidence, evidence_level, decided_at)
                      VALUES ('tag', '${status}', '{}'::jsonb, '{}'::jsonb, 'x', '${evidence}'::jsonb, 'inferred', ${decided})`);
        expect((await blad(wstaw("[]"))).constraint_name).toBe("ai_suggestions_evidence");
        expect((await blad(wstaw("{}"))).constraint_name).toBe("ai_suggestions_evidence");
        expect((await blad(wstaw('[1]', "pending", "now()"))).constraint_name).toBe("ai_suggestions_decided");
        await wstaw("[1]");
      });

      async function dopisekAi(db: Db, o: { noteId: number; tradeId: number | null; quote?: number | null; evidence?: string | null }) {
        return db`
          INSERT INTO note_additions (note_id, body_md, origin, trade_id, quote_words_id, evidence)
          VALUES (${o.noteId}, 'AI: obserwacja', 'ai', ${o.tradeId}, ${o.quote ?? null}, ${o.evidence ?? null}::text::jsonb) RETURNING id`;
      }

      it("note_additions: dopisek AI musi dotyczyc trade'u i miec cytat albo dowod (TJ422); mentor tylko z twierdzeniem", async () => {
        const noteId = await nowaNotatka(sql, unik("Strategia"), { kind: "strategy" });
        const k = await kontoInstr(sql);
        const tradeId = await tradeDla(sql, k);
        const wId = await slowa(sql, "wszedlem po sweepie", { tradeId });
        await trigger("note_additions", "note_additions_insert_check", "TJ422", (tx) => dopisekAi(tx, { noteId, tradeId: null, quote: wId }), "trade_id = NULL");
        await trigger("note_additions", "note_additions_insert_check", "TJ422", (tx) => dopisekAi(tx, { noteId, tradeId }), "evidence");
        await dopisekAi(sql, { noteId, tradeId, quote: wId });
        await dopisekAi(sql, { noteId, tradeId, evidence: '{"n":3}' });
        const eMentor = await blad(sql`INSERT INTO note_additions (note_id, body_md, origin) VALUES (${noteId}, 'wg mentora', 'mentor')`);
        expect(eMentor.constraint_name).toBe("note_additions_mentor");
      });

      it("note_additions: UPDATE poza reverted_at -> TJ409; trade_id i quote_words_id tylko do NULL", async () => {
        const noteId = await nowaNotatka(sql, unik("Strategia"), { kind: "strategy" });
        const k = await kontoInstr(sql);
        const tradeId = await tradeDla(sql, k);
        const innyTrade = await tradeDla(sql, k);
        const wId = await slowa(sql, "cytat", { tradeId });
        const innyW = await slowa(sql, "inny cytat", { day: "2030-05-05" });
        const [s] = await jako("api:5", (tx) => sugestia(tx, "strategy_detail"));
        const [d] = await dopisekAi(sql, { noteId, tradeId, quote: wId, evidence: '{"n":1}' });
        const zmiany: Record<string, string> = {
          note_id: `note_id = ${await nowaNotatka(sql, unik("Inna"), { kind: "strategy" })}`,
          body_md: "body_md = 'podmieniony'",
          origin: "origin = 'mentor'",
          evidence: `evidence = '{"n":2}'::jsonb`,
          suggestion_id: `suggestion_id = ${s.id}`,
          created_at: "created_at = now() + interval '1 day'",
        };
        // origin = 'mentor' lamie CHECK note_additions_mentor, wiec dla niego dopisujemy twierdzenie z 0027
        const [zrodlo] = await sql`INSERT INTO mentor_sources (video_id, title, url) VALUES (${unik("vid")}, 't', 'https://youtu.be/x') RETURNING id`;
        const [claim] = await sql`INSERT INTO mentor_claims (source_id, quote, t_start_s, claim_type) VALUES (${zrodlo.id}, 'cytat', 1, 'concept') RETURNING id`;
        zmiany.origin = `origin = 'mentor', mentor_claim_id = ${claim.id}`;
        zmiany.mentor_claim_id = `mentor_claim_id = ${claim.id}`;
        for (const [kolumna, set] of Object.entries(zmiany)) {
          await trigger("note_additions", "note_additions_immutable", "TJ409", (tx) =>
            tx.unsafe(`UPDATE note_additions SET ${set} WHERE id = ${d.id}`), kolumna.split(",")[0]);
        }
        // przepiecie na inny trade / inne slowa: tylko zerowanie
        await trigger("note_additions", "note_additions_null_only", "TJ409", (tx) =>
          tx`UPDATE note_additions SET trade_id = ${innyTrade} WHERE id = ${d.id}`, "trade_id");
        await trigger("note_additions", "note_additions_null_only", "TJ409", (tx) =>
          tx`UPDATE note_additions SET quote_words_id = ${innyW} WHERE id = ${d.id}`, "quote_words_id");
        // wyzerowanie i reverted_at wolno
        await sql`UPDATE note_additions SET reverted_at = now() WHERE id = ${d.id}`;
        await sql`UPDATE note_additions SET trade_id = NULL, quote_words_id = NULL WHERE id = ${d.id}`;
        // z NULL-a nie da sie ustawic z powrotem
        const e = await blad(sql`UPDATE note_additions SET trade_id = ${tradeId} WHERE id = ${d.id}`);
        expect(e.code).toBe("TJ409");
      });

      it("tj_guard_null_only i tj_guard_columns odrzucaja nieistniejaca kolumne (literowka nie wylacza ochrony po cichu)", async () => {
        await wycofywalna(async (tx) => {
          await tx`CREATE TABLE proba_null_only (id serial PRIMARY KEY, a integer)`;
          await tx`CREATE TRIGGER t BEFORE UPDATE ON proba_null_only FOR EACH ROW EXECUTE FUNCTION public.tj_guard_null_only('nie_ma')`;
          await tx`INSERT INTO proba_null_only (a) VALUES (1)`;
          const e = await blad(tx`UPDATE proba_null_only SET a = 2`);
          expect(e.message).toContain("nie ma kolumny nie_ma");
        });
      });

      it("trades: nowe kolumny, CHECK-i procesu, wyszukiwanie po notatce i opisie (f_unaccent), tag z pochodzeniem", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const [r0] = await sql`SELECT process_grade, process_graded_at, setup_id, setup_version_id, ruleset_version, day_known FROM trades WHERE id = ${t}`;
        expect(r0).toEqual({ process_grade: null, process_graded_at: null, setup_id: null, setup_version_id: null, ruleset_version: null, day_known: false });
        expect((await blad(sql`UPDATE trades SET process_grade = 'D', process_graded_at = now() WHERE id = ${t}`)).constraint_name).toBe("trades_process_grade");
        expect((await blad(sql`UPDATE trades SET process_grade = 'A' WHERE id = ${t}`)).constraint_name).toBe("trades_process_graded");
        expect((await blad(sql`UPDATE trades SET process_graded_at = now() WHERE id = ${t}`)).constraint_name).toBe("trades_process_graded");
        expect((await blad(sql`UPDATE trades SET ruleset_version = -1 WHERE id = ${t}`)).constraint_name).toBe("trades_ruleset_version");
        await sql`UPDATE trades SET process_grade = 'B', process_graded_at = now(), note = 'Zarządzanie pozycją po sweepie', mood_note = 'spokój' WHERE id = ${t}`;
        const trafione = await sql`SELECT id FROM trades WHERE search @@ websearch_to_tsquery('simple', public.f_unaccent('zarzadzanie')) AND id = ${t}`;
        expect(trafione.length).toBe(1);
        const poOpisie = await sql`SELECT id FROM trades WHERE search @@ websearch_to_tsquery('simple', public.f_unaccent('SPOKOJ')) AND id = ${t}`;
        expect(poOpisie.length).toBe(1);
        // setup i wersja: SET NULL przy kasowaniu setupu (trades nie jest tabela niezmienna)
        const { setupId } = await nowySetup(sql);
        const vid = await wersjaSetupu(sql, setupId);
        await sql`UPDATE trades SET setup_id = ${setupId}, setup_version_id = ${vid} WHERE id = ${t}`;
        await sql`DELETE FROM setup_versions WHERE id = ${vid}`;
        const [po] = await sql`SELECT setup_id, setup_version_id FROM trades WHERE id = ${t}`;
        expect(po).toEqual({ setup_id: setupId, setup_version_id: null });
        await sql`DELETE FROM setups WHERE id = ${setupId}`;
        expect((await sql`SELECT setup_id FROM trades WHERE id = ${t}`)[0].setup_id).toBeNull();
        // trade_tags.origin
        const [kat] = await sql`INSERT INTO tag_categories (name, key) VALUES ('K', ${unik("kat")}) RETURNING id`;
        const [tag] = await sql`INSERT INTO tags (category_id, name) VALUES (${kat.id}, 'FVG') RETURNING id`;
        const [dom] = await sql`INSERT INTO trade_tags (trade_id, tag_id) VALUES (${t}, ${tag.id}) RETURNING origin`;
        expect(dom.origin).toBe("user");
        expect((await blad(sql`INSERT INTO trade_tags (trade_id, tag_id, origin, interval) VALUES (${t}, ${tag.id}, 'robot', '5m')`)).constraint_name).toBe("trade_tags_origin");
        await sql`DELETE FROM trades WHERE id = ${t}`;
        await sql`DELETE FROM tag_categories WHERE id = ${kat.id}`;
      });

      it("setup_examples i trade_note_links: unikaty, CHECK-i; n hipotezy liczy prawdziwe trade_note_links (tylko zamkniete, tylko rola hypothesis)", async () => {
        const k = await kontoInstr(sql);
        const t1 = await tradeDla(sql, k);
        const t2 = await tradeDla(sql, k);
        const tOtwarty = await tradeDla(sql, k, "open");
        const { setupId } = await nowySetup(sql);
        await sql`INSERT INTO setup_examples (setup_id, trade_id, kind, origin) VALUES (${setupId}, ${t1}, 'a_plus', 'user')`;
        expect((await blad(sql`INSERT INTO setup_examples (setup_id, trade_id, kind, origin) VALUES (${setupId}, ${t1}, 'a_plus', 'user')`)).constraint_name).toBe("setup_examples_uq");
        await sql`INSERT INTO setup_examples (setup_id, trade_id, kind, origin) VALUES (${setupId}, ${t1}, 'anti', 'ai')`;
        expect((await blad(sql`INSERT INTO setup_examples (setup_id, trade_id, kind, origin) VALUES (${setupId}, ${t2}, 'zly', 'user')`)).constraint_name).toBe("setup_examples_kind");
        const h = await nowaHipotezaDb(sql, 17, 20);
        for (const t of [t1, t2, tOtwarty]) {
          await sql`INSERT INTO trade_note_links (trade_id, note_id, role, origin) VALUES (${t}, ${h.noteId}, 'hypothesis', 'user')`;
        }
        await sql`INSERT INTO trade_note_links (trade_id, note_id, role, origin) VALUES (${t1}, ${h.noteId}, 'concept', 'user')`;
        expect((await blad(sql`INSERT INTO trade_note_links (trade_id, note_id, role, origin) VALUES (${t1}, ${h.noteId}, 'hypothesis', 'ai')`)).constraint_name).toBe("trade_note_links_uq");
        expect((await blad(sql`INSERT INTO trade_note_links (trade_id, note_id, role, origin) VALUES (${t2}, ${h.noteId}, 'dziwna', 'ai')`)).constraint_name).toBe("trade_note_links_role");
        const [n] = await sql`SELECT public.tj_hypothesis_n(${h.id}) AS n`;
        expect(n.n).toBe(19); // 17 + 2 zamkniete; otwarty i rola concept sie nie licza
        // bramka n dla propozycji reguly AI korzysta z tych samych linkow: 19 < 20 -> TJ422, po trzecim zamknietym 20 -> OK
        const regulaId = (await sql`INSERT INTO rules (code, note_id) VALUES (${"R-" + String(7000 + ++seq)}, ${await nowaNotatka(sql, unik("Regula 2b"), { kind: "rule" })}) RETURNING id`)[0].id;
        const wstawRegule = (tx: Db) => tx`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin, counterargument, evidence, hypothesis_id)
          VALUES (${regulaId}, 1, 'regula AI', 'proposed', 'ai', 'kontra', '{"n":19}'::jsonb, ${h.id})`;
        expect((await blad(jako("api:5", wstawRegule))).code).toBe("TJ422");
        const t3 = await tradeDla(sql, k);
        await sql`INSERT INTO trade_note_links (trade_id, note_id, role, origin) VALUES (${t3}, ${h.noteId}, 'hypothesis', 'user')`;
        await jako("api:5", wstawRegule);
      });

      it("rule_versions.decision_reason: zmienia sie razem ze statusem, nie jest niezmienna (0020)", async () => {
        const nid = await nowaNotatka(sql, unik("Regula dr"), { kind: "rule" });
        const [r] = await sql`INSERT INTO rules (code, note_id) VALUES (${"R-" + String(8000 + ++seq)}, ${nid}) RETURNING id`;
        const [v] = await sql`INSERT INTO rule_versions (rule_id, version, text_md, status, origin) VALUES (${r.id}, 1, 'tresc', 'proposed', 'user') RETURNING id`;
        await jako("ui", (tx) => tx`UPDATE rule_versions SET status = 'rejected', decided_at = now(), decision_reason = 'za malo danych' WHERE id = ${v.id}`);
        const [po] = await sql`SELECT status, decision_reason FROM rule_versions WHERE id = ${v.id}`;
        expect(po).toEqual({ status: "rejected", decision_reason: "za malo danych" });
        expect((await blad(jako("ui", (tx) => tx`UPDATE rule_versions SET text_md = 'inna' WHERE id = ${v.id}`))).code).toBe("TJ409");
      });
    });

    /* ------------------------------------------------------------------ (b3) */
    describe("(b3) faza 2b: plan zamrozony, werdykt niezmienny, rytual dnia (0021)", () => {
      it("trade_plans: kazda zmiana poza przypieciem trade'u -> TJ409; przypiecie przechodzi (raz)", async () => {
        const k = await kontoInstr(sql);
        const k2 = await kontoInstr(sql);
        const t1 = await tradeDla(sql, k);
        const t2 = await tradeDla(sql, k);
        const tokenId = await nowyToken(sql);
        const sesja = await nowaSesja(sql);
        const { setupId } = await nowySetup(sql);
        const vid = await wersjaSetupu(sql, setupId);
        const w1 = await slowa(sql, "teza planu", { day: "2030-06-06" });
        const nowyPlan = async (db: Db, tradeId: number | null = null) => {
          const [p] = await db`
            INSERT INTO trade_plans (trade_id, account_id, instrument_id, day, ruleset_version, direction, entry_price,
                                     stop_loss, take_profit, contracts, risk_cents, origin)
            VALUES (${tradeId}, ${k.accountId}, ${k.instrumentId}, '2030-06-06', 3, 'long', 100, 95, 110, 1, 12500, 'user')
            RETURNING id`;
          return p.id as number;
        };
        const planPrzypiety = await nowyPlan(sql, t1);
        const zmiany: Record<string, string> = {
          trade_id: `trade_id = ${t2}`,
          trade_id_null: "trade_id = NULL",
          account_id: `account_id = ${k2.accountId}`,
          instrument_id: `instrument_id = ${k2.instrumentId}`,
          backtest_session_id: `backtest_session_id = ${sesja}`,
          day: "day = '2030-06-07'",
          setup_id: `setup_id = ${setupId}`,
          setup_version_id: `setup_id = ${setupId}, setup_version_id = ${vid}`,
          ruleset_version: "ruleset_version = 9",
          direction: "direction = 'short', stop_loss = 105, take_profit = 90",
          bias: "bias = 'neutral'",
          entry_price: "entry_price = 101",
          stop_loss: "stop_loss = 94",
          take_profit: "take_profit = 111",
          contracts: "contracts = 2",
          risk_cents: "risk_cents = 99",
          thesis_words_id: `thesis_words_id = ${w1}`,
          invalidation_words_id: `invalidation_words_id = ${w1}`,
          origin: "origin = 'ai'",
          created_by_token_id: `created_by_token_id = ${tokenId}`,
          frozen_at: "frozen_at = now() + interval '1 day'",
        };
        for (const set of Object.values(zmiany)) {
          await trigger("trade_plans", "trade_plans_guard", "TJ409", (tx) =>
            tx.unsafe(`UPDATE trade_plans SET ${set} WHERE id = ${planPrzypiety}`));
        }
        // UPDATE bez zmiany tez nie przechodzi (jedyny dozwolony UPDATE to przypiecie)
        await trigger("trade_plans", "trade_plans_guard", "TJ409", (tx) => tx`UPDATE trade_plans SET day = day WHERE id = ${planPrzypiety}`);

        // przypiecie trade'u: NULL -> wartosc, reszta bez zmian
        const planCzekajacy = await nowyPlan(sql);
        await trigger("trade_plans", "trade_plans_guard", "TJ409", (tx) =>
          tx`UPDATE trade_plans SET trade_id = ${t2}, contracts = 3 WHERE id = ${planCzekajacy}`);
        await sql`UPDATE trade_plans SET trade_id = ${t2} WHERE id = ${planCzekajacy}`;
        const [po] = await sql`SELECT trade_id FROM trade_plans WHERE id = ${planCzekajacy}`;
        expect(po.trade_id).toBe(t2);
        // raz przypietego nie przepniesz
        const eDrugi = await blad(sql`UPDATE trade_plans SET trade_id = ${t1} WHERE id = ${planCzekajacy}`);
        expect(eDrugi.code).toBe("TJ409");
      });

      it("trade_plans: unikat trade_id (wiele planow bez trade'u, jeden plan na trade), CHECK-i poziomow / ryzyka / kierunku", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const wstaw = (kolumny: string) =>
          sql.unsafe(`INSERT INTO trade_plans (account_id, instrument_id, day, ruleset_version, origin, ${kolumny.split("|")[0]}) VALUES (${k.accountId}, ${k.instrumentId}, '2030-06-06', 0, 'user', ${kolumny.split("|")[1]})`);
        const kolumny = "direction, entry_price, stop_loss, take_profit, contracts, risk_cents";
        const ok = (dir: string, e: number, sl: number, tp: string, c = 1, r = 100) => `${kolumny}|'${dir}', ${e}, ${sl}, ${tp}, ${c}, ${r}`;
        await wstaw(ok("long", 100, 95, "110"));
        await wstaw(ok("long", 100, 95, "NULL")); // druga czekajaca - NULL w trade_id nie koliduje
        await wstaw(ok("short", 100, 105, "90"));
        for (const zly of [ok("long", 100, 105, "110"), ok("long", 100, 95, "90"), ok("short", 100, 95, "90"), ok("short", 100, 105, "110"), ok("long", 100, 100, "110")]) {
          expect((await blad(wstaw(zly))).constraint_name, zly).toBe("trade_plans_levels");
        }
        expect((await blad(wstaw(ok("long", 100, 95, "110", 0)))).constraint_name).toBe("trade_plans_contracts");
        expect((await blad(wstaw(ok("long", 100, 95, "110", 1, 0)))).constraint_name).toBe("trade_plans_risk");
        expect((await blad(wstaw(ok("flat", 100, 95, "110")))).constraint_name).toBe("trade_plans_direction");
        const dwa = (tradeId: number) => sql`
          INSERT INTO trade_plans (trade_id, account_id, instrument_id, day, ruleset_version, direction, entry_price, stop_loss, contracts, risk_cents, origin)
          VALUES (${tradeId}, ${k.accountId}, ${k.instrumentId}, '2030-06-06', 0, 'long', 100, 95, 1, 100, 'user')`;
        await dwa(t);
        expect((await blad(dwa(t))).constraint_name).toBe("trade_plans_trade_uq");
        expect((await blad(sql`
          INSERT INTO trade_plans (account_id, instrument_id, day, ruleset_version, direction, entry_price, stop_loss, contracts, risk_cents, origin, setup_version_id)
          VALUES (${k.accountId}, ${k.instrumentId}, '2030-06-06', 0, 'long', 100, 95, 1, 100, 'user', 1)`)).constraint_name).toBe("trade_plans_setup_version");
      });

      it("trade_plan_addenda: tylko dopisywanie (UPDATE -> TJ409), kasowanie z planem dziala", async () => {
        const k = await kontoInstr(sql);
        const w = await slowa(sql, "przesuwam SL", { day: "2030-06-06" });
        const [p] = await sql`
          INSERT INTO trade_plans (account_id, instrument_id, day, ruleset_version, direction, entry_price, stop_loss, contracts, risk_cents, origin)
          VALUES (${k.accountId}, ${k.instrumentId}, '2030-06-06', 0, 'long', 100, 95, 1, 100, 'user') RETURNING id`;
        const [a] = await sql`INSERT INTO trade_plan_addenda (plan_id, field, new_value, words_id) VALUES (${p.id}, 'stop_loss', '96'::jsonb, ${w}) RETURNING id`;
        expect((await blad(sql`INSERT INTO trade_plan_addenda (plan_id, field, words_id) VALUES (${p.id}, 'cena', ${w})`)).constraint_name).toBe("trade_plan_addenda_field");
        await trigger("trade_plan_addenda", "trade_plan_addenda_immutable", "TJ409", (tx) =>
          tx`UPDATE trade_plan_addenda SET field = 'other' WHERE id = ${a.id}`);
        await sql`DELETE FROM trade_plans WHERE id = ${p.id}`;
        expect((await sql`SELECT 1 FROM trade_plan_addenda WHERE id = ${a.id}`).length).toBe(0);
      });

      it("trade_reviews: werdykt z as_of niezmienny (UPDATE kazdej kolumny -> TJ409); stary bez as_of mozna podmienic, takze uzupelnic o as_of", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const inny = await tradeDla(sql, k);
        const innyWerdykt = await werdykt(sql, inny, { basis: "history" });
        const tokenId = await nowyToken(sql);
        const rid = await werdykt(sql, t);
        const zmiany: Record<string, string> = {
          id: `id = ${rid + 100000}`,
          trade_id: `trade_id = ${inny}`,
          setup_type: "setup_type = 'inny'",
          summary_md: "summary_md = 'podmieniona'",
          lesson: "lesson = 'inna'",
          basis: "basis = 'history'",
          brain_verdict: "brain_verdict = 'wejdz'",
          brain_plan: `brain_plan = '{"entry":1}'::jsonb`,
          brain_version: "brain_version = 'abc'",
          evidence_cutoff: "evidence_cutoff = now()",
          model: "model = 'inny'",
          created_at: "created_at = now() + interval '1 day'",
          kind: `kind = 'user_override', overrides_review_id = ${innyWerdykt}`,
          as_of: "as_of = now() + interval '1 day'",
          evidence_hash: `evidence_hash = '${"e".repeat(64)}'`,
          evidence_manifest: `evidence_manifest = '[]'::jsonb`,
          ruleset_version: "ruleset_version = 4",
          created_by_token_id: `created_by_token_id = ${tokenId}`,
        };
        for (const [kolumna, set] of Object.entries(zmiany)) {
          await trigger("trade_reviews", "trade_reviews_immutable", "TJ409", (tx) =>
            tx.unsafe(`UPDATE trade_reviews SET ${set} WHERE id = ${rid}`), kolumna.startsWith("kind") ? "kind" : kolumna);
        }
        // overrides_review_id na korekcie
        const korekta = await werdykt(sql, t, { kind: "user_override", overrides: rid });
        await trigger("trade_reviews", "trade_reviews_immutable", "TJ409", (tx) =>
          tx`UPDATE trade_reviews SET overrides_review_id = ${innyWerdykt} WHERE id = ${korekta}`, "overrides_review_id");

        // stary werdykt (ADR-028): podmiana dozwolona
        const stary = await werdykt(sql, inny, { basis: "chart", asOf: false });
        await sql`UPDATE trade_reviews SET summary_md = 'nowa', lesson = 'nauka', brain_verdict = 'czekaj', created_at = now() WHERE id = ${stary}`;
        // ...a uzupelnienie o as_of zamyka go na zmiany
        await sql`UPDATE trade_reviews SET as_of = now(), evidence_hash = ${sha256Node(unik("h"))} WHERE id = ${stary}`;
        expect((await blad(sql`UPDATE trade_reviews SET summary_md = 'za pozno' WHERE id = ${stary}`)).code).toBe("TJ409");
      });

      it("trade_reviews: unikat (trade, basis) tylko dla kind='ai'; korekty uzytkownika sie nie licza; CHECK-i dowodu i korekty", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const rid = await werdykt(sql, t);
        // drugi werdykt AI tej samej podstawy -> 409 w API (23505 w bazie)
        const eDrugi = await blad(werdykt(sql, t));
        expect(eDrugi.constraint_name).toBe("trade_reviews_trade_basis_uq");
        // ten sam trade, inna podstawa -> OK
        await werdykt(sql, t, { basis: "history" });
        // kilka korekt tego samego werdyktu
        await werdykt(sql, t, { kind: "user_override", overrides: rid });
        await werdykt(sql, t, { kind: "user_override", overrides: rid });
        // legacy bez as_of tez podlega unikatowi
        const t2 = await tradeDla(sql, k);
        await werdykt(sql, t2, { asOf: false });
        expect((await blad(werdykt(sql, t2, { asOf: false }))).constraint_name).toBe("trade_reviews_trade_basis_uq");

        const wstaw = (kolumny: string, wartosci: string) =>
          sql.unsafe(`INSERT INTO trade_reviews (trade_id, basis, ${kolumny}) VALUES (${t}, 'chart', ${wartosci})`);
        const h = `'${"a".repeat(64)}'`;
        expect((await blad(wstaw("kind", "'robot'"))).constraint_name).toBe("trade_reviews_kind");
        expect((await blad(wstaw("kind", "'user_override'"))).constraint_name).toBe("trade_reviews_override");
        expect((await blad(wstaw("overrides_review_id", String(rid)))).constraint_name).toBe("trade_reviews_override");
        expect((await blad(wstaw("as_of", "now()"))).constraint_name).toBe("trade_reviews_as_of_hash");
        expect((await blad(wstaw("evidence_hash", h))).constraint_name).toBe("trade_reviews_as_of_hash");
        expect((await blad(wstaw("as_of, evidence_hash", "now(), 'nie-hex'"))).constraint_name).toBe("trade_reviews_evidence_hash");
        expect((await blad(wstaw("evidence_manifest", "'[]'::jsonb"))).constraint_name).toBe("trade_reviews_manifest");
        // korekta bez as_of (a wiec bez skrotu) jest odrzucona: korekta tez jest datowana
        const eBezDaty = await blad(wstaw("kind, overrides_review_id", `'user_override', ${rid}`));
        expect(eBezDaty.constraint_name).toBe("trade_reviews_override_dated");
        expect((await blad(wstaw("ruleset_version", "-1"))).constraint_name).toBe("trade_reviews_ruleset");
      });

      it("trade_reviews: korekta musi wskazywac werdykt AI tego samego trade'u i tej samej podstawy (TJ422)", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const inny = await tradeDla(sql, k);
        const ai = await werdykt(sql, t);
        const aiInny = await werdykt(sql, inny);
        const korekta = await werdykt(sql, t, { kind: "user_override", overrides: ai });
        const hash = sha256Node(unik("h"));
        const wstawKorekte = (tradeId: number, basis: string, nadpisuje: number) => (tx: Tx) => tx`
          INSERT INTO trade_reviews (trade_id, basis, kind, overrides_review_id, as_of, evidence_hash)
          VALUES (${tradeId}, ${basis}, 'user_override', ${nadpisuje}, now(), ${hash})`;
        await trigger("trade_reviews", "trade_reviews_override_check", "TJ422", wstawKorekte(t, "chart", aiInny), "trade_id");
        await trigger("trade_reviews", "trade_reviews_override_check", "TJ422", wstawKorekte(t, "history", ai), "basis");
        await trigger("trade_reviews", "trade_reviews_override_check", "TJ422", wstawKorekte(t, "chart", korekta), "kind");
        await sql.begin((tx) => wstawKorekte(t, "chart", ai)(tx));
      });

      it("trade_rule_checks: sprawdzenia w transakcji, ktora utworzyla werdykt, przechodza (zwykla, w SAVEPOINCIE i po uzupelnieniu starego werdyktu o as_of)", async () => {
        const k = await kontoInstr(sql);
        // a) ta sama transakcja
        const t1 = await tradeDla(sql, k);
        const r1 = await sql.begin((tx) => werdyktZSprawdzeniem(tx, t1));
        expect((await sql`SELECT 1 FROM trade_rule_checks WHERE review_id = ${r1}`).length).toBe(1);
        // b) werdykt wstawiony w SAVEPOINCIE (xmin = numer podtransakcji), sprawdzenie w transakcji nadrzednej
        const t2 = await tradeDla(sql, k);
        const r2 = await sql.begin(async (tx) => {
          const id = await tx.savepoint((sp) => werdykt(sp, t2));
          await tx`INSERT INTO trade_rule_checks (review_id, rule_id, rule_text, verdict) VALUES (${id}, 'R-001', 'regula', 'pass')`;
          return id;
        });
        expect((await sql`SELECT 1 FROM trade_rule_checks WHERE review_id = ${r2}`).length).toBe(1);
        // c) stary werdykt bez as_of uzupelniony o as_of w tej transakcji (upsert z ADR-028), potem sprawdzenia
        const t3 = await tradeDla(sql, k);
        const stary = await werdykt(sql, t3, { asOf: false });
        await sql.begin(async (tx) => {
          await tx`UPDATE trade_reviews SET as_of = now(), evidence_hash = ${sha256Node(unik("h"))} WHERE id = ${stary}`;
          await tx`INSERT INTO trade_rule_checks (review_id, rule_id, rule_text, verdict) VALUES (${stary}, 'R-001', 'regula', 'pass')`;
        });
        expect((await sql`SELECT 1 FROM trade_rule_checks WHERE review_id = ${stary}`).length).toBe(1);
        // d) stary werdykt bez as_of: sprawdzenia dowolnie, takze w osobnej transakcji
        const t4 = await tradeDla(sql, k);
        const stary2 = await werdykt(sql, t4, { asOf: false });
        await sql`INSERT INTO trade_rule_checks (review_id, rule_id, rule_text, verdict) VALUES (${stary2}, 'R-001', 'regula', 'pass')`;
        await sql`UPDATE trade_rule_checks SET rule_text = 'zmieniona', verdict = 'fail' WHERE review_id = ${stary2}`;
      });

      it("trade_rule_checks: do werdyktu z as_of z INNEJ transakcji nie dopiszesz sprawdzenia (TJ409); UPDATE tylko user_verdict; DELETE wolno", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const rid = await sql.begin((tx) => werdyktZSprawdzeniem(tx, t));
        const inny = await sql.begin((tx) => werdyktZSprawdzeniem(tx, t, "history", "R-777"));
        const nidReguly = await nowaNotatka(sql, unik("Regula rc"), { kind: "rule" });
        const [regula] = await sql`INSERT INTO rules (code, note_id) VALUES (${"R-" + String(9000 + ++seq)}, ${nidReguly}) RETURNING id`;
        const [wersja] = await sql`
          INSERT INTO rule_versions (rule_id, version, text_md, status, origin) VALUES (${regula.id}, 1, 'x', 'proposed', 'user') RETURNING id`;

        // INSERT do istniejacego werdyktu z as_of (osobna transakcja) -> TJ409
        await trigger("trade_rule_checks", "trade_rule_checks_guard", "TJ409", (tx) =>
          tx`INSERT INTO trade_rule_checks (review_id, rule_id, rule_text, verdict) VALUES (${rid}, 'R-002', 'druga', 'fail')`, "R-002");

        // user_verdict to zdanie uzytkownika, nie werdykt AI: wolno
        await sql`UPDATE trade_rule_checks SET user_verdict = 'disagree' WHERE review_id = ${rid}`;
        await sql`UPDATE trade_rule_checks SET user_verdict = NULL WHERE review_id = ${rid}`;
        // reszta kolumn -> TJ409
        const zmiany: Record<string, string> = {
          review_id: `review_id = ${inny}`,
          rule_id: "rule_id = 'R-009'",
          rule_text: "rule_text = 'podmieniony'",
          verdict: "verdict = 'fail'",
          evidence: "evidence = 'inny dowod'",
          rule_version_id: `rule_version_id = ${wersja.id}`,
        };
        for (const set of Object.values(zmiany)) {
          await trigger("trade_rule_checks", "trade_rule_checks_guard", "TJ409", (tx) =>
            tx.unsafe(`UPDATE trade_rule_checks SET ${set} WHERE review_id = ${rid}`), "R-001");
        }
        // DELETE nie jest blokowany
        await sql`DELETE FROM trade_rule_checks WHERE review_id = ${rid}`;
        expect((await sql`SELECT 1 FROM trade_rule_checks WHERE review_id = ${rid}`).length).toBe(0);

        // rule_version_id: RESTRICT - wersji uzytej w sprawdzeniu nie da sie skasowac
        await sql.begin(async (tx) => {
          const r = await werdykt(tx, await tradeDla(tx, k));
          await tx`INSERT INTO trade_rule_checks (review_id, rule_id, rule_text, verdict, rule_version_id) VALUES (${r}, 'R-003', 'x', 'na', ${wersja.id})`;
        });
        expect((await blad(sql`DELETE FROM rule_versions WHERE id = ${wersja.id}`)).code).toBe("23503");
      });

      it("day_notes: bias / max_trades / sleep i zakresy 1-5 mood / energy / day_rating w bazie; ograniczenia sprawdzone (convalidated)", async () => {
        const k = await kontoInstr(sql);
        const wstaw = (kolumny: string, wartosci: string) =>
          sql.unsafe(`INSERT INTO day_notes (day, account_id, ${kolumny}) VALUES ('2030-07-${String(1 + (seq++ % 28)).padStart(2, "0")}', ${k.accountId}, ${wartosci})`);
        expect((await blad(wstaw("bias", "'gora'"))).constraint_name).toBe("day_notes_bias");
        expect((await blad(wstaw("max_trades", "0"))).constraint_name).toBe("day_notes_max_trades");
        expect((await blad(wstaw("max_trades", "21"))).constraint_name).toBe("day_notes_max_trades");
        expect((await blad(wstaw("sleep", "0"))).constraint_name).toBe("day_notes_sleep");
        expect((await blad(wstaw("sleep", "6"))).constraint_name).toBe("day_notes_sleep");
        expect((await blad(wstaw("mood", "6"))).constraint_name).toBe("day_notes_mood");
        expect((await blad(wstaw("mood", "0"))).constraint_name).toBe("day_notes_mood");
        expect((await blad(wstaw("energy", "9"))).constraint_name).toBe("day_notes_energy");
        expect((await blad(wstaw("day_rating", "-1"))).constraint_name).toBe("day_notes_day_rating");
        await wstaw("bias, max_trades, sleep, mood, energy, day_rating", "'neutral', 3, 4, 5, 1, 3");
        await wstaw("bias", "NULL");
        const c = await sql`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'public.day_notes'::regclass AND conname IN ('day_notes_mood', 'day_notes_energy', 'day_notes_day_rating', 'day_notes_bias', 'day_notes_max_trades', 'day_notes_sleep')`;
        expect(c.length).toBe(6);
        expect(c.filter((r) => !r.convalidated).map((r) => r.conname)).toEqual([]);
      });
    });

    /* ------------------------------------------------------------------ (b4) */
    describe("(b4) faza 2b: hipotezy, prop, przeglad tygodnia, wykres, slownik, mentor (0022-0027)", () => {
      it("hypothesis_variants: unikat NULLS NOT DISTINCT (wlasciciel to hipoteza albo setup), dokladnie jeden wlasciciel", async () => {
        const h1 = await nowaHipotezaDb(sql);
        const h2 = await nowaHipotezaDb(sql);
        const { setupId } = await nowySetup(sql);
        const hash = (s: string) => sha256Node(s);
        const wstaw = (hid: number | null, sid: number | null, params: string, label = "wariant") => sql`
          INSERT INTO hypothesis_variants (hypothesis_id, setup_id, label, params, params_hash, n_tested, origin)
          VALUES (${hid}, ${sid}, ${label}, ${params}::text::jsonb, ${hash(params)}, 12, 'user')`;
        await wstaw(h1.id, null, '{"sl":"10"}');
        // ten sam zestaw parametrow na tej samej hipotezie: setup_id jest NULL w obu wierszach
        expect((await blad(wstaw(h1.id, null, '{"sl":"10"}', "powtorka"))).constraint_name).toBe("hypothesis_variants_uq");
        await wstaw(h1.id, null, '{"sl":"12"}'); // inne parametry
        await wstaw(h2.id, null, '{"sl":"10"}'); // inna hipoteza
        await wstaw(null, setupId, '{"sl":"10"}');
        expect((await blad(wstaw(null, setupId, '{"sl":"10"}', "powtorka"))).constraint_name).toBe("hypothesis_variants_uq");
        expect((await blad(wstaw(h1.id, setupId, '{"sl":"1"}'))).constraint_name).toBe("hypothesis_variants_owner");
        expect((await blad(wstaw(null, null, '{"sl":"1"}'))).constraint_name).toBe("hypothesis_variants_owner");
        expect((await blad(sql`INSERT INTO hypothesis_variants (hypothesis_id, label, params, params_hash, n_tested, origin)
          VALUES (${h1.id}, 'x', '{}'::jsonb, 'nie-hex', 1, 'user')`)).constraint_name).toBe("hypothesis_variants_params_hash");
        expect((await sql`SELECT count(*)::int AS n FROM hypothesis_variants WHERE hypothesis_id = ${h1.id}`)[0].n).toBe(2);
        // kasowanie hipotezy (bez regul) zabiera jej warianty
        await sql`DELETE FROM hypotheses WHERE id = ${h1.id}`;
        expect((await sql`SELECT 1 FROM hypothesis_variants WHERE hypothesis_id = ${h1.id}`).length).toBe(0);
      });

      it("threshold_changes: zmiana prog_n / thresholds z KAZDEGO aktora zostawia wpis (stara i nowa wartosc, n, widocznosc wyniku, aktor)", async () => {
        const h = await nowaHipotezaDb(sql, 25, 20); // n = 25 >= prog 20: wynik byl juz widoczny
        await jako("api:9", (tx) => tx`UPDATE hypotheses SET prog_n = 30 WHERE id = ${h.id}`);
        const [w1] = await sql`SELECT field, old_value, new_value, n_at_change, result_was_visible, actor FROM threshold_changes WHERE hypothesis_id = ${h.id}`;
        expect(w1).toEqual({ field: "prog_n", old_value: 20, new_value: 30, n_at_change: 25, result_was_visible: true, actor: "api:9" });

        // zmiana thresholds, wynik jeszcze niewidoczny (n = 25 < nowy prog 30)
        await jako("ui", (tx) => tx`UPDATE hypotheses SET thresholds = '{"wilson_low":0.4}'::jsonb WHERE id = ${h.id}`);
        // obie kolumny naraz -> dwa wiersze; bez aktora -> 'unknown'
        await sql`UPDATE hypotheses SET prog_n = 40, thresholds = '{"wilson_low":0.5}'::jsonb WHERE id = ${h.id}`;
        const log = await sql`SELECT field, old_value, new_value, n_at_change, result_was_visible, actor FROM threshold_changes WHERE hypothesis_id = ${h.id} ORDER BY id`;
        expect(log.map((r) => [r.field, r.actor, r.result_was_visible])).toEqual([
          ["prog_n", "api:9", true],
          ["thresholds", "ui", false], // n = 25 < prog 30
          ["prog_n", "unknown", false], // n = 25 < prog 30
          ["thresholds", "unknown", false],
        ]);
        expect(log[1].old_value).toEqual({});
        expect(log[1].new_value).toEqual({ wilson_low: 0.4 });
        expect(log[3].old_value).toEqual({ wilson_low: 0.4 });

        // UPDATE, ktory niczego nie zmienia, i zmiana innej kolumny nie loguja
        const przed = (await sql`SELECT count(*)::int AS n FROM threshold_changes WHERE hypothesis_id = ${h.id}`)[0].n;
        await sql`UPDATE hypotheses SET prog_n = prog_n, thresholds = thresholds WHERE id = ${h.id}`;
        await sql`UPDATE hypotheses SET n_imported = 26 WHERE id = ${h.id}`;
        expect((await sql`SELECT count(*)::int AS n FROM threshold_changes WHERE hypothesis_id = ${h.id}`)[0].n).toBe(przed);

        // log jest tylko do dopisywania
        await trigger("threshold_changes", "threshold_changes_immutable", "TJ409", (tx) =>
          tx`UPDATE threshold_changes SET actor = 'inny' WHERE hypothesis_id = ${h.id}`);
        // wpis zapisuje wlasnie trigger hypotheses_threshold_log (bez niego wiersza nie ma)
        await wycofywalna(async (tx) => {
          await tx.unsafe("ALTER TABLE hypotheses DISABLE TRIGGER hypotheses_threshold_log");
          await tx`UPDATE hypotheses SET prog_n = 99 WHERE id = ${h.id}`;
          expect((await tx`SELECT count(*)::int AS n FROM threshold_changes WHERE hypothesis_id = ${h.id}`)[0].n).toBe(przed);
        });
        // kasowanie hipotezy zabiera log (DELETE nie jest blokowany)
        await sql`DELETE FROM hypotheses WHERE id = ${h.id}`;
        expect((await sql`SELECT 1 FROM threshold_changes WHERE hypothesis_id = ${h.id}`).length).toBe(0);
      });

      it("prop_firm_presets: CHECK-i i unikat odczytu; preset domyslnie wymaga weryfikacji; unikat obsluguje wybor (firma, program, faza)", async () => {
        const insert = (firm: string, url = "https://x.pl") =>
          `INSERT INTO prop_firm_presets (firm, program, phase, account_size_cents, dd_type, max_dd_cents, source_url, read_on)
           VALUES ('${firm}', 'P', 'eval', 5000000, 'eod', 200000, '${url}', '2026-10-14') RETURNING id, needs_verification`;
        const zle: [string, string, string][] = [
          ["dd_type", "'trailing_to_static'", "prop_firm_presets_dd_lock"],
          ["dd_type", "'losowy'", "prop_firm_presets_dd_type"],
          ["phase", "'live'", "prop_firm_presets_phase"],
          ["max_dd_cents", "0", "prop_firm_presets_max_dd"],
          ["consistency_pct", "0", "prop_firm_presets_consistency"],
          ["consistency_pct", "100.5", "prop_firm_presets_consistency"],
          ["daily_loss_cents", "0", "prop_firm_presets_daily_loss"],
          ["profit_target_cents", "-5", "prop_firm_presets_profit_target"],
          ["min_days", "0", "prop_firm_presets_min_days"],
          ["max_contracts_micro", "0", "prop_firm_presets_contracts"],
          ["extra", "'[]'::jsonb", "prop_firm_presets_extra"],
        ];
        await wycofywalna(async (tx) => {
          const [p] = await tx.unsafe(insert("F"));
          expect(p.needs_verification).toBe(true); // domyslnie do weryfikacji, dopoki ktos jej nie potwierdzi
          // blad w transakcji psuje ja, wiec kazda proba w SAVEPOINCIE
          const kod = async (stmt: string) => (await blad(tx.savepoint((sp) => sp.unsafe(stmt)))).constraint_name;
          expect(await kod(insert("F"))).toBe("prop_firm_presets_uq");
          expect(await kod(insert("G", "http://x.pl"))).toBe("prop_firm_presets_source_url");
          for (const [kolumna, wartosc, ograniczenie] of zle) {
            expect(await kod(`UPDATE prop_firm_presets SET ${kolumna} = ${wartosc} WHERE id = ${p.id}`), `${kolumna} = ${wartosc}`).toBe(ograniczenie);
          }
        });
        // wybor presetu: firma -> program -> faza korzysta z unikatu (osobny indeks bylby zbedny)
        await wycofywalna(async (tx) => {
          await tx`SET LOCAL enable_seqscan = off`;
          for (const zapytanie of [
            "SELECT 1 FROM prop_firm_presets WHERE firm = 'Topstep'",
            "SELECT 1 FROM prop_firm_presets WHERE firm = 'Topstep' AND program = 'Trading Combine' AND phase = 'eval'",
          ]) {
            const plan = (await tx.unsafe(`EXPLAIN ${zapytanie}`)).map((r) => r["QUERY PLAN"]).join("\n");
            expect(plan, zapytanie).toContain("prop_firm_presets_uq");
          }
        });
      });

      it("prop_rules: kopia presetu nadpisywalna; unikat (konto, valid_from); preset kasowany -> preset_id NULL; konto kasowane -> reguly razem z nim", async () => {
        const k = await kontoInstr(sql);
        const [p] = await sql`
          INSERT INTO prop_firm_presets (firm, program, phase, account_size_cents, dd_type, max_dd_cents, dd_lock_cents, source_url, read_on, extra)
          VALUES (${unik("Firma")}, 'Program', 'eval', 5000000, 'trailing_to_static', 200000, 200000, 'https://x.pl', '2026-10-14', '{"trail_basis":"eod"}'::jsonb)
          RETURNING id`;
        const [r] = await sql`
          INSERT INTO prop_rules (account_id, preset_id, valid_from, dd_type, max_dd_cents, dd_lock_cents, extra)
          VALUES (${k.accountId}, ${p.id}, '2026-10-01', 'trailing_to_static', 200000, 200000, '{"trail_basis":"eod"}'::jsonb) RETURNING id`;
        // kazda wartosc nadpisywalna zwyklym UPDATE
        // potwierdzenie (confirmed_at) robi tylko UI (0028), reszta wartosci zwyklym UPDATE
        await sql`UPDATE prop_rules SET max_dd_cents = 250000, daily_loss_cents = 100000, consistency_pct = 40,
                  extra = '{"trail_basis":"intraday"}'::jsonb WHERE id = ${r.id}`;
        expect((await blad(sql`UPDATE prop_rules SET confirmed_at = now() WHERE id = ${r.id}`)).code).toBe("TJ403");
        await jako("ui", (tx) => tx`UPDATE prop_rules SET confirmed_at = now() WHERE id = ${r.id}`);
        expect((await sql`SELECT confirmed_at IS NOT NULL AS c FROM prop_rules WHERE id = ${r.id}`)[0].c).toBe(true);
        expect((await sql`SELECT consistency_pct::text AS c FROM prop_rules WHERE id = ${r.id}`)[0].c).toBe("40.00");
        const dup = await blad(sql`INSERT INTO prop_rules (account_id, valid_from, dd_type, max_dd_cents) VALUES (${k.accountId}, '2026-10-01', 'eod', 1000)`);
        expect(dup.constraint_name).toBe("prop_rules_account_valid_uq");
        await sql`INSERT INTO prop_rules (account_id, valid_from, dd_type, max_dd_cents) VALUES (${k.accountId}, '2026-11-01', 'eod', 1000)`;
        expect((await blad(sql`INSERT INTO prop_rules (account_id, valid_from, dd_type, max_dd_cents) VALUES (${k.accountId}, '2026-12-01', 'trailing_to_static', 1000)`)).constraint_name).toBe("prop_rules_dd_lock");
        expect((await blad(sql`INSERT INTO prop_rules (account_id, valid_from, dd_type, max_dd_cents, source_url) VALUES (${k.accountId}, '2026-12-01', 'eod', 1000, 'ftp://x')`)).constraint_name).toBe("prop_rules_source_url");
        await sql`DELETE FROM prop_firm_presets WHERE id = ${p.id}`;
        const [po] = await sql`SELECT preset_id, extra FROM prop_rules WHERE id = ${r.id}`;
        expect(po.preset_id).toBeNull();
        expect(po.extra).toEqual({ trail_basis: "intraday" }); // kopia zostaje
        await sql`DELETE FROM accounts WHERE id = ${k.accountId}`;
        expect((await sql`SELECT 1 FROM prop_rules WHERE account_id = ${k.accountId}`).length).toBe(0);
      });

      it("prop_ledger: znak kwoty zalezy od rodzaju; konto z ksiega nie da sie skasowac (RESTRICT)", async () => {
        const k = await kontoInstr(sql);
        const wstaw = (kind: string, kwota: number) =>
          sql`INSERT INTO prop_ledger (account_id, kind, amount_cents, occurred_on) VALUES (${k.accountId}, ${kind}, ${kwota}, '2026-10-14')`;
        await wstaw("eval_fee", -15000);
        await wstaw("payout", 100000);
        await wstaw("refund", 500);
        await wstaw("other", -100);
        await wstaw("other", 100);
        expect((await blad(wstaw("eval_fee", 15000))).constraint_name).toBe("prop_ledger_sign");
        expect((await blad(wstaw("payout", -100000))).constraint_name).toBe("prop_ledger_sign");
        expect((await blad(wstaw("refund", -1))).constraint_name).toBe("prop_ledger_sign");
        expect((await blad(wstaw("other", 0))).constraint_name).toBe("prop_ledger_amount");
        expect((await blad(wstaw("premia", 100))).constraint_name).toBe("prop_ledger_kind");
        expect((await blad(sql`DELETE FROM accounts WHERE id = ${k.accountId}`)).code).toBe("23503");
      });

      it("weekly_reviews: zatwierdzenie tylko z UI (TJ403); poniedzialek; jedno zobowiazanie; rozliczany jest wczesniejszy przeglad", async () => {
        const wstaw = (tx: Db, tydzien: string, kolumny = "", wartosci = "") =>
          tx.unsafe(`INSERT INTO weekly_reviews (week_start${kolumny ? ", " + kolumny : ""}) VALUES ('${tydzien}'${wartosci ? ", " + wartosci : ""}) RETURNING id`);
        // kolejne poniedzialki (2037-01-05 to poniedzialek)
        const pon = (n: number) => new Date(Date.UTC(2037, 0, 5) + n * 7 * 86400000).toISOString().slice(0, 10);
        expect(new Date(pon(0) + "T00:00:00Z").getUTCDay()).toBe(1);
        const [w1] = await jako("api:5", (tx) => wstaw(tx, pon(0)));
        expect((await blad(wstaw(sql, "2037-01-06"))).constraint_name).toBe("weekly_reviews_week_monday");
        expect((await blad(wstaw(sql, pon(0)))).constraint_name).toBe("weekly_reviews_week_uq");

        // zatwierdzenie tylko z UI
        await trigger("weekly_reviews", "weekly_reviews_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
          tx`UPDATE weekly_reviews SET status = 'approved', approved_at = now() WHERE id = ${w1.id}`));
        await trigger("weekly_reviews", "weekly_reviews_ui_actor", "TJ403", jakoAktor("import", (tx) =>
          wstaw(tx, pon(1), "status, approved_at", "'approved', now()")));
        await jako("ui", (tx) => tx`UPDATE weekly_reviews SET status = 'approved', approved_at = now() WHERE id = ${w1.id}`);
        // cofniecie zatwierdzenia tez tylko z UI
        await trigger("weekly_reviews", "weekly_reviews_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
          tx`UPDATE weekly_reviews SET status = 'draft', approved_at = NULL WHERE id = ${w1.id}`));
        expect((await blad(jako("ui", (tx) => tx`UPDATE weekly_reviews SET approved_at = NULL WHERE id = ${w1.id}`))).constraint_name).toBe("weekly_reviews_approved");

        // jedno zobowiazanie (jedna kolumna), rozliczane w nastepnym tygodniu
        const wCom = await slowa(sql, "zobowiazanie: bez trade'ow po 15:00", { day: pon(0) });
        await sql`UPDATE weekly_reviews SET commitment_words_id = ${wCom} WHERE id = ${w1.id}`;
        const [w2] = await wstaw(sql, pon(1), "prev_review_id, prev_commitment_result", `${w1.id}, 'partial'`);
        expect((await sql`SELECT prev_review_id FROM weekly_reviews WHERE id = ${w2.id}`)[0].prev_review_id).toBe(w1.id);
        // ten sam przeglad rozliczany dwa razy
        expect((await blad(wstaw(sql, pon(2), "prev_review_id", String(w1.id)))).constraint_name).toBe("weekly_reviews_prev_idx");
        // wynik rozliczenia bez wskazania przegladu / z niedozwolona wartoscia / slowa bez wyniku
        expect((await blad(wstaw(sql, pon(2), "prev_commitment_result", "'kept'"))).constraint_name).toBe("weekly_reviews_prev_linked");
        expect((await blad(wstaw(sql, pon(2), "prev_review_id, prev_commitment_result", `${w2.id}, 'zly'`))).constraint_name).toBe("weekly_reviews_prev_result");
        expect((await blad(wstaw(sql, pon(2), "prev_result_words_id", String(wCom)))).constraint_name).toBe("weekly_reviews_prev_words");
        // przeglad nie rozlicza sam siebie: najpierw lapie to trigger (tydzien nie jest wczesniejszy), a CHECK jest druga linia
        expect((await blad(sql`UPDATE weekly_reviews SET prev_review_id = id WHERE id = ${w2.id}`)).code).toBe("TJ422");
        await wycofywalna(async (tx) => {
          await tx.unsafe("ALTER TABLE weekly_reviews DISABLE TRIGGER weekly_reviews_prev_check");
          const e = await blad(tx`UPDATE weekly_reviews SET prev_review_id = id WHERE id = ${w2.id}`);
          expect(e.constraint_name).toBe("weekly_reviews_prev_self");
        });
        // rozliczany przeglad musi byc z wczesniejszego tygodnia (TJ422)
        await trigger("weekly_reviews", "weekly_reviews_prev_check", "TJ422", (tx) =>
          wstaw(tx, pon(-1), "prev_review_id", String(w2.id)));
        await trigger("weekly_reviews", "weekly_reviews_prev_check", "TJ422", (tx) =>
          tx`UPDATE weekly_reviews SET prev_review_id = ${w2.id} WHERE id = ${w1.id}`);
        // przeglad rozliczany nie da sie skasowac (NO ACTION), liczby i data musza isc w parze
        expect((await blad(sql`DELETE FROM weekly_reviews WHERE id = ${w1.id}`)).code).toBe("23503");
        expect((await blad(sql`UPDATE weekly_reviews SET stats_snapshot = '{}'::jsonb WHERE id = ${w1.id}`)).constraint_name).toBe("weekly_reviews_snapshot");
      });

      it("chart_annotations: NULLS NOT DISTINCT w unikacie, kotwica trade / dzien, kolejnosc czasu", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const wstaw = (ext: string, tradeId: number | null, day: string | null, extra = "") =>
          sql.unsafe(`INSERT INTO chart_annotations (platform, external_id, trade_id, day, shape, raw, captured_at${extra ? ", " + extra.split("|")[0] : ""})
                      VALUES ('tradingview', '${ext}', ${tradeId ?? "NULL"}, ${day ? `'${day}'` : "NULL"}, 'hline', '{}'::jsonb, now()${extra ? ", " + extra.split("|")[1] : ""})`);
        const ext = unik("rys");
        await wstaw(ext, t, null);
        // to samo (platforma, id, trade, dzien=NULL): zwykly UNIQUE przepuscilby duplikat
        expect((await blad(wstaw(ext, t, null))).constraint_name).toBe("chart_annotations_uq");
        await wstaw(ext, t, "2030-08-01"); // inny dzien
        await wstaw(ext, null, "2030-08-01"); // inny trade (NULL)
        expect((await blad(wstaw(ext, null, "2030-08-01"))).constraint_name).toBe("chart_annotations_uq");
        expect((await blad(wstaw(unik("rys"), null, null))).constraint_name).toBe("chart_annotations_anchor");
        expect((await blad(wstaw(unik("rys"), t, null, "time_from, time_to|'2030-01-02', '2030-01-01'"))).constraint_name).toBe("chart_annotations_time_order");
        expect((await blad(sql`INSERT INTO chart_annotations (platform, external_id, trade_id, shape, raw, captured_at)
          VALUES ('inna', 'x', ${t}, 'hline', '{}'::jsonb, now())`)).constraint_name).toBe("chart_annotations_platform");
      });

      it("profile_terms: potwierdzenie i odrzucenie tylko z UI (TJ403); termin unikalny po lower(f_unaccent); zrodla; poprawki tylko do dopisywania", async () => {
        const termin = unik("Płynność") + " po sweepie";
        const wstaw = (tx: Db, t: string, status = "proposed", decided = "NULL") =>
          tx.unsafe(`INSERT INTO profile_terms (term, meaning, status, origin, decided_at) VALUES ($1, 'FVG@5m', '${status}', 'ai', ${decided}) RETURNING id`, [t]);
        const [p] = await jako("api:5", (tx) => wstaw(tx, termin));
        // ten sam termin z innymi wielkosciami liter i bez ogonkow
        const eDup = await blad(wstaw(sql, termin.toUpperCase().replace("Ł", "L")));
        expect(eDup.code).toBe("23505");
        expect(eDup.constraint_name).toBe("profile_terms_term_norm_uq");
        const [norm] = await sql`SELECT term_norm FROM profile_terms WHERE id = ${p.id}`;
        expect(norm.term_norm).toBe(termin.toLowerCase().replace("ł", "l").replace("ś", "s").replace("ć", "c"));

        for (const status of ["confirmed", "rejected"]) {
          await trigger("profile_terms", "profile_terms_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
            tx.unsafe(`UPDATE profile_terms SET status = '${status}', decided_at = now() WHERE id = ${p.id}`)));
        }
        await trigger("profile_terms", "profile_terms_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
          wstaw(tx, unik("Inny termin"), "confirmed", "now()")));
        await jako("ui", (tx) => tx`UPDATE profile_terms SET status = 'confirmed', decided_at = now() WHERE id = ${p.id}`);
        expect((await blad(jako("ui", (tx) => tx`UPDATE profile_terms SET decided_at = NULL WHERE id = ${p.id}`))).constraint_name).toBe("profile_terms_decided");

        // zrodla: klucz glowny (term, slowa); slowa kasowane -> zrodlo znika
        const w = await slowa(sql, "FVG po sweepie na piatce", { day: "2030-09-01" });
        await sql`INSERT INTO profile_term_sources (term_id, words_id) VALUES (${p.id}, ${w})`;
        expect((await blad(sql`INSERT INTO profile_term_sources (term_id, words_id) VALUES (${p.id}, ${w})`)).constraint_name).toBe("profile_term_sources_pk");

        // rejestr poprawek: tylko dopisywanie; FK term NO ACTION (nie SET NULL)
        const correction = await slowa(sql, "nie, chodzilo mi o FVG na 5m", { day: "2030-09-01" });
        const [c] = await sql`
          INSERT INTO interpretation_corrections (words_id, before_interpretation, correction_words_id, after_interpretation, term_id)
          VALUES (${w}, 'FVG', ${correction}, 'FVG@5m', ${p.id}) RETURNING id`;
        await trigger("interpretation_corrections", "interpretation_corrections_immutable", "TJ409", (tx) =>
          tx`UPDATE interpretation_corrections SET after_interpretation = 'inna' WHERE id = ${c.id}`);
        expect((await blad(sql`DELETE FROM profile_terms WHERE id = ${p.id}`)).code).toBe("23503");
        // slowa interpretowane kasowane (np. z trade'em) -> poprawka znika (CASCADE to DELETE, nie UPDATE)
        await sql`DELETE FROM user_words WHERE id = ${w}`;
        expect((await sql`SELECT 1 FROM interpretation_corrections WHERE id = ${c.id}`).length).toBe(0);
        expect((await sql`SELECT 1 FROM profile_term_sources WHERE term_id = ${p.id}`).length).toBe(0);
      });

      it("mentor_claims: skrot cytatu liczy baza (bajty UTF-8), cytat i znacznik czasu niezmienne; unikat; film z twierdzeniami", async () => {
        const [zr] = await sql`INSERT INTO mentor_sources (video_id, title, url) VALUES (${unik("vid")}, 'Film', 'https://youtu.be/abc') RETURNING id`;
        const [zr2] = await sql`INSERT INTO mentor_sources (video_id, title, url) VALUES (${unik("vid")}, 'Film 2', 'https://youtu.be/def') RETURNING id`;
        const cytat = "Zażółć gęślą jaźń: wchodzę dopiero po sweepie";
        const [c] = await sql`
          INSERT INTO mentor_claims (source_id, quote, quote_sha256, t_start_s, t_end_s, claim_type)
          VALUES (${zr.id}, ${cytat}, ${"b".repeat(64)}, 12, 30, 'setup_condition') RETURNING id, quote_sha256`;
        expect(c.quote_sha256).toBe(sha256Node(cytat)); // trigger nie ufa skrotowi od klienta
        const zmiany: Record<string, string> = {
          source_id: `source_id = ${zr2.id}`,
          quote: "quote = 'inny cytat'",
          quote_sha256: `quote_sha256 = '${"c".repeat(64)}'`,
          t_start_s: "t_start_s = 13",
          t_end_s: "t_end_s = 31",
        };
        for (const [kolumna, set] of Object.entries(zmiany)) {
          await trigger("mentor_claims", "mentor_claims_immutable", "TJ409", (tx) =>
            tx.unsafe(`UPDATE mentor_claims SET ${set} WHERE id = ${c.id}`), kolumna);
        }
        // zmienne: streszczenie AI, status
        await sql`UPDATE mentor_claims SET paraphrase = 'streszczenie', status = 'merged' WHERE id = ${c.id}`;
        // ocena zgodnosci z filmem (review_ok / review_bad) to decyzja uzytkownika (0028)
        expect((await blad(sql`UPDATE mentor_claims SET status = 'review_ok' WHERE id = ${c.id}`)).code).toBe("TJ403");
        await jako("ui", (tx) => tx`UPDATE mentor_claims SET status = 'review_ok' WHERE id = ${c.id}`);
        expect((await blad(sql`INSERT INTO mentor_claims (source_id, quote, t_start_s, claim_type) VALUES (${zr.id}, ${cytat}, 12, 'concept')`)).constraint_name).toBe("mentor_claims_source_quote_uq");
        await sql`INSERT INTO mentor_claims (source_id, quote, t_start_s, claim_type) VALUES (${zr.id}, ${cytat}, 99, 'concept')`;
        expect((await blad(sql`INSERT INTO mentor_claims (source_id, quote, t_start_s, t_end_s, claim_type) VALUES (${zr.id}, 'x', 10, 5, 'concept')`)).constraint_name).toBe("mentor_claims_t_end");
        expect((await blad(sql`INSERT INTO mentor_sources (video_id, title, url) VALUES ('v', 't', 'http://x')`)).constraint_name).toBe("mentor_sources_url");
        expect((await blad(sql`INSERT INTO mentor_sources (platform, video_id, title, url) VALUES ('youtube', ${(await sql`SELECT video_id FROM mentor_sources WHERE id = ${zr.id}`)[0].video_id}, 't', 'https://x')`)).constraint_name).toBe("mentor_sources_video_uq");
        // kasowanie notatki, do ktorej wlaczono twierdzenie, tylko zeruje merged_note_id (kolumna poza ochrona)
        const nid = await nowaNotatka(sql, unik("Wlaczone"), { kind: "concept" });
        await sql`UPDATE mentor_claims SET merged_note_id = ${nid} WHERE id = ${c.id}`;
        await sql`DELETE FROM notes WHERE id = ${nid}`;
        expect((await sql`SELECT merged_note_id FROM mentor_claims WHERE id = ${c.id}`)[0].merged_note_id).toBeNull();
        // film z twierdzeniami kasuje sie razem z nimi, o ile nic na nie nie wskazuje
        await sql`DELETE FROM mentor_sources WHERE id = ${zr.id}`;
        expect((await sql`SELECT 1 FROM mentor_claims WHERE id = ${c.id}`).length).toBe(0);
      });

      it("strategy_gaps: odpowiedz i odrzucenie tylko z UI (TJ403), 'asked' ustawia API; resolution tylko dla mentor_conflict i tylko przy answered", async () => {
        const [zr] = await sql`INSERT INTO mentor_sources (video_id, title, url) VALUES (${unik("vid")}, 'Film', 'https://youtu.be/abc') RETURNING id`;
        const [claim] = await sql`INSERT INTO mentor_claims (source_id, quote, t_start_s, claim_type) VALUES (${zr.id}, ${unik("cytat")}, 5, 'concept') RETURNING id`;
        const klucz = () => sha256Node(unik("pytanie"));
        const wstaw = (tx: Db, kind: string, o: { claim?: number | null; key?: string } = {}) => tx`
          INSERT INTO strategy_gaps (kind, question, dedupe_key, mentor_claim_id, origin)
          VALUES (${kind}, 'Czy wchodzisz bez sweepu?', ${o.key ?? klucz()}, ${o.claim ?? null}, 'ai') RETURNING id`;
        const [luka] = await jako("api:5", (tx) => wstaw(tx, "gap"));
        const [konflikt] = await jako("api:5", (tx) => wstaw(tx, "mentor_conflict", { claim: claim.id }));
        // 'asked' ustawia API
        await jako("api:5", (tx) => tx`UPDATE strategy_gaps SET status = 'asked', asked_at = now() WHERE id = ${luka.id}`);
        const odp = await slowa(sql, "Nie, czekam na sweep zawsze.", { day: "2030-10-01" });
        const answered = (id: number, res = "NULL") =>
          `UPDATE strategy_gaps SET status = 'answered', answered_at = now(), answer_words_id = ${odp}, resolution = ${res} WHERE id = ${id}`;
        await trigger("strategy_gaps", "strategy_gaps_ui_actor", "TJ403", jakoAktor("api:5", (tx) => tx.unsafe(answered(luka.id))));
        await trigger("strategy_gaps", "strategy_gaps_ui_actor", "TJ403", jakoAktor("api:5", (tx) => tx.unsafe(answered(konflikt.id, "'keep_mine'"))));
        await trigger("strategy_gaps", "strategy_gaps_ui_actor", "TJ403", jakoAktor("api:5", (tx) =>
          tx`UPDATE strategy_gaps SET status = 'dismissed' WHERE id = ${luka.id}`));
        await trigger("strategy_gaps", "strategy_gaps_ui_actor", "TJ403", jakoAktor("import", (tx) =>
          tx`INSERT INTO strategy_gaps (kind, question, dedupe_key, origin, status) VALUES ('gap', 'q', ${klucz()}, 'ai', 'dismissed')`));
        await jako("ui", (tx) => tx.unsafe(answered(luka.id)));
        await jako("ui", (tx) => tx.unsafe(answered(konflikt.id, "'both_conditional'")));

        // CHECK-i rozstrzygniecia
        const eLuka = await blad(jako("ui", (tx) => tx`UPDATE strategy_gaps SET resolution = 'keep_mine' WHERE id = ${luka.id}`));
        expect(eLuka.constraint_name).toBe("strategy_gaps_resolution");
        const eBez = await blad(jako("ui", (tx) => tx`UPDATE strategy_gaps SET resolution = NULL WHERE id = ${konflikt.id}`));
        expect(eBez.constraint_name).toBe("strategy_gaps_resolution");
        const eZly = await blad(jako("ui", (tx) => tx`UPDATE strategy_gaps SET resolution = 'moze' WHERE id = ${konflikt.id}`));
        expect(eZly.constraint_name).toBe("strategy_gaps_resolution_value");
        const [otwarty] = await jako("api:5", (tx) => wstaw(tx, "mentor_conflict", { claim: claim.id }));
        const eResPrzedOdp = await blad(jako("ui", (tx) => tx`UPDATE strategy_gaps SET resolution = 'keep_mine' WHERE id = ${otwarty.id}`));
        expect(eResPrzedOdp.constraint_name).toBe("strategy_gaps_resolution");
        expect((await blad(jako("ui", (tx) => tx`UPDATE strategy_gaps SET status = 'answered', answered_at = now(), resolution = 'keep_mine' WHERE id = ${otwarty.id}`))).constraint_name).toBe("strategy_gaps_answer");
        expect((await blad(jako("api:5", (tx) => wstaw(tx, "mentor_conflict")))).constraint_name).toBe("strategy_gaps_conflict");

        // to samo pytanie nie wisi dwa razy otwarte; po rozstrzygnieciu mozna je zadac ponownie
        const k = klucz();
        await jako("api:5", (tx) => wstaw(tx, "gap", { key: k }));
        expect((await blad(jako("api:5", (tx) => wstaw(tx, "gap", { key: k })))).constraint_name).toBe("strategy_gaps_open_dedupe_idx");
        await jako("ui", (tx) => tx`UPDATE strategy_gaps SET status = 'dismissed' WHERE dedupe_key = ${k}`);
        await jako("api:5", (tx) => wstaw(tx, "gap", { key: k }));

        // twierdzenie, na ktore wskazuje pytanie, nie da sie skasowac (FK NO ACTION, bo CHECK wymaga cytatu)
        expect((await blad(sql`DELETE FROM mentor_claims WHERE id = ${claim.id}`)).code).toBe("23503");
        expect((await blad(sql`DELETE FROM mentor_sources WHERE id = ${zr.id}`)).code).toBe("23503");
      });
    });


    /* ------------------------------------------------------------------ (g) */
    describe("(g) kasowanie trade'u nie jest blokowane przez zadne nowe ograniczenie ani trigger", () => {
      it("trade z planem, dopiskami planu, rysunkami, przykladami, linkami, werdyktami (z korekta), pytaniem i dopiskiem AI: DELETE przechodzi, reszta kaskaduje albo zeruje", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const { setupId } = await nowySetup(sql);
        const noteId = await nowaNotatka(sql, unik("Strategia kasowanie"), { kind: "strategy" });
        const wTrade = await slowa(sql, "opis trade'u", { tradeId: t });
        const wPlan = await slowa(sql, "teza planu", { tradeId: t });
        const wAdd = await slowa(sql, "przesuwam SL", { tradeId: t });
        const wChart = await slowa(sql, "poziom z wykresu", { tradeId: t, source: "chart" });
        const [plan] = await sql`
          INSERT INTO trade_plans (trade_id, account_id, instrument_id, day, ruleset_version, direction, entry_price, stop_loss, contracts, risk_cents, origin, thesis_words_id, invalidation_words_id)
          VALUES (${t}, ${k.accountId}, ${k.instrumentId}, '2030-11-01', 0, 'long', 100, 95, 1, 100, 'user', ${wPlan}, ${wPlan}) RETURNING id`;
        await sql`INSERT INTO trade_plan_addenda (plan_id, field, words_id) VALUES (${plan.id}, 'other', ${wAdd})`;
        await sql`INSERT INTO chart_annotations (platform, external_id, trade_id, shape, raw, captured_at, words_id)
                  VALUES ('tradingview', ${unik("rys")}, ${t}, 'hline', '{}'::jsonb, now(), ${wChart})`;
        await sql`INSERT INTO setup_examples (setup_id, trade_id, kind, origin, caption_words_id) VALUES (${setupId}, ${t}, 'a_plus', 'user', ${wTrade})`;
        await sql`INSERT INTO trade_note_links (trade_id, note_id, role, origin) VALUES (${t}, ${noteId}, 'concept', 'user')`;
        const ai = await sql.begin((tx) => werdyktZSprawdzeniem(tx, t));
        const korekta = await sql.begin(async (tx) => {
          const id = await werdykt(tx, t, { kind: "user_override", overrides: ai });
          await tx`INSERT INTO trade_rule_checks (review_id, rule_id, rule_text, verdict) VALUES (${id}, 'R-001', 'regula', 'fail')`;
          return id;
        });
        const [gap] = await sql`INSERT INTO strategy_gaps (kind, question, dedupe_key, trade_id, origin) VALUES ('gap', 'q', ${sha256Node(unik("g"))}, ${t}, 'ai') RETURNING id`;
        const [dopisek] = await sql`
          INSERT INTO note_additions (note_id, body_md, origin, trade_id, quote_words_id) VALUES (${noteId}, 'AI: obserwacja', 'ai', ${t}, ${wTrade}) RETURNING id`;

        await sql`DELETE FROM trades WHERE id = ${t}`; // nie moze pasc na zadnym triggerze, CHECK-u ani FK

        const ile = async (tabela: string, warunek: string) =>
          (await sql.unsafe(`SELECT count(*)::int AS n FROM ${tabela} WHERE ${warunek}`))[0].n as number;
        expect(await ile("trade_plans", `id = ${plan.id}`)).toBe(0);
        expect(await ile("trade_plan_addenda", `plan_id = ${plan.id}`)).toBe(0);
        expect(await ile("chart_annotations", `trade_id = ${t}`)).toBe(0);
        expect(await ile("setup_examples", `trade_id = ${t}`)).toBe(0);
        expect(await ile("trade_note_links", `trade_id = ${t}`)).toBe(0);
        expect(await ile("trade_reviews", `id IN (${ai}, ${korekta})`)).toBe(0);
        expect(await ile("trade_rule_checks", `review_id IN (${ai}, ${korekta})`)).toBe(0);
        expect(await ile("user_words", `id IN (${wTrade}, ${wPlan}, ${wAdd}, ${wChart})`)).toBe(0);
        // przezywaja z wyzerowanymi kotwicami
        expect((await sql`SELECT trade_id FROM strategy_gaps WHERE id = ${gap.id}`)[0].trade_id).toBeNull();
        expect(await sql`SELECT trade_id, quote_words_id FROM note_additions WHERE id = ${dopisek.id}`).toEqual([{ trade_id: null, quote_words_id: null }]);
        // dopisek zostaje niezmienny, mimo ze jego kotwice zostaly wyzerowane
        expect((await blad(sql`UPDATE note_additions SET body_md = 'x' WHERE id = ${dopisek.id}`)).code).toBe("TJ409");
      });

      it("kasowanie sesji backtestu zabiera jej plany, rysunki i slowa; kasowanie setupu z planem jest blokowane (RESTRICT), bez planu przechodzi", async () => {
        const k = await kontoInstr(sql);
        const sesja = await nowaSesja(sql);
        const { setupId } = await nowySetup(sql);
        await sql`
          INSERT INTO trade_plans (backtest_session_id, account_id, instrument_id, day, ruleset_version, direction, entry_price, stop_loss, contracts, risk_cents, origin, setup_id)
          VALUES (${sesja}, ${k.accountId}, ${k.instrumentId}, '2030-11-01', 0, 'long', 100, 95, 1, 100, 'user', ${setupId})`;
        expect((await blad(sql`DELETE FROM setups WHERE id = ${setupId}`)).code).toBe("23503");
        await sql`DELETE FROM backtest_sessions WHERE id = ${sesja}`;
        expect((await sql`SELECT 1 FROM trade_plans WHERE backtest_session_id = ${sesja}`).length).toBe(0);
        await sql`DELETE FROM setups WHERE id = ${setupId}`;
      });

      it("kasowanie trade'u uzywa indeksow (bez skanowania sekwencyjnego tabel potomnych)", async () => {
        await wycofywalna(async (tx) => {
          await tx`SET LOCAL enable_seqscan = off`;
          const plany: [string, string][] = [
            ["trade_reviews", "trade_reviews_trade_idx"],
            ["trade_plans", "trade_plans_trade_uq"],
            ["setup_examples", "setup_examples_trade_idx"],
            ["trade_note_links", "trade_note_links_uq"],
            ["chart_annotations", "chart_annotations_trade_idx"],
            ["note_additions", "note_additions_trade_idx"],
            ["strategy_gaps", "strategy_gaps_trade_idx"],
            ["trade_plan_addenda", "trade_plan_addenda_plan_idx"],
          ];
          for (const [tabela, indeks] of plany) {
            const kolumna = tabela === "trade_plan_addenda" ? "plan_id" : "trade_id";
            const plan = (await tx.unsafe(`EXPLAIN SELECT 1 FROM ${tabela} WHERE ${kolumna} = 1`)).map((r) => r["QUERY PLAN"]).join("\n");
            expect(plan, `${tabela}: ${kolumna} = 1`).toContain(indeks);
          }
        });
      });
    });

    /* ------------------------------------------------------------------ (h) */
    describe("(h) dane brokera, wynik netto i konto dnia (0030-0032, ADR-034)", () => {
      const migracjaSql = (nr: string) => readFileSync(path.join(ROOT, "drizzle", nr), "utf8");

      /** Token z podanymi zakresami wpisany prosto do bazy; import_broker wymaga created_via = ui i terminu (CHECK). */
      async function tokenZakresy(db: Db, scopes: string[], o: { wygasl?: boolean; uniewazniony?: boolean } = {}): Promise<number> {
        const brokerowy = scopes.includes("import_broker");
        const [t] = await db`
          INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via, expires_at, revoked_at)
          VALUES ('brk', ${"tk" + String(100000 + ++seq)}, ${sha256Node(unik("tok"))}, ${scopes}, ${brokerowy ? "ui" : "device_code"},
                  ${brokerowy ? (o.wygasl ? new Date(Date.now() - 1000) : new Date(Date.now() + 86_400_000)) : null},
                  ${o.uniewazniony ? new Date() : null})
          RETURNING id`;
        return t.id as number;
      }

      /** Konto u brokera wstawione jako uzytkownik (aktor ui; aktor zostaje ustawiony do konca transakcji). */
      async function kontoBrokera(tx: Tx, accountId: number | null = null): Promise<number> {
        await aktor(tx, "ui");
        const [b] = await tx`
          INSERT INTO broker_accounts (account_id, platform, method, external_account_hmac, label_last4)
          VALUES (${accountId}, 'tradovate', 'export_file', ${sha256Node(unik("hmac"))}, '0042') RETURNING id`;
        return b.id as number;
      }

      async function importUi(tx: Tx, o: { sha?: string; status?: string; origin?: string; tokenId?: number | null } = {}): Promise<number> {
        const [i] = await tx`
          INSERT INTO broker_imports (origin, format, file_sha256, tz, rows_total, rows_skipped, fills_new, fills_duplicate, trades_matched, trades_created, pending_decisions, status, reverted_at, created_by_token_id)
          VALUES (${o.origin ?? "ui"}, 'tradovate_orders', ${o.sha ?? sha256Node(unik("plik"))}, 'Europe/Warsaw', 1, 0, 1, 0, 0, 0, 0, ${o.status ?? "committed"},
                  ${o.status === "reverted" ? new Date() : null}, ${o.tokenId ?? null})
          RETURNING id`;
        return i.id as number;
      }

      /** Import nalezacy do tokenu: pochodzenie tj_watch wstawia sam token, potem aktor wraca do ui. Bez tokenu: zwykly import ui. */
      async function importTokenu(tx: Tx, tokenId: number | null): Promise<number> {
        if (tokenId === null) {
          await aktor(tx, "ui");
          return importUi(tx);
        }
        await aktor(tx, `api:${tokenId}`);
        const id = await importUi(tx, { origin: "tj_watch", tokenId });
        await aktor(tx, "ui");
        return id;
      }

      const wstawBrokerTrade = (tx: Tx, brokerAccountId: number, importId: number | null, extra: { tradeId?: number | null; matchKind?: string | null; ref?: string } = {}) =>
        tx`INSERT INTO broker_trades (broker_account_id, import_id, external_ref, contract, direction, max_qty, entry_time, exit_time, avg_entry_price, avg_exit_price, status,
                                      trade_id, match_kind, match_state)
           VALUES (${brokerAccountId}, ${importId}, ${extra.ref ?? unik("brk:tradovate:abc:t")}, 'MNQZ6', 'long', 3, now() - interval '1 hour', now(), 100, 101, 'closed',
                   ${extra.tradeId ?? null}, ${extra.matchKind ?? null}, ${extra.tradeId ? "matched" : "unmatched"})
           RETURNING id`;

      const wstawFill = (tx: Tx, brokerAccountId: number, importId: number | null, brokerTradeId: number | null = null) =>
        tx`INSERT INTO broker_fills (broker_account_id, import_id, external_ref, broker_trade_id, contract, side, qty, price, filled_at, raw)
           VALUES (${brokerAccountId}, ${importId}, ${unik("tradovate:abc:f")}, ${brokerTradeId}, 'MNQZ6', 'buy', 3, 100, now(), '{}'::jsonb) RETURNING id`;

      const wstawCash = (tx: Tx, brokerAccountId: number, importId: number | null) =>
        tx`INSERT INTO broker_cash_events (broker_account_id, import_id, external_ref, kind, delta_cents, contract, occurred_at, raw)
           VALUES (${brokerAccountId}, ${importId}, ${unik("tradovate:abc:cash:c")}, 'commission', -150, 'MNQZ6', now(), '{}'::jsonb) RETURNING id`;

      it("0030: wynik netto i stawki: CHECK-i nieujemne, klasa kontraktu mini/micro, migracja klas po symbolu", async () => {
        const k = await kontoInstr(sql);
        const kod = async (q: PromiseLike<unknown>) => (await blad(q)).constraint_name;
        expect(await kod(sql`UPDATE trades SET fees = -1 WHERE id = ${await tradeDla(sql, k)}`)).toBe("trades_fees");
        expect(await kod(sql`UPDATE instruments SET size_class = 'maxi' WHERE id = ${k.instrumentId}`)).toBe("instruments_size_class");
        expect(await kod(sql`UPDATE accounts SET fee_rt_mini_cents = -5 WHERE id = ${k.accountId}`)).toBe("accounts_fee_mini");
        expect(await kod(sql`UPDATE accounts SET fee_rt_micro_cents = -5 WHERE id = ${k.accountId}`)).toBe("accounts_fee_micro");
        expect(await kod(sql`UPDATE prop_firm_presets SET fee_rt_mini_cents = -1 WHERE id = (SELECT min(id) FROM prop_firm_presets)`)).toBe("prop_firm_presets_fee_mini");
        expect(await kod(sql`UPDATE prop_firm_presets SET fee_source_url = 'http://x' WHERE id = (SELECT min(id) FROM prop_firm_presets)`)).toBe("prop_firm_presets_fee_source_url");
        const ogr = (await sql`SELECT conname FROM pg_constraint WHERE conname IN ('prop_rules_fee_mini', 'prop_rules_fee_micro', 'prop_rules_fee_source_url')`).map((r) => r.conname).sort();
        expect(ogr).toEqual(["prop_rules_fee_micro", "prop_rules_fee_mini", "prop_rules_fee_source_url"]);

        // klasa po symbolu: instrukcja z migracji na swiezych wierszach (tabela instruments byla pusta w chwili migracji)
        const instrukcja = migracjaSql("0030_wynik_netto.sql").split("--> statement-breakpoint").map((s) => s.trim()).find((s) => s.startsWith('UPDATE "instruments"'));
        expect(instrukcja).toBeTruthy();
        await wycofywalna(async (tx) => {
          const [micro] = await tx`INSERT INTO instruments (symbol, name, tick_size, tick_value) VALUES ('MBT', 'x', 0.25, 500) RETURNING id`;
          const [mini] = await tx`INSERT INTO instruments (symbol, name, tick_size, tick_value) VALUES ('ZZT', 'x', 0.25, 5000) RETURNING id`;
          await tx.unsafe(instrukcja!);
          const w = await tx`SELECT symbol, size_class FROM instruments WHERE id IN (${micro.id}, ${mini.id})`;
          expect(Object.fromEntries(w.map((x) => [x.symbol, x.size_class]))).toEqual({ MBT: "micro", ZZT: "mini" });
        });
      });

      it("0032: stawki oplat w presetach zgodne z JSON-em (kolumny i extra.fee), lista firm i platform jako dane z linkiem i data odczytu", async () => {
        const json = JSON.parse(readFileSync(path.join(ROOT, "docs", "research", "prop-presety.json"), "utf8")) as Record<string, unknown>[];
        const wBazie = await sql`SELECT fee_rt_mini_cents::text AS mini, fee_rt_micro_cents::text AS micro, fee_source_url AS url, extra->'fee' AS fee FROM prop_firm_presets ORDER BY id`;
        expect(wBazie.length).toBe(json.length);
        const roznice: string[] = [];
        wBazie.forEach((b, i) => {
          const w = json[i];
          const liczba = (v: unknown) => (v === null || v === undefined ? null : String(v));
          if (b.mini !== liczba(w.fee_rt_mini_cents)) roznice.push(`#${i + 1} mini: baza=${String(b.mini)} json=${String(w.fee_rt_mini_cents)}`);
          if (b.micro !== liczba(w.fee_rt_micro_cents)) roznice.push(`#${i + 1} micro: baza=${String(b.micro)} json=${String(w.fee_rt_micro_cents)}`);
          if ((b.url ?? null) !== ((w.fee_source_url as string | null | undefined) ?? null)) roznice.push(`#${i + 1} url`);
          if (!isDeepStrictEqual(b.fee, (w.extra as Record<string, unknown>).fee)) roznice.push(`#${i + 1} extra.fee`);
        });
        expect(roznice).toEqual([]);
        const [lucid] = await sql`SELECT fee_rt_mini_cents::int AS mini, fee_rt_micro_cents::int AS micro FROM prop_firm_presets WHERE firm = 'Lucid Trading' AND program = 'LucidPro' AND phase = 'funded' AND account_size_cents = 10000000`;
        expect(lucid).toEqual({ mini: 350, micro: 100 }); // MNQ 1,00 USD za kontrakt w obie strony: POTWIERDZONE na probce uzytkownika

        const platformy = await sql`SELECT firm, platform, methods, source_url, read_on::text AS read_on FROM prop_firm_platforms ORDER BY id`;
        expect(platformy.length).toBe(24);
        expect(platformy.every((p) => /^https:\/\//.test(p.source_url) && p.read_on === "2026-10-16" && p.methods.length === 1 && p.methods[0] === "export_file")).toBe(true);
        expect(new Set(platformy.map((p) => p.firm)).size).toBe(11);
        expect(platformy.some((p) => p.firm === "Własne konto Tradovate" && p.platform === "Tradovate")).toBe(true);
        expect((await blad(sql`INSERT INTO prop_firm_platforms (firm, platform, methods, source_url, read_on) VALUES ('X', 'Y', ARRAY['oauth_tradovate','email'], 'https://x.pl', '2026-10-16')`)).constraint_name).toBe("prop_firm_platforms_methods");
        expect((await blad(sql`INSERT INTO prop_firm_platforms (firm, platform, methods, source_url, read_on) VALUES ('X', 'Y', ARRAY['export_file'], 'http://x.pl', '2026-10-16')`)).constraint_name).toBe("prop_firm_platforms_source_url");
      });

      it("zakres import_broker: tylko samodzielny, tylko z UI i zawsze z terminem; kod urzadzenia go nie da", async () => {
        const wstaw = (scopes: string[], via: string, wygasa: Date | null) =>
          sql`INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via, expires_at)
              VALUES ('x', ${"tk" + String(100000 + ++seq)}, ${sha256Node(unik("t"))}, ${scopes}, ${via}, ${wygasa})`;
        const jutro = new Date(Date.now() + 86_400_000);
        expect((await blad(wstaw(["import_broker", "read"], "ui", jutro))).constraint_name).toBe("api_tokens_scopes");
        expect((await blad(wstaw(["import_broker", "import"], "ui", jutro))).constraint_name).toBe("api_tokens_scopes");
        expect((await blad(wstaw(["import_broker"], "device_code", jutro))).constraint_name).toBe("api_tokens_import_broker");
        expect((await blad(wstaw(["import_broker"], "ui", null))).constraint_name).toBe("api_tokens_import_broker");
        await wycofywalna(async (tx) => {
          await tx`INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via, expires_at) VALUES ('ok', 'tkokaaaa', ${sha256Node(unik("t"))}, ARRAY['import_broker'], 'ui', ${jutro})`;
          // pozostale zakresy dzialaja jak dotad, w tym import (sejf) bez terminu
          await tx`INSERT INTO api_tokens (name, prefix, token_sha256, scopes, created_via) VALUES ('ok2', 'tkokbbbb', ${sha256Node(unik("t"))}, ARRAY['read','write','propose','import'], 'ui')`;
        });
        expect(
          (await blad(sql`INSERT INTO device_codes (device_code_sha256, user_code, client_name, requested_scopes, expires_at) VALUES (${sha256Node(unik("dc"))}, 'BCDF-GHJL', 'tj', ARRAY['import_broker'], now() + interval '10 minutes')`)).constraint_name,
        ).toBe("device_codes_requested_scopes");
      });

      it("zapis do tabel brokera: tylko aktor ui albo token z jedynym zakresem import_broker (nie wygasly, nie uniewazniony); agent AI i brak aktora dostaja TJ403", async () => {
        const dobry = await tokenZakresy(sql, ["import_broker"]);
        const wygasly = await tokenZakresy(sql, ["import_broker"], { wygasl: true });
        const uniewazniony = await tokenZakresy(sql, ["import_broker"], { uniewazniony: true });
        const agent = await tokenZakresy(sql, ["read", "write", "propose"]);
        type Kontekst = { konto: number; imp: number; bt: number; fill: number };
        // fundament wstawiony jako ui, potem zmiana aktora na badanego
        const proba = (aktorProby: string, akcja: (tx: Tx, c: Kontekst) => Promise<unknown>) => async (tx: Tx) => {
          const konto = await kontoBrokera(tx);
          // import nalezy do dobrego tokenu: UPDATE importu token moze tylko na wlasnym
          const wlasciciel = aktorProby === `api:${dobry}` ? dobry : null; // pozostale tokeny nie moga nawet zalozyc importu (trigger pochodzenia)
          const imp = await importTokenu(tx, wlasciciel);
          const [bt] = await wstawBrokerTrade(tx, konto, imp);
          const [fill] = await wstawFill(tx, konto, imp, bt.id);
          await aktor(tx, aktorProby);
          return akcja(tx, { konto, imp, bt: bt.id, fill: fill.id });
        };
        const tabele: [string, string, (tx: Tx, c: Kontekst) => Promise<unknown>][] = [
          ["broker_imports", "broker_imports_zapis", (tx, c) => tx`UPDATE broker_imports SET rows_skipped = 1 WHERE id = ${c.imp}`],
          ["broker_fills", "broker_fills_zapis", (tx, c) => wstawFill(tx, c.konto, c.imp)],
          ["broker_trades", "broker_trades_zapis", (tx, c) => wstawBrokerTrade(tx, c.konto, c.imp)],
          ["broker_cash_events", "broker_cash_events_zapis", (tx, c) => wstawCash(tx, c.konto, c.imp)],
        ];
        for (const [tabela, nazwaTriggera, akcja] of tabele) {
          for (const zly of [`api:${agent}`, `api:${wygasly}`, `api:${uniewazniony}`, "ingest", "api:999999999", "api:x1", ""]) {
            await trigger(tabela, nazwaTriggera, "TJ403", proba(zly, akcja), "wymaga aktora");
          }
          // dobry token importu i uzytkownik przechodza
          await wycofywalna(async (tx) => { await proba(`api:${dobry}`, akcja)(tx); });
          await wycofywalna(async (tx) => { await proba("ui", akcja)(tx); });
        }
        // token importu nie ruszy CUDZEGO importu ani nie zmieni jego statusu (audyt W1: cofanie i kasowanie to wylacznie UI)
        await trigger("broker_imports", "broker_imports_zapis", "TJ403", async (tx) => {
          const imp = await importTokenu(tx, null);
          await aktor(tx, `api:${dobry}`);
          return tx`UPDATE broker_imports SET rows_skipped = 1 WHERE id = ${imp}`;
        }, "wymaga aktora");
        await trigger("broker_imports", "broker_imports_zapis", "TJ403", async (tx) => {
          const imp = await importTokenu(tx, dobry);
          await aktor(tx, `api:${dobry}`);
          return tx`UPDATE broker_imports SET status = 'reverted', reverted_at = now() WHERE id = ${imp}`;
        }, "wymaga aktora");
        await trigger("broker_imports", "broker_imports_zapis", "TJ403", async (tx) => {
          const imp = await importTokenu(tx, dobry);
          await aktor(tx, `api:${dobry}`);
          return tx`DELETE FROM broker_imports WHERE id = ${imp}`;
        }, "wymaga aktora");
        // agent nie skasuje i nie zmieni danych brokera
        await trigger("broker_fills", "broker_fills_zapis", "TJ403", proba(`api:${agent}`, (tx, c) => tx`DELETE FROM broker_fills WHERE id = ${c.fill}`));
        await trigger("broker_trades", "broker_trades_zapis", "TJ403", proba(`api:${agent}`, (tx, c) => tx`UPDATE broker_trades SET match_state = 'skipped' WHERE id = ${c.bt}`));
        await trigger("broker_cash_events", "broker_cash_events_zapis", "TJ403", proba(`api:${agent}`, async (tx, c) => {
          await aktor(tx, "ui");
          const [z] = await wstawCash(tx, c.konto, c.imp);
          await aktor(tx, `api:${agent}`);
          return tx`DELETE FROM broker_cash_events WHERE id = ${z.id}`;
        }));
      });

      it("konto u brokera: token importu moze tylko zglosic nowe, nieprzypisane konto; przypisanie i zmiany robi wylacznie uzytkownik", async () => {
        const dobry = await tokenZakresy(sql, ["import_broker"]);
        const k = await kontoInstr(sql);
        const wstawToken = (accountId: number | null) =>
          jakoAktor(`api:${dobry}`, (tx) =>
            tx`INSERT INTO broker_accounts (account_id, platform, method, external_account_hmac) VALUES (${accountId}, 'tradovate', 'export_file', ${sha256Node(unik("hmac"))})`);
        await wycofywalna(async (tx) => { await wstawToken(null)(tx); });
        await trigger("broker_accounts", "broker_accounts_zapis", "TJ403", wstawToken(k.accountId), "niedozwolony");
        await trigger("broker_accounts", "broker_accounts_zapis", "TJ403", async (tx) => {
          const id = await kontoBrokera(tx);
          await aktor(tx, `api:${dobry}`);
          return tx`UPDATE broker_accounts SET account_id = ${k.accountId} WHERE id = ${id}`;
        });
        await wycofywalna(async (tx) => {
          const id = await kontoBrokera(tx);
          await tx`UPDATE broker_accounts SET account_id = ${k.accountId} WHERE id = ${id}`; // uzytkownik przypisuje
        });
        // ograniczenia kolumn
        expect((await blad(sql.begin(async (tx) => { await aktor(tx, "ui"); return tx`INSERT INTO broker_accounts (platform, method, external_account_hmac) VALUES ('tradovate', 'export_file', 'nie-hex')`; }))).constraint_name).toBe("broker_accounts_hmac");
        expect((await blad(sql.begin(async (tx) => { await aktor(tx, "ui"); return tx`INSERT INTO broker_accounts (platform, method, external_account_hmac) VALUES ('rithmic', 'oauth_tradovate', ${sha256Node(unik("h"))})`; }))).constraint_name).toBe("broker_accounts_method_platform");
        expect((await blad(sql.begin(async (tx) => { await aktor(tx, "ui"); return tx`INSERT INTO broker_accounts (platform, method, external_account_hmac, label_last4) VALUES ('tradovate', 'export_file', ${sha256Node(unik("h"))}, '12345')`; }))).constraint_name).toBe("broker_accounts_last4");
      });

      it("pochodzenie importu wynika z aktora: ui tylko od uzytkownika, tj_watch tylko od tokenu importu ze swoim numerem, oauth wylaczone", async () => {
        const dobry = await tokenZakresy(sql, ["import_broker"]);
        const inny = await tokenZakresy(sql, ["import_broker"]);
        const probaOrigin = (aktorProby: string, o: Parameters<typeof importUi>[1]) => async (tx: Tx) => {
          await aktor(tx, aktorProby);
          return importUi(tx, o);
        };
        // tabela broker_imports_zapis przepuszcza token i uzytkownika, wiec bledy pochodza z triggera pochodzenia
        await trigger("broker_imports", "broker_imports_origin", "TJ403", probaOrigin("ui", { origin: "tj_watch" }), "pochodzeniem");
        await trigger("broker_imports", "broker_imports_origin", "TJ403", probaOrigin(`api:${dobry}`, { origin: "ui" }));
        await trigger("broker_imports", "broker_imports_origin", "TJ403", probaOrigin(`api:${dobry}`, { origin: "tj_watch", tokenId: inny }));
        await trigger("broker_imports", "broker_imports_origin", "TJ403", probaOrigin(`api:${dobry}`, { origin: "tj_watch", tokenId: null }));
        await wycofywalna(async (tx) => {
          await probaOrigin(`api:${dobry}`, { origin: "tj_watch", tokenId: dobry })(tx);
          await probaOrigin("ui", { origin: "ui" })(tx);
        });
        const oauth = async (tx: Tx) => {
          await aktor(tx, "ui");
          return tx`INSERT INTO broker_imports (origin, format, file_sha256, tz, rows_total, rows_skipped, fills_new, fills_duplicate, trades_matched, trades_created, pending_decisions) VALUES ('oauth', 'x', NULL, 'UTC', 0, 0, 0, 0, 0, 0, 0)`;
        };
        await trigger("broker_imports", "broker_imports_origin", "TJ403", oauth);
      });

      it("ten sam plik zatwierdzony dwa razy nie przejdzie (unikalny SHA), a odrzucony i cofniety moga sie powtarzac; CHECK-i importu", async () => {
        const sha = sha256Node(unik("plik"));
        await wycofywalna(async (tx) => {
          await aktor(tx, "ui");
          await importUi(tx, { sha });
          await importUi(tx, { sha, status: "rejected" });
          await importUi(tx, { sha, status: "reverted" });
          await importUi(tx, { sha, status: "rejected" });
          const e = await blad(tx.savepoint((s) => importUi(s, { sha })));
          expect(e.constraint_name).toBe("broker_imports_sha_committed_uq");
        });
        const wstawImport = (kolumny: string, wartosci: string) =>
          sql.begin(async (tx) => {
            await aktor(tx, "ui");
            return tx.unsafe(
              `INSERT INTO broker_imports (origin, format, file_sha256, tz, rows_total, rows_skipped, fills_new, fills_duplicate, trades_matched, trades_created, pending_decisions${kolumny}) VALUES ('ui', 'f', '${sha256Node(unik("s"))}', 'UTC', 1, 0, 0, 0, 0, 0, 0${wartosci})`,
            );
          });
        expect((await blad(wstawImport(", status", ", 'zly'"))).constraint_name).toBe("broker_imports_status");
        expect((await blad(wstawImport(", status", ", 'reverted'"))).constraint_name).toBe("broker_imports_reverted");
        expect((await blad(wstawImport(", warnings", ", '{}'::jsonb"))).constraint_name).toBe("broker_imports_warnings");
        expect(
          (await blad(sql.begin(async (tx) => {
            await aktor(tx, "ui");
            return tx`INSERT INTO broker_imports (origin, format, file_sha256, tz, rows_total, rows_skipped, fills_new, fills_duplicate, trades_matched, trades_created, pending_decisions) VALUES ('ui', 'f', 'abc', 'UTC', 1, 0, 0, 0, 0, 0, 0)`;
          }))).constraint_name,
        ).toBe("broker_imports_sha256");
      });

      it("dopasowanie trade'u brokera: automat (token importu) moze tylko 1:1 »auto«; reczne, z sugestii AI i »created« tylko uzytkownik; odpiecie od skasowanego trade'u dziennika dziala bez aktora", async () => {
        const dobry = await tokenZakresy(sql, ["import_broker"]);
        const k = await kontoInstr(sql);
        const t1 = await tradeDla(sql, k);
        const t2 = await tradeDla(sql, k);
        const przypnij = (aktorProby: string, rodzaj: string | null, trade: number) =>
          wycofywalna(async (tx) => {
            const konto = await kontoBrokera(tx, k.accountId);
            const imp = await importUi(tx);
            const [bt] = await wstawBrokerTrade(tx, konto, imp);
            await aktor(tx, aktorProby);
            await tx`UPDATE broker_trades SET trade_id = ${trade}, match_kind = ${rodzaj}, match_state = 'matched' WHERE id = ${bt.id}`;
          });
        await przypnij(`api:${dobry}`, "auto", t1); // automat: dopasowanie 1:1
        for (const rodzaj of ["user", "ai_accepted", "created"]) {
          await trigger(
            "broker_trades",
            "broker_trades_dopasowanie_update",
            "TJ403",
            async (tx) => {
              const konto = await kontoBrokera(tx, k.accountId);
              const imp = await importUi(tx);
              const [bt] = await wstawBrokerTrade(tx, konto, imp);
              await aktor(tx, `api:${dobry}`);
              return tx`UPDATE broker_trades SET trade_id = ${t1}, match_kind = ${rodzaj}, match_state = 'matched' WHERE id = ${bt.id}`;
            },
            "wymaga aktora",
          );
          await przypnij("ui", rodzaj, t1);
        }
        // trade dziennika skasowany bez aktora (zwykla akcja uzytkownika): trade brokera wraca do »bez dopasowania«
        const id = await sql.begin(async (tx) => {
          const kb = await kontoBrokera(tx, k.accountId);
          const imp = await importUi(tx);
          const [bt] = await wstawBrokerTrade(tx, kb, imp, { tradeId: t2, matchKind: "user" });
          return bt.id as number;
        });
        await sql`DELETE FROM trades WHERE id = ${t2}`;
        expect((await sql`SELECT trade_id, match_kind, match_state, matched_at FROM broker_trades WHERE id = ${id}`)[0]).toEqual({ trade_id: null, match_kind: null, match_state: "unmatched", matched_at: null });
        await sql.begin(async (tx) => {
          await aktor(tx, "ui");
          await tx`DELETE FROM broker_imports WHERE id IN (SELECT import_id FROM broker_trades WHERE id = ${id})`;
          await tx`DELETE FROM broker_accounts WHERE account_id = ${k.accountId}`;
        });
      });

      it("trade ze zrodlem »broker« tworzy i zmienia tylko uzytkownik; musi miec ref brk:", async () => {
        const dobry = await tokenZakresy(sql, ["import_broker"]);
        const agent = await tokenZakresy(sql, ["read", "write"]);
        const k = await kontoInstr(sql);
        const wstaw = (ref: string | null) => (tx: Tx) =>
          tx`INSERT INTO trades (account_id, instrument_id, direction, entry_time, entry_price, contracts, source, external_ref)
             VALUES (${k.accountId}, ${k.instrumentId}, 'long', now(), 100, 1, 'broker', ${ref}) RETURNING id`;
        await wycofywalna(async (tx) => { await jakoAktor("ui", wstaw("brk:tradovate:abc:1"))(tx); });
        for (const zly of [`api:${agent}`, `api:${dobry}`, "ingest", ""]) {
          await trigger("trades", "trades_source_broker_insert", "TJ403", jakoAktor(zly, wstaw("brk:tradovate:abc:2")), "wymaga zatwierdzenia");
        }
        await wycofywalna(async (tx) => { await aktor(tx, "ui"); expect((await blad(wstaw("tv:1")(tx))).constraint_name).toBe("trades_broker_ref"); });
        await wycofywalna(async (tx) => { await aktor(tx, "ui"); expect((await blad(wstaw(null)(tx))).constraint_name).toBe("trades_broker_ref"); });
        const t = await tradeDla(sql, k);
        await trigger("trades", "trades_source_broker_update", "TJ403", jakoAktor(`api:${agent}`, (tx) => tx`UPDATE trades SET source = 'broker', external_ref = 'brk:x:y:1' WHERE id = ${t}`));
        expect((await blad(sql`UPDATE trades SET source = 'inne' WHERE id = ${t}`)).constraint_name).toBe("trades_source");
      });

      it("kaskady: skasowanie importu przez uzytkownika zabiera wypelnienia, zdarzenia i trade'y brokera; skasowanie konta dziennika zabiera konto u brokera; bezposredni DELETE bez aktora to TJ403", async () => {
        const k = await kontoInstr(sql);
        const { imp, konto } = await sql.begin(async (tx) => {
          const kb = await kontoBrokera(tx, k.accountId);
          const i = await importUi(tx);
          const [bt] = await wstawBrokerTrade(tx, kb, i);
          await wstawFill(tx, kb, i, bt.id);
          await wstawCash(tx, kb, i);
          return { imp: i, konto: kb };
        });
        const policz = async () =>
          (await sql`SELECT (SELECT count(*)::int FROM broker_fills WHERE import_id = ${imp}) AS f, (SELECT count(*)::int FROM broker_cash_events WHERE import_id = ${imp}) AS c, (SELECT count(*)::int FROM broker_trades WHERE import_id = ${imp}) AS t`)[0];
        expect(await policz()).toEqual({ f: 1, c: 1, t: 1 });
        expect((await blad(sql`DELETE FROM broker_imports WHERE id = ${imp}`)).code).toBe("TJ403");
        await sql.begin(async (tx) => { await aktor(tx, "ui"); await tx`DELETE FROM broker_imports WHERE id = ${imp}`; });
        expect(await policz()).toEqual({ f: 0, c: 0, t: 0 });
        // konto dziennika: skasowanie (zwykla akcja, bez aktora) kaskaduje do konta u brokera
        await sql`DELETE FROM accounts WHERE id = ${k.accountId}`;
        expect((await sql`SELECT 1 FROM broker_accounts WHERE id = ${konto}`).length).toBe(0);
      });

      it("CHECK-i trade'u brokera, wypelnienia i zdarzenia: spojnosc dopasowania, zamkniecia, zrodel kwot i znakow", async () => {
        const k = await kontoInstr(sql);
        const t = await tradeDla(sql, k);
        const wTrade = async (kolumny: string, wartosci: string): Promise<string | undefined> =>
          (
            await blad(
              sql.begin(async (tx) => {
                const kb = await kontoBrokera(tx);
                return tx.unsafe(`INSERT INTO broker_trades (broker_account_id, external_ref, contract, direction, max_qty, entry_time, avg_entry_price, status${kolumny})
                  VALUES (${kb}, '${unik("brk:t:x")}', 'MNQZ6', 'long', 1, now(), 100, 'open'${wartosci})`);
              }),
            )
          ).constraint_name;
        expect(await wTrade(", trade_id", `, ${t}`)).toBe("broker_trades_link_kind");
        expect(await wTrade(", match_kind", ", 'auto'")).toBe("broker_trades_link_kind");
        expect(await wTrade(", match_state", ", 'matched'")).toBe("broker_trades_link_state");
        expect(await wTrade(", gross_cents", ", 100")).toBe("broker_trades_gross_pair");
        expect(await wTrade(", fees_cents, fee_source", ", -1, 'rate'")).toBe("broker_trades_fees_nonneg");
        expect(await wTrade(", fees_cents", ", 100")).toBe("broker_trades_fees_pair");
        expect(await wTrade(", exit_time", ", now()")).toBe("broker_trades_closed");
        expect(await wTrade(", match_state", ", 'dziwny'")).toBe("broker_trades_match_state");

        const kb = await sql.begin((tx) => kontoBrokera(tx));
        const wFill = async (kolumny: string, wartosci: string): Promise<string | undefined> =>
          (
            await blad(
              sql.begin(async (tx) => {
                await aktor(tx, "ui");
                return tx.unsafe(`INSERT INTO broker_fills (broker_account_id, external_ref, contract, side, qty, price, filled_at, raw${kolumny}) VALUES (${kb}, '${unik("f")}', 'X', 'buy', 1, 1, now(), '{}'::jsonb${wartosci})`);
              }),
            )
          ).constraint_name;
        expect(await wFill(", fee_cents", ", -1")).toBe("broker_fills_fee");
        expect((await blad(sql.begin(async (tx) => { await aktor(tx, "ui"); return tx.unsafe(`INSERT INTO broker_fills (broker_account_id, external_ref, contract, side, qty, price, filled_at, raw) VALUES (${kb}, '${unik("f")}', 'X', 'hold', 1, 1, now(), '{}'::jsonb)`); }))).constraint_name).toBe("broker_fills_side");
        expect((await blad(sql.begin(async (tx) => { await aktor(tx, "ui"); return tx.unsafe(`INSERT INTO broker_cash_events (broker_account_id, external_ref, kind, delta_cents, occurred_at, raw) VALUES (${kb}, '${unik("c")}', 'dziwne', 1, now(), '{}'::jsonb)`); }))).constraint_name).toBe("broker_cash_events_kind");
        // unikalnosc external_ref: ponowne wgranie tych samych wypelnien nie dubluje
        await wycofywalna(async (tx) => {
          await aktor(tx, "ui");
          const ref = unik("tradovate:u:1");
          await tx`INSERT INTO broker_fills (broker_account_id, external_ref, contract, side, qty, price, filled_at, raw) VALUES (${kb}, ${ref}, 'X', 'buy', 1, 1, now(), '{}'::jsonb)`;
          expect((await blad(tx.savepoint((s) => s`INSERT INTO broker_fills (broker_account_id, external_ref, contract, side, qty, price, filled_at, raw) VALUES (${kb}, ${ref}, 'X', 'buy', 1, 1, now(), '{}'::jsonb)`))).constraint_name).toBe("broker_fills_external_ref_uq");
        });
        await sql.begin(async (tx) => { await aktor(tx, "ui"); await tx`DELETE FROM broker_accounts WHERE id = ${kb}`; });
      });

      it("aktywne konta dnia sa wielokrotne (klucz dzien + konto), kasuja sie z kontem; nowe rodzaje sugestii i zdarzen sa dozwolone", async () => {
        const k1 = await kontoInstr(sql);
        const k2 = await kontoInstr(sql);
        await sql`INSERT INTO day_accounts (day, account_id) VALUES ('2030-02-02', ${k1.accountId}), ('2030-02-02', ${k2.accountId})`;
        expect((await blad(sql`INSERT INTO day_accounts (day, account_id) VALUES ('2030-02-02', ${k1.accountId})`)).code).toBe("23505");
        await sql`DELETE FROM accounts WHERE id = ${k1.accountId}`;
        expect((await sql`SELECT account_id FROM day_accounts WHERE day = '2030-02-02'`).map((r) => r.account_id)).toEqual([k2.accountId]);
        await sql`DELETE FROM accounts WHERE id = ${k2.accountId}`;
        expect((await sql`SELECT 1 FROM day_accounts WHERE day = '2030-02-02'`).length).toBe(0);

        await wycofywalna(async (tx) => {
          for (const rodzaj of ["broker_match", "broker_trade"]) {
            await tx`INSERT INTO ai_suggestions (kind, target, payload, claim, evidence, evidence_level) VALUES (${rodzaj}, '{"type":"trade","id":1}'::jsonb, '{}'::jsonb, 'x', '[{"type":"trade"}]'::jsonb, 'partial')`;
          }
          for (const rodzaj of ["broker_import", "broker_import_reverted", "broker_import_rejected", "broker_account_mapped", "broker_match_reverted", "broker_history_recalculated"]) {
            await tx`INSERT INTO auth_events (kind) VALUES (${rodzaj})`;
          }
        });
        expect((await blad(sql`INSERT INTO ai_suggestions (kind, target, payload, claim, evidence, evidence_level) VALUES ('broker_zly', '{}'::jsonb, '{}'::jsonb, 'x', '[{"a":1}]'::jsonb, 'partial')`)).constraint_name).toBe("ai_suggestions_kind");
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
      /** Katalog bazy po zastosowaniu migracji od 0000 do NNNN wlacznie (osobny folder z ucietym dziennikiem). */
      async function odciskPoMigracji(n: number): Promise<string> {
        const dir = mkdtempSync(path.join(tmpdir(), "tj-mig-"));
        try {
          mkdirSync(path.join(dir, "meta"));
          const dziennik = JSON.parse(readFileSync(path.join(ROOT, "drizzle", "meta", "_journal.json"), "utf8")) as {
            entries: { idx: number; tag: string }[];
          };
          dziennik.entries = dziennik.entries.filter((e) => e.idx <= n);
          writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(dziennik));
          for (const e of dziennik.entries) copyFileSync(path.join(ROOT, "drizzle", `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
          await reset();
          const k = postgres(url, { max: 1, onnotice: () => {} });
          try {
            await migrate(drizzle(k), { migrationsFolder: dir });
          } finally {
            await k.end();
          }
          return await odcisk();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      const rollback = (nr: string) => readFileSync(path.join(ROOT, "docs", "v2", "rollback", `${nr}_down.sql`), "utf8");

      it("0032_down ... 0020_down: po kazdym cofnieciu katalog bazy == katalog po poprzedniej migracji; potem 0019, 0018, 0017; ponowne migracje daja identyczny katalog i presety", async () => {
        // wzorce: stan bazy po migracjach 0000..N zbudowany od zera osobnym przebiegiem
        const wzorzec = new Map<number, string>();
        for (let n = 19; n <= 32; n++) wzorzec.set(n, await odciskPoMigracji(n));
        // 0028 zbudowane od zera osobnym migratorem to ten sam katalog, co po scripts/migrate.mjs
        await reset();
        migrateSkryptem();
        const przed = await odcisk();
        expect(przed).toBe(wzorzec.get(32));
        expect(przed).toBe(odciskSkrypt);
        expect((await sql`SELECT count(*)::int AS n FROM prop_firm_presets`)[0].n).toBe(138);

        const admin = postgres(url, { max: 1, onnotice: () => {} });
        try {
          for (const n of [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20]) {
            const nr = `00${n}`;
            await admin.begin(async (tx) => {
              await tx.unsafe(rollback(nr));
            });
            expect(await odcisk(), `katalog po ${nr}_down ma byc taki jak po migracji 00${n - 1}`).toBe(wzorzec.get(n - 1));
            const wpisy = await admin`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= ${1787650000000 + (n - 20) * 10000000}`;
            expect(wpisy.length, `wpisy migratora od ${nr}`).toBe(0);
          }
          const kopie = await admin`SELECT 1 FROM pg_namespace WHERE nspname = 'tj_kopie'`;
          expect(kopie.length, "0029_down kasuje schemat kopii").toBe(0);
          const funkcje2b = await admin`
            SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
              AND proname IN ('tj_guard_null_only', 'tj_ai_suggestion_flow', 'tj_note_addition_insert', 'tj_plan_guard',
                              'tj_review_override_check', 'tj_rule_check_guard', 'tj_log_threshold_change',
                              'tj_weekly_prev_check', 'tj_mentor_claim_hash', 'tj_weekly_once')`;
          expect(funkcje2b.map((f) => f.proname)).toEqual([]);

          // faza 2: jak dotad
          const przed19 = await odcisk();
          expect(przed19).toBe(wzorzec.get(19));
          // kolejnosc odwrotna do nakladania: FK auth_events -> api_tokens (0019) schodzi pierwszy
          await admin.begin(async (tx) => {
            await tx.unsafe(rollback("0019"));
            await tx.unsafe(rollback("0018"));
          });
          const fk19 = await admin`SELECT 1 FROM pg_constraint WHERE conname = 'auth_events_token_id_fkey'`;
          expect(fk19.length).toBe(0);
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
            await tx.unsafe(rollback("0017"));
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
        for (const tag of ["0017_api_tokens", "0018_notatki", "0019_auth_events_token_fk", "0020_proces_playbook", "0021_plan_werdykt",
          "0022_hipotezy_warianty", "0023_prop", "0024_prop_presety", "0025_przeglad_tygodnia", "0026_profil_wykres", "0027_mentor_luki", "0028_poprawki_po_przegladzie", "0029_notatka_dnia_bez_konta",
          "0030_wynik_netto", "0031_broker_import", "0032_firmy_platformy"]) {
          expect(wyjscie).toContain(tag);
        }
        expect(await odcisk()).toBe(przed);
        expect((await sql`SELECT count(*)::int AS n FROM prop_firm_presets`)[0].n).toBe(138);
      }, 300_000);

      it("0024_down kasuje tylko wiersze wstawione przez migracje (presety dodane przez uzytkownika zostaja)", async () => {
        await sql`INSERT INTO prop_firm_presets (firm, program, phase, account_size_cents, dd_type, max_dd_cents, source_url, read_on)
                  VALUES ('Moja firma', 'Moj program', 'eval', 1000000, 'eod', 100000, 'https://x.pl', '2026-10-14')`;
        await wycofywalna(async (tx) => {
          await tx.unsafe(rollback("0024").replace(/DELETE FROM drizzle\.__drizzle_migrations[^;]*;/, ""));
          expect((await tx`SELECT count(*)::int AS n FROM prop_firm_presets`)[0].n).toBe(1);
          expect((await tx`SELECT firm FROM prop_firm_presets`)[0].firm).toBe("Moja firma");
        });
        await sql`DELETE FROM prop_firm_presets WHERE firm = 'Moja firma'`;
      });
    });
  });
}
