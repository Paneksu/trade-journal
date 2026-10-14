import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Straznik bramki API v2 (ADR-030), na wzor `ingest/guard.test.ts`. Trasy
 * `/api/v2/**` nie przechodza przez `proxy.ts`, wiec cala autoryzacja siedzi
 * w `withApi` / `withPublicApi`. Ten test czyta zrodla tras i pada, gdy:
 *  - ktorakolwiek eksportuje handler HTTP bez tego opakowania;
 *  - trasa bez tokenu (`withPublicApi`) wyjdzie poza dwie znane z nazwy;
 *  - jakakolwiek trasa albo modul v2 dotyka statusu `approved` / `rejected`
 *    wersji regul (warstwa 2 z ADR-030: agent nie ma sciezki do zatwierdzenia);
 *  - pojawi sie operacja kasowania (ADR-032: API v2 nie kasuje).
 */

const KORZEN = path.resolve(__dirname, "../../app/api/v2");
const LIB = path.resolve(__dirname);
const METODY = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const KONFIGURACJA = ["dynamic", "runtime", "revalidate", "maxDuration", "fetchCache", "dynamicParams", "preferredRegion"];
/** Jedyne trasy bez tokenu; dopisanie trzeciej wymaga swiadomej zmiany tego testu. */
const PUBLICZNE = ["device/start/route.ts", "device/token/route.ts"];

function wszystkiePliki(katalog: string): string[] {
  const wynik: string[] = [];
  for (const nazwa of readdirSync(katalog)) {
    const pelna = path.join(katalog, nazwa);
    if (statSync(pelna).isDirectory()) wynik.push(...wszystkiePliki(pelna));
    else wynik.push(pelna);
  }
  return wynik;
}

const jestTrasa = (p: string) => /^route\.(ts|tsx|js|mjs)$/.test(path.basename(p));
const wzgledna = (p: string) => path.relative(KORZEN, p).replaceAll("\\", "/");

function eksporty(zrodlo: string): { nazwa: string; deklaracja: string }[] {
  const wynik: { nazwa: string; deklaracja: string }[] = [];
  const reFunkcja = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
  const reStala = /^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*([^\n]*)/gm;
  for (const m of zrodlo.matchAll(reFunkcja)) wynik.push({ nazwa: m[1], deklaracja: "function" });
  for (const m of zrodlo.matchAll(reStala)) wynik.push({ nazwa: m[1], deklaracja: m[2] });
  if (/^export\s*\{/m.test(zrodlo) || /^export\s+default/m.test(zrodlo)) {
    wynik.push({ nazwa: "(reeksport lub default)", deklaracja: "?" });
  }
  return wynik;
}

/** Zrodlo bez komentarzy: slowo "approved" w opisie trasy nie jest jej dotykaniem. */
function bezKomentarzy(zrodlo: string): string {
  return zrodlo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("straznik: kazda trasa /api/v2 jest owinieta withApi", () => {
  const pliki = wszystkiePliki(KORZEN).filter(jestTrasa);

  it("istnieja trasy do sprawdzenia (test nie sprawdza pustki)", () => {
    expect(pliki.length).toBeGreaterThanOrEqual(17);
  });

  it.each(pliki.map((p) => [wzgledna(p), p]))("%s", (nazwa, plik) => {
    const zrodlo = readFileSync(plik, "utf8");
    expect(zrodlo, "trasa musi importowac brame").toContain('from "@/lib/api-v2/with-api"');

    const lista = eksporty(zrodlo);
    const handlery = lista.filter((e) => METODY.includes(e.nazwa));
    expect(handlery.length, "trasa bez zadnego handlera HTTP").toBeGreaterThan(0);

    const publiczna = PUBLICZNE.includes(nazwa);
    for (const h of handlery) {
      const oczekiwane = publiczna ? /^withPublicApi(?:<[^>]*>)?\(/ : /^withApi(?:<[^>]*>)?\(/;
      expect(h.deklaracja, `${h.nazwa} musi byc eksportowane jako const ${h.nazwa} = ${publiczna ? "withPublicApi" : "withApi"}(...)`).toMatch(oczekiwane);
    }

    const obce = lista.filter((e) => !METODY.includes(e.nazwa) && !KONFIGURACJA.includes(e.nazwa));
    expect(obce.map((e) => e.nazwa), "trasa Next.js nie moze eksportowac niczego poza handlerami i konfiguracja").toEqual([]);

    // ADR-032: API v2 nie ma operacji kasowania.
    expect(handlery.map((h) => h.nazwa)).not.toContain("DELETE");

    // Warstwa 2 z ADR-030: zadna trasa nie dotyka statusow zatwierdzenia.
    expect(bezKomentarzy(zrodlo)).not.toMatch(/\b(approved|rejected|superseded)\b/i);
  });

  it("withPublicApi wystepuje wylacznie w device/start i device/token", () => {
    const zPublicznym = pliki.filter((p) => /withPublicApi\(/.test(readFileSync(p, "utf8"))).map(wzgledna).sort();
    expect(zPublicznym).toEqual([...PUBLICZNE].sort());
  });

  it("w katalogu tras sa wylacznie pliki route.* (page, layout czy pomocnicze obeszlyby brame)", () => {
    const obce = wszystkiePliki(KORZEN).filter((p) => !jestTrasa(p));
    expect(obce.map(wzgledna)).toEqual([]);
  });

  it("matcher proxy wyklucza api/v2/ (trasy uzywaja Bearer, nie ciasteczka)", () => {
    const proxy = readFileSync(path.resolve(__dirname, "../../proxy.ts"), "utf8");
    expect(proxy).toMatch(/matcher:\s*\[[^\]]*api\/v2\//);
    expect(proxy).toMatch(/matcher:\s*\[[^\]]*api\/ingest\//);
  });
});

describe("straznik: moduly API v2 nie zmieniaja zatwierdzen", () => {
  const moduly = readdirSync(LIB)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => path.join(LIB, n));

  it("jest co sprawdzac", () => {
    expect(moduly.length).toBeGreaterThan(10);
  });

  it.each(moduly.map((p) => [path.basename(p), p]))("%s nie aktualizuje tabel zatwierdzen ani nie ustawia statusu approved", (_n, plik) => {
    const zrodlo = bezKomentarzy(readFileSync(plik, "utf8"));
    expect(zrodlo).not.toMatch(/\.update\(\s*(ruleVersions|setupVersions|hypotheses|aiSuggestions|profileTerms|weeklyReviews|strategyGaps)\s*\)/);
    expect(zrodlo).not.toMatch(/update\s+(rule_versions|setup_versions|hypotheses|ai_suggestions)\b/i);
    expect(zrodlo).not.toMatch(/status\s*:\s*["'](approved|rejected|superseded)["']/);
    expect(zrodlo).not.toMatch(/tj\.actor['"]?\s*,\s*['"]ui['"]/);
  });
});
