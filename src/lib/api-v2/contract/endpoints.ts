import { createHash } from "node:crypto";
import { z } from "zod";

import type { Scope } from "../scopes";
import {
  KopertaTradowSchema,
  OcenaSchema,
  OminieciaSchema,
  REGEX_EXTERNAL_REF,
  SesjaSchema,
} from "./schemas";
import {
  BladOdpowiedz,
  DeviceStartOdpowiedz,
  DeviceStartSchema,
  DeviceTokenOdpowiedz,
  DeviceTokenSchema,
  DzienQuery,
  DzienZapisSchema,
  HipotezaUtworzSchema,
  InterpretacjaSchema,
  NotatkaOdpowiedz,
  NotatkaUtworzSchema,
  NotatkaZmienSchema,
  NotatkiListaQuery,
  PropozycjaReguly,
  ReguliListaQuery,
  SlowaListaQuery,
  SlowaOdpowiedz,
  SlowaUtworzSchema,
  SzukajQuery,
} from "./v2";

/**
 * Rejestr tras API v2 - jedyne zrodlo, z ktorego powstaje `docs/openapi-v2.json`
 * i `contractHash` z `GET /meta` (ADR-030). Test (`endpoints.test.ts`) pilnuje
 * trzech rzeczy: plik OpenAPI jest aktualny, kazda trasa w `src/app/api/v2` ma
 * wpis tutaj, a kazdy wpis ma trase. Dryf kontraktu jest wiec widoczny, zanim
 * cokolwiek sie zepsuje u klienta (`tj doctor` porownuje hash).
 */

export const WERSJA_KONTRAKTU = "2.0.0";

