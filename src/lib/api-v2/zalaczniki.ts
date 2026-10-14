import "server-only";
import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { notes, screenshots } from "@/lib/db/schema";
import { czyInterwal, sparujZInterwalami } from "@/lib/domain/interwaly";
import { bladPliku, bladZawartosci } from "@/lib/screenshots";
import { bladLimitu, MAX_ZRZUTOW } from "@/lib/screenshots-limit";
import { policzZalaczniki, wgrajZalaczniki, type OriginZrzutu } from "@/lib/trades/screenshots-db";
import type { ShotOwner } from "@/lib/uploads-path";

import { czytajMultipart } from "./body";
import { zapiszDzien } from "./dni";
import { blad, odpowiedz } from "./http";
import { wczytajMetaZrzutow } from "./zrzuty";
import type { Zapis } from "./zapis";

/**
 * Zalaczniki notatek i dni (backlog z lacznika): `POST /notes/:id/attachments` i
 * `POST /days/:date/attachments`. Format PNG, JPG, WebP, AVIF i HEIC (zdjecie z telefonu);
 * serwer robi z niego WebP + miniature, zdejmuje EXIF i zapisuje SHA-256 pliku wgranego.
 * Zalaczniki sa tylko DOPISYWANE (limit 8 na wlasciciela) - zadnego zastepowania.
 *
 * multipart/form-data:
 *   shot       plik, powtarzalne (do 8)
 *   interval   interwal, powtarzalne, po jednym na plik (puste = brak)
 *   caption    podpis, powtarzalne, po jednym na plik (do 500 znakow; puste = brak)
 *   capturedAt ISO 8601 z offsetem, powtarzalne, po jednym na plik
 *   chartState obiekt JSON jako tekst, powtarzalny, po jednym na plik
 *   origin     manual (domyslnie: zdjecie od uzytkownika) | tradingview | fxreplay
 * Dla dnia dodatkowo accountId albo sessionId (do ktorej notatki dnia nalezy zalacznik).
 */

type Wlasciciel = { rodzaj: "note"; id: number } | { rodzaj: "day"; data: string; accountId: number | null; sessionId: number | null };

const ORIGINY: readonly OriginZrzutu[] = ["manual", "tradingview", "fxreplay"];

export async function dolaczZalaczniki(request: Request, w: Wlasciciel, zapis: Zapis): Promise<Response> {
  const cialo = await czytajMultipart(request);
  if (!cialo.ok) return blad(cialo.status, cialo.status === 413 ? "payload_too_large" : "bad_request", cialo.error);
  const form = cialo.formData;

  const pliki = form.getAll("shot").filter((x): x is File => x instanceof File && x.size > 0);
  if (pliki.length === 0) return blad(400, "bad_request", "Brak plików. Wyślij pola »shot« (jedno na plik) w multipart/form-data.");
  const interwaly = form.getAll("interval").map((x) => String(x));
  const podpisy = form.getAll("caption").map((x) => String(x));
  const origin = String(form.get("origin") ?? "manual") as OriginZrzutu;
  if (!ORIGINY.includes(origin)) {
    return blad(400, "bad_request", `pole origin: »${origin.slice(0, 30)}« - dozwolone manual (zdjęcie od użytkownika), tradingview albo fxreplay.`);
  }
  for (const [i, wartosc] of interwaly.entries()) {
    if (wartosc !== "" && !czyInterwal(wartosc)) {
      return blad(422, "validation_failed", `interval #${i + 1}: »${wartosc}« nie jest interwałem z listy (GET /api/v2/meta -> intervals). Pusty tekst oznacza brak interwału.`);
    }
  }
  for (const [i, p] of podpisy.entries()) {
    if (p.length > 500) return blad(400, "bad_request", `caption #${i + 1}: ${p.length} znaków, limit to 500.`);
  }
  const meta = wczytajMetaZrzutow(form);
  if (!meta.ok) return blad(400, "bad_request", meta.error);
  for (let i = 0; i < pliki.length; i += 1) {
    const b = bladPliku(pliki[i]) ?? (await bladZawartosci(pliki[i]));
    if (b) return blad(422, "validation_failed", `shot #${i + 1}: ${b}`);
  }

  // Wlasciciel: notatka albo notatka dnia (zakladana, gdy jeszcze jej nie ma).
  let owner: ShotOwner;
  if (w.rodzaj === "note") {
    const [n] = await db.select({ id: notes.id }).from(notes).where(eq(notes.id, w.id)).limit(1);
    if (!n) return blad(404, "not_found", `Notatka #${w.id} nie istnieje.`);
    owner = { kind: "note", id: w.id };
  } else {
    const dzien = await zapiszDzien(w.data, { accountId: w.accountId, sessionId: w.sessionId }, zapis);
    if (!dzien.ok) return blad(dzien.status, dzien.kod, dzien.komunikat);
    owner = { kind: "day", id: dzien.id };
  }

  const juz = await policzZalaczniki(owner);
  const limit = bladLimitu(juz, pliki.length);
  if (limit) return blad(422, "validation_failed", `${limit} Dopisujesz ${pliki.length}, a jest już ${juz} (maksimum ${MAX_ZRZUTOW}).`);

  const ids: number[] = [];
  const bladZapisu = await wgrajZalaczniki(
    owner,
    sparujZInterwalami(pliki, interwaly).map((p, i) => ({
      file: p.plik,
      interval: p.interval,
      caption: (podpisy[i] ?? "") === "" ? null : podpisy[i],
      capturedAt: meta.meta.capturedAt[i] ?? null,
      chartState: meta.meta.chartState[i] ?? null,
    })),
    origin,
    zapis,
    ids,
  );
  if (bladZapisu) {
    return blad(
      500,
      "internal_error",
      `Zapis załączników przerwany: ${bladZapisu}. Część plików mogła już wejść (${ids.length} z ${pliki.length}); sprawdź listę przed ponowieniem, żeby nie dublować.`,
      { saved: ids.length },
    );
  }

  const wiersze = ids.length
    ? await db
        .select({ id: screenshots.id, file: screenshots.file, thumbnail: screenshots.thumbnail, interval: screenshots.interval, origin: screenshots.origin, sha256: screenshots.sha256, caption: screenshots.caption, width: screenshots.width, height: screenshots.height })
        .from(screenshots)
        .where(inArray(screenshots.id, ids))
        .orderBy(asc(screenshots.sortOrder), asc(screenshots.id))
    : [];
  return odpowiedz(
    {
      owner: w.rodzaj === "note" ? { type: "note", id: w.id } : { type: "day", date: w.data, dayNoteId: owner.id },
      screenshots: wiersze,
    },
    201,
  );
}
