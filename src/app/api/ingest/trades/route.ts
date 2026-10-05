import { czytajJson } from "@/lib/ingest/body";
import { blad, odpowiedz } from "@/lib/ingest/http";
import { KopertaTradowSchema, opiszBledyZod, REGEX_EXTERNAL_REF } from "@/lib/ingest/schema";
import { listaTradowZApi, przetworzTrady } from "@/lib/ingest/trades";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

/**
 * GET /api/ingest/trades?refs=tv:1,fxr:2&source=fxreplay&after=0&limit=100
 * Trady zapisane przez API wraz ze skrotem tresci i znacznikiem edycji w aplikacji.
 */
export const GET = withIngest(async (request) => {
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
});

/**
 * POST /api/ingest/trades
 * { "dryRun": false, "mode": "create" | "update", "trades": [ ... max 50 ... ] }
 */
export const POST = withIngest(async (request) => {
  const cialo = await czytajJson(request);
  if (!cialo.ok) {
    return blad(cialo.status, cialo.status === 413 ? "payload_too_large" : "bad_request", cialo.error);
  }

  const koperta = KopertaTradowSchema.safeParse(cialo.dane);
  if (!koperta.success) {
    const errors = opiszBledyZod(koperta.error, cialo.dane);
    return blad(400, "validation_failed", `Nieprawidłowa koperta zapytania: ${errors[0]}`, { errors });
  }

  const { summary, results } = await przetworzTrady(koperta.data);
  return odpowiedz({ dryRun: koperta.data.dryRun, mode: koperta.data.mode, summary, results });
});
