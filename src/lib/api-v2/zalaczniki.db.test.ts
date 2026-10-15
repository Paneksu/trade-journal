import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";
import { PARAMS, sprzatnijNowe, unikat, wstawTrade, wywolaj, wywolajMultipart, zapiszSlowa, zgodneZKontraktem } from "./test/pomocnik-2b";

vi.mock("server-only", () => ({}));

/*
 * Zalaczniki i zrzuty (backlog z lacznika): zdjecie od uzytkownika (origin=manual) NIE kasuje zrzutow AI,
 * HEIC z telefonu przechodzi na WebP, zalaczniki notatek i dni, GET /me.
 */
const PROBKA_HEIC = readFileSync(path.resolve(__dirname, "test/probka.heic"));

describe.skipIf(!MOZNA_NA_BAZIE)("zalaczniki, zrzuty manual i GET /me (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par;
  let ro: Par;
  let instrumentId = 0;
  let kontoId = 0;
  const znacznik = unikat("zal");
  const DZIEN = "1987-07-07";
  const katalog = () => path.resolve(process.env.UPLOADS_DIR ?? "./.dane/zrzuty");

  beforeAll(async () => {
    sql = polacz();
    ({ instrumentId } = await zapewnijPodstawy(sql));
    rw = await nowyToken(sql, ["read", "write"]);
    ro = await nowyToken(sql, ["read"]);
    const [k] = await sql`insert into accounts (name, type) values (${`ZAL-${znacznik}`}, 'live') returning id`;
    kontoId = k.id;
  });
  afterAll(async () => {
    const pliki = await sql`select s.file, s.thumbnail from screenshots s where s.note_id in (select id from notes where created_by_token_id = ${rw.id})
                              or s.trade_id in (select id from trades where account_id = ${kontoId})
                              or s.day_note_id in (select id from day_notes where day = ${DZIEN})`;
    await sql`delete from trades where account_id = ${kontoId}`;
    await sql`delete from day_notes where day = ${DZIEN}`;
    await sprzatnijNowe(sql, [rw.id, ro.id]);
    await sql`delete from accounts where id = ${kontoId}`;
    await sprzatnijPoTokenach(sql, [rw.id, ro.id]);
    await sql.end();
    const { rm } = await import("node:fs/promises");
    for (const p of pliki) for (const f of [p.file, p.thumbnail]) if (f) await rm(path.join(katalog(), f), { force: true });
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  async function png(kolor: number) {
    return sharp({ create: { width: 24, height: 24, channels: 3, background: { r: kolor, g: 40, b: 90 } } }).png().toBuffer();
  }
  const plik = (bajty: Buffer | Uint8Array, nazwa: string, typ: string) => new File([new Uint8Array(bajty)], nazwa, { type: typ });

  async function zrzuty(tradeId: number, origin: string, ile: number, ziarno: number) {
    const form = new FormData();
    for (let i = 0; i < ile; i += 1) {
      form.append("shot", plik(await png(ziarno + i), `z${i}.png`, "image/png"));
      form.append("interval", "5m");
    }
    form.append("origin", origin);
    return wywolajMultipart(import("@/app/api/v2/trades/[id]/screenshots/route"), `/trades/${tradeId}/screenshots`, rw.token, form, PARAMS({ id: String(tradeId) }));
  }
  const ileWgOrigin = async (tradeId: number) => {
    const w = await sql`select origin, count(*)::int as ile from screenshots where trade_id = ${tradeId} group by origin`;
    return Object.fromEntries(w.map((x) => [x.origin, x.ile]));
  };

  it("GET /me: kim jest token (zakresy, aktor), bez sekretu; odpowiedz zgodna z kontraktem", async () => {
    const r = await wywolaj(import("@/app/api/v2/me/route"), "GET", "/me", { token: rw.token });
    expect(r.status).toBe(200);
    zgodneZKontraktem("get", "/me", r.json);
    expect(r.json).toMatchObject({ tokenId: rw.id, scopes: ["read", "write"], actor: `api:${rw.id}` });
    expect(JSON.stringify(r.json)).not.toContain(rw.token);
    expect(JSON.stringify(r.json)).not.toMatch(/sha256|prefix/i);
  });

  it("zdjecie od uzytkownika (origin=manual) jest DOPISYWANE i nie kasuje zrzutow AI; zrzuty AI nadal zastepuja swoje poprzednie wydanie", async () => {
    const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open" });
    const ai1 = await zrzuty(id, "tradingview", 2, 10);
    expect(ai1.status, JSON.stringify(ai1.json)).toBe(200);
    zgodneZKontraktem("post", "/trades/{id}/screenshots", ai1.json);
    expect(await ileWgOrigin(id)).toEqual({ tradingview: 2 });

    const reczne = await zrzuty(id, "manual", 1, 100);
    expect(reczne.status, JSON.stringify(reczne.json)).toBe(200);
    expect(reczne.json.replaced).toBe(0);
    expect(reczne.json.origin).toBe("manual");
    expect(await ileWgOrigin(id)).toEqual({ tradingview: 2, manual: 1 });

    // ponowne wyslanie zrzutow AI zastepuje TYLKO zrzuty AI tego samego pochodzenia; zdjecie uzytkownika zostaje
    const ai2 = await zrzuty(id, "tradingview", 1, 50);
    expect(ai2.json.replaced).toBe(2);
    expect(await ileWgOrigin(id)).toEqual({ tradingview: 1, manual: 1 });

    // kolejne zdjecie uzytkownika nie rusza niczego
    await zrzuty(id, "manual", 1, 120);
    expect(await ileWgOrigin(id)).toEqual({ tradingview: 1, manual: 2 });
    const [m] = await sql`select sha256, captured_at is not null as ma_czas from screenshots where trade_id = ${id} and origin = 'manual' limit 1`;
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.ma_czas).toBe(true);
  });

  it("zrzut zapisuje sha256 BAJTOW WGRANEGO pliku (przed konwersja do WebP), capturedAt i chartState z klienta", async () => {
    const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open" });
    const bajty = await png(77);
    const form = new FormData();
    form.append("shot", plik(bajty, "wykres.png", "image/png"));
    form.append("interval", "1h");
    form.append("capturedAt", "2026-03-10T09:35:00-04:00");
    form.append("chartState", JSON.stringify({ symbol: "NQ1!", interval: "1h", range: ["09:00", "10:00"] }));
    form.append("origin", "fxreplay");
    const r = await wywolajMultipart(import("@/app/api/v2/trades/[id]/screenshots/route"), `/trades/${id}/screenshots`, rw.token, form, PARAMS({ id: String(id) }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.screenshots[0].sha256).toBe(createHash("sha256").update(bajty).digest("hex"));
    const [w] = await sql`select captured_at, chart_state from screenshots where id = ${r.json.screenshots[0].id}`;
    expect(new Date(w.captured_at).toISOString()).toBe("2026-03-10T13:35:00.000Z");
    expect(w.chart_state).toEqual({ symbol: "NQ1!", interval: "1h", range: ["09:00", "10:00"] });

    const zlyCzas = new FormData();
    zlyCzas.append("shot", plik(bajty, "a.png", "image/png"));
    zlyCzas.append("capturedAt", "wczoraj");
    zlyCzas.append("origin", "manual");
    const odm = await wywolajMultipart(import("@/app/api/v2/trades/[id]/screenshots/route"), `/trades/${id}/screenshots`, rw.token, zlyCzas, PARAMS({ id: String(id) }));
    expect(odm.status).toBe(400);
    expect(odm.json.error).toContain("capturedAt #1");
    const zlyStan = new FormData();
    zlyStan.append("shot", plik(bajty, "a.png", "image/png"));
    zlyStan.append("chartState", "[1,2]");
    zlyStan.append("origin", "manual");
    expect((await wywolajMultipart(import("@/app/api/v2/trades/[id]/screenshots/route"), `/trades/${id}/screenshots`, rw.token, zlyStan, PARAMS({ id: String(id) }))).status).toBe(400);
  });

  it("origin spoza listy = 400; trade bez zrodla API i bez origin = 400", async () => {
    const id = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "open" });
    const zly = await zrzuty(id, "telefon", 1, 5);
    expect(zly.status).toBe(400);
    expect(zly.json.error).toContain("manual");
    const form = new FormData();
    form.append("shot", plik(await png(9), "a.png", "image/png"));
    const bez = await wywolajMultipart(import("@/app/api/v2/trades/[id]/screenshots/route"), `/trades/${id}/screenshots`, rw.token, form, PARAMS({ id: String(id) }));
    expect(bez.status).toBe(400);
  });

  it("zalacznik notatki: HEIC z telefonu -> WebP + miniatura na dysku, sha256 pliku wgranego, podpis i interwal", async () => {
    const nota = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: unikat("Pojęcie z załącznikiem"), bodyMd: "treść" } });
    const noteId = nota.json.id as number;
    const form = new FormData();
    form.append("shot", plik(PROBKA_HEIC, "IMG_0001.HEIC", "image/heic"));
    form.append("interval", "15m");
    form.append("caption", "Zdjęcie z telefonu 📱");
    const r = await wywolajMultipart(import("@/app/api/v2/notes/[id]/attachments/route"), `/notes/${noteId}/attachments`, rw.token, form, PARAMS({ id: String(noteId) }));
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    zgodneZKontraktem("post", "/notes/{id}/attachments", r.json);
    const z = r.json.screenshots[0];
    expect(z).toMatchObject({ origin: "manual", interval: "15m", caption: "Zdjęcie z telefonu 📱", width: 96, height: 64 });
    expect(z.sha256).toBe(createHash("sha256").update(PROBKA_HEIC).digest("hex"));
    expect(z.file.startsWith(`notatka-${noteId}/`)).toBe(true);
    expect(z.file.endsWith(".webp")).toBe(true);
    expect(existsSync(path.join(katalog(), z.file))).toBe(true);
    expect(existsSync(path.join(katalog(), z.thumbnail))).toBe(true);
    const meta = await sharp(path.join(katalog(), z.file)).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([96, 64]);
    const [w] = await sql`select note_id, trade_id, day_note_id from screenshots where id = ${z.id}`;
    expect(w).toEqual({ note_id: noteId, trade_id: null, day_note_id: null });
  });

  it("PNG, JPG i WebP przechodza, plik udajacy HEIC i nieobslugiwany typ = 422 z powodem; nic nie zostaje w bazie", async () => {
    const nota = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: unikat("Pojęcie formaty"), bodyMd: "" } });
    const noteId = nota.json.id as number;
    const wyslij = (f: File) => {
      const form = new FormData();
      form.append("shot", f);
      return wywolajMultipart(import("@/app/api/v2/notes/[id]/attachments/route"), `/notes/${noteId}/attachments`, rw.token, form, PARAMS({ id: String(noteId) }));
    };
    const bazowy = await png(30);
    expect((await wyslij(plik(bazowy, "a.png", "image/png"))).status).toBe(201);
    expect((await wyslij(plik(await sharp(bazowy).jpeg().toBuffer(), "a.jpg", "image/jpeg"))).status).toBe(201);
    expect((await wyslij(plik(await sharp(bazowy).webp().toBuffer(), "a.webp", "image/webp"))).status).toBe(201);
    const udaje = await wyslij(plik(bazowy, "falszywy.heic", "image/heic"));
    expect(udaje.status).toBe(422);
    expect(udaje.json.error).toContain("kontenerem HEIF");
    const nieObraz = await wyslij(plik(Buffer.from("to nie jest obraz, tylko tekst"), "falszywy.png", "image/png"));
    expect(nieObraz.status).toBe(422);
    expect(nieObraz.json.error).toContain("nie jest poprawnym obrazem");
    const tekst = await wyslij(plik(Buffer.from("to nie obraz"), "a.txt", "text/plain"));
    expect(tekst.status).toBe(422);
    expect(tekst.json.error).toContain("HEIC");
    const [{ ile }] = await sql`select count(*)::int as ile from screenshots where note_id = ${noteId}`;
    expect(ile).toBe(3);
  });

  it("HEIC z deklarowanym gigapikselowym obrazem jest odrzucany z metadanych (bez dekodowania); limit liczony pod blokada: dwa rownolegle wgrania nie przekrocza 8", async () => {
    const nota = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: unikat("Pojęcie HEIC limit"), bodyMd: "" } });
    const noteId = nota.json.id as number;
    const wyslij = async (pliki: File[]) => {
      const form = new FormData();
      for (const p of pliki) form.append("shot", p);
      return wywolajMultipart(import("@/app/api/v2/notes/[id]/attachments/route"), `/notes/${noteId}/attachments`, rw.token, form, PARAMS({ id: String(noteId) }));
    };
    // podmiana wymiarow w pudelku ispe na 20000 x 20000 px (400 mln > limit 40 mln)
    const duzy = Buffer.from(PROBKA_HEIC);
    let podmiany = 0;
    for (let i = 4; i + 16 <= duzy.length; i += 1) {
      if (duzy.toString("latin1", i, i + 4) === "ispe") {
        duzy.writeUInt32BE(20000, i + 8);
        duzy.writeUInt32BE(20000, i + 12);
        podmiany += 1;
      }
    }
    expect(podmiany).toBeGreaterThan(0);
    const gigant = await wyslij([plik(duzy, "gigant.heic", "image/heic")]);
    expect(gigant.status).toBe(422);
    expect(gigant.json.error).toContain("limit to 40000000 px");
    expect((await sql`select count(*)::int as n from screenshots where note_id = ${noteId}`)[0].n).toBe(0);

    const paczka = async (ziarno: number) => Promise.all(Array.from({ length: 5 }, async (_, i) => plik(await png(ziarno + i), `r${ziarno + i}.png`, "image/png")));
    const [a, b] = await Promise.all([wyslij(await paczka(100)), wyslij(await paczka(150))]);
    // obie paczki przeszly wstepna kontrole (0 + 5 <= 8), a limit pilnuje blokada przy zapisie: lacznie dokladnie 8, co najmniej jedna odmowa
    expect([a.status, b.status].every((x) => x === 201 || x === 422)).toBe(true);
    expect([a.status, b.status]).toContain(422);
    const wiersze = await sql`select sort_order from screenshots where note_id = ${noteId} order by sort_order`;
    expect(wiersze.length).toBe(8);
    expect(new Set(wiersze.map((w) => w.sort_order)).size).toBe(wiersze.length);
    const odmowa = a.status === 422 ? a : b;
    expect(odmowa.json.error).toContain("Limit 8");
    expect(odmowa.json.saved).toBeLessThan(5);
  });

  it("blad zapisu: klient dostaje tekst ogolny z identyfikatorem, szczegoly (sciezki, komunikaty sterownika) tylko w logu, a plik nie zostaje na dysku", async () => {
    const { wgrajZalaczniki } = await import("@/lib/trades/screenshots-db");
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});
    const psuty = { name: "x.png", type: "image/png", size: 10, arrayBuffer: async () => { throw new Error("EACCES: permission denied, open /sekret/uploads/x"); } } as unknown as File;
    const wynik = await wgrajZalaczniki({ kind: "note", id: 1 }, [{ file: psuty, interval: null }], "manual", undefined, undefined, { requestId: "req-test-1" });
    expect(wynik).toContain("req-test-1");
    expect(wynik).not.toContain("EACCES");
    expect(wynik).not.toContain("sekret");
    expect(blad.mock.calls.some((c) => String(c[0]).includes("req-test-1") && String((c[1] as Error)?.message).includes("EACCES"))).toBe(true);

    // blad bazy (nieistniejaca notatka): komunikat z opiszBladBazy, bez surowego tekstu Postgresa
    const ok = await png(7);
    const dbBlad = await wgrajZalaczniki({ kind: "note", id: 999999999 }, [{ file: plik(ok, "ok.png", "image/png"), interval: null }], "manual", undefined, undefined, { requestId: "req-test-2" });
    expect(dbBlad).toContain("req-test-2");
    expect(dbBlad).not.toContain("violates");
    expect(dbBlad).not.toContain("foreign key");
  });

  it("limit 8 zalacznikow na wlasciciela; nieznana notatka = 404; interwal spoza listy = 422; brak plikow = 400", async () => {
    const nota = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "concept", title: unikat("Pojęcie limit"), bodyMd: "" } });
    const noteId = nota.json.id as number;
    const wyslij = async (ile: number, id = noteId, pola: Record<string, string> = {}) => {
      const form = new FormData();
      for (let i = 0; i < ile; i += 1) form.append("shot", plik(await png(i), `a${i}.png`, "image/png"));
      for (const [k, v] of Object.entries(pola)) form.append(k, v);
      return wywolajMultipart(import("@/app/api/v2/notes/[id]/attachments/route"), `/notes/${id}/attachments`, rw.token, form, PARAMS({ id: String(id) }));
    };
    expect((await wyslij(8)).status).toBe(201);
    const dziewiaty = await wyslij(1);
    expect(dziewiaty.status).toBe(422);
    expect(dziewiaty.json.error).toContain("Limit 8");
    expect((await wyslij(1, 999999999)).status).toBe(404);
    expect((await wyslij(1, noteId, { interval: "7m" })).status).toBe(422);
    expect((await wyslij(0)).status).toBe(400);
    expect((await wyslij(1, noteId, { origin: "ktos" })).status).toBe(400);
  });

  it("zalacznik dnia: zaklada notatke dnia, kolejne wchodza na ta sama; token tylko do odczytu = 403", async () => {
    const wyslij = async (token: string, kolor: number) => {
      const form = new FormData();
      form.append("shot", plik(await png(kolor), "dzien.png", "image/png"));
      return wywolajMultipart(import("@/app/api/v2/days/[date]/attachments/route"), `/days/${DZIEN}/attachments?accountId=${kontoId}`, token, form, PARAMS({ date: DZIEN }));
    };
    const pierwszy = await wyslij(rw.token, 3);
    expect(pierwszy.status, JSON.stringify(pierwszy.json)).toBe(201);
    zgodneZKontraktem("post", "/days/{date}/attachments", pierwszy.json);
    const drugi = await wyslij(rw.token, 4);
    expect(drugi.json.owner.dayNoteId).toBe(pierwszy.json.owner.dayNoteId);
    const [{ ile }] = await sql`select count(*)::int as ile from screenshots where day_note_id = ${pierwszy.json.owner.dayNoteId}`;
    expect(ile).toBe(2);
    const [{ notatek }] = await sql`select count(*)::int as notatek from day_notes where day = ${DZIEN} and account_id = ${kontoId}`;
    expect(notatek).toBe(1);
    expect((await wyslij(ro.token, 5)).status).toBe(403);
    const zlaData = await wywolajMultipart(import("@/app/api/v2/days/[date]/attachments/route"), "/days/jutro/attachments", rw.token, new FormData(), PARAMS({ date: "jutro" }));
    expect(zlaData.status).toBe(400);
  });

  it("dopisek do notatki: AI wymaga trade'a i cytatu, mentor wymaga zakresu import; regula nie przyjmuje dopiskow", async () => {
    const nota = await wywolaj(import("@/app/api/v2/notes/route"), "POST", "/notes", { token: rw.token, cialo: { kind: "strategy", title: unikat("Strategia z dopiskiem"), bodyMd: "" } });
    const noteId = nota.json.id as number;
    const tradeId = await wstawTrade(sql, { kontoId, instrumentId, dzien: DZIEN, status: "closed" });
    const slowa = await zapiszSlowa(rw.token, "Dopiero po zamknięciu 5m, nie wcześniej.", { tradeId });
    const mod = import("@/app/api/v2/notes/[id]/additions/route");
    const ctx = PARAMS({ id: String(noteId) });

    const bezCytatu = await wywolaj(mod, "POST", `/notes/${noteId}/additions`, { token: rw.token, cialo: { bodyMd: "Warunek: zamknięcie świecy.", origin: "ai", tradeId } }, ctx);
    expect(bezCytatu.status).toBe(400);
    const ok = await wywolaj(mod, "POST", `/notes/${noteId}/additions`, { token: rw.token, cialo: { bodyMd: "Warunek: zamknięcie świecy.", origin: "ai", tradeId, quoteWordsId: slowa.id } }, ctx);
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    zgodneZKontraktem("post", "/notes/{id}/additions", ok.json);
    expect(ok.json.signature).toBe("obserwacja AI");
    // idempotencja (review P5): ten sam dopisek wyslany ponownie = ten sam wiersz, 200
    const powtorka = await wywolaj(mod, "POST", `/notes/${noteId}/additions`, { token: rw.token, cialo: { bodyMd: "Warunek: zamknięcie świecy.", origin: "ai", tradeId, quoteWordsId: slowa.id } }, ctx);
    expect(powtorka.status).toBe(200);
    expect(powtorka.json.id).toBe(ok.json.id);
    expect((await sql`select count(*)::int as n from note_additions where note_id = ${noteId}`)[0].n).toBe(1);
    const mentor = await wywolaj(mod, "POST", `/notes/${noteId}/additions`, { token: rw.token, cialo: { bodyMd: "x", origin: "mentor", mentorClaimId: 1 } }, ctx);
    expect(mentor.status).toBe(403);
    expect(mentor.json.missingScope).toBe("import");
    const lista = await wywolaj(mod, "GET", `/notes/${noteId}/additions`, { token: ro.token }, ctx);
    zgodneZKontraktem("get", "/notes/{id}/additions", lista.json);
    expect(lista.json.additions).toHaveLength(1);
    // dopisek jest tylko do dopisywania: tresci nie zmieni nawet SQL
    let kod: string | undefined;
    try {
      await sql`update note_additions set body_md = 'podmieniony' where id = ${ok.json.id}`;
    } catch (e) {
      kod = (e as { code?: string }).code;
    }
    expect(kod).toBe("TJ409");

    const regula = await sql`select n.id from notes n where n.kind = 'rule' limit 1`;
    if (regula[0]) {
      const odm = await wywolaj(mod, "POST", `/notes/${regula[0].id}/additions`, { token: rw.token, cialo: { bodyMd: "x", origin: "ai", tradeId, quoteWordsId: slowa.id } }, PARAMS({ id: String(regula[0].id) }));
      expect(odm.status).toBe(422);
      expect(odm.json.code).toBe("managed_note");
    }
    await sql`delete from note_additions where note_id = ${noteId}`;
  });
});
