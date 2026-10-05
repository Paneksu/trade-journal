import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { czytajBajty, czytajJson, czytajMultipart, LIMIT_JSON, LIMIT_MULTIPART } from "./body";
import { adresKlienta, czyHttps } from "./http";
import { przepusc, wyczyscLimiter } from "./limiter";
import { skrotTokenu, tokenPasuje, tokenZNaglowka, wczytajSkrot } from "./token";

/** Zapytanie z cialem podawanym jako strumien, bez Content-Length - jak klient chunked. */
function zapytanieStrumien(kawalki: Uint8Array[], naglowki: Record<string, string> = {}): Request {
  const strumien = new ReadableStream<Uint8Array>({
    start(c) {
      for (const k of kawalki) c.enqueue(k);
      c.close();
    },
  });
  return new Request("http://localhost/x", {
    method: "POST",
    headers: naglowki,
    body: strumien,
    // @ts-expect-error pole wymagane przez undici przy strumieniu
    duplex: "half",
  });
}

describe("token", () => {
  const TOKEN = "tj_ingest_testowy_token_0123456789abcdef";
  const SKROT = skrotTokenu(TOKEN);

  it("skrot to 64 znaki hex, a tokenu nie da sie z niego odczytac", () => {
    expect(SKROT).toMatch(/^[0-9a-f]{64}$/);
    expect(SKROT).not.toContain(TOKEN);
  });

  it("wczytajSkrot przyjmuje tylko 64 znaki hex (wielkosc liter bez znaczenia)", () => {
    expect(wczytajSkrot(SKROT)?.length).toBe(32);
    expect(wczytajSkrot(` ${SKROT.toUpperCase()} `)?.length).toBe(32);
    expect(wczytajSkrot(undefined)).toBeNull();
    expect(wczytajSkrot("")).toBeNull();
    expect(wczytajSkrot("abc")).toBeNull();
    expect(wczytajSkrot(`${SKROT}00`)).toBeNull();
    expect(wczytajSkrot(`${"g".repeat(64)}`)).toBeNull();
  });

  it("tokenZNaglowka wymaga schematu Bearer i dokladnie jednego tokenu", () => {
    expect(tokenZNaglowka("Bearer abc")).toBe("abc");
    expect(tokenZNaglowka("bearer abc")).toBe("abc");
    expect(tokenZNaglowka("Basic abc")).toBeNull();
    expect(tokenZNaglowka("Bearer")).toBeNull();
    expect(tokenZNaglowka("Bearer a b")).toBeNull();
    expect(tokenZNaglowka(null)).toBeNull();
  });

  it("tokenPasuje: poprawny przechodzi, zly, pusty i o innej dlugosci nie", () => {
    const skrot = wczytajSkrot(SKROT)!;
    expect(tokenPasuje(`Bearer ${TOKEN}`, skrot)).toBe(true);
    expect(tokenPasuje(`Bearer ${TOKEN}x`, skrot)).toBe(false);
    expect(tokenPasuje("Bearer x", skrot)).toBe(false);
    expect(tokenPasuje(`Bearer ${SKROT}`, skrot)).toBe(false); // sam skrot nie jest tokenem
    expect(tokenPasuje(null, skrot)).toBe(false);
    expect(tokenPasuje("", skrot)).toBe(false);
  });
});

describe("limiter okna stalego", () => {
  beforeEach(() => wyczyscLimiter());

  it("przepuszcza do limitu, potem blokuje z czasem do konca okna", () => {
    for (let i = 0; i < 3; i += 1) expect(przepusc("k", 3, 60_000, 1000).allowed).toBe(true);
    const w = przepusc("k", 3, 60_000, 1000);
    expect(w.allowed).toBe(false);
    expect(w.retryInS).toBe(60);
  });

  it("nowe okno zeruje licznik, a klucze sa niezalezne", () => {
    for (let i = 0; i < 4; i += 1) przepusc("a", 3, 60_000, 0);
    expect(przepusc("a", 3, 60_000, 30_000).allowed).toBe(false);
    expect(przepusc("a", 3, 60_000, 60_000).allowed).toBe(true);
    expect(przepusc("b", 3, 60_000, 30_000).allowed).toBe(true);
  });
});

