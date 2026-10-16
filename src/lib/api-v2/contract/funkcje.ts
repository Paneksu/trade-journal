import { z } from "zod";

import { czas } from "./schemas";
import { DataSchema, DowodMentora, OriginApiSchema } from "./v2";

/**
 * Kontrakt funkcji MUST (faza 2b, ADR-033): plan zamrozony, playbook, prop,
 * przeglad tygodnia, kolejka AI, warianty, adnotacje wykresu, profil, luki,
 * mentor. Zasada ta sama co w `v2.ts`: obiekty scisle, walidacja po stronie
 * serwera jest jedyna, ktora sie liczy.
 */

const id = z.number().int().positive();
const cena = z.number().finite();
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, { message: "oczekiwano 64 znaków hex (małe litery)" });
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const slug = z.string().regex(SLUG, { message: "slug: małe litery ASCII, cyfry i myślniki, do 80 znaków" });

/** Id z segmentu adresu albo zapytania (zawsze tekst). */
const idZQuery = z.coerce.number().int().positive();
const strona = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  after: z.coerce.number().int().min(0).default(0),
};

/* --- Plan zamrozony (MUST 1) -------------------------------------------------- */

export const PlanUtworzSchema = z.strictObject({
  accountId: id,
  /** Symbol z katalogu instrumentow (NQ, MNQ, NQ1!...), mapowany jak przy trade'ach. */
  symbol: z.string().min(1).max(40),
  /** Dzien handlowy planu. */
  day: DataSchema,
  direction: z.enum(["long", "short"]),
  bias: z.enum(["long", "short", "neutral"]).optional(),
  entryPrice: cena,
  stopLoss: cena,
  takeProfit: cena.nullish(),
  contracts: z.number().finite().positive(),
  /** Setup z playbooka; plan zapisuje jego obowiazujaca (zatwierdzona) wersje. */
  setupSlug: slug.optional(),
  /** Slowa uzytkownika (teza, unieważnienie) zapisane wczesniej przez POST /user-words. */
  thesisWordsId: id.optional(),
  invalidationWordsId: id.optional(),
  tradeId: id.optional(),
  sessionId: id.optional(),
});

export const PLAN_POLA_DOPISKU = ["stop_loss", "take_profit", "contracts", "bias", "invalidation", "other"] as const;

export const PlanDopisekSchema = z.strictObject({
  field: z.enum(PLAN_POLA_DOPISKU).nullish(),
  /** Nowa wartosc pola (dowolny JSON); sam dopisek nie zmienia zamrozonego planu. */
  newValue: z.unknown().optional(),
  /** Slowa uzytkownika uzasadniajace zmiane (obowiazkowe: zmiana planu to jego decyzja). */
  wordsId: id,
});

export const PlanPrzypiecieSchema = z.strictObject({ tradeId: id });

export const PlanyListaQuery = z.strictObject({
  tradeId: idZQuery.optional(),
  accountId: idZQuery.optional(),
  day: DataSchema.optional(),
  ...strona,
});

/* --- Playbook (MUST 4) ----------------------------------------------------------- */

const PunktListy = z.strictObject({ id: z.string().min(1).max(40), text: z.string().min(1).max(500) });
const PunktChecklisty = z.strictObject({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(500),
  rule_code: z.string().regex(/^R-\d{3,}$/, { message: "kod reguły: R-007" }).optional(),
});

export const ProgiStatusuSchema = z.strictObject({
  /** Ponizej tylu trade'ow status to »nieważny« (za mało danych). */
  minN: z.number().int().min(1).max(100_000).default(20),
  /** Od tylu trade'ow dolna granica Wilsona nad break-even daje »potwierdzony«. */
  potwierdzenieN: z.number().int().min(1).max(100_000).default(100),
});

const polaWersjiSetupu = {
  preconditions: z.array(PunktListy).max(40).default([]),
  entryChecklist: z.array(PunktChecklisty).max(60).default([]),
  stopRule: z.string().max(4_000).nullish(),
  targetRule: z.string().max(4_000).nullish(),
  beRule: z.string().max(4_000).nullish(),
  invalidation: z.string().max(4_000).nullish(),
  avoid: z.string().max(4_000).nullish(),
  /** Progi statusu zadeklarowane Z GORY; zmiana progu = nowa wersja. */
  thresholds: ProgiStatusuSchema.default({ minN: 20, potwierdzenieN: 100 }),
  origin: OriginApiSchema,
  counterargument: z.string().min(1).max(4_000).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
};

