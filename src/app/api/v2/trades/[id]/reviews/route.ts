import { obsluzOcene } from "@/lib/api-v2/handlery";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/trades/:id/reviews (application/json). Ocena AI z regulami.
 * Z polem `evidence` werdykt jest niezmienny (as_of, evidence_hash; ponowne wyslanie innej
 * tresci = 409, korekta uzytkownika = POST .../:reviewId/override); bez niego obowiazuje
 * zasada z ADR-028 - jedna ocena na podstawe, ponowne wyslanie podmienia.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) =>
  obsluzOcene(request, (await params).id, api.zapis, api.token.id),
);
