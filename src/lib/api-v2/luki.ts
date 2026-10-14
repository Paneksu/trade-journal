import "server-only";
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { mentorClaims, mentorSources, notes, setups, strategyGaps, trades, userWords } from "@/lib/db/schema";

import type { LukaUtworzSchema, LukiListaQuery } from "./contract/funkcje";
import { skrotTekstu } from "./skrot";
import { zSlow } from "./slowa";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Luki w strategii i »Do rozstrzygniecia« (ADR-033, MUST 15 i 16). `gap` to pytanie o to, czego
 * w strategii uzytkownika jeszcze nie ma zapisanego; `mentor_conflict` to sprzecznosc miedzy
 * mentorem a jego praktyka albo trade'ami. AI NIE rozstrzyga: odpowiedz (»zostaje moj«,
 * »biore mentora«, »oba z warunkiem«) i odrzucenie ustawia wylacznie uzytkownik w aplikacji
 * (trigger, TJ403). API moze tylko zglosic pytanie i oznaczyc je jako zadane (`asked`),
 * gdy rytual po sesji zapyta o nie uzytkownika. Pytania wracaja po jednym.
 */

type Db = Transakcja | typeof import("@/lib/db").db;
export type Luka = typeof strategyGaps.$inferSelect;

/** Klucz deduplikacji: rodzaj + pytanie bez wielkosci liter, ogonkow i nadmiarowych spacji. */
export function kluczLuki(kind: string, pytanie: string): string {
  const norm = pytanie
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return skrotTekstu(`${kind}\n${norm}`);
}

export function linkZeZnacznikiem(url: string, tStartS: number): string {
  try {
    const u = new URL(url);
    u.searchParams.set("t", String(tStartS));
    return u.toString();
  } catch {
    return url;
  }
}

export type WynikLuki =
  | { ok: true; luka: Luka; utworzona: boolean }
  | { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

const odrzuc = (status: 404 | 409 | 422, kod: string, komunikat: string, dodatkowe?: Record<string, unknown>): Extract<WynikLuki, { ok: false }> => ({ ok: false, status, kod, komunikat, ...(dodatkowe ? { dodatkowe } : {}) });

export async function utworzLuke(tx: Transakcja, _api: KontekstApi, d: z.output<typeof LukaUtworzSchema>): Promise<WynikLuki> {
  const klucz = kluczLuki(d.kind, d.question);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.gap:${klucz}`}, 0))`);

  const [otwarta] = await tx.select().from(strategyGaps).where(and(eq(strategyGaps.dedupeKey, klucz), inArray(strategyGaps.status, ["open", "asked"]))).limit(1);
  if (otwarta) return { ok: true, luka: otwarta, utworzona: false };
  const [zamknieta] = await tx.select().from(strategyGaps).where(and(eq(strategyGaps.dedupeKey, klucz), inArray(strategyGaps.status, ["answered", "dismissed"]))).limit(1);
  if (zamknieta) {
    return odrzuc(409, "already_resolved", `To pytanie (#${zamknieta.id}) zostało już ${zamknieta.status === "answered" ? "rozstrzygnięte" : "odrzucone"} przez użytkownika${zamknieta.answeredAt ? ` ${zamknieta.answeredAt.toISOString()}` : ""}. Nie zadaję go drugi raz: zmień pytanie, jeśli dotyczy czegoś nowego.`, { gapId: zamknieta.id });
  }

  let setupId: number | null = null;
  if (d.setupSlug !== undefined) {
    const [s] = await tx.select({ id: setups.id }).from(setups).where(eq(setups.slug, d.setupSlug)).limit(1);
    if (!s) return odrzuc(422, "unknown_reference", `pole setupSlug: »${d.setupSlug}« - nie ma takiego setupu.`);
    setupId = s.id;
  }
  if (d.tradeId !== undefined) {
    const [t] = await tx.select({ id: trades.id }).from(trades).where(eq(trades.id, d.tradeId)).limit(1);
    if (!t) return odrzuc(422, "unknown_reference", `pole tradeId: »${d.tradeId}« - nie ma takiego trade'a.`);
  }
  if (d.noteId !== undefined) {
    const [n] = await tx.select({ id: notes.id }).from(notes).where(eq(notes.id, d.noteId)).limit(1);
    if (!n) return odrzuc(422, "unknown_reference", `pole noteId: »${d.noteId}« - nie ma takiej notatki.`);
  }
  if (d.mentorClaimId !== undefined) {
    const [c] = await tx.select({ id: mentorClaims.id }).from(mentorClaims).where(eq(mentorClaims.id, d.mentorClaimId)).limit(1);
    if (!c) return odrzuc(422, "unknown_reference", `pole mentorClaimId: »${d.mentorClaimId}« - nie ma takiego twierdzenia mentora.`);
  }

  const [nowa] = await tx
    .insert(strategyGaps)
    .values({
      kind: d.kind,
      question: d.question,
      dedupeKey: klucz,
      setupId,
      tradeId: d.tradeId ?? null,
      mentorClaimId: d.mentorClaimId ?? null,
      noteId: d.noteId ?? null,
      origin: d.origin,
    })
    .returning();
  return { ok: true, luka: nowa, utworzona: true };
}

