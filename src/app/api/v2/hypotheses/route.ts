import { HipotezaUtworzSchema, HipotezyListaQuery } from "@/lib/api-v2/contract/v2";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaHipotez, zalozHipoteze } from "@/lib/api-v2/reguly";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi, wymagajImportuDlaOrigin } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/hypotheses?externalRef=: hipotezy z n (n_imported + zamkniete trade'y podpiete), progiem i faza. */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, HipotezyListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaHipotez(db, q.dane.externalRef));
});

/** POST /api/v2/hypotheses: nowa hipoteza (decyzja zawsze 'active'; potwierdzenie to decyzja czlowieka w UI). */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => {
  const w = await wczytajCialo(request, HipotezaUtworzSchema, "Nieprawidłowa hipoteza");
  if (!w.ok) return w.odpowiedz;

  const bezImportu = wymagajImportuDlaOrigin(api, w.dane.origin);
  if (bezImportu) return bezImportu;

  const wynik = await api.zapis((tx) => zalozHipoteze(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(
    { id: wynik.id, code: wynik.code, noteId: wynik.noteId, created: wynik.utworzona },
    wynik.utworzona ? 201 : 200,
  );
});
