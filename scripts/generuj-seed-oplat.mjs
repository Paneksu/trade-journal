/*
 * Generator migracji danych 0032_firmy_platformy.sql (ADR-034, etap A, 2026-10-16).
 *
 * Czyta WYLACZNIE docs/research/prop-presety.json i zapisuje WYLACZNIE dwa pliki SQL (migracja i cofniecie). Nie laczy sie
 * z baza, nie czyta plikow srodowiska, nie wola API - dlatego nie potrzebuje bezpiecznika produkcji.
 *
 *   node scripts/generuj-seed-oplat.mjs
 *
 * Co trafia do migracji:
 *  1. UPDATE prop_firm_presets (po kluczu naturalnym firm, program, phase, account_size_cents, read_on):
 *     fee_rt_mini_cents, fee_rt_micro_cents, fee_source_url oraz extra.fee (dopisane do istniejacego extra z 0024).
 *     JSON po badaniu z 16.10.2026 rozni sie od seeda 0024 WYLACZNIE tymi polami (sprawdzone przy pisaniu generatora),
 *     wiec test "presety zgodne z JSON-em" przechodzi po tej migracji.
 *  2. INSERT prop_firm_platforms: lista firm i platform jako dane (tabela z ADR-034 pkt 1, odczyt 2026-10-16).
 * Wynik jest deterministyczny. Po wdrozeniu pliku nie wolno go zmieniac (migrator liczy SHA-256 z bajtow).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const korzen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wejscie = path.join(korzen, "docs", "research", "prop-presety.json");
const wyjscie = path.join(korzen, "drizzle", "0032_firmy_platformy.sql");
const wyjscieDown = path.join(korzen, "docs", "v2", "rollback", "0032_down.sql");
const WHEN = 1787770000000;

const wiersze = JSON.parse(readFileSync(wejscie, "utf8"));
if (!Array.isArray(wiersze) || wiersze.length === 0) throw new Error("JSON nie jest niepusta tablica");

function napis(t, gdzie) {
  if (typeof t !== "string") throw new Error(`${gdzie}: oczekiwano napisu`);
  if (t.includes("\u0000")) throw new Error(`${gdzie}: znak NUL`);
  if (t.includes("\r")) throw new Error(`${gdzie}: znak CR (plik migracji ma byc LF)`);
  if (t.includes("statement-breakpoint")) throw new Error(`${gdzie}: separator instrukcji migratora w danych`);
  return `'${t.replaceAll("'", "''")}'`;
}

function liczbaLubNull(v, gdzie) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`${gdzie}: oczekiwano calkowitej >= 0, jest ${String(v)}`);
  return String(v);
}

// --- 1. stawki oplat w presetach -------------------------------------------------------------------------------
const update = [];
const klucze = [];
wiersze.forEach((w, i) => {
  const gdzie = `wiersz ${i + 1} (${w.firm} / ${w.program} / ${w.phase})`;
  const fee = w.extra && typeof w.extra === "object" ? w.extra.fee : undefined;
  if (fee === undefined || fee === null || typeof fee !== "object" || Array.isArray(fee)) throw new Error(`${gdzie}: brak extra.fee (obiekt)`);
  const url = w.fee_source_url === null || w.fee_source_url === undefined ? "NULL" : napis(w.fee_source_url, gdzie);
  if (url !== "NULL" && !/^'https:\/\//.test(url)) throw new Error(`${gdzie}: fee_source_url nie zaczyna sie od https://`);
  const klucz = `"firm" = ${napis(w.firm, gdzie)} AND "program" = ${napis(w.program, gdzie)} AND "phase" = ${napis(w.phase, gdzie)} AND "account_size_cents" = ${liczbaLubNull(w.account_size_cents, gdzie)} AND "read_on" = '${w.read_on}'::date`;
  update.push(
    `UPDATE "prop_firm_presets" SET "fee_rt_mini_cents" = ${liczbaLubNull(w.fee_rt_mini_cents, gdzie)}, "fee_rt_micro_cents" = ${liczbaLubNull(w.fee_rt_micro_cents, gdzie)}, "fee_source_url" = ${url}, "extra" = "extra" || jsonb_build_object('fee', ${napis(JSON.stringify(fee), gdzie)}::jsonb) WHERE ${klucz};`,
  );
  klucze.push(`  (${napis(w.firm, gdzie)}, ${napis(w.program, gdzie)}, ${napis(w.phase, gdzie)}, ${w.account_size_cents}, '${w.read_on}'::date)`);
});

// --- 2. lista firm i platform (ADR-034 pkt 1; zrodlo: docs/research/polaczenia-kont.md, sekcja 5) ------------------
const TRADOVATE_HINT = "Tradovate: Reports -> zakladki Orders i Cash History (to samo konto, te same daty) -> Go -> Download CSV. Pliki zostaw w folderze Pobrane.";
const BRAK_PARSERA = "Parser formatu tej platformy powstanie z prawdziwego pliku uzytkownika (ADR-034 pkt 2); do tego czasu eksport z tej platformy nie jest rozpoznawany.";
const ODCZYT = "2026-10-16";
const adresFirmy = (firma) => {
  const w = wiersze.find((x) => x.firm === firma);
  if (!w) throw new Error(`brak firmy ${firma} w presetach (zrodlo adresu)`);
  return w.source_url;
};
const PLATFORMY = [
  // [firma, platforma, hint, adres, do weryfikacji, uwagi]
  ["Topstep", "TopstepX (ProjectX)", "TopstepX: zakladka Trades -> Export.", adresFirmy("Topstep"), false, "Jedyna platforma Topstep (OFICJALNE, help center 2026-07-20). Klucz API ProjectX daje pelny handel, wiec go nie przyjmujemy. " + BRAK_PARSERA],
  ["Apex Trader Funding", "Tradovate", TRADOVATE_HINT, adresFirmy("Apex Trader Funding"), true, "Platforma zalezy od konta (wybor przy zakupie). Odczyt strony firmy zablokowany (403): lista z blogow 08.2026."],
  ["Apex Trader Funding", "Rithmic", "R|Trader: eksport Completed Orders (takze periodic csv export).", adresFirmy("Apex Trader Funding"), true, BRAK_PARSERA],
  ["Apex Trader Funding", "WealthCharts", "Szablon ogolny (generic).", adresFirmy("Apex Trader Funding"), true, "WealthCharts nie ma API. " + BRAK_PARSERA],
  ["Tradeify", "Tradovate", TRADOVATE_HINT, adresFirmy("Tradeify"), true, "Obejmuje tez konta z NinjaTrader i TradingView przez Tradovate (OFICJALNE, help Tradeify 2026-08-05)."],
  ["Tradeify", "Rithmic", "R|Trader: eksport Completed Orders.", adresFirmy("Tradeify"), true, BRAK_PARSERA],
  ["Tradeify", "WealthCharts", "Szablon ogolny (generic).", adresFirmy("Tradeify"), true, BRAK_PARSERA],
  ["Lucid Trading", "Tradovate", TRADOVATE_HINT, adresFirmy("Lucid Trading"), false, "Kanal CQG: NinjaTrader, Tradovate, TradingView (OFICJALNE). Potwierdzone na pliku uzytkownika (prefiks konta LFE)."],
  ["Lucid Trading", "Rithmic", "R|Trader: eksport Completed Orders.", adresFirmy("Lucid Trading"), true, BRAK_PARSERA],
  ["MyFundedFutures", "Tradovate", TRADOVATE_HINT, adresFirmy("MyFundedFutures"), false, "OFICJALNE, help MFFU."],
  ["MyFundedFutures", "NinjaTrader", "NinjaTrader 8: eksport wykonan (Executions).", adresFirmy("MyFundedFutures"), true, BRAK_PARSERA],
  ["MyFundedFutures", "Volumetrica", "Szablon ogolny (generic).", adresFirmy("MyFundedFutures"), true, BRAK_PARSERA],
  ["MyFundedFutures", "Quantower", "Szablon ogolny (generic).", adresFirmy("MyFundedFutures"), true, BRAK_PARSERA],
  ["MyFundedFutures", "ATAS", "Szablon ogolny (generic).", adresFirmy("MyFundedFutures"), true, BRAK_PARSERA],
  ["Take Profit Trader", "Tradovate", TRADOVATE_HINT, adresFirmy("Take Profit Trader"), true, "WYWNIOSKOWANE z wynikow wyszukiwania oficjalnej tabeli (strona firmy 403/404)."],
  ["Take Profit Trader", "Rithmic", "R|Trader: eksport Completed Orders.", adresFirmy("Take Profit Trader"), true, BRAK_PARSERA],
  ["Alpha Futures", "AlphaTrader", "Szablon ogolny (generic).", adresFirmy("Alpha Futures"), true, "Tradovate i NinjaTrader wycofane 2026-07-12 wg wpisow firmy. Format eksportu AlphaTrader nie sprawdzony. " + BRAK_PARSERA],
  ["Alpha Futures", "Volumetrica", "Szablon ogolny (generic).", adresFirmy("Alpha Futures"), true, BRAK_PARSERA],
  ["Alpha Futures", "WealthCharts", "Szablon ogolny (generic).", adresFirmy("Alpha Futures"), true, BRAK_PARSERA],
  ["Bulenox", "Rithmic", "R|Trader: eksport Completed Orders.", adresFirmy("Bulenox"), true, "Stan niepewny (blogi). " + BRAK_PARSERA],
  ["Earn2Trade", "Tradovate", TRADOVATE_HINT, adresFirmy("Earn2Trade"), true, "Lista platform z blogu (propfirmmap 2026); oficjalnej listy nie znaleziono."],
  ["Earn2Trade", "NinjaTrader", "NinjaTrader 8: eksport wykonan (Executions).", adresFirmy("Earn2Trade"), true, BRAK_PARSERA],
  ["Własne konto Tradovate", "Tradovate", TRADOVATE_HINT, "https://partner.tradovate.com/resources/admin-dashboards/reports", false, "Konto bez firmy prop. Pliki Orders i Cash History potwierdzone na probce uzytkownika (13.10.2026)."],
  ["Inna firma", "Inna platforma", "Szablon ogolny (generic).", "https://www.tradingview.com/support/solutions/43000663814-how-can-i-download-trading-data/", true, BRAK_PARSERA],
];
const platformy = PLATFORMY.map(([firma, platforma, hint, adres, weryfikacja, uwagi]) => {
  const g = `platforma ${firma} / ${platforma}`;
  if (!/^https:\/\//.test(adres)) throw new Error(`${g}: adres nie zaczyna sie od https://`);
  return `  (${napis(firma, g)}, ${napis(platforma, g)}, ARRAY['export_file']::text[], ${napis(hint, g)}, ${napis(adres, g)}, '${ODCZYT}'::date, ${weryfikacja ? "true" : "false"}, ${napis(uwagi, g)})`;
});

const sql = `-- Dane: stawki oplat firm prop i lista firm z platformami (ADR-034, etap A, 2026-10-16). Zaleznosci: 0030 (kolumny stawek), 0031 (prop_firm_platforms).
-- Plik jest GENEROWANY: node scripts/generuj-seed-oplat.mjs z docs/research/prop-presety.json. Nie edytuj recznie:
-- popraw JSON i wygeneruj ponownie (po wdrozeniu pliku nie wolno go zmieniac - migrator liczy SHA-256 z bajtow;
-- kolejny odczyt stawek to nowa migracja danych albo zwykla edycja wierszy w aplikacji).
--
-- 1) Stawki oplat (round turn: prowizja + gielda + NFA za kontrakt w obie strony, centy USD) dla ${wiersze.length} presetow, odczyt 2026-10-16.
--    Kolumny fee_* i klucz extra.fee (platforma, zakres, rodzaj zrodla, uwagi do weryfikacji). Pozostala czesc wiersza zostaje taka,
--    jak w 0024. Stawka NULL = firma nie podaje stawki dla tego programu (np. LiveSim z prowizjami FCM).
-- 2) Lista firm i platform: ${PLATFORMY.length} wierszy. Dane, nie kod: starzeja sie w tygodniach (read_on + ostrzezenie po 30 dniach w UI).
-- Cofniecie: docs/v2/rollback/0032_down.sql.
-- Separator miedzy instrukcjami nie moze wystapic ani w danych, ani w komentarzu.

${update.join("\n")}

INSERT INTO "prop_firm_platforms" ("firm", "platform", "methods", "export_hint", "source_url", "read_on", "needs_verification", "notes") VALUES
${platformy.join(",\n")};
`;
if (sql.includes("\r")) throw new Error("wynik zawiera CR");
writeFileSync(wyjscie, sql, { encoding: "utf8" });

const down = `-- Cofniecie migracji 0032_firmy_platformy.sql (GENEROWANE przez scripts/generuj-seed-oplat.mjs).
-- Uruchamiac w JEDNEJ transakcji (psql -1 -f), PRZED 0031_down. Kasuje liste firm i platform oraz zeruje stawki oplat
-- wpisane przez 0032 w ${wiersze.length} presetach (klucz naturalny); klucz extra.fee jest usuwany. Stawki edytowane w aplikacji
-- w tych wierszach tez zostana wyzerowane. Zrzut bazy przed uruchomieniem, jesli tak bylo.

DELETE FROM "prop_firm_platforms" WHERE "read_on" = '${ODCZYT}'::date;

UPDATE "prop_firm_presets" SET "fee_rt_mini_cents" = NULL, "fee_rt_micro_cents" = NULL, "fee_source_url" = NULL, "extra" = "extra" - 'fee'
WHERE ("firm", "program", "phase", "account_size_cents", "read_on") IN (VALUES
${klucze.join(",\n")}
);

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN};
`;
writeFileSync(wyjscieDown, down, { encoding: "utf8" });
console.log(`Zapisano ${wyjscie}: ${update.length} UPDATE, ${PLATFORMY.length} platform, ${sql.length} znakow.`);
