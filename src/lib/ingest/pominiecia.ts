import "server-only";
import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { ingestSkips, trades } from "@/lib/db/schema";

/**
 * Pomijane wpisy (ADR-026): klient mowi "tego trade'a nie chce w dzienniku"
 * (np. pozycja otwarta przez pomylke, test). Kazde kolejne POST /trades z tym
 * `externalRef` da `skipped`. Gdy trade o tym kluczu JUZ lezy w dzienniku, nie
 * zapisujemy pominiecia: zablokowaloby ono jego przyszle aktualizacje, a
 * skasowanie trade'a jest decyzja uzytkownika w aplikacji (wtedy nagrobek
 * powstaje sam).
 */

export type WynikPominiecia = {
  externalRef: string;
  status: "recorded" | "already_skipped" | "trade_exists";
  note?: string;
};

export async function zapiszPominiecia(
  pozycje: { externalRef: string; note?: string | null }[],
): Promise<WynikPominiecia[]> {
  const refy = [...new Set(pozycje.map((p) => p.externalRef))];
  const istniejaceTrady = new Set(
    (await db.select({ ref: trades.externalRef }).from(trades).where(inArray(trades.externalRef, refy))).map((r) => r.ref),
  );
  const istniejacePominiecia = new Set(
    (await db.select({ ref: ingestSkips.externalRef }).from(ingestSkips).where(inArray(ingestSkips.externalRef, refy))).map((r) => r.ref),
  );

  const wyniki: WynikPominiecia[] = [];
  const zapisane = new Set<string>();
  for (const p of pozycje) {
    if (zapisane.has(p.externalRef)) {
      wyniki.push({ externalRef: p.externalRef, status: "already_skipped", note: "Ten klucz był w paczce wcześniej." });
      continue;
    }
    if (istniejaceTrady.has(p.externalRef)) {
      wyniki.push({
        externalRef: p.externalRef,
        status: "trade_exists",
        note: "Trade o tym kluczu już jest w dzienniku, więc pominięcia nie zapisano. Skasuj go w aplikacji, jeśli ma tam nie być.",
      });
      continue;
    }
    if (istniejacePominiecia.has(p.externalRef)) {
      wyniki.push({ externalRef: p.externalRef, status: "already_skipped" });
      continue;
    }
    await db
      .insert(ingestSkips)
      .values({ externalRef: p.externalRef, reason: "client", note: p.note ?? null })
      .onConflictDoNothing({ target: ingestSkips.externalRef });
    zapisane.add(p.externalRef);
    wyniki.push({ externalRef: p.externalRef, status: "recorded" });
  }
  return wyniki;
}
