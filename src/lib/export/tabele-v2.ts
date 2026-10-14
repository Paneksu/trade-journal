import "server-only";

import { db } from "@/lib/db";
import {
  aiSuggestions,
  chartAnnotations,
  hypotheses,
  hypothesisVariants,
  interpretationCorrections,
  mentorClaims,
  mentorSources,
  noteAdditions,
  noteRevisions,
  notes,
  profileTermSources,
  profileTerms,
  propFirmPresets,
  propLedger,
  propRules,
  ruleVersions,
  rules,
  setupExamples,
  setupVersions,
  setups,
  strategyGaps,
  thresholdChanges,
  tradeNoteLinks,
  tradePlanAddenda,
  tradePlans,
  userWords,
  weeklyReviews,
} from "@/lib/db/schema";

/**
 * Tabele v2 (notatki, reguly, playbook, plany, prop, przeglady, kolejka AI, mentor...) do pelnego
 * eksportu (ADR-033: »pelny eksport do ponownego importu zostaje i obejmuje nowe tabele«).
 * Pomijamy kolumny `search` (tsvector liczony przez baze: przy imporcie powstaje sam) oraz tabele
 * tokenow i logowania - sekrety nie wchodza do pliku, ktory uzytkownik trzyma gdzie indziej.
 * Linki [[...]] (`note_links`) sa pochodne od tresci notatek i przeliczaja sie przy imporcie.
 */

type ZSearch = { search?: unknown };

/** Wiersze bez wygenerowanej kolumny `search`. */
export function bezSearch<T extends ZSearch>(wiersze: T[]): Omit<T, "search">[] {
  return wiersze.map((w) => {
    const { search: _search, ...reszta } = w;
    void _search;
    return reszta;
  });
}

export async function pobierzTabeleV2() {
  const [
    notatki,
    rewizje,
    slowa,
    hipotezy,
    reguly,
    wersjeRegul,
    setupy,
    wersjeSetupow,
    przykladySetupow,
    powiazania,
    sugestie,
    dopiski,
    plany,
    dopiskiPlanow,
    warianty,
    zmianyProgow,
    presety,
    regulyKont,
    ksiega,
    przeglady,
    adnotacje,
    haslaSlownika,
    zrodlaHasel,
    korektyInterpretacji,
    zrodlaMentora,
    twierdzeniaMentora,
    luki,
  ] = await Promise.all([
    db.select().from(notes),
    db.select().from(noteRevisions),
    db.select().from(userWords),
    db.select().from(hypotheses),
    db.select().from(rules),
    db.select().from(ruleVersions),
    db.select().from(setups),
    db.select().from(setupVersions),
    db.select().from(setupExamples),
    db.select().from(tradeNoteLinks),
    db.select().from(aiSuggestions),
    db.select().from(noteAdditions),
    db.select().from(tradePlans),
    db.select().from(tradePlanAddenda),
    db.select().from(hypothesisVariants),
    db.select().from(thresholdChanges),
    db.select().from(propFirmPresets),
    db.select().from(propRules),
    db.select().from(propLedger),
    db.select().from(weeklyReviews),
    db.select().from(chartAnnotations),
    db.select().from(profileTerms),
    db.select().from(profileTermSources),
    db.select().from(interpretationCorrections),
    db.select().from(mentorSources),
    db.select().from(mentorClaims),
    db.select().from(strategyGaps),
  ]);
  return {
    notes: bezSearch(notatki),
    noteRevisions: rewizje,
    userWords: bezSearch(slowa),
    hypotheses: hipotezy,
    rules: reguly,
    ruleVersions: wersjeRegul,
    setups: setupy,
    setupVersions: wersjeSetupow,
    setupExamples: przykladySetupow,
    tradeNoteLinks: powiazania,
    aiSuggestions: sugestie,
    noteAdditions: dopiski,
    tradePlans: plany,
    tradePlanAddenda: dopiskiPlanow,
    hypothesisVariants: warianty,
    thresholdChanges: zmianyProgow,
    propFirmPresets: presety,
    propRules: regulyKont,
    propLedger: ksiega,
    weeklyReviews: przeglady,
    chartAnnotations: adnotacje,
    profileTerms: haslaSlownika,
    profileTermSources: zrodlaHasel,
    interpretationCorrections: korektyInterpretacji,
    mentorSources: zrodlaMentora,
    mentorClaims: twierdzeniaMentora,
    strategyGaps: luki,
  };
}
