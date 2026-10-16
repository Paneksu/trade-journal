import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authBackupCodes, authEvents, settings } from "@/lib/db/schema";
import {
  liczbaWolnychKodow,
  ostatnieZdarzenia,
  sprawdzDrugiSkladnik,
  wlaczTotp,
  wygenerujKodyZapasowe,
  wylaczTotp,
  zapiszZdarzenie,
} from "./second-factor";
import {
  kodTotp,
  numerKroku,
  nowySekretBase32,
  odszyfrujSekret,
  zaszyfrujSekret,
} from "./totp";

/*
 * 2FA na PRAWDZIWEJ lokalnej bazie (ADR-031): zuzycie kroku TOTP, kody zapasowe,
 * wyscig dwoch rownoleglych zapytan, trigger tylko-do-dopisywania i zgodnosc
 * schema.ts z migracja 0016. Pomijany, gdy DATABASE_URL nie jest lokalny.
 * Uruchom: npm run test:local
 */

const URL_BAZY = process.env.DATABASE_URL ?? "";
function lokalna(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

describe.skipIf(!lokalna(URL_BAZY))("2FA w bazie", () => {
  const sql = postgres(URL_BAZY, { max: 2 });
  let sekret = "";
  const T = Date.UTC(2030, 0, 1, 12, 0, 0);
  let wersjaPrzed = 0;

  beforeAll(async () => {
    process.env.TOTP_ENC_KEY ??= Buffer.alloc(32, 5).toString("base64url");
    process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123456";
    await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
    // Stan wyjsciowy: 2FA wylaczone, bez kodow.
    await sql`update settings set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = 1`;
    await sql`delete from auth_backup_codes`;
    const [w] = await sql`select session_version from settings where id = 1`;
    wersjaPrzed = w.session_version;
    sekret = nowySekretBase32();
  });

  afterAll(async () => {
    await sql`update settings set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = 1`;
    await sql`delete from auth_backup_codes`;
    await sql`delete from auth_events where detail->>'test' = 'tak'`;
    await sql.end();
  });

  it("wlaczenie zapisuje sekret zaszyfrowany (nie jawny), podbija wersje sesji i tworzy 10 kodow", async () => {
    const wynik = await wlaczTotp(zaszyfrujSekret(sekret), numerKroku(T));
    expect(wynik).not.toBeNull();
    expect(wynik!.wersja).toBe(wersjaPrzed + 1);
    expect(wynik!.kody).toHaveLength(10);

    const [w] = await sql`select totp_secret_enc, totp_enabled_at, totp_last_step from settings where id = 1`;
    expect(w.totp_secret_enc).not.toContain(sekret);
    expect(odszyfrujSekret(w.totp_secret_enc)).toBe(sekret);
    expect(w.totp_enabled_at).toBeInstanceOf(Date);
    expect(Number(w.totp_last_step)).toBe(numerKroku(T));

    const wiersze = await sql`select code_hmac, batch, used_at from auth_backup_codes`;
    expect(wiersze).toHaveLength(10);
    for (const r of wiersze) {
      expect(r.code_hmac).toMatch(/^[0-9a-f]{64}$/);
      // W bazie nie ma zadnego jawnego kodu.
      expect(wynik!.kody.some((k) => r.code_hmac.includes(k))).toBe(false);
    }
    expect(await liczbaWolnychKodow()).toBe(10);
  });

  it("drugie wlaczenie nie nadpisuje sekretu po cichu", async () => {
    const [przed] = await sql`select totp_secret_enc from settings where id = 1`;
    expect(await wlaczTotp(zaszyfrujSekret("INNY"), 1)).toBeNull();
    const [po] = await sql`select totp_secret_enc from settings where id = 1`;
    expect(po.totp_secret_enc).toBe(przed.totp_secret_enc);
  });

  it("kod z kroku juz uzytego (wlasnie potwierdzonego przy wlaczaniu) to powtorka", async () => {
    expect(await sprawdzDrugiSkladnik(kodTotp(sekret, T), T)).toEqual({ ok: false, powod: "powtorka" });
  });

  it("kod z nastepnego kroku przechodzi raz, drugi raz to powtorka, starszy krok tez", async () => {
    const t2 = T + 30_000;
    const kod = kodTotp(sekret, t2);
    expect(await sprawdzDrugiSkladnik(kod, t2)).toEqual({ ok: true, rodzaj: "totp" });
    expect(await sprawdzDrugiSkladnik(kod, t2)).toEqual({ ok: false, powod: "powtorka" });
    // Kod z kroku wczesniejszego niz ostatnio przyjety (jeszcze w oknie +-1) tez jest odrzucony.
    expect(await sprawdzDrugiSkladnik(kodTotp(sekret, T), t2)).toEqual({ ok: false, powod: "powtorka" });
  });

  it("zly kod to zly_kod, a spacja w srodku nie przeszkadza", async () => {
    const t3 = T + 60_000;
    expect(await sprawdzDrugiSkladnik("000000", t3)).toEqual({ ok: false, powod: "zly_kod" });
    expect(await sprawdzDrugiSkladnik("12345", t3)).toEqual({ ok: false, powod: "zly_kod" });
    expect(await sprawdzDrugiSkladnik("", t3)).toEqual({ ok: false, powod: "zly_kod" });
    const kod = kodTotp(sekret, t3);
    expect(await sprawdzDrugiSkladnik(`${kod.slice(0, 3)} ${kod.slice(3)}`, t3)).toEqual({
      ok: true,
      rodzaj: "totp",
    });
  });

  it("dwa rownolegle zapytania z tym samym kodem: przechodzi dokladnie jedno", async () => {
    const t4 = T + 120_000;
    const kod = kodTotp(sekret, t4);
    const wyniki = await Promise.all([
      sprawdzDrugiSkladnik(kod, t4),
      sprawdzDrugiSkladnik(kod, t4),
      sprawdzDrugiSkladnik(kod, t4),
    ]);
    expect(wyniki.filter((w) => w.ok)).toHaveLength(1);
    expect(wyniki.filter((w) => !w.ok && w.powod === "powtorka")).toHaveLength(2);
  });

  it("kod zapasowy dziala raz; male litery i myslnik sa dozwolone", async () => {
    const nowa = await wygenerujKodyZapasowe();
    const kod = nowa[0];
    const wpisany = `${kod.slice(0, 5)}-${kod.slice(5)}`.toLowerCase();
    expect(await sprawdzDrugiSkladnik(wpisany)).toEqual({ ok: true, rodzaj: "backup" });
    expect(await sprawdzDrugiSkladnik(kod)).toEqual({ ok: false, powod: "zly_kod" });
    expect(await liczbaWolnychKodow()).toBe(9);
    // Inny, niewykorzystany kod nadal dziala.
    expect(await sprawdzDrugiSkladnik(nowa[1])).toEqual({ ok: true, rodzaj: "backup" });
    expect(await liczbaWolnychKodow()).toBe(8);
  });

  it("kod zapasowy zuzywa sie raz takze przy rownoleglych zapytaniach", async () => {
    const kody = await wygenerujKodyZapasowe();
    const wyniki = await Promise.all([
      sprawdzDrugiSkladnik(kody[2]),
      sprawdzDrugiSkladnik(kody[2]),
      sprawdzDrugiSkladnik(kody[2]),
    ]);
    expect(wyniki.filter((w) => w.ok)).toHaveLength(1);
  });

  it("nowa paczka uniewaznia stara i zostaje dokladnie 10 kodow", async () => {
    const stare = await wygenerujKodyZapasowe();
    const nowe = await wygenerujKodyZapasowe();
    expect(await sprawdzDrugiSkladnik(stare[0])).toEqual({ ok: false, powod: "zly_kod" });
    expect(await sprawdzDrugiSkladnik(nowe[0])).toEqual({ ok: true, rodzaj: "backup" });
    const [{ n }] = await sql`select count(*)::int as n from auth_backup_codes`;
    expect(n).toBe(10);
    const [{ batche }] = await sql`select count(distinct batch)::int as batche from auth_backup_codes`;
    expect(batche).toBe(1);
  });

  it("kod bledny w formie (zla dlugosc, znaki spoza alfabetu) to zly_kod, nie wyjatek", async () => {
    for (const zly of ["ABCDEFGHJ", "ABCDEFGHJKL", "ABCDEFGHJ0", "!!!!!!!!!!", "1234567"]) {
      expect(await sprawdzDrugiSkladnik(zly)).toEqual({ ok: false, powod: "zly_kod" });
    }
  });

  it("zly TOTP_ENC_KEY to wyjatek z nazwa zmiennej, a nie ciche 'zly kod'", async () => {
    const klucz = process.env.TOTP_ENC_KEY;
    process.env.TOTP_ENC_KEY = Buffer.alloc(32, 99).toString("base64url");
    try {
      await expect(sprawdzDrugiSkladnik("123456", T + 300_000)).rejects.toThrow(/TOTP_ENC_KEY/);
    } finally {
      process.env.TOTP_ENC_KEY = klucz;
    }
  });

  it("wylaczenie czyści sekret, krok i kody oraz podbija wersje sesji; drugie wylaczenie to null", async () => {
    const [przed] = await sql`select session_version from settings where id = 1`;
    const wersja = await wylaczTotp();
    expect(wersja).toBe(przed.session_version + 1);
    const [w] = await sql`select totp_secret_enc, totp_enabled_at, totp_last_step from settings where id = 1`;
    expect(w).toEqual({ totp_secret_enc: null, totp_enabled_at: null, totp_last_step: null });
    expect(await liczbaWolnychKodow()).toBe(0);
    expect(await wylaczTotp()).toBeNull();
    expect(await sprawdzDrugiSkladnik("123456")).toEqual({ ok: false, powod: "brak_2fa" });
  });

  it("CHECK: sekret bez daty wlaczenia (i odwrotnie) oraz krok bez sekretu sa odrzucane przez baze", async () => {
    await expect(sql`update settings set totp_secret_enc = 'x' where id = 1`).rejects.toThrow(/settings_totp_zgodne/);
    await expect(sql`update settings set totp_enabled_at = now() where id = 1`).rejects.toThrow(/settings_totp_zgodne/);
    await expect(sql`update settings set totp_last_step = 5 where id = 1`).rejects.toThrow(/settings_totp_krok/);
  });

  it("CHECK: kod zapasowy musi byc 64-znakowym HMAC hex i jest unikalny", async () => {
    await expect(sql`insert into auth_backup_codes (code_hmac, batch) values ('jawny-kod', 1)`).rejects.toThrow(/hmac_format/);
    const h = "a".repeat(64);
    await sql`insert into auth_backup_codes (code_hmac, batch) values (${h}, 1)`;
    await expect(sql`insert into auth_backup_codes (code_hmac, batch) values (${h}, 2)`).rejects.toThrow(/unique/);
    await sql`delete from auth_backup_codes`;
  });
});

describe.skipIf(!lokalna(URL_BAZY))("2FA bez TOTP_ENC_KEY: klucz z SESSION_SECRET (ADR-031)", () => {
  const sql = postgres(URL_BAZY, { max: 2 });
  const T = Date.UTC(2031, 0, 1, 12, 0, 0);
  const sekret = nowySekretBase32();
  let staryKlucz: string | undefined;
  let staraSesja: string | undefined;

  beforeAll(async () => {
    staryKlucz = process.env.TOTP_ENC_KEY;
    staraSesja = process.env.SESSION_SECRET;
    delete process.env.TOTP_ENC_KEY;
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123456";
    await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
    await sql`update settings set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = 1`;
    await sql`delete from auth_backup_codes`;
  });

  afterAll(async () => {
    await sql`update settings set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = 1`;
    await sql`delete from auth_backup_codes`;
    if (staryKlucz === undefined) delete process.env.TOTP_ENC_KEY;
    else process.env.TOTP_ENC_KEY = staryKlucz;
    if (staraSesja === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = staraSesja;
    await sql.end();
  });

  it("wlaczenie, kod TOTP i kod zapasowy dzialaja bez zmiennej TOTP_ENC_KEY", async () => {
    expect(process.env.TOTP_ENC_KEY).toBeUndefined();
    const wynik = await wlaczTotp(zaszyfrujSekret(sekret), numerKroku(T));
    expect(wynik).not.toBeNull();
    const [w] = await sql`select totp_secret_enc from settings where id = 1`;
    expect(odszyfrujSekret(w.totp_secret_enc)).toBe(sekret);

    const t2 = T + 30_000;
    expect(await sprawdzDrugiSkladnik(kodTotp(sekret, t2), t2)).toEqual({ ok: true, rodzaj: "totp" });
    expect(await sprawdzDrugiSkladnik(wynik!.kody[0], t2 + 30_000)).toEqual({ ok: true, rodzaj: "backup" });
  });

  it("zmiana SESSION_SECRET unieważnia 2FA: wyjatek z nazwa zmiennej, a nie ciche 'zly kod'", async () => {
    process.env.SESSION_SECRET = "inny-secret-inny-secret-inny-secret-654321";
    await expect(sprawdzDrugiSkladnik("123456", T + 300_000)).rejects.toThrow(/SESSION_SECRET/);
  });
});

describe.skipIf(!lokalna(URL_BAZY))("dziennik zdarzen bezpieczenstwa", () => {
  const sql = postgres(URL_BAZY, { max: 2 });
  afterAll(async () => {
    await sql`delete from auth_events where detail->>'test' = 'tak'`;
    await sql.end();
  });

  it("zapisuje zdarzenie z adresem i przegladarka, a UA jest przyciete do 300 znakow", async () => {
    await zapiszZdarzenie("login_ok", { ip: "10.9.9.9", userAgent: "U".repeat(1000), detail: { test: "tak" } });
    const [z] = await ostatnieZdarzenia(1);
    expect(z.kind).toBe("login_ok");
    expect(z.ip).toBe("10.9.9.9");
    expect(z.userAgent).toHaveLength(300);
  });

  it("UPDATE zdarzenia jest odrzucany przez baze kodem TJ409 (tylko dopisywanie)", async () => {
    await zapiszZdarzenie("sudo", { detail: { test: "tak" } });
    const wynik = await sql`update auth_events set kind = 'login_ok' where detail->>'test' = 'tak'`.then(
      () => null,
      (e: { code?: string; message?: string }) => e,
    );
    expect(wynik?.code).toBe("TJ409");
    expect(wynik?.message).toMatch(/tylko do dopisywania/);
  });

  it("nieznany rodzaj zdarzenia odrzuca CHECK, a zapiszZdarzenie nie przerywa logowania", async () => {
    await expect(sql`insert into auth_events (kind) values ('cos_innego')`).rejects.toThrow(/auth_events_kind/);
    const przed = (await ostatnieZdarzenia(1))[0]?.id;
    await expect(
      zapiszZdarzenie("cos_innego" as never, { detail: { test: "tak" } }),
    ).resolves.toBeUndefined();
    expect((await ostatnieZdarzenia(1))[0]?.id).toBe(przed);
  });
});

describe.skipIf(!lokalna(URL_BAZY))("schema.ts zgodna z migracja 0016", () => {
  const sql = postgres(URL_BAZY, { max: 1 });
  afterAll(async () => {
    await sql.end();
  });

  const TYPY: Record<string, string> = {
    PgText: "text",
    PgInteger: "integer",
    PgSerial: "integer",
    PgBigInt53: "bigint",
    PgTimestamp: "timestamp with time zone",
    PgJsonb: "jsonb",
  };

  /** schema.ts trzyma nazwy camelCase; snake_case dopiero przy zapytaniu (casing w db/index.ts). */
  const snake = (n: string) => n.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

  it.each([
    ["settings (kolumny TOTP)", settings, ["totp_secret_enc", "totp_enabled_at", "totp_last_step"]],
    ["auth_backup_codes", authBackupCodes, null],
    ["auth_events", authEvents, null],
  ] as [string, PgTable, string[] | null][])("%s: kolumny, typy i NOT NULL", async (_nazwa, tabela, tylko) => {
    const cfg = getTableConfig(tabela);
    const wBazie = await sql`
      select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = ${cfg.name}`;
    const mapa = new Map(wBazie.map((k) => [k.column_name as string, k]));
    const kolumny = cfg.columns.filter((k) => !tylko || tylko.includes(snake(k.name)));
    expect(kolumny.length).toBeGreaterThan(0);
    for (const k of kolumny) {
      const w = mapa.get(snake(k.name));
      expect(w, `kolumny ${cfg.name}.${snake(k.name)} nie ma w bazie`).toBeDefined();
      expect(w!.data_type, `typ ${cfg.name}.${k.name}`).toBe(TYPY[k.columnType] ?? k.getSQLType());
      expect(w!.is_nullable === "NO", `NOT NULL ${cfg.name}.${k.name}`).toBe(k.notNull);
    }
    if (!tylko) expect(mapa.size).toBe(cfg.columns.length);
  });

  it("nazwy CHECK-ow i indeksow z schema.ts istnieja w bazie", async () => {
    for (const tabela of [settings, authBackupCodes, authEvents]) {
      const cfg = getTableConfig(tabela);
      for (const c of cfg.checks) {
        const [w] = await sql`select 1 as ok from pg_constraint where conname = ${c.name}`;
        expect(w, `CHECK ${c.name}`).toBeDefined();
      }
      for (const i of cfg.indexes) {
        const nazwa = i.config.name ?? "";
        const [w] = await sql`select 1 as ok from pg_indexes where indexname = ${nazwa}`;
        expect(w, `indeks ${nazwa}`).toBeDefined();
      }
    }
  });

  it("CHECK-i ze schema.ts renderuja sie do jednej linii SQL, a regex kodu zapasowego zgadza sie z baza", async () => {
    const dialekt = new PgDialect();
    for (const tabela of [settings, authBackupCodes, authEvents]) {
      for (const c of getTableConfig(tabela).checks) {
        const tekst = dialekt.sqlToQuery(c.value).sql;
        expect(tekst, `CHECK ${c.name} z schema.ts`).not.toMatch(/[\r\n]/);
      }
    }
    const hmac = getTableConfig(authBackupCodes).checks.find((c) => c.name === "auth_backup_codes_hmac_format")!;
    const zSchematu = dialekt.sqlToQuery(hmac.value).sql;
    const [def] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'auth_backup_codes_hmac_format'`;
    const wzor = "'^[0-9a-f]{64}$'";
    expect(zSchematu).toContain(wzor);
    expect(def.def).toContain(wzor);
  });

  it("CHECK rodzajow zdarzen w bazie dopuszcza dokladnie te wartosci, ktore zna AUTH_EVENT_KINDS", async () => {
    const { AUTH_EVENT_KINDS } = await import("@/lib/db/schema");
    for (const rodzaj of AUTH_EVENT_KINDS) {
      await sql`insert into auth_events (kind, detail) values (${rodzaj}, '{"test":"tak"}')`;
    }
    await sql`delete from auth_events where detail->>'test' = 'tak'`;
  });
});
