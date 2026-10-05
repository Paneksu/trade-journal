import { czytajMultipart } from "@/lib/ingest/body";
import { blad, odpowiedz } from "@/lib/ingest/http";
import { withIngest } from "@/lib/ingest/with-ingest";
import { ustalOrigin, zastapZrzuty } from "@/lib/ingest/zrzuty";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/ingest/trades/:id/screenshots  (multipart/form-data)
 *   shot      - plik, powtarzalne (do 8)
 *   interval  - interwał, powtarzalne, po jednym na plik w tej samej kolejności (puste = brak)
 *   origin    - tradingview | fxreplay (domyślnie źródło trade'a)
 * Zastępuje wszystkie zrzuty tego pochodzenia na trade'cie; ręcznych nie rusza.
 */
export const POST = withIngest<Ctx>(async (request, { params }) => {
  const { id: idRaw } = await params;
  const tradeId = Number(idRaw);
  if (!Number.isInteger(tradeId) || tradeId < 1) {
    return blad(400, "bad_request", `id trade'a: »${idRaw}« - oczekiwano dodatniej liczby całkowitej.`);
  }

  const cialo = await czytajMultipart(request);
  if (!cialo.ok) {
    return blad(cialo.status, cialo.status === 413 ? "payload_too_large" : "bad_request", cialo.error);
  }

  const form = cialo.formData;
  const pliki = form.getAll("shot").filter((w): w is File => w instanceof File && w.size > 0);
  const interwaly = form.getAll("interval").map((w) => String(w));
  const origin = form.get("origin");

  const o = await ustalOrigin(tradeId, typeof origin === "string" ? origin : null);
  if (!o.ok) return blad(400, "bad_request", o.error);

  const wynik = await zastapZrzuty(tradeId, o.origin, pliki, interwaly);
  if (!wynik.ok) {
    const kod = wynik.status === 404 ? "not_found" : wynik.status === 500 ? "internal_error" : "validation_failed";
    return blad(wynik.status, kod, wynik.error);
  }
  return odpowiedz(wynik);
});
