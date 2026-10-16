import { z } from "zod";

import { SCOPES } from "../scopes";
import { BlokBrokerOdpowiedz, WynikNettoOdpowiedz } from "./broker";
import { KindNotatkiSchema, NotatkaOdpowiedz, SlowaOdpowiedz } from "./v2";

/**
 * Schematy ODPOWIEDZI API v2 (backlog z lacznika: w OpenAPI odpowiedzi byly puste `{}`). Opisuja
 * to, co trasy faktycznie zwracaja; test `odpowiedzi.db.test.ts` parsuje prawdziwe odpowiedzi tymi
 * schematami, wiec rozjazd kontraktu z kodem jest widoczny od razu. Obiekty, ktorych zawartosc
 * zalezy od klienta (jsonb: meta, evidence, params...), sa opisane jako dowolny obiekt.
 *
 * Konwencja: pieniadze w centach (`...Cents`), czas ISO 8601, daty YYYY-MM-DD, brak wartosci to `null`.
 */

const iso = z.string();
const isoNull = z.string().nullable();
const liczbaNull = z.number().nullable();
const calk = z.number().int();
const calkNull = z.number().int().nullable();
const tekstNull = z.string().nullable();
const obiekt = z.record(z.string(), z.unknown());
const slowaKrotkie = z.strictObject({ id: calk, text: z.string(), sha256: z.string() });

/* --- Wspolne ---------------------------------------------------------------------------------- */

export const MeOdpowiedz = z.strictObject({
  tokenId: calk,
  name: z.string(),
  scopes: z.array(z.enum(SCOPES)),
  actor: z.string(),
  serverTime: iso,
});

const Strona = { nextAfter: calkNull };

/* --- Meta, trade'y, sesje, pominiecia ------------------------------------------------------------ */

export const MetaOdpowiedz = z.looseObject({
  apiVersion: calk,
  contractHash: z.string(),
  contractVersion: z.string(),
  scopes: z.array(z.string()),
  rulesVersion: calk,
  serverTime: iso,
  accounts: z.array(z.looseObject({ id: calk, name: z.string(), type: z.string(), propPhase: tekstNull, currency: z.string(), archived: z.boolean() })),
  instruments: z.array(z.looseObject({ id: calk, symbol: z.string(), name: z.string(), tickSize: z.string(), tickValue: z.number(), exchangeTimezone: z.string() })),
  tagCategories: z.array(z.looseObject({ key: z.string(), name: z.string(), acceptsInterval: z.boolean() })),
  tags: z.array(z.looseObject({ id: calk, name: z.string(), categoryKey: z.string() })),
  sessions: z.array(z.looseObject({ id: calk, name: z.string(), kind: z.string(), externalRef: tekstNull, status: z.string() })),
  customFields: z.array(obiekt),
  intervals: z.array(z.string()),
  htfThreshold: z.unknown(),
  statuses: z.array(z.string()),
  sources: z.array(z.string()),
  limits: obiekt,
  conventions: obiekt,
});

export const TradesListaOdpowiedz = z.strictObject({
  trades: z.array(
    z.strictObject({
      id: calk,
      externalRef: tekstNull,
      source: z.string(),
      status: z.string(),
      sessionId: calkNull,
      entryTime: iso,
      updatedAt: iso,
      ingestedAt: isoNull,
      editedInApp: z.boolean(),
      hash: tekstNull,
    }),
  ),
  ...Strona,
});

export const TradesZapisOdpowiedz = z.strictObject({
  dryRun: z.boolean(),
  mode: z.enum(["create", "update"]),
  summary: z.strictObject({ created: calk, updated: calk, unchanged: calk, conflict: calk, skipped: calk, error: calk }),
  results: z.array(
    z.looseObject({
      index: calk,
      externalRef: tekstNull,
      status: z.enum(["created", "updated", "unchanged", "conflict", "skipped", "error"]),
      id: calk.optional(),
      note: z.string().optional(),
      error: z.string().optional(),
      errors: z.array(z.string()).optional(),
    }),
  ),
});

export const OcenaZapisOdpowiedz = z.strictObject({
  ok: z.literal(true),
  reviewId: calk,
  created: z.boolean(),
  ruleChecks: calk,
  userVerdictsKept: calk,
  /** true = werdykt z as_of: niezmienny (ADR-033). */
  immutable: z.boolean(),
  asOf: isoNull,
  evidenceHash: tekstNull,
  evidenceCutoff: isoNull,
  rulesetVersion: calkNull,
  unknownRules: z.array(z.string()),
  lookAhead: z.strictObject({ moglZnacDzien: z.boolean(), powod: z.string() }).nullable(),
});

export const KorektaWerdyktuOdpowiedz = z.strictObject({
  ok: z.literal(true),
  reviewId: calk,
  overridesReviewId: calk,
  asOf: isoNull,
  evidenceHash: z.string(),
  ruleChecks: calk,
});

const ZrzutOut = z.strictObject({
  id: calk,
  file: z.string(),
  thumbnail: tekstNull,
  interval: tekstNull,
  origin: z.string(),
  sha256: tekstNull,
});

