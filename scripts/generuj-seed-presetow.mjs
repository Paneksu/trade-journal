/*
 * Generator migracji danych 0024_prop_presety.sql z docs/research/prop-presety.json.
 *
 * Czyta WYLACZNIE plik JSON i zapisuje WYLACZNIE plik SQL. Nie laczy sie z baza, nie czyta plikow
 * srodowiska, nie wola API - dlatego nie potrzebuje bezpiecznika produkcji.
 *
 *   node scripts/generuj-seed-presetow.mjs
 *
 * Wynik jest deterministyczny (ta sama kolejnosc co w JSON). Pomijamy aliasy `read_at` i `verified`;
 * `effective_from` = NULL (daty stron sa w extra.page_date, to nie daty wejscia w zycie).
 * Napisy ida jako literaly z podwojonymi apostrofami (standard_conforming_strings = on, bez
 * znakow ucieczki); extra jako '...'::jsonb. Generator odmawia, gdy w danych jest znak NUL, CR,
 * separator instrukcji migratora albo wartosc, ktorej kolumna nie przyjmie.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const korzen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wejscie = path.join(korzen, "docs", "research", "prop-presety.json");
const wyjscie = path.join(korzen, "drizzle", "0024_prop_presety.sql");
const wyjscieDown = path.join(korzen, "docs", "v2", "rollback", "0024_down.sql");

const wiersze = JSON.parse(readFileSync(wejscie, "utf8"));
if (!Array.isArray(wiersze) || wiersze.length === 0) throw new Error("JSON nie jest niepusta tablica");

const KOLUMNY = [
  "firm",
  "program",
  "phase",
  "account_size_cents",
  "dd_type",
  "max_dd_cents",
  "dd_lock_cents",
  "daily_loss_cents",
  "profit_target_cents",
  "consistency_pct",
  "min_days",
  "max_contracts_mini",
  "max_contracts_micro",
  "source_url",
  "read_on",
  "needs_verification",
  "extra",
  "notes",
];
const LICZBY = new Set([
  "account_size_cents",
  "max_dd_cents",
  "dd_lock_cents",
  "daily_loss_cents",
  "profit_target_cents",
  "consistency_pct",
  "min_days",
  "max_contracts_mini",
  "max_contracts_micro",
]);
const NAPISY = new Set(["firm", "program", "phase", "dd_type", "source_url", "notes"]);

function sprawdzTekst(t, gdzie) {
  if (t.includes("\u0000")) throw new Error(`${gdzie}: znak NUL`);
  if (t.includes("\r")) throw new Error(`${gdzie}: znak CR (plik migracji ma byc LF)`);
  if (t.includes("statement-breakpoint")) throw new Error(`${gdzie}: separator instrukcji migratora w danych`);
}
const napis = (t, gdzie) => {
  sprawdzTekst(t, gdzie);
  return `'${t.replaceAll("'", "''")}'`;
};

function literal(wiersz, kolumna, nr) {
  const gdzie = `wiersz ${nr} (${wiersz.firm} / ${wiersz.program}), kolumna ${kolumna}`;
  const v = wiersz[kolumna];
  if (!(kolumna in wiersz)) throw new Error(`${gdzie}: brak klucza w JSON`);
  if (kolumna === "extra") {
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error(`${gdzie}: extra nie jest obiektem`);
    return `${napis(JSON.stringify(v), gdzie)}::jsonb`;
  }
  if (v === null) {
    if (["firm", "program", "phase", "dd_type", "source_url", "account_size_cents", "max_dd_cents", "read_on", "needs_verification"].includes(kolumna)) {
      throw new Error(`${gdzie}: NULL w kolumnie NOT NULL`);
    }
    return "NULL";
  }
  if (kolumna === "needs_verification") {
    if (typeof v !== "boolean") throw new Error(`${gdzie}: oczekiwano boolean`);
    return v ? "true" : "false";
  }
  if (kolumna === "read_on") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${gdzie}: zla data ${v}`);
    return `'${v}'::date`;
  }
  if (LICZBY.has(kolumna)) {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${gdzie}: oczekiwano liczby`);
    if (kolumna !== "consistency_pct" && !Number.isInteger(v)) throw new Error(`${gdzie}: oczekiwano calkowitej`);
    return String(v);
  }
  if (NAPISY.has(kolumna)) {
    if (typeof v !== "string") throw new Error(`${gdzie}: oczekiwano napisu`);
    return napis(v, gdzie);
  }
  throw new Error(`${gdzie}: nieznana kolumna`);
}

const linie = wiersze.map((w, i) => `  (${KOLUMNY.map((k) => literal(w, k, i + 1)).join(", ")})`);

const naglowek = `-- Presety regul prop firm: TYLKO DANE (ADR-033, faza 2b, 2026-10-15).
-- Plik jest GENEROWANY: node scripts/generuj-seed-presetow.mjs z docs/research/prop-presety.json
-- (${wiersze.length} wierszy, ${new Set(wiersze.map((w) => w.firm)).size} firm). Nie edytuj recznie: popraw JSON i wygeneruj ponownie
-- (po wdrozeniu pliku nie wolno go zmieniac - migrator liczy SHA-256 z bajtow; nowy odczyt regulaminu
-- to nowa migracja danych albo zwykla edycja wierszy w aplikacji).
--
-- Wartosci z badania docs/research/prop-presety.md (zrodlo: source_url w kazdym wierszu), odczyt ${[...new Set(wiersze.map((w) => w.read_on))].join(", ")}. needs_verification zostaje taki,
-- jak w badaniu (ma byc WIDOCZNE w UI przy kazdym wierszu): ${wiersze.filter((w) => w.needs_verification).length} z ${wiersze.length} do weryfikacji.
-- Aliasy read_at i verified z JSON-a pomijamy; effective_from = NULL.
-- Cofniecie: docs/v2/rollback/0024_down.sql (kasuje tylko wiersze wstawione tu, po kluczu naturalnym).
-- Zaleznosci: 0023 (prop_firm_presets).

`;

const sql = `${naglowek}INSERT INTO "prop_firm_presets" (${KOLUMNY.map((k) => `"${k}"`).join(", ")}) VALUES\n${linie.join(",\n")};\n`;

if (sql.includes("\r")) throw new Error("wynik zawiera CR");
writeFileSync(wyjscie, sql, { encoding: "utf8" });

// Cofniecie: kasuje tylko wiersze wstawione przez 0024 (po kluczu naturalnym z unikatu), nie wszystko
// z tabeli - uzytkownik moze miec wlasne presety. Wpis migratora znika, zeby dalo sie zastosowac ponownie.
const klucze = wiersze.map((w) => `  (${napis(w.firm, "down")}, ${napis(w.program, "down")}, ${napis(w.phase, "down")}, ${w.account_size_cents}, '${w.read_on}'::date)`);
const down = `-- Cofniecie migracji 0024_prop_presety.sql (GENEROWANE przez scripts/generuj-seed-presetow.mjs).
-- Uruchamiac w JEDNEJ transakcji (psql -1 -f). Kasuje WYLACZNIE ${wiersze.length} wierszy wstawionych przez 0024
-- (klucz naturalny: firm, program, phase, account_size_cents, read_on); presety dodane przez uzytkownika zostaja.
-- Reguly kont (prop_rules.preset_id) wskazujace skasowane presety dostana preset_id = NULL (FK SET NULL).
-- Zrzut bazy przed uruchomieniem, jesli ktorykolwiek z tych wierszy edytowano w aplikacji.

DELETE FROM "prop_firm_presets" WHERE ("firm", "program", "phase", "account_size_cents", "read_on") IN (VALUES
${klucze.join(",\n")}
);

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787690000000;
`;
writeFileSync(wyjscieDown, down, { encoding: "utf8" });
console.log(`Zapisano ${wyjscie}: ${wiersze.length} wierszy, ${sql.length} znakow.`);
