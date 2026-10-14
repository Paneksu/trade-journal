import { blad, odpowiedz } from "@/lib/api-v2/http";
import { szczegolySetupu } from "@/lib/api-v2/setupy";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/v2/setups/:slug: karta setupu - wersje, przyklady A+ i anty-przyklady, statystyka z
 * przedzialami osobno dla zrodel danych (backtest / forward / demo / live), status wg progow
 * zadeklarowanych z gory i ile R znika miedzy backtestem a live.
 */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const slug = (await params).slug;
  const s = await szczegolySetupu(db, slug);
  if (!s) return blad(404, "not_found", "Setup »" + slug.slice(0, 80) + "« nie istnieje (lista: GET /api/v2/setups).");
  return odpowiedz(s);
});
