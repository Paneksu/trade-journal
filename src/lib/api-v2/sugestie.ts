import "server-only";
import { and, asc, desc, eq, gt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import {
  aiSuggestions,
  noteAdditions,
  notes,
  setups,
  tags,
  tradeNoteLinks,
  tradeTags,
  trades,
  userWords,
} from "@/lib/db/schema";
import { czyInterwal } from "@/lib/domain/interwaly";

import type { SugestiaUtworzSchema, SugestieListaQuery } from "./contract/funkcje";
import { KINDY_ZARZADZANE } from "./notatki";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Kolejka potwierdzen AI (ADR-033, MUST 10 i 15). Agent TWORZY sugestie, ZATWIERDZA tylko
 * uzytkownik w UI jednym kliknieciem (trigger `tj_require_ui_actor`, TJ403). Niezatwierdzona
 * sugestia nie wchodzi nigdzie: ani do `trade_tags`, ani do `trade_note_links`, ani do
 * `setup_examples`, ani do oceny procesu trade'a - dlatego statystyki, grupowanie i Edge
 * Finder "licza tylko zatwierdzone" bez zadnej zmiany w zapytaniach.
 *
 * Wyjatek zgodny z planem: `strategy_detail` to obserwacja, nie regula - wchodzi od razu
 * jako dopisek do notatki (z cytatem i linkiem do trade'a), widoczny w kolejce i cofalny.
 */

type Db = Transakcja | typeof import("@/lib/db").db;
export type Sugestia = typeof aiSuggestions.$inferSelect;

export function zSugestii(s: Sugestia) {
  return {
    id: s.id,
    kind: s.kind,
    status: s.status,
    target: s.target,
    payload: s.payload,
    claim: s.claim,
    evidence: s.evidence,
    evidenceLevel: s.evidenceLevel,
    n: s.n,
    appliedRef: s.appliedRef,
    createdAt: s.createdAt.toISOString(),
    decidedAt: s.decidedAt?.toISOString() ?? null,
    /** Pochodzenie ma byc widoczne przy kazdej sugestii (R23). */
    signature: "propozycja AI",
  };
}

export type WynikSugestii =
  | { ok: true; sugestia: Sugestia; utworzona: boolean; dopisekId: number | null }
  | { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

const odrzuc = (status: 404 | 409 | 422, kod: string, komunikat: string, dodatkowe?: Record<string, unknown>): Extract<WynikSugestii, { ok: false }> => ({ ok: false, status, kod, komunikat, ...(dodatkowe ? { dodatkowe } : {}) });

type Wejscie = z.output<typeof SugestiaUtworzSchema>;

/** Sprawdza, ze to, co sugestia dotyczy, istnieje, i ze nie zgłasza czegoś, co już jest. Zwraca payload do zapisu. */
async function sprawdz(tx: Transakcja, d: Wejscie): Promise<{ ok: true; payload: Record<string, unknown> } | Extract<WynikSugestii, { ok: false }>> {
  if (d.target.type === "trade") {
    const [t] = await tx.select({ id: trades.id, processGrade: trades.processGrade }).from(trades).where(eq(trades.id, d.target.id)).limit(1);
    if (!t) return odrzuc(422, "unknown_reference", `pole target.id: »${d.target.id}« - nie ma takiego trade'a (mógł zostać skasowany w aplikacji).`);

    if (d.kind === "tag") {
      const [tag] = await tx.select({ id: tags.id, archived: tags.archived }).from(tags).where(eq(tags.id, d.payload.tagId)).limit(1);
      if (!tag) return odrzuc(422, "unknown_reference", `pole payload.tagId: »${d.payload.tagId}« - nie ma takiego tagu (lista: GET /api/v2/meta).`);
      if (tag.archived) return odrzuc(422, "tag_archived", `Tag #${tag.id} jest zarchiwizowany, więc nie przyjmuje nowych przypisań.`);
      const interwal = d.payload.interval ?? null;
      if (interwal !== null && !czyInterwal(interwal)) return odrzuc(422, "invalid_interval", `pole payload.interval: »${interwal}« nie jest interwałem z listy (GET /api/v2/meta -> intervals).`);
      const [juz] = await tx
        .select({ id: tradeTags.id })
        .from(tradeTags)
        .where(and(eq(tradeTags.tradeId, t.id), eq(tradeTags.tagId, tag.id), sql`${tradeTags.interval} is not distinct from ${interwal}`))
        .limit(1);
      if (juz) return odrzuc(409, "already_present", `Trade #${t.id} ma już ten tag${interwal ? ` na interwale ${interwal}` : ""}; nic do zatwierdzania.`);
      return { ok: true, payload: { tagId: tag.id, interval: interwal } };
    }

    if (d.kind === "trade_link") {
      const [nota] = await tx.select({ id: notes.id }).from(notes).where(eq(notes.id, d.payload.noteId)).limit(1);
      if (!nota) return odrzuc(422, "unknown_reference", `pole payload.noteId: »${d.payload.noteId}« - nie ma takiej notatki.`);
      const [juz] = await tx
        .select({ id: tradeNoteLinks.id })
        .from(tradeNoteLinks)
        .where(and(eq(tradeNoteLinks.tradeId, t.id), eq(tradeNoteLinks.noteId, nota.id), eq(tradeNoteLinks.role, d.payload.role)))
        .limit(1);
      if (juz) return odrzuc(409, "already_present", `Trade #${t.id} jest już powiązany z notatką #${nota.id} jako »${d.payload.role}«.`);
      return { ok: true, payload: { noteId: nota.id, role: d.payload.role } };
    }

    if (d.kind === "setup_example") {
      const [s] = await tx.select({ id: setups.id, slug: setups.slug }).from(setups).where(eq(setups.slug, d.payload.setupSlug)).limit(1);
      if (!s) return odrzuc(422, "unknown_reference", `pole payload.setupSlug: »${d.payload.setupSlug}« - nie ma takiego setupu (lista: GET /api/v2/setups).`);
      return { ok: true, payload: { setupSlug: s.slug, setupId: s.id, exampleKind: d.payload.exampleKind, screenshotId: d.payload.screenshotId ?? null, captionWordsId: d.payload.captionWordsId ?? null } };
    }

    if (d.kind === "process_grade") {
      if (t.processGrade === d.payload.grade) return odrzuc(409, "already_present", `Trade #${t.id} ma już ocenę procesu ${d.payload.grade}.`);
      return { ok: true, payload: { grade: d.payload.grade } };
    }
  }

  if (d.kind === "strategy_detail") {
    const [nota] = await tx.select({ id: notes.id, kind: notes.kind }).from(notes).where(eq(notes.id, d.target.id)).limit(1);
    if (!nota) return odrzuc(422, "unknown_reference", `pole target.id: »${d.target.id}« - nie ma takiej notatki.`);
    if ((KINDY_ZARZADZANE as readonly string[]).includes(nota.kind) && nota.kind !== "setup") {
      return odrzuc(422, "managed_note", `Notatka #${nota.id} to »${nota.kind}«: jej treść zmienia się przez wersje i propozycje (POST /api/v2/rules/proposals albo /hypotheses), nie przez dopiski.`);
    }
    const [tr] = await tx.select({ id: trades.id }).from(trades).where(eq(trades.id, d.payload.tradeId)).limit(1);
    if (!tr) return odrzuc(422, "unknown_reference", `pole payload.tradeId: »${d.payload.tradeId}« - nie ma takiego trade'a.`);
    if (d.payload.quoteWordsId != null) {
      const [w] = await tx.select({ id: userWords.id }).from(userWords).where(eq(userWords.id, d.payload.quoteWordsId)).limit(1);
      if (!w) return odrzuc(422, "unknown_reference", `pole payload.quoteWordsId: słowa użytkownika #${d.payload.quoteWordsId} nie istnieją.`);
    }
    return { ok: true, payload: { bodyMd: d.payload.bodyMd, tradeId: d.payload.tradeId, quoteWordsId: d.payload.quoteWordsId ?? null } };
  }

  // profile_term, day_conclusion, weekly_conclusion: payload jest tekstem, a cel wynika z typu.
  return { ok: true, payload: d.payload as Record<string, unknown> };
}

export async function utworzSugestie(tx: Transakcja, api: KontekstApi, d: Wejscie): Promise<WynikSugestii> {
  const spr = await sprawdz(tx, d);
  if (!spr.ok) return spr;

  // Ta sama sugestia (rodzaj + cel + tresc) nie mnozy sie: oczekujaca = ta sama, odrzucona = nie zgłaszamy drugi raz.
  const klucz = JSON.stringify([d.kind, d.target, spr.payload]);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.suggestion:${klucz}`}, 0))`);
  const poprzednie = await tx
    .select()
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.kind, d.kind), sql`${aiSuggestions.target} = ${JSON.stringify(d.target)}::jsonb`, sql`${aiSuggestions.payload} = ${JSON.stringify(spr.payload)}::jsonb`))
    .orderBy(desc(aiSuggestions.id));
  const oczekujaca = poprzednie.find((s) => s.status === "pending" || s.status === "accepted" || s.status === "applied");
  if (oczekujaca) return { ok: true, sugestia: oczekujaca, utworzona: false, dopisekId: null };
  const odrzucona = poprzednie.find((s) => s.status === "rejected");
  if (odrzucona) {
    return odrzuc(
      409,
      "previously_rejected",
      `Ta sama sugestia (#${odrzucona.id}) została już odrzucona przez użytkownika${odrzucona.decidedAt ? ` ${odrzucona.decidedAt.toISOString()}` : ""}. Nie zgłaszam jej drugi raz: zmień treść albo przedstaw nowy dowód.`,
      { suggestionId: odrzucona.id },
    );
  }

  const baza = {
    kind: d.kind,
    target: d.target as Record<string, unknown>,
    payload: spr.payload,
    claim: d.claim,
    evidence: d.evidence as unknown[],
    evidenceLevel: d.evidenceLevel,
    n: d.n ?? null,
    createdByTokenId: api.token.id,
  };

  if (d.kind !== "strategy_detail") {
    const [s] = await tx.insert(aiSuggestions).values({ ...baza, status: "pending" }).returning();
    return { ok: true, sugestia: s, utworzona: true, dopisekId: null };
  }

  // strategy_detail: obserwacja, nie regula. Wchodzi od razu jako dopisek i jest cofalna (dopisek wskazuje
  // sugestie przez suggestion_id, wiec cofniecie w UI nie potrzebuje appliedRef).
  const p = spr.payload as { bodyMd: string; tradeId: number; quoteWordsId: number | null };
  const [s] = await tx.insert(aiSuggestions).values({ ...baza, status: "applied", decidedAt: new Date() }).returning();
  const [dopisek] = await tx
    .insert(noteAdditions)
    .values({
      noteId: (d.target as { id: number }).id,
      bodyMd: p.bodyMd,
      origin: "ai",
      quoteWordsId: p.quoteWordsId,
      tradeId: p.tradeId,
      evidence: { claim: d.claim, evidenceLevel: d.evidenceLevel, n: d.n ?? null, items: d.evidence },
      suggestionId: s.id,
    })
    .returning({ id: noteAdditions.id });
  return { ok: true, sugestia: s, utworzona: true, dopisekId: dopisek.id };
}

export async function listaSugestii(tx: Db, f: z.output<typeof SugestieListaQuery>) {
  const warunki: SQL[] = [gt(aiSuggestions.id, f.after)];
  if (f.status) warunki.push(eq(aiSuggestions.status, f.status));
  if (f.kind) warunki.push(eq(aiSuggestions.kind, f.kind));
  if (f.tradeId) warunki.push(sql`${aiSuggestions.target} @> ${JSON.stringify({ type: "trade", id: f.tradeId })}::jsonb`);
  const wiersze = await tx.select().from(aiSuggestions).where(and(...warunki)).orderBy(asc(aiSuggestions.id)).limit(f.limit + 1);
  const maWiecej = wiersze.length > f.limit;
  const strona = wiersze.slice(0, f.limit);
  const licznik = await tx
    .select({ status: aiSuggestions.status, ile: sql<number>`count(*)::int` })
    .from(aiSuggestions)
    .groupBy(aiSuggestions.status);
  return {
    suggestions: strona.map(zSugestii),
    nextAfter: maWiecej ? strona[strona.length - 1].id : null,
    counts: Object.fromEntries(licznik.map((l) => [l.status, l.ile])) as Record<string, number>,
  };
}
