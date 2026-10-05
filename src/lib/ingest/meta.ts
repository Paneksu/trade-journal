import "server-only";
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { accounts, backtestSessions, customFields, instruments, tagCategories, tags } from "@/lib/db/schema";
import { INTERWALY, PROG_HTF } from "@/lib/domain/interwaly";
import { STATUSY } from "@/lib/domain/status";
import { MAX_ZRZUTOW } from "@/lib/screenshots-limit";

import { LIMIT_JSON, LIMIT_MULTIPART } from "./body";
import { LIMIT_NA_MINUTE } from "./with-ingest";
import { MAX_REGUL, MAX_TRADOW_NA_ZAPYTANIE } from "./schema";

/**
 * Opis tego, co aplikacja wie i akceptuje - klient (mozg tradingowy) dopasowuje
 * sie do niego zamiast zgadywac identyfikatory. Bez danych o wynikach: to jest
 * slownik, nie eksport.
 */
export async function zbierzMeta() {
  const [kontaRows, instrRows, tagRows, kategorieRows, sesjeRows, poleRows] = await Promise.all([
    db.select().from(accounts).orderBy(asc(accounts.sortOrder), asc(accounts.id)),
    db.select().from(instruments).where(eq(instruments.active, true)).orderBy(asc(instruments.sortOrder)),
    db
      .select({ id: tags.id, name: tags.name, categoryKey: tagCategories.key })
      .from(tags)
      .innerJoin(tagCategories, eq(tags.categoryId, tagCategories.id))
      .where(eq(tags.archived, false))
      .orderBy(asc(tagCategories.sortOrder), asc(tags.sortOrder)),
    db.select().from(tagCategories).orderBy(asc(tagCategories.sortOrder)),
    db
      .select({
        id: backtestSessions.id,
        name: backtestSessions.name,
        kind: backtestSessions.kind,
        externalRef: backtestSessions.externalRef,
        status: backtestSessions.status,
      })
      .from(backtestSessions)
      .orderBy(asc(backtestSessions.id)),
    db.select().from(customFields).orderBy(asc(customFields.sortOrder)),
  ]);

  return {
    apiVersion: 1,
    serverTime: new Date().toISOString(),
    accounts: kontaRows.map((k) => ({
      id: k.id,
      name: k.name,
      type: k.type,
      propPhase: k.propPhase,
      currency: k.currency,
      archived: k.archived,
    })),
    instruments: instrRows.map((i) => ({
      id: i.id,
      symbol: i.symbol,
      name: i.name,
      tickSize: i.tickSize,
      /** W tysięcznych dolara (NQ = 5000), tak jak w bazie. */
      tickValue: i.tickValue,
      exchangeTimezone: i.exchangeTimezone,
    })),
    tagCategories: kategorieRows.map((c) => ({
      key: c.key,
      name: c.name,
      /** Tylko kategoria confluence przyjmuje interwał przy przypisaniu (ADR-017). */
      acceptsInterval: c.key === "confluence",
    })),
    tags: tagRows,
    sessions: sesjeRows,
    customFields: poleRows
      .filter((p) => !p.archived)
      .map((p) => ({ key: p.key, label: p.label, type: p.type, scope: p.scope, required: p.required, options: p.options })),
    intervals: INTERWALY,
    htfThreshold: PROG_HTF,
    statuses: STATUSY,
    sources: ["tradingview", "fxreplay"],
    limits: {
      maxTradesPerRequest: MAX_TRADOW_NA_ZAPYTANIE,
      maxScreenshotsPerTrade: MAX_ZRZUTOW,
      maxRuleChecksPerReview: MAX_REGUL,
      jsonBodyBytes: LIMIT_JSON,
      multipartBodyBytes: LIMIT_MULTIPART,
      requestsPerMinute: LIMIT_NA_MINUTE,
    },
    conventions: {
      timeFormat: "ISO 8601 z offsetem lub Z, np. 2026-03-10T09:35:00-04:00",
      money: "kwoty brokera (brokerAmount) w walucie konta, np. 116.5; baza trzyma centy",
      externalRef: "tv:<id> (TradingView) albo fxr:<id> (FX Replay); klucz idempotencji",
      symbols: "NQ, NQ1!, MNQ1!, CME_MINI:NQZ2026; CFD (US100) nie jest mapowane",
    },
  };
}
