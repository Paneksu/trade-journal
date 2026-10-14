import { blad, odpowiedz } from "@/lib/api-v2/http";
import { szczegolyTradu } from "@/lib/api-v2/trade-szczegoly";
import { idZAdresu } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/trades/:id: trade ze zrzutami, ocenami AI (z regulami i flaga look-ahead), planem,
 * slowami uzytkownika, adnotacjami wykresu i powiazaniami. Gdy trade nie jest zamkniety, a ma
 * werdykt AI, wynik jest ukryty (resultHidden: true, result: null) - ocena powstaje przed wynikiem.
 */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const id = idZAdresu((await params).id, "id trade'a");
  if (!id.ok) return id.odpowiedz;
  const t = await szczegolyTradu(db, id.dane);
  if (!t) return blad(404, "not_found", "Trade #" + id.dane + " nie istnieje (mógł zostać skasowany w aplikacji).");
  return odpowiedz(t);
});