export const ZrzutyOdpowiedz = z.strictObject({
  ok: z.literal(true),
  tradeId: calk,
  origin: z.enum(["manual", "tradingview", "fxreplay"]),
  replaced: calk,
  screenshots: z.array(ZrzutOut),
});

export const ZalacznikiOdpowiedz = z.strictObject({
  owner: z.union([z.strictObject({ type: z.literal("note"), id: calk }), z.strictObject({ type: z.literal("day"), date: z.string(), dayNoteId: calk })]),
  screenshots: z.array(
    z.strictObject({
      id: calk,
      file: z.string(),
      thumbnail: tekstNull,
      interval: tekstNull,
      origin: z.string(),
      sha256: tekstNull,
      caption: tekstNull,
      width: calkNull,
      height: calkNull,
    }),
  ),
});

export const SesjaOdpowiedz = z.strictObject({
  id: calk,
  created: z.boolean(),
  kind: z.enum(["backtest", "forward"]),
  externalRef: tekstNull,
  name: z.string(),
  warnings: z.array(z.string()),
});

export const PominieciaOdpowiedz = z.strictObject({
  results: z.array(z.strictObject({ externalRef: z.string(), status: z.enum(["recorded", "already_skipped", "trade_exists"]), note: z.string().optional() })),
});

/* --- Dzien, notatki, wyszukiwanie ------------------------------------------------------------------ */

export const DzienOdpowiedz = z.strictObject({
  date: z.string(),
  scope: z.strictObject({ accountId: calkNull, sessionId: calkNull }),
  dayNote: z
    .strictObject({
      id: calk,
      preSession: tekstNull,
      postSession: tekstNull,
      mood: calkNull,
      energy: calkNull,
      dayRating: calkNull,
      noTrade: z.boolean(),
      noTradeReason: tekstNull,
      bias: z.enum(["long", "short", "neutral"]).nullable(),
      maxTrades: calkNull,
      sleep: calkNull,
      updatedAt: iso,
    })
    .nullable(),
  trades: z.array(z.strictObject({ id: calk, status: z.string(), direction: z.string() })),
  /** true: dzien ma otwarty trade z werdyktem AI, wiec postSession i slowa napisane po wejsciu sa ukryte. */
  resultHidden: z.boolean(),
  userWords: z.array(SlowaOdpowiedz),
  notes: z.array(z.strictObject({ id: calk, kind: z.string(), slug: z.string(), title: z.string(), rev: calk })),
});

export const DzienZapisOdpowiedz = z.strictObject({ id: calk, date: z.string(), created: z.boolean() });

export const NotatkiListaOdpowiedz = z.strictObject({
  notes: z.array(
    z.strictObject({
      id: calk,
      kind: KindNotatkiSchema,
      slug: z.string(),
      title: z.string(),
      origin: z.string(),
      rev: calk,
      contentHash: z.string(),
      tradeId: calkNull,
      backtestSessionId: calkNull,
      day: tekstNull,
      externalRef: tekstNull,
      archivedAt: isoNull,
      updatedAt: iso,
    }),
  ),
  ...Strona,
});

export const NotatkaSzczegolyOdpowiedz = NotatkaOdpowiedz.extend({
  links: z.array(z.strictObject({ target: z.string(), resolved: z.strictObject({ id: calk, slug: z.string(), title: z.string() }).nullable() })),
  backlinks: z.array(z.strictObject({ id: calk, slug: z.string(), title: z.string(), target: z.string() })),
});

export const SzukajOdpowiedz = z.strictObject({
  results: z.array(
    z.strictObject({
      type: z.enum(["note", "user_words", "trade"]),
      id: calk,
      rank: z.number(),
      title: z.string(),
      snippet: z.string(),
      meta: obiekt,
    }),
  ),
  tokens: z.array(z.string()),
});

export const DopisekOdpowiedz = z.strictObject({
  id: calk,
  noteId: calk,
  bodyMd: z.string(),
  origin: z.enum(["ai", "mentor"]),
  signature: z.string(),
  quoteWordsId: calkNull,
  tradeId: calkNull,
  mentorClaimId: calkNull,
  suggestionId: calkNull,
  createdAt: iso,
  revertedAt: isoNull,
});

export const DopiskiListaOdpowiedz = z.strictObject({ additions: z.array(DopisekOdpowiedz) });

/* --- Reguly i hipotezy ---------------------------------------------------------------------------------- */

const WersjaRegulyOut = z.strictObject({
  version: calk,
  status: z.enum(["proposed", "approved", "rejected", "superseded"]),
  origin: z.enum(["user", "ai", "mentor", "vault-import"]),
  textMd: z.string(),
  counterargument: tekstNull,
  evidence: z.unknown(),
  hypothesisId: calkNull,
  rulesetVersion: calkNull,
  proposedAt: iso,
  decidedAt: isoNull,
  podpis: z.string(),
});

export const ReguliListaOdpowiedz = z.strictObject({
  rulesVersion: calk,
  rules: z.array(
    z.strictObject({
      code: z.string(),
      title: z.string(),
      slug: z.string(),
      noteId: calk,
      hard: z.boolean(),
      status: z.enum(["proposed", "active", "retired", "rejected"]),
      pendingProposal: z.boolean(),
      retiredAt: isoNull,
      retiredReason: tekstNull,
      vaultStatus: tekstNull,
      current: WersjaRegulyOut.nullable(),
      proposal: WersjaRegulyOut.nullable(),
      versions: z.array(WersjaRegulyOut),
    }),
  ),
});

