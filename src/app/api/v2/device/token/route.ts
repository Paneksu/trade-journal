import { DeviceTokenSchema } from "@/lib/api-v2/contract/v2";
import { odpytajUrzadzenie } from "@/lib/api-v2/device";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withPublicApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/device/token { deviceCode }: odpytywanie co 5 s. Token wraca DOKLADNIE RAZ.
 * Trasa PUBLICZNA (bez tokenu); sekretem jest device_code (256 bitow), a limit 60 zapytan
 * na minute na adres odcina zgadywanie i petle bez przerwy.
 */
export const POST = withPublicApi(
  { nazwa: "device-token", limit: 60, oknoMs: 60 * 1000 },
  async (request) => {
    const w = await wczytajCialo(request, DeviceTokenSchema, "Nieprawidłowe odpytanie o token");
    if (!w.ok) return w.odpowiedz;

    const wynik = await odpytajUrzadzenie(w.dane.deviceCode);
    if (!wynik.ok) {
      return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.kod === "slow_down" ? { interval: 5 } : {});
    }
    return odpowiedz({ accessToken: wynik.accessToken, tokenType: "Bearer", tokenId: wynik.tokenId, scopes: wynik.scopes });
  },
);
