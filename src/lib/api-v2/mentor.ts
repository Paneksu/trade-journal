import "server-only";
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { mentorClaims, mentorSources, noteAdditions, notes, setups, trades, userWords } from "@/lib/db/schema";

import type {
  DopisekNotatkiSchema,
  MentorTwierdzeniaListaQuery,
  MentorTwierdzeniaZapisSchema,
  MentorTwierdzenieScalSchema,
  MentorZrodlaListaQuery,
  MentorZrodloSchema,
  MentorZrodloStatusSchema,
} from "./contract/funkcje";
import { linkZeZnacznikiem } from "./luki";
import { KINDY_ZARZADZANE } from "./notatki";
import { skrotTekstu } from "./skrot";
import type { Transakcja } from "./with-api";

/**
 * Wiedza mentora (ADR-033, MUST 16): filmy playlisty ze statusem i twierdzenia z DOSLOWNYM
 * cytatem i znacznikiem `t=`. Wszystkie trasy wymagaja zakresu `import`. `tj mentor sync`
 * jest idempotentny po id filmu (ponowne wyslanie nie zmienia niczego), twierdzenia po
 * (film, skrot cytatu, t). Streszczenie AI (`paraphrase`) nigdy nie zastepuje cytatu.
 * Transkrypcje leza lokalnie na R: - w bazie jest tylko sciezka, nigdy tresc.
 */

type Db = Transakcja | typeof import("@/lib/db").db;
export type Zrodlo = typeof mentorSources.$inferSelect;
export type Twierdzenie = typeof mentorClaims.$inferSelect;

export function zZrodla(z: Zrodlo) {
  return {
    id: z.id,
    platform: z.platform,
    videoId: z.videoId,
    playlistId: z.playlistId,
    position: z.position,
    title: z.title,
    url: z.url,
    publishedAt: z.publishedAt?.toISOString() ?? null,
    durationS: z.durationS,
    status: z.status,
    transcriptSource: z.transcriptSource,
    transcriptPath: z.transcriptPath,
    error: z.error,
    processedAt: z.processedAt?.toISOString() ?? null,
  };
}

export function zTwierdzenia(c: Twierdzenie, zrodlo: Pick<Zrodlo, "videoId" | "title" | "url">) {
  return {
    id: c.id,
    sourceId: c.sourceId,
    videoId: zrodlo.videoId,
    videoTitle: zrodlo.title,
    quote: c.quote,
    quoteSha256: c.quoteSha256,
    tStartS: c.tStartS,
    tEndS: c.tEndS,
    link: linkZeZnacznikiem(zrodlo.url, c.tStartS),
    claimType: c.claimType,
    paraphrase: c.paraphrase,
    paraphraseSignature: c.paraphrase ? "streszczenie AI" : null,
    status: c.status,
    mergedNoteId: c.mergedNoteId,
    setupId: c.setupId,
    createdAt: c.createdAt.toISOString(),
  };
}

export type BladMentor = { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string };
const odrzuc = (status: 404 | 409 | 422, kod: string, komunikat: string): BladMentor => ({ ok: false, status, kod, komunikat });

export async function zapiszZrodlo(tx: Transakcja, d: z.output<typeof MentorZrodloSchema>): Promise<{ ok: true; zrodlo: Zrodlo; utworzone: boolean }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.mentor.source:${d.videoId}`}, 0))`);
  const [istniejace] = await tx.select().from(mentorSources).where(and(eq(mentorSources.platform, "youtube"), eq(mentorSources.videoId, d.videoId))).limit(1);
  if (istniejace) return { ok: true, zrodlo: istniejace, utworzone: false };
  const [nowe] = await tx
    .insert(mentorSources)
    .values({
      platform: "youtube",
      videoId: d.videoId,
      playlistId: d.playlistId ?? null,
      position: d.position ?? null,
      title: d.title,
      url: d.url,
      publishedAt: d.publishedAt ?? null,
      durationS: d.durationS ?? null,
      status: "pending",
    })
    .returning();
  return { ok: true, zrodlo: nowe, utworzone: true };
}

