import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Straznik bramki API synchronizacji (ADR-026). Trasy `/api/ingest/**` nie
 * przechodza przez `proxy.ts`, wiec cala autoryzacja siedzi w `withIngest`.
 * Ten test czyta zrodla tras i pada, gdy ktorakolwiek eksportuje handler HTTP
 * bez tego opakowania - dopisanie nowej trasy "na szybko" nie moze otworzyc
 * publicznej dziury bez tokenu.
 */

const KORZEN = path.resolve(__dirname, "../../app/api/ingest");
const METODY = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
// Dozwolone eksporty konfiguracji trasy Next.js, poza handlerami.
const KONFIGURACJA = ["dynamic", "runtime", "revalidate", "maxDuration", "fetchCache", "dynamicParams", "preferredRegion"];

function trasy(katalog: string): string[] {
  const wynik: string[] = [];
  for (const nazwa of readdirSync(katalog)) {
    const pelna = path.join(katalog, nazwa);
    if (statSync(pelna).isDirectory()) wynik.push(...trasy(pelna));
    else if (/^route\.(ts|tsx|js|mjs)$/.test(nazwa)) wynik.push(pelna);
  }
  return wynik;
}

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

describe("straznik: kazda trasa /api/ingest jest owinieta withIngest", () => {
  const pliki = trasy(KORZEN);

  it("istnieja trasy do sprawdzenia (test nie sprawdza pustki)", () => {
    expect(pliki.length).toBeGreaterThanOrEqual(6);
  });

  it.each(pliki.map((p) => [path.relative(KORZEN, p).replaceAll("\\", "/"), p]))("%s", (_nazwa, plik) => {
    const zrodlo = readFileSync(plik, "utf8");
    expect(zrodlo, "trasa musi importowac withIngest").toContain('from "@/lib/ingest/with-ingest"');

    const lista = eksporty(zrodlo);
    const handlery = lista.filter((e) => METODY.includes(e.nazwa));
    expect(handlery.length, "trasa bez zadnego handlera HTTP").toBeGreaterThan(0);

    for (const h of handlery) {
      expect(h.deklaracja, `${h.nazwa} musi byc eksportowane jako const ${h.nazwa} = withIngest(...)`).toMatch(
        /^withIngest(?:<[^>]*>)?\(/,
      );
    }

    const obce = lista.filter((e) => !METODY.includes(e.nazwa) && !KONFIGURACJA.includes(e.nazwa));
    expect(
      obce.map((e) => e.nazwa),
      "trasa Next.js nie moze eksportowac niczego poza handlerami i konfiguracja",
    ).toEqual([]);
  });

  it("matcher proxy wyklucza api/ingest/", () => {
    const proxy = readFileSync(path.resolve(__dirname, "../../proxy.ts"), "utf8");
    expect(proxy).toMatch(/matcher:\s*\[[^\]]*api\/ingest\//);
  });
});
