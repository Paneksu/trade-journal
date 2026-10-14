import { blad } from "@/lib/api-v2/http";
import { idZAdresu } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; reviewId: string }> };

/**
 * Werdykt AI z as_of jest NIEZMIENNY (ADR-033, MUST 2): baza odrzuca kazda zmiane jego tresci.
 * Ta trasa istnieje po to, zeby klient dostal czytelne 409 z odeslaniem do korekty, a nie 405.
 * Korekta uzytkownika to NOWY wiersz (kind = user_override): POST .../override.
 */
async function odmow(_request: Request, api: { requestId: string }, ctx: Ctx): Promise<Response> {
  const p = await ctx.params;
  const trade = idZAdresu(p.id, "id trade'a");
  if (!trade.ok) return trade.odpowiedz;
  const review = idZAdresu(p.reviewId, "id werdyktu");
  if (!review.ok) return review.odpowiedz;
  return blad(
    409,
    "immutable",
    "Werdykt #" + review.dane + " trade'a #" + trade.dane + " jest niezmienny: wydany przed wynikiem, z datą (as_of) i skrótem dowodów, więc nie można go poprawić. Jeśli się z nim nie zgadzasz, zapisz korektę użytkownika jako nowy wpis: POST /api/v2/trades/" + trade.dane + "/reviews/" + review.dane + "/override (werdykt AI zostaje jako dowód).",
    { tradeId: trade.dane, reviewId: review.dane, useInstead: "/api/v2/trades/" + trade.dane + "/reviews/" + review.dane + "/override", requestId: api.requestId },
  );
}

export const PATCH = withApi<Ctx>({ scopes: ["write"] }, odmow);
export const PUT = withApi<Ctx>({ scopes: ["write"] }, odmow);
