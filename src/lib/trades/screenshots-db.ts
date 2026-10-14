import "server-only";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { screenshots } from "@/lib/db/schema";
import type { Zapis } from "@/lib/api-v2/zapis";
import { saveScreenshot } from "@/lib/screenshots";

/**
 * Zapis zrzutow trade'a w bazie i na dysku. Wydzielone z akcji formularza
 * (ADR-026), bo to samo robi API synchronizacji - bez duplikowania numeracji
 * kolejnosci i obslugi bledow.
 */

export type ZrzutZInterwalem = { file: File; interval: string | null };

export type OriginZrzutu = "manual" | "tradingview" | "fxreplay";

export async function policzZrzuty(tradeId: number): Promise<number> {
  const [w] = await db
    .select({ ile: sql<number>`count(*)::int` })
    .from(screenshots)
    .where(eq(screenshots.tradeId, tradeId));
  return w?.ile ?? 0;
}

/**
 * Zapisuje pliki i dopisuje je na koncu listy. Numeracja startuje od tego, co
 * juz lezy w bazie - inaczej zdjecie dograne pozniej wskakiwaloby na poczatek.
 * Zwraca komunikat bledu albo null.
 */
export async function wgrajZrzuty(
  tradeId: number,
  items: ZrzutZInterwalem[],
  origin: OriginZrzutu = "manual",
  /** Z bramy API: wstawienia ida w transakcji z tj.actor (ADR-030). Formularz UI nie podaje. */
  zapis?: Zapis,
): Promise<string | null> {
  if (items.length === 0) return null;

  const [stan] = await db
    .select({ ostatni: sql<number>`coalesce(max(${screenshots.sortOrder}), -1)::int` })
    .from(screenshots)
    .where(eq(screenshots.tradeId, tradeId));
  let sortOrder = (stan?.ostatni ?? -1) + 1;

  for (const { file, interval } of items) {
    try {
      const saved = await saveScreenshot({ kind: "trade", id: tradeId }, file);
      const wiersz = {
        tradeId,
        file: saved.file,
        thumbnail: saved.thumbnail,
        width: saved.width,
        height: saved.height,
        sortOrder: sortOrder++,
        interval,
        origin,
      };
      if (zapis) await zapis((tx) => tx.insert(screenshots).values(wiersz));
      else await db.insert(screenshots).values(wiersz);
    } catch (error) {
      return `zrzut się nie wgrał: ${(error as Error).message}`;
    }
  }
  return null;
}
