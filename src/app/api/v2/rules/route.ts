import { ReguliListaQuery } from "@/lib/api-v2/contract/v2";
import { odpowiedz } from "@/lib/api-v2/http";
import { listaRegul } from "@/lib/api-v2/reguly";
import { wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v2/rules?status=all|proposed|active|retired|rejected&externalRef=: status wyliczany z wersji + rulesVersion. */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, ReguliListaQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaRegul(db, q.dane.status, q.dane.externalRef));
});
