import { blad, odpowiedz } from "@/lib/api-v2/http";
import { oznaczJakoZadana } from "@/lib/api-v2/luki";
import { idZAdresu } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v2/strategy-gaps/:id/ask: rytual po sesji zadal to pytanie uzytkownikowi (open -> asked). Odpowiedz jest tylko w aplikacji. */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (_request, api, { params }) => {
  const id = idZAdresu((await params).id, "id pytania");
  if (!id.ok) return id.odpowiedz;
  const wynik = await api.zapis((tx) => oznaczJakoZadana(tx, id.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz({ id: wynik.luka.id, status: wynik.luka.status, askedAt: wynik.luka.askedAt?.toISOString() ?? null });
});
