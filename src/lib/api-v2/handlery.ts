import "server-only";

import { czytajMultipart } from "./body";
import { REGEX_EXTERNAL_REF } from "./contract/schemas";
import {
  KopertaTradowSchema,
  OcenaSchema,
  OminieciaSchema,
  SesjaSchema,
} from "./contract/schemas";
import { blad, odpowiedz } from "./http";
import { zapiszOcene } from "./oceny";
import { zapiszPominiecia } from "./pominiecia";
import { znajdzLubUtworzSesje } from "./sesje";
import { listaTradowZApi, przetworzTrady } from "./trades";
import { wczytajCialo, idZAdresu } from "./walidacja";
import type { Zapis } from "./zapis";
import { ustalOrigin, wczytajMetaZrzutow, zastapZrzuty } from "./zrzuty";

/**
 * Wspolne cialo handlerow dla `/api/ingest/**` (zakres wygaszany, ADR-030) i
 * `/api/v2/**`. Logika zyje tutaj raz: obie rodziny tras sa cienkimi
 * opakowaniami z wlasna brama (`withIngest` / `withApi`), wiec nie rozjada sie
 * zachowanie, gdy ktoras z nich zostanie usunieta.
 */

/**
 * GET trades?refs=tv:1,fxr:2&source=fxreplay&after=0&limit=100
 * Trady zapisane przez API wraz ze skrotem tresci i znacznikiem edycji w aplikacji.
 */
