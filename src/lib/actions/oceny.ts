"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { tradeReviews, tradeRuleChecks } from "@/lib/db/schema";
import { normalizujWerdyktUzytkownika } from "@/lib/domain/ocena-ai";

export type WynikZdania = { ok: true } | { ok: false; error: string };

/**
 * Zapisuje zdanie uzytkownika o ocenie jednej reguly (ADR-028): zgadzam sie,
 * nie zgadzam sie albo wyczyszczenie (`null`). Sprawdzenie musi nalezec do
 * oceny TEGO trade'a - samo `checkId` z przegladarki nie wystarcza, zeby
 * ruszyc cudzy wiersz.
 */
export async function ustawZdanieOReguly(
  tradeId: number,
  checkId: number,
  wartosc: unknown,
): Promise<WynikZdania> {
  await requireSession();

  if (!Number.isInteger(tradeId) || tradeId <= 0 || !Number.isInteger(checkId) || checkId <= 0) {
    return { ok: false, error: "Nie znaleziono tej reguły." };
  }
  const zdanie = normalizujWerdyktUzytkownika(wartosc);
  if (zdanie === undefined) return { ok: false, error: "Odpowiedz „zgadzam się” albo „nie zgadzam się”." };

  const zmienione = await db
    .update(tradeRuleChecks)
    .set({ userVerdict: zdanie })
    .where(
      and(
        eq(tradeRuleChecks.id, checkId),
        inArray(
          tradeRuleChecks.reviewId,
          db.select({ id: tradeReviews.id }).from(tradeReviews).where(eq(tradeReviews.tradeId, tradeId)),
        ),
      ),
    )
    .returning({ id: tradeRuleChecks.id });
  if (zmienione.length === 0) return { ok: false, error: "Nie znaleziono tej reguły przy tym trade'zie." };

  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/stats");
  return { ok: true };
}
