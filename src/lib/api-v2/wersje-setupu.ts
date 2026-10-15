import "server-only";
import { and, desc, eq, inArray, lte, or, gt, isNull } from "drizzle-orm";

import { setupVersions } from "@/lib/db/schema";

import type { Transakcja } from "./zapis";

/**
 * Wersja setupu OBOWIAZUJACA w podanej chwili (a nie dzisiaj): zatwierdzona najpozniej w chwili `kiedy`
 * i nie zastapiona przed nia. Trade trafia do wersji, ktora obowiazywala w jego wejsciu, takze gdy
 * zatwierdzamy przypisanie dni pozniej, po przyjeciu nowszej wersji (review 15.10.2026, bloker).
 * Brak wersji w tamtej chwili = `null` (setup bez wersji w momencie wejscia).
 */
export async function wersjaSetupuNaChwile(tx: Transakcja, setupId: number, kiedy: Date): Promise<number | null> {
  const [w] = await tx
    .select({ id: setupVersions.id })
    .from(setupVersions)
    .where(
      and(
        eq(setupVersions.setupId, setupId),
        inArray(setupVersions.status, ["approved", "superseded"]),
        lte(setupVersions.decidedAt, kiedy),
        or(isNull(setupVersions.supersededAt), gt(setupVersions.supersededAt, kiedy)),
      ),
    )
    .orderBy(desc(setupVersions.version))
    .limit(1);
  return w?.id ?? null;
}
