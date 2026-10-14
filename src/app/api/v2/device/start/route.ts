import { DeviceStartSchema } from "@/lib/api-v2/contract/v2";
import { adresPolaczenia, rozpocznijUrzadzenie } from "@/lib/api-v2/device";
import { adresKlienta, odpowiedz } from "@/lib/api-v2/http";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withPublicApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/device/start { clientName, scopes }: poczatek logowania kodem urzadzenia (ADR-030).
 * Trasa PUBLICZNA (bez tokenu), limit 10 startow na godzine na adres.
 */
export const POST = withPublicApi(
  { nazwa: "device-start", limit: 10, oknoMs: 60 * 60 * 1000 },
  async (request) => {
    const w = await wczytajCialo(request, DeviceStartSchema, "Nieprawidłowe żądanie logowania urządzenia");
    if (!w.ok) return w.odpowiedz;

    const start = await rozpocznijUrzadzenie(w.dane.clientName, w.dane.scopes, adresKlienta(request));
    return odpowiedz({
      deviceCode: start.deviceCode,
      userCode: start.userCode,
      verificationUri: adresPolaczenia(request),
      expiresIn: start.expiresIn,
      interval: start.interval,
    });
  },
);
