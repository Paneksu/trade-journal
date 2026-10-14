import { odpowiedz } from "@/lib/api-v2/http";
import { odczytajProfil } from "@/lib/api-v2/profil";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v2/profile: slownik tradera (haslo -> znaczenie, ze zrodlami), ostatnie poprawki interpretacji AI,
 * miara »odsetek poprawionych interpretacji w czasie« i ile werdyktow AI uzytkownik zmienil. AI czyta to przed
 * kazda interpretacja.
 */
export const GET = withApi({ scopes: ["read"] }, async () => odpowiedz(await odczytajProfil(db)));
