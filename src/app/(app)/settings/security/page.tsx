import { PasswordForm } from "@/components/settings/forms";
import {
  LeaveSudoButton,
  LogoutEverywhereButton,
  SudoForm,
  TotpSection,
} from "@/components/settings/security-forms";
import { Badge, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { liczbaWolnychKodow, ostatnieZdarzenia } from "@/lib/auth/second-factor";
import { kluczTotpDziala } from "@/lib/auth/totp";
import { stanSudo } from "@/lib/auth/zadanie";
import type { AuthEventKind } from "@/lib/db/schema";
import { dateTime, timeOnly } from "@/lib/format";

export const metadata = { title: "Bezpieczeństwo — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

const NAZWY_ZDARZEN: Record<AuthEventKind, string> = {
  login_ok: "Zalogowano",
  login_fail: "Nieudane logowanie",
  totp_ok: "Kod z aplikacji przyjęty",
  totp_fail: "Błędny kod",
  backup_code_used: "Użyto kodu zapasowego",
  sudo: "Tryb sudo",
  totp_enabled: "Włączono 2FA",
  totp_disabled: "Wyłączono 2FA",
  backup_codes_regenerated: "Nowe kody zapasowe",
  password_changed: "Zmieniono hasło",
  device_requested: "Prośba o urządzenie",
  device_approved: "Zatwierdzono urządzenie",
  device_denied: "Odrzucono urządzenie",
  token_created: "Utworzono token",
  token_revoked: "Unieważniono token",
  logout_all: "Wylogowano wszędzie",
};

const ZLE: ReadonlySet<AuthEventKind> = new Set(["login_fail", "totp_fail"]);

export default async function SecuritySettingsPage() {
  const settings = await requireSession();
  const [sudo, zdarzenia, wolneKody] = await Promise.all([
    stanSudo(settings),
    ostatnieZdarzenia(50),
    settings.totpEnabledAt ? liczbaWolnychKodow() : Promise.resolve(0),
  ]);
  const wlaczone = settings.totpEnabledAt !== null;
  const sudoAktywne = sudo.stan === "aktywny";

  return (
    <div className="space-y-4">
      <Panel
        title="Logowanie dwuskładnikowe (2FA)"
        description="Po haśle aplikacja prosi o 6-cyfrowy kod z telefonu. Wyciek samego hasła nie wystarcza do wejścia."
        actions={<Badge className={wlaczone ? "border-profit/40 text-profit" : "border-loss/40 text-loss"}>{wlaczone ? "Włączone" : "Wyłączone"}</Badge>}
      >
        <TotpSection
          wlaczone={wlaczone}
          wlaczoneOd={settings.totpEnabledAt ? dateTime(settings.totpEnabledAt, settings.timezone) : null}
          kluczOk={kluczTotpDziala()}
          sudoAktywne={sudoAktywne}
          wolneKody={wolneKody}
        />
      </Panel>

      {wlaczone && (
        <Panel
          title="Tryb sudo"
          description="Zmiana hasła, wyłączenie 2FA, nowe kody zapasowe i pełny eksport wymagają ponownego kodu. Tryb trwa 10 minut."
          actions={
            sudo.stan === "aktywny" ? (
              <Badge className="border-profit/40 text-profit">Aktywny do {timeOnly(new Date(sudo.doKiedy), settings.timezone)}</Badge>
            ) : (
              <Badge>Nieaktywny</Badge>
            )
          }
        >
          {sudo.stan === "aktywny" ? (
            <div className="p-4">
              <LeaveSudoButton />
            </div>
          ) : (
            <SudoForm />
          )}
        </Panel>
      )}

      <Panel
        title="Hasło"
        description={
          wlaczone
            ? "Wymaga trybu sudo. Zmiana hasła wylogowuje wszystkie sesje, także na innych urządzeniach."
            : "Zmiana hasła wylogowuje wszystkie sesje, także na innych urządzeniach."
        }
      >
        <PasswordForm />
      </Panel>

      <Panel title="Sesje" description="Gdy podejrzewasz, że ktoś ma Twoją sesję: odetnij wszystkie przeglądarki naraz (opcjonalnie także tokeny urządzeń).">
        <div className="p-4">
          <LogoutEverywhereButton />
        </div>
      </Panel>

      <Panel
        title="Dziennik zdarzeń bezpieczeństwa"
        description="Ostatnie 50 zdarzeń. Tylko do odczytu: baza odrzuca zmianę wpisu."
      >
        {zdarzenia.length === 0 ? (
          <p className="p-4 text-sm text-faint">Brak zdarzeń.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-faint">
                  <th scope="col" className="px-4 py-2 font-medium">Kiedy</th>
                  <th scope="col" className="px-4 py-2 font-medium">Zdarzenie</th>
                  <th scope="col" className="px-4 py-2 font-medium">Adres</th>
                </tr>
              </thead>
              <tbody>
                {zdarzenia.map((z) => (
                  <tr key={z.id} className="border-b border-line last:border-0">
                    <td className="liczba whitespace-nowrap px-4 py-2 text-muted">
                      {dateTime(z.at, settings.timezone)}
                    </td>
                    <td className={ZLE.has(z.kind) ? "px-4 py-2 text-loss" : "px-4 py-2 text-text"}>
                      {NAZWY_ZDARZEN[z.kind] ?? z.kind}
                    </td>
                    <td className="liczba px-4 py-2 text-muted">{z.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
