import { PropStatusQuery } from "@/lib/api-v2/contract/funkcje";
import { bezOk, blad, odpowiedz } from "@/lib/api-v2/http";
import { statusKonta } from "@/lib/api-v2/prop-konta";
import { idZAdresu, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/prop/accounts/:id/status?day=&riskCents=|planId=: bufor do limitu dziennego i
 * drawdownu w centach i w R, bufor »gdy trafi SL« przed wejsciem, ostrzezenia 50/75/90%,
 * consistency, cel i ekspozycja. Tylko ostrzezenia, bez blokad.
 */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (request, _api, { params }) => {
  const id = idZAdresu((await params).id, "id konta");
  if (!id.ok) return id.odpowiedz;
  const q = wczytajQuery(request, PropStatusQuery);
  if (!q.ok) return q.odpowiedz;
  if (q.dane.riskCents !== undefined && q.dane.planId !== undefined) {
    return blad(400, "bad_request", "Podaj riskCents albo planId, nie oba naraz: ryzyko planowanego trade'u ma jedno źródło.");
  }
  const w = await statusKonta(db, id.dane, q.dane);
  if (!w.ok) return blad(w.status, w.kod, w.komunikat);
  return odpowiedz(bezOk(w));
});