function sprawdzDowodWersji(
  w: { origin: "ai" | "mentor" | "vault-import"; counterargument?: string; evidence?: Record<string, unknown> },
  ctx: z.RefinementCtx,
) {
  if (w.origin === "ai") {
    for (const pole of ["counterargument", "evidence"] as const) {
      if (w[pole] === undefined) {
        ctx.addIssue({ code: "custom", path: [pole], message: `wersja zgłoszona przez AI wymaga pola ${pole} (najsilniejszy kontrargument i dowody)` });
      }
    }
  }
  if (w.origin === "mentor") {
    if (w.evidence === undefined) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "wersja od mentora wymaga evidence: {video, t, quote}, wszystkie niepuste" });
    } else {
      const dowod = DowodMentora.safeParse(w.evidence);
      if (!dowod.success) {
        for (const i of dowod.error.issues) {
          ctx.addIssue({ code: "custom", path: ["evidence", ...i.path], message: i.code === "unrecognized_keys" ? "evidence mentora ma tylko pola video, t, quote" : i.message });
        }
      }
    }
  }
}

export const SetupUtworzSchema = z
  .strictObject({
    name: z.string().min(1).max(120),
    slug: slug.optional(),
    /** Opis karty (notatka rodzaju setup). */
    bodyMd: z.string().max(200_000).default(""),
    ...polaWersjiSetupu,
  })
  .superRefine(sprawdzDowodWersji);

export const SetupWersjaSchema = z.strictObject(polaWersjiSetupu).superRefine(sprawdzDowodWersji);

export const SetupyListaQuery = z.strictObject({
  includeRetired: z
    .enum(["true", "false"])
    .transform((w) => w === "true")
    .optional(),
});

/* --- Prop (MUST 7) ------------------------------------------------------------------ */

export const PropPresetyQuery = z.strictObject({
  firm: z.string().min(1).max(120).optional(),
  phase: z.enum(["eval", "funded"]).optional(),
  accountSizeCents: z.coerce.number().int().positive().optional(),
});

const nadpisania = {
  ddType: z.enum(["eod", "intraday", "static", "trailing_to_static"]).optional(),
  maxDdCents: z.number().int().positive().optional(),
  ddLockCents: z.number().int().nonnegative().nullish(),
  dailyLossCents: z.number().int().positive().nullish(),
  profitTargetCents: z.number().int().positive().nullish(),
  consistencyPct: z.number().gt(0).lte(100).nullish(),
  minDays: z.number().int().positive().nullish(),
  maxContractsMini: z.number().int().positive().nullish(),
  maxContractsMicro: z.number().int().positive().nullish(),
  /** Stawka oplat round turn za kontrakt (prowizja + gielda + NFA), centy: mini i micro (ADR-034). Bez wartosci: z presetu. */
  feeRtMiniCents: z.number().int().nonnegative().nullish(),
  feeRtMicroCents: z.number().int().nonnegative().nullish(),
  feeSourceUrl: z.string().url().startsWith("https://").nullish(),
  sourceUrl: z.string().url().startsWith("https://").nullish(),
  extra: z.record(z.string(), z.unknown()).optional(),
};

/**
 * Przypiecie regul do konta: preset jako punkt wyjscia (`presetId`) + dowolne nadpisania.
 * `validFrom` = data zakupu konta albo wejscia w zycie regulaminu. Bez presetu trzeba podac
 * `ddType` i `maxDdCents`. `confirmedAt` ustawia wylacznie uzytkownik w aplikacji (R29).
 */
