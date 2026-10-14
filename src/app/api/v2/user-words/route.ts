import { SlowaListaQuery, SlowaUtworzSchema } from "@/lib/api-v2/contract/v2";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaSlow, zapiszSlowa, zSlow } from "@/lib/api-v2/slowa";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/user-words?tradeId=&noteId=&backtestSessionId=&day=&role=&limit=&after= */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, SlowaListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaSlow(db, q.dane));
});

/**
 * POST /api/v2/user-words: slowa uzytkownika bajt w bajt (tekst + sha256 z bajtow UTF-8).
 * 201 dla nowego wpisu, 200 dla tego samego wpisu wyslanego ponownie (idempotentne).
 * Zmiany nie ma: PATCH i PUT daja 409 (sciezka /user-words/:id).
 */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => {
  const w = await wczytajCialo(request, SlowaUtworzSchema, "Nieprawidłowe słowa użytkownika");
  if (!w.ok) return w.odpowiedz;

  const wynik = await api.zapis((tx) => zapiszSlowa(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(zSlow(wynik.slowa), wynik.utworzone ? 201 : 200);
});
