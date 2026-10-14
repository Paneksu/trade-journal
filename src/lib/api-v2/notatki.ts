import "server-only";
import { and, asc, eq, gt, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { backtestSessions, noteLinks, notes, trades } from "@/lib/db/schema";
import { slugZNumerem, slugZTytulu, wyciagnijLinki } from "@/lib/domain/notatki";
import { originEfektywny } from "@/lib/domain/reguly";

import type { NotatkaUtworzSchema, NotatkaZmienSchema, NotatkiListaQuery } from "./contract/v2";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Notatki w aplikacji (ADR-029). Zapis zawsze w transakcji z `tj.actor`
 * (`api.zapis`): rewizje tworzy trigger `tj_note_revision`, a linki [[...]]
 * przelicza ten modul w tej samej transakcji.
 */

export type Notatka = typeof notes.$inferSelect;

export function zNotatki(n: Notatka) {
  return {
    id: n.id,
    kind: n.kind,
    slug: n.slug,
    title: n.title,
    bodyMd: n.bodyMd,
    meta: n.meta,
    origin: n.origin,
    rev: n.rev,
    contentHash: n.contentHash,
    tradeId: n.tradeId,
    backtestSessionId: n.backtestSessionId,
    day: n.day,
    externalRef: n.externalRef,
    archivedAt: n.archivedAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

/** Nazwa bez wielkosci liter i ogonkow, tak jak indeks `notes_title_norm_idx`. */
const normalizacja = (kolumna: SQL | typeof notes.title) => sql`lower(public.f_unaccent(${kolumna}))`;

export type WynikNotatki =
  | { ok: true; notatka: Notatka }
  | { ok: false; status: 404 | 409 | 422 | 428; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

/** Dowiazuje linki [[...]] z tresci: usuwa stare wiersze, wstawia aktualne z rozwiazanym celem. */
export async function przeliczLinki(tx: Transakcja, noteId: number, bodyMd: string): Promise<number> {
  const cele = wyciagnijLinki(bodyMd);
  await tx.delete(noteLinks).where(eq(noteLinks.fromNoteId, noteId));
  if (cele.length === 0) return 0;
  const wartosci = sql.join(
    cele.map((c) => sql`(${c}::text)`),
    sql`, `,
  );
  await tx.execute(sql`
    insert into note_links (from_note_id, target, to_note_id)
    select ${noteId}, t.target,
           (select n.id from notes n
             where lower(public.f_unaccent(n.title)) = lower(public.f_unaccent(t.target)) limit 1)
      from (values ${wartosci}) as t(target)`);
  return cele.length;
}

/** Gdy powstaje (albo zmienia tytul) notatka, dowiazuje wiszace linki, ktore na nia wskazywaly. */
export async function dowiazWiszaceLinki(tx: Transakcja, noteId: number, tytul: string): Promise<void> {
  await tx
    .update(noteLinks)
    .set({ toNoteId: noteId })
    .where(
      and(isNull(noteLinks.toNoteId), sql`lower(public.f_unaccent(${noteLinks.target})) = lower(public.f_unaccent(${tytul}))`, ne(noteLinks.fromNoteId, noteId)),
    );
}

async function wolnySlug(tx: Transakcja, podstawa: string): Promise<string> {
  const zajete = await tx
    .select({ slug: notes.slug })
    .from(notes)
    .where(sql`${notes.slug} = ${podstawa} or ${notes.slug} like ${`${podstawa.replace(/[\\%_]/g, "\\$&")}-%`}`);
  const set = new Set(zajete.map((z) => z.slug));
  if (!set.has(podstawa)) return podstawa;
  for (let i = 2; i < 10_000; i += 1) {
    const kandydat = slugZNumerem(podstawa, i);
    if (!set.has(kandydat)) return kandydat;
  }
  throw new Error(`Nie znaleziono wolnego sluga dla »${podstawa}« w 10000 próbach.`);
}

export async function sprawdzKotwice(
  tx: Transakcja,
  k: { tradeId?: number; backtestSessionId?: number },
): Promise<{ ok: true } | { ok: false; komunikat: string }> {
  if (k.tradeId !== undefined) {
    const [t] = await tx.select({ id: trades.id }).from(trades).where(eq(trades.id, k.tradeId)).limit(1);
    if (!t) return { ok: false, komunikat: `pole tradeId: »${k.tradeId}« - nie ma takiego trade'a (mógł zostać skasowany w aplikacji).` };
  }
  if (k.backtestSessionId !== undefined) {
    const [s] = await tx.select({ id: backtestSessions.id }).from(backtestSessions).where(eq(backtestSessions.id, k.backtestSessionId)).limit(1);
    if (!s) return { ok: false, komunikat: `pole backtestSessionId: »${k.backtestSessionId}« - nie ma takiej sesji.` };
  }
  return { ok: true };
}

export async function utworzNotatke(
  tx: Transakcja,
  api: KontekstApi,
  d: z.output<typeof NotatkaUtworzSchema>,
): Promise<WynikNotatki> {
  const kotwice = await sprawdzKotwice(tx, d);
  if (!kotwice.ok) return { ok: false, status: 422, kod: "unknown_anchor", komunikat: kotwice.komunikat };

  const [tytulZajety] = await tx
    .select({ id: notes.id, slug: notes.slug, rev: notes.rev })
    .from(notes)
    .where(sql`${normalizacja(notes.title)} = lower(public.f_unaccent(${d.title}))`)
    .limit(1);
  if (tytulZajety) {
    return {
      ok: false,
      status: 409,
      kod: "title_taken",
      komunikat: `Tytuł »${d.title}« jest już zajęty przez notatkę #${tytulZajety.id} (${tytulZajety.slug}); tytuły są unikalne bez względu na wielkość liter i ogonki, bo [[Tytuł]] rozwiązuje się po tytule. Zmień tytuł albo zmień istniejącą notatkę (PATCH z If-Match: ${tytulZajety.rev}).`,
      dodatkowe: { existing: { id: tytulZajety.id, slug: tytulZajety.slug, rev: tytulZajety.rev } },
    };
  }
  if (d.externalRef !== undefined) {
    const [ref] = await tx.select({ id: notes.id, slug: notes.slug, rev: notes.rev }).from(notes).where(eq(notes.externalRef, d.externalRef)).limit(1);
    if (ref) {
      return {
        ok: false,
        status: 409,
        kod: "external_ref_taken",
        komunikat: `externalRef »${d.externalRef}« należy już do notatki #${ref.id} (${ref.slug}). Zmień ją przez PATCH z If-Match: ${ref.rev} zamiast tworzyć drugą.`,
        dodatkowe: { existing: { id: ref.id, slug: ref.slug, rev: ref.rev } },
      };
    }
  }

  let slug: string;
  if (d.slug !== undefined) {
    const [zajety] = await tx.select({ id: notes.id }).from(notes).where(eq(notes.slug, d.slug)).limit(1);
    if (zajety) {
      return { ok: false, status: 409, kod: "slug_taken", komunikat: `slug »${d.slug}« jest zajęty przez notatkę #${zajety.id}. Pomiń pole slug, a serwer dobierze wolny.`, dodatkowe: { existing: { id: zajety.id } } };
    }
    slug = d.slug;
  } else {
    slug = await wolnySlug(tx, slugZTytulu(d.title) || "notatka");
  }

  const [nowa] = await tx
    .insert(notes)
    .values({
      kind: d.kind,
      slug,
      title: d.title,
      bodyMd: d.bodyMd,
      meta: d.meta,
      // vault-import bez klucza vault: to zwykly wpis agenta, nie import z sejfu.
      origin: originEfektywny(d.origin, d.externalRef),
      tradeId: d.tradeId ?? null,
      backtestSessionId: d.backtestSessionId ?? null,
      day: d.day ?? null,
      externalRef: d.externalRef ?? null,
      createdByTokenId: api.token.id,
    })
    .returning();

  await przeliczLinki(tx, nowa.id, nowa.bodyMd);
  await dowiazWiszaceLinki(tx, nowa.id, nowa.title);
  return { ok: true, notatka: nowa };
}

/**
 * Notatki typowanych encji (reguly, hipotezy) maja wlasne trasy. Zwykly POST /notes
 * obszedlby bramki (kontrargument, prog n, jedna propozycja naraz), a zwykly PATCH
 * zmienilby tresc reguly poza wersjami, ktore sa niezmienne.
 */
export const KINDY_ZARZADZANE = ["rule", "hypothesis"] as const;

export function odeslanieDlaKindu(kind: string): { sciezka: string; komunikat: string } | null {
  if (kind === "rule") {
    return { sciezka: "/api/v2/rules/proposals", komunikat: "Notatki o rodzaju »rule« powstają wyłącznie przez POST /api/v2/rules/proposals (propozycja z wersją, kontrargumentem i dowodami; zatwierdza ją użytkownik)." };
  }
  if (kind === "hypothesis") {
    return { sciezka: "/api/v2/hypotheses", komunikat: "Notatki o rodzaju »hypothesis« powstają wyłącznie przez POST /api/v2/hypotheses (z progiem n i progami zadeklarowanymi z góry)." };
  }
  return null;
}

export async function zmienNotatke(
  tx: Transakcja,
  id: number,
  ifMatch: number,
  d: z.output<typeof NotatkaZmienSchema>,
): Promise<WynikNotatki> {
  const [obecnyRodzaj] = await tx.select({ kind: notes.kind }).from(notes).where(eq(notes.id, id)).limit(1);
  if (obecnyRodzaj && odeslanieDlaKindu(obecnyRodzaj.kind) && (d.title !== undefined || d.bodyMd !== undefined || d.meta !== undefined || d.archived !== undefined)) {
    const o = odeslanieDlaKindu(obecnyRodzaj.kind)!;
    return {
      ok: false,
      status: 409,
      kod: "managed_note",
      komunikat: `Notatka #${id} jest częścią typowanej encji (»${obecnyRodzaj.kind}«), więc jej tytułu, treści i meta nie zmienia się zwykłym PATCH. ${o.komunikat} Archiwizacja takiej notatki też jest tylko w aplikacji: znikałaby z wyszukiwania, z którego korzystają agenci.`,
      dodatkowe: { useInstead: o.sciezka },
    };
  }

  if (d.title !== undefined) {
    const [zajety] = await tx
      .select({ id: notes.id, slug: notes.slug })
      .from(notes)
      .where(and(sql`${normalizacja(notes.title)} = lower(public.f_unaccent(${d.title}))`, ne(notes.id, id)))
      .limit(1);
    if (zajety) {
      return {
        ok: false,
        status: 409,
        kod: "title_taken",
        komunikat: `Tytuł »${d.title}« jest już zajęty przez notatkę #${zajety.id} (${zajety.slug}). Wybierz inny tytuł.`,
        dodatkowe: { existing: { id: zajety.id, slug: zajety.slug } },
      };
    }
  }

  const zmiany: Partial<typeof notes.$inferInsert> = {};
  if (d.title !== undefined) zmiany.title = d.title;
  if (d.bodyMd !== undefined) zmiany.bodyMd = d.bodyMd;
  if (d.meta !== undefined) zmiany.meta = d.meta;
  if (d.archived !== undefined) zmiany.archivedAt = d.archived ? new Date() : null;
  // Trigger ustawia updated_at przy zmianie tresci; przy samej archiwizacji robimy to tutaj.
  zmiany.updatedAt = new Date();

  const [zmieniona] = await tx
    .update(notes)
    .set(zmiany)
    .where(and(eq(notes.id, id), eq(notes.rev, ifMatch)))
    .returning();

  if (!zmieniona) {
    const [obecna] = await tx.select().from(notes).where(eq(notes.id, id)).limit(1);
    if (!obecna) {
      return { ok: false, status: 404, kod: "not_found", komunikat: `Notatka #${id} nie istnieje.` };
    }
    return {
      ok: false,
      status: 409,
      kod: "rev_mismatch",
      komunikat: `Notatka #${id} ma rewizję ${obecna.rev}, a If-Match podaje ${ifMatch}. Ktoś (albo inne urządzenie) zmienił ją w międzyczasie. Odczytaj bieżącą treść z tej odpowiedzi, scal zmiany i ponów z If-Match: ${obecna.rev}.`,
      dodatkowe: { currentRev: obecna.rev, current: zNotatki(obecna) },
    };
  }

  if (d.bodyMd !== undefined) await przeliczLinki(tx, zmieniona.id, zmieniona.bodyMd);
  if (d.title !== undefined) await dowiazWiszaceLinki(tx, zmieniona.id, zmieniona.title);
  return { ok: true, notatka: zmieniona };
}

/** `If-Match: 3`, `If-Match: "3"` albo `W/"3"` -> 3; wszystko inne (w tym `*`) -> null. */
export function rewizjaZIfMatch(naglowek: string | null): number | null {
  if (!naglowek) return null;
  const m = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(naglowek);
  return m ? Number(m[1]) : null;
}

export type FiltrNotatek = z.output<typeof NotatkiListaQuery>;

export async function listaNotatek(tx: Transakcja | typeof import("@/lib/db").db, f: FiltrNotatek) {
  const warunki: SQL[] = [gt(notes.id, f.after)];
  if (f.kind) warunki.push(eq(notes.kind, f.kind));
  if (f.slug) warunki.push(eq(notes.slug, f.slug));
  if (f.externalRef) warunki.push(eq(notes.externalRef, f.externalRef));
  if (f.day) warunki.push(eq(notes.day, f.day));
  if (f.tradeId) warunki.push(eq(notes.tradeId, f.tradeId));
  if (!f.includeArchived) warunki.push(isNull(notes.archivedAt));

  const wiersze = await tx
    .select({
      id: notes.id,
      kind: notes.kind,
      slug: notes.slug,
      title: notes.title,
      origin: notes.origin,
      rev: notes.rev,
      contentHash: notes.contentHash,
      tradeId: notes.tradeId,
      backtestSessionId: notes.backtestSessionId,
      day: notes.day,
      externalRef: notes.externalRef,
      archivedAt: notes.archivedAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(...warunki))
    .orderBy(asc(notes.id))
    .limit(f.limit + 1);

  const maWiecej = wiersze.length > f.limit;
  const strona = wiersze.slice(0, f.limit);
  return {
    notes: strona.map((n) => ({ ...n, archivedAt: n.archivedAt?.toISOString() ?? null, updatedAt: n.updatedAt.toISOString() })),
    nextAfter: maWiecej ? strona[strona.length - 1].id : null,
  };
}

export async function szczegolyNotatki(tx: Transakcja | typeof import("@/lib/db").db, id: number) {
  const [n] = await tx.select().from(notes).where(eq(notes.id, id)).limit(1);
  if (!n) return null;
  const wychodzace = await tx
    .select({ target: noteLinks.target, toNoteId: noteLinks.toNoteId })
    .from(noteLinks)
    .where(eq(noteLinks.fromNoteId, id))
    .orderBy(asc(noteLinks.id));
  const celeIds = wychodzace.map((l) => l.toNoteId).filter((x): x is number => x !== null);
  const cele = celeIds.length
    ? await tx.select({ id: notes.id, slug: notes.slug, title: notes.title }).from(notes).where(inArray(notes.id, celeIds))
    : [];
  const przychodzace = await tx
    .select({ id: notes.id, slug: notes.slug, title: notes.title, target: noteLinks.target })
    .from(noteLinks)
    .innerJoin(notes, eq(noteLinks.fromNoteId, notes.id))
    .where(eq(noteLinks.toNoteId, id))
    .orderBy(asc(notes.id));
  return {
    ...zNotatki(n),
    links: wychodzace.map((l) => ({
      target: l.target,
      resolved: l.toNoteId === null ? null : (cele.find((c) => c.id === l.toNoteId) ?? null),
    })),
    backlinks: przychodzace,
  };
}