export async function obsluzTradesGet(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;

  const refsRaw = q.get("refs");
  const refs = refsRaw
    ? refsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (refs.length > 100) {
    return blad(400, "bad_request", `Parametr refs ma ${refs.length} kluczy, a limit to 100. Podziel zapytanie.`);
  }
  const zly = refs.find((r) => !REGEX_EXTERNAL_REF.test(r));
  if (zly) {
    return blad(400, "bad_request", `refs: »${zly}« nie ma formatu tv:<id> ani fxr:<id>.`);
  }

  const source = q.get("source");
  if (source !== null && source !== "tradingview" && source !== "fxreplay") {
    return blad(400, "bad_request", `source: »${source}« - dozwolone tradingview albo fxreplay.`);
  }

  const after = q.get("after") === null ? 0 : Number(q.get("after"));
  const limit = q.get("limit") === null ? 100 : Number(q.get("limit"));
  if (!Number.isInteger(after) || after < 0) {
    return blad(
      400,
      "bad_request",
      `after: »${q.get("after")}« - oczekiwano liczby całkowitej >= 0 (id ostatniego trade'a z poprzedniej strony).`,
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return blad(400, "bad_request", `limit: »${q.get("limit")}« - oczekiwano liczby całkowitej od 1 do 500.`);
  }

  return odpowiedz(await listaTradowZApi({ refs, source, after, limit }));
}

/** POST trades { "dryRun": false, "mode": "create" | "update", "trades": [ ... max 50 ... ] } */
export async function obsluzTradesPost(request: Request, zapis: Zapis): Promise<Response> {
  const w = await wczytajCialo(request, KopertaTradowSchema, "Nieprawidłowa koperta zapytania");
  if (!w.ok) return w.odpowiedz;

  const { summary, results } = await przetworzTrady(w.dane, zapis);
  return odpowiedz({ dryRun: w.dane.dryRun, mode: w.dane.mode, summary, results });
}

/**
 * POST trades/:id/reviews. Ocena AI z regulami (kopia tresci reguly + werdykt +
 * dowod). Jedna ocena na `basis` (chart | history). Bez pola `evidence`: ponowne wyslanie
 * podmienia (ADR-028), a zdanie uzytkownika o regule zostaje, jesli werdykt AI sie nie zmienil.
 * Z polem `evidence` (swiece + sha256 zrzutow): werdykt NIEZMIENNY z `as_of` (ADR-033);
 * ta sama tresc wyslana ponownie to 200, inna to 409, a korekta uzytkownika to nowy wiersz
 * (POST .../reviews/:reviewId/override).
 */
export async function obsluzOcene(request: Request, idRaw: string, zapis: Zapis, tokenId: number | null = null): Promise<Response> {
  const id = idZAdresu(idRaw, "id trade'a");
  if (!id.ok) return id.odpowiedz;

  const w = await wczytajCialo(request, OcenaSchema, "Nieprawidłowa ocena");
  if (!w.ok) return w.odpowiedz;

  const wynik = await zapiszOcene(id.dane, w.dane, zapis, tokenId);
  if (!wynik.ok) return blad(wynik.status, wynik.kod ?? "not_found", wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(wynik, wynik.created ? 201 : 200);
}

/**
 * POST trades/:id/screenshots (multipart/form-data)
 *   shot      - plik, powtarzalne (do 8)
 *   interval  - interwal, powtarzalne, po jednym na plik w tej samej kolejnosci (puste = brak)
 *   origin    - tradingview | fxreplay (domyslnie zrodlo trade'a)
 *   capturedAt - ISO 8601 z offsetem, powtarzalne, po jednym na plik (kiedy zrobiono zrzut; brak = teraz)
 *   chartState - obiekt JSON jako tekst, powtarzalny, po jednym na plik (symbol, interwal, zakres z `tj shot`)
 * Zrzuty AI (tradingview / fxreplay) zastepuja wszystkie zrzuty tego pochodzenia na trade'cie;
 * origin = manual (zdjecie od uzytkownika) tylko DOPISUJE i niczego nie kasuje.
 */
export async function obsluzZrzuty(request: Request, idRaw: string, zapis: Zapis, requestId?: string): Promise<Response> {
  const id = idZAdresu(idRaw, "id trade'a");
  if (!id.ok) return id.odpowiedz;

  const cialo = await czytajMultipart(request);
  if (!cialo.ok) {
    return blad(cialo.status, cialo.status === 413 ? "payload_too_large" : "bad_request", cialo.error);
  }

  const form = cialo.formData;
  const pliki = form.getAll("shot").filter((w): w is File => w instanceof File && w.size > 0);
  const interwaly = form.getAll("interval").map((w) => String(w));
  const origin = form.get("origin");

  const o = await ustalOrigin(id.dane, typeof origin === "string" ? origin : null);
  if (!o.ok) return blad(400, "bad_request", o.error);

  const meta = wczytajMetaZrzutow(form);
  if (!meta.ok) return blad(400, "bad_request", meta.error);

  const wynik = await zastapZrzuty(id.dane, o.origin, pliki, interwaly, zapis, meta.meta, requestId);
  if (!wynik.ok) {
    const kod = wynik.status === 404 ? "not_found" : wynik.status === 500 ? "internal_error" : "validation_failed";
    return blad(wynik.status, kod, wynik.error);
  }
  return odpowiedz(wynik);
}

/** POST backtest-sessions: tworzy sesje albo odnajduje ja po externalRef (201 nowa, 200 istniejaca). */
export async function obsluzSesje(request: Request, zapis: Zapis): Promise<Response> {
  const w = await wczytajCialo(request, SesjaSchema, "Nieprawidłowa sesja");
  if (!w.ok) return w.odpowiedz;

  const wynik = await znajdzLubUtworzSesje(w.dane, zapis);
  if (!wynik.ok) return blad(wynik.status, "validation_failed", wynik.error);
  return odpowiedz(
    {
      id: wynik.id,
      created: wynik.created,
      kind: wynik.session.kind,
      externalRef: wynik.session.externalRef,
      name: wynik.session.name,
      warnings: wynik.warnings,
    },
    wynik.created ? 201 : 200,
  );
}

/** POST skips { "skips": [ { "externalRef": "tv:123", "note": "..." } ] } */
export async function obsluzPominiecia(request: Request, zapis: Zapis): Promise<Response> {
  const w = await wczytajCialo(request, OminieciaSchema, "Nieprawidłowa lista pominięć");
  if (!w.ok) return w.odpowiedz;
  return odpowiedz({ results: await zapiszPominiecia(w.dane.skips, zapis) });
}
