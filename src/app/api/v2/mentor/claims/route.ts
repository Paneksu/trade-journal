import { MentorTwierdzeniaListaQuery, MentorTwierdzeniaZapisSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaTwierdzen, zapiszTwierdzenia } from "@/lib/api-v2/mentor";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/mentor/claims?videoId=&status=: twierdzenia mentora z doslownym cytatem i linkiem t= (zakres import). */
export const GET = withApi({ scopes: ["read", "import"] }, async (request) => {
  const q = wczytajQuery(request, MentorTwierdzeniaListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaTwierdzen(db, q.dane));
});

/**
 * POST /api/v2/mentor/claims: paczka twierdzen z jednego filmu. Cytat idzie bajt w bajt (quoteSha256 z bajtow
 * UTF-8), idempotentnie po (film, skrot cytatu, t). Streszczenie nigdy nie zastepuje cytatu. Zakres import.
 */
export const POST = withApi({ scopes: ["write", "import"] }, async (request, api) => {
  const w = await wczytajCialo(request, MentorTwierdzeniaZapisSchema, "Nieprawidłowe twierdzenia mentora");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => zapiszTwierdzenia(tx, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz({ results: wynik.results, summary: wynik.summary }, wynik.summary.created > 0 ? 201 : 200);
});