/** Rytual po sesji zadaje pytanie uzytkownikowi: open -> asked. Odpowiedz i odrzucenie sa tylko w UI. */
export async function oznaczJakoZadana(tx: Transakcja, id: number): Promise<WynikLuki> {
  const [l] = await tx.select().from(strategyGaps).where(eq(strategyGaps.id, id)).for("update").limit(1);
  if (!l) return odrzuc(404, "not_found", `Pytanie #${id} nie istnieje.`);
  if (l.status === "asked") return { ok: true, luka: l, utworzona: false };
  if (l.status !== "open") {
    return odrzuc(409, "already_resolved", `Pytanie #${id} ma status »${l.status}«, więc nie można go zadać ponownie. Rozstrzygnął je użytkownik w aplikacji.`);
  }
  const [po] = await tx.update(strategyGaps).set({ status: "asked", askedAt: new Date() }).where(eq(strategyGaps.id, id)).returning();
  return { ok: true, luka: po, utworzona: false };
}

export async function listaLuk(tx: Db, f: z.output<typeof LukiListaQuery>) {
  const warunki: SQL[] = [gt(strategyGaps.id, f.after)];
  if (f.kind) warunki.push(eq(strategyGaps.kind, f.kind));
  if (f.status) warunki.push(eq(strategyGaps.status, f.status));
  const wiersze = await tx.select().from(strategyGaps).where(and(...warunki)).orderBy(asc(strategyGaps.id)).limit(f.limit + 1);
  const maWiecej = wiersze.length > f.limit;
  const strona = wiersze.slice(0, f.limit);

  const idsClaim = strona.map((l) => l.mentorClaimId).filter((x): x is number => x !== null);
  const claimy = idsClaim.length
    ? await tx
        .select({ c: mentorClaims, s: mentorSources })
        .from(mentorClaims)
        .innerJoin(mentorSources, eq(mentorClaims.sourceId, mentorSources.id))
        .where(inArray(mentorClaims.id, idsClaim))
    : [];
  const idsSlow = strona.map((l) => l.answerWordsId).filter((x): x is number => x !== null);
  const slowa = idsSlow.length ? new Map((await tx.select().from(userWords).where(inArray(userWords.id, idsSlow))).map((s) => [s.id, s])) : new Map<number, typeof userWords.$inferSelect>();
  const slugi = strona.map((l) => l.setupId).filter((x): x is number => x !== null);
  const setupy = slugi.length ? new Map((await tx.select({ id: setups.id, slug: setups.slug, name: setups.name }).from(setups).where(inArray(setups.id, slugi))).map((s) => [s.id, s])) : new Map<number, { id: number; slug: string; name: string }>();

  return {
    gaps: strona.map((l) => {
      const cl = claimy.find((x) => x.c.id === l.mentorClaimId);
      const odp = l.answerWordsId === null ? null : slowa.get(l.answerWordsId);
      return {
        id: l.id,
        kind: l.kind,
        question: l.question,
        status: l.status,
        origin: l.origin,
        setup: l.setupId === null ? null : (setupy.get(l.setupId) ?? null),
        tradeId: l.tradeId,
        noteId: l.noteId,
        mentorClaim: cl
          ? {
              id: cl.c.id,
              quote: cl.c.quote,
              tStartS: cl.c.tStartS,
              claimType: cl.c.claimType,
              videoId: cl.s.videoId,
              videoTitle: cl.s.title,
              /** Link do filmu z znacznikiem t= w miejscu cytatu. */
              link: linkZeZnacznikiem(cl.s.url, cl.c.tStartS),
            }
          : null,
        askedAt: l.askedAt?.toISOString() ?? null,
        answeredAt: l.answeredAt?.toISOString() ?? null,
        resolution: l.resolution,
        answer: odp ? zSlow(odp) : null,
        createdAt: l.createdAt.toISOString(),
      };
    }),
    nextAfter: maWiecej ? strona[strona.length - 1].id : null,
  };
}
