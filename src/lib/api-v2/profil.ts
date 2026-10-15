import "server-only";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { aiSuggestions, interpretationCorrections, profileTermSources, profileTerms, userWords } from "@/lib/db/schema";

import type { KorektaInterpretacjiSchema } from "./contract/funkcje";
import { czySlowaUkryte, ukryteSlowa } from "./ukrycie-wyniku";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Profil tradera (ADR-033, MUST 14): slownik jego okreslen i rejestr poprawek interpretacji AI.
 * AI czyta go przed kazda interpretacja (`tj profile get`). Poprawka uzytkownika
 * (»nie, chodzilo mi o...«) zapisuje pare przed -> po i jest JEDYNA droga zmiany interpretacji
 * po jej ustawieniu (`PUT /user-words/:id/interpretation` dziala raz). Nowe haslo slownika
 * idzie do kolejki potwierdzen (sugestia `profile_term`), nie blokuje pracy i wchodzi do
 * slownika dopiero po zatwierdzeniu przez uzytkownika.
 */

type Db = Transakcja | typeof import("@/lib/db").db;

export async function odczytajProfil(tx: Db) {
  const terminy = await tx.select().from(profileTerms).where(inArray(profileTerms.status, ["confirmed", "proposed"])).orderBy(asc(profileTerms.id));
  const idsTerminow = terminy.map((t) => t.id);
  const zrodlaWszystkie = idsTerminow.length
    ? await tx
        .select({ termId: profileTermSources.termId, wordsId: userWords.id, text: userWords.text, tradeId: userWords.tradeId, noteId: userWords.noteId })
        .from(profileTermSources)
        .innerJoin(userWords, eq(profileTermSources.wordsId, userWords.id))
        .where(inArray(profileTermSources.termId, idsTerminow))
    : [];
  // Slepa ocena: slowa ukryte (po wejsciu trade'a z ukrytym wynikiem, przypiete do ukrytej notatki) nie wychodza ze slownika.
  const ukryteZrodla = await ukryteSlowa(tx, zrodlaWszystkie.map((z) => z.wordsId));
  const zrodla = zrodlaWszystkie.filter((z) => !ukryteZrodla.has(z.wordsId));

  const korekty = await tx
    .select({
      c: interpretationCorrections,
      przed: userWords.text,
    })
    .from(interpretationCorrections)
    .innerJoin(userWords, eq(interpretationCorrections.wordsId, userWords.id))
    .orderBy(desc(interpretationCorrections.id))
    .limit(20);
  const ukryteKorekty = await ukryteSlowa(tx, korekty.flatMap((k) => [k.c.wordsId, k.c.correctionWordsId]));
  const widoczneKorekty = korekty.filter((k) => !ukryteKorekty.has(k.c.wordsId) && !ukryteKorekty.has(k.c.correctionWordsId));
  const idsKorekt = widoczneKorekty.map((k) => k.c.correctionWordsId);
  const slowaKorekt = idsKorekt.length
    ? new Map((await tx.select({ id: userWords.id, text: userWords.text }).from(userWords).where(inArray(userWords.id, idsKorekt))).map((s) => [s.id, s.text]))
    : new Map<number, string>();

  // Miara »odsetek poprawionych interpretacji w czasie« (powinien spadac): poprawki w miesiacu / interpretacje w miesiacu.
  const interpretacje = await tx.execute<{ miesiac: string; n: number }>(sql`
    select to_char(date_trunc('month', interpretation_at), 'YYYY-MM') as miesiac, count(*)::int as n
      from user_words where interpretation_at is not null group by 1 order by 1`);
  const poprawki = await tx.execute<{ miesiac: string; n: number }>(sql`
    select to_char(date_trunc('month', created_at), 'YYYY-MM') as miesiac, count(*)::int as n
      from interpretation_corrections group by 1 order by 1`);
  const miesiace = [...new Set([...interpretacje.map((i) => i.miesiac), ...poprawki.map((p) => p.miesiac)])].sort();
  const rate = miesiace.map((m) => {
    const interpreted = Number(interpretacje.find((i) => i.miesiac === m)?.n ?? 0);
    const corrected = Number(poprawki.find((p) => p.miesiac === m)?.n ?? 0);
    return { month: m, interpreted, corrected, rate: interpreted > 0 ? corrected / interpreted : null };
  });

  // Ile werdyktow AI uzytkownik pozniej zmienil: korekty (user_override) + »nie zgadzam sie« przy regulach.
  const [werdykty] = await tx.execute<{ ai: number; korekty: number; niezgody: number }>(sql`
    select (select count(*) from trade_reviews where kind = 'ai' and as_of is not null)::int as ai,
           (select count(*) from trade_reviews where kind = 'user_override')::int as korekty,
           (select count(*) from trade_rule_checks c join trade_reviews r on r.id = c.review_id
             where c.user_verdict = 'disagree' and r.as_of is not null)::int as niezgody`);

  return {
    terms: terminy.map((t) => ({
      id: t.id,
      term: t.term,
      meaning: t.meaning,
      status: t.status,
      origin: t.origin,
      conceptNoteId: t.conceptNoteId,
      createdAt: t.createdAt.toISOString(),
      decidedAt: t.decidedAt?.toISOString() ?? null,
      sources: zrodla.filter((z) => z.termId === t.id).map((z) => ({ wordsId: z.wordsId, text: z.text, tradeId: z.tradeId, noteId: z.noteId })),
    })),
    corrections: widoczneKorekty.map(({ c, przed }) => ({
      id: c.id,
      wordsId: c.wordsId,
      words: przed,
      beforeInterpretation: c.beforeInterpretation,
      afterInterpretation: c.afterInterpretation,
      correctionWordsId: c.correctionWordsId,
      correction: slowaKorekt.get(c.correctionWordsId) ?? null,
      termId: c.termId,
      createdAt: c.createdAt.toISOString(),
    })),
    correctionRate: rate,
    verdicts: {
      aiVerdicts: Number(werdykty?.ai ?? 0),
      overrides: Number(werdykty?.korekty ?? 0),
      ruleDisagreements: Number(werdykty?.niezgody ?? 0),
      changedByUser: Number(werdykty?.korekty ?? 0) + Number(werdykty?.niezgody ?? 0),
    },
  };
}

