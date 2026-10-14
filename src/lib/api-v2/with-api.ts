import "server-only";
import { eq, sql } from "drizzle-orm";

import { checkRateLimit, clearAttempts, recordFailedAttempt } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";

import { opiszBladBazy } from "./bledy-bazy";
import { adresKlienta, blad, czyHttps, noweIdZapytania } from "./http";
import { przepusc } from "./limiter";
import type { Scope } from "./scopes";
import { czyScope } from "./scopes";
import { skrotTokenuV2, skrotyRowne, tokenV2ZNaglowka } from "./token";

/**
 * Brama kazdej trasy `/api/v2/**` (ADR-030). Uogolnia `withIngest` (ADR-026):
 * trasy NIE przechodza przez `proxy.ts` (matcher je pomija), wiec cala
 * autoryzacja siedzi tutaj, a test-straznik (`guard.test.ts`) pilnuje, zeby
 * zadna trasa jej nie ominela.
 *
 * Kolejnosc ma znaczenie:
 *  1. wylacznik awaryjny `API_V2_DISABLED=1` -> 404;
 *  2. produkcja bez HTTPS -> 403;
 *  3. blokada po 8 zlych tokenach z adresu -> 429 (PRZED porownaniem);
 *  4. token nieznany, uniewazniony albo przeterminowany -> 401;
 *  5. brak zakresu -> 403 z nazwa brakujacego zakresu;
 *  6. limit 120 zapytan na minute NA TOKEN (nie na adres - urzadzenie zmienia siec) -> 429;
 *  7. handler, z lapaniem wyjatkow -> 500 z `x-request-id`; TJ409/TJ403 z triggerow -> 409/403.
 */

export const LIMIT_NA_MINUTE_V2 = 120;
const OKNO_MS = 60_000;
/** Zapis `last_used_at` najwyzej raz na minute (SQL ponizej ma ten sam warunek). */
const ODSWIEZANIE_UZYCIA = "1 minute";

type Transakcja = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TokenKontekst = { id: number; name: string; scopes: Scope[] };

export type KontekstApi = {
  requestId: string;
  token: TokenKontekst;
  /** Wartosc `tj.actor` w transakcjach zapisu: `api:<id tokenu>`. Triggery zatwierdzen odrzucaja kazdego poza `ui`. */
  actor: string;
  /**
   * Transakcja z `set_config('tj.actor', ..., true)` na tym samym polaczeniu co
   * zapis (model-danych 8, pkt 7). Zapisy trade'ow ida przez `persistTrade`
   * z wlasna transakcja, a zrzuty to I/O na dysku - dlatego brama nie otwiera
   * jednej transakcji na cale zapytanie, tylko daje ta funkcje.
   */
  zapis: <T>(fn: (tx: Transakcja) => Promise<T>) => Promise<T>;
};

type Handler<C> = (request: Request, api: KontekstApi, ctx: C) => Promise<Response>;

export type { Transakcja };

export function zapisZAktorem<T>(actor: string, fn: (tx: Transakcja) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // `true` = lokalne dla transakcji; z `false` wartosc wyciekalaby na polaczenie z puli.
    await tx.execute(sql`select set_config('tj.actor', ${actor}, true)`);
    return fn(tx);
  });
}

export type WynikUwierzytelnienia =
  | { ok: true; token: TokenKontekst }
  | { ok: false; kod: "unauthorized" | "token_revoked" | "token_expired"; komunikat: string };