export const PropozycjaRegulyOdpowiedz = z.strictObject({
  rule: z.string(),
  version: calk,
  status: z.enum(["proposed", "approved", "rejected", "superseded"]),
  noteId: calk,
  created: z.boolean(),
  n: calkNull,
  signature: z.string(),
  note: z.string(),
});

export const HipotezyListaOdpowiedz = z.strictObject({
  hypotheses: z.array(
    z.strictObject({
      id: calk,
      code: z.string(),
      noteId: calk,
      title: z.string(),
      slug: z.string(),
      decision: z.enum(["active", "confirmed", "rejected", "abandoned"]),
      n: calk,
      nImported: calk,
      progN: calk,
      phase: z.enum(["zbieranie", "do_oceny"]),
      thresholds: obiekt,
      declaredAt: iso,
      decidedAt: isoNull,
    }),
  ),
});

export const HipotezaZapisOdpowiedz = z.strictObject({ id: calk, code: z.string(), noteId: calk, created: z.boolean() });

/* --- Plan zamrozony --------------------------------------------------------------------------------------- */

const PlanBaza = {
  id: calk,
  tradeId: calkNull,
  accountId: calk,
  instrumentId: calk,
  sessionId: calkNull,
  day: z.string(),
  setupId: calkNull,
  setupVersionId: calkNull,
  rulesetVersion: calk,
  direction: z.enum(["long", "short"]),
  bias: z.enum(["long", "short", "neutral"]).nullable(),
  entryPrice: z.number(),
  stopLoss: z.number(),
  takeProfit: liczbaNull,
  contracts: z.number(),
  /** Migawka ryzyka z computeTrade w chwili zamrozenia, w centach. */
  riskCents: calk,
  thesisWordsId: calkNull,
  invalidationWordsId: calkNull,
  origin: z.enum(["user", "ai"]),
  frozenAt: iso,
};

export const PlanDopisekOut = z.strictObject({
  id: calk,
  planId: calk,
  field: z.enum(["stop_loss", "take_profit", "contracts", "bias", "invalidation", "other"]).nullable(),
  newValue: z.unknown(),
  wordsId: calk,
  createdAt: iso,
});

export const PlanSzczegolyOdpowiedz = z.strictObject({
  ...PlanBaza,
  setup: z.strictObject({ slug: z.string(), name: z.string(), version: calkNull }).nullable(),
  thesis: slowaKrotkie.nullable(),
  invalidation: slowaKrotkie.nullable(),
  addenda: z.array(PlanDopisekOut.extend({ words: slowaKrotkie.nullable() })),
});

export const PlanyListaOdpowiedz = z.strictObject({ plans: z.array(z.strictObject(PlanBaza)), ...Strona });

export const PlanZapisOdpowiedz = z.strictObject({ created: z.boolean(), warnings: z.array(z.string()), plan: PlanSzczegolyOdpowiedz });

/* --- Playbook ---------------------------------------------------------------------------------------------- */

const WersjaSetupuOut = z.strictObject({
  id: calk,
  version: calk,
  status: z.enum(["proposed", "approved", "rejected", "superseded"]),
  origin: z.enum(["user", "ai", "mentor", "vault-import"]),
  signature: z.string(),
  preconditions: z.array(obiekt),
  entryChecklist: z.array(obiekt),
  stopRule: tekstNull,
  targetRule: tekstNull,
  beRule: tekstNull,
  invalidation: tekstNull,
  avoid: tekstNull,
  thresholds: obiekt,
  counterargument: tekstNull,
  evidence: z.unknown(),
  proposedAt: iso,
  decidedAt: isoNull,
  decisionReason: tekstNull,
});

export const StatystykaZrodlaOut = z.strictObject({
  n: calk,
  wins: calk,
  losses: calk,
  winRate: z.strictObject({ p: liczbaNull, low: liczbaNull, high: liczbaNull }),
  breakEvenWinRate: liczbaNull,
  avgWinR: liczbaNull,
  avgLossR: liczbaNull,
  expectancyR: z.strictObject({ mean: liczbaNull, low: liczbaNull, high: liczbaNull, orientacyjnie: z.boolean() }),
  status: z.enum(["niewazny", "niejednoznaczny", "obiecujacy", "potwierdzony"]),
  statusNazwa: z.string(),
  statusPowod: z.string(),
  opis: z.string(),
  progi: z.strictObject({ minN: calk, potwierdzenieN: calk }),
});

const ZrodloKlucz = z.enum(["backtest", "forward", "demo", "live"]);

export const StatystykaPoZrodlachOut = z.strictObject({
  bySource: z.strictObject({ backtest: StatystykaZrodlaOut.nullable(), forward: StatystykaZrodlaOut.nullable(), demo: StatystykaZrodlaOut.nullable(), live: StatystykaZrodlaOut.nullable() }),
  backtestToLive: z
    .strictObject({ backtestR: z.number(), liveR: z.number(), diffR: z.number(), backtestN: calk, liveN: calk, orientacyjnie: z.boolean() })
    .nullable(),
});

