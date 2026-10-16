import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { hypothesisVariants, noteRevisions, notes, rules, ruleVersions, screenshots, userWords } from "@/lib/db/schema";
import { listaLuk } from "@/lib/api-v2/luki";
import { listaNotatek, szczegolyNotatki } from "@/lib/api-v2/notatki";
import { odczytajProfil } from "@/lib/api-v2/profil";
import { listaHipotez, listaRegul } from "@/lib/api-v2/reguly";
import { zSlow } from "@/lib/api-v2/slowa";
import { sqlNotatkaUkryta, ukryteSlowa } from "@/lib/api-v2/ukrycie-wyniku";
import { listaDopiskow } from "@/lib/api-v2/mentor";

/**
 * Odczyty ekranów Mózgu (UI v2, etap 2). Tylko odczyt przez istniejące moduły API v2 (te same filtry ślepej oceny
 * co w `GET /api/v2/notes`, `/rules`, `/hypotheses`, `/strategy-gaps`, `/profile`), plus kilka list, których API
 * nie wystawia jako całość (rewizje, załączniki, liczba wariantów hipotezy).
 */

export const WIDOKI_MOZGU = ["reguly", "hipotezy", "pojecia", "system", "wzorce", "nauka", "decyzje", "luki"] as const;
export type WidokMozgu = (typeof WIDOKI_MOZGU)[number];

export const NAZWY_WIDOKOW: Record<WidokMozgu, string> = {
  reguly: "Reguły",
  hipotezy: "Hipotezy",
  pojecia: "Pojęcia ICT",
  system: "System",
  wzorce: "Wzorce",
  nauka: "Dziennik nauki",
  decyzje: "Decyzje mózgu",
  luki: "Luki strategii",
};

const KINDY: Partial<Record<WidokMozgu, string[]>> = {
  pojecia: ["concept"],
  system: ["system", "strategy", "decision_proc"],
  wzorce: ["mistake", "strength"],
  nauka: ["learning"],
  decyzje: ["brain_decision"],
};

export const NAZWY_KINDOW: Record<string, string> = {
  system: "system",
  concept: "pojęcie",
  rule: "reguła",
  decision_proc: "procedura",
  trade_note: "notatka trade'a",
  session: "sesja",
  hypothesis: "hipoteza",
  mistake: "błąd",
  strength: "mocna strona",
  brain_decision: "decyzja mózgu",
  learning: "nauka",
  profile: "profil",
  strategy: "strategia",
  setup: "setup",
};

export async function licznikiMozgu() {
  const [w] = await db.execute<Record<string, number>>(sql`
    select (select count(*) from rules where retired_at is null)::int as reguly,
           (select count(*) from hypotheses)::int as hipotezy,
           (select count(*) from notes where archived_at is null and kind = 'concept')::int as pojecia,
           (select count(*) from notes where archived_at is null and kind in ('system', 'strategy', 'decision_proc'))::int as system,
           (select count(*) from notes where archived_at is null and kind in ('mistake', 'strength'))::int as wzorce,
           (select count(*) from notes where archived_at is null and kind = 'learning')::int as nauka,
           (select count(*) from notes where archived_at is null and kind = 'brain_decision')::int as decyzje,
           (select count(*) from strategy_gaps where kind = 'gap' and status in ('open', 'asked'))::int as luki`);
  return Object.fromEntries(WIDOKI_MOZGU.map((k) => [k, Number(w?.[k] ?? 0)])) as Record<WidokMozgu, number>;
}

export async function regulyMozgu() {
  const { rules: lista, rulesVersion } = await listaRegul(db, "all");
  return { rulesVersion, reguly: lista };
}

export async function hipotezyMozgu() {
  const { hypotheses } = await listaHipotez(db);
  const ids = hypotheses.map((h) => h.id);
  const warianty = ids.length
    ? await db
        .select({ id: hypothesisVariants.hypothesisId, n: sql<number>`count(*)::int`, testow: sql<number>`coalesce(sum(${hypothesisVariants.nTested}), 0)::int` })
        .from(hypothesisVariants)
        .where(inArray(hypothesisVariants.hypothesisId, ids))
        .groupBy(hypothesisVariants.hypothesisId)
    : [];
  return hypotheses.map((h) => {
    const w = warianty.find((x) => x.id === h.id);
    return { ...h, warianty: Number(w?.n ?? 0) };
  });
}

