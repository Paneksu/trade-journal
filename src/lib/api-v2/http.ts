import { randomUUID } from "node:crypto";

/** Odpowiedzi API synchronizacji: zawsze JSON, nigdy w cache, zawsze z kodem maszynowym. */

export function odpowiedz(
  dane: unknown,
  status = 200,
  naglowki: Record<string, string> = {},
): Response {
  return Response.json(dane, {
    status,
    headers: { "Cache-Control": "no-store", ...naglowki },
  });
}

export function blad(
  status: number,
  kod: string,
  komunikat: string,
  dodatkowe: Record<string, unknown> = {},
  naglowki: Record<string, string> = {},
): Response {
  return odpowiedz({ error: komunikat, code: kod, ...dodatkowe }, status, naglowki);
}

export function noweIdZapytania(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Adres klienta do blokad. Bierzemy OSTATNI wpis X-Forwarded-For: dopisuje go
 * zaufane proxy (Traefik w Coolify), podczas gdy wpisy z lewej moze podstawic
 * sam klient - gdyby liczyl sie pierwszy, wystarczylby losowy naglowek, zeby
 * kazda proba hasla miala swiezy licznik.
 *
 * Przyjmuje `Headers`, nie `Request`: tej samej funkcji uzywa logowanie (server
 * action ma tylko `headers()`), zeby blokada hasla i TOTP nie dala sie ominac
 * podstawionym naglowkiem.
 */
export function adresZNaglowkow(naglowki: Headers): string {
  const xff = naglowki.get("x-forwarded-for");
  if (xff) {
    const wpisy = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (wpisy.length > 0) return wpisy[wpisy.length - 1];
  }
  return naglowki.get("x-real-ip")?.trim() || "nieznany";
}

export function adresKlienta(request: Request): string {
  return adresZNaglowkow(request.headers);
}

/**
 * Czy polaczenie przyszlo po HTTPS (za proxy: wg ostatniego X-Forwarded-Proto).
 * Dla zlozonego naglowka `http, https` liczy sie ostatni wpis - ten dopisal
 * najblizszy serwer. Wpis `https, http` daje false: w razie watpliwosci uznajemy
 * polaczenie za niezabezpieczone, nie odwrotnie.
 */
export function czyHttpsZNaglowkow(naglowki: Headers, url?: string): boolean {
  const proto = naglowki.get("x-forwarded-proto");
  if (proto) {
    const wpisy = proto.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return wpisy[wpisy.length - 1] === "https";
  }
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function czyHttps(request: Request): boolean {
  return czyHttpsZNaglowkow(request.headers, request.url);
}

/** Odpowiedz API nie niesie wewnetrznej flagi `ok` wyniku modulu (ksztalt wyniku opisuja jego pola). */
export function bezOk<T extends { ok: true }>(w: T): Omit<T, "ok"> {
  const { ok: _ok, ...reszta } = w;
  void _ok;
  return reszta;
}