export const SetupyListaOdpowiedz = z.strictObject({
  setups: z.array(
    z.strictObject({
      id: calk,
      slug: z.string(),
      name: z.string(),
      noteId: calk,
      retiredAt: isoNull,
      createdAt: iso,
      currentVersion: calkNull,
      pendingProposal: z.strictObject({ version: calk, signature: z.string() }).nullable(),
    }),
  ),
});

export const SetupZapisOdpowiedz = z.strictObject({
  slug: z.string(),
  version: calk,
  noteId: calk,
  status: z.enum(["proposed", "approved", "rejected", "superseded"]),
  signature: z.string(),
  note: z.string(),
});

export const SetupWersjaZapisOdpowiedz = z.strictObject({
  slug: z.string(),
  version: calk,
  status: z.enum(["proposed", "approved", "rejected", "superseded"]),
  signature: z.string(),
  created: z.boolean(),
});

export const SetupSzczegolyOdpowiedz = z.strictObject({
  id: calk,
  slug: z.string(),
  name: z.string(),
  noteId: calk,
  bodyMd: z.string(),
  noteRev: calkNull,
  retiredAt: isoNull,
  createdAt: iso,
  current: WersjaSetupuOut.nullable(),
  proposal: WersjaSetupuOut.nullable(),
  versions: z.array(WersjaSetupuOut),
  thresholdsUsed: z.strictObject({ minN: calk, potwierdzenieN: calk }),
  thresholdsWarning: tekstNull,
  tradesLinked: calk,
  stats: StatystykaPoZrodlachOut,
  /** Statystyka osobno dla kazdej zatwierdzonej wersji, wedlug JEJ progow (progi nie dzialaja wstecz). */
  statsByVersion: z.array(
    z.strictObject({
      version: calk,
      status: z.enum(["approved", "superseded"]),
      thresholdsUsed: z.strictObject({ minN: calk, potwierdzenieN: calk }),
      stats: StatystykaPoZrodlachOut,
    }),
  ),
  /** Trade'y z tym setupem, ale bez wersji (sprzed wersjonowania): poza statystyka wersji. */
  unversionedTrades: calk,
  examples: z.array(
    z.strictObject({
      id: calk,
      tradeId: calk,
      kind: z.enum(["a_plus", "anti"]),
      screenshotId: calkNull,
      thumbnail: tekstNull,
      captionWordsId: calkNull,
      origin: z.enum(["user", "ai"]),
      createdAt: iso,
    }),
  ),
});

/* --- Prop --------------------------------------------------------------------------------------------------- */

const PresetOut = z.strictObject({
  id: calk,
  firm: z.string(),
  program: z.string(),
  phase: z.enum(["eval", "funded"]),
  accountSizeCents: calk,
  ddType: z.enum(["eod", "intraday", "static", "trailing_to_static"]),
  maxDdCents: calk,
  ddLockCents: calkNull,
  dailyLossCents: calkNull,
  profitTargetCents: calkNull,
  consistencyPct: liczbaNull,
  minDays: calkNull,
  maxContractsMini: calkNull,
  maxContractsMicro: calkNull,
  sourceUrl: z.string(),
  readOn: z.string(),
  ageDays: calk,
  effectiveFrom: tekstNull,
  needsVerification: z.boolean(),
  extra: obiekt,
  notes: tekstNull,
});

export const PropPresetyOdpowiedz = z.strictObject({ presets: z.array(PresetOut), count: calk });

export const PropRegulyOut = z.strictObject({
  id: calk,
  accountId: calk,
  presetId: calkNull,
  validFrom: z.string(),
  ddType: z.enum(["eod", "intraday", "static", "trailing_to_static"]),
  maxDdCents: calk,
  ddLockCents: calkNull,
  dailyLossCents: calkNull,
  profitTargetCents: calkNull,
  consistencyPct: liczbaNull,
  minDays: calkNull,
  maxContractsMini: calkNull,
  maxContractsMicro: calkNull,
  sourceUrl: tekstNull,
  extra: obiekt,
  confirmedAt: isoNull,
  preset: z.strictObject({ firm: z.string(), program: z.string(), phase: z.string(), readOn: z.string(), ageDays: calk, needsVerification: z.boolean() }).nullable(),
});

export const PropRegulyListaOdpowiedz = z.strictObject({ rules: z.array(PropRegulyOut) });

