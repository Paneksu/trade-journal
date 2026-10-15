import { PlanDopisekSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { dopiszDoPlanu, zDopiska } from "@/lib/api-v2/plany";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/trade-plans/:id/addenda: dopisek do zamrozonego planu (np. przesuniety SL) z czasem
 * i slowami uzytkownika (wordsId). Plan zostaje nietkniety; dopiski tylko sie dopisuje.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id planu");
  if (!id.ok) return id.odpowiedz;
  const w = await wczytajCialo(request, PlanDopisekSchema, "Nieprawidłowy dopisek do planu");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => dopiszDoPlanu(tx, id.dane, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz(zDopiska(wynik.dopisek), wynik.utworzony ? 201 : 200);
});
