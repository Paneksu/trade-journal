import { KorektaInterpretacjiSchema } from "@/lib/api-v2/contract/funkcje";
import { bezOk, blad, odpowiedz } from "@/lib/api-v2/http";
import { zapiszKorekteInterpretacji } from "@/lib/api-v2/profil";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/profile/corrections: Twoja poprawka interpretacji AI (»nie, chodzilo mi o…«). Zapisuje pare
 * przed -> po w rejestrze (tylko do dopisywania) i podmienia interpretacje; slowa uzytkownika zostaja
 * nietkniete. Nowe haslo slownika (term + termMeaning) trafia do kolejki potwierdzen.
 */
export const POST = withApi({ scopes: ["write"] }, async (request, api) => {
  const w = await wczytajCialo(request, KorektaInterpretacjiSchema, "Nieprawidłowa korekta interpretacji");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => zapiszKorekteInterpretacji(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz(bezOk(wynik), 201);
});