const StanKontaOut = z.strictObject({
  startBalanceCents: calk,
  balanceCents: calk,
  profitCents: calk,
  trailingBasis: z.enum(["eod", "intraday"]),
  trailingBasisCertain: z.boolean(),
  peakCents: calk,
  lockProfitCents: calkNull,
  lockReached: z.boolean(),
  drawdownFloorCents: calk,
  drawdownBufferCents: calk,
  drawdownUsed: z.number(),
  todayPnlCents: calk,
  dailyLossBufferCents: calkNull,
  dailyLossUsed: liczbaNull,
  nearestLimit: z.enum(["dd", "dll"]).nullable(),
  bufferCents: calk,
  ifStopHit: z
    .strictObject({
      riskCents: calk,
      drawdownBufferAfterCents: calk,
      dailyLossBufferAfterCents: calkNull,
      bufferAfterCents: z.number(),
      drawdownUsedAfter: z.number(),
      dailyLossUsedAfter: liczbaNull,
      bufferInR: z.number(),
      drawdownBufferInR: z.number(),
      dailyLossBufferInR: liczbaNull,
      exceedsLimit: z.boolean(),
    })
    .nullable(),
  warnings: z.array(
    z.strictObject({
      code: z.enum(["dd", "dll", "po_sl_dd", "po_sl_dll", "consistency", "kontrakty"]),
      level: z.union([z.literal(50), z.literal(75), z.literal(90), z.literal(100)]),
      text: z.string(),
    }),
  ),
  consistency: z
    .strictObject({
      pct: z.number(),
      basis: z.enum(["total", "goal", "cycle"]),
      effect: z.enum(["fail", "raise_target", "block_payout", "brak", "nieznany"]),
      certain: z.boolean(),
      bestDayCents: calk,
      denominatorCents: calkNull,
      share: liczbaNull,
      violated: z.boolean(),
      nearLimit: z.boolean(),
      requiredTargetCents: calkNull,
      remainingTodayCents: calkNull,
    })
    .nullable(),
  target: z.strictObject({ profitCents: calk, targetCents: calk, remainingCents: calk, reached: z.boolean() }).nullable(),
  tradingDays: calk,
  minDays: z.strictObject({ required: calk, have: calk, met: z.boolean() }).nullable(),
  notes: z.array(z.string()),
});

export const PropStatusOdpowiedz = z.strictObject({
  accountId: calk,
  accountName: z.string(),
  currency: z.string(),
  day: z.string(),
  rules: PropRegulyOut,
  /** Czy reguly obowiazujace w tym dniu potwierdzil uzytkownik w aplikacji (R29). */
  rulesConfirmed: z.boolean(),
  /** Reguly, na ktorych policzono bufory: niepotwierdzone liczymy na ostrzejszej z dwoch (ostatnia potwierdzona i nowa). */
  rulesUsed: z.strictObject({
    source: z.enum(["confirmed", "unconfirmed_only", "stricter_of_confirmed_and_unconfirmed"]),
    confirmedRuleId: calkNull,
    ddType: z.enum(["eod", "intraday", "static", "trailing_to_static"]),
    maxDdCents: calk,
    ddLockCents: calkNull,
    dailyLossCents: calkNull,
    profitTargetCents: calkNull,
    consistencyPct: liczbaNull,
    minDays: calkNull,
    maxContractsMini: calkNull,
    maxContractsMicro: calkNull,
  }),
  rulesNote: tekstNull,
  riskSource: z.enum(["query", "plan", "default"]).nullable(),
  state: StanKontaOut,
  contractWarnings: z.array(z.strictObject({ level: z.number(), text: z.string() })),
});

export const PropOverviewOdpowiedz = z.strictObject({
  day: z.string(),
  accounts: z.array(z.union([PropStatusOdpowiedz, z.strictObject({ accountId: calk, accountName: z.string(), error: z.string(), code: z.string() })])),
  exposureNq: z.strictObject({
    total: z.number(),
    perAccount: z.array(z.strictObject({ accountId: calk, nqEquivalent: z.number(), nqContracts: z.number(), mnqContracts: z.number() })),
    skippedSymbols: z.array(z.string()),
  }),
});

const WpisKsiegiOut = z.strictObject({ id: calk, accountId: calk, kind: z.string(), amountCents: calk, occurredOn: z.string(), note: tekstNull, createdAt: iso });

export const PropKsiegaOdpowiedz = z.strictObject({
  accountId: calk,
  entries: z.array(WpisKsiegiOut),
  summary: z.strictObject({ costsCents: calk, inflowsCents: calk, netCents: calk, byKind: z.record(z.string(), z.number()) }),
});

export const PropKsiegaZapisOdpowiedz = z.strictObject({ created: z.boolean(), entry: WpisKsiegiOut });

/* --- Przeglad tygodnia ----------------------------------------------------------------------------------------- */

const KomorkaOut = z.strictObject({ count: calk, sumR: z.number(), countR: calk, avgR: liczbaNull, sumPnlCents: calk, tradeIds: z.array(calk) });
const SlowaPelne = z.strictObject({ id: calk, text: z.string(), sha256: z.string() });

