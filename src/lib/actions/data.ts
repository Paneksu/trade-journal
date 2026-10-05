"use server";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import {
  accounts,
  backtestSessions,
  customFields,
  dayNotes,
  ingestSkips,
  instruments,
  savedViews,
  strategies,
  tagCategories,
  tags,
  tradeExits,
  tradeReviews,
  tradeRuleChecks,
  tradeTags,
  trades,
} from "@/lib/db/schema";

/**
 * Eksport calej bazy do JSON. Sluzy jako kopia zapasowa niezalezna od Postgresa
 * i jako droga wyjscia - dane nalezą do uzytkownika, nie do aplikacji.
 * Zrzuty ekranu zostaja na dysku; ich sciezki sa w eksporcie.
 */
export async function exportAll(): Promise<string> {
  await requireSession();

  const [
    accountRows,
    instrumentRows,
    strategyRows,
    sessionRows,
    categoryRows,
    tagRows,
    fieldRows,
    tradeRows,
    tradeTagRows,
    tradeExitRows,
    noteRows,
    viewRows,
    reviewRows,
    ruleCheckRows,
    skipRows,
  ] = await Promise.all([
    db.select().from(accounts),
    db.select().from(instruments),
    db.select().from(strategies),
    db.select().from(backtestSessions),
    db.select().from(tagCategories),
    db.select().from(tags),
    db.select().from(customFields),
    db.select().from(trades),
    db.select().from(tradeTags),
    // Wyjscia czesciowe (2026-08-30) - bez tego kopia zapasowa po cichu gubi
    // dane: `trades` ma juz tylko srednie i liczniki, faktyczne kawalki
    // wyjscia siedza wylacznie tutaj.
    db.select().from(tradeExits),
    db.select().from(dayNotes),
    db.select().from(savedViews),
    // Synchronizacja przez API (2026-10-05): oceny AI z regulami i nagrobki.
    // Bez nich kopia zapasowa po cichu gubi ocene, zdanie uzytkownika o niej
    // i liste tradow, ktorych klient nie ma wysylac ponownie.
    db.select().from(tradeReviews),
    db.select().from(tradeRuleChecks),
    db.select().from(ingestSkips),
  ]);

  return JSON.stringify(
    {
      wersja: 1,
      wyeksportowano: new Date().toISOString(),
      accounts: accountRows,
      instruments: instrumentRows,
      strategies: strategyRows,
      backtestSessions: sessionRows,
      tagCategories: categoryRows,
      tags: tagRows,
      customFields: fieldRows,
      trades: tradeRows,
      tradeTags: tradeTagRows,
      tradeExits: tradeExitRows,
      dayNotes: noteRows,
      savedViews: viewRows,
      tradeReviews: reviewRows,
      tradeRuleChecks: ruleCheckRows,
      ingestSkips: skipRows,
    },
    null,
    2,
  );
}

/** Liczniki do ekranu ustawien - ile czego siedzi w bazie. */
export async function counts(): Promise<Record<string, number>> {
  await requireSession();
  const [t, a, i, s, tg, f, n, e, rv, rc, sk] = await Promise.all([
    db.$count(trades),
    db.$count(accounts),
    db.$count(instruments),
    db.$count(strategies),
    db.$count(tags),
    db.$count(customFields),
    db.$count(dayNotes),
    db.$count(tradeExits),
    db.$count(tradeReviews),
    db.$count(tradeRuleChecks),
    db.$count(ingestSkips),
  ]);
  return {
    trades: t,
    accounts: a,
    instruments: i,
    strategies: s,
    tags: tg,
    fields: f,
    notes: n,
    tradeExits: e,
    tradeReviews: rv,
    tradeRuleChecks: rc,
    ingestSkips: sk,
  };
}
