import { odpowiedz } from "@/lib/api-v2/http";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/** GET /api/v2/me: kim jest ten token (id, nazwa, zakresy, aktor zapisu). Nie ujawnia sekretu ani skrotu. */
export const GET = withApi({ scopes: ["read"] }, async (_request, api) =>
  odpowiedz({
    tokenId: api.token.id,
    name: api.token.name,
    scopes: api.token.scopes,
    actor: api.actor,
    serverTime: new Date().toISOString(),
  }),
);