describe("limity ciala liczone na strumieniu", () => {
  it("czyta cialo w limicie", async () => {
    const w = await czytajBajty(zapytanieStrumien([new Uint8Array(10), new Uint8Array(5)]), 100);
    expect(w.ok && w.bytes.byteLength).toBe(15);
  });

  it("przerywa strumien bez Content-Length, gdy suma przekroczy limit", async () => {
    const kawalek = new Uint8Array(400);
    const w = await czytajBajty(zapytanieStrumien([kawalek, kawalek, kawalek]), 1000);
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.odczytano).toBeGreaterThan(1000);
  });

  it("odrzuca po deklarowanym Content-Length, zanim przeczyta cokolwiek", async () => {
    const r = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": String(LIMIT_JSON + 1), "content-type": "application/json" },
      body: "{}",
    });
    const w = await czytajBajty(r, LIMIT_JSON);
    expect(w.ok).toBe(false);
  });

  it("JSON: 415 dla zlego typu, 413 za duzy, 400 dla zlego JSON-a, ok dla poprawnego", async () => {
    const zlyTyp = await czytajJson(
      new Request("http://localhost/x", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }),
    );
    expect(!zlyTyp.ok && zlyTyp.status).toBe(415);

    const duzy = await czytajJson(
      zapytanieStrumien([new Uint8Array(LIMIT_JSON), new Uint8Array(2)], { "content-type": "application/json" }),
    );
    expect(!duzy.ok && duzy.status).toBe(413);

    const zly = await czytajJson(
      new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{nie json" }),
    );
    expect(!zly.ok && zly.status).toBe(400);

    const dobry = await czytajJson(
      new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: '{"a":1}' }),
    );
    expect(dobry.ok && dobry.dane).toEqual({ a: 1 });
  });

  it("multipart: parsuje pola i pliki, a ponad 11 MB odrzuca 413", async () => {
    const fd = new FormData();
    fd.append("interval", "5m");
    fd.append("shot", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    const ok = await czytajMultipart(new Request("http://localhost/x", { method: "POST", body: fd }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.formData.get("interval")).toBe("5m");
      expect((ok.formData.get("shot") as File).size).toBe(3);
    }

    const duzy = await czytajMultipart(
      zapytanieStrumien([new Uint8Array(LIMIT_MULTIPART), new Uint8Array(1)], {
        "content-type": "multipart/form-data; boundary=x",
      }),
    );
    expect(!duzy.ok && duzy.status).toBe(413);
  });
});

