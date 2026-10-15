import { DataSchema, DzienQuery } from "@/lib/api-v2/contract/v2";
import { blad } from "@/lib/api-v2/http";
import { wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { dolaczZalaczniki } from "@/lib/api-v2/zalaczniki";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

/**
 * POST /api/v2/days/2026-10-14/attachments?accountId=1|sessionId=3 (multipart/form-data jak w
 * notes/:id/attachments). Zalaczniki wisza na notatce dnia (zakladanej, gdy jeszcze jej nie ma).
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const surowa = (await params).date;
  const d = DataSchema.safeParse(surowa);
  if (!d.success) return blad(400, "bad_request", "data: »" + surowa.slice(0, 20) + "« - " + (d.error.issues[0]?.message ?? "oczekiwano YYYY-MM-DD") + ".");
  const q = wczytajQuery(request, DzienQuery);
  if (!q.ok) return q.odpowiedz;
  return dolaczZalaczniki(request, { rodzaj: "day", data: d.data, accountId: q.dane.accountId ?? null, sessionId: q.dane.sessionId ?? null }, api.zapis, api.requestId);
});
