import { PlanUtworzSchema, PlanyListaQuery } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaPlanow, szczegolyPlanu, utworzPlan } from "@/lib/api-v2/plany";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/trade-plans?tradeId=&accountId=&day=: zamrozone plany (bez dopiskow; szczegoly: /trade-plans/:id). */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, PlanyListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaPlanow(db, q.dane));
});

/**
 * POST /api/v2/trade-plans: zamraza plan PRZED wejsciem. Zapis jest jednorazowy - potem plan
 * sie nie zmienia (PATCH i PUT daja 409), a zmiany ida jako dopiski z czasem i slowami
 * uzytkownika (POST /trade-plans/:id/addenda). Ryzyko liczy computeTrade. Ten sam plan wyslany
 * ponownie to 200 z tym samym id.
 */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => {
  const w = await wczytajCialo(request, PlanUtworzSchema, "Nieprawidłowy plan");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => utworzPlan(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  const szczegoly = await szczegolyPlanu(db, wynik.plan.id);
  return odpowiedz({ created: wynik.utworzony, warnings: wynik.ostrzezenia, plan: szczegoly }, wynik.utworzony ? 201 : 200);
});
