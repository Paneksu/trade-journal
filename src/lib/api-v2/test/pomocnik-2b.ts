import { expect } from "vitest";

import { ENDPOINTS } from "../contract/endpoints";
import { skrotTekstu } from "../skrot";
import { zadanie, type Sql } from "./db-pomocnik";

/**
 * Pomocniki testow funkcji MUST (faza 2b) na prawdziwej, lokalnej bazie. Testy wolaja handlery tras
 * bezposrednio (jak reszta testow v2); dowodem zapisu jest odczyt z bazy, a ksztalt odpowiedzi
 * sprawdza schemat z kontraktu - ten sam, z ktorego powstaje docs/openapi-v2.json.
 */

type Metoda = "get" | "post" | "put" | "patch";

/** Odpowiedz musi pasowac do schematu z rejestru ENDPOINTS (kontrakt nie moze klamac). */
export function zgodneZKontraktem(metoda: Metoda, sciezka: string, json: unknown): void {
  const e = ENDPOINTS.find((x) => x.metoda === metoda && x.sciezka === sciezka);
  expect(e, `brak wpisu w ENDPOINTS: ${metoda} ${sciezka}`).toBeDefined();
  expect(e!.odpowiedz, `brak schematu odpowiedzi: ${metoda} ${sciezka}`).toBeDefined();
  const w = e!.odpowiedz!.safeParse(json);
  if (!w.success) {
    const opis = w.error.issues.slice(0, 8).map((i) => `  ${i.path.join(".") || "(korzen)"}: ${i.message}`).join("\n");
    throw new Error(`Odpowiedz ${metoda.toUpperCase()} ${sciezka} nie zgadza sie z kontraktem OpenAPI:\n${opis}\nOdpowiedz: ${JSON.stringify(json).slice(0, 600)}`);
  }
}

export type Odpowiedz = { status: number; json: any };

async function czytaj(res: Response): Promise<Odpowiedz> {
  const tekst = await res.text();
  let json: unknown = null;
  try {
    json = tekst === "" ? null : JSON.parse(tekst);
  } catch {
    json = tekst;
  }
  return { status: res.status, json };
}

type Opcje = { token: string; cialo?: unknown; naglowki?: Record<string, string>; ip?: string };

/** Wola handler trasy: `modul` to import("@/app/api/v2/.../route"), `ctx` to parametry dynamicznego segmentu. */
export async function wywolaj(
  modul: Promise<Record<string, unknown>>,
  metoda: "GET" | "POST" | "PUT" | "PATCH",
  sciezka: string,
  o: Opcje,
  ctx?: { params: Promise<Record<string, string>> },
): Promise<Odpowiedz> {
  const m = (await modul) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
  const handler = m[metoda];
  if (!handler) throw new Error(`Trasa nie eksportuje ${metoda}`);
  return czytaj(await handler(zadanie(sciezka, { metoda, token: o.token, cialo: o.cialo, naglowki: o.naglowki, ip: o.ip }), ctx));
}

export async function wywolajMultipart(
  modul: Promise<Record<string, unknown>>,
  sciezka: string,
  token: string,
  form: FormData,
  ctx?: { params: Promise<Record<string, string>> },
): Promise<Odpowiedz> {
  const m = (await modul) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
  const h = new Headers({ authorization: `Bearer ${token}`, "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}` });
  const req = new Request(`http://localhost/api/v2${sciezka}`, { method: "POST", headers: h, body: form });
  return czytaj(await m.POST(req, ctx));
}

/** Slowa uzytkownika zapisane przez prawdziwa trase (z sha256 policzonym tak jak u klienta). */
export async function zapiszSlowa(
  token: string,
  tekst: string,
  nadpisz: Record<string, unknown> = {},
): Promise<{ id: number; sha256: string }> {
  const r = await wywolaj(import("@/app/api/v2/user-words/route"), "POST", "/user-words", {
    token,
    cialo: { text: tekst, sha256: skrotTekstu(tekst), source: "chat", capturedAt: new Date().toISOString(), ...nadpisz },
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`Zapis slow nie przeszedl (${r.status}): ${JSON.stringify(r.json)}`);
  return { id: r.json.id, sha256: r.json.sha256 };
}

export const PARAMS = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

let seq = 0;
export const unikat = (prefiks: string) => `${prefiks}-${Date.now().toString(36)}-${++seq}`;

export type KontoTest = { kontoId: number; instrumentId: number };

/** Trade wstawiony SQL-em (z policzonym wynikiem), zeby test nie zalezal od trasy POST /trades. */
export async function wstawTrade(
  sql: Sql,
  o: {
    kontoId: number;
    instrumentId: number;
    dzien: string;
    status?: "open" | "closed";
    kierunek?: "long" | "short";
    wejscie?: number;
    sl?: number | null;
    r?: number;
    sesjaId?: number | null;
    kontrakty?: number;
    godzinaUtc?: number;
    ref?: string;
    createdAt?: string;
  },
): Promise<number> {
  const status = o.status ?? "closed";
  const r = o.r ?? 1;
  const ryzyko = 40000;
  const wejscie = o.wejscie ?? 20000;
  const kierunek = o.kierunek ?? "long";
  const sl = o.sl === undefined ? (kierunek === "long" ? wejscie - 20 : wejscie + 20) : o.sl;
  const czas = `${o.dzien}T${String(o.godzinaUtc ?? 14).padStart(2, "0")}:35:00Z`;
  const [t] = await sql`
    insert into trades (account_id, instrument_id, backtest_session_id, direction, status, entry_time, entry_price, contracts,
                        stop_loss, exit_time, exit_price, pnl, risk_amount, r_multiple, trading_day, market_session, exit_count,
                        closed_contracts, source, external_ref, created_at)
    values (${o.kontoId}, ${o.instrumentId}, ${o.sesjaId ?? null}, ${kierunek}, ${status}, ${czas}, ${wejscie}, ${o.kontrakty ?? 2},
            ${sl}, ${status === "closed" ? czas : null}, ${status === "closed" ? wejscie + r * 20 : null},
            ${status === "closed" ? Math.round(r * ryzyko) : null}, ${ryzyko}, ${status === "closed" ? r : null}, ${o.dzien}, 'rth',
            ${status === "closed" ? 1 : 0}, ${status === "closed" ? (o.kontrakty ?? 2) : 0}, ${o.ref ? "tradingview" : "form"}, ${o.ref ?? null},
            ${o.createdAt ?? new Date().toISOString()})
    returning id`;
  return t.id as number;
}

/** Sprzatanie wierszy powiazanych z tokenami w nowych tabelach (kolejnosc: zaleznosci -> rodzice). */
export async function sprzatnijNowe(sql: Sql, tokenIds: number[]): Promise<void> {
  if (tokenIds.length === 0) return;
  await sql`delete from trade_reviews where kind = 'user_override' and created_by_token_id = any(${tokenIds})`;
  await sql`delete from trade_reviews where created_by_token_id = any(${tokenIds})`;
  await sql`delete from trade_plans where created_by_token_id = any(${tokenIds})`;
  await sql`delete from note_additions where suggestion_id in (select id from ai_suggestions where created_by_token_id = any(${tokenIds}))`;
  await sql`delete from ai_suggestions where created_by_token_id = any(${tokenIds})`;
  await sql`delete from setup_versions where created_by_token_id = any(${tokenIds})`;
  await sql`delete from setups where note_id in (select id from notes where created_by_token_id = any(${tokenIds}))`;
}
