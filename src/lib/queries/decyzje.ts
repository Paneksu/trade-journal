import "server-only";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { linkMentora } from "@/lib/api-v2/luki";
import { db } from "@/lib/db";
import {
  aiSuggestions,
  mentorClaims,
  mentorSources,
  accounts,
  notes,
  propFirmPresets,
  propRules,
  ruleVersions,
  rules,
  setups,
  setupVersions,
  strategyGaps,
  userWords,
} from "@/lib/db/schema";

/**
 * Dane minimalnych ekranow decyzji uzytkownika (faza 2b; pelny interfejs przyjdzie w fazie 5):
 * »Do decyzji« (propozycje regul i setupow, sugestie AI) oraz »Do rozstrzygniecia« (mentor kontra
 * praktyka). Odczyt, zadnych zapisow - decyzje sa w `lib/decyzje`.
 */

export type PropozycjaReguly = {
  versionId: number;
  ruleCode: string;
  title: string;
  version: number;
  origin: "user" | "ai" | "mentor" | "vault-import";
  podpis: string;
  textMd: string;
  obowiazujacyTekst: string | null;
  counterargument: string | null;
  evidence: unknown;
  hypothesisId: number | null;
  vaultStatus: string | null;
  proposedAt: Date;
};

function podpis(origin: PropozycjaReguly["origin"], n: number | null): string {
  switch (origin) {
    case "ai":
      return `propozycja AI${n === null ? "" : `, n = ${n}`}`;
    case "mentor":
      return "wg mentora, n = 0";
    case "vault-import":
      return "import z sejfu (do ponownego zatwierdzenia)";
    default:
      return "użytkownik";
  }
}

export async function propozycjeRegul(): Promise<PropozycjaReguly[]> {
  const wiersze = await db
    .select({
      versionId: ruleVersions.id,
      ruleId: ruleVersions.ruleId,
      ruleCode: rules.code,
      title: notes.title,
      meta: notes.meta,
      version: ruleVersions.version,
      origin: ruleVersions.origin,
      textMd: ruleVersions.textMd,
      counterargument: ruleVersions.counterargument,
      evidence: ruleVersions.evidence,
      hypothesisId: ruleVersions.hypothesisId,
      proposedAt: ruleVersions.proposedAt,
      n: sql<number | null>`case when ${ruleVersions.hypothesisId} is null then null else public.tj_hypothesis_n(${ruleVersions.hypothesisId}) end`,
    })
    .from(ruleVersions)
    .innerJoin(rules, eq(ruleVersions.ruleId, rules.id))
    .innerJoin(notes, eq(rules.noteId, notes.id))
    .where(eq(ruleVersions.status, "proposed"))
    .orderBy(asc(ruleVersions.proposedAt), asc(ruleVersions.id));

  const ids = wiersze.map((w) => w.ruleId);
  const obowiazujace = ids.length
    ? await db.select({ ruleId: ruleVersions.ruleId, textMd: ruleVersions.textMd }).from(ruleVersions).where(and(inArray(ruleVersions.ruleId, ids), eq(ruleVersions.status, "approved")))
    : [];
  return wiersze.map((w) => ({
    versionId: w.versionId,
    ruleCode: w.ruleCode,
    title: w.title,
    version: w.version,
    origin: w.origin,
    podpis: podpis(w.origin, w.n === null ? null : Number(w.n)),
    textMd: w.textMd,
    obowiazujacyTekst: obowiazujace.find((o) => o.ruleId === w.ruleId)?.textMd ?? null,
    counterargument: w.counterargument,
    evidence: w.evidence,
    hypothesisId: w.hypothesisId,
    vaultStatus: typeof w.meta?.vault_status === "string" ? w.meta.vault_status : null,
    proposedAt: w.proposedAt,
  }));
}

export type PropozycjaSetupu = {
  versionId: number;
  slug: string;
  name: string;
  version: number;
  podpis: string;
  wersja: typeof setupVersions.$inferSelect;
};

export async function propozycjeSetupow(): Promise<PropozycjaSetupu[]> {
  const wiersze = await db
    .select({ w: setupVersions, slug: setups.slug, name: setups.name })
    .from(setupVersions)
    .innerJoin(setups, eq(setupVersions.setupId, setups.id))
    .where(eq(setupVersions.status, "proposed"))
    .orderBy(asc(setupVersions.proposedAt), asc(setupVersions.id));
  return wiersze.map(({ w, slug, name }) => ({
    versionId: w.id,
    slug,
    name,
    version: w.version,
    podpis: podpis(w.origin, null),
    wersja: w,
  }));
}

export type ReguldoPotwierdzenia = {
  id: number;
  accountId: number;
  accountName: string;
  validFrom: string;
  rule: typeof propRules.$inferSelect;
  preset: { firm: string; program: string; phase: string; readOn: string; needsVerification: boolean } | null;
};

