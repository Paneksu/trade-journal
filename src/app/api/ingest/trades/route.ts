import { obsluzTradesGet, obsluzTradesPost } from "@/lib/api-v2/handlery";
import { zapisIngest } from "@/lib/api-v2/zapis";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

/*
 * ZAKRES WYGASZANY (ADR-030): tresc zyje w lib/api-v2/handlery.ts i jest wspolna
 * z /api/v2/trades. Trasa zniknie po fazie 3, za zgoda uzytkownika.
 */

/** GET /api/ingest/trades?refs=tv:1,fxr:2&source=fxreplay&after=0&limit=100 */
export const GET = withIngest(async (request) => obsluzTradesGet(request));

/** POST /api/ingest/trades { "dryRun": false, "mode": "create" | "update", "trades": [ ... max 50 ... ] } */
export const POST = withIngest(async (request) => obsluzTradesPost(request, zapisIngest));
