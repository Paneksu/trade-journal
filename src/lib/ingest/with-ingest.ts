import { checkRateLimit, clearAttempts, recordFailedAttempt } from "@/lib/auth/guard";
import { adresKlienta, blad, czyHttps, noweIdZapytania } from "@/lib/api-v2/http";
import { przepusc } from "@/lib/api-v2/limiter";
import { tokenV2ZNaglowka } from "@/lib/api-v2/token";
import { tokenPasuje, wczytajSkrot } from "./token";

/**
 * Opakowanie kazdej trasy `/api/ingest/**` (ADR-026). ZAKRES WYGASZANY (ADR-030):
 * trasy przyjmuja dwa rodzaje tokenu, a kazda odpowiedz niesie naglowek
 * `Deprecation` i `Link` do `/api/v2`:
 *  - stary skrot z `INGEST_TOKEN_SHA256` (jedna zmienna, pelny dostep) - kazde
 *    uzycie trafia do logu, zeby bylo widac, kiedy mozna go wylaczyc;
 *  - token v2 (`tj_<prefiks>_<sekret>`) z zakresem `write`.
 * Usuniecie tras: po fazie 3 i za zgoda uzytkownika.
 *
 * Trasy NIE przechodza przez `proxy.ts` (patrz matcher) - tu jest cala brama.
 * Test-straznik (`guard.test.ts`) pilnuje, zeby zadna trasa nie wyeksportowala
 * handlera bez tego opakowania.
 *
 * Kolejnosc ma znaczenie:
 *  1. token v2 -> sprawdzany w bazie; inny token wymaga `INGEST_TOKEN_SHA256`,
 *     a bez niej (i bez tokenu v2) API nie istnieje -> 404;
 *  2. produkcja bez HTTPS -> 403;
 *  3. blokada po 8 bledach tokenu -> 429 (PRZED porownaniem, zeby zablokowany
 *     klient nie mogl dalej zgadywac);
 *  4. token -> 401;
 *  5. limit 120 zapytan na minute -> 429;
 *  6. handler, z lapaniem wyjatkow -> 500 bez szczegolow dla klienta.
 */

export const LIMIT_NA_MINUTE = 120;
const OKNO_MS = 60_000;

/** Naglowki wygaszania dolaczane do KAZDEJ odpowiedzi z `/api/ingest/**` (takze bledow). */
export const NAGLOWKI_WYGASZANIA = {
  Deprecation: "true",
  Link: '</api/v2>; rel="successor-version"',
} as const;

type Handler<C> = (request: Request, ctx: C) => Promise<Response>;

let uzyciaStarego = 0;

export function withIngest<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (request, ctx) => {
    const idZapytania = noweIdZapytania();
    const naglowki: Record<string, string> = { "x-request-id": idZapytania, ...NAGLOWKI_WYGASZANIA };

    const naglowekAuth = request.headers.get("authorization");
    const tokenV2 = tokenV2ZNaglowka(naglowekAuth);

    const skrot = wczytajSkrot(process.env.INGEST_TOKEN_SHA256);
    if (!skrot && !tokenV2) {
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

    // Klucz limitu: token v2 ma wlasny licznik, stary token liczy sie na adres jak dotad.
    let kluczLimitu = `ingest-rate:${klient}`;
    let uwierzytelniony = false;

    if (tokenV2) {
      // Import dynamiczny: with-api ciagnie baze i `server-only`, a stary tryb (sam skrot) nie powinien jej wymagac.
      const { uwierzytelnij } = await import("@/lib/api-v2/with-api");
      const wynik = await uwierzytelnij(naglowekAuth);
      if (wynik.ok) {
        if (!wynik.token.scopes.includes("write")) {
          return blad(
            403,
            "insufficient_scope",
            `Token „${wynik.token.name}” nie ma zakresu »write« (ma: ${wynik.token.scopes.join(", ")}), a /api/ingest/** przyjmuje zapis. Zaloguj urządzenie ponownie z zakresem write albo użyj /api/v2.`,
            { missingScope: "write" },
            naglowki,
          );
        }
        uwierzytelniony = true;
        kluczLimitu = `api2-rate:${wynik.token.id}`;
      }
    } else if (skrot && tokenPasuje(naglowekAuth, skrot)) {
      uwierzytelniony = true;
      uzyciaStarego += 1;
      console.info(
        `[ingest ${idZapytania}] DEPRECATED: uzycie starego tokenu INGEST_TOKEN_SHA256 (nr ${uzyciaStarego} od startu procesu) ` +
          `${request.method} ${new URL(request.url).pathname} od ${klient}. Przejdz na token v2 (tj login) i /api/v2.`,
      );
    }

    if (!uwierzytelniony) {
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

    const limit = przepusc(kluczLimitu, LIMIT_NA_MINUTE, OKNO_MS);
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
      for (const [k, v] of Object.entries(naglowki)) odpowiedz.headers.set(k, v);
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

/** Tylko do testow. */
export function zerujLicznikStarego(): void {
  uzyciaStarego = 0;
}
