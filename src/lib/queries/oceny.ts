import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { trades, tradeReviews, tradeRuleChecks, type TradeReview, type TradeRuleCheck } from "@/lib/db/schema";
import { getProgi } from "./dictionaries";
import { whereClause, type Filters } from "./filters";
import { statyZgodnosci, type StatyZgodnosci, type SprawdzenieRegulyDoStatystyk } from "@/lib/domain/zgodnosc";

/**
 * Oceny AI trade'a (ADR-028) i statystyki zgodnosci z regulami. To dane do
 * panelu "Ocena AI" na karcie trade'a i do zestawienia zgodnosci - sam
 * interfejs jest osobna praca.
 */

export type OcenaZRegulami = TradeReview & { reguly: TradeRuleCheck[] };

/** Oceny jednego trade'a (chart i history), reguly w kolejnosci id reguly. */
export async function getOceny(tradeId: number): Promise<OcenaZRegulami[]> {
  const oceny = await db
    .select()
    .from(tradeReviews)
    .where(eq(tradeReviews.tradeId, tradeId))
    .orderBy(asc(tradeReviews.basis));
  if (oceny.length === 0) return [];

  const reguly = await db
    .select()
    .from(tradeRuleChecks)
    .where(
      sql`${tradeRuleChecks.reviewId} in (${sql.join(
        oceny.map((o) => sql`${o.id}`),
        sql`, `,
      )})`,
    )
    .orderBy(asc(tradeRuleChecks.ruleId));

  return oceny.map((o) => ({ ...o, reguly: reguly.filter((r) => r.reviewId === o.id) }));
}

/**
 * Reguly, ktore wystapily w ocenach - do podpowiedzi w filtrze. Tresc z
 * najnowszej oceny (regula w mozgu moze sie zmieniac, ocena trzyma kopie).
 */
export async function getRegulyOcen(): Promise<{ id: string; text: string }[]> {
  const wiersze = await db
    .selectDistinctOn([tradeRuleChecks.ruleId], {
      id: tradeRuleChecks.ruleId,
      text: tradeRuleChecks.ruleText,
    })
    .from(tradeRuleChecks)
    .innerJoin(tradeReviews, eq(tradeRuleChecks.reviewId, tradeReviews.id))
    .orderBy(tradeRuleChecks.ruleId, desc(tradeReviews.createdAt));
  return wiersze;
}

export type PodstawaZgodnosci = "chart" | "history" | "kazda";

/**
 * Statystyki zgodnosci z regulami dla trade'ow pasujacych do filtrow (te same
 * `Filters` co tabela, wiec zestawienie zgadza sie z lista obok).
 *
 * `podstawa`: oceny z wykresu na moment decyzji (`chart`), po fakcie
 * (`history`) albo `kazda`. Przy `kazda` kazda para (trade, regula) liczy sie
 * RAZ i wygrywa ocena z wykresu - nie wiedziala jeszcze, jak sie skonczylo
 * (ADR-028). Ocena po fakcie wchodzi tylko tam, gdzie ocena z wykresu nie
 * rozstrzygnela (na / unclear) albo jej nie ma - typowo reguly zarzadzania
 * pozycja, ktorych przed wejsciem nie da sie sprawdzic.
 */
export async function getZgodnosc(
  f: Filters,
  podstawa: PodstawaZgodnosci = "kazda",
): Promise<StatyZgodnosci> {
  const progi = await getProgi();
  const warunekTradu = whereClause(f, progi);

  const wiersze = await db
    .selectDistinctOn([tradeReviews.tradeId, tradeRuleChecks.ruleId], {
      tradeId: tradeReviews.tradeId,
      ruleId: tradeRuleChecks.ruleId,
      ruleText: tradeRuleChecks.ruleText,
      verdict: tradeRuleChecks.verdict,
      userVerdict: tradeRuleChecks.userVerdict,
      rMultiple: trades.rMultiple,
      utworzono: tradeReviews.createdAt,
    })
    .from(tradeRuleChecks)
    .innerJoin(tradeReviews, eq(tradeRuleChecks.reviewId, tradeReviews.id))
    .innerJoin(trades, eq(tradeReviews.tradeId, trades.id))
    .where(
      and(
        warunekTradu,
        // Statystyki jak wszedzie: tylko trady rozstrzygniete, nie "nie wziete".
        sql`${trades.status}::text = 'closed'`,
        podstawa === "kazda" ? undefined : eq(tradeReviews.basis, podstawa),
      ),
    )
    .orderBy(
      tradeReviews.tradeId,
      tradeRuleChecks.ruleId,
      // Najpierw ocena, ktora cos rozstrzygnela (pass/fail), potem ta z wykresu.
      desc(sql`(${tradeRuleChecks.verdict} in ('pass', 'fail'))`),
      desc(sql`(${tradeReviews.basis} = 'chart')`),
    );

  // Najnowsze oceny pierwsze - `ruleText` w zestawieniu ma byc z najnowszej.
  wiersze.sort((a, b) => b.utworzono.getTime() - a.utworzono.getTime());
  const sprawdzenia: SprawdzenieRegulyDoStatystyk[] = wiersze.map((w) => ({
    tradeId: w.tradeId,
    ruleId: w.ruleId,
    ruleText: w.ruleText,
    verdict: w.verdict,
    userVerdict: w.userVerdict,
    rMultiple: w.rMultiple === null ? null : Number(w.rMultiple),
  }));

  // Trady z zakresu bez zadnej oceny: sa nieocenione, ale z samych regul ich nie widac.
  const [{ n: wszystkie }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(warunekTradu, sql`${trades.status}::text = 'closed'`));
  const ocenione = new Set(sprawdzenia.map((s) => s.tradeId)).size;

  return statyZgodnosci(sprawdzenia, Math.max(0, wszystkie - ocenione));
}
