import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, parametry, polacz, sha256Hex, sprzatnijPoTokenach, zadanie, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Słowa użytkownika dosłownie (plan pkt 13, ADR-030): bajt w bajt przez
 * JSON -> API -> baza -> API, z porównaniem skrótów. Na prawdziwej bazie lokalnej.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("user_words: bajt w bajt (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  const znacznik = Date.now().toString(36);

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
    rw = await nowyToken(sql, ["read", "write"]);
    ro = await nowyToken(sql, ["read"]);
  });
  afterAll(async () => {
    await sprzatnijPoTokenach(sql, [rw.id, ro.id]);
    await sql.end();
  });
  beforeEach(() => wyczyscLimiter());

  const czas = () => new Date().toISOString();

  async function wyslij(cialo: Record<string, unknown>, token = rw.token) {
    const { POST } = await import("@/app/api/v2/user-words/route");
    return POST(zadanie("/user-words", { metoda: "POST", token, cialo }), undefined);
  }
  const pelne = (text: string, extra: Record<string, unknown> = {}) => ({
    text,
    sha256: sha256Hex(text),
    source: "chat",
    capturedAt: czas(),
    role: `test.${znacznik}`,
    ...extra,
  });

  // Teksty z planu: polskie znaki, emoji, nowe linie - w każdej odmianie.
  const PRZYPADKI: Record<string, string> = {
    "polskie znaki": "Zażółć gęślą jaźń. ŁÓDŹ, ĆŚŻŹ — wszedłem po sweepie.",
    "emoji (para zastępcza)": "SL zahaczony 😤🔥 ale plan trzymany 👍🏽",
    "LF": "linia 1\nlinia 2\n\nlinia 4",
    "CRLF ze schowka Windows": "linia 1\r\nlinia 2\r\n",
    "samo CR": "a\rb",
    "NFD (rozłożone ogonki)": "Zażółć gęślą jaźń".normalize("NFD"),
    "spacje i tabulatory na brzegach": "  \tw środku\t  ",
    "BOM wewnątrz tekstu": "﻿po BOM-ie",
    "znaki sterujące i separator linii": "a b c\u0007d",
    "mieszanka wszystkiego": "  Wszedłem 🔥\r\nłódź — „cudzysłów” \"x\"\n\\n nie jest nową linią \\ \t koniec  ",
    "długi tekst 35 tys. znaków": "Żółć. ".repeat(5000),
  };

  it.each(Object.entries(PRZYPADKI))("przechodzi bajt w bajt (hash z bazy == hash z Node): %s", async (_n, tekst) => {
    const res = await wyslij(pelne(tekst));
    expect(res.status, await res.clone().text()).toBe(201);
    const zapisane = await res.json();

    const oczekiwany = sha256Hex(Buffer.from(tekst, "utf8"));
    expect(zapisane.sha256).toBe(oczekiwany);
    expect(zapisane.byteLen).toBe(Buffer.byteLength(tekst, "utf8"));
    expect(zapisane.text).toBe(tekst);

    // Dowód z samej bazy: bajty kolumny `text` mają ten sam skrót (niezależnie od drivera).
    const [w] = await sql`select encode(sha256(convert_to(text, 'UTF8')), 'hex') as h, octet_length(text) as ile, text = ${tekst} as rowny from user_words where id = ${zapisane.id}`;
    expect(w.h).toBe(oczekiwany);
    expect(w.ile).toBe(Buffer.byteLength(tekst, "utf8"));
    expect(w.rowny).toBe(true);

    // I z powrotem przez GET: kolejne przejście przez JSON nie zmienia ani bajtu.
    const { GET } = await import("@/app/api/v2/user-words/route");
    const lista = await (await GET(zadanie(`/user-words?role=test.${znacznik}&limit=200`, { token: ro.token }), undefined)).json();
    const odczytane = lista.words.find((x: { id: number }) => x.id === zapisane.id);
    expect(sha256Hex(Buffer.from(odczytane.text, "utf8"))).toBe(oczekiwany);
  });

  it("surowe bajty UTF-8 w ciele zapytania (bez JSON.stringify po stronie testu) też zgadzają się co do bajta", async () => {
    const tekst = "Zażółć 🔥\r\nkoniec";
    const surowe = Buffer.from(JSON.stringify(pelne(tekst, { role: `test.${znacznik}.surowe` })), "utf8");
    const { POST } = await import("@/app/api/v2/user-words/route");
    const res = await POST(
      zadanie("/user-words", { metoda: "POST", token: rw.token, surowe: new Uint8Array(surowe), naglowki: { "content-type": "application/json; charset=utf-8" } }),
      undefined,
    );
    expect(res.status).toBe(201);
    expect((await res.json()).sha256).toBe(sha256Hex(tekst));
  });

  it("niezgodny skrót klienta = 400 hash_mismatch z oboma skrótami i długością; nic nie zapisano", async () => {
    const tekst = `zmieniony w drodze ${znacznik}`;
    const res = await wyslij({ ...pelne(tekst), sha256: sha256Hex("inny tekst") });
    expect(res.status).toBe(400);
    const dane = await res.json();
    expect(dane.code).toBe("hash_mismatch");
    expect(dane.expected).toBe(sha256Hex(tekst));
    expect(dane.received).toBe(sha256Hex("inny tekst"));
    expect(dane.error).toContain("Nic nie zapisano");
    const [{ ile }] = await sql`select count(*)::int as ile from user_words where text = ${tekst}`;
    expect(ile).toBe(0);
  });

  it("klient, który znormalizował tekst do NFC przed policzeniem skrótu, jest odrzucony (to jest to zmiana w drodze)", async () => {
    const nfd = "Zażółć".normalize("NFD");
    const res = await wyslij({ ...pelne(nfd), sha256: sha256Hex(nfd.normalize("NFC")) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("hash_mismatch");
  });

  it("bajt NUL = 400 invalid_text (Postgres go nie przyjmie), nie 500", async () => {
    const tekst = "przed\u0000po";
    const res = await wyslij(pelne(tekst));
    expect(res.status).toBe(400);
    const dane = await res.json();
    expect(dane.code).toBe("invalid_text");
    expect(dane.error).toContain("NUL");
  });

  it("samotny surogat = 400 invalid_text (UTF-8 nie ma na niego kodu, baza zamieniłaby go na U+FFFD)", async () => {
    const surowe = `{"text":"x\\ud800y","sha256":"${"0".repeat(64)}","source":"chat","capturedAt":"${czas()}"}`;
    const { POST } = await import("@/app/api/v2/user-words/route");
    const res = await POST(zadanie("/user-words", { metoda: "POST", token: rw.token, surowe, naglowki: { "content-type": "application/json" } }), undefined);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_text");
  });

  it("pusty tekst = 400, a tekst z samych spacji jest dozwolony (bez trim)", async () => {
    expect((await wyslij(pelne(""))).status).toBe(400);
    const spacje = await wyslij(pelne("   ", { role: `test.${znacznik}.spacje` }));
    expect(spacje.status).toBe(201);
    expect((await spacje.json()).text).toBe("   ");
  });

  it("ponowne wysłanie tego samego wpisu jest idempotentne: 200 i ten sam id, bez duplikatu", async () => {
    const cialo = pelne(`idempotentne ${znacznik}`, { capturedAt: "2026-10-14T09:35:00-04:00" });
    const a = await wyslij(cialo);
    const b = await wyslij(cialo);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await b.json()).id).toBe((await a.json()).id);
    const [{ ile }] = await sql`select count(*)::int as ile from user_words where text = ${cialo.text}`;
    expect(ile).toBe(1);
  });

  it("RÓWNOLEGŁE ponowienia tego samego wpisu dają dokładnie jeden wiersz (jedno 201, reszta 200)", async () => {
    // Test-only trigger wydłuża INSERT o 300 ms, żeby wyścig był deterministyczny: bez blokady
    // doradczej każde ponowienie zdążyłoby sprawdzić «czy już jest» PRZED zapisem pierwszego.
    await sql.unsafe(`create or replace function tj_test_opoznij() returns trigger language plpgsql as $$ begin perform pg_sleep(0.3); return new; end $$`);
    await sql.unsafe("create trigger tj_test_opoznienie before insert on user_words for each row execute function tj_test_opoznij()");
    try {
      const cialo = pelne(`wyścig idempotencji ${znacznik}`, { capturedAt: "2026-10-14T10:00:00Z" });
      const wyniki = await Promise.all(Array.from({ length: 8 }, () => wyslij(cialo)));
      const statusy = wyniki.map((r) => r.status).sort();
      expect(statusy).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
      const ids = new Set((await Promise.all(wyniki.map((r) => r.json()))).map((d) => d.id));
      expect(ids.size).toBe(1);
      const [{ ile }] = await sql`select count(*)::int as ile from user_words where text = ${cialo.text}`;
      expect(ile).toBe(1);
    } finally {
      await sql.unsafe("drop trigger if exists tj_test_opoznienie on user_words");
      await sql.unsafe("drop function if exists tj_test_opoznij()");
    }
  });

  it("ten sam tekst w innej chwili albo przy innej kotwicy to osobny wpis", async () => {
    const tekst = `ten sam tekst ${znacznik}`;
    const a = await (await wyslij(pelne(tekst, { capturedAt: "2026-10-14T09:00:00Z" }))).json();
    const b = await (await wyslij(pelne(tekst, { capturedAt: "2026-10-14T09:01:00Z" }))).json();
    expect(a.id).not.toBe(b.id);
  });

  it("PATCH i PUT = 409 z odesłaniem do aplikacji; tekst w bazie nietknięty", async () => {
    const zapisane = await (await wyslij(pelne(`do poprawy ${znacznik}`))).json();
    const { PATCH, PUT } = await import("@/app/api/v2/user-words/[id]/route");
    for (const [metoda, handler] of [["PATCH", PATCH], ["PUT", PUT]] as const) {
      const res = await handler(
        zadanie(`/user-words/${zapisane.id}`, { metoda, token: rw.token, cialo: { text: "podmieniony" } }),
        parametry({ id: String(zapisane.id) }),
      );
      expect(res.status, metoda).toBe(409);
      const dane = await res.json();
      expect(dane.code).toBe("immutable");
      expect(dane.error).toContain("w aplikacji");
      expect(dane.error).toContain("interpretation");
    }
    const [w] = await sql`select text from user_words where id = ${zapisane.id}`;
    expect(w.text).toBe(`do poprawy ${znacznik}`);
  });

  it("PATCH bez tokenu to 401, a z tokenem tylko do odczytu 403 (409 dostaje tylko uprawniony)", async () => {
    const { PATCH } = await import("@/app/api/v2/user-words/[id]/route");
    expect((await PATCH(zadanie("/user-words/1", { metoda: "PATCH", cialo: {} }), parametry({ id: "1" }))).status).toBe(401);
    expect((await PATCH(zadanie("/user-words/1", { metoda: "PATCH", token: ro.token, cialo: {} }), parametry({ id: "1" }))).status).toBe(403);
  });

  it("baza sama pilnuje niezmienności: UPDATE tekstu z pominięciem API daje TJ409", async () => {
    const zapisane = await (await wyslij(pelne(`baza ${znacznik}`))).json();
    await expect(sql`update user_words set text = 'x' where id = ${zapisane.id}`).rejects.toMatchObject({ code: "TJ409" });
  });

  it("interpretacja AI jest osobnym polem ustawianym raz; drugie ustawienie = 409", async () => {
    const zapisane = await (await wyslij(pelne(`interpretuj ${znacznik}`))).json();
    expect(zapisane.aiInterpretation).toBeNull();
    const { PUT } = await import("@/app/api/v2/user-words/[id]/interpretation/route");
    const ustaw = (text: string) =>
      PUT(zadanie(`/user-words/${zapisane.id}/interpretation`, { metoda: "PUT", token: rw.token, cialo: { text, model: "claude-test" } }), parametry({ id: String(zapisane.id) }));
    const pierwsza = await ustaw("Wszedł po sweepie low");
    expect(pierwsza.status).toBe(200);
    const dane = await pierwsza.json();
    expect(dane.aiInterpretation).toBe("Wszedł po sweepie low");
    expect(dane.interpretationModel).toBe("claude-test");
    expect(dane.text).toBe(`interpretuj ${znacznik}`);
    expect(dane.sha256).toBe(sha256Hex(`interpretuj ${znacznik}`));
    const druga = await ustaw("inna");
    expect(druga.status).toBe(409);
    expect((await druga.json()).code).toBe("interpretation_set");
  });

  it("interpretacja nieistniejących słów = 404", async () => {
    const { PUT } = await import("@/app/api/v2/user-words/[id]/interpretation/route");
    const res = await PUT(zadanie("/user-words/999999999/interpretation", { metoda: "PUT", token: rw.token, cialo: { text: "x", model: "m" } }), parametry({ id: "999999999" }));
    expect(res.status).toBe(404);
  });

  it("kotwica na nieistniejący trade albo notatkę = 422, nie 500", async () => {
    expect((await wyslij(pelne(`kotwica ${znacznik}`, { tradeId: 999_999_999 }))).status).toBe(422);
    expect((await wyslij(pelne(`kotwica2 ${znacznik}`, { noteId: 999_999_999 }))).status).toBe(422);
  });

  it("słowa przypięte do dnia wracają w GET /days/:date i w wyszukiwaniu", async () => {
    const tekst = `Unieważnienie: zamknięcie poniżej 18200 ${znacznik}`;
    const z = await (await wyslij(pelne(tekst, { day: "2026-10-14", role: "day.invalidation" }))).json();
    const { GET } = await import("@/app/api/v2/days/[date]/route");
    const dzien = await (await GET(zadanie("/days/2026-10-14", { token: ro.token }), parametry({ date: "2026-10-14" }))).json();
    expect(dzien.userWords.map((x: { id: number }) => x.id)).toContain(z.id);

    const { GET: szukaj } = await import("@/app/api/v2/search/route");
    const wynik = await (await szukaj(zadanie(`/search?q=${encodeURIComponent("zamkniecie ponizej")}&types=words`, { token: ro.token }), undefined)).json();
    expect(wynik.results.map((r: { id: number }) => r.id)).toContain(z.id);
    expect(wynik.results.find((r: { id: number }) => r.id === z.id).type).toBe("user_words");
  });

  it("token bez zakresu write nie zapisze słów (403)", async () => {
    expect((await wyslij(pelne(`zakaz ${znacznik}`), ro.token)).status).toBe(403);
  });

  it("walidacja: skrót wielkimi literami, nieznane źródło i brak capturedAt są odrzucane", async () => {
    const baza = pelne(`walidacja ${znacznik}`);
    expect((await wyslij({ ...baza, sha256: baza.sha256.toUpperCase() })).status).toBe(400);
    expect((await wyslij({ ...baza, source: "ui" })).status).toBe(400); // 'ui' tylko z aplikacji
    const { capturedAt: _c, ...bez } = baza;
    void _c;
    expect((await wyslij(bez)).status).toBe(400);
    expect((await wyslij({ ...baza, capturedAt: "2026-10-14T09:00:00" })).status).toBe(400); // czas bez strefy
  });
});
