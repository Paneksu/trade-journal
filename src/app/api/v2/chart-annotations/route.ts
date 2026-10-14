import { AdnotacjeListaQuery, AdnotacjeZapisSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaAdnotacji, zapiszAdnotacje } from "@/lib/api-v2/adnotacje";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/chart-annotations?tradeId=&sessionId=&day=: Twoje rysunki z wykresu z tekstem dokladnie jak go napisales. */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, AdnotacjeListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaAdnotacji(db, q.dane));
});

/**
 * POST /api/v2/chart-annotations: paczka rysunkow uzytkownika (tj chart drawings). Tekst rysunku idzie
 * BAJT W BAJT jako slowa uzytkownika (z sha256 liczonym u klienta i sprawdzanym w bazie). Rysunki AI
 * (tekst zaczyna sie od [AI] ) sa odrzucane. Ponowne wyslanie nie dubluje; zmieniony tekst to nowa wersja slow.
 */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => {
  const w = await wczytajCialo(request, AdnotacjeZapisSchema, "Nieprawidłowa paczka adnotacji");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => zapiszAdnotacje(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz({ results: wynik.results, summary: wynik.summary }, wynik.summary.created > 0 ? 201 : 200);
});
