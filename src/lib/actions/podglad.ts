"use server";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { szczegolyTradu } from "@/lib/api-v2/trade-szczegoly";

/*
 * Szuflada podglądu na liście trade'ów (wzór 2b: Mercury transactions, prawa szuflada ok. 420 px).
 * Czyta przez `szczegolyTradu`, czyli tę samą funkcję co `GET /api/v2/trades/:id`: wynik, notatka
 * i zrzuty po wejściu są ukryte, dopóki trade z werdyktem AI nie jest zamknięty (MUST 2).
 */

export type PodgladTradu = {
  id: number;
  symbol: string;
  direction: string;
  status: string;
  entryTime: string;
  tradingDay: string | null;
  accountName: string;
  dataSource: string;
  processGrade: "A" | "B" | "C" | null;
  resultHidden: boolean;
  pnlCents: number | null;
  rMultiple: number | null;
  plan: { entryPrice: number; stopLoss: number; takeProfit: number | null; setup: string | null; frozenAt: string } | null;
  zrzuty: { id: number; thumbnail: string | null; file: string; width: number | null; interval: string | null; origin: string }[];
  notatka: string | null;
  werdykt: { pass: number; fail: number; inne: number } | null;
};

export async function podgladTradu(id: number): Promise<PodgladTradu | null> {
  await requireSession();
  if (!Number.isInteger(id) || id < 1) return null;
  const s = await szczegolyTradu(db, id);
  if (!s) return null;
  const ai = s.reviews.find((r) => r.kind === "ai") ?? null;
  return {
    id: s.trade.id,
    symbol: s.trade.symbol,
    direction: s.trade.direction,
    status: s.trade.status,
    entryTime: s.trade.entryTime,
    tradingDay: s.trade.tradingDay,
    accountName: s.trade.accountName,
    dataSource: s.trade.dataSource,
    processGrade: s.trade.processGrade,
    resultHidden: s.resultHidden,
    pnlCents: s.result?.pnlCents ?? null,
    rMultiple: s.result?.rMultiple ?? null,
    plan: s.plan
      ? {
          entryPrice: s.plan.entryPrice,
          stopLoss: s.plan.stopLoss,
          takeProfit: s.plan.takeProfit,
          setup: s.plan.setup?.name ?? null,
          frozenAt: s.plan.frozenAt,
        }
      : null,
    zrzuty: s.screenshots.slice(0, 4).map((z) => ({ id: z.id, thumbnail: z.thumbnail, file: z.file, width: z.width ?? null, interval: z.interval, origin: z.origin })),
    notatka: s.trade.note,
    werdykt: ai
      ? {
          pass: ai.ruleChecks.filter((r) => r.verdict === "pass").length,
          fail: ai.ruleChecks.filter((r) => r.verdict === "fail").length,
          inne: ai.ruleChecks.filter((r) => r.verdict !== "pass" && r.verdict !== "fail").length,
        }
      : null,
  };
}
