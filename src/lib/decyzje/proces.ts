import "server-only";
import { eq } from "drizzle-orm";

import { trades } from "@/lib/db/schema";
import { zapisJakoUi } from "@/lib/api-v2/zapis";
import { czyOcenaProcesu } from "@/lib/domain/process-grid";

/**
 * Ocena procesu A/B/C wystawiona przez uzytkownika na karcie trade'a (MUST 3, UI v2, zakladka „Proces”).
 * Zapis jako `ui`: trigger `trades_guard_*` (migracja 0028) przepuszcza ocene procesu tylko od uzytkownika.
 * Ocena jest osobno od wyniku, wiec wolno ja wystawic takze wtedy, gdy wynik jest jeszcze ukryty.
 */
export async function ustawOceneProcesu(tradeId: number, ocena: string | null): Promise<{ ok: true } | { ok: false; komunikat: string }> {
  if (ocena !== null && !czyOcenaProcesu(ocena)) {
    return { ok: false, komunikat: `Ocena procesu »${ocena}« nie jest jedną z A, B, C.` };
  }
  return zapisJakoUi(async (tx) => {
    const [t] = await tx.select({ id: trades.id }).from(trades).where(eq(trades.id, tradeId)).for("update").limit(1);
    if (!t) return { ok: false as const, komunikat: `Trade #${tradeId} nie istnieje (mógł zostać skasowany).` };
    await tx
      .update(trades)
      .set({ processGrade: ocena as "A" | "B" | "C" | null, processGradedAt: ocena === null ? null : new Date() })
      .where(eq(trades.id, tradeId));
    return { ok: true as const };
  });
}
