import { obsluzSesje } from "@/lib/api-v2/handlery";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/** POST /api/v2/backtest-sessions: tworzy sesje albo odnajduje ja po externalRef (201 / 200). */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => obsluzSesje(request, api.zapis));
