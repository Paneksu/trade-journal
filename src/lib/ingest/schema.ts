import { z } from "zod";

import { INTERWALY } from "@/lib/domain/interwaly";
import { STATUSY } from "@/lib/domain/status";

/**
 * Kontrakt wejsciowy API synchronizacji (ADR-026). Wszystko, co przychodzi
 * z zewnatrz, przechodzi tutaj - to jest walidacja po stronie serwera, jedyna,
 * ktora sie liczy. Obiekty sa scisle (`strictObject`): literowka w nazwie pola
 * ma byc bledem, nie po cichu zgubiona wartoscia.
 */

export const MAX_TRADOW_NA_ZAPYTANIE = 50;
export const MAX_WYJSC = 20;
export const MAX_TAGOW = 40;
export const MAX_REGUL = 200;

/** Klucz idempotencji: "tv:<id>" (TradingView) albo "fxr:<id>" (FX Replay). */
export const REGEX_EXTERNAL_REF = /^(tv|fxr):[A-Za-z0-9._:\-]{1,120}$/;

const ZRODLO_Z_PREFIKSU = { tv: "tradingview", fxr: "fxreplay" } as const;

export function zrodloZRef(ref: string): "tradingview" | "fxreplay" {
  return ref.startsWith("fxr:") ? ZRODLO_Z_PREFIKSU.fxr : ZRODLO_Z_PREFIKSU.tv;
}

/** ISO 8601 z OFFSETEM albo Z. Czas bez strefy jest niejednoznaczny, wiec go odrzucamy. */
const REGEX_CZAS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export const czas = z
  .string()
  .refine((w) => REGEX_CZAS.test(w), {
    message:
      "czas musi być ISO 8601 z offsetem, np. 2026-03-10T09:35:00-04:00 albo 2026-03-10T13:35:00Z (czas bez strefy jest niejednoznaczny)",
  })
  .refine((w) => !Number.isNaN(Date.parse(w)), { message: "nie jest poprawną datą kalendarzową" })
  .transform((w) => new Date(w));

const liczba = z.number().finite();
const liczbaOpc = z.number().finite().nullish();

export const WyjscieSchema = z.strictObject({
  time: czas.nullish(),
  price: liczba,
  contracts: z.number().finite().positive().nullish(),
  /** Kwota z rachunku dla kawałka, w walucie konta (np. 116.5), nie w centach. */
  brokerAmount: liczbaOpc,
  note: z.string().max(500).nullish(),
});

export const TagRefSchema = z
  .strictObject({
    tagId: z.number().int().positive().optional(),
    /** Klucz kategorii (confluence, setup, entry_style, mistake) + nazwa tagu. */
    category: z.string().min(1).max(60).optional(),
    name: z.string().min(1).max(120).optional(),
    interval: z.enum(INTERWALY).nullish(),
  })
  .refine((t) => t.tagId !== undefined || (t.category !== undefined && t.name !== undefined), {
    message: "podaj tagId albo parę category + name",
  });

export const TradeSchema = z
  .strictObject({
    externalRef: z.string().regex(REGEX_EXTERNAL_REF, {
      message: "oczekiwano formatu tv:<id> albo fxr:<id> (litery, cyfry, . _ : -; do 120 znaków)",
    }),
    source: z.enum(["tradingview", "fxreplay"]).optional(),
    accountId: z.number().int().positive(),
    symbol: z.string().min(1).max(40),
    sessionId: z.number().int().positive().optional(),
    sessionRef: z.string().regex(REGEX_EXTERNAL_REF).optional(),
    direction: z.enum(["long", "short"]),
    status: z.enum(STATUSY).default("closed"),
    entryTime: czas,
    entryPrice: liczba,
    contracts: z.number().finite().positive(),
    stopLoss: liczbaOpc,
    takeProfit: liczbaOpc,
    mae: liczbaOpc,
    mfe: liczbaOpc,
    /** Kwota z rachunku dla całego trade'a, w walucie konta; bije ticki (ADR-016). */
    brokerAmount: liczbaOpc,
    exits: z.array(WyjscieSchema).max(MAX_WYJSC).default([]),
    note: z.string().max(10_000).nullish(),
    moodNote: z.string().max(2_000).nullish(),
    readiness: z.number().int().min(1).max(10).nullish(),
    tags: z.array(TagRefSchema).max(MAX_TAGOW).optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
    /** Surowe dane klienta do diagnozy; zapisywane w `source_snapshot`, nie wpływają na statystyki. */
    snapshot: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.source !== undefined && t.source !== zrodloZRef(t.externalRef)) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: `źródło »${t.source}« nie zgadza się z prefiksem externalRef »${t.externalRef.split(":")[0]}:« (tv: = tradingview, fxr: = fxreplay)`,
      });
    }
    if (t.sessionId !== undefined && t.sessionRef !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionRef"],
        message: "podaj sessionId albo sessionRef, nie oba naraz",
      });
    }
  });

