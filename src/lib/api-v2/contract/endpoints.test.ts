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

  it("zakres approve nie istnieje w zadnym wpisie, a import tylko przy trasach mentora", () => {
    const wszystkie = new Set(ENDPOINTS.flatMap((e) => e.zakresy ?? []));
    expect([...wszystkie].sort()).toEqual(["import", "propose", "read", "write"]);
    expect(JSON.stringify(zbudujOpenApi())).not.toMatch(/"approve"/);
    const zImportem = ENDPOINTS.filter((e) => e.zakresy?.includes("import")).map((e) => katalogTrasy(e.sciezka));
    expect(zImportem.length).toBeGreaterThan(0);
    for (const k of zImportem) expect(k.startsWith("mentor/"), "zakres import wolno wymagac tylko od tras mentora: " + k).toBe(true);
    for (const e of ENDPOINTS.filter((x) => x.sciezka.startsWith("/mentor/"))) {
      expect(e.zakresy, "mentor " + e.metoda + " " + e.sciezka).toContain("import");
    }
  });

  it("trasy publiczne (bez tokenu) to dokladnie device/start i device/token", () => {
    const publiczne = ENDPOINTS.filter((e) => e.zakresy === null).map((e) => e.sciezka).sort();
    expect(publiczne).toEqual(["/device/start", "/device/token"]);
  });

  const PROPOZYCJE = ["/rules/proposals", "/setups", "/setups/{slug}/versions", "/ai-suggestions", "/strategy-gaps"];

  it("zapisy wymagaja write, odczyty read, propozycje agenta propose, mentor dokłada import", () => {
    for (const e of ENDPOINTS) {
      if (e.zakresy === null) continue;
      const dodatek = e.sciezka.startsWith("/mentor/") ? ["import"] : [];
      if (e.metoda === "get") expect(e.zakresy, `${e.metoda} ${e.sciezka}`).toEqual(["read", ...dodatek]);
      else if (e.metoda === "post" && PROPOZYCJE.includes(e.sciezka)) expect(e.zakresy, `${e.metoda} ${e.sciezka}`).toEqual(["propose"]);
      else expect(e.zakresy, `${e.metoda} ${e.sciezka}`).toEqual(["write", ...dodatek]);
    }
  });

  it("zadna trasa nie ma operacji kasowania, a PATCH/PUT planu, slow i werdyktu to zawsze 409", () => {
    expect(ENDPOINTS.filter((e) => (e.metoda as string) === "delete")).toEqual([]);
    for (const sciezka of ["/trade-plans/{id}", "/trades/{id}/reviews/{reviewId}", "/user-words/{id}"]) {
      for (const metoda of ["patch", "put"] as const) {
        const e = ENDPOINTS.find((x) => x.metoda === metoda && x.sciezka === sciezka);
        expect(e?.status, `${metoda} ${sciezka}`).toBe(409);
      }
    }
  });

  it("kazda trasa ma opisana odpowiedz (zadnych pustych schematow {})", () => {
    for (const e of ENDPOINTS) expect(e.odpowiedz, `${e.metoda} ${e.sciezka}`).toBeDefined();
    const doc = JSON.stringify(zbudujOpenApi());
    expect(doc).not.toContain('"schema":{}');
  });

  it("zakresy w rejestrze są identyczne z withApi({ scopes }) w plikach tras (kontrakt nie kłamie o uprawnieniach)", () => {
    const zPlikow = new Map<string, string[] | null>();
    const idz = (katalog: string) => {
      for (const nazwa of readdirSync(katalog)) {
        const pelna = path.join(katalog, nazwa);
        if (statSync(pelna).isDirectory()) {
          idz(pelna);
        } else if (nazwa === "route.ts") {
          const zrodlo = readFileSync(pelna, "utf8");
          const kat = path.relative(TRASY, path.dirname(pelna)).replaceAll("\\", "/");
          for (const m of zrodlo.matchAll(/^export\s+const\s+(GET|POST|PUT|PATCH)\s*=\s*(withApi|withPublicApi)(?:<[^>]*>)?\(\s*(?:\{\s*scopes:\s*\[([^\]]*)\]|\{\s*nazwa)?/gm)) {
            const zakresy = m[2] === "withPublicApi" ? null : m[3].split(",").map((x) => x.trim().replace(/["']/g, "")).filter(Boolean);
            zPlikow.set(`${m[1].toLowerCase()} ${kat}`, zakresy);
          }
        }
      }
    };
    idz(TRASY);
    expect(zPlikow.size).toBe(ENDPOINTS.length);
    for (const e of ENDPOINTS) {
      expect(zPlikow.get(`${e.metoda} ${katalogTrasy(e.sciezka)}`), `${e.metoda} ${e.sciezka}`).toEqual(e.zakresy);
    }
  });

  it("trasy publiczne dokumentują 429 (limit adresu, slow_down, too_many_pending) w OpenAPI", () => {
    const doc = zbudujOpenApi() as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
    expect(doc.paths["/device/token"].post.responses["429"]).toBeDefined();
    expect(doc.paths["/device/start"].post.responses["429"]).toBeDefined();
    expect(doc.paths["/device/start"].post.responses["403"]).toBeDefined();
    // a nie 400 «slow_down»: kod HTTP w kontrakcie zgadza się z handlerem
    expect(String((ENDPOINTS.find((e) => e.sciezka === "/device/token")?.bledy ?? {})[400])).not.toContain("slow_down");
  });

  it("trasy oznaczone w kontrakcie jako wymagające import wołają wymagajImportuDlaOrigin (i tylko one)", () => {
    const oznaczone = new Set(ENDPOINTS.filter((e) => e.wymagaImportuDlaOrigin).map((e) => katalogTrasy(e.sciezka)));
    expect([...oznaczone].sort()).toEqual(["hypotheses", "notes", "notes/[id]/additions", "rules/proposals", "setups", "setups/[slug]/versions", "strategy-gaps", "user-words"]);
    const wolajace = new Set<string>();
    const idz = (katalog: string) => {
      for (const nazwa of readdirSync(katalog)) {
        const pelna = path.join(katalog, nazwa);
        if (statSync(pelna).isDirectory()) idz(pelna);
        else if (nazwa === "route.ts" && /wymagajImportuDlaOrigin\(/.test(readFileSync(pelna, "utf8"))) {
          wolajace.add(path.relative(TRASY, path.dirname(pelna)).replaceAll("\\", "/"));
        }
      }
    };
    idz(TRASY);
    expect([...wolajace].sort()).toEqual([...oznaczone].sort());
    const doc = JSON.stringify(zbudujOpenApi());
    expect(doc).toContain("x-import-scope-required-for-origins");
  });

  it("device/start w kontrakcie nie oferuje zakresu import", () => {
    const e = ENDPOINTS.find((x) => x.sciezka === "/device/start");
    const doc = zbudujOpenApi() as { paths: Record<string, { post: { requestBody: { content: { "application/json": { schema: { properties: { scopes: { items: { enum: string[] } } } } } } } } }> };
    expect(e).toBeDefined();
    expect(doc.paths["/device/start"].post.requestBody.content["application/json"].schema.properties.scopes.items.enum).toEqual(["read", "write", "propose"]);
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
