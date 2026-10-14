import { MentorTwierdzenieScalSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { scalTwierdzenie } from "@/lib/api-v2/mentor";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v2/mentor/claims/:id: scalenie twierdzenia z notatka / karta setupu (status merged). Cytat, skrot
 * i znacznik czasu sa niezmienne; ocene zgodnosci z filmem wystawia uzytkownik w aplikacji. Zakres import.
 */
export const PATCH = withApi<Ctx>({ scopes: ["write", "import"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id twierdzenia");
  if (!id.ok) return id.odpowiedz;
  const w = await wczytajCialo(request, MentorTwierdzenieScalSchema, "Nieprawidłowe scalenie twierdzenia");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => scalTwierdzenie(tx, id.dane, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz(wynik.twierdzenie);
});
