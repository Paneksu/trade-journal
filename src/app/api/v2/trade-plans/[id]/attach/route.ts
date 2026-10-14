import { PlanPrzypiecieSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { przypnijPlan, szczegolyPlanu } from "@/lib/api-v2/plany";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/trade-plans/:id/attach { tradeId }: przypina plan do trade'a, gdy ten powstal po
 * planie. To jedyna zmiana planu, jaka baza dopuszcza (trade_id z NULL na wartosc); wykonuje sie raz.
 * Konto, instrument, kierunek i dzien handlowy planu musza pasowac do trade'a.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id planu");
  if (!id.ok) return id.odpowiedz;
  const w = await wczytajCialo(request, PlanPrzypiecieSchema, "Nieprawidłowe przypięcie planu");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => przypnijPlan(tx, id.dane, w.dane.tradeId));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(await szczegolyPlanu(db, wynik.plan.id));
});
