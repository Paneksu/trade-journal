import "server-only";
import { and, asc, eq, gt, sql, type SQL } from "drizzle-orm";

import { sqlSlowaPoWejsciuUkrytego } from "./ukrycie-wyniku";
import type { z } from "zod";

import { notes, userWords } from "@/lib/db/schema";
import { sprawdzTekstBajtWBajt } from "@/lib/domain/notatki";

import type { InterpretacjaSchema, SlowaListaQuery, SlowaUtworzSchema } from "./contract/v2";
import { sprawdzKotwice } from "./notatki";
import { skrotTekstu } from "./skrot";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Slowa uzytkownika dosłownie (ADR-030, plan pkt 13). Zasady:
 *  - tekst idzie bajt w bajt: bez trim, bez NFC, bez zamiany CRLF;
 *  - klient podaje SHA-256 z bajtow UTF-8, serwer liczy swoj i przy niezgodnosci
 *    odrzuca zapis (400): tak testujemy, ze tekst nie zmienil sie w drodze;
 *  - skrot zapisany w bazie liczy trigger, nie klient;
 *  - jedyna zmienna czescia wiersza jest interpretacja AI (osobna kolumna).
 */

export type Slowa = typeof userWords.$inferSelect;

export function zSlow(s: Slowa) {
  return {
    id: s.id,
    text: s.text,
    sha256: s.sha256,
    byteLen: s.byteLen,
    source: s.source,
    role: s.role,
    tradeId: s.tradeId,
    noteId: s.noteId,
    backtestSessionId: s.backtestSessionId,
    day: s.day,
    capturedAt: s.capturedAt.toISOString(),
    aiInterpretation: s.aiInterpretation,
    interpretationModel: s.interpretationModel,
    supersedesId: s.supersedesId,
    createdAt: s.createdAt.toISOString(),
  };
}

export type WynikSlow =
  | { ok: true; slowa: Slowa; utworzone: boolean }
  | { ok: false; status: 400 | 404 | 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

export async function zapiszSlowa(
  tx: Transakcja,
  api: KontekstApi,
  d: z.output<typeof SlowaUtworzSchema>,
): Promise<WynikSlow> {
  const bajty = sprawdzTekstBajtWBajt(d.text);
  if (!bajty.ok) {
    return { ok: false, status: 400, kod: "invalid_text", komunikat: `pole text: ${bajty.powod}.` };
  }

  const policzony = skrotTekstu(d.text);
  if (policzony !== d.sha256) {
    return {
      ok: false,
      status: 400,
      kod: "hash_mismatch",
      komunikat: `pole sha256: »${d.sha256}« nie zgadza się ze skrótem SHA-256 policzonym przez serwer z bajtów UTF-8 tekstu (»${policzony}«, ${Buffer.byteLength(d.text, "utf8")} B). Tekst zmienił się w drodze (kodowanie, normalizacja Unicode, zamiana końców linii) albo skrót policzono z innych bajtów. Nic nie zapisano.`,
      dodatkowe: { expected: policzony, received: d.sha256, byteLen: Buffer.byteLength(d.text, "utf8") },
    };
  }

  const kotwice = await sprawdzKotwice(tx, d);
  if (!kotwice.ok) return { ok: false, status: 422, kod: "unknown_anchor", komunikat: kotwice.komunikat };
  if (d.noteId !== undefined) {
    const [n] = await tx.select({ id: notes.id }).from(notes).where(eq(notes.id, d.noteId)).limit(1);
    if (!n) return { ok: false, status: 422, kod: "unknown_anchor", komunikat: `pole noteId: »${d.noteId}« - nie ma takiej notatki.` };
  }

  // Idempotencja: to samo zdanie, ta sama chwila zapisu i te same kotwice to ten sam wpis.
  // Tabela nie ma unikatu na te kolumny (poprawki i dopiski moga powtarzac tresc), wiec
  // rownolegle ponowienia serializuje blokada doradcza po kluczu wpisu - inaczej oba
  // zapytania nie znajda jeszcze wiersza i zapisza duplikat.
  const klucz = [policzony, d.capturedAt.toISOString(), d.source, d.role ?? "", d.tradeId ?? "", d.noteId ?? "", d.backtestSessionId ?? "", d.day ?? ""].join("|");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${klucz}, 0))`);
  const [istniejace] = await tx
    .select()
    .from(userWords)
    .where(
      and(
        eq(userWords.sha256, policzony),
        eq(userWords.capturedAt, d.capturedAt),
        eq(userWords.source, d.source),
        sql`${userWords.role} is not distinct from ${d.role ?? null}`,
        sql`${userWords.tradeId} is not distinct from ${d.tradeId ?? null}`,
        sql`${userWords.noteId} is not distinct from ${d.noteId ?? null}`,
        sql`${userWords.backtestSessionId} is not distinct from ${d.backtestSessionId ?? null}`,
        sql`${userWords.day} is not distinct from ${d.day ?? null}`,
      ),
    )
    .limit(1);
  if (istniejace) return { ok: true, slowa: istniejace, utworzone: false };

  const [wiersz] = await tx
    .insert(userWords)
    .values({
      text: d.text,
      source: d.source,
      role: d.role ?? null,
      tradeId: d.tradeId ?? null,
      noteId: d.noteId ?? null,
      backtestSessionId: d.backtestSessionId ?? null,
      day: d.day ?? null,
      capturedAt: d.capturedAt,
      aiInterpretation: d.aiInterpretation ?? null,
      interpretationModel: d.aiInterpretation ? (d.interpretationModel ?? null) : null,
      interpretationAt: d.aiInterpretation ? new Date() : null,
      createdByTokenId: api.token.id,
    })
    .returning();

  // Pas i szelki: trigger policzyl skrot z bajtow w bazie. Gdyby sie rozjechal z naszym,
  // tekst zmienil sie miedzy serwerem aplikacji a baza - wycofujemy transakcje.
  if (wiersz.sha256 !== policzony) {
    throw new Error(
      `Skrót słów użytkownika w bazie (${wiersz.sha256}) różni się od policzonego w aplikacji (${policzony}) dla wiersza #${wiersz.id}; tekst zmienił się w drodze do bazy. Transakcja wycofana.`,
    );
  }
  return { ok: true, slowa: wiersz, utworzone: true };
}