export const TradesListaQuery = z.strictObject({
  refs: z
    .string()
    .optional()
    .transform((w) => (w ? w.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().regex(REGEX_EXTERNAL_REF, { message: "oczekiwano formatu tv:<id> albo fxr:<id>" })).max(100)),
  source: z.enum(["tradingview", "fxreplay"]).optional(),
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type Metoda = "get" | "post" | "put" | "patch";

export type Endpoint = {
  metoda: Metoda;
  /** Sciezka OpenAPI wzgledem `/api/v2`, np. `/notes/{id}`. */
  sciezka: string;
  /** Wymagane zakresy; `null` = trasa publiczna (tylko device/start i device/token). */
  zakresy: Scope[] | null;
  opis: string;
  parametrySciezki?: string[];
  query?: z.ZodType;
  cialo?: z.ZodType;
  rodzajCiala?: "json" | "multipart";
  odpowiedz?: z.ZodType;
  /** Kod sukcesu, domyslnie 200. */
  status?: number;
  /** Inne kody, ktore trasa zwraca z powodu reguly biznesowej (documentacja, nie walidacja). */
  bledy?: Record<number, string>;
  ifMatch?: boolean;
};

const luzna = z.looseObject({});

export const ENDPOINTS: Endpoint[] = [
  { metoda: "get", sciezka: "/meta", zakresy: ["read"], opis: "Slownik: konta, instrumenty, tagi, interwaly, limity, zakresy i contractHash kontraktu.", odpowiedz: luzna },

  { metoda: "get", sciezka: "/trades", zakresy: ["read"], opis: "Trady zapisane przez API ze skrotem tresci i znacznikiem edycji w aplikacji.", query: TradesListaQuery, odpowiedz: luzna },
  { metoda: "post", sciezka: "/trades", zakresy: ["write"], opis: "Zapis paczki trade'ow (max 50) przez persistTrade/computeTrade. Wynik per pozycja.", cialo: KopertaTradowSchema, odpowiedz: luzna },
  { metoda: "post", sciezka: "/trades/{id}/reviews", zakresy: ["write"], opis: "Ocena AI trade'a z regulami; jedna na podstawe (chart | history), ponowne wyslanie podmienia.", parametrySciezki: ["id"], cialo: OcenaSchema, odpowiedz: luzna, status: 200, bledy: { 201: "Utworzona nowa ocena (200 przy podmianie).", 404: "Trade nie istnieje." } },
  { metoda: "post", sciezka: "/trades/{id}/screenshots", zakresy: ["write"], opis: "Zrzuty (multipart: shot, interval, origin). Zastepuja zrzuty tego samego pochodzenia.", parametrySciezki: ["id"], rodzajCiala: "multipart", odpowiedz: luzna, bledy: { 404: "Trade nie istnieje.", 413: "Za duze cialo.", 422: "Plik odrzucony." } },
  { metoda: "post", sciezka: "/backtest-sessions", zakresy: ["write"], opis: "Tworzy sesje backtestu/forward albo odnajduje ja po externalRef (idempotentne).", cialo: SesjaSchema, odpowiedz: luzna, bledy: { 201: "Utworzona nowa sesja (200 przy istniejacej)." } },
  { metoda: "post", sciezka: "/skips", zakresy: ["write"], opis: "Oznacza wpisy, ktorych klient nie chce w dzienniku.", cialo: OminieciaSchema, odpowiedz: luzna },

  { metoda: "get", sciezka: "/days/{date}", zakresy: ["read"], opis: "Dzien: notatka dnia, liczba trade'ow, slowa uzytkownika i notatki przypiete do dnia.", parametrySciezki: ["date"], query: DzienQuery, odpowiedz: luzna },
  { metoda: "put", sciezka: "/days/{date}", zakresy: ["write"], opis: "Zapis notatki dnia (nadpisuje podane pola; konto albo sesja backtestu wskazane w ciele).", parametrySciezki: ["date"], cialo: DzienZapisSchema, odpowiedz: luzna, bledy: { 409: "Dzien ma trade'y, wiec nie moze byc oznaczony jako bez transakcji." } },

  { metoda: "get", sciezka: "/notes", zakresy: ["read"], opis: "Lista notatek (bez tresci); filtry kind, slug, externalRef, day, tradeId.", query: NotatkiListaQuery, odpowiedz: luzna },
  { metoda: "post", sciezka: "/notes", zakresy: ["write"], opis: "Tworzy notatke. Link [[Tytul]] do nieistniejacej notatki jest dozwolony.", cialo: NotatkaUtworzSchema, odpowiedz: NotatkaOdpowiedz, status: 201, bledy: { 409: "Tytul, slug albo externalRef zajety (odpowiedz wskazuje istniejaca notatke)." } },
  { metoda: "get", sciezka: "/notes/{id}", zakresy: ["read"], opis: "Notatka z trescia, rewizja (rev, tez w ETag), linkami i backlinkami.", parametrySciezki: ["id"], odpowiedz: luzna },
  { metoda: "patch", sciezka: "/notes/{id}", zakresy: ["write"], opis: "Zmiana notatki z optymistyczna wspolbieznoscia: wymagany naglowek If-Match: <rev>. Brak kasowania; archived=true odklada do archiwum.", parametrySciezki: ["id"], cialo: NotatkaZmienSchema, odpowiedz: NotatkaOdpowiedz, ifMatch: true, bledy: { 409: "Nieaktualny rev; odpowiedz zawiera biezaca tresc.", 428: "Brak naglowka If-Match." } },

  { metoda: "get", sciezka: "/search", zakresy: ["read"], opis: "Wyszukiwanie w notatkach, slowach uzytkownika i trade'ach (bez polskich znakow, rozmyte).", query: SzukajQuery, odpowiedz: luzna },

  { metoda: "get", sciezka: "/rules", zakresy: ["read"], opis: "Reguly ze statusem wyliczonym z wersji i rulesVersion (numer zestawu).", query: ReguliListaQuery, odpowiedz: luzna },
  { metoda: "post", sciezka: "/rules/proposals", zakresy: ["propose"], opis: "Propozycja reguly lub nowej wersji. Zatwierdza wylacznie uzytkownik w aplikacji; zakresu approve nie ma.", cialo: PropozycjaReguly, odpowiedz: luzna, status: 201, bledy: { 409: "Regula ma juz oczekujaca propozycje.", 422: "Hipoteza ponizej progu n (tylko propozycje AI)." } },

  { metoda: "get", sciezka: "/hypotheses", zakresy: ["read"], opis: "Hipotezy z n (n_imported + zamkniete trade'y podpiete), progiem i faza (zbieranie | do oceny).", odpowiedz: luzna },
  { metoda: "post", sciezka: "/hypotheses", zakresy: ["write"], opis: "Zaklada hipoteze (notatka kind=hypothesis + wiersz hypotheses, decyzja 'active').", cialo: HipotezaUtworzSchema, odpowiedz: luzna, status: 201 },

  { metoda: "get", sciezka: "/user-words", zakresy: ["read"], opis: "Slowa uzytkownika doslownie (text + sha256 + interpretacja AI osobno).", query: SlowaListaQuery, odpowiedz: luzna },
  { metoda: "post", sciezka: "/user-words", zakresy: ["write"], opis: "Zapis slow uzytkownika bajt w bajt. Klient podaje sha256 z bajtow UTF-8; niezgodnosc = 400. Ponowne wyslanie tego samego wpisu jest idempotentne.", cialo: SlowaUtworzSchema, odpowiedz: SlowaOdpowiedz, status: 201, bledy: { 200: "Taki wpis juz istnieje (zwrocony bez duplikatu)." } },
  { metoda: "patch", sciezka: "/user-words/{id}", zakresy: ["write"], opis: "ZAWSZE 409: slowa uzytkownika sa niezmienne, poprawia je uzytkownik w aplikacji.", parametrySciezki: ["id"], odpowiedz: BladOdpowiedz, status: 409 },
  { metoda: "put", sciezka: "/user-words/{id}", zakresy: ["write"], opis: "ZAWSZE 409: slowa uzytkownika sa niezmienne, poprawia je uzytkownik w aplikacji.", parametrySciezki: ["id"], odpowiedz: BladOdpowiedz, status: 409 },
  { metoda: "put", sciezka: "/user-words/{id}/interpretation", zakresy: ["write"], opis: "Jedyna zmienna czesc slow: interpretacja AI, ustawiana raz (poprawke zapisuje uzytkownik w aplikacji).", parametrySciezki: ["id"], cialo: InterpretacjaSchema, odpowiedz: SlowaOdpowiedz, bledy: { 409: "Interpretacja jest juz ustawiona." } },

  { metoda: "post", sciezka: "/device/start", zakresy: null, opis: "Poczatek logowania kodem urzadzenia; zwraca user_code do przepisania w aplikacji. Bez tokenu, limit 10 na godzine na adres.", cialo: DeviceStartSchema, odpowiedz: DeviceStartOdpowiedz, bledy: { 403: "device_login_disabled (przelacznik DEVICE_LOGIN_DISABLED=1)", 429: "limit startow na adres albo too_many_pending (20 niezatwierdzonych zadan)" } },
  { metoda: "post", sciezka: "/device/token", zakresy: null, opis: "Odpytywanie o token co 5 s; token wraca dokladnie raz. Bez tokenu.", cialo: DeviceTokenSchema, odpowiedz: DeviceTokenOdpowiedz, bledy: { 400: "authorization_pending | expired_token | invalid_grant", 403: "access_denied (uzytkownik odrzucil)", 429: "slow_down (odpytywanie czesciej niz co 5 s) albo limit zapytan na adres" } },
];

/** Sciezka OpenAPI -> sciezka pliku trasy Next (`/notes/{id}` -> `notes/[id]`). */
export function katalogTrasy(sciezka: string): string {
  return sciezka.replace(/^\//, "").replace(/\{(\w+)\}/g, "[$1]");
}

function jsonSchema(schemat: z.ZodType, io: "input" | "output"): Record<string, unknown> {
  const { $schema: _usun, ...reszta } = z.toJSONSchema(schemat, { io, unrepresentable: "any" }) as Record<string, unknown>;
  void _usun;
  return reszta;
}

function parametryQuery(schemat: z.ZodType): unknown[] {
  const js = jsonSchema(schemat, "input") as { properties?: Record<string, unknown>; required?: string[] };
  const wymagane = new Set(js.required ?? []);
  return Object.entries(js.properties ?? {}).map(([nazwa, s]) => ({
    name: nazwa,
    in: "query",
    required: wymagane.has(nazwa),
    schema: s,
  }));
}

export function zbudujOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const parametry: unknown[] = [
      ...(e.parametrySciezki ?? []).map((nazwa) => ({ name: nazwa, in: "path", required: true, schema: { type: "string" } })),
      ...(e.query ? parametryQuery(e.query) : []),
      ...(e.ifMatch ? [{ name: "If-Match", in: "header", required: true, description: "Numer rewizji (rev) z ostatniego odczytu notatki.", schema: { type: "string" } }] : []),
    ];
    const operacja: Record<string, unknown> = {
      operationId: `${e.metoda}${e.sciezka.replace(/[{}]/g, "").replace(/\/(\w)/g, (_m, c: string) => c.toUpperCase())}`,
      summary: e.opis,
      security: e.zakresy === null ? [] : [{ bearer: [] }],
      "x-scopes": e.zakresy ?? [],
      parameters: parametry,
      responses: {
        [String(e.status ?? 200)]: {
          description: "Sukces",
          content: e.odpowiedz ? { "application/json": { schema: jsonSchema(e.odpowiedz, "output") } } : undefined,
        },
        ...Object.fromEntries(
          Object.entries(e.bledy ?? {}).map(([kod, opis]) => [kod, { description: opis, content: { "application/json": { schema: jsonSchema(BladOdpowiedz, "output") } } }]),
        ),
        ...(e.zakresy === null ? {} : { "401": { description: "Brak, nieznany, uniewazniony albo wygasly token." }, "403": { description: "Token nie ma wymaganego zakresu." }, "429": { description: "Limit zapytan albo blokada." } }),
      },
    };
    if (e.cialo) {
      operacja.requestBody = { required: true, content: { "application/json": { schema: jsonSchema(e.cialo, "input") } } };
    } else if (e.rodzajCiala === "multipart") {
      operacja.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                shot: { type: "array", items: { type: "string", format: "binary" }, description: "Plik; powtarzalne, do 8." },
                interval: { type: "array", items: { type: "string" }, description: "Interwal; po jednym na plik, w tej samej kolejnosci." },
                origin: { type: "string", enum: ["tradingview", "fxreplay"] },
              },
              required: ["shot"],
            },
          },
        },
      };
    }
    (paths[e.sciezka] ??= {})[e.metoda] = operacja;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Dziennik tradingowy API v2",
      version: WERSJA_KONTRAKTU,
      description:
        "Kontrakt generowany z schematow zod (src/lib/api-v2/contract). Autoryzacja: Authorization: Bearer tj_<prefiks>_<sekret>. Zakresy: read, write, propose; zakresu zatwierdzania nie ma.",
    },
    servers: [{ url: "/api/v2" }],
    paths,
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "tj_<prefiks>_<sekret>" } } },
  };
}

/** Plik `docs/openapi-v2.json`: dokladnie te bajty, z ktorych liczy sie contractHash. */
export function tekstOpenApi(): string {
  return `${JSON.stringify(zbudujOpenApi(), null, 2)}\n`;
}

export function contractHash(): string {
  return createHash("sha256").update(tekstOpenApi(), "utf8").digest("hex");
}