export const MetrykiTygodniaOut = z.strictObject({
  weekStart: z.string(),
  weekEnd: z.string(),
  scope: z.string(),
  trades: calk,
  timezone: z.string(),
  grid: z.strictObject({
    goodProcessWin: KomorkaOut,
    goodProcessLoss: KomorkaOut,
    badProcessWin: KomorkaOut,
    badProcessLoss: KomorkaOut,
    breakEvenGoodProcess: KomorkaOut,
    breakEvenBadProcess: KomorkaOut,
    ungraded: KomorkaOut,
    graded: calk,
    distribution: z.strictObject({
      A: KomorkaOut.extend({ share: liczbaNull }),
      B: KomorkaOut.extend({ share: liczbaNull }),
      C: KomorkaOut.extend({ share: liczbaNull }),
    }),
    costOfC: z.strictObject({ count: calk, sumR: z.number(), sumPnlCents: calk }),
  }),
  bestAndWorst: z.strictObject({ best: z.array(calk), worst: z.array(calk) }),
  discipline: z.strictObject({
    trades: calk,
    graded: calk,
    a: calk,
    b: calk,
    c: calk,
    shareA: liczbaNull,
    violations: z.array(z.strictObject({ code: z.string(), title: z.string(), description: z.string(), count: calk, tradeIds: z.array(calk) })),
    tradeIdsWithViolation: z.array(calk),
    violationCost: z.strictObject({ count: calk, sumR: z.number(), sumPnlCents: calk }),
    reviews: z.strictObject({ daysRequired: calk, daysCompleted: calk, weeksRequired: calk, weeksApproved: calk }),
    perDay: z.array(z.strictObject({ day: z.string(), trades: calk, graded: calk, a: calk, shareA: liczbaNull, violations: calk })),
  }),
});

export const PrzegladOut = z.strictObject({
  id: calk,
  weekStart: z.string(),
  status: z.enum(["draft", "approved"]),
  draftMd: tekstNull,
  draftSignature: tekstNull,
  statsSnapshot: obiekt.nullable(),
  asOf: isoNull,
  conclusions: SlowaPelne.nullable(),
  commitment: SlowaPelne.nullable(),
  prevReviewId: calkNull,
  prevCommitmentResult: z.enum(["kept", "partial", "broken"]).nullable(),
  prevResult: SlowaPelne.nullable(),
  approvedAt: isoNull,
});

export const PrzegladTygodniaOdpowiedz = z.strictObject({
  weekStart: z.string(),
  review: PrzegladOut.nullable(),
  previousReview: PrzegladOut.nullable(),
  commitmentToSettle: z.strictObject({ reviewId: calk, weekStart: z.string() }).nullable(),
  metrics: MetrykiTygodniaOut,
});

export const PrzegladZapisOdpowiedz = z.strictObject({ created: z.boolean(), review: PrzegladOut });

/* --- Kolejka AI -------------------------------------------------------------------------------------------------- */

export const SugestiaOut = z.strictObject({
  id: calk,
  kind: z.enum(["tag", "trade_link", "setup_example", "process_grade", "profile_term", "day_conclusion", "weekly_conclusion", "strategy_detail", "trade_setup", "broker_match", "broker_trade"]),
  status: z.enum(["pending", "accepted", "rejected", "applied", "reverted"]),
  target: obiekt,
  payload: obiekt,
  claim: z.string(),
  evidence: z.array(z.unknown()),
  evidenceLevel: z.enum(["tested", "partial", "inferred"]),
  n: calkNull,
  appliedRef: obiekt.nullable(),
  createdAt: iso,
  decidedAt: isoNull,
  signature: z.string(),
});

export const SugestieListaOdpowiedz = z.strictObject({ suggestions: z.array(SugestiaOut), ...Strona, counts: z.record(z.string(), z.number()) });

export const SugestiaZapisOdpowiedz = z.strictObject({ created: z.boolean(), suggestion: SugestiaOut, noteAdditionId: calkNull });

/* --- Warianty hipotez ---------------------------------------------------------------------------------------------- */

const WariantOut = z.strictObject({
  id: calk,
  hypothesisId: calkNull,
  label: z.string(),
  params: obiekt,
  paramsHash: z.string(),
  nTested: calk,
  result: obiekt.nullable(),
  origin: z.enum(["user", "ai"]),
  createdAt: iso,
});

const OstrzezenieWariantowOut = z.strictObject({ count: calk, n: calkNull, inflated: z.boolean(), inflationSigma: z.number(), text: z.string() });

export const WariantyOdpowiedz = z.strictObject({
  hypothesis: z.strictObject({ code: z.string(), n: calk, progN: calk }),
  variants: z.array(WariantOut),
  count: calk,
  warning: OstrzezenieWariantowOut.nullable(),
});

export const WariantZapisOdpowiedz = z.strictObject({ created: z.boolean(), variant: WariantOut, count: calk, warning: OstrzezenieWariantowOut.nullable() });

/* --- Adnotacje wykresu ---------------------------------------------------------------------------------------------- */

export const AdnotacjeListaOdpowiedz = z.strictObject({
  annotations: z.array(
    z.strictObject({
      id: calk,
      platform: z.enum(["tradingview", "fxreplay"]),
      externalId: z.string(),
      tradeId: calkNull,
      sessionId: calkNull,
      day: tekstNull,
      shape: z.enum(["hline", "rect", "trend", "text", "other"]),
      interval: tekstNull,
      price: liczbaNull,
      price2: liczbaNull,
      timeFrom: isoNull,
      timeTo: isoNull,
      capturedAt: iso,
      words: SlowaOdpowiedz.nullable(),
    }),
  ),
  ...Strona,
});