describe("adres klienta i HTTPS", () => {
  const r = (h: Record<string, string>, url = "http://localhost/x") => new Request(url, { headers: h });

  it("adres to OSTATNI wpis X-Forwarded-For (dopisuje go proxy, nie klient)", () => {
    expect(adresKlienta(r({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(adresKlienta(r({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(adresKlienta(r({}))).toBe("nieznany");
  });

  it("HTTPS wg ostatniego X-Forwarded-Proto, a bez niego wg adresu", () => {
    expect(czyHttps(r({ "x-forwarded-proto": "https" }))).toBe(true);
    expect(czyHttps(r({ "x-forwarded-proto": "https, http" }))).toBe(false);
    expect(czyHttps(r({ "x-forwarded-proto": "http" }))).toBe(false);
    expect(czyHttps(r({}, "https://dziennik.example/x"))).toBe(true);
    expect(czyHttps(r({}, "http://dziennik.example/x"))).toBe(false);
  });
});

describe("withIngest: kolejnosc bramek", () => {
  const TOKEN = "tj_ingest_testowy_token_0123456789abcdef";
  let withIngest: typeof import("./with-ingest").withIngest;
  const ok = async () => Response.json({ ok: true });

  function zadanie(naglowki: Record<string, string> = {}) {
    return new Request("http://localhost/api/ingest/meta", { headers: naglowki });
  }

  beforeEach(async () => {
    vi.stubEnv("INGEST_TOKEN_SHA256", skrotTokenu(TOKEN));
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    wyczyscLimiter();
    ({ withIngest } = await import("./with-ingest"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("brak zmiennej srodowiska = 404, nawet z poprawnym tokenem", async () => {
    vi.stubEnv("INGEST_TOKEN_SHA256", "");
    const res = await withIngest(ok)(zadanie({ authorization: `Bearer ${TOKEN}` }), undefined);
    expect(res.status).toBe(404);
  });

  it("zepsuta zmienna (nie 64 hex) = 404 i wpis w logu", async () => {
    vi.stubEnv("INGEST_TOKEN_SHA256", "za-krotka");
    const res = await withIngest(ok)(zadanie({ authorization: `Bearer ${TOKEN}` }), undefined);
    expect(res.status).toBe(404);
    expect(console.error).toHaveBeenCalled();
  });

  it("w produkcji bez HTTPS = 403, z HTTPS przechodzi", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const naglowki = { authorization: `Bearer ${TOKEN}` };
    expect((await withIngest(ok)(zadanie(naglowki), undefined)).status).toBe(403);
    expect((await withIngest(ok)(zadanie({ ...naglowki, "x-forwarded-proto": "https" }), undefined)).status).toBe(200);
  });

  it("brak i zly token = 401 z WWW-Authenticate, poprawny = 200", async () => {
    const brak = await withIngest(ok)(zadanie(), undefined);
    expect(brak.status).toBe(401);
    expect(brak.headers.get("www-authenticate")).toContain("Bearer");
    expect((await withIngest(ok)(zadanie({ authorization: "Bearer zly" }), undefined)).status).toBe(401);
    const dobry = await withIngest(ok)(zadanie({ authorization: `Bearer ${TOKEN}` }), undefined);
    expect(dobry.status).toBe(200);
    expect(dobry.headers.get("x-request-id")).toBeTruthy();
  });

  it("po 8 blednych tokenach adres jest zablokowany (429), takze z poprawnym tokenem", async () => {
    const adres = { "x-forwarded-for": "198.51.100.77" };
    for (let i = 0; i < 8; i += 1) {
      expect((await withIngest(ok)(zadanie({ ...adres, authorization: "Bearer zly" }), undefined)).status).toBe(401);
    }
    const zablokowany = await withIngest(ok)(zadanie({ ...adres, authorization: `Bearer ${TOKEN}` }), undefined);
    expect(zablokowany.status).toBe(429);
    expect(Number(zablokowany.headers.get("retry-after"))).toBeGreaterThan(0);
    // inny adres nie jest dotkniety
    const inny = await withIngest(ok)(zadanie({ "x-forwarded-for": "198.51.100.78", authorization: `Bearer ${TOKEN}` }), undefined);
    expect(inny.status).toBe(200);
  });

  it("121. zapytanie w minucie = 429 z Retry-After", async () => {
    const naglowki = { "x-forwarded-for": "198.51.100.90", authorization: `Bearer ${TOKEN}` };
    for (let i = 0; i < 120; i += 1) {
      expect((await withIngest(ok)(zadanie(naglowki), undefined)).status).toBe(200);
    }
    const res = await withIngest(ok)(zadanie(naglowki), undefined);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("wyjatek w handlerze = 500 bez szczegolow technicznych dla klienta", async () => {
    const res = await withIngest(async () => {
      throw new Error("sekretna sciezka C:\\\\baza\\\\haslo");
    })(zadanie({ authorization: `Bearer ${TOKEN}` }), undefined);
    expect(res.status).toBe(500);
    const tekst = await res.text();
    expect(tekst).not.toContain("sekretna");
    expect(tekst).toContain("requestId");
    expect(console.error).toHaveBeenCalled();
  });
});
