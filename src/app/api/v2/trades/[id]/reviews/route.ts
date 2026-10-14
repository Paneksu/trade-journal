import { obsluzOcene } from "@/lib/api-v2/handlery";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/trades/:id/reviews (application/json). Ocena AI z regulami.
 * UWAGA (faza 2b): werdykt z `as_of` stanie sie tu niezmienny (409 przy ponownym
 * wyslaniu, korekta = user_override); do czasu migracji 0021 obowiazuje zasada
 * z ADR-028 - jedna ocena na podstawe, ponowne wyslanie podmienia.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) =>
  obsluzOcene(request, (await params).id, api.zapis),
);
