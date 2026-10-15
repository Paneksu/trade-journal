import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import { notes, screenshots, setupExamples, setups, setupVersions, trades } from "@/lib/db/schema";
import { kanonicznyJson } from "@/lib/domain/kanoniczny";
import { slugZTytulu } from "@/lib/domain/notatki";
import { originEfektywny } from "@/lib/domain/reguly";

import type { SetupUtworzSchema, SetupWersjaSchema } from "./contract/funkcje";
import { utworzNotatke } from "./notatki";
import { pomiaryZamknietych, progiZJson, statystykaPoZrodlach } from "./statystyki";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Playbook jako struktura (ADR-033, MUST 4; metodyka R26). Agent PROPONUJE wersje setupu:
 * ten modul nie ma sciezki do statusu zatwierdzonego (trigger `tj_require_ui_actor`, TJ403).
 * Tresc wersji jest niezmienna - zmiana progow albo warunkow to NOWA wersja.
 */

type Db = Transakcja | typeof import("@/lib/db").db;
export type WersjaSetupu = typeof setupVersions.$inferSelect;

function podpis(origin: WersjaSetupu["origin"]): string {
  switch (origin) {
    case "ai":
      return "propozycja AI";
    case "mentor":
      return "wg mentora, n = 0";
    case "vault-import":
      return "import z sejfu (do ponownego zatwierdzenia)";
    default:
      return "użytkownik";
  }
}

export function zWersjiSetupu(w: WersjaSetupu) {
  return {
    id: w.id,
    version: w.version,
    status: w.status,
    origin: w.origin,
    signature: podpis(w.origin),
    preconditions: w.preconditions,
    entryChecklist: w.entryChecklist,
    stopRule: w.stopRule,
    targetRule: w.targetRule,
    beRule: w.beRule,
    invalidation: w.invalidation,
    avoid: w.avoid,
    thresholds: w.thresholds,
    counterargument: w.counterargument,
    evidence: w.evidence ?? null,
    proposedAt: w.proposedAt.toISOString(),
    decidedAt: w.decidedAt?.toISOString() ?? null,
    decisionReason: w.decisionReason,
  };
}

/** Pola tresci wersji do porownania (idempotencja: ta sama tresc nie mnozy wersji). */
function odcisk(w: { preconditions: unknown; entryChecklist: unknown; stopRule: unknown; targetRule: unknown; beRule: unknown; invalidation: unknown; avoid: unknown; thresholds: unknown; origin: string }): string {
  return kanonicznyJson({
    preconditions: w.preconditions,
    entryChecklist: w.entryChecklist,
    stopRule: w.stopRule ?? null,
    targetRule: w.targetRule ?? null,
    beRule: w.beRule ?? null,
    invalidation: w.invalidation ?? null,
    avoid: w.avoid ?? null,
    thresholds: w.thresholds,
    origin: w.origin,
  });
}

