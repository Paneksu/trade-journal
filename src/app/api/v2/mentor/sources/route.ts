import { MentorZrodlaListaQuery, MentorZrodloSchema } from "@/lib/api-v2/contract/funkcje";
import { odpowiedz } from "@/lib/api-v2/http";
import { listaZrodel, zapiszZrodlo, zZrodla } from "@/lib/api-v2/mentor";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/mentor/sources?status=: filmy playlisty mentora ze statusem (zakres import). */
export const GET = withApi({ scopes: ["read", "import"] }, async (request) => {
  const q = wczytajQuery(request, MentorZrodlaListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaZrodel(db, q.dane));
});

/** POST /api/v2/mentor/sources: rejestruje film (idempotentnie po id filmu; tj mentor sync). Zakres import. */
export const POST = withApi({ scopes: ["write", "import"] }, async (request, api) => {
  const w = await wczytajCialo(request, MentorZrodloSchema, "Nieprawidłowy film mentora");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => zapiszZrodlo(tx, w.dane));
  return odpowiedz({ created: wynik.utworzone, source: zZrodla(wynik.zrodlo) }, wynik.utworzone ? 201 : 200);
});
