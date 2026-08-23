import { GeneralSettingsForm, PasswordForm } from "@/components/settings/forms";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";

export const metadata = { title: "Ustawienia — Dziennik tradingowy" };

export default async function GeneralSettingsPage() {
  const settings = await requireSession();

  return (
    <div className="space-y-4">
      <Panel
        title="Ogólne"
        description="Strefa czasowa rządzi wszystkimi godzinami w dzienniku. Zmiana przelicza tylko sposób wyświetlania — zapisane momenty zostają te same."
      >
        <GeneralSettingsForm
          values={{
            baseCurrency: settings.baseCurrency,
            timezone: settings.timezone,
            defaultRisk: settings.defaultRisk,
            minSample: settings.minSample,
            tradingHoursFrom: settings.tradingHoursFrom,
            tradingHoursTo: settings.tradingHoursTo,
            beProgRMille: settings.beProgRMille,
            beProgNaKontrakt: settings.beProgNaKontrakt,
          }}
        />
      </Panel>

      <Panel
        title="Hasło"
        description="Zmiana hasła wylogowuje wszystkie sesje, także na innych urządzeniach."
      >
        <PasswordForm />
      </Panel>
    </div>
  );
}