export type WynikSetupu =
  | { ok: true; slug: string; wersja: number; utworzona: boolean; noteId: number; status: WersjaSetupu["status"]; signature: string }
  | { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

async function wolnySlugSetupu(tx: Transakcja, podstawa: string): Promise<string> {
  const baza = (podstawa || "setup").slice(0, 70).replace(/-+$/, "") || "setup";
  const zajete = new Set(
    (await tx.select({ slug: setups.slug }).from(setups).where(sql`${setups.slug} = ${baza} or ${setups.slug} like ${`${baza.replace(/[\\%_]/g, "\\$&")}-%`}`)).map((r) => r.slug),
  );
  if (!zajete.has(baza)) return baza;
  for (let i = 2; i < 10_000; i += 1) {
    if (!zajete.has(`${baza}-${i}`)) return `${baza}-${i}`;
  }
  throw new Error(`Nie znaleziono wolnego sluga setupu dla »${baza}« w 10000 próbach.`);
}

function wartosciWersji(d: z.output<typeof SetupWersjaSchema>) {
  return {
    preconditions: d.preconditions,
    entryChecklist: d.entryChecklist,
    stopRule: d.stopRule ?? null,
    targetRule: d.targetRule ?? null,
    beRule: d.beRule ?? null,
    invalidation: d.invalidation ?? null,
    avoid: d.avoid ?? null,
    thresholds: d.thresholds as Record<string, unknown>,
    origin: d.origin,
    counterargument: d.counterargument ?? null,
    evidence: d.evidence ?? null,
  };
}

export async function zalozSetup(tx: Transakcja, api: KontekstApi, d: z.output<typeof SetupUtworzSchema>): Promise<WynikSetupu> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tj.setups.slug'))`);
  if (d.slug !== undefined) {
    const [zajety] = await tx.select({ id: setups.id }).from(setups).where(eq(setups.slug, d.slug)).limit(1);
    if (zajety) return { ok: false, status: 409, kod: "slug_taken", komunikat: `slug »${d.slug}« jest zajęty przez setup #${zajety.id}. Nowa wersja istniejącego setupu: POST /api/v2/setups/${d.slug}/versions.` };
  }
  const slug = d.slug ?? (await wolnySlugSetupu(tx, slugZTytulu(d.name)));

  const nota = await utworzNotatke(tx, api, {
    kind: "setup",
    title: d.name,
    bodyMd: d.bodyMd,
    meta: {},
    origin: originEfektywny(d.origin, undefined),
  });
  if (!nota.ok) return { ok: false, status: nota.status === 422 ? 422 : 409, kod: nota.kod, komunikat: nota.komunikat, dodatkowe: nota.dodatkowe };

  const [s] = await tx.insert(setups).values({ slug, name: d.name, noteId: nota.notatka.id }).returning({ id: setups.id });
  await tx.insert(setupVersions).values({ setupId: s.id, version: 1, status: "proposed", createdByTokenId: api.token.id, ...wartosciWersji(d) });
  return { ok: true, slug, wersja: 1, utworzona: true, noteId: nota.notatka.id, status: "proposed", signature: podpis(d.origin) };
}

export async function zaproponujWersjeSetupu(tx: Transakcja, api: KontekstApi, slug: string, d: z.output<typeof SetupWersjaSchema>): Promise<WynikSetupu> {
  const [s] = await tx.select().from(setups).where(eq(setups.slug, slug)).for("update").limit(1);
  if (!s) return { ok: false, status: 404, kod: "not_found", komunikat: `Setup »${slug}« nie istnieje (lista: GET /api/v2/setups).` };
  if (s.retiredAt) return { ok: false, status: 409, kod: "setup_retired", komunikat: `Setup »${slug}« jest wycofany (${s.retiredAt.toISOString()}); nie przyjmuje nowych wersji.` };

  const wersje = await tx.select().from(setupVersions).where(eq(setupVersions.setupId, s.id)).orderBy(desc(setupVersions.version));
  const nowe = wartosciWersji(d);
  const powtorka = wersje.find((w) => odcisk(w) === odcisk(nowe));
  if (powtorka) {
    if (powtorka.status === "rejected") {
      return {
        ok: false,
        status: 409,
        kod: "previously_rejected",
        komunikat: `Ta sama treść (setup »${slug}«, wersja ${powtorka.version}) została już odrzucona przez użytkownika${powtorka.decidedAt ? ` ${powtorka.decidedAt.toISOString()}` : ""}. Zmień treść albo przedstaw nowy argument.`,
        dodatkowe: { version: powtorka.version },
      };
    }
    return { ok: true, slug, wersja: powtorka.version, utworzona: false, noteId: s.noteId, status: powtorka.status, signature: podpis(powtorka.origin) };
  }
  const oczekujaca = wersje.find((w) => w.status === "proposed");
  if (oczekujaca) {
    return {
      ok: false,
      status: 409,
      kod: "proposal_pending",
      komunikat: `Setup »${slug}« ma już oczekującą propozycję (wersja ${oczekujaca.version}, ${podpis(oczekujaca.origin)}). Jedna propozycja naraz: użytkownik musi ją najpierw zatwierdzić albo odrzucić w aplikacji.`,
      dodatkowe: { pendingVersion: oczekujaca.version },
    };
  }
  const numer = (wersje[0]?.version ?? 0) + 1;
  await tx.insert(setupVersions).values({ setupId: s.id, version: numer, status: "proposed", createdByTokenId: api.token.id, ...nowe });
  return { ok: true, slug, wersja: numer, utworzona: true, noteId: s.noteId, status: "proposed", signature: podpis(d.origin) };
}

