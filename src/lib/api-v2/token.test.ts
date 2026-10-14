import { describe, expect, it } from "vitest";

import { SCOPES } from "./scopes";
import {
  normalizujKodUzytkownika,
  REGEX_TOKEN_V2,
  skrotKoduUrzadzenia,
  skrotTokenuV2,
  skrotyRowne,
  tokenV2ZNaglowka,
  wygenerujKodUrzadzenia,
  wygenerujKodUzytkownika,
  wygenerujToken,
} from "./token";

describe("token v2: tj_<prefix>_<sekret>", () => {
  it("ma format z regexa, a w skrócie nie ma tokenu", () => {
    const t = wygenerujToken();
    expect(t.token).toMatch(REGEX_TOKEN_V2);
    expect(t.prefix).toMatch(/^[a-z0-9]{8}$/);
    expect(t.token.startsWith(`tj_${t.prefix}_`)).toBe(true);
    expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(t.sha256).toBe(skrotTokenuV2(t.token));
    expect(t.sha256).not.toContain(t.token.slice(-20));
  });

  it("dwa tokeny różnią się prefiksem i sekretem (500 losowań bez kolizji)", () => {
    const widziane = new Set<string>();
    const prefiksy = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const t = wygenerujToken();
      widziane.add(t.token);
      prefiksy.add(t.prefix);
    }
    expect(widziane.size).toBe(500);
    expect(prefiksy.size).toBeGreaterThan(495);
  });

  it("tokenV2ZNaglowka: tylko Bearer i tylko poprawny kształt", () => {
    const t = wygenerujToken();
    expect(tokenV2ZNaglowka(`Bearer ${t.token}`)).toEqual({ token: t.token, prefix: t.prefix });
    expect(tokenV2ZNaglowka(`bearer ${t.token}`)?.prefix).toBe(t.prefix);
    expect(tokenV2ZNaglowka(t.token)).toBeNull();
    expect(tokenV2ZNaglowka(`Basic ${t.token}`)).toBeNull();
    expect(tokenV2ZNaglowka(`Bearer ${t.token}x`)).toBeNull();
    expect(tokenV2ZNaglowka("Bearer tj_ingest_testowy_token_0123456789abcdef")).toBeNull();
    expect(tokenV2ZNaglowka(null)).toBeNull();
  });

  it("zakresy: read, write, propose, a zatwierdzania nie ma", () => {
    expect([...SCOPES]).toEqual(["read", "write", "propose"]);
    expect(SCOPES as readonly string[]).not.toContain("approve");
  });

  it("skrotyRowne porównuje skróty i nie rzuca przy różnej długości", () => {
    const a = skrotTokenuV2("x");
    expect(skrotyRowne(a, a)).toBe(true);
    expect(skrotyRowne(a, skrotTokenuV2("y"))).toBe(false);
    expect(skrotyRowne(a, "abc")).toBe(false);
  });
});

describe("kod urządzenia i kod użytkownika", () => {
  it("device_code ma 43 znaki base64url, a w bazie leży tylko skrót", () => {
    const k = wygenerujKodUrzadzenia();
    expect(k.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(k.sha256).toBe(skrotKoduUrzadzenia(k.deviceCode));
  });

  it("user_code spełnia CHECK z bazy: dwie czwórki spółgłosek bez mylących liter", () => {
    for (let i = 0; i < 300; i += 1) {
      expect(wygenerujKodUzytkownika()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    }
  });

  it("normalizacja kodu przepisanego przez człowieka", () => {
    expect(normalizujKodUzytkownika("bcdf-ghjk")).toBe("BCDF-GHJK");
    expect(normalizujKodUzytkownika(" BCDFGHJK ")).toBe("BCDF-GHJK");
    expect(normalizujKodUzytkownika("bcdf ghjk")).toBe("BCDF-GHJK");
    // przykład z ADR-030 zawiera cyfrę i samogłoskę, więc nie jest poprawnym kodem
    expect(normalizujKodUzytkownika("KTWM-4HQP")).toBeNull();
    expect(normalizujKodUzytkownika("BCDF-GHJ")).toBeNull();
    expect(normalizujKodUzytkownika("")).toBeNull();
  });
});
