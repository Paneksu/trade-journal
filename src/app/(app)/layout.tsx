import { signOut } from "@/lib/actions/auth";
import { requireSession } from "@/lib/auth/guard";
import { MobileBar, Sidebar, TopBar } from "@/components/layout/nav";
import { Paleta } from "@/components/layout/paleta";
import { licznikiDoDecyzji } from "@/lib/queries/decyzje";

/* Kazdy ekran dziennika czyta dane uzytkownika przy zadaniu.
   Bez tego Next probuje je prerenderowac przy budowaniu obrazu, gdzie
   baza nie istnieje. */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  // Licznik w menu nie moze przewrocic calego ekranu: przy bledzie bazy pokazujemy menu bez znaczka.
  const liczniki = await licznikiDoDecyzji().catch((e: unknown) => {
    console.error("[layout] nie policzono licznika Do decyzji:", e);
    return { decyzje: 0, rozstrzygniecia: 0 };
  });

  return (
    <div className="flex min-h-screen bg-tresc">
      <Sidebar signOutAction={signOut} liczniki={liczniki} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/* Wzor: tresc 968 px wysrodkowana obok paska bocznego (pomiar.json, kontener). Margines 16 przy 375.
            Dol 96 px na telefonie: dolny pasek 64 px + oddech. */}
        <main className="min-w-0 flex-1 px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      </div>
      <MobileBar signOutAction={signOut} liczniki={liczniki} />
      <Paleta />
    </div>
  );
}
