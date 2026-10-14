import { dolaczZalaczniki } from "@/lib/api-v2/zalaczniki";
import { idZAdresu } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/notes/:id/attachments (multipart/form-data: shot, interval, caption, capturedAt,
 * chartState, origin). PNG, JPG, WebP, AVIF i HEIC -> WebP + miniatura. Tylko dopisywanie.
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id notatki");
  if (!id.ok) return id.odpowiedz;
  return dolaczZalaczniki(request, { rodzaj: "note", id: id.dane }, api.zapis);
});