export const AdnotacjeZapisOdpowiedz = z.strictObject({
  results: z.array(
    z.strictObject({
      externalId: z.string(),
      status: z.enum(["created", "unchanged", "updated", "text_changed", "refused"]),
      annotationId: calkNull,
      wordsId: calkNull,
      error: z.string().optional(),
    }),
  ),
  summary: z.strictObject({ created: calk, unchanged: calk, updated: calk, text_changed: calk, refused: calk }),
});

/* --- Profil ------------------------------------------------------------------------------------------------------------ */

export const ProfilOdpowiedz = z.strictObject({
  terms: z.array(
    z.strictObject({
      id: calk,
      term: z.string(),
      meaning: z.string(),
      status: z.enum(["proposed", "confirmed", "rejected"]),
      origin: z.enum(["user", "ai"]),
      conceptNoteId: calkNull,
      createdAt: iso,
      decidedAt: isoNull,
      sources: z.array(z.strictObject({ wordsId: calk, text: z.string(), tradeId: calkNull, noteId: calkNull })),
    }),
  ),
  corrections: z.array(
    z.strictObject({
      id: calk,
      wordsId: calk,
      words: z.string(),
      beforeInterpretation: z.string(),
      afterInterpretation: z.string(),
      correctionWordsId: calk,
      correction: tekstNull,
      termId: calkNull,
      createdAt: iso,
    }),
  ),
  correctionRate: z.array(z.strictObject({ month: z.string(), interpreted: calk, corrected: calk, rate: liczbaNull })),
  verdicts: z.strictObject({ aiVerdicts: calk, overrides: calk, ruleDisagreements: calk, changedByUser: calk }),
});

export const KorektaInterpretacjiOdpowiedz = z.strictObject({
  correctionId: calk,
  wordsId: calk,
  interpretation: z.string(),
  termSuggestionId: calkNull,
});

/* --- Luki i »Do rozstrzygniecia« --------------------------------------------------------------------------------------- */

export const LukiListaOdpowiedz = z.strictObject({
  gaps: z.array(
    z.strictObject({
      id: calk,
      kind: z.enum(["gap", "mentor_conflict"]),
      question: z.string(),
      status: z.enum(["open", "asked", "answered", "dismissed"]),
      origin: z.enum(["ai", "mentor"]),
      setup: z.strictObject({ id: calk, slug: z.string(), name: z.string() }).nullable(),
      tradeId: calkNull,
      noteId: calkNull,
      mentorClaim: z
        .strictObject({ id: calk, quote: z.string(), tStartS: calk, claimType: z.string(), videoId: z.string(), videoTitle: z.string(), link: z.string() })
        .nullable(),
      askedAt: isoNull,
      answeredAt: isoNull,
      resolution: z.enum(["keep_mine", "take_mentor", "both_conditional"]).nullable(),
      answer: SlowaOdpowiedz.nullable(),
      createdAt: iso,
    }),
  ),
  ...Strona,
});

export const LukaZapisOdpowiedz = z.strictObject({ created: z.boolean(), id: calk, kind: z.enum(["gap", "mentor_conflict"]), status: z.enum(["open", "asked", "answered", "dismissed"]) });

export const LukaZadanaOdpowiedz = z.strictObject({ id: calk, status: z.enum(["open", "asked", "answered", "dismissed"]), askedAt: isoNull });

/* --- Mentor ---------------------------------------------------------------------------------------------------------------- */

export const MentorZrodloOut = z.strictObject({
  id: calk,
  platform: z.literal("youtube"),
  videoId: z.string(),
  playlistId: tekstNull,
  position: calkNull,
  title: z.string(),
  url: z.string(),
  publishedAt: isoNull,
  durationS: calkNull,
  status: z.enum(["pending", "processed", "no_captions", "error"]),
  transcriptSource: z.enum(["captions", "whisper"]).nullable(),
  transcriptPath: tekstNull,
  error: tekstNull,
  processedAt: isoNull,
});

export const MentorZrodlaListaOdpowiedz = z.strictObject({ sources: z.array(MentorZrodloOut), ...Strona, counts: z.record(z.string(), z.number()) });
export const MentorZrodloZapisOdpowiedz = z.strictObject({ created: z.boolean(), source: MentorZrodloOut });

export const MentorTwierdzenieOut = z.strictObject({
  id: calk,
  sourceId: calk,
  videoId: z.string(),
  videoTitle: z.string(),
  quote: z.string(),
  quoteSha256: z.string(),
  tStartS: calk,
  tEndS: calkNull,
  link: z.string(),
  claimType: z.enum(["concept", "setup_condition", "management", "psychology", "other"]),
  paraphrase: tekstNull,
  paraphraseSignature: tekstNull,
  status: z.enum(["extracted", "merged", "review_ok", "review_bad"]),
  mergedNoteId: calkNull,
  setupId: calkNull,
  createdAt: iso,
});

export const MentorTwierdzeniaListaOdpowiedz = z.strictObject({ claims: z.array(MentorTwierdzenieOut), ...Strona });

export const MentorTwierdzeniaZapisOdpowiedz = z.strictObject({
  results: z.array(z.strictObject({ index: calk, status: z.enum(["created", "unchanged", "refused"]), claimId: calkNull, error: z.string().optional() })),
  summary: z.strictObject({ created: calk, unchanged: calk, refused: calk }),
});