export const PropRegulyUtworzSchema = z
  .strictObject({
    presetId: id.optional(),
    validFrom: DataSchema,
    ...nadpisania,
  })
  .superRefine((r, ctx) => {
    if (r.presetId === undefined) {
      if (r.ddType === undefined) ctx.addIssue({ code: "custom", path: ["ddType"], message: "bez presetId podaj ddType (eod | intraday | static | trailing_to_static)" });
      if (r.maxDdCents === undefined) ctx.addIssue({ code: "custom", path: ["maxDdCents"], message: "bez presetId podaj maxDdCents (centy)" });
    }
  });

export const PropStatusQuery = z.strictObject({
  /** Dzien handlowy »dzisiaj« (YYYY-MM-DD); domyslnie dzien wg strefy gieldy NQ. */
  day: DataSchema.optional(),
  /** Ryzyko planowanego trade'u w centach (z computeTrade); bufor »gdy trafi SL«. */
  riskCents: z.coerce.number().int().positive().optional(),
  /** Alternatywnie: plan zamrozony, z ktorego bierzemy ryzyko. */
  planId: idZQuery.optional(),
});

export const PropOverviewQuery = z.strictObject({ day: DataSchema.optional() });

export const PROP_KSIEGA_RODZAJE = ["eval_fee", "reset_fee", "activation_fee", "subscription", "data_fee", "payout", "refund", "other"] as const;

export const PropKsiegaWpisSchema = z.strictObject({
  kind: z.enum(PROP_KSIEGA_RODZAJE),
  /** Ze znakiem: koszt ujemny, wplyw dodatni; w centach. */
  // Górna granica (audyt fazy 5, pkt 5): ±10 mln USD w centach; większa kwota to pomyłka w polu, nie opłata za eval.
  amountCents: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine((w) => w !== 0, { message: "kwota nie może być zerem" }),
  occurredOn: DataSchema,
  note: z.string().max(500).nullish(),
});

/* --- Przeglad tygodnia (MUST 9) ------------------------------------------------------ */

export const PrzegladTygodniaQuery = z.strictObject({ weekStart: DataSchema });

export const PrzegladTygodniaZapisSchema = z.strictObject({
  /** Szkic AI; w UI zawsze podpisany pochodzeniem. */
  draftMd: z.string().max(100_000).nullish(),
  /** Slowa uzytkownika: wnioski tygodnia. */
  conclusionsWordsId: id.nullish(),
  /** JEDNO zobowiazanie na kolejny tydzien (slowa uzytkownika). Po ustawieniu nie zmienia sie. */
  commitmentWordsId: id.optional(),
  /** Rozliczenie zobowiazania z poprzedniego tygodnia (raz ustawione nie zmienia sie; null nie kasuje). */
  prevCommitmentResult: z.enum(["kept", "partial", "broken"]).optional(),
  prevResultWordsId: id.optional(),
});

/* --- Kolejka AI (MUST 10, 15) ---------------------------------------------------------- */

const celTrade = z.strictObject({ type: z.literal("trade"), id });
const celDzien = z.strictObject({ type: z.literal("day"), date: DataSchema });
const celTydzien = z.strictObject({ type: z.literal("week"), weekStart: DataSchema });
const celNotatka = z.strictObject({ type: z.literal("note"), id });
const celProfil = z.strictObject({ type: z.literal("profile") });
const celTradeBrokera = z.strictObject({ type: z.literal("broker_trade"), id });

const Dowod = z.strictObject({
  /** Rodzaj dowodu: trade, swieca, zrzut, notatka, slowa uzytkownika... */
  type: z.string().min(1).max(40),
  ref: z.union([z.string().min(1).max(200), z.number().int()]).optional(),
  note: z.string().max(1_000).optional(),
});

const bazaSugestii = {
  claim: z.string().min(1).max(500),
  evidence: z.array(Dowod).min(1).max(40),
  evidenceLevel: z.enum(["tested", "partial", "inferred"]),
  n: z.number().int().min(0).nullish(),
};

