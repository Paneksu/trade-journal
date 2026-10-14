import { NotatkaUtworzSchema, NotatkiListaQuery } from "@/lib/api-v2/contract/v2";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaNotatek, odeslanieDlaKindu, utworzNotatke, zNotatki } from "@/lib/api-v2/notatki";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/notes?kind=&slug=&externalRef=&day=&tradeId=&includeArchived=&limit=&after= (lista bez tresci). */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, NotatkiListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaNotatek(db, q.dane));
});

/** POST /api/v2/notes: nowa notatka (201). Tytuly sa unikalne, bo [[Tytul]] rozwiazuje sie po tytule. */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => {
  const w = await wczytajCialo(request, NotatkaUtworzSchema, "Nieprawidłowa notatka");
  if (!w.ok) return w.odpowiedz;

  const odeslanie = odeslanieDlaKindu(w.dane.kind);
  if (odeslanie) {
    return blad(422, "use_dedicated_endpoint", odeslanie.komunikat, { useInstead: odeslanie.sciezka });
  }

  const wynik = await api.zapis((tx) => utworzNotatke(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(zNotatki(wynik.notatka), 201, { ETag: `"${wynik.notatka.rev}"` });
});