/** Reguly kont prop czekajace na potwierdzenie zgodnosci z regulaminem (najstarsze pierwsze). */
export async function regulyKontDoPotwierdzenia(): Promise<ReguldoPotwierdzenia[]> {
  const wiersze = await db
    .select({ rule: propRules, accountName: accounts.name, firm: propFirmPresets.firm, program: propFirmPresets.program, phase: propFirmPresets.phase, readOn: propFirmPresets.readOn, needs: propFirmPresets.needsVerification })
    .from(propRules)
    .innerJoin(accounts, eq(propRules.accountId, accounts.id))
    .leftJoin(propFirmPresets, eq(propRules.presetId, propFirmPresets.id))
    .where(sql`${propRules.confirmedAt} is null`)
    .orderBy(asc(propRules.createdAt), asc(propRules.id));
  return wiersze.map((w) => ({
    id: w.rule.id,
    accountId: w.rule.accountId,
    accountName: w.accountName,
    validFrom: w.rule.validFrom,
    rule: w.rule,
    preset: w.firm === null ? null : { firm: w.firm, program: w.program!, phase: w.phase!, readOn: w.readOn!, needsVerification: w.needs ?? false },
  }));
}

export async function sugestieDoDecyzji() {
  const oczekujace = await db.select().from(aiSuggestions).where(eq(aiSuggestions.status, "pending")).orderBy(asc(aiSuggestions.createdAt), asc(aiSuggestions.id));
  const zatwierdzone = await db
    .select()
    .from(aiSuggestions)
    .where(or(eq(aiSuggestions.status, "accepted"), eq(aiSuggestions.status, "applied")))
    .orderBy(desc(aiSuggestions.decidedAt), desc(aiSuggestions.id))
    .limit(20);
  return { oczekujace, zatwierdzone };
}

export async function licznikiDoDecyzji(): Promise<{ decyzje: number; rozstrzygniecia: number }> {
  const [w] = await db.execute<{ decyzje: number; rozstrzygniecia: number }>(sql`
    select ((select count(*) from rule_versions where status = 'proposed')
          + (select count(*) from setup_versions where status = 'proposed')
          + (select count(*) from ai_suggestions where status = 'pending')
          + (select count(*) from prop_rules where confirmed_at is null))::int as decyzje,
           (select count(*) from strategy_gaps where kind = 'mentor_conflict' and status in ('open', 'asked'))::int as rozstrzygniecia`);
  return { decyzje: Number(w?.decyzje ?? 0), rozstrzygniecia: Number(w?.rozstrzygniecia ?? 0) };
}

export type SprzecznoscDoRozstrzygniecia = {
  id: number;
  question: string;
  status: "open" | "asked";
  origin: "ai" | "mentor";
  createdAt: Date;
  setup: { slug: string; name: string } | null;
  tradeId: number | null;
  noteId: number | null;
  mentor: { quote: string; tStartS: number; videoTitle: string; link: string };
  /** Twoje slowa z kotwicy sprzecznosci (trade albo notatka), obok cytatu mentora. */
  slowaUzytkownika: { id: number; text: string; role: string | null; capturedAt: Date }[];
};

export async function sprzecznosciDoRozstrzygniecia(): Promise<SprzecznoscDoRozstrzygniecia[]> {
  const wiersze = await db
    .select({ g: strategyGaps, c: mentorClaims, s: mentorSources, setupSlug: setups.slug, setupName: setups.name })
    .from(strategyGaps)
    .innerJoin(mentorClaims, eq(strategyGaps.mentorClaimId, mentorClaims.id))
    .innerJoin(mentorSources, eq(mentorClaims.sourceId, mentorSources.id))
    .leftJoin(setups, eq(strategyGaps.setupId, setups.id))
    .where(and(eq(strategyGaps.kind, "mentor_conflict"), inArray(strategyGaps.status, ["open", "asked"])))
    .orderBy(asc(strategyGaps.createdAt), asc(strategyGaps.id));

  const wynik: SprzecznoscDoRozstrzygniecia[] = [];
  for (const { g, c, s, setupSlug, setupName } of wiersze) {
    const warunki = [
      g.tradeId !== null ? eq(userWords.tradeId, g.tradeId) : undefined,
      g.noteId !== null ? eq(userWords.noteId, g.noteId) : undefined,
    ].filter((x): x is NonNullable<typeof x> => x !== undefined);
    const slowa = warunki.length
      ? await db
          .select({ id: userWords.id, text: userWords.text, role: userWords.role, capturedAt: userWords.capturedAt })
          .from(userWords)
          .where(or(...warunki))
          .orderBy(desc(userWords.capturedAt))
          .limit(3)
      : [];
    wynik.push({
      id: g.id,
      question: g.question,
      status: g.status as "open" | "asked",
      origin: g.origin,
      createdAt: g.createdAt,
      setup: setupSlug && setupName ? { slug: setupSlug, name: setupName } : null,
      tradeId: g.tradeId,
      noteId: g.noteId,
      mentor: { quote: c.quote, tStartS: c.tStartS, videoTitle: s.title, link: linkMentora(s.videoId, c.tStartS) },
      slowaUzytkownika: slowa,
    });
  }
  return wynik;
}
