import { BrokerStatusQuery } from "@/lib/api-v2/contract/broker";
import { odpowiedz } from "@/lib/api-v2/http";
import { wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";
import { statusBrokera } from "@/lib/brokerzy/odczyt";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/broker/status?day: czas ostatniego importu i ostatniego wypelnienia per konto, liczba trade'ow bez dopasowania,
 * trade'y dziennika bez danych z rachunku i flaga needsExport (czy przed notatka trzeba kliknac »Eksport« w Tradovate).
 */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, BrokerStatusQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await statusBrokera(db, q.dane.day));
});
