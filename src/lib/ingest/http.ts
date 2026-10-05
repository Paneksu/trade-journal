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
 */
export function adresKlienta(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const wpisy = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (wpisy.length > 0) return wpisy[wpisy.length - 1];
  }
  return request.headers.get("x-real-ip")?.trim() || "nieznany";
}

/** Czy zapytanie przyszlo po HTTPS (za proxy: wg ostatniego X-Forwarded-Proto). */
export function czyHttps(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) {
    const wpisy = proto.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return wpisy[wpisy.length - 1] === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
