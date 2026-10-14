import { signOut } from "@/lib/actions/auth";
import { requireSession } from "@/lib/auth/guard";
import { MobileBar, Sidebar } from "@/components/layout/nav";
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
    <div className="flex min-h-screen">
      <Sidebar signOutAction={signOut} liczniki={liczniki} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar signOutAction={signOut} liczniki={liczniki} />
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