export async function ustawStatusZrodla(tx: Transakcja, videoId: string, d: z.output<typeof MentorZrodloStatusSchema>): Promise<{ ok: true; zrodlo: Zrodlo } | BladMentor> {
  const [z] = await tx.select().from(mentorSources).where(and(eq(mentorSources.platform, "youtube"), eq(mentorSources.videoId, videoId))).for("update").limit(1);
  if (!z) return odrzuc(404, "not_found", `Film »${videoId}« nie jest zarejestrowany (POST /api/v2/mentor/sources).`);
  if (d.status === "error" && !d.error) return odrzuc(422, "error_required", "pole error: status »error« wymaga opisu błędu (co poszło nie tak, żeby dało się to naprawić).");
  if (d.status === "processed" && !d.transcriptSource) return odrzuc(422, "transcript_source_required", "pole transcriptSource: przetworzony film musi wskazywać źródło transkrypcji (captions albo whisper).");
  const [po] = await tx
    .update(mentorSources)
    .set({
      status: d.status,
      transcriptSource: d.transcriptSource ?? null,
      transcriptPath: d.transcriptPath ?? null,
      error: d.status === "error" ? (d.error ?? null) : null,
      processedAt: d.status === "pending" ? null : new Date(),
    })
    .where(eq(mentorSources.id, z.id))
    .returning();
  return { ok: true, zrodlo: po };
}

export async function listaZrodel(tx: Db, f: z.output<typeof MentorZrodlaListaQuery>) {
  const warunki: SQL[] = [gt(mentorSources.id, f.after)];
  if (f.status) warunki.push(eq(mentorSources.status, f.status));
  const wiersze = await tx.select().from(mentorSources).where(and(...warunki)).orderBy(asc(mentorSources.id)).limit(f.limit + 1);
  const maWiecej = wiersze.length > f.limit;
  const strona = wiersze.slice(0, f.limit);
  const licznik = await tx.select({ status: mentorSources.status, ile: sql<number>`count(*)::int` }).from(mentorSources).groupBy(mentorSources.status);
  return {
    sources: strona.map(zZrodla),
    nextAfter: maWiecej ? strona[strona.length - 1].id : null,
    counts: Object.fromEntries(licznik.map((l) => [l.status, l.ile])) as Record<string, number>,
  };
}

export type WynikTwierdzenia = {
  index: number;
  status: "created" | "unchanged" | "refused";
  claimId: number | null;
  error?: string;
};

export async function zapiszTwierdzenia(
  tx: Transakcja,
  d: z.output<typeof MentorTwierdzeniaZapisSchema>,
): Promise<{ ok: true; results: WynikTwierdzenia[]; summary: Record<WynikTwierdzenia["status"], number> } | BladMentor> {
  const [zrodlo] = await tx.select({ id: mentorSources.id }).from(mentorSources).where(and(eq(mentorSources.platform, "youtube"), eq(mentorSources.videoId, d.videoId))).limit(1);
  if (!zrodlo) return odrzuc(404, "not_found", `Film »${d.videoId}« nie jest zarejestrowany (POST /api/v2/mentor/sources).`);

  const wyniki: WynikTwierdzenia[] = [];
  for (const [index, c] of d.claims.entries()) {
    const policzony = skrotTekstu(c.quote);
    if (policzony !== c.quoteSha256) {
      wyniki.push({ index, status: "refused", claimId: null, error: `pole quoteSha256: »${c.quoteSha256}« nie zgadza się ze skrótem SHA-256 policzonym przez serwer z bajtów UTF-8 cytatu (»${policzony}«). Cytat zmienił się w drodze (kodowanie, normalizacja, końce linii).` });
      continue;
    }
    const [istnieje] = await tx
      .select({ id: mentorClaims.id })
      .from(mentorClaims)
      .where(and(eq(mentorClaims.sourceId, zrodlo.id), eq(mentorClaims.quoteSha256, policzony), eq(mentorClaims.tStartS, c.tStartS)))
      .limit(1);
    if (istnieje) {
      wyniki.push({ index, status: "unchanged", claimId: istnieje.id });
      continue;
    }
    const [nowe] = await tx
      .insert(mentorClaims)
      .values({
        sourceId: zrodlo.id,
        quote: c.quote,
        quoteSha256: policzony,
        tStartS: c.tStartS,
        tEndS: c.tEndS ?? null,
        claimType: c.claimType,
        paraphrase: c.paraphrase ?? null,
      })
      .returning({ id: mentorClaims.id, sha: mentorClaims.quoteSha256 });
    if (nowe.sha !== policzony) {
      throw new Error(`Skrót cytatu mentora w bazie (${nowe.sha}) różni się od policzonego w aplikacji (${policzony}); cytat zmienił się w drodze do bazy. Transakcja wycofana.`);
    }
    wyniki.push({ index, status: "created", claimId: nowe.id });
  }
  const summary = { created: 0, unchanged: 0, refused: 0 } satisfies Record<WynikTwierdzenia["status"], number>;
  for (const w of wyniki) summary[w.status] += 1;
  return { ok: true, results: wyniki, summary };
}