export async function listaSetupow(tx: Db, includeRetired: boolean) {
  const wiersze = await tx
    .select({ id: setups.id, slug: setups.slug, name: setups.name, noteId: setups.noteId, retiredAt: setups.retiredAt, createdAt: setups.createdAt })
    .from(setups)
    .where(includeRetired ? undefined : isNull(setups.retiredAt))
    .orderBy(asc(setups.slug));
  const ids = wiersze.map((s) => s.id);
  const wersje = ids.length ? await tx.select().from(setupVersions).where(inArray(setupVersions.setupId, ids)).orderBy(desc(setupVersions.version)) : [];
  return {
    setups: wiersze.map((s) => {
      const swoje = wersje.filter((w) => w.setupId === s.id);
      const obowiazujaca = swoje.find((w) => w.status === "approved");
      const propozycja = swoje.find((w) => w.status === "proposed");
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        noteId: s.noteId,
        retiredAt: s.retiredAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        currentVersion: obowiazujaca?.version ?? null,
        pendingProposal: propozycja ? { version: propozycja.version, signature: podpis(propozycja.origin) } : null,
      };
    }),
  };
}

export async function szczegolySetupu(tx: Db, slug: string) {
  const [s] = await tx.select().from(setups).where(eq(setups.slug, slug)).limit(1);
  if (!s) return null;
  const [nota] = await tx.select({ title: notes.title, bodyMd: notes.bodyMd, rev: notes.rev }).from(notes).where(eq(notes.id, s.noteId)).limit(1);
  const wersje = await tx.select().from(setupVersions).where(eq(setupVersions.setupId, s.id)).orderBy(desc(setupVersions.version));
  const obowiazujaca = wersje.find((w) => w.status === "approved") ?? null;
  const propozycja = wersje.find((w) => w.status === "proposed") ?? null;

  // Progi statusu z obowiazujacej wersji; bez zatwierdzonej wersji obowiazuja domyslne (20 / 100).
  // Progi NIE dzialaja wstecz (15.10.2026, review B2): trade liczy sie wedlug progow tej wersji setupu, z ktora
  // zostal wykonany (trades.setup_version_id). Nowa wersja z nizszym minN nie zmienia statusu trade'ow starej.
  const { progi, blad } = progiZJson(obowiazujaca?.thresholds);
  const warunekBiezacej = obowiazujaca
    ? eq(trades.setupVersionId, obowiazujaca.id)
    : and(eq(trades.setupId, s.id), isNull(trades.setupVersionId))!;
  const statystyka = statystykaPoZrodlach(await pomiaryZamknietych(tx, warunekBiezacej), progi);

  const poWersjach = [];
  for (const w of [...wersje].reverse()) {
    if (w.status !== "approved" && w.status !== "superseded") continue;
    const p = progiZJson(w.thresholds);
    poWersjach.push({
      version: w.version,
      status: w.status,
      thresholdsUsed: p.progi,
      stats: statystykaPoZrodlach(await pomiaryZamknietych(tx, eq(trades.setupVersionId, w.id)), p.progi),
    });
  }
  const [{ bezWersji }] = await tx
    .select({ bezWersji: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(eq(trades.setupId, s.id), isNull(trades.setupVersionId)));

  const przyklady = await tx
    .select({
      id: setupExamples.id,
      tradeId: setupExamples.tradeId,
      kind: setupExamples.kind,
      screenshotId: setupExamples.screenshotId,
      thumbnail: screenshots.thumbnail,
      captionWordsId: setupExamples.captionWordsId,
      origin: setupExamples.origin,
      createdAt: setupExamples.createdAt,
    })
    .from(setupExamples)
    .leftJoin(screenshots, eq(setupExamples.screenshotId, screenshots.id))
    .where(eq(setupExamples.setupId, s.id))
    .orderBy(asc(setupExamples.id));

  const [{ ile }] = await tx
    .select({ ile: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(eq(trades.setupId, s.id)));

  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    noteId: s.noteId,
    bodyMd: nota?.bodyMd ?? "",
    noteRev: nota?.rev ?? null,
    retiredAt: s.retiredAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    current: obowiazujaca ? zWersjiSetupu(obowiazujaca) : null,
    proposal: propozycja ? zWersjiSetupu(propozycja) : null,
    versions: wersje.map(zWersjiSetupu),
    thresholdsUsed: progi,
    thresholdsWarning: blad,
    tradesLinked: ile,
    stats: statystyka,
    statsByVersion: poWersjach,
    unversionedTrades: bezWersji,
    examples: przyklady.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
  };
}
