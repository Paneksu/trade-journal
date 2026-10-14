import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { contractHash, ENDPOINTS, katalogTrasy, tekstOpenApi, zbudujOpenApi } from "./endpoints";

const ROOT = path.resolve(__dirname, "../../../..");
const PLIK = path.join(ROOT, "docs/openapi-v2.json");
const TRASY = path.join(ROOT, "src/app/api/v2");

/** Plik moze miec CRLF po checkoucie z autocrlf; kontrakt jest zawsze w LF. */
const wczytaj = () => readFileSync(PLIK, "utf8").replace(/\r\n/g, "\n");

describe("kontrakt OpenAPI: docs/openapi-v2.json jest aktualny", () => {
  it("plik zgadza sie bajt w bajt z tym, co generuja schematy zod (po zmianie: npm run api:kontrakt)", () => {
    expect(wczytaj(), "docs/openapi-v2.json jest nieaktualny - uruchom: npm run api:kontrakt").toBe(tekstOpenApi());
  });

  it("contractHash to SHA-256 tekstu pliku", () => {
    const zPliku = createHash("sha256").update(wczytaj(), "utf8").digest("hex");
    expect(contractHash()).toBe(zPliku);
    expect(contractHash()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generowanie jest deterministyczne", () => {
    expect(tekstOpenApi()).toBe(tekstOpenApi());
  });

  it("dokument jest poprawnym OpenAPI 3.1 z bezpieczenstwem Bearer", () => {
    const doc = zbudujOpenApi() as { openapi: string; paths: Record<string, unknown>; components: { securitySchemes: Record<string, unknown> } };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.components.securitySchemes)).toEqual(["bearer"]);
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(15);
  });
});

describe("kontrakt a trasy: zadnej bez wpisu, zadnego wpisu bez trasy", () => {
  function trasyZPlikow(): Map<string, string[]> {
    const wynik = new Map<string, string[]>();
    const idz = (katalog: string) => {
      for (const nazwa of readdirSync(katalog)) {
        const pelna = path.join(katalog, nazwa);
        if (statSync(pelna).isDirectory()) {
          idz(pelna);
        } else if (nazwa === "route.ts") {
          const zrodlo = readFileSync(pelna, "utf8");
          const metody = [...zrodlo.matchAll(/^export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/gm)].map((m) => m[1].toLowerCase());
          wynik.set(path.relative(TRASY, path.dirname(pelna)).replaceAll("\\", "/"), metody.sort());
        }
      }
    };
    idz(TRASY);
    return wynik;
  }

  it("zestaw tras i metod w src/app/api/v2 jest identyczny z rejestrem ENDPOINTS", () => {
    const zRejestru = new Map<string, string[]>();
    for (const e of ENDPOINTS) {
      const k = katalogTrasy(e.sciezka);
      zRejestru.set(k, [...(zRejestru.get(k) ?? []), e.metoda].sort());
    }
    const zPlikow = trasyZPlikow();
    expect([...zPlikow.keys()].sort()).toEqual([...zRejestru.keys()].sort());
    for (const [k, metody] of zRejestru) expect(zPlikow.get(k), `metody trasy ${k}`).toEqual(metody);
  });

  it("zakres approve nie istnieje w zadnym wpisie", () => {
    const wszystkie = new Set(ENDPOINTS.flatMap((e) => e.zakresy ?? []));
    expect([...wszystkie].sort()).toEqual(["propose", "read", "write"]);
    expect(JSON.stringify(zbudujOpenApi())).not.toMatch(/"approve"/);
  });

  it("trasy publiczne (bez tokenu) to dokladnie device/start i device/token", () => {
    const publiczne = ENDPOINTS.filter((e) => e.zakresy === null).map((e) => e.sciezka).sort();
    expect(publiczne).toEqual(["/device/start", "/device/token"]);
  });

  it("zapisy wymagaja write, odczyty read, propozycje reguly propose", () => {
    for (const e of ENDPOINTS) {
      if (e.zakresy === null) continue;
      if (e.metoda === "get") expect(e.zakresy, `${e.metoda} ${e.sciezka}`).toEqual(["read"]);
      else if (e.sciezka === "/rules/proposals") expect(e.zakresy).toEqual(["propose"]);
      else expect(e.zakresy, `${e.metoda} ${e.sciezka}`).toEqual(["write"]);
    }
  });

  it("PATCH notatki wymaga If-Match i opisuje 409 oraz 428", () => {
    const e = ENDPOINTS.find((x) => x.metoda === "patch" && x.sciezka === "/notes/{id}");
    expect(e?.ifMatch).toBe(true);
    expect(Object.keys(e?.bledy ?? {})).toEqual(expect.arrayContaining(["409", "428"]));
  });

  it("PATCH i PUT slow uzytkownika sa opisane jako zawsze 409", () => {
    for (const metoda of ["patch", "put"] as const) {
      const e = ENDPOINTS.find((x) => x.metoda === metoda && x.sciezka === "/user-words/{id}");
      expect(e?.status, metoda).toBe(409);
    }
  });
});
