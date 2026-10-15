import "server-only";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { setups, setupVersions, trades } from "@/lib/db/schema";
import { ukryteTrady } from "@/lib/api-v2/ukrycie-wyniku";

/**
 * Drobne odczyty dla ekranów UI v2, których `getTrades` (lista) nie niesie: ocena procesu A/B/C
 * (MUST 3), setup z playbooka z wersją i ślepa ocena (`resultHidden` per trade). Bez logiki domeny:
 * tylko kolumny i wspólna reguła ukrycia z `lib/api-v2/ukrycie-wyniku`.
 */

export type ProcesISetup = { proces: "A" | "B" | "C" | null; setup: string | null; wersja: number | null; ukryty: boolean };

export async function procesISetupy(ids: number[]): Promise<Map<number, ProcesISetup>> {
  const wynik = new Map<number, ProcesISetup>();
  if (ids.length === 0) return wynik;
  const [wiersze, ukryte] = await Promise.all([
    db
      .select({ id: trades.id, proces: trades.processGrade, setup: setups.name, wersja: setupVersions.version })
      .from(trades)
      .leftJoin(setups, eq(trades.setupId, setups.id))
      .leftJoin(setupVersions, eq(trades.setupVersionId, setupVersions.id))
      .where(inArray(trades.id, ids)),
    ukryteTrady(db, ids),
  ]);
  for (const w of wiersze) {
    wynik.set(w.id, { proces: w.proces ?? null, setup: w.setup ?? null, wersja: w.wersja ?? null, ukryty: ukryte.has(w.id) });
  }
  return wynik;
}