/** Sprawdza naglowek Authorization wzgledem tabeli `api_tokens`. Nie zapisuje niczego. */
export async function uwierzytelnij(naglowek: string | null, teraz: Date = new Date()): Promise<WynikUwierzytelnienia> {
  const t = tokenV2ZNaglowka(naglowek);
  if (!t) {
    return {
      ok: false,
      kod: "unauthorized",
      komunikat: "Brak poprawnego tokenu. Wyślij nagłówek Authorization: Bearer tj_<prefiks>_<sekret> (token wydaje `tj login`).",
    };
  }
  const [w] = await db.select().from(apiTokens).where(eq(apiTokens.prefix, t.prefix)).limit(1);
  if (!w || !skrotyRowne(w.tokenSha256, skrotTokenuV2(t.token))) {
    return { ok: false, kod: "unauthorized", komunikat: "Token nie jest rozpoznany. Zaloguj urządzenie ponownie (`tj login`)." };
  }
  // Od tej chwili wiemy, ze to prawdziwy token, wiec mozemy powiedziec dlaczego nie dziala.
  if (w.revokedAt) {
    return {
      ok: false,
      kod: "token_revoked",
      komunikat: `Token „${w.name}” został unieważniony ${w.revokedAt.toISOString()}. Zaloguj urządzenie ponownie (\`tj login\`).`,
    };
  }
  if (w.expiresAt && w.expiresAt.getTime() <= teraz.getTime()) {
    return {
      ok: false,
      kod: "token_expired",
      komunikat: `Token „${w.name}” wygasł ${w.expiresAt.toISOString()}. Zaloguj urządzenie ponownie (\`tj login\`).`,
    };
  }
  return { ok: true, token: { id: w.id, name: w.name, scopes: w.scopes.filter(czyScope) } };
}

async function odswiezUzycie(tokenId: number, adres: string): Promise<void> {
  try {
    await db.execute(sql`
      update api_tokens set last_used_at = now(), last_used_ip = ${adres}
       where id = ${tokenId}
         and (last_used_at is null or last_used_at < now() - ${ODSWIEZANIE_UZYCIA}::interval)`);
  } catch (e) {
    // Statystyka uzycia nie moze zatrzymac zapytania.
    console.error(`[api-v2] nie zapisano last_used_at tokenu #${tokenId}:`, e);
  }
}

function odpowiedzNaWyjatek(e: unknown, idZapytania: string, request: Request, naglowki: Record<string, string>): Response {
  const opis = opiszBladBazy(e);
  const sciezka = new URL(request.url).pathname;
  if (opis) {
    console.warn(`[api-v2 ${idZapytania}] ${request.method} ${sciezka} - baza odrzuciła zapis (${opis.kod}):`, e);
    return blad(opis.status, opis.kod, opis.komunikat, { requestId: idZapytania }, naglowki);
  }
  console.error(`[api-v2 ${idZapytania}] ${request.method} ${sciezka} - nieobsłużony wyjątek:`, e);
  return blad(
    500,
    "internal_error",
    `Błąd serwera. Szczegóły są w logach aplikacji pod identyfikatorem ${idZapytania}.`,
    { requestId: idZapytania },
    naglowki,
  );
}

/** Wspolny poczatek bram: wylacznik awaryjny i HTTPS. */
function bramkaWstepna(request: Request, naglowki: Record<string, string>): Response | null {
  if (process.env.API_V2_DISABLED === "1") {
    return blad(404, "not_found", "Nie znaleziono.", {}, naglowki);
  }
  if (process.env.NODE_ENV === "production" && !czyHttps(request)) {
    return blad(
      403,
      "https_required",
      "API przyjmuje zapytania wyłącznie po HTTPS. Użyj adresu https:// (token nie może iść otwartym tekstem).",
      {},
      naglowki,
    );
  }
  return null;
}

