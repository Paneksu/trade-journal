import { LukaUtworzSchema, LukiListaQuery } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaLuk, utworzLuke } from "@/lib/api-v2/luki";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi, wymagajImportuDlaOrigin } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/strategy-gaps?kind=gap|mentor_conflict&status=: luki w strategii i kolejka »Do rozstrzygniecia«
 * (sprzecznosci mentor kontra praktyka, z cytatem mentora i linkiem t=).
 */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, LukiListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaLuk(db, q.dane));
});

/**
 * POST /api/v2/strategy-gaps: zglasza pytanie o luke albo sprzecznosc. AI jej NIE rozstrzyga: odpowiada
 * wylacznie uzytkownik w aplikacji (zostaje moj / biore mentora / oba z warunkiem). To samo pytanie
 * nie powstaje drugi raz, dopoki jest otwarte, ani po rozstrzygnieciu.
 */
export const POST = withApi({ scopes: ["propose"] }, async (request, api) => {
  const w = await wczytajCialo(request, LukaUtworzSchema, "Nieprawidłowe pytanie o lukę");
  if (!w.ok) return w.odpowiedz;
  const bezImportu = wymagajImportuDlaOrigin(api, w.dane.origin);
  if (bezImportu) return bezImportu;
  const wynik = await api.zapis((tx) => utworzLuke(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz({ created: wynik.utworzona, id: wynik.luka.id, kind: wynik.luka.kind, status: wynik.luka.status }, wynik.utworzona ? 201 : 200);
});
