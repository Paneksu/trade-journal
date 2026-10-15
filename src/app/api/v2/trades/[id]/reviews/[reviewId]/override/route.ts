import { KorektaWerdyktuSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { zapiszKorekte } from "@/lib/api-v2/oceny";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; reviewId: string }> };

/**
 * POST /api/v2/trades/:id/reviews/:reviewId/override: korekta werdyktu AI przez uzytkownika.
 * NOWY wiersz (kind = user_override, wskazuje werdykt AI), stary zostaje niezmieniony. Wymaga
 * slow uzytkownika (wordsId) uzasadniajacych korekte.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const p = await params;
  const trade = idZAdresu(p.id, "id trade'a");
  if (!trade.ok) return trade.odpowiedz;
  const review = idZAdresu(p.reviewId, "id werdyktu");
  if (!review.ok) return review.odpowiedz;
  const w = await wczytajCialo(request, KorektaWerdyktuSchema, "Nieprawidłowa korekta werdyktu");
  if (!w.ok) return w.odpowiedz;

  const wynik = await zapiszKorekte(trade.dane, review.dane, w.dane, api.zapis, api.token.id);
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  const { utworzona, ...cialo } = wynik;
  return odpowiedz(cialo, utworzona ? 201 : 200);
});