export function withApi<C = unknown>(opcje: { scopes: Scope[] }, handler: Handler<C>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const idZapytania = noweIdZapytania();
    const naglowki = { "x-request-id": idZapytania };

    const wstepna = bramkaWstepna(request, naglowki);
    if (wstepna) return wstepna;

    const klient = adresKlienta(request);
    const kluczBlokady = `api2:${klient}`;
    const blokada = checkRateLimit(kluczBlokady);
    if (!blokada.allowed) {
      console.warn(`[api-v2 ${idZapytania}] zablokowany klient ${klient}: za dużo błędnych tokenów`);
      return blad(
        429,
        "locked_out",
        `Za dużo błędnych tokenów z tego adresu. Spróbuj ponownie za ${blokada.retryInS} s.`,
        { retryInS: blokada.retryInS },
        { ...naglowki, "Retry-After": String(blokada.retryInS) },
      );
    }

    let uwierzytelnienie: WynikUwierzytelnienia;
    try {
      uwierzytelnienie = await uwierzytelnij(request.headers.get("authorization"));
    } catch (e) {
      return odpowiedzNaWyjatek(e, idZapytania, request, naglowki);
    }
    if (!uwierzytelnienie.ok) {
      recordFailedAttempt(kluczBlokady);
      console.warn(
        `[api-v2 ${idZapytania}] odrzucony token (${uwierzytelnienie.kod}) od ${klient} (${request.method} ${new URL(request.url).pathname})`,
      );
      return blad(401, uwierzytelnienie.kod, uwierzytelnienie.komunikat, {}, {
        ...naglowki,
        "WWW-Authenticate": 'Bearer realm="trade-journal-api-v2"',
      });
    }
    clearAttempts(kluczBlokady);
    const token = uwierzytelnienie.token;

    const brakujacy = opcje.scopes.find((s) => !token.scopes.includes(s));
    if (brakujacy) {
      return blad(
        403,
        "insufficient_scope",
        `Token „${token.name}” nie ma zakresu »${brakujacy}« (ma: ${token.scopes.join(", ")}). Ta operacja wymaga: ${opcje.scopes.join(", ")}. Zakresu nie da się dopisać do istniejącego tokenu; zaloguj urządzenie ponownie z potrzebnym zakresem.`,
        { missingScope: brakujacy, requiredScopes: opcje.scopes },
        naglowki,
      );
    }

    const limit = przepusc(`api2-rate:${token.id}`, LIMIT_NA_MINUTE_V2, OKNO_MS);
    if (!limit.allowed) {
      return blad(
        429,
        "rate_limited",
        `Przekroczony limit ${LIMIT_NA_MINUTE_V2} zapytań na minutę dla tokenu „${token.name}”. Spróbuj ponownie za ${limit.retryInS} s.`,
        { retryInS: limit.retryInS },
        { ...naglowki, "Retry-After": String(limit.retryInS) },
      );
    }

    await odswiezUzycie(token.id, klient);

    const actor = `api:${token.id}`;
    const api: KontekstApi = {
      requestId: idZapytania,
      token,
      actor,
      zapis: (fn) => zapisZAktorem(actor, fn),
    };

    try {
      const odpowiedz = await handler(request, api, ctx);
      odpowiedz.headers.set("x-request-id", idZapytania);
      return odpowiedz;
    } catch (e) {
      return odpowiedzNaWyjatek(e, idZapytania, request, naglowki);
    }
  };
}

/**
 * Dwie jedyne trasy v2 bez tokenu: `device/start` i `device/token`. Maja wlasny
 * limit na adres klienta, a test-straznik zna je z nazwy (dopisanie trzeciej
 * trasy publicznej wymaga swiadomej zmiany testu).
 */
export function withPublicApi<C = unknown>(
  opcje: { nazwa: string; limit: number; oknoMs: number },
  handler: (request: Request, ctx: C, requestId: string) => Promise<Response>,
) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const idZapytania = noweIdZapytania();
    const naglowki = { "x-request-id": idZapytania };

    const wstepna = bramkaWstepna(request, naglowki);
    if (wstepna) return wstepna;

    const klient = adresKlienta(request);
    const limit = przepusc(`api2-public:${opcje.nazwa}:${klient}`, opcje.limit, opcje.oknoMs);
    if (!limit.allowed) {
      return blad(
        429,
        "rate_limited",
        `Za dużo zapytań (${opcje.limit} na ${Math.round(opcje.oknoMs / 60_000)} min z jednego adresu). Spróbuj ponownie za ${limit.retryInS} s.`,
        { retryInS: limit.retryInS },
        { ...naglowki, "Retry-After": String(limit.retryInS) },
      );
    }

    try {
      const odpowiedz = await handler(request, ctx, idZapytania);
      odpowiedz.headers.set("x-request-id", idZapytania);
      return odpowiedz;
    } catch (e) {
      return odpowiedzNaWyjatek(e, idZapytania, request, naglowki);
    }
  };
}
