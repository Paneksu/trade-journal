import { checkRateLimit, clearAttempts, recordFailedAttempt } from "@/lib/auth/guard";

import { adresKlienta, blad, czyHttps, noweIdZapytania } from "./http";
import { przepusc } from "./limiter";
import { tokenPasuje, wczytajSkrot } from "./token";

/**
 * Opakowanie kazdej trasy `/api/ingest/**` (ADR-026). Trasy NIE przechodza przez
 * `proxy.ts` (patrz matcher) - tu jest cala brama: nie ma sesji ani ciasteczka,
 * jest wylacznie token. Test-straznik (`with-ingest.guard.test.ts`) pilnuje, zeby
 * zadna trasa nie wyeksportowala handlera bez tego opakowania.
 *
 * Kolejnosc ma znaczenie:
 *  1. brak (albo zepsuty) `INGEST_TOKEN_SHA256` -> 404: API nie istnieje, dopoki
 *     wlasciciel go swiadomie nie wlaczy;
 *  2. produkcja bez HTTPS -> 403;
 *  3. blokada po 8 bledach tokenu -> 429 (PRZED porownaniem, zeby zablokowany
 *     klient nie mogl dalej zgadywac);
 *  4. token -> 401;
 *  5. limit 120 zapytan na minute -> 429;
 *  6. handler, z lapaniem wyjatkow -> 500 bez szczegolow dla klienta.
 */

export const LIMIT_NA_MINUTE = 120;
const OKNO_MS = 60_000;

type Handler<C> = (request: Request, ctx: C) => Promise<Response>;

export function withIngest<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (request, ctx) => {
    const idZapytania = noweIdZapytania();
    const naglowki = { "x-request-id": idZapytania };

    const skrot = wczytajSkrot(process.env.INGEST_TOKEN_SHA256);
    if (!skrot) {
      if (process.env.INGEST_TOKEN_SHA256) {
        console.error(
          `[ingest ${idZapytania}] INGEST_TOKEN_SHA256 jest ustawiona, ale nie ma 64 znakow hex ` +
            `(dlugosc: ${process.env.INGEST_TOKEN_SHA256.trim().length}). API zostaje wylaczone. ` +
            `Wygeneruj skrot: node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <token>`,
        );
      }
      return blad(404, "not_found", "Nie znaleziono.", {}, naglowki);
    }

    if (process.env.NODE_ENV === "production" && !czyHttps(request)) {
      return blad(
        403,
        "https_required",
        "API synchronizacji przyjmuje zapytania wyłącznie po HTTPS. Użyj adresu https:// (token nie może iść otwartym tekstem).",
        {},
        naglowki,
      );
    }

    const klient = adresKlienta(request);
    const kluczBlokady = `ingest:${klient}`;
    const blokada = checkRateLimit(kluczBlokady);
    if (!blokada.allowed) {
      console.warn(`[ingest ${idZapytania}] zablokowany klient ${klient}: za duzo blednych tokenow`);
      return blad(
        429,
        "locked_out",
        `Za dużo błędnych tokenów z tego adresu. Spróbuj ponownie za ${blokada.retryInS} s.`,
        { retryInS: blokada.retryInS },
        { ...naglowki, "Retry-After": String(blokada.retryInS) },
      );
    }

    if (!tokenPasuje(request.headers.get("authorization"), skrot)) {
      recordFailedAttempt(kluczBlokady);
      console.warn(`[ingest ${idZapytania}] odrzucony token od ${klient} (${request.method} ${new URL(request.url).pathname})`);
      return blad(
        401,
        "unauthorized",
        "Brak poprawnego tokenu. Wyślij nagłówek Authorization: Bearer <token>.",
        {},
        { ...naglowki, "WWW-Authenticate": 'Bearer realm="trade-journal-ingest"' },
      );
    }
    clearAttempts(kluczBlokady);

    const limit = przepusc(`ingest-rate:${klient}`, LIMIT_NA_MINUTE, OKNO_MS);
    if (!limit.allowed) {
      return blad(
        429,
        "rate_limited",
        `Przekroczony limit ${LIMIT_NA_MINUTE} zapytań na minutę. Spróbuj ponownie za ${limit.retryInS} s.`,
        { retryInS: limit.retryInS },
        { ...naglowki, "Retry-After": String(limit.retryInS) },
      );
    }

    try {
      const odpowiedz = await handler(request, ctx);
      odpowiedz.headers.set("x-request-id", idZapytania);
      return odpowiedz;
    } catch (e) {
      console.error(
        `[ingest ${idZapytania}] ${request.method} ${new URL(request.url).pathname} - nieobsluzony wyjatek:`,
        e,
      );
      return blad(
        500,
        "internal_error",
        `Błąd serwera. Szczegóły są w logach aplikacji pod identyfikatorem ${idZapytania}.`,
        { requestId: idZapytania },
        naglowki,
      );
    }
  };
}
