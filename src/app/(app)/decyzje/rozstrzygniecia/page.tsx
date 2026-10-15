import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/guard";
import { sprzecznosciDoRozstrzygniecia } from "@/lib/queries/decyzje";

/*
 * UI v2 (etap 2): sprzeczności mentor kontra praktyka są pozycjami wspólnej kolejki „Do decyzji” (wzór 8, Cycle).
 * Stary adres prowadzi do pierwszej sprzeczności w kolejce, żeby linki z raportów i agenta dalej działały.
 */
export const dynamic = "force-dynamic";

export default async function DoRozstrzygnieciaPage() {
  await requireSession();
  const [pierwsza] = await sprzecznosciDoRozstrzygniecia();
  redirect(pierwsza ? `/decyzje?poz=m-${pierwsza.id}` : "/decyzje");
}
