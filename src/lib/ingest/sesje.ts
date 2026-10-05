import "server-only";
import { eq } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/lib/db";
import { backtestSessions, instruments } from "@/lib/db/schema";
import { mapujSymbol } from "@/lib/domain/tradingview";

import type { SesjaSchema } from "./schema";

/**
 * Sesja backtestu albo forward testu z FX Replay (ADR-026, ADR-027). "Utworz
 * lub odnajdz po `externalRef`": ponowne wyslanie tej samej sesji zwraca te
 * sama sesje i niczego w niej nie zmienia - nazwe i zalozenia uzytkownik moze
 * juz poprawiac w aplikacji, a klient nie ma prawa tego cofac.
 */

export type WynikSesji =
  | {
      ok: true;
      id: number;
      created: boolean;
      session: typeof backtestSessions.$inferSelect;
      warnings: string[];
    }
  | { ok: false; status: 400; error: string };

function kodBleduBazy(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code ?? x?.cause?.code;
}

export async function znajdzLubUtworzSesje(s: z.output<typeof SesjaSchema>): Promise<WynikSesji> {
  const istniejaca = await db
    .select()
    .from(backtestSessions)
    .where(eq(backtestSessions.externalRef, s.externalRef))
    .limit(1);
  if (istniejaca[0]) return zIstniejacej(istniejaca[0], s);

  let instrumentId: number | null = null;
  if (s.symbol !== undefined) {
    const rows = await db
      .select({ id: instruments.id, symbol: instruments.symbol })
      .from(instruments)
      .where(eq(instruments.active, true));
    const m = mapujSymbol(s.symbol, rows.map((r) => r.symbol));
    if (!m.ok) return { ok: false, status: 400, error: `pole symbol: ${m.error}` };
    instrumentId = rows.find((r) => r.symbol === m.symbol)?.id ?? null;
  }

  try {
    const [utworzona] = await db
      .insert(backtestSessions)
      .values({
        name: s.name,
        kind: s.kind,
        externalRef: s.externalRef,
        instrumentId,
        interval: s.interval ?? null,
        dataFrom: s.dataFrom ?? null,
        dataTo: s.dataTo ?? null,
        startingBalance: Math.round((s.startingBalance ?? 0) * 100),
        riskPerTrade: s.riskPerTrade == null ? null : Math.round(s.riskPerTrade * 100),
        ...(s.targetTrades == null ? {} : { targetTrades: s.targetTrades }),
        assumptions: s.assumptions ?? null,
      })
      .returning();
    return { ok: true, id: utworzona.id, created: true, session: utworzona, warnings: [] };
  } catch (e) {
    // Wyscig: druga prosba zalozyla te sesje chwile wczesniej. Unikat w bazie
    // wygral, wiec zwracamy ja zamiast bledu.
    if (kodBleduBazy(e) === "23505") {
      const [druga] = await db
        .select()
        .from(backtestSessions)
        .where(eq(backtestSessions.externalRef, s.externalRef))
        .limit(1);
      if (druga) return zIstniejacej(druga, s);
    }
    throw e;
  }
}

function zIstniejacej(
  sesja: typeof backtestSessions.$inferSelect,
  s: z.output<typeof SesjaSchema>,
): WynikSesji {
  const warnings: string[] = [];
  if (sesja.kind !== s.kind) {
    warnings.push(
      `Sesja ${s.externalRef} istnieje jako »${sesja.kind}«, a zapytanie podaje »${s.kind}«. Rodzaj nie został zmieniony.`,
    );
  }
  if (sesja.name !== s.name) {
    warnings.push(`Nazwa w aplikacji to »${sesja.name}« (zapytanie: »${s.name}«); nie zmieniono.`);
  }
  return { ok: true, id: sesja.id, created: false, session: sesja, warnings };
}
