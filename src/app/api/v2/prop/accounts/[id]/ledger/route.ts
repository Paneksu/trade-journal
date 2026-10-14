import { PropKsiegaWpisSchema } from "@/lib/api-v2/contract/funkcje";
import { bezOk, blad, odpowiedz } from "@/lib/api-v2/http";
import { dodajWpisKsiegi, ksiegaKonta } from "@/lib/api-v2/prop-konta";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v2/prop/accounts/:id/ledger: ksiega kosztow (evale, resety, aktywacje) i wyplat z realnym zwrotem netto. */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const id = idZAdresu((await params).id, "id konta");
  if (!id.ok) return id.odpowiedz;
  const w = await ksiegaKonta(db, id.dane);
  if (!w.ok) return blad(w.status, w.kod, w.komunikat);
  return odpowiedz(bezOk(w));
});

/**
 * POST /api/v2/prop/accounts/:id/ledger: wpis do ksiegi (koszt ujemny, wyplata i zwrot dodatnie, w centach).
 * Identyczny wpis z ostatniej minuty to ten sam wpis (200), zeby podwojne wyslanie nie dublowalo kosztow.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id konta");
  if (!id.ok) return id.odpowiedz;
  const w = await wczytajCialo(request, PropKsiegaWpisSchema, "Nieprawidłowy wpis księgi");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => dodajWpisKsiegi(tx, id.dane, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz({ created: wynik.utworzony, entry: wynik.wpis }, wynik.utworzony ? 201 : 200);
});
