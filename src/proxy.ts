import { NextResponse, type NextRequest } from "next/server";

import { readToken, SESSION_COOKIE } from "@/lib/auth/token";

/*
 * Brama wejsciowa. Sprawdza wylacznie podpis i termin waznosci tokenu -
 * bez zapytania do bazy, zeby kazde zadanie nie kosztowalo polaczenia.
 * Pelna weryfikacja (zgodnosc wersji sesji) dzieje sie w `requireSession`
 * przy renderowaniu strony.
 *
 * W Next 16 plik nazywa sie `proxy`, a nie `middleware`, i chodzi na Node.
 */

const PUBLIC = ["/login", "/_next", "/favicon", "/robots.txt", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (readToken(token)) {
    return NextResponse.next();
  }

  const target = new URL("/login", request.url);
  if (pathname !== "/") target.searchParams.set("wroc", pathname + request.nextUrl.search);
  const response = NextResponse.redirect(target);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

/*
 * `api/ingest/` jest WYLACZONE z proxy (ADR-026), z dwoch powodow:
 *  1. proxy buforuje i obcina cialo zapytania powyzej 10 MB, a multipart ze
 *     zrzutami ma limit 11 MB liczony na strumieniu w samej trasie;
 *  2. te trasy nie uzywaja ciasteczka sesji, tylko naglowka Authorization:
 *     Bearer - bez wykluczenia proxy przekierowalby kazde zapytanie klienta
 *     na /login. Cala brama (token, blokada, limity) siedzi w `withIngest`,
 *     a test-straznik pilnuje, zeby zadna trasa jej nie ominela.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/ingest/).*)"],
};
