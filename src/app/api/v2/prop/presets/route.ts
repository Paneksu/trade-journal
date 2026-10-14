import { PropPresetyQuery } from "@/lib/api-v2/contract/funkcje";
import { odpowiedz } from "@/lib/api-v2/http";
import { listaPresetow } from "@/lib/api-v2/prop-konta";
import { wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/prop/presets?firm=&phase=&accountSizeCents=: presety regul prop firm jako DANE
 * (zrodlo, data odczytu, wiek w dniach, needsVerification). Wartosci sa punktem wyjscia do
 * weryfikacji w regulaminie, nie prawda.
 */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, PropPresetyQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await listaPresetow(db, q.dane));
});
