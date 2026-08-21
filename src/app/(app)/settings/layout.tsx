import { SettingsNav } from "@/components/settings/settings-nav";
import { requireSession } from "@/lib/auth/guard";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="space-y-4">
      <header>
        <p className="etykieta">Konfiguracja</p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">Ustawienia</h1>
      </header>
      <SettingsNav />
      {children}
    </div>
  );
}
