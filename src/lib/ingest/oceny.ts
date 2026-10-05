import "server-only";
import { eq, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/lib/db";
import { tradeReviews, tradeRuleChecks, trades } from "@/lib/db/schema";

import type { OcenaSchema } from "./schema";

/**
 * Ocena trade'a przez AI (ADR-028). Jedna ocena na podstawe (`chart` albo
 * `history`): ponowne wyslanie podmienia ocene, nie mnozy wierszy.
 *
 * Zdanie uzytkownika ("zgadzam sie / nie zgadzam sie" z ocena reguly) jest
 * jego wlasnoscia, nie klienta. Przy ponownym wyslaniu zostaje przy regule,
 * ktorej werdykt AI sie NIE zmienil - gdy AI zmienilo zdanie o regule,
 * stara odpowiedz uzytkownika dotyczylaby czegos innego i jest zerowana.
 */

export type WynikOceny =
  | { ok: true; reviewId: number; created: boolean; ruleChecks: number; userVerdictsKept: number }
  | { ok: false; status: 404; error: string };

export async function zapiszOcene(
  tradeId: number,
  o: z.output<typeof OcenaSchema>,
): Promise<WynikOceny> {
  const [trade] = await db.select({ id: trades.id }).from(trades).where(eq(trades.id, tradeId)).limit(1);
  if (!trade) {
    return {
      ok: false,
      status: 404,
      error: `Trade #${tradeId} nie istnieje (mógł zostać skasowany w aplikacji). Sprawdź id w odpowiedzi POST /api/ingest/trades albo w GET /api/ingest/trades.`,
    };
  }

  return db.transaction(async (tx) => {
    const wartosci = {
      setupType: o.setupType ?? null,
      summaryMd: o.summaryMd ?? null,
      lesson: o.lesson ?? null,
      brainVerdict: o.brainVerdict ?? null,
      brainPlan: o.brainPlan ?? null,
      brainVersion: o.brainVersion ?? null,
      evidenceCutoff: o.evidenceCutoff ?? null,
      model: o.model ?? null,
    };

    // `xmax = 0` odroznia swiezo wstawiony wiersz od zaktualizowanego w upsercie.
    const [wiersz] = await tx
      .insert(tradeReviews)
      .values({ tradeId, basis: o.basis, ...wartosci })
      .onConflictDoUpdate({
        target: [tradeReviews.tradeId, tradeReviews.basis],
        set: { ...wartosci, createdAt: sql`now()` },
      })
      .returning({ id: tradeReviews.id, utworzony: sql<boolean>`(xmax = 0)` });

    const ids = o.ruleChecks.map((r) => r.ruleId);
    // Reguly, ktorych nowa ocena juz nie zawiera, znikaja razem ze zdaniem uzytkownika.
    if (ids.length === 0) {
      await tx.delete(tradeRuleChecks).where(eq(tradeRuleChecks.reviewId, wiersz.id));
    } else {
      await tx
        .delete(tradeRuleChecks)
        .where(sql`${tradeRuleChecks.reviewId} = ${wiersz.id} and ${notInArray(tradeRuleChecks.ruleId, ids)}`);
    }

    let zachowane = 0;
    for (const r of o.ruleChecks) {
      const [poprzedni] = await tx
        .select({ verdict: tradeRuleChecks.verdict, userVerdict: tradeRuleChecks.userVerdict })
        .from(tradeRuleChecks)
        .where(sql`${tradeRuleChecks.reviewId} = ${wiersz.id} and ${tradeRuleChecks.ruleId} = ${r.ruleId}`)
        .limit(1);
      const userVerdict = poprzedni && poprzedni.verdict === r.verdict ? poprzedni.userVerdict : null;
      if (userVerdict) zachowane += 1;

      await tx
        .insert(tradeRuleChecks)
        .values({
          reviewId: wiersz.id,
          ruleId: r.ruleId,
          ruleText: r.ruleText,
          verdict: r.verdict,
          evidence: r.evidence ?? null,
          userVerdict,
        })
        .onConflictDoUpdate({
          target: [tradeRuleChecks.reviewId, tradeRuleChecks.ruleId],
          set: { ruleText: r.ruleText, verdict: r.verdict, evidence: r.evidence ?? null, userVerdict },
        });
    }

    return {
      ok: true as const,
      reviewId: wiersz.id,
      created: wiersz.utworzony,
      ruleChecks: o.ruleChecks.length,
      userVerdictsKept: zachowane,
    };
  });
}
