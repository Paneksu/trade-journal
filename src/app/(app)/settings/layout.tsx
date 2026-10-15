import { SettingsNav } from "@/components/settings/settings-nav";
import { requireSession } from "@/lib/auth/guard";

/*
 * Ustawienia UI v2 (etap 4). Forma ze wzoru 12 (Linear „Security & access”, Refero w wzory.md): lista zakładek
 * pionowo po lewej, treść w wąskiej kolumnie; każda sekcja to tytuł i opis nad ramą, w ramie wiersze.
 * Logika formularzy bez zmian; wygląd z klasy .styl-ustawien (globals.css). Przy 375 zakładki zawijają się nad treścią.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="mx-auto grid w-full max-w-tresc gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-12">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <h1 className="mb-4 text-tytul font-medium tracking-tight text-text">Ustawienia</h1>
        <SettingsNav />
      </aside>
      <div className="styl-ustawien min-w-0 space-y-10 lg:pt-14 [&>div]:space-y-10">{children}</div>
    </div>
  );
}
