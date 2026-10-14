import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

import { wygenerujToken } from "../token";

/**
 * Pomocnik testow API v2 na PRAWDZIWEJ, lokalnej bazie. Testy z tym pomocnikiem
 * uruchamiaja sie tylko wtedy, gdy DATABASE_URL wskazuje baze na tym komputerze
 * (127.0.0.1 / localhost / ::1) o nazwie zaczynajacej sie od `tj_`; bez tego sa
 * POMINIETE (i raport musi to powiedziec), a produkcji nie dotykaja nigdy.
 */

export const URL_BAZY = process.env.DATABASE_URL ?? "";

export function lokalnaBazaTestowa(url: string): boolean {
  try {
    const u = new URL(url);
    const hostOk = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(u.hostname);
    const baza = decodeURIComponent(u.pathname.replace(/^\//, ""));
    return hostOk && /^tj_[a-z0-9_]+$/.test(baza);
  } catch {
    return false;
  }
}

export const MOZNA_NA_BAZIE = lokalnaBazaTestowa(URL_BAZY);

export type Sql = postgres.Sql;

export function polacz(): Sql {
  if (!MOZNA_NA_BAZIE) throw new Error("DATABASE_URL nie wskazuje lokalnej bazy testowej tj_*; test na bazie nie moze ruszyc.");
  return postgres(URL_BAZY, { max: 4, onnotice: () => {} });
}

let licznikIp = 0;
/** Unikalny adres klienta na test: blokady i limity sa po adresie, wiec testy nie moga go dzielic. */
export function unikalnyIp(): string {
  licznikIp += 1;
  return `198.51.${Math.floor(licznikIp / 250) % 250}.${(licznikIp % 250) + 1}`;
}

export type OpcjeZapytania = {
  metoda?: string;
  token?: string;
  cialo?: unknown;
  /** Surowe bajty ciala (omija JSON.stringify) - do testow bajt w bajt. */
  surowe?: string | Uint8Array;
  naglowki?: Record<string, string>;
  ip?: string;
  baza?: string;
};

export function zadanie(sciezka: string, o: OpcjeZapytania = {}): Request {
  const metoda = o.metoda ?? "GET";
  const h = new Headers(o.naglowki);
  if (o.token) h.set("authorization", `Bearer ${o.token}`);
  if (!h.has("x-forwarded-for")) h.set("x-forwarded-for", o.ip ?? unikalnyIp());
  let body: string | Uint8Array | undefined;
  if (o.surowe !== undefined) {
    body = o.surowe;
  } else if (o.cialo !== undefined) {
    body = JSON.stringify(o.cialo);
    if (!h.has("content-type")) h.set("content-type", "application/json");
  }
  return new Request(`${o.baza ?? "http://localhost/api/v2"}${sciezka}`, {
    method: metoda,
    headers: h,
    body: metoda === "GET" || metoda === "HEAD" ? undefined : (body as BodyInit | undefined),
  });
}

export type Par = { id: number; token: string; prefix: string };

/** Token wpisany prosto do bazy (z pominieciem device flow), ze wskazanymi zakresami. */
export async function nowyToken(
  sql: Sql,
  scopes: string[],
  opcje: { name?: string; expiresAt?: Date | null; revokedAt?: Date | null } = {},
): Promise<Par> {
  const t = wygenerujToken();
  const [w] = await sql`
    insert into api_tokens (name, prefix, token_sha256, scopes, created_via, expires_at, revoked_at)
    values (${opcje.name ?? `test-${randomBytes(3).toString("hex")}`}, ${t.prefix}, ${t.sha256}, ${scopes}, 'device_code',
            ${opcje.expiresAt ?? null}, ${opcje.revokedAt ?? null})
    returning id`;
  return { id: w.id, token: t.token, prefix: t.prefix };
}

export const sha256Hex = (b: Buffer | string) =>
  createHash("sha256").update(typeof b === "string" ? Buffer.from(b, "utf8") : b).digest("hex");

/** Kontekst Next dla tras z segmentem dynamicznym. */
export const parametry = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** Minimum, bez ktorego trasy nie ruszą: wiersz ustawien i instrument NQ. */
export async function zapewnijPodstawy(sql: Sql): Promise<{ instrumentId: number }> {
  await sql`insert into settings (id) values (1) on conflict (id) do nothing`;
  const [i] = await sql`select id from instruments where symbol = 'NQ' limit 1`;
  if (i) return { instrumentId: i.id };
  const [n] = await sql`
    insert into instruments (symbol, name, exchange, tick_size, tick_value, sort_order)
    values ('NQ', 'E-mini Nasdaq 100', 'CME', 0.25, 5000, 1) returning id`;
  return { instrumentId: n.id };
}

/**
 * Sprzata wszystko, co stworzyly podane tokeny, w kolejnosci zaleznosci
 * (reguly RESTRICT na notatkach, tokeny NO ACTION w tabelach niezmiennych).
 */
export async function sprzatnijPoTokenach(sql: Sql, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`delete from rule_versions where created_by_token_id = any(${ids})`;
  await sql`delete from rules where note_id in (select id from notes where created_by_token_id = any(${ids}))`;
  await sql`delete from hypotheses where note_id in (select id from notes where created_by_token_id = any(${ids}))`;
  await sql`delete from user_words where created_by_token_id = any(${ids})`;
  await sql`delete from notes where created_by_token_id = any(${ids})`;
  await sql`delete from auth_events where token_id = any(${ids})`;
  await sql`delete from device_codes where token_id = any(${ids})`;
  await sql`delete from api_tokens where id = any(${ids})`;
}
