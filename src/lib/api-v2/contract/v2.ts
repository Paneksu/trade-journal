import { z } from "zod";

import { SCOPES } from "../scopes";
import { czas } from "./schemas";

/**
 * Schematy zapytan i odpowiedzi API v2 poza tym, co przeniesiono z ADR-026
 * (`schemas.ts`). Walidacja po stronie serwera jest jedyna, ktora sie liczy;
 * obiekty sa scisle (`strictObject`), wiec literowka w nazwie pola to blad,
 * a nie po cichu zgubiona wartosc.
 */

export const ScopeSchema = z.enum(SCOPES);

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;
export const DataSchema = z
  .string()
  .regex(REGEX_DATA, { message: "oczekiwano daty YYYY-MM-DD" })
  // Zod 4 uruchamia refine takze po nieudanym regexie, a toISOString() na Invalid Date rzuca RangeError (-> 500).
  .refine(
    (w) => {
      const d = new Date(`${w}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(w);
    },
    { message: "nie jest poprawną datą kalendarzową" },
  );

const idDodatnie = z.number().int().positive();
export const IdSchema = idDodatnie;

/* --- Urzadzenia (device code, ADR-030) ------------------------------------ */

export const DeviceStartSchema = z
  .strictObject({
    clientName: z.string().trim().min(1).max(80),
    scopes: z.array(ScopeSchema).min(1).max(3),
  })
  .superRefine((d, ctx) => {
    if (new Set(d.scopes).size !== d.scopes.length) {
      ctx.addIssue({ code: "custom", path: ["scopes"], message: "zakresy nie mogą się powtarzać" });
    }
  });

export const DeviceStartOdpowiedz = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  expiresIn: z.number().int(),
  interval: z.number().int(),
});

export const DeviceTokenSchema = z.strictObject({
  deviceCode: z.string().min(20).max(128),
});

export const DeviceTokenOdpowiedz = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer"),
  tokenId: z.number().int(),
  scopes: z.array(ScopeSchema),
});

/* --- Notatki ------------------------------------------------------------- */

export const KINDY_NOTATEK = [
  "system",
  "concept",
  "rule",
  "decision_proc",
  "trade_note",
  "session",
  "hypothesis",
  "mistake",
  "strength",
  "brain_decision",
  "learning",
  "profile",
  "strategy",
  "setup",
] as const;
export const KindNotatkiSchema = z.enum(KINDY_NOTATEK);

/** Pochodzenie, ktore moze zadeklarowac klient API. `user` jest zarezerwowane dla UI. */
export const OriginApiSchema = z.enum(["ai", "mentor", "vault-import"]);

export const NotatkaUtworzSchema = z.strictObject({
  kind: KindNotatkiSchema,
  title: z.string().min(1).max(200),
  bodyMd: z.string().max(200_000).default(""),
  meta: z.record(z.string(), z.unknown()).default({}),
  origin: OriginApiSchema.default("ai"),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,119}$/, { message: "slug: małe litery ASCII, cyfry i myślniki, do 120 znaków" })
    .optional(),
  tradeId: idDodatnie.optional(),
  backtestSessionId: idDodatnie.optional(),
  day: DataSchema.optional(),
  externalRef: z.string().min(1).max(200).optional(),
});

export const NotatkaZmienSchema = z
  .strictObject({
    title: z.string().min(1).max(200).optional(),
    bodyMd: z.string().max(200_000).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    /** Kasowania w API nie ma (ADR-032); notatke odklada sie do archiwum i przywraca. */
    archived: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "podaj co najmniej jedno pole do zmiany" });

export const NotatkiListaQuery = z.strictObject({
  kind: KindNotatkiSchema.optional(),
  slug: z.string().max(120).optional(),
  externalRef: z.string().max(200).optional(),
  day: DataSchema.optional(),
  tradeId: z.coerce.number().int().positive().optional(),
  includeArchived: z
    .enum(["true", "false"])
    .transform((w) => w === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  after: z.coerce.number().int().min(0).default(0),
});

export const NotatkaOdpowiedz = z.object({
  id: z.number().int(),
  kind: KindNotatkiSchema,
  slug: z.string(),
  title: z.string(),
  bodyMd: z.string(),
  meta: z.record(z.string(), z.unknown()),
  origin: z.string(),
  rev: z.number().int(),
  contentHash: z.string(),
  tradeId: z.number().int().nullable(),
  backtestSessionId: z.number().int().nullable(),
  day: z.string().nullable(),
  externalRef: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/* --- Slowa uzytkownika (doslownie) ----------------------------------------- */

export const ZRODLA_SLOW_API = ["chat", "note", "chart", "mobile", "vault-import"] as const;

export const SlowaUtworzSchema = z.strictObject({
  /** Bajt w bajt: bez trim, bez NFC, bez zamiany CRLF. */
  text: z.string().min(1).max(50_000),
  /** SHA-256 hex z bajtow UTF-8 tekstu u klienta; niezgodnosc = 400. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, { message: "oczekiwano 64 znaków hex (małe litery)" }),
  source: z.enum(ZRODLA_SLOW_API),
  role: z
    .string()
    .regex(/^[a-z][a-z0-9_.]{0,59}$/, { message: "rola: małe litery, cyfry, _ i ., np. trade.note" })
    .optional(),
  tradeId: idDodatnie.optional(),
  noteId: idDodatnie.optional(),
  backtestSessionId: idDodatnie.optional(),
  day: DataSchema.optional(),
  /** Kiedy uzytkownik to napisal (zegar klienta), z offsetem. */
  capturedAt: czas,
  aiInterpretation: z.string().min(1).max(20_000).optional(),
  interpretationModel: z.string().min(1).max(120).optional(),
});

export const InterpretacjaSchema = z.strictObject({
  text: z.string().min(1).max(20_000),
  model: z.string().min(1).max(120),
});

export const SlowaListaQuery = z.strictObject({
  tradeId: z.coerce.number().int().positive().optional(),
  noteId: z.coerce.number().int().positive().optional(),
  backtestSessionId: z.coerce.number().int().positive().optional(),
  day: DataSchema.optional(),
  role: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  after: z.coerce.number().int().min(0).default(0),
});

export const SlowaOdpowiedz = z.object({
  id: z.number().int(),
  text: z.string(),
  sha256: z.string(),
  byteLen: z.number().int(),
  source: z.string(),
  role: z.string().nullable(),
  tradeId: z.number().int().nullable(),
  noteId: z.number().int().nullable(),
  backtestSessionId: z.number().int().nullable(),
  day: z.string().nullable(),
  capturedAt: z.string(),
  aiInterpretation: z.string().nullable(),
  interpretationModel: z.string().nullable(),
  supersedesId: z.number().int().nullable(),
  createdAt: z.string(),
});

/* --- Reguly i hipotezy ----------------------------------------------------- */

export const StatusRegulyFiltr = z.enum(["all", "proposed", "active", "retired", "rejected"]);

export const ReguliListaQuery = z.strictObject({
  status: StatusRegulyFiltr.default("all"),
});

export const PropozycjaReguly = z
  .strictObject({
    /** Istniejaca regula, do ktorej dokladamy nowa wersje; brak = nowa regula. */
    ruleCode: z.string().regex(/^R-\d{3,}$/, { message: "kod reguły: R-007" }).optional(),
    /** Tytul notatki nowej reguly (wymagany bez ruleCode). */
    title: z.string().min(1).max(200).optional(),
    textMd: z.string().min(1).max(10_000),
    hard: z.boolean().optional(),
    origin: OriginApiSchema,
    /** Najsilniejszy kontrargument (MUST 10); wymagany przy origin = ai. */
    counterargument: z.string().min(1).max(4_000).optional(),
    /** Dowody: trade'y, swiece, zrzuty, poziom dowodu, n. Wymagane przy ai i mentor. */
    evidence: z.record(z.string(), z.unknown()).optional(),
    /** Podstawa propozycji AI; z niej liczy sie n (bramka progu). */
    hypothesisId: idDodatnie.optional(),
    /** Status reguly w sejfie Obsidiana (import) - informacja dla UI, NIE zatwierdzenie. */
    vaultStatus: z.string().min(1).max(40).optional(),
    /** Klucz idempotencji importu, np. vault:Reguly/R-007.md. */
    externalRef: z.string().min(1).max(200).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.ruleCode === undefined && p.title === undefined) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "nowa reguła (bez ruleCode) wymaga title" });
    }
    if (p.origin === "ai") {
      for (const pole of ["counterargument", "evidence", "hypothesisId"] as const) {
        if (p[pole] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [pole],
            message: `propozycja AI wymaga pola ${pole} (kontrargument, dowody i hipoteza, z której liczy się n)`,
          });
        }
      }
    }
    if (p.origin === "mentor" && p.evidence === undefined) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "propozycja mentora wymaga evidence: cytatu z filmu (video, t=)" });
    }
    if (p.origin !== "ai" && p.hypothesisId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["hypothesisId"],
        message: "hipotezę podaje się tylko przy propozycji AI (mentor i import nie mają progu n)",
      });
    }
  });

export const HipotezaUtworzSchema = z.strictObject({
  title: z.string().min(1).max(200),
  bodyMd: z.string().max(200_000).default(""),
  progN: z.number().int().min(1).max(10_000).default(20),
  /** Progi statusu ZADEKLAROWANE Z GORY (dolna granica Wilsona itp.). */
  thresholds: z.record(z.string(), z.unknown()).default({}),
  /** n z sejfu sprzed aplikacji. */
  nImported: z.number().int().min(0).max(1_000_000).default(0),
  origin: OriginApiSchema.default("ai"),
  externalRef: z.string().min(1).max(200).optional(),
});

/* --- Dzien ---------------------------------------------------------------- */

export const DzienQuery = z.strictObject({
  accountId: z.coerce.number().int().positive().optional(),
  sessionId: z.coerce.number().int().positive().optional(),
});

const ocena15 = z.number().int().min(1).max(5).nullable();

export const DzienZapisSchema = z.strictObject({
  accountId: idDodatnie.nullish(),
  sessionId: idDodatnie.nullish(),
  preSession: z.string().max(20_000).nullish(),
  postSession: z.string().max(20_000).nullish(),
  mood: ocena15.optional(),
  energy: ocena15.optional(),
  dayRating: ocena15.optional(),
  noTrade: z.boolean().optional(),
  noTradeReason: z.string().max(40).nullish(),
});

/* --- Wyszukiwanie ----------------------------------------------------------- */

export const TYPY_WYSZUKIWANIA = ["notes", "words", "trades"] as const;

export const SzukajQuery = z.strictObject({
  q: z.string().trim().min(1).max(200),
  types: z
    .string()
    .optional()
    .transform((w) => (w ? w.split(",").map((s) => s.trim()).filter(Boolean) : [...TYPY_WYSZUKIWANIA]))
    .pipe(z.array(z.enum(TYPY_WYSZUKIWANIA)).min(1)),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const BladOdpowiedz = z.object({
  error: z.string(),
  code: z.string(),
  requestId: z.string().optional(),
});
