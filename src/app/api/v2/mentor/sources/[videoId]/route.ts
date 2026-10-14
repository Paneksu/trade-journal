import { MentorZrodloStatusSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { ustawStatusZrodla, zZrodla } from "@/lib/api-v2/mentor";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ videoId: string }> };

/** PUT /api/v2/mentor/sources/:videoId: status przetwarzania filmu (processed, no_captions, error). Zakres import. */
export const PUT = withApi<Ctx>({ scopes: ["write", "import"] }, async (request, api, { params }) => {
  const videoId = (await params).videoId;
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return blad(400, "bad_request", "videoId: »" + videoId.slice(0, 30) + "« nie wygląda na id filmu YouTube.");
  const w = await wczytajCialo(request, MentorZrodloStatusSchema, "Nieprawidłowy status filmu");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => ustawStatusZrodla(tx, videoId, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz(zZrodla(wynik.zrodlo));
});