export async function listaTwierdzen(tx: Db, f: z.output<typeof MentorTwierdzeniaListaQuery>) {
  const warunki: SQL[] = [gt(mentorClaims.id, f.after)];
  if (f.videoId) warunki.push(eq(mentorSources.videoId, f.videoId));
  if (f.status) warunki.push(eq(mentorClaims.status, f.status));
  const wiersze = await tx
    .select({ c: mentorClaims, s: mentorSources })
    .from(mentorClaims)
    .innerJoin(mentorSources, eq(mentorClaims.sourceId, mentorSources.id))
    .where(and(...warunki))
    .orderBy(asc(mentorClaims.id))
    .limit(f.limit + 1);
  const maWiecej = wiersze.length > f.limit;
  const strona = wiersze.slice(0, f.limit);
  return { claims: strona.map(({ c, s }) => zTwierdzenia(c, s)), nextAfter: maWiecej ? strona[strona.length - 1].c.id : null };
}

/** Scalenie twierdzenia z notatka / karta setupu. Ocene zgodnosci z filmem (review_ok / review_bad) robi uzytkownik w aplikacji. */
export async function scalTwierdzenie(tx: Transakcja, id: number, d: z.output<typeof MentorTwierdzenieScalSchema>): Promise<{ ok: true; twierdzenie: ReturnType<typeof zTwierdzenia> } | BladMentor> {
  const [c] = await tx.select().from(mentorClaims).where(eq(mentorClaims.id, id)).for("update").limit(1);
  if (!c) return odrzuc(404, "not_found", `Twierdzenie mentora #${id} nie istnieje.`);
  if (c.status === "review_ok" || c.status === "review_bad") {
    return odrzuc(409, "already_reviewed", `Twierdzenie #${id} ma ocenę zgodności z filmem (${c.status}) wystawioną przez użytkownika; nie zmienia się przez API.`);
  }
  let mergedNoteId = c.mergedNoteId;
  let setupId = c.setupId;
  if (d.mergedNoteId !== undefined) {
    if (d.mergedNoteId !== null) {
      const [n] = await tx.select({ id: notes.id }).from(notes).where(eq(notes.id, d.mergedNoteId)).limit(1);
      if (!n) return odrzuc(422, "unknown_reference", `pole mergedNoteId: »${d.mergedNoteId}« - nie ma takiej notatki.`);
    }
    mergedNoteId = d.mergedNoteId;
  }
  if (d.setupSlug !== undefined) {
    if (d.setupSlug === null) setupId = null;
    else {
      const [s] = await tx.select({ id: setups.id }).from(setups).where(eq(setups.slug, d.setupSlug)).limit(1);
      if (!s) return odrzuc(422, "unknown_reference", `pole setupSlug: »${d.setupSlug}« - nie ma takiego setupu.`);
      setupId = s.id;
    }
  }
  const [po] = await tx
    .update(mentorClaims)
    .set({ mergedNoteId, setupId, status: mergedNoteId !== null || setupId !== null ? "merged" : "extracted" })
    .where(eq(mentorClaims.id, id))
    .returning();
  const [s] = await tx.select({ videoId: mentorSources.videoId, title: mentorSources.title, url: mentorSources.url }).from(mentorSources).where(eq(mentorSources.id, po.sourceId)).limit(1);
  return { ok: true, twierdzenie: zTwierdzenia(po, s) };
}

