import { z } from "zod";

import { DataSchema } from "./v2";

/**
 * Kontrakt danych brokera (ADR-034, etap A): przyjecie pliku z automatu (`POST /broker/inbox`, WYLACZNIE zakres import_broker),
 * odczyt trade'ow i statusu (zakres read), aktywne konta dnia. Konwencje jak reszta API v2: pieniadze w centach,
 * czas ISO 8601, obiekty scisle. Numer konta u brokera nigdy nie wychodzi: tylko ostatnie 4 znaki.
 */

const calk = z.number().int();
const calkNull = z.number().int().nullable();
const tekstNull = z.string().nullable();
const idZQuery = z.coerce.number().int().positive();

/** Limit pliku przyjmowanego przez inbox (ADR-034 pkt 2): 5 MB. */
export const INBOX_MAX_BAJTOW = 5 * 1024 * 1024;

export const FORMATY_INBOX = ["tradovate_orders", "tradovate_cash_history"] as const;

/* --- Inbox: przyjecie pliku z automatu --------------------------------------------------------- */

export const InboxPingOdpowiedz = z.strictObject({
  accepts: z.array(z.string()),
  maxBytes: calk,
  tokenName: z.string(),
  expiresAt: tekstNull,
});

export const InboxOdpowiedz = z.strictObject({
  /** SHA-256 bajtow przyjetego pliku. Automat kasuje plik dopiero, gdy jest rowny jego wlasnemu. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** applied = zapisano; duplicate = ten plik byl juz zaimportowany (nic sie nie zdublowalo). */
  status: z.enum(["applied", "duplicate"]),
  format: z.string(),
  platform: z.string(),
  importId: calk,
  timezone: z.string(),
  fills: z.strictObject({ new: calk, duplicate: calk }),
  cashEvents: z.strictObject({ new: calk, duplicate: calk }),
  trades: z.strictObject({ matched: calk, needsDecision: calk, open: calk }),
  /** Ostrzezenia po polsku (np. strefa czasowa zalozona z ustawien), do pokazania w `tj doctor`. */
  notes: z.array(z.string()),
});

/* --- Odczyt: trade'y brokera i status ------------------------------------------------------------ */

export const BrokerTradesQuery = z.strictObject({
  from: DataSchema.optional(),
  to: DataSchema.optional(),
  accountId: idZQuery.optional(),
  unmatched: z
    .enum(["true", "false", "1", "0"])
    .transform((w) => w === "true" || w === "1")
    .optional(),
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const BrokerStatusQuery = z.strictObject({ day: DataSchema.optional() });

const KontoOpis = z.strictObject({
  id: calk,
  name: z.string(),
  /** Kategoria konta z ADR-027: realne, demo, prop_eval, prop_funded; null, gdy konto prop nie ma fazy. */
  category: tekstNull,
  firm: tekstNull,
  program: tekstNull,
  phase: z.enum(["eval", "funded"]).nullable(),
});

const BrokerTradeKorzen = {
  id: calk,
  externalRef: z.string(),
  brokerAccount: z.strictObject({ id: calk, platform: z.string(), last4: tekstNull }),
  account: KontoOpis.nullable(),
  contract: z.string(),
  instrument: tekstNull,
  direction: z.enum(["long", "short"]),
  quantity: z.number(),
  entryTime: z.string(),
  avgEntryPrice: z.number(),
  tradingDay: tekstNull,
  exitTime: tekstNull,
  avgExitPrice: z.number().nullable(),
  status: z.enum(["open", "closed"]).nullable(),
  grossCents: calkNull,
  grossSource: z.enum(["broker", "computed"]).nullable(),
  feesCents: calkNull,
  feeSource: z.enum(["broker", "rate"]).nullable(),
  netCents: calkNull,
  fillCount: calkNull,
  matchState: z.enum(["unmatched", "ambiguous", "matched", "skipped"]),
  matchKind: z.enum(["auto", "user", "ai_accepted", "created"]).nullable(),
  tradeId: calkNull,
  /** true = wynik ukryty (slepa ocena): trade dziennika ma werdykt AI wydany przed wynikiem i nie jest zamkniety. */
  resultHidden: z.boolean(),
};

export const BrokerTradesListaOdpowiedz = z.strictObject({
  trades: z.array(z.strictObject(BrokerTradeKorzen)),
  nextAfter: calkNull,
});

export const BrokerTradeSzczegolyOdpowiedz = z.strictObject({
  ...BrokerTradeKorzen,
  fills: z.array(
    z.strictObject({
      id: calk,
      side: z.enum(["buy", "sell"]),
      quantity: z.number(),
      price: z.number(),
      filledAt: z.string(),
      feeCents: calkNull,
      orderRef: tekstNull,
    }),
  ),
});

export const BrokerStatusOdpowiedz = z.strictObject({
  day: z.string(),
  accounts: z.array(
    z.strictObject({
      accountId: calkNull,
      accountName: tekstNull,
      brokerAccountId: calk,
      platform: z.string(),
      last4: tekstNull,
      lastImportAt: tekstNull,
      lastFillAt: tekstNull,
      unmatchedBrokerTrades: calk,
      journalTradesWithoutBrokerData: calk,
      needsExport: z.boolean(),
    }),
  ),
  pendingDecisions: calk,
  needsExport: z.boolean(),
  lastImportAt: tekstNull,
});

/** Blok `broker` w `GET /trades/{id}`: powiazany trade brokera z wynikiem wyliczonym, zrodlem i roznica. */
export const BlokBrokerOdpowiedz = z.strictObject({
  brokerTradeId: calk,
  externalRef: z.string(),
  matchKind: z.enum(["auto", "user", "ai_accepted", "created"]).nullable(),
  matchedAt: tekstNull,
  brokerAccount: z.strictObject({ id: calk, platform: z.string(), last4: tekstNull }),
  contract: z.string(),
  direction: z.enum(["long", "short"]),
  quantity: z.number(),
  entryTime: z.string(),
  avgEntryPrice: z.number(),
  resultHidden: z.boolean(),
  exitTime: tekstNull,
  avgExitPrice: z.number().nullable(),
  grossCents: calkNull,
  grossSource: z.enum(["broker", "computed"]).nullable(),
  feesCents: calkNull,
  feeSource: z.enum(["broker", "rate"]).nullable(),
  netCents: calkNull,
  pnlEstimateCents: calkNull,
  pnlSource: z.enum(["estimate", "broker"]).nullable(),
  differenceCents: calkNull,
  slippageCents: calkNull,
  feeDifferenceCents: calkNull,
  fills: z.array(
    z.strictObject({
      id: calk,
      side: z.enum(["buy", "sell"]),
      quantity: z.number(),
      price: z.number(),
      filledAt: z.string(),
      feeCents: calkNull,
      orderRef: tekstNull,
    }),
  ),
});

/** Wynik netto w `result` trade'a: oplaty, wynik wyliczony i zrodlo wyniku. */
export const WynikNettoOdpowiedz = {
  feesCents: calkNull,
  pnlEstimateCents: calkNull,
  pnlSource: z.enum(["estimate", "broker"]),
  estimateDifferenceCents: calkNull,
};

/* --- Aktywne konta dnia ------------------------------------------------------------------------------ */

export const KontaDniaZapisSchema = z.strictObject({
  accountIds: z.array(z.number().int().positive()).max(20),
});

export const KontaDniaOdpowiedz = z.strictObject({
  day: z.string(),
  accounts: z.array(KontoOpis),
});
