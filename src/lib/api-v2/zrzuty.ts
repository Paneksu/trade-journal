import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { screenshots, trades } from "@/lib/db/schema";
import { czyInterwal, sparujZInterwalami } from "@/lib/domain/interwaly";
import { bladPliku, deleteScreenshot } from "@/lib/screenshots";
import { bladLimitu, MAX_ZRZUTOW } from "@/lib/screenshots-limit";
import { policzZrzuty, wgrajZrzuty, type OriginZrzutu } from "@/lib/trades/screenshots-db";

/**
 * Zrzuty z API (ADR-026): ZASTEPUJA wszystkie zrzuty tego samego pochodzenia
 * (`origin`) na tym trade'cie, a zrzutow recznych (`manual`) i cudzego
 * pochodzenia nie dotykaja nigdy. Ponowne wyslanie tej samej paczki daje ten
 * sam stan - zadnych duplikatow po powtorzeniu zapytania.
 */

export type WynikZrzutow =
  | {
      ok: true;
      tradeId: number;
      origin: OriginZrzutu;
      replaced: number;
      screenshots: { id: number; file: string; thumbnail: string | null; interval: string | null; origin: string }[];
    }
  | { ok: false; status: 400 | 404 | 409 | 422 | 500; error: string };

export type OriginAPI = Exclude<OriginZrzutu, "manual">;

export async function zastapZrzuty(
  tradeId: number,
  origin: OriginAPI,
  pliki: File[],
  interwaly: string[],
): Promise<WynikZrzutow> {
  if (pliki.length === 0) {
    return { ok: false, status: 400, error: "Brak plików. Wyślij pola »shot« (jedno na zrzut) w multipart/form-data." };
  }

  const [trade] = await db.select({ id: trades.id }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  if (!trade) {
    return {
      ok: false,
      status: 404,
      error: `Trade #${tradeId} nie istnieje (mógł zostać skasowany w aplikacji). Sprawdź id w odpowiedzi POST /api/ingest/trades.`,
    };
  }

  for (let i = 0; i < pliki.length; i += 1) {
    const b = bladPliku(pliki[i]);
    if (b) return { ok: false, status: 422, error: `shot #${i + 1}: ${b}` };
  }
  for (const [i, w] of interwaly.entries()) {
    if (w !== "" && !czyInterwal(w)) {
      return {
        ok: false,
        status: 422,
        error: `interval #${i + 1}: »${w}« nie jest interwałem z listy (GET /api/ingest/meta -> intervals). Pusty tekst oznacza brak interwału.`,
      };
    }
  }

  const stare = await db
    .select({ id: screenshots.id, file: screenshots.file, thumbnail: screenshots.thumbnail })
    .from(screenshots)
    .where(and(eq(screenshots.tradeId, tradeId), eq(screenshots.origin, origin)));

  // Limit liczymy od tego, co ZOSTAJE (inne pochodzenie), bo stare zrzuty tego
  // pochodzenia zaraz znikna.
  const zostaje = (await policzZrzuty(tradeId)) - stare.length;
  const limit = bladLimitu(zostaje, pliki.length);
  if (limit) {
    return {
      ok: false,
      status: 422,
      error: `${limit} Na tym trade'cie jest ${zostaje} zrzutów innego pochodzenia, a wysyłasz ${pliki.length} (maksimum ${MAX_ZRZUTOW} łącznie).`,
    };
  }

  const bladZapisu = await wgrajZrzuty(
    tradeId,
    sparujZInterwalami(pliki, interwaly).map((p) => ({ file: p.plik, interval: p.interval })),
    origin,
  );
  if (bladZapisu) {
    // Czesc nowych plikow mogla juz wejsc; ponowienie zapytania zastapi je razem ze starymi.
    return {
      ok: false,
      status: 500,
      error: `Zapis zrzutów przerwany: ${bladZapisu}. Ponów zapytanie - zastąpi także te, które zdążyły wejść.`,
    };
  }

  // Dopiero po udanym zapisie nowych kasujemy stare (wiersze i pliki).
  if (stare.length > 0) {
    await db.delete(screenshots).where(inArray(screenshots.id, stare.map((s) => s.id)));
    for (const s of stare) await deleteScreenshot(s.file, s.thumbnail);
  }

  const nowe = await db
    .select({
      id: screenshots.id,
      file: screenshots.file,
      thumbnail: screenshots.thumbnail,
      interval: screenshots.interval,
      origin: screenshots.origin,
    })
    .from(screenshots)
    .where(and(eq(screenshots.tradeId, tradeId), eq(screenshots.origin, origin)))
    .orderBy(screenshots.sortOrder, screenshots.id);

  return { ok: true, tradeId, origin, replaced: stare.length, screenshots: nowe };
}

/** Pochodzenie zrzutow: jawne z formularza albo ze zrodla trade'a. */
export async function ustalOrigin(
  tradeId: number,
  jawny: string | null,
): Promise<{ ok: true; origin: OriginAPI } | { ok: false; error: string }> {
  if (jawny !== null && jawny !== "") {
    if (jawny === "tradingview" || jawny === "fxreplay") return { ok: true, origin: jawny };
    return {
      ok: false,
      error: `pole origin: »${jawny}« - dozwolone tradingview albo fxreplay (zrzuty ręczne wgrywa się w aplikacji).`,
    };
  }
  const [t] = await db.select({ source: trades.source }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  if (t && (t.source === "tradingview" || t.source === "fxreplay")) return { ok: true, origin: t.source };
  return {
    ok: false,
    error: `Trade #${tradeId} nie pochodzi z API (źródło: ${t?.source ?? "brak trade'a"}), więc podaj pole origin = tradingview albo fxreplay.`,
  };
}
