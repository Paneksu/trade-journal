import { obsluzZrzuty } from "@/lib/api-v2/handlery";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/trades/:id/screenshots (multipart/form-data: shot, interval, origin).
 * Zastepuje zrzuty tego samego pochodzenia na trade'cie; recznych nie rusza.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) =>
  obsluzZrzuty(request, (await params).id, api.zapis),
);