export const SugestiaUtworzSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("tag"),
    target: celTrade,
    payload: z.strictObject({ tagId: id, interval: z.string().max(10).nullish() }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("trade_link"),
    target: celTrade,
    payload: z.strictObject({ noteId: id, role: z.enum(["hypothesis", "concept", "mistake", "strength", "other"]) }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("setup_example"),
    target: celTrade,
    payload: z.strictObject({
      setupSlug: slug,
      exampleKind: z.enum(["a_plus", "anti"]),
      screenshotId: id.nullish(),
      captionWordsId: id.nullish(),
    }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("process_grade"),
    target: celTrade,
    payload: z.strictObject({ grade: z.enum(["A", "B", "C"]) }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("trade_setup"),
    target: celTrade,
    /** Przypisanie setupu do trade'u przez AI: liczy sie w statystykach setupu dopiero po zatwierdzeniu w UI. */
    payload: z.strictObject({ setupSlug: slug }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("broker_match"),
    target: celTrade,
    /** Dopasowanie trade'a dziennika (cel) do trade'a brokera, gdy automat nie mogl tego rozstrzygnac (kilku kandydatow, inna liczba kontraktow). Zatwierdza uzytkownik jednym kliknieciem. */
    payload: z.strictObject({ brokerTradeId: id }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("broker_trade"),
    target: celTradeBrokera,
    /** Propozycja utworzenia trade'a dziennika z danych brokera (gdy w dzienniku nie ma trade'a). Powstaje dopiero po zatwierdzeniu w UI. */
    payload: z.strictObject({ noteId: id.nullish(), wordsIds: z.array(id).max(20).default([]) }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("profile_term"),
    target: celProfil,
    payload: z.strictObject({ term: z.string().min(1).max(200), meaning: z.string().min(1).max(500), wordsIds: z.array(id).max(20).default([]) }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("day_conclusion"),
    target: celDzien,
    payload: z.strictObject({ title: z.string().min(1).max(200), bodyMd: z.string().min(1).max(20_000) }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("weekly_conclusion"),
    target: celTydzien,
    payload: z.strictObject({ title: z.string().min(1).max(200), bodyMd: z.string().min(1).max(20_000) }),
    ...bazaSugestii,
  }),
  z.strictObject({
    kind: z.literal("strategy_detail"),
    target: celNotatka,
    payload: z.strictObject({
      bodyMd: z.string().min(1).max(20_000),
      tradeId: id,
      /** Cytat: slowa uzytkownika (dla origin ai wymagany cytat albo dowod). */
      quoteWordsId: id.nullish(),
    }),
    ...bazaSugestii,
  }),
]);

export const SugestieListaQuery = z.strictObject({
  status: z.enum(["pending", "accepted", "rejected", "applied", "reverted"]).optional(),
  kind: z.enum(["tag", "trade_link", "setup_example", "process_grade", "profile_term", "day_conclusion", "weekly_conclusion", "strategy_detail", "trade_setup", "broker_match", "broker_trade"]).optional(),
  tradeId: idZQuery.optional(),
  ...strona,
});

/* --- Hipotezy: warianty (MUST 5) ------------------------------------------------------------- */

export const WariantUtworzSchema = z.strictObject({
  label: z.string().min(1).max(200),
  /** Parametry wariantu: SL, TP, okno godzinowe... Tworza skrot, wiec ten sam zestaw to ten sam wariant. */
  params: z.record(z.string(), z.unknown()).refine((p) => Object.keys(p).length > 0, { message: "podaj co najmniej jeden parametr wariantu" }),
  /** Na ilu trade'ach wariant sprawdzono. */
  nTested: z.number().int().min(0).max(1_000_000),
  result: z.record(z.string(), z.unknown()).nullish(),
});

/* --- Adnotacje wykresu (MUST 13) --------------------------------------------------------------- */

export const AdnotacjaSchema = z
  .strictObject({
    externalId: z.string().min(1).max(200),
    shape: z.enum(["hline", "rect", "trend", "text", "other"]),
    interval: z.string().max(10).nullish(),
    price: cena.nullish(),
    price2: cena.nullish(),
    timeFrom: czas.nullish(),
    timeTo: czas.nullish(),
    /** Tekst rysunku BAJT W BAJT (bez trim, NFC i zamiany CRLF). */
    text: z.string().min(1).max(50_000).optional(),
    /** SHA-256 hex z bajtow UTF-8 tekstu u klienta; niezgodnosc = 400. Wymagany, gdy jest tekst. */
    sha256: hex64.optional(),
    raw: z.unknown(),
    capturedAt: czas,
  })
  .superRefine((a, ctx) => {
    if (a.text !== undefined && a.sha256 === undefined) {
      ctx.addIssue({ code: "custom", path: ["sha256"], message: "razem z text podaj sha256 (SHA-256 hex z bajtów UTF-8 tekstu)" });
    }
    if (a.text === undefined && a.sha256 !== undefined) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "sha256 bez text: podaj tekst rysunku albo usuń sha256" });
    }
  });

export const AdnotacjeZapisSchema = z
  .strictObject({
    platform: z.enum(["tradingview", "fxreplay"]),
    tradeId: id.optional(),
    sessionId: id.optional(),
    day: DataSchema.optional(),
    annotations: z.array(AdnotacjaSchema).min(1).max(200),
  })
  .superRefine((b, ctx) => {
    if (b.tradeId === undefined && b.day === undefined) {
      ctx.addIssue({ code: "custom", path: ["tradeId"], message: "podaj tradeId albo day: rysunek musi wisieć przy trade'ie lub dniu" });
    }
    const widziane = new Set<string>();
    b.annotations.forEach((a, i) => {
      if (widziane.has(a.externalId)) {
        ctx.addIssue({ code: "custom", path: ["annotations", i, "externalId"], message: `externalId »${a.externalId}« występuje w paczce drugi raz` });
      }
      widziane.add(a.externalId);
    });
  });

export const AdnotacjeListaQuery = z.strictObject({
  tradeId: idZQuery.optional(),
  sessionId: idZQuery.optional(),
  day: DataSchema.optional(),
  ...strona,
});

/* --- Profil tradera (MUST 14) ---------------------------------------------------------------------- */

export const KorektaInterpretacjiSchema = z.strictObject({
  /** Slowa uzytkownika, ktorych interpretacje poprawiamy. */
  wordsId: id,
  /** Jego korekta (»nie, chodziło mi o…«) dosłownie, zapisana wcześniej jako user-words. */
  correctionWordsId: id,
  /** Nowa interpretacja AI po poprawce. */
  afterInterpretation: z.string().min(1).max(20_000),
  model: z.string().min(1).max(120).optional(),
  /** Opcjonalnie: haslo slownika, ktore ta korekta tworzy lub poprawia. */
  term: z.string().min(1).max(200).optional(),
  termMeaning: z.string().min(1).max(500).optional(),
});

/* --- Luki w strategii i »Do rozstrzygniecia« (MUST 15, 16) ------------------------------------------- */

export const LukaUtworzSchema = z
  .strictObject({
    kind: z.enum(["gap", "mentor_conflict"]),
    question: z.string().min(1).max(2_000),
    origin: z.enum(["ai", "mentor"]).default("ai"),
    setupSlug: slug.optional(),
    tradeId: id.optional(),
    noteId: id.optional(),
    /** Wymagane przy mentor_conflict: cytat mentora, z ktorym zderza sie praktyka. */
    mentorClaimId: id.optional(),
  })
  .superRefine((l, ctx) => {
    if (l.kind === "mentor_conflict" && l.mentorClaimId === undefined) {
      ctx.addIssue({ code: "custom", path: ["mentorClaimId"], message: "sprzeczność mentor-praktyka wymaga mentorClaimId (cytat mentora z filmem i znacznikiem t=)" });
    }
    if (l.kind === "gap" && l.mentorClaimId !== undefined) {
      ctx.addIssue({ code: "custom", path: ["mentorClaimId"], message: "zwykła luka (gap) nie ma cytatu mentora; użyj kind = mentor_conflict" });
    }
  });

export const LukiListaQuery = z.strictObject({
  kind: z.enum(["gap", "mentor_conflict"]).optional(),
  status: z.enum(["open", "asked", "answered", "dismissed"]).optional(),
  ...strona,
});

/* --- Mentor (MUST 16) ----------------------------------------------------------------------------- */

export const MentorZrodloSchema = z.strictObject({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/, { message: "id filmu YouTube: litery, cyfry, _ i -" }),
  playlistId: z.string().min(1).max(100).nullish(),
  position: z.number().int().min(0).nullish(),
  title: z.string().min(1).max(500),
  url: z.string().url().startsWith("https://"),
  publishedAt: czas.nullish(),
  durationS: z.number().int().min(0).nullish(),
});

export const MentorZrodloStatusSchema = z.strictObject({
  status: z.enum(["pending", "processed", "no_captions", "error"]),
  transcriptSource: z.enum(["captions", "whisper"]).nullish(),
  /** Sciezka lokalna na R:, nigdy tresc transkrypcji. */
  transcriptPath: z.string().max(500).nullish(),
  error: z.string().max(2_000).nullish(),
});

export const MentorZrodlaListaQuery = z.strictObject({
  status: z.enum(["pending", "processed", "no_captions", "error"]).optional(),
  ...strona,
});

export const MentorTwierdzenieSchema = z.strictObject({
  /** Dosłowny cytat mentora, bajt w bajt. */
  quote: z.string().min(1).max(20_000),
  quoteSha256: hex64,
  tStartS: z.number().int().min(0),
  tEndS: z.number().int().min(0).nullish(),
  claimType: z.enum(["concept", "setup_condition", "management", "psychology", "other"]),
  /** Streszczenie AI, w UI zawsze podpisane; nigdy zamiast cytatu. */
  paraphrase: z.string().max(4_000).nullish(),
});

export const MentorTwierdzeniaZapisSchema = z
  .strictObject({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/),
    claims: z.array(MentorTwierdzenieSchema).min(1).max(200),
  })
  .superRefine((b, ctx) => {
    b.claims.forEach((c, i) => {
      if (c.tEndS != null && c.tEndS < c.tStartS) {
        ctx.addIssue({ code: "custom", path: ["claims", i, "tEndS"], message: `tEndS (${c.tEndS}) jest wcześniejszy niż tStartS (${c.tStartS})` });
      }
    });
  });