export type WynikKorektyInterpretacji =
  | { ok: true; correctionId: number; wordsId: number; interpretation: string; termSuggestionId: number | null }
  | { ok: false; status: 404 | 422; kod: string; komunikat: string };

export async function zapiszKorekteInterpretacji(
  tx: Transakcja,
  api: KontekstApi,
  d: z.output<typeof KorektaInterpretacjiSchema>,
): Promise<WynikKorektyInterpretacji> {
  const [slowa] = await tx.select().from(userWords).where(eq(userWords.id, d.wordsId)).for("update").limit(1);
  // Slepa ocena: ukryte slowa wygladaja jak nieistniejace (404 przed odczytem interpretacji).
  if (!slowa || (await czySlowaUkryte(tx, d.wordsId))) return { ok: false, status: 404, kod: "not_found", komunikat: `Słowa użytkownika #${d.wordsId} nie istnieją.` };
  if (slowa.aiInterpretation === null) {
    return { ok: false, status: 422, kod: "no_interpretation", komunikat: `Słowa #${d.wordsId} nie mają interpretacji AI, więc nie ma czego poprawiać. Ustaw ją: PUT /api/v2/user-words/${d.wordsId}/interpretation.` };
  }
  if (d.wordsId === d.correctionWordsId) {
    return { ok: false, status: 422, kod: "same_words", komunikat: "pole correctionWordsId: korekta musi być osobnym wpisem (twoje »nie, chodziło mi o…«), nie tymi samymi słowami, które poprawiasz." };
  }
  const [korekta] = await tx.select({ id: userWords.id }).from(userWords).where(eq(userWords.id, d.correctionWordsId)).limit(1);
  if (!korekta || (await czySlowaUkryte(tx, d.correctionWordsId))) return { ok: false, status: 422, kod: "unknown_reference", komunikat: `pole correctionWordsId: słowa użytkownika #${d.correctionWordsId} nie istnieją (zapisz je najpierw przez POST /api/v2/user-words).` };
  if (slowa.aiInterpretation === d.afterInterpretation) {
    return { ok: false, status: 422, kod: "no_change", komunikat: "pole afterInterpretation: jest identyczne z obecną interpretacją, więc to nie jest poprawka." };
  }

  // Sprawdzenie hasla PRZED pierwszym zapisem: odmowa po wstawieniu korekty zostawilaby ja w bazie (transakcja
  // z `ok: false` jest zatwierdzana), a klient dostalby blad i ponowil.
  if (d.term !== undefined && d.termMeaning === undefined) {
    return { ok: false, status: 422, kod: "term_meaning_required", komunikat: "pole termMeaning: razem z term podaj znaczenie hasła (np. »FVG@5m po sweepie«)." };
  }
  if (d.termMeaning !== undefined && d.term === undefined) {
    return { ok: false, status: 422, kod: "term_required", komunikat: "pole term: razem z termMeaning podaj samo hasło (np. »FVG@5m«)." };
  }

  const [wpis] = await tx
    .insert(interpretationCorrections)
    .values({
      wordsId: d.wordsId,
      beforeInterpretation: slowa.aiInterpretation,
      correctionWordsId: d.correctionWordsId,
      afterInterpretation: d.afterInterpretation,
    })
    .returning({ id: interpretationCorrections.id });
  // Jedyna zmienna kolumna user_words: interpretacja AI. Tekst, skrot i kotwice zostaja nietkniete.
  await tx
    .update(userWords)
    .set({ aiInterpretation: d.afterInterpretation, interpretationModel: d.model ?? slowa.interpretationModel, interpretationAt: new Date() })
    .where(eq(userWords.id, d.wordsId));

  let termSuggestionId: number | null = null;
  if (d.term !== undefined) {
    const payload = { term: d.term, meaning: d.termMeaning!, wordsIds: [d.wordsId, d.correctionWordsId] };
    const [istnieje] = await tx
      .select({ id: aiSuggestions.id })
      .from(aiSuggestions)
      .where(sql`${aiSuggestions.kind} = 'profile_term' and ${aiSuggestions.status} in ('pending', 'accepted') and ${aiSuggestions.payload} = ${JSON.stringify(payload)}::jsonb`)
      .limit(1);
    if (istnieje) {
      termSuggestionId = istnieje.id;
    } else {
      const [s] = await tx
        .insert(aiSuggestions)
        .values({
          kind: "profile_term",
          status: "pending",
          target: { type: "profile" },
          payload,
          claim: `Hasło »${d.term}« oznacza: ${d.termMeaning}`,
          evidence: [{ type: "user_words", ref: d.correctionWordsId, note: "korekta interpretacji napisana przez użytkownika" }],
          evidenceLevel: "tested",
          n: 1,
          createdByTokenId: api.token.id,
        })
        .returning({ id: aiSuggestions.id });
      termSuggestionId = s.id;
    }
  }
  return { ok: true, correctionId: wpis.id, wordsId: d.wordsId, interpretation: d.afterInterpretation, termSuggestionId };
}
