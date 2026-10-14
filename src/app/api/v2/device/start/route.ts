import { DeviceStartSchema } from "@/lib/api-v2/contract/v2";
import { adresPolaczenia, rozpocznijUrzadzenie } from "@/lib/api-v2/device";
import { adresKlienta, blad, odpowiedz } from "@/lib/api-v2/http";
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
    // Osobny wylacznik logowania urzadzen (niezalezny od API_V2_DISABLED): warunek publicznego
    // wystawienia to sudo przy zatwierdzaniu z fazy 1; do tego czasu mozna to zamknac jedna zmienna.
    if (process.env.DEVICE_LOGIN_DISABLED === "1") {
      return blad(403, "device_login_disabled", "Logowanie nowych urządzeń jest wyłączone (DEVICE_LOGIN_DISABLED=1). Istniejące tokeny działają bez zmian. Włącz je na czas łączenia urządzenia.");
    }
    const w = await wczytajCialo(request, DeviceStartSchema, "Nieprawidłowe żądanie logowania urządzenia");
    if (!w.ok) return w.odpowiedz;

    const start = await rozpocznijUrzadzenie(w.dane.clientName, w.dane.scopes, adresKlienta(request));
    if (!start.ok) return blad(429, start.kod, start.komunikat, { retryInS: 600 }, { "Retry-After": "600" });
    return odpowiedz({
      deviceCode: start.deviceCode,
      userCode: start.userCode,
      verificationUri: adresPolaczenia(request),
      expiresIn: start.expiresIn,
      interval: start.interval,
    });
  },
);
