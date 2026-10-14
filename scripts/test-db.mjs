import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/*
 * Testy na prawdziwej, lokalnej bazie: `npm run test:db [-- argumenty vitest]`.
 *
 * Bezpiecznik produkcji: wspolny `wymagajLokalnego` z narzedzia/bezpiecznik-produkcji.mjs
 * (sciezka ABSOLUTNA - z worktree sciezka wzgledna nie trafia) sprawdza host
 * DATABASE_URL, a dodatkowo wymagamy nazwy bazy zaczynajacej sie od `tj_`. Flagi
 * --produkcja skrypt NIE przekazuje do bezpiecznika (argv jest stale), wiec nie ma
 * jak jej wlaczyc; brak pliku bezpiecznika = odmowa (fail closed).
 *
 * Skrypt:
 *  1. stosuje migracje na bazie DATABASE_URL (testy API zakladaja gotowy schemat),
 *  2. dla testu "migracje od zera vs schema.ts" tworzy OSOBNA baze `<nazwa>_migracje`
 *     (ten test kasuje schematy swojej bazy, wiec nie moze dzielic jej z testami API),
 *  3. uruchamia vitest z obiema zmiennymi.
 */

const korzen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function wczytajEnvLocal() {
  const plik = path.join(korzen, ".env.local");
  if (!existsSync(plik)) return {};
  const wynik = {};
  for (const linia of readFileSync(plik, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linia);
    if (m) wynik[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return wynik;
}

const env = { ...wczytajEnvLocal(), ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) };
const url = env.DATABASE_URL ?? "";

function odmow(powod) {
  console.error(`test:db odmawia pracy: ${powod}`);
  process.exit(2);
}

let u;
try {
  u = new URL(url);
} catch {
  odmow(`DATABASE_URL (${url ? "nieczytelny adres" : "brak"}) nie jest poprawnym adresem. Ustaw go w .env.local, np. postgresql://journal:journal@127.0.0.1:55433/tj_faza2`);
}
const nazwaBazy = decodeURIComponent(u.pathname.replace(/^\//, ""));
// Wspolny bezpiecznik produkcji (sciezka absolutna). Brak pliku = odmowa (fail closed).
const SCIEZKA_BEZPIECZNIKA = "file:///R:/PROJEKTY/web_developer/narzedzia/bezpiecznik-produkcji.mjs";
let bezpiecznik;
try {
  bezpiecznik = await import(SCIEZKA_BEZPIECZNIKA);
} catch (e) {
  odmow(`nie udało się wczytać wspólnego bezpiecznika produkcji z ${SCIEZKA_BEZPIECZNIKA} (${e.message}). Bez niego nie piszę do żadnej bazy.`);
}
// argv na sztywno: --produkcja z wiersza polecen nie dochodzi do bezpiecznika.
bezpiecznik.wymagajLokalnego({ DATABASE_URL: url }, { argv: ["node", "test-db.mjs"], skrypt: "scripts/test-db.mjs" });
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(u.hostname)) {
  odmow(`host ${u.hostname} przechodzi wspólny bezpiecznik, ale test:db zezwala tylko na 127.0.0.1 / localhost / ::1 (baza ${nazwaBazy}).`);
}
if (!/^tj_[a-z0-9_]+$/.test(nazwaBazy)) {
  odmow(`baza »${nazwaBazy}« nie zaczyna się od tj_. Testy używają wyłącznie baz testowych (np. tj_faza2).`);
}

// Baza dla testu migracji: ten sam serwer, nazwa z sufiksem, utworzona w razie potrzeby.
const nazwaMigracji = `${nazwaBazy}_migracje`;
const admin = new URL(url);
admin.pathname = "/postgres";
const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
try {
  const [istnieje] = await sql`select 1 as x from pg_database where datname = ${nazwaMigracji}`;
  if (!istnieje) await sql.unsafe(`create database "${nazwaMigracji}"`);
} finally {
  await sql.end();
}
const urlMigracji = new URL(url);
urlMigracji.pathname = `/${nazwaMigracji}`;

const wspolne = { ...env, DATABASE_URL: url, TEST_DATABASE_URL: urlMigracji.toString() };

const migracje = spawnSync(process.execPath, ["scripts/migrate.mjs"], { cwd: korzen, env: wspolne, stdio: "inherit" });
if (migracje.status !== 0) odmow("migracje na bazie testowej nie przeszły (patrz wyżej).");

const vitest = spawnSync(process.execPath, [path.join(korzen, "node_modules/vitest/vitest.mjs"), "run", ...process.argv.slice(2)], {
  cwd: korzen,
  env: wspolne,
  stdio: "inherit",
});
process.exit(vitest.status ?? 1);
