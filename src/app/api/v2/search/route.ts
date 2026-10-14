import { SzukajQuery } from "@/lib/api-v2/contract/v2";
import { odpowiedz } from "@/lib/api-v2/http";
import { szukaj } from "@/lib/api-v2/szukaj";
import { wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/search?q=zarzadzanie&types=notes,words,trades&limit=20
 * Bez polskich znakow, prefiksowo i rozmyto (unaccent + pg_trgm). Wynik ma typ i ranking.
 */
export const GET = withApi({ scopes: ["read"] }, async (request) => {
  const q = wczytajQuery(request, SzukajQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await szukaj(q.dane.q, q.dane.types, q.dane.limit));
});
