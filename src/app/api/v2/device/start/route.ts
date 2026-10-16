import { DeviceStartSchema } from "@/lib/api-v2/contract/v2";
import { adresPolaczenia, rozpocznijUrzadzenie } from "@/lib/api-v2/device";
import { dwaFaWlaczone, KOD_WYMAGANE_2FA, KOMUNIKAT_WYMAGANE_2FA } from "@/lib/api-v2/logowanie-urzadzen";
import { adresKlienta, blad, odpowiedz } from "@/lib/api-v2/http";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { zapiszZdarzenie } from "@/lib/auth/second-factor";
import { withPublicApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/device/start { clientName, scopes }: poczatek logowania kodem urzadzenia (ADR-030).
 * Trasa PUBLICZNA (bez tokenu), limit 10 startow na godzine na adres.
 */
export const POST = withPublicApi(
  { nazwa: "device-start", limit: 10, oknoMs: 60 * 60 * 1000 },
  async (request) => {
    // Decyzja uzytkownika 15.10.2026 («Zamkniete do wlaczenia 2FA»), zapisana w kodzie 17.10.2026
    // (autoryzacja sesji glownej; uzytkownik nie ustawia zmiennych w Coolify): dopoki w ustawieniach nie jest
    // wlaczone TOTP, device/start zwraca 403 (docs/decyzje.md ADR-030, docs/wdrozenie-coolify.md sekcja 10).
    // DEVICE_LOGIN_DISABLED=1 zostaje jako dodatkowy, reczny wylacznik (niezalezny od API_V2_DISABLED).
    if (process.env.DEVICE_LOGIN_DISABLED === "1") {
      return blad(403, "device_login_disabled", "Logowanie nowych urządzeń jest wyłączone (DEVICE_LOGIN_DISABLED=1). Istniejące tokeny działają bez zmian. Włącz je na czas łączenia urządzenia.");
    }
    if (!(await dwaFaWlaczone())) {
      return blad(403, KOD_WYMAGANE_2FA, KOMUNIKAT_WYMAGANE_2FA);
    }
    const w = await wczytajCialo(request, DeviceStartSchema, "Nieprawidłowe żądanie logowania urządzenia");
    if (!w.ok) return w.odpowiedz;

    const start = await rozpocznijUrzadzenie(w.dane.clientName, w.dane.scopes, adresKlienta(request));
    if (!start.ok) return blad(429, start.kod, start.komunikat, { retryInS: 600 }, { "Retry-After": "600" });
    // Wpis bez kodow: tylko kto prosi, skad i o co (dziennik zdarzen bezpieczenstwa, ADR-031).
    await zapiszZdarzenie("device_requested", {
      ip: adresKlienta(request),
      userAgent: request.headers.get("user-agent"),
      detail: { clientName: w.dane.clientName, zakresy: w.dane.scopes },
    });
    return odpowiedz({
      deviceCode: start.deviceCode,
      userCode: start.userCode,
      verificationUri: adresPolaczenia(request),
      expiresIn: start.expiresIn,
      interval: start.interval,
    });
  },
);
