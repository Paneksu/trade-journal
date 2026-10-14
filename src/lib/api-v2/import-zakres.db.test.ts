import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { wyczyscLimiter } from "./limiter";
import { MOZNA_NA_BAZIE, nowyToken, polacz, sprzatnijPoTokenach, unikalnyIp, zadanie, zapewnijPodstawy, type Par, type Sql } from "./test/db-pomocnik";

vi.mock("server-only", () => ({}));

/*
 * Zakres `import` (Słowa użytkownika 15.10.2026: «Osobny zakres „import”»): tylko z nim wolno
 * zadeklarować origin `vault-import` (z nImported i vaultStatus) oraz `mentor`. Nadaje go wyłącznie
 * użytkownik ręcznie w UI (token importu, 24 h), NIGDY logowanie kodem urządzenia.
 */
describe.skipIf(!MOZNA_NA_BAZIE)("zakres import (baza lokalna)", () => {
  let sql: Sql;
  let write: Par; // read + write
  let propose: Par; // read + write + propose
  let imp: Par; // read + write + propose + import
  const znacznik = Date.now().toString(36);
  const t = (n: string) => `${n} ${znacznik}`;
  const DOWOD = { video: "yt1", t: 10, quote: "cytat" };
  const utworzoneUI: number[] = [];

  beforeAll(async () => {
    sql = polacz();
    await zapewnijPodstawy(sql);
    write = await nowyToken(sql, ["read", "write"]);
    propose = await nowyToken(sql, ["read", "write", "propose"]);
    imp = await nowyToken(sql, ["read", "write", "propose", "import"]);
  });
  afterAll(async () => {
    await sprzatnijPoTokenach(sql, [write.id, propose.id, imp.id, ...utworzoneUI]);
    await sql.end();
  });
  beforeEach(() => {
    wyczyscLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const notatka = async (cialo: Record<string, unknown>, token: string) => {
    const { POST } = await import("@/app/api/v2/notes/route");
    return POST(zadanie("/notes", { metoda: "POST", token, cialo }), undefined);
  };
  const regula = async (cialo: Record<string, unknown>, token: string) => {
    const { POST } = await import("@/app/api/v2/rules/proposals/route");
    return POST(zadanie("/rules/proposals", { metoda: "POST", token, cialo }), undefined);
  };
  const hipoteza = async (cialo: Record<string, unknown>, token: string) => {
    const { POST } = await import("@/app/api/v2/hypotheses/route");
    return POST(zadanie("/hypotheses", { metoda: "POST", token, cialo }), undefined);
  };
  async function odmowa403(res: Response) {
    expect(res.status, await res.clone().text()).toBe(403);
    const d = await res.json();
    expect(d.code).toBe("insufficient_scope");
    expect(d.missingScope).toBe("import");
    expect(d.error).toContain("token importu");
    return d;
  }

  describe("notatki", () => {
    it("write bez import: origin mentor i vault-import = 403 z nazwą zakresu import; nic nie zapisano", async () => {
      for (const origin of ["mentor", "vault-import"]) {
        const d = await odmowa403(await notatka({ kind: "concept", title: t(`Notatka ${origin}`), origin }, write.token));
        expect(d.origin).toBe(origin);
      }
      const [{ ile }] = await sql`select count(*)::int as ile from notes where title like ${`Notatka %${znacznik}`}`;
      expect(ile).toBe(0);
    });

    it("vault-import z kluczem vault: też wymaga import (deklaracja, nie skutek)", async () => {
      await odmowa403(await notatka({ kind: "concept", title: t("Z sejfu"), origin: "vault-import", externalRef: `vault:Pojecia/${znacznik}.md` }, propose.token));
    });

    it("write bez import: origin ai (domyślny) przechodzi", async () => {
      expect((await notatka({ kind: "concept", title: t("Zwykła AI") }, write.token)).status).toBe(201);
      expect((await notatka({ kind: "concept", title: t("Jawnie AI"), origin: "ai" }, write.token)).status).toBe(201);
    });

    it("z zakresem import: mentor i vault-import = 201", async () => {
      expect((await notatka({ kind: "concept", title: t("Mentor OK"), origin: "mentor" }, imp.token)).status).toBe(201);
      const res = await notatka({ kind: "concept", title: t("Sejf OK"), origin: "vault-import", externalRef: `vault:Pojecia/ok-${znacznik}.md` }, imp.token);
      expect(res.status).toBe(201);
      expect((await res.json()).origin).toBe("vault-import");
    });
  });

  describe("propozycje reguł", () => {
    it("propose bez import: mentor i vault-import = 403; ai nadal działa (z hipotezą powyżej progu)", async () => {
      await odmowa403(await regula({ title: t("Mentor bez importu"), textMd: "x", origin: "mentor", evidence: DOWOD }, propose.token));
      await odmowa403(await regula({ title: t("Sejf bez importu"), textMd: "x", origin: "vault-import", externalRef: `vault:Reguly/${znacznik}-a.md`, vaultStatus: "zatwierdzona" }, propose.token));
      const [{ ile }] = await sql`select count(*)::int as ile from notes where title in (${t("Mentor bez importu")}, ${t("Sejf bez importu")})`;
      expect(ile).toBe(0);
    });

    it("z zakresem import: mentor i vault-import = 201", async () => {
      const m = await regula({ title: t("Mentor z importem"), textMd: "x", origin: "mentor", evidence: DOWOD }, imp.token);
      expect(m.status).toBe(201);
      expect((await m.json()).signature).toBe("wg mentora, n = 0");
      const v = await regula({ title: t("Sejf z importem"), textMd: "x", origin: "vault-import", externalRef: `vault:Reguly/${znacznik}-b.md`, vaultStatus: "zatwierdzona" }, imp.token);
      expect(v.status).toBe(201);
    });
  });

  describe("hipotezy", () => {
    it("nImported i vaultStatus idą tylko z tokenem import: write/propose = 403, import = 201", async () => {
      const cialo = { title: t("H z sejfu"), nImported: 40, origin: "vault-import", externalRef: `vault:Hipotezy/${znacznik}.md` };
      await odmowa403(await hipoteza(cialo, write.token));
      await odmowa403(await hipoteza(cialo, propose.token));
      const ok = await hipoteza(cialo, imp.token);
      expect(ok.status).toBe(201);
      const [h] = await sql`select n_imported from hypotheses where id = ${(await ok.json()).id}`;
      expect(h.n_imported).toBe(40);
    });

    it("hipoteza bez deklarowanego pochodzenia ‘import’ przechodzi z samym write", async () => {
      expect((await hipoteza({ title: t("H zwykła") }, write.token)).status).toBe(201);
    });
  });

  describe("logowanie urządzenia nigdy nie daje import", () => {
    const start = async (scopes: unknown) => {
      const { POST } = await import("@/app/api/v2/device/start/route");
      return POST(zadanie("/device/start", { metoda: "POST", cialo: { clientName: t("próba importu"), scopes }, ip: unikalnyIp() }), undefined);
    };

    it("device/start z zakresem import (samym albo razem z innymi) = 400 z wyjaśnieniem; w bazie nic nie ma", async () => {
      for (const scopes of [["import"], ["read", "import"], ["read", "write", "propose", "import"]]) {
        const res = await start(scopes);
        expect(res.status, JSON.stringify(scopes)).toBe(400);
        const d = await res.json();
        expect(d.errors.join(" ")).toContain("import");
        expect(d.errors.join(" ")).toContain("token importu");
      }
      const [{ ile }] = await sql`select count(*)::int as ile from device_codes where client_name = ${t("próba importu")}`;
      expect(ile).toBe(0);
    });

    it("zwykłe zakresy urządzenia nadal działają", async () => {
      const res = await start(["read", "write", "propose"]);
      expect(res.status).toBe(200);
      await sql`delete from device_codes where client_name = ${t("próba importu")}`;
    });

    it("zatwierdzenie w aplikacji nie nada import, nawet gdyby ktoś wstawił je do żądania", async () => {
      const urz = await import("./urzadzenia");
      await sql`delete from device_codes where user_code in ('CCCC-DDDD', 'CCCC-FFFF') or client_name = ${t("obejście")}`;
      await expect(
        sql`insert into device_codes (device_code_sha256, user_code, client_name, requested_scopes, expires_at)
            values (${"c".repeat(64)}, 'CCCC-DDDD', ${t("obejście")}, ${["read", "import"]}, now() + interval '10 minutes')`,
      ).rejects.toMatchObject({ code: "23514" }); // CHECK w bazie
      await sql`insert into device_codes (device_code_sha256, user_code, client_name, requested_scopes, expires_at)
                values (${"d".repeat(64)}, 'CCCC-FFFF', ${t("obejście")}, ${["read"]}, now() + interval '10 minutes')`;
      const [k] = await sql`select id from device_codes where user_code = 'CCCC-FFFF'`;
      const w = await urz.zatwierdzKod(k.id, ["read", "import"]);
      expect(w.ok).toBe(false);
      await sql`delete from device_codes where client_name = ${t("obejście")}`;
    });
  });

  describe("token importu z UI", () => {
    it("tworzy token z zakresem import, ważny 24 h, created_via ui; jawny token tylko w odpowiedzi", async () => {
      const urz = await import("./urzadzenia");
      const teraz = new Date();
      const tok = await urz.utworzTokenImportu(teraz);
      utworzoneUI.push(tok.id);
      expect(tok.token).toMatch(/^tj_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
      expect(tok.expiresAt.getTime() - teraz.getTime()).toBe(24 * 3600 * 1000);

      const [w] = await sql`select scopes, created_via, expires_at, token_sha256, name from api_tokens where id = ${tok.id}`;
      expect(w.scopes).toEqual(["read", "write", "propose", "import"]);
      expect(w.created_via).toBe("ui");
      expect(w.token_sha256).not.toContain(tok.token);
      expect(JSON.stringify(w)).not.toContain(tok.token);

      // token działa w API i pozwala na pochodzenie mentor
      const res = await notatka({ kind: "concept", title: t("Notatka z tokenu UI"), origin: "mentor" }, tok.token);
      expect(res.status).toBe(201);
    });

    it("token importu wygasa po 24 h (401 token_expired)", async () => {
      const urz = await import("./urzadzenia");
      const tok = await urz.utworzTokenImportu(new Date(Date.now() - 25 * 3600 * 1000));
      utworzoneUI.push(tok.id);
      const { GET } = await import("@/app/api/v2/meta/route");
      const res = await GET(zadanie("/meta", { token: tok.token }), undefined);
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("token_expired");
    });

    it("lista urządzeń pokazuje token importu bez jawnego tokenu, a ekran ma osobny przycisk", async () => {
      const urz = await import("./urzadzenia");
      const tok = await urz.utworzTokenImportu();
      utworzoneUI.push(tok.id);
      const lista = await urz.listaTokenow();
      const wiersz = lista.find((x) => x.id === tok.id)!;
      expect(wiersz.scopes).toContain("import");
      expect(JSON.stringify(lista)).not.toContain(tok.token);
      const strona = readFileSync(path.resolve(__dirname, "../../app/(app)/settings/devices/page.tsx"), "utf8");
      expect(strona).toContain("TokenImportuPrzycisk");
      const komponent = readFileSync(path.resolve(__dirname, "../../components/settings/devices.tsx"), "utf8");
      expect(komponent).toContain("Utwórz token importu (24 h)");
      expect(komponent).toContain("Nie pokażę go drugi raz");
    });

    it("dostępne przez device flow jest wyłącznie trasa start/token, a utworzTokenImportu nie jest wołane z żadnej trasy API", () => {
      const korzen = path.resolve(__dirname, "../../app/api");
      const sprawdz = (katalog: string): string[] => {
        return readdirSync(katalog).flatMap((n: string) => {
          const p = path.join(katalog, n);
          return statSync(p).isDirectory() ? sprawdz(p) : /utworzTokenImportu/.test(readFileSync(p, "utf8")) ? [p] : [];
        });
      };
      expect(sprawdz(korzen)).toEqual([]);
    });
  });
});
