import { PropOverviewQuery } from "@/lib/api-v2/contract/funkcje";
import { odpowiedz } from "@/lib/api-v2/http";
import { dzienHandlowyTeraz, przegladProp } from "@/lib/api-v2/prop-konta";
import { wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/prop/overview?day=: status wszystkich kont prop z regulami (bufory, ostrzezenia)
 * oraz LACZNA ekspozycja NQ na kontach (otwarte pozycje i dzisiejsze plany bez trade'u).
 */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, PropOverviewQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await przegladProp(db, q.dane.day ?? dzienHandlowyTeraz()));
});
