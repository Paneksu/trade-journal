/**
 * Czytanie ciala zapytania z limitem liczonym NA STRUMIENIU (ADR-026).
 * Naglowek Content-Length mozna pominac albo sklamac, a Next.js nie ogranicza
 * ciala trasy API - wiec liczymy bajty w trakcie czytania i przerywamy, gdy
 * limit zostanie przekroczony, nie czekajac na koniec.
 */

export const LIMIT_JSON = 1024 * 1024;
export const LIMIT_MULTIPART = 11 * 1024 * 1024;

export type WynikBajtow =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; limit: number; odczytano: number };

export async function czytajBajty(request: Request, limit: number): Promise<WynikBajtow> {
  const deklarowany = Number(request.headers.get("content-length"));
  if (Number.isFinite(deklarowany) && deklarowany > limit) {
    return { ok: false, limit, odczytano: deklarowany };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = request.body.getReader();
  const kawalki: Uint8Array[] = [];
  let suma = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    suma += value.byteLength;
    if (suma > limit) {
      await reader.cancel().catch(() => {});
      return { ok: false, limit, odczytano: suma };
    }
    kawalki.push(value);
  }
  const bytes = new Uint8Array(suma);
  let przesuniecie = 0;
  for (const k of kawalki) {
    bytes.set(k, przesuniecie);
    przesuniecie += k.byteLength;
  }
  return { ok: true, bytes };
}

export type WynikJson =
  | { ok: true; dane: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string };

export async function czytajJson(request: Request, limit = LIMIT_JSON): Promise<WynikJson> {
  const typ = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(typ)) {
    return {
      ok: false,
      status: 415,
      error: `Content-Type »${typ || "brak"}« nie jest obsługiwany. Wyślij application/json.`,
    };
  }
  const b = await czytajBajty(request, limit);
  if (!b.ok) {
    return {
      ok: false,
      status: 413,
      error: `Ciało zapytania ma co najmniej ${b.odczytano} B, a limit JSON to ${b.limit} B. Podziel paczkę na mniejsze (trades: max 50 na zapytanie).`,
    };
  }
  try {
    return { ok: true, dane: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b.bytes)) };
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error: `Ciało zapytania nie jest poprawnym JSON-em UTF-8 (${(e as Error).message}).`,
    };
  }
}

export type WynikMultipart =
  | { ok: true; formData: FormData }
  | { ok: false; status: 400 | 413 | 415; error: string };

export async function czytajMultipart(
  request: Request,
  limit = LIMIT_MULTIPART,
): Promise<WynikMultipart> {
  const typ = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(typ)) {
    return {
      ok: false,
      status: 415,
      error: `Content-Type »${typ || "brak"}« nie jest obsługiwany. Wyślij multipart/form-data.`,
    };
  }
  const b = await czytajBajty(request, limit);
  if (!b.ok) {
    return {
      ok: false,
      status: 413,
      error: `Ciało zapytania ma co najmniej ${b.odczytano} B, a limit multipart to ${b.limit} B (do 8 zrzutów, każdy do 10 MB, razem z narzutem).`,
    };
  }
  try {
    // Odtwarzamy odpowiedz z juz wczytanych bajtow: parser multipart z undici
    // czyta tylko z ciala, a my mamy je policzone i ograniczone.
    const formData = await new Response(b.bytes as BodyInit, {
      headers: { "content-type": typ },
    }).formData();
    return { ok: true, formData };
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error: `Nie udało się odczytać multipart/form-data (${(e as Error).message}). Sprawdź granicę (boundary) w Content-Type.`,
    };
  }
}