/* --- Dopiski do notatek (AI i mentor) ------------------------------------------------------------------ */

export async function dodajDopisek(
  tx: Transakcja,
  noteId: number,
  d: z.output<typeof DopisekNotatkiSchema>,
): Promise<{ ok: true; dopisek: typeof noteAdditions.$inferSelect } | BladMentor> {
  const [nota] = await tx.select({ id: notes.id, kind: notes.kind }).from(notes).where(eq(notes.id, noteId)).limit(1);
  if (!nota) return odrzuc(404, "not_found", `Notatka #${noteId} nie istnieje.`);
  if ((KINDY_ZARZADZANE as readonly string[]).includes(nota.kind) && nota.kind !== "setup") {
    return odrzuc(422, "managed_note", `Notatka #${noteId} to »${nota.kind}«: jej treść zmienia się przez wersje i propozycje (POST /api/v2/rules/proposals albo /hypotheses), nie przez dopiski.`);
  }
  if (d.tradeId !== undefined) {
    const [t] = await tx.select({ id: trades.id }).from(trades).where(eq(trades.id, d.tradeId)).limit(1);
    if (!t) return odrzuc(422, "unknown_reference", `pole tradeId: »${d.tradeId}« - nie ma takiego trade'a.`);
  }
  if (d.quoteWordsId !== undefined) {
    const [w] = await tx.select({ id: userWords.id }).from(userWords).where(eq(userWords.id, d.quoteWordsId)).limit(1);
    if (!w) return odrzuc(422, "unknown_reference", `pole quoteWordsId: słowa użytkownika #${d.quoteWordsId} nie istnieją.`);
  }
  if (d.mentorClaimId !== undefined) {
    const [c] = await tx.select({ id: mentorClaims.id }).from(mentorClaims).where(inArray(mentorClaims.id, [d.mentorClaimId])).limit(1);
    if (!c) return odrzuc(422, "unknown_reference", `pole mentorClaimId: »${d.mentorClaimId}« - nie ma takiego twierdzenia mentora.`);
  }
  const [dopisek] = await tx
    .insert(noteAdditions)
    .values({
      noteId,
      bodyMd: d.bodyMd,
      origin: d.origin,
      quoteWordsId: d.quoteWordsId ?? null,
      tradeId: d.tradeId ?? null,
      evidence: d.evidence ?? null,
      mentorClaimId: d.mentorClaimId ?? null,
    })
    .returning();
  return { ok: true, dopisek };
}

export function zDopiska(d: typeof noteAdditions.$inferSelect) {
  return {
    id: d.id,
    noteId: d.noteId,
    bodyMd: d.bodyMd,
    origin: d.origin,
    signature: d.origin === "mentor" ? "wg mentora" : "obserwacja AI",
    quoteWordsId: d.quoteWordsId,
    tradeId: d.tradeId,
    mentorClaimId: d.mentorClaimId,
    suggestionId: d.suggestionId,
    createdAt: d.createdAt.toISOString(),
    revertedAt: d.revertedAt?.toISOString() ?? null,
  };
}

export async function listaDopiskow(tx: Db, noteId: number) {
  const wiersze = await tx.select().from(noteAdditions).where(eq(noteAdditions.noteId, noteId)).orderBy(asc(noteAdditions.id));
  return { additions: wiersze.map(zDopiska) };
}
