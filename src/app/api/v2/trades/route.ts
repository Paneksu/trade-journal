import { obsluzTradesGet, obsluzTradesPost } from "@/lib/api-v2/handlery";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/** GET /api/v2/trades?refs=tv:1,fxr:2&source=fxreplay&after=0&limit=100 */
export const GET = withApi({ scopes: ["read"] }, async (request) => obsluzTradesGet(request));

/**
 * POST /api/v2/trades { "dryRun": false, "mode": "create" | "update", "trades": [ ... max 50 ... ] }
 * Zapis idzie przez persistTrade -> computeTrade (ADR-003); API nie liczy wyniku samo.
 */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => obsluzTradesPost(request, api.zapis));
