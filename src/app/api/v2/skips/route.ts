import { obsluzPominiecia } from "@/lib/api-v2/handlery";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/** POST /api/v2/skips: klient oznacza wpisy, ktorych nie chce w dzienniku. */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => obsluzPominiecia(request, api.zapis));