export async function listaSlow(
  tx: Transakcja | typeof import("@/lib/db").db,
  f: z.output<typeof SlowaListaQuery>,
) {
  // Slowa napisane po wejsciu trade'a z ukrytym wynikiem nie wychodza z API (slepa ocena), takze w listach.
  const warunki: SQL[] = [gt(userWords.id, f.after), sql`not ${sqlSlowaPoWejsciuUkrytego(sql`${userWords.tradeId}`, sql`${userWords.day}`, sql`${userWords.capturedAt}`)}`];
  if (f.tradeId) warunki.push(eq(userWords.tradeId, f.tradeId));
  if (f.noteId) warunki.push(eq(userWords.noteId, f.noteId));
  if (f.backtestSessionId) warunki.push(eq(userWords.backtestSessionId, f.backtestSessionId));
  if (f.day) warunki.push(eq(userWords.day, f.day));
  if (f.role) warunki.push(eq(userWords.role, f.role));
  const wiersze = await tx.select().from(userWords).where(and(...warunki)).orderBy(asc(userWords.id)).limit(f.limit + 1);
  const maWiecej = wiersze.length > f.limit;
  const strona = wiersze.slice(0, f.limit);
  return { words: strona.map(zSlow), nextAfter: maWiecej ? strona[strona.length - 1].id : null };
}

export type WynikInterpretacji =
  | { ok: true; slowa: Slowa }
  | { ok: false; status: 404 | 409; kod: string; komunikat: string };

/** Interpretacja AI ustawiana raz; poprawka to osobny, logowany proces (korekty) po stronie uzytkownika. */
export async function ustawInterpretacje(
  tx: Transakcja,
  id: number,
  d: z.output<typeof InterpretacjaSchema>,
): Promise<WynikInterpretacji> {
  const [obecne] = await tx.select().from(userWords).where(eq(userWords.id, id)).for("update").limit(1);
  if (!obecne) return { ok: false, status: 404, kod: "not_found", komunikat: `Słowa użytkownika #${id} nie istnieją.` };
  if (obecne.aiInterpretation !== null) {
    return {
      ok: false,
      status: 409,
      kod: "interpretation_set",
      komunikat: `Słowa #${id} mają już interpretację AI (${obecne.interpretationModel ?? "model nieznany"}, ${obecne.interpretationAt?.toISOString() ?? "czas nieznany"}). Poprawę interpretacji zapisuje użytkownik w aplikacji, żeby zostały po niej ślad i uzasadnienie.`,
    };
  }
  const [wiersz] = await tx
    .update(userWords)
    .set({ aiInterpretation: d.text, interpretationModel: d.model, interpretationAt: new Date() })
    .where(eq(userWords.id, id))
    .returning();
  return { ok: true, slowa: wiersz };
}
