import { describe, expect, it } from "vitest";

import {
  BACKUP_ALPHABET,
  adresOtpauth,
  czyKodZapasowy,
  formatujKodZapasowy,
  hmacKoduZapasowego,
  kodTotp,
  noweKodyZapasowe,
  normalizujKod,
  nowySekretBase32,
  numerKroku,
  odszyfrujSekret,
  sprawdzKodTotp,
  wczytajKluczGlowny,
  zaszyfrujSekret,
} from "./totp";

const KLUCZ = Buffer.alloc(32, 7);
const INNY_KLUCZ = Buffer.alloc(32, 9);

describe("TOTP RFC 6238", () => {
  // Wektor testowy z RFC 6238, dodatek B: sekret ASCII "12345678901234567890", SHA-1.
  // Kod 6-cyfrowy to 6 ostatnich cyfr 8-cyfrowego kodu z tabeli RFC.
  const SEKRET_RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("kod dla t=%i to %s", (sekundy, oczekiwany) => {
    expect(kodTotp(SEKRET_RFC, sekundy * 1000)).toBe(oczekiwany);
    expect(sprawdzKodTotp(SEKRET_RFC, oczekiwany, sekundy * 1000)).toBe(numerKroku(sekundy * 1000));
  });

  it("przyjmuje kod z sasiedniego kroku (+-1), odrzuca z dalszego", () => {
    const sekret = nowySekretBase32();
    const t = 1_800_000_000_000;
    expect(sprawdzKodTotp(sekret, kodTotp(sekret, t - 30_000), t)).toBe(numerKroku(t) - 1);
    expect(sprawdzKodTotp(sekret, kodTotp(sekret, t + 30_000), t)).toBe(numerKroku(t) + 1);
    expect(sprawdzKodTotp(sekret, kodTotp(sekret, t - 90_000), t)).toBeNull();
    expect(sprawdzKodTotp(sekret, kodTotp(sekret, t + 90_000), t)).toBeNull();
  });

  it("odrzuca kody nie-cyfrowe i zlej dlugosci bez rzucania", () => {
    const sekret = nowySekretBase32();
    for (const zly of ["", "12345", "1234567", "abcdef", "12 456", "١٢٣٤٥٦"]) {
      expect(sprawdzKodTotp(sekret, zly)).toBeNull();
    }
  });

  it("adres otpauth niesie wystawce, sekret i parametry", () => {
    const sekret = nowySekretBase32();
    const adres = adresOtpauth(sekret);
    expect(adres).toMatch(/^otpauth:\/\/totp\//);
    expect(adres).toContain(`secret=${sekret}`);
    expect(adres).toContain("digits=6");
    expect(adres).toContain("period=30");
    expect(adres).toContain("algorithm=SHA1");
    expect(decodeURIComponent(adres)).toContain("Dziennik tradingowy");
  });

  it("sekret ma 160 bitow (32 znaki base32)", () => {
    expect(nowySekretBase32()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe("szyfrowanie sekretu AES-256-GCM", () => {
  it("odszyfrowuje to, co zaszyfrowano, a zapis ma ksztalt iv.tag.szyfrogram", () => {
    const sekret = nowySekretBase32();
    const zapis = zaszyfrujSekret(sekret, KLUCZ);
    expect(zapis.split(".")).toHaveLength(3);
    expect(zapis).not.toContain(sekret);
    expect(odszyfrujSekret(zapis, KLUCZ)).toBe(sekret);
  });

  it("dwa szyfrowania tego samego sekretu daja rozne zapisy (losowy iv)", () => {
    expect(zaszyfrujSekret("ABC", KLUCZ)).not.toBe(zaszyfrujSekret("ABC", KLUCZ));
  });

  it("zly klucz, zmieniony szyfrogram i obciety zapis daja czytelny blad", () => {
    const zapis = zaszyfrujSekret("TAJNE", KLUCZ);
    expect(() => odszyfrujSekret(zapis, INNY_KLUCZ)).toThrow(/TOTP_ENC_KEY/);
    const [iv, tag, ct] = zapis.split(".");
    const bajty = Buffer.from(ct, "base64url");
    bajty[0] ^= 0xff;
    expect(() => odszyfrujSekret(`${iv}.${tag}.${bajty.toString("base64url")}`, KLUCZ)).toThrow(
      /odszyfrować/,
    );
    expect(() => odszyfrujSekret(`${iv}.${tag}`, KLUCZ)).toThrow(/zły format/);
  });
});

describe("szyfrowanie: przeznaczenie i dlugosc tagu", () => {
  it("szyfrogram ciasteczka konfiguracji nie odszyfruje sie jako sekret z bazy i odwrotnie", () => {
    const wCiasteczku = zaszyfrujSekret("SEKRET", KLUCZ, "ciasteczko-konfiguracji");
    expect(odszyfrujSekret(wCiasteczku, KLUCZ, "ciasteczko-konfiguracji")).toBe("SEKRET");
    expect(() => odszyfrujSekret(wCiasteczku, KLUCZ)).toThrow(/odszyfrować/);
    const wBazie = zaszyfrujSekret("SEKRET", KLUCZ);
    expect(() => odszyfrujSekret(wBazie, KLUCZ, "ciasteczko-konfiguracji")).toThrow(/odszyfrować/);
  });

  it("skrocony tag GCM (4 bajty) i zly iv sa odrzucane z komunikatem o formacie", () => {
    const [iv, tag, ct] = zaszyfrujSekret("SEKRET", KLUCZ).split(".");
    const krotkiTag = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(() => odszyfrujSekret(`${iv}.${krotkiTag}.${ct}`, KLUCZ)).toThrow("tag 4 B (oczekiwane 16)");
    const krotkiIv = Buffer.from(iv, "base64url").subarray(0, 8).toString("base64url");
    expect(() => odszyfrujSekret(`${krotkiIv}.${tag}.${ct}`, KLUCZ)).toThrow("iv 8 B (oczekiwane 12)");
  });
});

describe("TOTP_ENC_KEY", () => {
  const bajty = Buffer.alloc(32, 1);
  it("przyjmuje base64url, base64 i hex", () => {
    expect(wczytajKluczGlowny(bajty.toString("base64url")).equals(bajty)).toBe(true);
    expect(wczytajKluczGlowny(bajty.toString("base64")).equals(bajty)).toBe(true);
    expect(wczytajKluczGlowny(bajty.toString("hex")).equals(bajty)).toBe(true);
  });
  it("odrzuca brak, za krotki i smieci, mowiac jak wygenerowac", () => {
    expect(() => wczytajKluczGlowny("")).toThrow(/Brak zmiennej TOTP_ENC_KEY/);
    expect(() => wczytajKluczGlowny("krotki")).toThrow(/6 znaków/);
    expect(() => wczytajKluczGlowny("!".repeat(43))).toThrow(/randomBytes\(32\)/);
  });
});

describe("kody zapasowe", () => {
  it("10 kodow po 10 znakow z alfabetu bez mylacych liter, bez powtorek", () => {
    const kody = noweKodyZapasowe();
    expect(kody).toHaveLength(10);
    expect(new Set(kody).size).toBe(10);
    for (const k of kody) {
      expect(k).toHaveLength(10);
      expect([...k].every((z) => BACKUP_ALPHABET.includes(z))).toBe(true);
      expect(k).not.toMatch(/[01OI]/);
    }
  });

  it("normalizacja przyjmuje male litery, spacje i myslnik", () => {
    expect(normalizujKod(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(formatujKodZapasowy("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
    expect(czyKodZapasowy("ABCDEFGHJK")).toBe(true);
    expect(czyKodZapasowy("ABCDEFGHJ0")).toBe(false);
    expect(czyKodZapasowy("123456")).toBe(false);
  });

  it("HMAC jest deterministyczny, zalezy od klucza i ma 64 znaki hex", () => {
    const h = hmacKoduZapasowego("ABCDEFGHJK", KLUCZ);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacKoduZapasowego("ABCDEFGHJK", KLUCZ)).toBe(h);
    expect(hmacKoduZapasowego("ABCDEFGHJK", INNY_KLUCZ)).not.toBe(h);
    expect(hmacKoduZapasowego("ABCDEFGHJL", KLUCZ)).not.toBe(h);
  });
});
