"use server";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import {
  accounts,
  backtestSessions,
  customFields,
  dayNotes,
  instruments,
  savedViews,
  strategies,
  tagCategories,
  tags,
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
    noteRows,
    viewRows,
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
    db.select().from(dayNotes),
    db.select().from(savedViews),
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
      dayNotes: noteRows,
      savedViews: viewRows,
    },
    null,
    2,
  );
}

/** Liczniki do ekranu ustawien - ile czego siedzi w bazie. */
export async function counts(): Promise<Record<string, number>> {
  await requireSession();
  const [t, a, i, s, tg, f, n] = await Promise.all([
    db.$count(trades),
    db.$count(accounts),
    db.$count(instruments),
    db.$count(strategies),
    db.$count(tags),
    db.$count(customFields),
    db.$count(dayNotes),
  ]);
  return { trades: t, accounts: a, instruments: i, strategies: s, tags: tg, fields: f, notes: n };
}