export const MentorTwierdzeniaListaQuery = z.strictObject({
  videoId: z.string().max(20).optional(),
  status: z.enum(["extracted", "merged", "review_ok", "review_bad"]).optional(),
  ...strona,
});

/** Scalanie twierdzenia do notatki / karty setupu (status »merged«); oceny zgodnosci z filmem robi uzytkownik w aplikacji. */
export const MentorTwierdzenieScalSchema = z.strictObject({
  mergedNoteId: id.nullish(),
  setupSlug: slug.nullish(),
});

/* --- Dopiski do notatek i zalaczniki ----------------------------------------------------------------- */

export const DopisekNotatkiSchema = z
  .strictObject({
    bodyMd: z.string().min(1).max(20_000),
    origin: z.enum(["ai", "mentor"]),
    tradeId: id.optional(),
    quoteWordsId: id.optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
    mentorClaimId: id.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.origin === "ai" && (d.tradeId === undefined || (d.quoteWordsId === undefined && d.evidence === undefined))) {
      ctx.addIssue({ code: "custom", path: ["tradeId"], message: "dopisek AI wymaga tradeId oraz quoteWordsId (cytat) albo evidence" });
    }
    if (d.origin === "mentor" && d.mentorClaimId === undefined) {
      ctx.addIssue({ code: "custom", path: ["mentorClaimId"], message: "dopisek mentora wymaga mentorClaimId (cytat z filmem i znacznikiem t=)" });
    }
  });

/** Korekta werdyktu przez uzytkownika: nowy wiersz, stary werdykt zostaje niezmieniony. */
export const KorektaWerdyktuSchema = z.strictObject({
  /** Slowa uzytkownika uzasadniajace korekte (obowiazkowe). */
  wordsId: id,
  brainVerdict: z.enum(["wejdz", "czekaj", "odpusc"]).nullish(),
  summaryMd: z.string().max(20_000).nullish(),
  lesson: z.string().max(4_000).nullish(),
  setupType: z.string().max(120).nullish(),
  ruleChecks: z
    .array(
      z.strictObject({
        ruleId: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/),
        ruleText: z.string().min(1).max(2_000),
        verdict: z.enum(["pass", "fail", "na", "unclear"]),
        evidence: z.string().max(4_000).nullish(),
      }),
    )
    .max(200)
    .default([]),
});
