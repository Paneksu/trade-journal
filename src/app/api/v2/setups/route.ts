import { SetupUtworzSchema, SetupyListaQuery } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { listaSetupow, zalozSetup } from "@/lib/api-v2/setupy";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi, wymagajImportuDlaOrigin } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/setups: karty playbooka z obowiazujaca wersja i oczekujaca propozycja. */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, SetupyListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaSetupow(db, q.dane.includeRetired ?? false));
});

/**
 * POST /api/v2/setups: zaklada setup (notatka rodzaju setup + wersja 1 jako PROPOZYCJA). Zatwierdza ja
 * wylacznie uzytkownik w aplikacji; zakresu zatwierdzania nie ma.
 */
export const POST = withApi({ scopes: ["propose"] }, async (request, api) => {
  const w = await wczytajCialo(request, SetupUtworzSchema, "Nieprawidłowy setup");
  if (!w.ok) return w.odpowiedz;
  const bezImportu = wymagajImportuDlaOrigin(api, w.dane.origin);
  if (bezImportu) return bezImportu;
  const wynik = await api.zapis((tx) => zalozSetup(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(
    { slug: wynik.slug, version: wynik.wersja, noteId: wynik.noteId, status: wynik.status, signature: wynik.signature, note: "Propozycja czeka na decyzję użytkownika w aplikacji." },
    201,
  );
});