export async function notatkiWidoku(widok: WidokMozgu) {
  const kindy = KINDY[widok] ?? [];
  const wyniki = await Promise.all(kindy.map((k) => listaNotatek(db, { kind: k as never, limit: 200, after: 0 } as never)));
  return wyniki.flatMap((w) => w.notes).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function lukiMozgu() {
  const { gaps } = await listaLuk(db, { kind: "gap", limit: 200, after: 0 } as never);
  return gaps;
}

export async function profilMozgu() {
  return odczytajProfil(db);
}

/** Tytuły notatek do podpowiadania `[[` w edytorze. */
export async function tytulyNotatek(): Promise<{ id: number; title: string; kind: string }[]> {
  // Ślepa ocena (review 16.10.2026): tytuł notatki ukrytej (po wejściu trade'a z werdyktem) nie trafia do podpowiedzi.
  return db
    .select({ id: notes.id, title: notes.title, kind: notes.kind })
    .from(notes)
    .where(and(isNull(notes.archivedAt), sql`not ${sqlNotatkaUkryta(sql`${notes.tradeId}`, sql`${notes.createdAt}`, sql`${notes.updatedAt}`, sql`${notes.day}`)}`))
    .orderBy(asc(notes.title))
    .limit(1000);
}

/** Widok notatki: treść, linki i backlinki (API), rewizje, załączniki, dopiski, słowa użytkownika (najnowsze rewizje). */
export async function notatkaDoWidoku(id: number) {
  const n = await szczegolyNotatki(db, id);
  if (!n) return null;

  const [rewizje, zalaczniki, dopiski, slowaWszystkie] = await Promise.all([
    db
      .select({ rev: noteRevisions.rev, title: noteRevisions.title, actor: noteRevisions.actor, changedAt: noteRevisions.changedAt })
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, id))
      .orderBy(desc(noteRevisions.rev))
      .limit(30),
    // Ślepa ocena (review 16.10.2026): załączniki zrobione po wejściu trade'a z ukrytym wynikiem (trade notatki albo dzień) nie wychodzą.
    db
      .select({ s: screenshots })
      .from(screenshots)
      .innerJoin(notes, eq(notes.id, screenshots.noteId))
      .where(and(eq(screenshots.noteId, id), sql`not ${sqlNotatkaUkryta(sql`${notes.tradeId}`, sql`${screenshots.createdAt}`, sql`${screenshots.createdAt}`, sql`${notes.day}`)}`))
      .orderBy(asc(screenshots.sortOrder), asc(screenshots.id))
      .then((w) => w.map((x) => x.s)),
    // Dopiski przez wspólną funkcję API (ta sama reguła ukrycia, bez cofniętych).
    listaDopiskow(db, id),
    db.select().from(userWords).where(eq(userWords.noteId, id)).orderBy(asc(userWords.id)),
  ]);

  // Rewizje słów: wiersz zastąpiony nowszym (supersedes_id) pokazujemy tylko jako historię najnowszej wersji.
  const ukryte = await ukryteSlowa(db, slowaWszystkie.map((s) => s.id));
  const widoczne = slowaWszystkie.filter((s) => !ukryte.has(s.id));
  const zastapione = new Set(widoczne.map((s) => s.supersedesId).filter((x): x is number => x !== null));
  const poId = new Map(widoczne.map((s) => [s.id, s]));
  const slowa = widoczne
    .filter((s) => !zastapione.has(s.id) && s.role !== "correction")
    .map((s) => {
      const historia: ReturnType<typeof zSlow>[] = [];
      let poprzedni = s.supersedesId === null ? undefined : poId.get(s.supersedesId);
      while (poprzedni) {
        historia.push(zSlow(poprzedni));
        poprzedni = poprzedni.supersedesId === null ? undefined : poId.get(poprzedni.supersedesId);
      }
      return { ...zSlow(s), historia };
    });

  let regula: { code: string; status: string; hard: boolean; wersje: { version: number; status: string; origin: string; textMd: string; proposedAt: string }[] } | null = null;
  if (n.kind === "rule") {
    const [r] = await db.select().from(rules).where(eq(rules.noteId, id)).limit(1);
    if (r) {
      const wersje = await db.select().from(ruleVersions).where(eq(ruleVersions.ruleId, r.id)).orderBy(desc(ruleVersions.version));
      regula = {
        code: r.code,
        status: wersje.find((w) => w.status === "approved") ? "aktywna" : wersje.some((w) => w.status === "proposed") ? "propozycja" : "bez wersji",
        hard: r.hard,
        wersje: wersje.map((w) => ({ version: w.version, status: w.status, origin: w.origin, textMd: w.textMd, proposedAt: w.proposedAt.toISOString() })),
      };
    }
  }

  return {
    ...n,
    rewizje: rewizje.map((r) => ({ ...r, changedAt: r.changedAt.toISOString() })),
    zalaczniki: zalaczniki.map((z) => ({ id: z.id, file: z.file, thumbnail: z.thumbnail, width: z.width, height: z.height, interval: z.interval, origin: z.origin })),
    dopiski: (dopiski?.additions ?? []).filter((d) => d.revertedAt === null).map((d) => ({ id: d.id, bodyMd: d.bodyMd, origin: d.origin, tradeId: d.tradeId, createdAt: d.createdAt })),
    slowa,
    regula,
  };
}

export type NotatkaWidok = NonNullable<Awaited<ReturnType<typeof notatkaDoWidoku>>>;
