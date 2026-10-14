import { SugestiaUtworzSchema, SugestieListaQuery } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaSugestii, utworzSugestie, zSugestii } from "@/lib/api-v2/sugestie";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/ai-suggestions?status=&kind=&tradeId=: kolejka potwierdzen AI z pochodzeniem, dowodem, pewnoscia i n. */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, SugestieListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaSugestii(db, q.dane));
});

/**
 * POST /api/v2/ai-suggestions: agent TWORZY sugestie (tag, powiazanie, przyklad setupu, ocena procesu,
 * haslo slownika, wniosek dnia / tygodnia). Zatwierdza ja wylacznie uzytkownik w aplikacji, jednym
 * kliknieciem, z mozliwoscia cofniecia; do tego czasu sugestia nie wchodzi do statystyk. Twierdzenie
 * bez dowodu (evidence) jest odrzucane. strategy_detail to obserwacja: wchodzi od razu jako cofalny
 * dopisek do notatki.
 */
export const POST = withApi({ scopes: ["propose"] }, async (request, api) => {
  const w = await wczytajCialo(request, SugestiaUtworzSchema, "Nieprawidłowa sugestia");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => utworzSugestie(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz({ created: wynik.utworzona, suggestion: zSugestii(wynik.sugestia), noteAdditionId: wynik.dopisekId }, wynik.utworzona ? 201 : 200);
});
