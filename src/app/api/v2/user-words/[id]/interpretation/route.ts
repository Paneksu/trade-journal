import { InterpretacjaSchema } from "@/lib/api-v2/contract/v2";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { ustawInterpretacje, zSlow } from "@/lib/api-v2/slowa";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/v2/user-words/:id/interpretation { text, model }: jedyna zmienna czesc slow
 * uzytkownika. Ustawiana raz; w UI zawsze podpisana "interpretacja AI".
 */
export const PUT = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id słów użytkownika");
  if (!id.ok) return id.odpowiedz;
  const w = await wczytajCialo(request, InterpretacjaSchema, "Nieprawidłowa interpretacja");
  if (!w.ok) return w.odpowiedz;

  const wynik = await api.zapis((tx) => ustawInterpretacje(tx, id.dane, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz(zSlow(wynik.slowa));
});
