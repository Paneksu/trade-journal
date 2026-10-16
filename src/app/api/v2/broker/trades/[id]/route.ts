import { blad, odpowiedz } from "@/lib/api-v2/http";
import { idZAdresu } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";
import { szczegolyTraduBrokera } from "@/lib/brokerzy/odczyt";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v2/broker/trades/:id: trade brokera z wypelnieniami (bez surowego wiersza pliku). */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const id = idZAdresu((await params).id, "id trade'a brokera");
  if (!id.ok) return id.odpowiedz;
  const t = await szczegolyTraduBrokera(db, id.dane);
  if (!t) return blad(404, "not_found", `Trade brokera #${id.dane} nie istnieje (mógł zostać cofnięty razem z importem).`);
  return odpowiedz(t);
});
