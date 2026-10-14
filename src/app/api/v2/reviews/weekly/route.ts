import { PrzegladTygodniaQuery } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { czyPoniedzialek, odczytajPrzeglad } from "@/lib/api-v2/przeglady";
import { wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/reviews/weekly?weekStart=2026-10-12: metryki procesowe tygodnia (3 najlepsze i 3
 * najgorsze wg procesu, rozklad A/B/C i koszt gry C w R, siatka 2x2, koszt lamania regul w R i $),
 * zapisany przeglad (szkic AI, jedno zobowiazanie) i zobowiazanie poprzedniego tygodnia do rozliczenia.
 */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, PrzegladTygodniaQuery);
  if (!q.ok) return q.odpowiedz;
  if (!czyPoniedzialek(q.dane.weekStart)) {
    return blad(400, "bad_request", "weekStart: »" + q.dane.weekStart + "« nie jest poniedziałkiem. Tydzień przeglądu zaczyna się w poniedziałek (ISO).");
  }
  return odpowiedz(await odczytajPrzeglad(db, q.dane.weekStart));
});