export type IngestTrade = z.output<typeof TradeSchema>;

export const KopertaTradowSchema = z.strictObject({
  dryRun: z.boolean().default(false),
  mode: z.enum(["create", "update"]).default("create"),
  /** Elementy sprawdzamy osobno (jeden zły nie blokuje reszty), więc tu tylko `unknown`. */
  trades: z.array(z.unknown()).min(1).max(MAX_TRADOW_NA_ZAPYTANIE),
});

export const RegulaSchema = z.strictObject({
  ruleId: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/, {
    message: "id reguły: litery, cyfry, . _ - (do 40 znaków), np. R-007",
  }),
  /** Kopia treści reguły z chwili oceny. */
  ruleText: z.string().min(1).max(2_000),
  verdict: z.enum(["pass", "fail", "na", "unclear"]),
  evidence: z.string().max(4_000).nullish(),
});

export const OcenaSchema = z
  .strictObject({
    basis: z.enum(["chart", "history"]),
    setupType: z.string().max(120).nullish(),
    summaryMd: z.string().max(20_000).nullish(),
    lesson: z.string().max(4_000).nullish(),
    brainVerdict: z.enum(["wejdz", "czekaj", "odpusc"]).nullish(),
    brainPlan: z.record(z.string(), z.unknown()).nullish(),
    brainVersion: z.string().max(80).nullish(),
    evidenceCutoff: czas.nullish(),
    model: z.string().max(120).nullish(),
    ruleChecks: z.array(RegulaSchema).max(MAX_REGUL).default([]),
  })
  .superRefine((o, ctx) => {
    const widziane = new Set<string>();
    o.ruleChecks.forEach((r, i) => {
      if (widziane.has(r.ruleId)) {
        ctx.addIssue({
          code: "custom",
          path: ["ruleChecks", i, "ruleId"],
          message: `id reguły »${r.ruleId}« występuje drugi raz; jedna ocena ma jeden wiersz na regułę`,
        });
      }
      widziane.add(r.ruleId);
    });
  });

export const SesjaSchema = z.strictObject({
  externalRef: z.string().regex(REGEX_EXTERNAL_REF, {
    message: "oczekiwano formatu fxr:<id> (albo tv:<id>)",
  }),
  name: z.string().min(1).max(200),
  kind: z.enum(["backtest", "forward"]).default("backtest"),
  symbol: z.string().min(1).max(40).optional(),
  interval: z.enum(INTERWALY).nullish(),
  dataFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "oczekiwano daty YYYY-MM-DD" }).nullish(),
  dataTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "oczekiwano daty YYYY-MM-DD" }).nullish(),
  /** W walucie konta, np. 50000. */
  startingBalance: z.number().finite().min(0).nullish(),
  riskPerTrade: z.number().finite().min(0).nullish(),
  targetTrades: z.number().int().min(1).max(100_000).nullish(),
  assumptions: z.string().max(10_000).nullish(),
});

export const OminieciaSchema = z.strictObject({
  skips: z
    .array(
      z.strictObject({
        externalRef: z.string().regex(REGEX_EXTERNAL_REF),
        note: z.string().max(500).nullish(),
      }),
    )
    .min(1)
    .max(100),
});

/** Wartość z obiektu po ścieżce błędu zod - do komunikatu z faktyczną wartością. */
function wartoscPoSciezce(dane: unknown, sciezka: readonly PropertyKey[]): unknown {
  let w: unknown = dane;
  for (const klucz of sciezka) {
    if (w === null || typeof w !== "object") return undefined;
    w = (w as Record<PropertyKey, unknown>)[klucz];
  }
  return w;
}

function pokaz(w: unknown): string {
  if (w === undefined) return "brak";
  let s: string;
  try {
    s = JSON.stringify(w) ?? String(w);
  } catch {
    s = String(w);
  }
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/**
 * Błędy zod jako czytelne zdania: pole + wartość + czego oczekiwano.
 * "pole entryTime: »2026-03-10T09:35« - czas musi być ISO 8601 z offsetem..."
 */
export function opiszBledyZod(blad: z.ZodError, wejscie: unknown): string[] {
  return blad.issues.map((i) => {
    const sciezka = i.path.length > 0 ? i.path.join(".") : "(całość)";
    if (i.code === "unrecognized_keys") {
      return `pole ${sciezka}: nieznane pola ${i.keys.map((k) => `»${k}«`).join(", ")} - sprawdź pisownię (dozwolone są tylko pola z kontraktu API)`;
    }
    return `pole ${sciezka}: »${pokaz(wartoscPoSciezce(wejscie, i.path))}« - ${i.message}`;
  });
}
