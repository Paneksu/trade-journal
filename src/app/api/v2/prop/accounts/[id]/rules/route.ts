import { PropRegulyUtworzSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaRegulKonta, przypnijReguly } from "@/lib/api-v2/prop-konta";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v2/prop/accounts/:id/rules: reguly konta z datami obowiazywania (najnowsze pierwsze). */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const id = idZAdresu((await params).id, "id konta");
  if (!id.ok) return id.odpowiedz;
  const w = await listaRegulKonta(db, id.dane);
  if (!w.ok) return blad(w.status, w.kod, w.komunikat);
  return odpowiedz({ rules: w.rules });
});

/**
 * POST /api/v2/prop/accounts/:id/rules: przypina preset do konta od daty zakupu (validFrom) i
 * pozwala nadpisac kazda wartosc. Potwierdzenie wartosci z regulaminem (confirmedAt) robi
 * uzytkownik w aplikacji, nie klient API.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id konta");
  if (!id.ok) return id.odpowiedz;
  const w = await wczytajCialo(request, PropRegulyUtworzSchema, "Nieprawidłowe reguły konta");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => przypnijReguly(tx, id.dane, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(wynik.regula, 201);
});
