import { DopisekNotatkiSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { dodajDopisek, listaDopiskow, zDopiska } from "@/lib/api-v2/mentor";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi, wymagajImportuDlaOrigin } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v2/notes/:id/additions: dopiski AI i mentora do notatki (z podpisem pochodzenia). */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const id = idZAdresu((await params).id, "id notatki");
  if (!id.ok) return id.odpowiedz;
  return odpowiedz(await listaDopiskow(db, id.dane));
});

/**
 * POST /api/v2/notes/:id/additions: dopisek do notatki strategii albo karty setupu. Dopisek AI
 * wymaga trade'a i cytatu (slowa uzytkownika) albo dowodu; dopisek mentora wymaga twierdzenia
 * z cytatem i t= (i zakresu import). Regul nie zmienia: te ida przez propozycje.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id notatki");
  if (!id.ok) return id.odpowiedz;
  const w = await wczytajCialo(request, DopisekNotatkiSchema, "Nieprawidłowy dopisek");
  if (!w.ok) return w.odpowiedz;
  const bezImportu = wymagajImportuDlaOrigin(api, w.dane.origin);
  if (bezImportu) return bezImportu;

  const wynik = await api.zapis((tx) => dodajDopisek(tx, id.dane, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz(zDopiska(wynik.dopisek), 201);
});