/* --- Szczegoly trade'a -------------------------------------------------------------------------------------------------------- */

export const TradeSzczegolyOdpowiedz = z.strictObject({
  trade: z.strictObject({
    id: calk,
    externalRef: tekstNull,
    source: z.string(),
    status: z.string(),
    accountId: calk,
    accountName: z.string(),
    accountType: z.string(),
    symbol: z.string(),
    sessionId: calkNull,
    sessionKind: z.enum(["backtest", "forward"]).nullable(),
    sessionName: tekstNull,
    dataSource: ZrodloKlucz,
    direction: z.enum(["long", "short"]),
    entryTime: iso,
    entryPrice: z.number(),
    contracts: z.number(),
    stopLoss: liczbaNull,
    takeProfit: liczbaNull,
    tradingDay: tekstNull,
    marketSession: tekstNull,
    note: tekstNull,
    moodNote: tekstNull,
    readiness: calkNull,
    tags: z.array(z.strictObject({ assignmentId: calk, tagId: calk, name: z.string(), category: z.string(), interval: tekstNull, origin: z.enum(["user", "ai"]) })),
    processGrade: z.enum(["A", "B", "C"]).nullable(),
    processGradedAt: isoNull,
    setupId: calkNull,
    setupVersionId: calkNull,
    rulesetVersion: calkNull,
    dayKnown: z.boolean(),
    createdAt: iso,
    updatedAt: iso,
  }),
  /** true = wynik ukryty: trade nie jest zamkniety, a ma werdykt AI wydany przed wynikiem. */
  resultHidden: z.boolean(),
  resultHiddenReason: tekstNull,
  /** Co jeszcze ukryto razem z wynikiem (oceny po fakcie, wnioski, notatki trade'a) i ile ocen po fakcie pominieto. */
  hiddenFields: z.array(z.string()),
  hiddenReviews: calk,
  result: z
    .strictObject({
      exitPrice: liczbaNull,
      exitTime: isoNull,
      pnlCents: calkNull,
      riskCents: calkNull,
      rMultiple: liczbaNull,
      mae: liczbaNull,
      mfe: liczbaNull,
      exits: z.array(z.strictObject({ id: calk, time: isoNull, price: z.number(), contracts: z.number(), note: tekstNull })),
      /** Wynik jest NETTO (po oplatach, ADR-034): oplaty, wynik wyliczony z cen i zrodlo wyniku (szacunek albo rachunek). */
      ...WynikNettoOdpowiedz,
    })
    .nullable(),
  /** Trade brokera dopasowany do tego trade'a (dane z rachunku) albo null. Przy ukrytym wyniku bez pol wyniku. */
  broker: BlokBrokerOdpowiedz.nullable(),
  plan: PlanSzczegolyOdpowiedz.nullable(),
  screenshots: z.array(
    z.strictObject({
      id: calk,
      file: z.string(),
      thumbnail: tekstNull,
      interval: tekstNull,
      origin: z.string(),
      sha256: tekstNull,
      capturedAt: isoNull,
      chartState: obiekt.nullable(),
      caption: tekstNull,
      width: calkNull,
      height: calkNull,
    }),
  ),
  reviews: z.array(
    z.strictObject({
      id: calk,
      kind: z.enum(["ai", "user_override"]),
      basis: z.enum(["chart", "history"]),
      setupType: tekstNull,
      summaryMd: tekstNull,
      lesson: tekstNull,
      brainVerdict: z.enum(["wejdz", "czekaj", "odpusc"]).nullable(),
      brainPlan: obiekt.nullable(),
      model: tekstNull,
      evidenceCutoff: isoNull,
      asOf: isoNull,
      evidenceHash: tekstNull,
      rulesetVersion: calkNull,
      immutable: z.boolean(),
      overridesReviewId: calkNull,
      overriddenBy: z.array(calk),
      changedByUser: calk,
      lookAhead: z.strictObject({ moglZnacDzien: z.boolean(), powod: z.string() }).nullable(),
      createdAt: iso,
      ruleChecks: z.array(
        z.strictObject({
          ruleId: z.string(),
          ruleText: z.string(),
          verdict: z.enum(["pass", "fail", "na", "unclear"]),
          evidence: tekstNull,
          userVerdict: z.enum(["agree", "disagree"]).nullable(),
          ruleVersionId: calkNull,
        }),
      ),
    }),
  ),
  userWords: z.array(SlowaOdpowiedz),
  chartAnnotations: z.array(
    z.strictObject({
      id: calk,
      platform: z.string(),
      externalId: z.string(),
      shape: z.string(),
      interval: tekstNull,
      price: liczbaNull,
      price2: liczbaNull,
      timeFrom: isoNull,
      timeTo: isoNull,
      capturedAt: iso,
      words: SlowaOdpowiedz.nullable(),
    }),
  ),
  links: z.array(z.strictObject({ id: calk, noteId: calk, role: z.string(), origin: z.string(), title: z.string(), kind: z.string(), slug: z.string() })),
});

export const SlowaListaOdpowiedz = z.strictObject({ words: z.array(SlowaOdpowiedz), ...Strona });
