import { BrokerTradesQuery } from "@/lib/api-v2/contract/broker";
import { odpowiedz } from "@/lib/api-v2/http";
import { wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";
import { listaTradowBrokera } from "@/lib/brokerzy/odczyt";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/broker/trades?from&to&accountId&unmatched: trade'y brokera zgrupowane z wypelnien (konto dziennika z kategoria,
 * firma, program i faza; wynik netto i brutto, oplaty i ich zrodlo, stan dopasowania). Trade z ukrytym wynikiem (slepa
 * ocena) wychodzi z resultHidden: true i bez wyniku.
 */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, BrokerTradesQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaTradowBrokera(db, { from: q.dane.from, to: q.dane.to, accountId: q.dane.accountId, unmatched: q.dane.unmatched, after: q.dane.after, limit: q.dane.limit }));
});
