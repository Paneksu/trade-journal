import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import { hypotheses, hypothesisVariants } from "@/lib/db/schema";
import { kanonicznyJson } from "@/lib/domain/kanoniczny";
import { ostrzezenieWariantow } from "@/lib/domain/stats-ci";

import type { WariantUtworzSchema } from "./contract/funkcje";
import { ostrzezenieWariantowDoApi } from "./mapowanie";
import { nHipotezy } from "./reguly";
import { skrotTekstu } from "./skrot";
import type { Transakcja } from "./with-api";

/**
 * Licznik testowanych wariantow (ADR-033, MUST 5; metodyka R14). Replay to fabryka
 * przeuczenia: im wiecej wariantow SL / TP / godzin sprawdzono na tych samych danych,
 * tym bardziej wynik NAJLEPSZEGO jest zawyzony. Rejestr jest dopisywany przez API
 * (bez trasy kasowania, ADR-032), wiec AI licznika nie zanizy. Ten sam zestaw
 * parametrow to ten sam wariant (skrot kanonicznego JSON-a), wiec ponowne wyslanie
 * nie podbija licznika.
 */

type Db = Transakcja | typeof import("@/lib/db").db;
export type Wariant = typeof hypothesisVariants.$inferSelect;

export function zWariantu(w: Wariant) {
  return {
    id: w.id,
    hypothesisId: w.hypothesisId,
    label: w.label,
    params: w.params,
    paramsHash: w.paramsHash,
    nTested: w.nTested,
    result: w.result ?? null,
    origin: w.origin,
    createdAt: w.createdAt.toISOString(),
  };
}

export type WynikWariantu =
  | { ok: true; wariant: Wariant; utworzony: boolean }
  | { ok: false; status: 404 | 422; kod: string; komunikat: string };

async function znajdzHipoteze(tx: Db, code: string) {
  const [h] = await tx.select({ id: hypotheses.id, code: hypotheses.code, progN: hypotheses.progN }).from(hypotheses).where(eq(hypotheses.code, code)).limit(1);
  return h ?? null;
}

export async function zarejestrujWariant(tx: Transakcja, code: string, d: z.output<typeof WariantUtworzSchema>): Promise<WynikWariantu> {
  const h = await znajdzHipoteze(tx, code);
  if (!h) return { ok: false, status: 404, kod: "not_found", komunikat: `Hipoteza »${code}« nie istnieje (lista: GET /api/v2/hypotheses).` };

  let hash: string;
  try {
    hash = skrotTekstu(kanonicznyJson(d.params));
  } catch (e) {
    return { ok: false, status: 422, kod: "invalid_params", komunikat: `pole params: ${(e as Error).message}` };
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.variant:${h.id}:${hash}`}, 0))`);
  const [istniejacy] = await tx
    .select()
    .from(hypothesisVariants)
    .where(sql`${hypothesisVariants.hypothesisId} = ${h.id} and ${hypothesisVariants.paramsHash} = ${hash}`)
    .limit(1);
  if (istniejacy) return { ok: true, wariant: istniejacy, utworzony: false };

  const [w] = await tx
    .insert(hypothesisVariants)
    .values({ hypothesisId: h.id, label: d.label, params: d.params, paramsHash: hash, nTested: d.nTested, result: d.result ?? null, origin: "ai" })
    .returning();
  return { ok: true, wariant: w, utworzony: true };
}

export async function podsumowanieWariantow(tx: Db, code: string) {
  const h = await znajdzHipoteze(tx, code);
  if (!h) return null;
  const warianty = await tx.select().from(hypothesisVariants).where(eq(hypothesisVariants.hypothesisId, h.id)).orderBy(asc(hypothesisVariants.id));
  const stan = await nHipotezy(tx, h.id);
  return {
    hypothesis: { code: h.code, n: stan?.n ?? 0, progN: h.progN },
    variants: warianty.map(zWariantu),
    count: warianty.length,
    warning: warianty.length >= 1 ? ostrzezenieWariantowDoApi(ostrzezenieWariantow(warianty.length, stan?.n ?? null)) : null,
  };
}
