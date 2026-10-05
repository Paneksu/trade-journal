import { czytajJson } from "@/lib/ingest/body";
import { blad, odpowiedz } from "@/lib/ingest/http";
import { zapiszPominiecia } from "@/lib/ingest/pominiecia";
import { OminieciaSchema, opiszBledyZod } from "@/lib/ingest/schema";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/skips  { "skips": [ { "externalRef": "tv:123", "note": "..." } ] }
 * Klient oznacza wpisy, których nie chce w dzienniku; kolejne POST /trades da `skipped`.
 */
export const POST = withIngest(async (request) => {
  const cialo = await czytajJson(request);
  if (!cialo.ok) {
    return blad(cialo.status, cialo.status === 413 ? "payload_too_large" : "bad_request", cialo.error);
  }

  const koperta = OminieciaSchema.safeParse(cialo.dane);
  if (!koperta.success) {
    const errors = opiszBledyZod(koperta.error, cialo.dane);
    return blad(400, "validation_failed", `Nieprawidłowa lista pominięć: ${errors[0]}`, { errors });
  }

  return odpowiedz({ results: await zapiszPominiecia(koperta.data.skips) });
});
