import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, parametry, polacz, sprzatnijPoTokenach, zadanie, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Notatki, linki [[...]], optymistyczna współbieżność (If-Match -> 409) i
 * wyszukiwanie bez polskich znaków - na prawdziwej bazie lokalnej.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("notatki i wyszukiwanie (baza lokalna)", () => {
  let sql: Sql;
  let rw: Par; // read + write
  let ro: Par; // tylko read
  let pr: Par; // read + write + propose
  const znacznik = `T${Date.now().toString(36)}`;
  const t = (nazwa: string) => `${nazwa} ${znacznik}`;

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
    rw = await nowyToken(sql, ["read", "write"]);
    ro = await nowyToken(sql, ["read"]);
    pr = await nowyToken(sql, ["read", "write", "propose"]);
  });
  afterAll(async () => {
    await sprzatnijPoTokenach(sql, [rw.id, ro.id, pr.id]);
    await sql.end();
  });
  beforeEach(() => wyczyscLimiter());

  async function utworz(cialo: Record<string, unknown>, token = rw.token) {
    const { POST } = await import("@/app/api/v2/notes/route");
    return POST(zadanie("/notes", { metoda: "POST", token, cialo }), undefined);
  }
  async function pobierz(id: number, token = rw.token) {
    const { GET } = await import("@/app/api/v2/notes/[id]/route");
    return GET(zadanie(`/notes/${id}`, { token }), parametry({ id: String(id) }));
  }
  async function zmien(id: number, cialo: unknown, ifMatch?: string, token = rw.token) {
    const { PATCH } = await import("@/app/api/v2/notes/[id]/route");
    return PATCH(
      zadanie(`/notes/${id}`, { metoda: "PATCH", token, cialo, naglowki: ifMatch === undefined ? {} : { "if-match": ifMatch } }),
      parametry({ id: String(id) }),
    );
  }
  async function szukaj(q: string, extra = "", token = ro.token) {
    const { GET } = await import("@/app/api/v2/search/route");
    return GET(zadanie(`/search?q=${encodeURIComponent(q)}${extra}`, { token }), undefined);
  }

  it("tworzy notatkę: 201, rev 1, slug ASCII z tytułu, ETag, skrót treści z bajtów UTF-8", async () => {
    const res = await utworz({ kind: "concept", title: t("Zarządzanie ryzykiem"), bodyMd: "Ryzyko na trade to 1R.\r\nŁódź 🔥" });
    expect(res.status).toBe(201);
    expect(res.headers.get("etag")).toBe('"1"');
    const n = await res.json();
    expect(n.rev).toBe(1);
    expect(n.slug).toBe(`zarzadzanie-ryzykiem-${znacznik.toLowerCase()}`);
    expect(n.origin).toBe("ai");
    const { createHash } = await import("node:crypto");
    expect(n.contentHash).toBe(createHash("sha256").update(Buffer.from("Ryzyko na trade to 1R.\r\nŁódź 🔥", "utf8")).digest("hex"));
    const [w] = await sql`select body_md, created_by_token_id from notes where id = ${n.id}`;
    expect(w.body_md).toBe("Ryzyko na trade to 1R.\r\nŁódź 🔥");
    expect(w.created_by_token_id).toBe(rw.id);
  });

  it("agent nie może podszyć się pod origin 'user' (zarezerwowane dla UI)", async () => {
    const res = await utworz({ kind: "concept", title: t("Podszycie"), origin: "user" });
    expect(res.status).toBe(400);
  });

  it("tytuł jest unikalny bez względu na wielkość liter i ogonki: 409 ze wskazaniem istniejącej", async () => {
    const pierwsza = await (await utworz({ kind: "concept", title: t("Płynność") })).json();
    const res = await utworz({ kind: "concept", title: t("PLYNNOSC") });
    expect(res.status).toBe(409);
    const dane = await res.json();
    expect(dane.code).toBe("title_taken");
    expect(dane.existing.id).toBe(pierwsza.id);
    expect(dane.error).toContain("If-Match");
  });

  it("kolizja sluga przy różnych tytułach dostaje numer (nie 500)", async () => {
    const a = await (await utworz({ kind: "concept", title: t("Sweep-low") })).json();
    const b = await (await utworz({ kind: "concept", title: t("Sweep low") })).json();
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug).toMatch(/-2$/);
  });

  it("externalRef jest kluczem idempotencji: drugi POST = 409 z id istniejącej", async () => {
    const ref = `vault:Pojecia/${znacznik}.md`;
    const a = await (await utworz({ kind: "concept", title: t("Z importu"), externalRef: ref })).json();
    const res = await utworz({ kind: "concept", title: t("Z importu 2"), externalRef: ref });
    expect(res.status).toBe(409);
    expect((await res.json()).existing.id).toBe(a.id);
  });

  it("nieistniejący trade jako kotwica = 422, nie 500", async () => {
    const res = await utworz({ kind: "trade_note", title: t("Osierocona"), tradeId: 999_999_999 });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("unknown_anchor");
  });

  it("PATCH bez If-Match = 428; z nieparsowalnym = 400", async () => {
    const n = await (await utworz({ kind: "learning", title: t("If-Match brak") })).json();
    const brak = await zmien(n.id, { bodyMd: "x" });
    expect(brak.status).toBe(428);
    expect((await brak.json()).code).toBe("precondition_required");
    expect((await zmien(n.id, { bodyMd: "x" }, "*")).status).toBe(400);
    expect((await zmien(n.id, { bodyMd: "x" }, "abc")).status).toBe(400);
  });

  it("PATCH z aktualnym rev: rev rośnie, stara treść ląduje w note_revisions z aktorem api:<id>", async () => {
    const n = await (await utworz({ kind: "learning", title: t("Rewizje"), bodyMd: "wersja 1" })).json();
    const res = await zmien(n.id, { bodyMd: "wersja 2" }, String(n.rev));
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"2"');
    expect((await res.json()).rev).toBe(2);
    const rewizje = await sql`select rev, body_md, actor from note_revisions where note_id = ${n.id} order by rev`;
    expect(rewizje).toHaveLength(1);
    expect(rewizje[0].rev).toBe(1);
    expect(rewizje[0].body_md).toBe("wersja 1");
    expect(rewizje[0].actor).toBe(`api:${rw.id}`);
  });

  it("nieaktualny If-Match = 409 z bieżącą treścią do scalenia (dwa urządzenia nie nadpiszą się po cichu)", async () => {
    const n = await (await utworz({ kind: "learning", title: t("Konflikt"), bodyMd: "a" })).json();
    await zmien(n.id, { bodyMd: "urządzenie A" }, "1");
    const res = await zmien(n.id, { bodyMd: "urządzenie B" }, "1");
    expect(res.status).toBe(409);
    const dane = await res.json();
    expect(dane.code).toBe("rev_mismatch");
    expect(dane.currentRev).toBe(2);
    expect(dane.current.bodyMd).toBe("urządzenie A");
    expect(dane.error).toContain("If-Match: 2");
    const [w] = await sql`select body_md from notes where id = ${n.id}`;
    expect(w.body_md).toBe("urządzenie A");
  });

  it("dwa równoległe PATCH z tym samym rev: dokładnie jeden wygrywa, drugi dostaje 409", async () => {
    const n = await (await utworz({ kind: "learning", title: t("Wyścig"), bodyMd: "start" })).json();
    const [a, b] = await Promise.all([zmien(n.id, { bodyMd: "A" }, "1"), zmien(n.id, { bodyMd: "B" }, "1")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [w] = await sql`select rev from notes where id = ${n.id}`;
    expect(w.rev).toBe(2);
  });

  it("PATCH nieistniejącej notatki = 404, a tytuł zajęty przez inną = 409", async () => {
    expect((await zmien(999_999_999, { bodyMd: "x" }, "1")).status).toBe(404);
    const a = await (await utworz({ kind: "learning", title: t("Tytuł A") })).json();
    await utworz({ kind: "learning", title: t("Tytuł B") });
    const res = await zmien(a.id, { title: t("TYTUL B") }, String(a.rev));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("title_taken");
  });

  it("brak operacji kasowania: archiwizacja odkłada notatkę, nie rusza rev i można ją przywrócić", async () => {
    const n = await (await utworz({ kind: "learning", title: t("Do archiwum") })).json();
    const arch = await (await zmien(n.id, { archived: true }, String(n.rev))).json();
    expect(arch.archivedAt).not.toBeNull();
    expect(arch.rev).toBe(1);
    const { GET } = await import("@/app/api/v2/notes/route");
    const lista = await (await GET(zadanie(`/notes?slug=${n.slug}`, { token: ro.token }), undefined)).json();
    expect(lista.notes).toHaveLength(0);
    const zArchiwum = await (await GET(zadanie(`/notes?slug=${n.slug}&includeArchived=true`, { token: ro.token }), undefined)).json();
    expect(zArchiwum.notes).toHaveLength(1);
    const wrocila = await (await zmien(n.id, { archived: false }, "1")).json();
    expect(wrocila.archivedAt).toBeNull();
  });

  it("linki [[...]]: wiszący dowiązuje się, gdy notatka powstanie, a backlinki pokazują źródło", async () => {
    const zrodlo = await (await utworz({ kind: "strategy", title: t("Plan dnia"), bodyMd: `Patrz [[${t("Docelowa notatka")}]] oraz [[Nieistniejąca ${znacznik}|alias]].` })).json();
    let szczegoly = await (await pobierz(zrodlo.id)).json();
    expect(szczegoly.links).toHaveLength(2);
    expect(szczegoly.links.every((l: { resolved: unknown }) => l.resolved === null)).toBe(true);

    const cel = await (await utworz({ kind: "concept", title: t("DOCELOWA notatka") })).json();
    szczegoly = await (await pobierz(zrodlo.id)).json();
    const rozwiazany = szczegoly.links.find((l: { target: string }) => l.target === t("Docelowa notatka"));
    expect(rozwiazany.resolved.id).toBe(cel.id);

    const odCelu = await (await pobierz(cel.id)).json();
    expect(odCelu.backlinks.map((b: { id: number }) => b.id)).toEqual([zrodlo.id]);
  });

  it("zmiana treści przelicza linki (usuwa stare, dodaje nowe)", async () => {
    const cel = await (await utworz({ kind: "concept", title: t("Cel linku") })).json();
    const n = await (await utworz({ kind: "strategy", title: t("Zmienna treść"), bodyMd: `[[${t("Cel linku")}]]` })).json();
    expect((await (await pobierz(cel.id)).json()).backlinks).toHaveLength(1);
    await zmien(n.id, { bodyMd: "bez linków" }, String(n.rev));
    expect((await (await pobierz(cel.id)).json()).backlinks).toHaveLength(0);
  });

  it("szukanie: «zarzadzanie» znajduje «Zarządzanie» (pełnotekstowo i trigramowo)", async () => {
    await utworz({ kind: "concept", title: t("Zarządzanie kapitałem"), bodyMd: "Zasady alokacji." });
    for (const q of ["zarzadzanie", "ZARZADZANIE", "Zarządzanie", "zarzad", "zarzadzaniem"]) {
      const dane = await (await szukaj(q, "&types=notes")).json();
      const tytuly = dane.results.map((r: { title: string }) => r.title);
      expect(tytuly, `zapytanie »${q}«`).toContain(t("Zarządzanie kapitałem"));
    }
  });

  it("szukanie: «ł» (którego NFD nie rozkłada) i tekst w NFD", async () => {
    await utworz({ kind: "concept", title: t("Łódź sesja"), bodyMd: "treść" });
    await utworz({ kind: "concept", title: t("Notatka NFD"), bodyMd: "Zażółć gęślą jaźń".normalize("NFD") });
    const lodz = await (await szukaj("lodz", "&types=notes")).json();
    expect(lodz.results.map((r: { title: string }) => r.title)).toContain(t("Łódź sesja"));
    const nfd = await (await szukaj("zazolc", "&types=notes")).json();
    expect(nfd.results.map((r: { title: string }) => r.title)).toContain(t("Notatka NFD"));
  });

  it("szukanie rozmyte łapie literówkę i odmianę, a nie zwraca archiwum", async () => {
    const n = await (await utworz({ kind: "concept", title: t("Płynność rynkowa") })).json();
    const literowka = await (await szukaj("plynnosc rynkowaa", "&types=notes")).json();
    expect(literowka.results.map((r: { id: number }) => r.id)).toContain(n.id);
    await zmien(n.id, { archived: true }, String(n.rev));
    const potem = await (await szukaj("plynnosc rynkowa", "&types=notes")).json();
    expect(potem.results.map((r: { id: number }) => r.id)).not.toContain(n.id);
  });

  it("szukanie nie psuje się na znakach specjalnych i wildcardach LIKE", async () => {
    for (const q of ["%", "_", "\\", "a & b | c", "((", "'; drop table notes; --", "💥"]) {
      const res = await szukaj(q);
      expect(res.status, `zapytanie »${q}«`).toBe(200);
    }
    const tabela = await sql`select to_regclass('public.notes') as t`;
    expect(tabela[0].t).not.toBeNull();
  });

  it("szukanie: znaki, które unaccent zamienia na składnię tsquery («⑴» -> «(1)»), nie dają 500", async () => {
    await utworz({ kind: "concept", title: t("Punkt (1) listy"), bodyMd: "pierwszy punkt" });
    for (const q of ["⑴", "①", "⑴⑵⑶", "½", "²", "ǅ", "ﬃ", "⒜ punkt", "㈠", "Ⅻ", "⑴ zarzadzanie", "((", "!|&:*<->", "\\"]) {
      const res = await szukaj(q);
      expect(res.status, `zapytanie »${q}«: ${await res.clone().text()}`).toBe(200);
    }
    const jeden = await (await szukaj("⑴")).json();
    expect(Array.isArray(jeden.results)).toBe(true);
  });

  it("szukanie: przegląd kodów Unicode (litery, cyfry, znaki łączone, symbole) nigdy nie kończy się 500", async () => {
    const kody: number[] = [];
    for (let c = 0x20; c < 0x2fff; c += 7) kody.push(c);
    for (let c = 0xff00; c < 0xffef; c += 3) kody.push(c);
    const bledy: string[] = [];
    // paczki po 40 znaków, zeby przejsc duzo kodow bez tysiaca zapytan
    for (let i = 0; i < kody.length; i += 40) {
      const q = String.fromCodePoint(...kody.slice(i, i + 40).filter((c) => c < 0xd800 || c > 0xdfff));
      const res = await szukaj(q);
      if (res.status !== 200) bledy.push(`U+${kody[i].toString(16)}: ${res.status}`);
    }
    expect(bledy).toEqual([]);
  });

  it("lista notatek: filtr kind i paginacja kursorem", async () => {
    for (let i = 0; i < 3; i += 1) await utworz({ kind: "mistake", title: t(`Błąd ${i}`) });
    const { GET } = await import("@/app/api/v2/notes/route");
    const strona1 = await (await GET(zadanie("/notes?kind=mistake&limit=2", { token: ro.token }), undefined)).json();
    expect(strona1.notes).toHaveLength(2);
    expect(strona1.nextAfter).toBe(strona1.notes[1].id);
    const strona2 = await (await GET(zadanie(`/notes?kind=mistake&limit=2&after=${strona1.nextAfter}`, { token: ro.token }), undefined)).json();
    expect(strona2.notes.length).toBeGreaterThan(0);
    expect(strona2.notes[0].id).toBeGreaterThan(strona1.nextAfter);
    expect(strona2.notes.every((n: { kind: string }) => n.kind === "mistake")).toBe(true);
  });

  describe("notatki reguł i hipotez mają własne trasy", () => {
    it("POST /notes z kind rule albo hypothesis = 422 use_dedicated_endpoint z adresem właściwej trasy", async () => {
      const r = await utworz({ kind: "rule", title: t("Reguła obejściem") });
      expect(r.status).toBe(422);
      const dr = await r.json();
      expect(dr.code).toBe("use_dedicated_endpoint");
      expect(dr.useInstead).toBe("/api/v2/rules/proposals");
      const h = await utworz({ kind: "hypothesis", title: t("Hipoteza obejściem") });
      expect(h.status).toBe(422);
      expect((await h.json()).useInstead).toBe("/api/v2/hypotheses");
      const [{ ile }] = await sql`select count(*)::int as ile from notes where title in (${t("Reguła obejściem")}, ${t("Hipoteza obejściem")})`;
      expect(ile).toBe(0);
    });

    it("PATCH notatki reguły nie zmienia title, bodyMd ani meta (409 managed_note), a archiwizacja przechodzi", async () => {
      const { POST } = await import("@/app/api/v2/rules/proposals/route");
      const pr1 = await POST(zadanie("/rules/proposals", { metoda: "POST", token: pr.token, cialo: { title: t("Reguła zarządzana"), textMd: "Treść wersji.", origin: "mentor", evidence: { video: "yt", t: 1, quote: "cytat" } } }), undefined);
      expect(pr1.status).toBe(201);
      const noteId = (await pr1.json()).noteId as number;
      for (const zmiana of [{ title: t("Inny tytuł") }, { bodyMd: "podmieniona treść" }, { meta: { vault_status: "zatwierdzona" } }]) {
        const res = await zmien(noteId, zmiana, "1");
        expect(res.status, JSON.stringify(zmiana)).toBe(409);
        const d = await res.json();
        expect(d.code).toBe("managed_note");
        expect(d.useInstead).toBe("/api/v2/rules/proposals");
      }
      const [w] = await sql`select title, body_md, rev from notes where id = ${noteId}`;
      expect(w).toMatchObject({ title: t("Reguła zarządzana"), body_md: "Treść wersji.", rev: 1 });
      expect((await zmien(noteId, { archived: true }, "1")).status).toBe(200);
    });

    it("PATCH notatki hipotezy też jest zablokowany (409), choć sama hipoteza powstaje przez /hypotheses", async () => {
      const { POST } = await import("@/app/api/v2/hypotheses/route");
      const h = await POST(zadanie("/hypotheses", { metoda: "POST", token: rw.token, cialo: { title: t("Hipoteza zarządzana") } }), undefined);
      expect(h.status).toBe(201);
      const noteId = (await h.json()).noteId as number;
      const res = await zmien(noteId, { bodyMd: "podmiana" }, "1");
      expect(res.status).toBe(409);
      expect((await res.json()).useInstead).toBe("/api/v2/hypotheses");
    });

    it("zwykłe rodzaje (np. strategy, concept) nadal edytuje się normalnie", async () => {
      const n = await (await utworz({ kind: "strategy", title: t("Zwykła strategia") })).json();
      expect((await zmien(n.id, { bodyMd: "ok" }, "1")).status).toBe(200);
    });
  });

  it("walidacja po stronie serwera: nieznane pole, zły kind, pusty tytuł", async () => {
    expect((await utworz({ kind: "concept", title: t("ok"), nieznane: 1 })).status).toBe(400);
    expect((await utworz({ kind: "nie-ma", title: t("ok") })).status).toBe(400);
    const pusty = await utworz({ kind: "concept", title: "" });
    expect(pusty.status).toBe(400);
    expect((await pusty.json()).errors[0]).toContain("pole title");
  });

  it("token tylko do odczytu nie zapisze notatki (403), ale ją odczyta", async () => {
    expect((await utworz({ kind: "concept", title: t("Zakazana") }, ro.token)).status).toBe(403);
    const n = await (await utworz({ kind: "concept", title: t("Odczyt") })).json();
    expect((await pobierz(n.id, ro.token)).status).toBe(200);
  });
});
