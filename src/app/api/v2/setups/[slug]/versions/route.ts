import { SetupWersjaSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { zaproponujWersjeSetupu } from "@/lib/api-v2/setupy";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi, wymagajImportuDlaOrigin } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST /api/v2/setups/:slug/versions: nowa wersja setupu jako PROPOZYCJA (jedna naraz). Tresc wersji
 * jest niezmienna, zmiana progow statusu to nowa wersja. Zatwierdza uzytkownik w aplikacji.
 */
export const POST = withApi<Ctx>({ scopes: ["propose"] }, async (request, api, { params }) => {
  const slug = (await params).slug;
  const w = await wczytajCialo(request, SetupWersjaSchema, "Nieprawidłowa wersja setupu");
  if (!w.ok) return w.odpowiedz;
  const bezImportu = wymagajImportuDlaOrigin(api, w.dane.origin);
  if (bezImportu) return bezImportu;
  const wynik = await api.zapis((tx) => zaproponujWersjeSetupu(tx, api, slug, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(
    { slug: wynik.slug, version: wynik.wersja, status: wynik.status, signature: wynik.signature, created: wynik.utworzona },
    wynik.utworzona ? 201 : 200,
  );
});
