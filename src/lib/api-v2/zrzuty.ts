import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { screenshots, trades } from "@/lib/db/schema";
import { czyInterwal, sparujZInterwalami } from "@/lib/domain/interwaly";
import { bladPliku, bladZawartosci, deleteScreenshot } from "@/lib/screenshots";
import { bladLimitu, MAX_ZRZUTOW } from "@/lib/screenshots-limit";
import { policzZrzuty, wgrajZrzuty, type OriginZrzutu } from "@/lib/trades/screenshots-db";

import type { Zapis } from "./zapis";

/**
 * Zrzuty z API (ADR-026): zrzuty AI (`tradingview`, `fxreplay`) ZASTEPUJA wszystkie zrzuty
 * tego samego pochodzenia na tym trade'cie, a zrzutow recznych (`manual`) i cudzego
 * pochodzenia nie dotykaja nigdy. Ponowne wyslanie tej samej paczki daje ten sam stan.
 *
 * Zdjecie od uzytkownika (`origin = manual`, faza 2b) jest DOPISYWANE: nigdy nie kasuje
 * zrzutow AI ani wczesniejszych zdjec. To dowod rownorzedny ze zrzutem AI, oznaczony
 * pochodzeniem; kolejnosc na liscie to kolejnosc wgrywania. Skrot pliku (`sha256`, z bajtow
 * wgranego pliku) trafia do odpowiedzi, zeby werdykt AI mogl na niego wskazac.
 */

export type WynikZrzutow =
  | {
      ok: true;
      tradeId: number;
      origin: OriginZrzutu;
      replaced: number;
      screenshots: { id: number; file: string; thumbnail: string | null; interval: string | null; origin: string; sha256: string | null }[];
    }
  | { ok: false; status: 400 | 404 | 409 | 422 | 500; error: string };

/** Pochodzenie zrzutu przyjmowane przez API: AI (tradingview / fxreplay) albo zdjecie od uzytkownika (manual). */
export type OriginAPI = OriginZrzutu;

export type MetaZrzutow = { capturedAt: (Date | null)[]; chartState: (Record<string, unknown> | null)[] };

export async function zastapZrzuty(
  tradeId: number,
  origin: OriginAPI,
  pliki: File[],
  interwaly: string[],
  zapis: Zapis,
  meta: MetaZrzutow = { capturedAt: [], chartState: [] },
  requestId?: string,
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
    const b = bladPliku(pliki[i]) ?? (await bladZawartosci(pliki[i]));
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

  // Zdjecie od uzytkownika (manual) tylko dopisujemy; zrzuty AI zastepuja swoje poprzednie wydanie.
  const stare =
    origin === "manual"
      ? []
      : await db
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
      error:
        origin === "manual"
          ? `${limit} Na tym trade'cie jest już ${zostaje} zrzutów, a dopisujesz ${pliki.length} (maksimum ${MAX_ZRZUTOW} łącznie; zdjęcia od użytkownika niczego nie zastępują).`
          : `${limit} Na tym trade'cie jest ${zostaje} zrzutów innego pochodzenia, a wysyłasz ${pliki.length} (maksimum ${MAX_ZRZUTOW} łącznie).`,
    };
  }

  const przekroczonyLimit = { wartosc: false };
  const bladZapisu = await wgrajZrzuty(
    tradeId,
    sparujZInterwalami(pliki, interwaly).map((p, i) => ({
      file: p.plik,
      interval: p.interval,
      capturedAt: meta.capturedAt[i] ?? null,
      chartState: meta.chartState[i] ?? null,
    })),
    origin,
    zapis,
    undefined,
    { requestId, zastepujeOrigin: origin === "manual" ? undefined : origin, przekroczonyLimit },
  );
  if (bladZapisu) {
    // Czesc nowych plikow mogla juz wejsc; ponowienie zapytania zastapi je razem ze starymi.
    if (przekroczonyLimit.wartosc) return { ok: false, status: 422, error: bladZapisu };
    return {
      ok: false,
      status: 500,
      error: `Zapis zrzutów przerwany: ${bladZapisu}. Ponów zapytanie - zastąpi także te, które zdążyły wejść.`,
    };
  }

  // Dopiero po udanym zapisie nowych kasujemy stare (wiersze i pliki).
  if (stare.length > 0) {
    await zapis((tx) => tx.delete(screenshots).where(inArray(screenshots.id, stare.map((s) => s.id))));
    for (const s of stare) await deleteScreenshot(s.file, s.thumbnail);
  }

  const nowe = await db
    .select({
      id: screenshots.id,
      file: screenshots.file,
      thumbnail: screenshots.thumbnail,
      interval: screenshots.interval,
      origin: screenshots.origin,
      sha256: screenshots.sha256,
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
    if (jawny === "tradingview" || jawny === "fxreplay" || jawny === "manual") return { ok: true, origin: jawny };
    return {
      ok: false,
      error: `pole origin: »${jawny}« - dozwolone tradingview, fxreplay (zrzuty AI, zastępują swoje poprzednie wydanie) albo manual (zdjęcie od użytkownika, tylko dopisywane).`,
    };
  }
  const [t] = await db.select({ source: trades.source }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  if (t && (t.source === "tradingview" || t.source === "fxreplay")) return { ok: true, origin: t.source };
  return {
    ok: false,
    error: `Trade #${tradeId} nie pochodzi z API (źródło: ${t?.source ?? "brak trade'a"}), więc podaj pole origin = tradingview albo fxreplay.`,
  };
}

/** Pola `capturedAt` i `chartState` z formularza zrzutow: po jednym na plik, w tej samej kolejnosci. */
export function wczytajMetaZrzutow(form: FormData): { ok: true; meta: MetaZrzutow } | { ok: false; error: string } {
  const capturedAt: (Date | null)[] = [];
  for (const [i, w] of form.getAll("capturedAt").entries()) {
    const tekst = String(w);
    if (tekst === "") {
      capturedAt.push(null);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(tekst) || Number.isNaN(Date.parse(tekst))) {
      return { ok: false, error: `capturedAt #${i + 1}: »${tekst.slice(0, 40)}« - oczekiwano ISO 8601 z offsetem, np. 2026-03-10T09:35:00-04:00.` };
    }
    capturedAt.push(new Date(tekst));
  }
  const chartState: (Record<string, unknown> | null)[] = [];
  for (const [i, w] of form.getAll("chartState").entries()) {
    const tekst = String(w);
    if (tekst === "") {
      chartState.push(null);
      continue;
    }
    if (tekst.length > 4_000) return { ok: false, error: `chartState #${i + 1}: ${tekst.length} znaków, limit to 4000.` };
    try {
      const j: unknown = JSON.parse(tekst);
      if (j === null || typeof j !== "object" || Array.isArray(j)) throw new Error("oczekiwano obiektu JSON");
      chartState.push(j as Record<string, unknown>);
    } catch (e) {
      return { ok: false, error: `chartState #${i + 1}: ${(e as Error).message}. Wyślij obiekt JSON jako tekst, np. {"symbol":"NQ1!","interval":"5m"}.` };
    }
  }
  return { ok: true, meta: { capturedAt, chartState } };
}
