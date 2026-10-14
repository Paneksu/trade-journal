import { blad, odpowiedz } from "@/lib/api-v2/http";
import { szczegolyPlanu } from "@/lib/api-v2/plany";
import { idZAdresu } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v2/trade-plans/:id: plan z dopiskami, slowami uzytkownika (teza, uniewaznienie) i setupem. */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const id = idZAdresu((await params).id, "id planu");
  if (!id.ok) return id.odpowiedz;
  const p = await szczegolyPlanu(db, id.dane);
  if (!p) return blad(404, "not_found", "Plan #" + id.dane + " nie istnieje.");
  return odpowiedz(p);
});

/**
 * Zamrozony plan jest tylko do odczytu (baza odrzuca kazdy UPDATE poza przypieciem trade'u).
 * Ta trasa daje czytelne 409 z odeslaniem do dopiskow, zamiast 405.
 */
async function odmow(_request: Request, api: { requestId: string }, ctx: Ctx): Promise<Response> {
  const id = idZAdresu((await ctx.params).id, "id planu");
  if (!id.ok) return id.odpowiedz;
  return blad(
    409,
    "immutable",
    "Plan #" + id.dane + " jest zamrożony i nie można go zmienić: plan zapisuje się raz, przed wejściem, żeby dało się ocenić proces, a nie dopasowany po wyniku. Zmianę zapisz jako dopisek z czasem i słowami użytkownika: POST /api/v2/trade-plans/" + id.dane + "/addenda.",
    { planId: id.dane, useInstead: "/api/v2/trade-plans/" + id.dane + "/addenda", requestId: api.requestId },
  );
}

export const PATCH = withApi<Ctx>({ scopes: ["write"] }, odmow);
export const PUT = withApi<Ctx>({ scopes: ["write"] }, odmow);
