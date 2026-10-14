import "server-only";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { hypotheses, notes, ruleVersions, rules, settings } from "@/lib/db/schema";
import {
  bramkaN,
  originEfektywny,
  maOczekujacaPropozycje,
  nastepnyKodHipotezy,
  nastepnyKodReguly,
  statusReguly,
  type StatusReguly,
} from "@/lib/domain/reguly";

import type { HipotezaUtworzSchema, PropozycjaReguly } from "./contract/v2";
import { utworzNotatke } from "./notatki";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Reguly i hipotezy (ADR-029, ADR-030, ADR-033). Agent PROPONUJE: ten modul nie
 * ma zadnej sciezki do statusu `approved` ani `rejected` - zatwierdza wylacznie
 * uzytkownik w UI (trzy warstwy: brak zakresu, brak trasy, trigger w bazie).
 */

type Db = Transakcja | typeof import("@/lib/db").db;

export type WersjaReguly = {
  version: number;
  status: "proposed" | "approved" | "rejected" | "superseded";
  origin: "user" | "ai" | "mentor" | "vault-import";
  textMd: string;
  counterargument: string | null;
  evidence: unknown;
  hypothesisId: number | null;
  rulesetVersion: number | null;
  proposedAt: string;
  decidedAt: string | null;
  /** Podpis pochodzenia do UI: propozycje mentora nie maja progu n i sa podpisane n = 0. */
  podpis: string;
};

function podpis(origin: WersjaReguly["origin"]): string {
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

export async function numerZestawu(tx: Db): Promise<number> {
  const [s] = await tx.select({ v: settings.rulesetVersion }).from(settings).where(eq(settings.id, 1)).limit(1);
  return s?.v ?? 0;
}

export async function listaRegul(tx: Db, filtr: "all" | StatusReguly) {
  const wiersze = await tx
    .select({
      id: rules.id,
      code: rules.code,
      hard: rules.hard,
      retiredAt: rules.retiredAt,
      retiredInRuleset: rules.retiredInRuleset,
      retiredReason: rules.retiredReason,
      noteId: rules.noteId,
      title: notes.title,
      slug: notes.slug,
      meta: notes.meta,
    })
    .from(rules)
    .innerJoin(notes, eq(rules.noteId, notes.id))
    .orderBy(asc(rules.code));

  const ids = wiersze.map((r) => r.id);
  const wersje = ids.length
    ? await tx.select().from(ruleVersions).where(inArray(ruleVersions.ruleId, ids)).orderBy(desc(ruleVersions.version))
    : [];

  const wynik = wiersze.map((r) => {
    const swoje = wersje.filter((w) => w.ruleId === r.id);
    const mapuj = (w: (typeof swoje)[number]): WersjaReguly => ({
      version: w.version,
      status: w.status,
      origin: w.origin,
      textMd: w.textMd,
      counterargument: w.counterargument,
      evidence: w.evidence,
      hypothesisId: w.hypothesisId,
      rulesetVersion: w.rulesetVersion,
      proposedAt: w.proposedAt.toISOString(),
      decidedAt: w.decidedAt?.toISOString() ?? null,
      podpis: podpis(w.origin),
    });
    const status = statusReguly(swoje, r.retiredAt !== null);
    return {
      code: r.code,
      title: r.title,
      slug: r.slug,
      noteId: r.noteId,
      hard: r.hard,
      status,
      pendingProposal: maOczekujacaPropozycje(swoje),
      retiredAt: r.retiredAt?.toISOString() ?? null,
      retiredReason: r.retiredReason,
      vaultStatus: typeof r.meta?.vault_status === "string" ? r.meta.vault_status : null,
      current: swoje.filter((w) => w.status === "approved").map(mapuj)[0] ?? null,
      proposal: swoje.filter((w) => w.status === "proposed").map(mapuj)[0] ?? null,
      versions: swoje.map(mapuj),
    };
  });

  const przefiltrowane = wynik.filter((r) => {
    if (filtr === "all") return true;
    if (filtr === "proposed") return r.pendingProposal;
    return r.status === filtr;
  });
  return { rulesVersion: await numerZestawu(tx), rules: przefiltrowane };
}

export type WynikPropozycji =
  | {
      ok: true;
      utworzona: boolean;
      kodReguly: string;
      wersja: number;
      noteId: number;
      n: number | null;
      podpis: string;
      /** Prawdziwy status wersji, ktorej dotyczy odpowiedz (przy powtorzeniu moze byc inny niz 'proposed'). */
      status: "proposed" | "approved" | "rejected" | "superseded";
    }
  | { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

/** n hipotezy liczy ta sama funkcja SQL, ktorej uzywa trigger bramki (jedno zrodlo prawdy). */
export async function nHipotezy(tx: Db, hypothesisId: number): Promise<{ n: number; progN: number } | null> {
  const wynik = await tx.execute<{ n: number | null; prog_n: number | null }>(sql`
    select public.tj_hypothesis_n(h.id) as n, h.prog_n from hypotheses h where h.id = ${hypothesisId}`);
  const w = wynik[0];
  if (!w || w.n === null || w.prog_n === null) return null;
  return { n: Number(w.n), progN: Number(w.prog_n) };
}

export async function zaproponujRegule(
  tx: Transakcja,
  api: KontekstApi,
  d: z.output<typeof PropozycjaReguly>,
): Promise<WynikPropozycji> {
  // Kody numerujemy pod blokada, zeby dwa rownolegle zapisy nie wzieły tego samego numeru.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tj.rules.code'))`);

  // vault-import bez klucza vault: to zwykly wpis agenta (jak ai); schemat odrzuca go, gdy brakuje pol ai.
  const origin = originEfektywny(d.origin, d.externalRef);

  let n: number | null = null;
  if (origin === "ai") {
    const stan = d.hypothesisId === undefined ? null : await nHipotezy(tx, d.hypothesisId);
    if (!stan) {
      return { ok: false, status: 404, kod: "hypothesis_not_found", komunikat: `pole hypothesisId: »${d.hypothesisId}« - nie ma takiej hipotezy (lista: GET /api/v2/hypotheses).` };
    }
    const bramka = bramkaN("ai", stan.n, stan.progN);
    if (!bramka.ok) return { ok: false, status: 422, kod: "below_threshold", komunikat: `Propozycja odrzucona: ${bramka.powod}.`, dodatkowe: { n: stan.n, progN: stan.progN } };
    n = stan.n;
  } else if (origin === "mentor") {
    n = 0; // podpisane n = 0 (Slowa uzytkownika, 14.10.2026: «Bez progu, podpisane n=0»)
  }

  // Regula docelowa: po kodzie, po externalRef importu albo nowa.
  let regula: { id: number; code: string; noteId: number; retiredAt: Date | null } | undefined;
  if (d.ruleCode !== undefined) {
    [regula] = await tx.select({ id: rules.id, code: rules.code, noteId: rules.noteId, retiredAt: rules.retiredAt }).from(rules).where(eq(rules.code, d.ruleCode)).limit(1);
    if (!regula) {
      return { ok: false, status: 404, kod: "rule_not_found", komunikat: `pole ruleCode: »${d.ruleCode}« - nie ma takiej reguły. Pomiń ruleCode i podaj title, żeby zgłosić nową.` };
    }
  } else if (d.externalRef !== undefined) {
    [regula] = await tx
      .select({ id: rules.id, code: rules.code, noteId: rules.noteId, retiredAt: rules.retiredAt })
      .from(rules)
      .innerJoin(notes, eq(rules.noteId, notes.id))
      .where(eq(notes.externalRef, d.externalRef))
      .limit(1);
  }

  if (regula) {
    if (regula.retiredAt) {
      return { ok: false, status: 409, kod: "rule_retired", komunikat: `Reguła ${regula.code} jest wycofana (${regula.retiredAt.toISOString()}); nie przyjmuje nowych wersji.` };
    }
    const wersje = await tx.select().from(ruleVersions).where(eq(ruleVersions.ruleId, regula.id)).orderBy(desc(ruleVersions.version));
    const najnowsza = wersje[0];
    // Powtorzenie tej samej tresci (ten sam origin) nie mnozy wersji. Porownujemy ze WSZYSTKIMI
    // wersjami, nie tylko z najnowsza, i odpowiadamy prawdziwym statusem tej wersji.
    const powtorka = wersje.find((w) => w.textMd === d.textMd && w.origin === origin);
    if (powtorka) {
      if (powtorka.status === "rejected") {
        return {
          ok: false,
          status: 409,
          kod: "previously_rejected",
          komunikat: `Ta sama treść (reguła ${regula.code}, wersja ${powtorka.version}) została już odrzucona przez użytkownika${powtorka.decidedAt ? ` ${powtorka.decidedAt.toISOString()}` : ""}. Nie zgłaszam jej drugi raz: zmień treść albo przedstaw nowy argument (evidence) w innej wersji.`,
          dodatkowe: { version: powtorka.version, decidedAt: powtorka.decidedAt?.toISOString() ?? null },
        };
      }
      return {
        ok: true,
        utworzona: false,
        kodReguly: regula.code,
        wersja: powtorka.version,
        noteId: regula.noteId,
        n,
        podpis: podpis(powtorka.origin),
        status: powtorka.status,
      };
    }
    const oczekujaca = wersje.find((w) => w.status === "proposed");
    if (oczekujaca) {
      return {
        ok: false,
        status: 409,
        kod: "proposal_pending",
        komunikat: `Reguła ${regula.code} ma już oczekującą propozycję (wersja ${oczekujaca.version}, ${podpis(oczekujaca.origin)}). Jedna propozycja naraz: użytkownik musi ją najpierw zatwierdzić albo odrzucić w aplikacji.`,
        dodatkowe: { pendingVersion: oczekujaca.version },
      };
    }
    const [wersja] = await tx
      .insert(ruleVersions)
      .values({
        ruleId: regula.id,
        version: (najnowsza?.version ?? 0) + 1,
        textMd: d.textMd,
        status: "proposed",
        origin: origin,
        counterargument: d.counterargument ?? null,
        evidence: d.evidence ?? null,
        hypothesisId: d.hypothesisId ?? null,
        createdByTokenId: api.token.id,
      })
      .returning({ version: ruleVersions.version });
    return { ok: true, utworzona: true, kodReguly: regula.code, wersja: wersja.version, noteId: regula.noteId, n, podpis: podpis(origin), status: "proposed" };
  }

  // Nowa regula: notatka (kind rule) + wiersz rules + wersja 1.
  const tytul = d.title as string; // superRefine w schemacie gwarantuje title bez ruleCode
  const kody = await tx.select({ code: rules.code }).from(rules);
  const kod = nastepnyKodReguly(kody.map((k) => k.code));
  const meta: Record<string, unknown> = {};
  if (d.vaultStatus !== undefined) meta.vault_status = d.vaultStatus;
  const nota = await utworzNotatke(tx, api, {
    kind: "rule",
    title: tytul,
    bodyMd: d.textMd,
    meta,
    origin: origin,
    ...(d.externalRef !== undefined ? { externalRef: d.externalRef } : {}),
  });
  if (!nota.ok) return { ok: false, status: nota.status === 422 ? 422 : 409, kod: nota.kod, komunikat: nota.komunikat, dodatkowe: nota.dodatkowe };

  const [nowa] = await tx.insert(rules).values({ code: kod, noteId: nota.notatka.id, hard: d.hard ?? false }).returning({ id: rules.id });
  await tx.insert(ruleVersions).values({
    ruleId: nowa.id,
    version: 1,
    textMd: d.textMd,
    status: "proposed",
    origin: origin,
    counterargument: d.counterargument ?? null,
    evidence: d.evidence ?? null,
    hypothesisId: d.hypothesisId ?? null,
    createdByTokenId: api.token.id,
  });
  return { ok: true, utworzona: true, kodReguly: kod, wersja: 1, noteId: nota.notatka.id, n, podpis: podpis(origin), status: "proposed" };
}

/* --- Hipotezy ------------------------------------------------------------- */

export async function listaHipotez(tx: Db) {
  const wiersze = await tx
    .select({
      id: hypotheses.id,
      code: hypotheses.code,
      noteId: hypotheses.noteId,
      decision: hypotheses.decision,
      progN: hypotheses.progN,
      thresholds: hypotheses.thresholds,
      nImported: hypotheses.nImported,
      declaredAt: hypotheses.declaredAt,
      decidedAt: hypotheses.decidedAt,
      title: notes.title,
      slug: notes.slug,
      n: sql<number>`public.tj_hypothesis_n(${hypotheses.id})`,
    })
    .from(hypotheses)
    .innerJoin(notes, eq(hypotheses.noteId, notes.id))
    .orderBy(asc(hypotheses.code));
  return {
    hypotheses: wiersze.map((h) => {
      const n = Number(h.n);
      return {
        id: h.id,
        code: h.code,
        noteId: h.noteId,
        title: h.title,
        slug: h.slug,
        decision: h.decision,
        n,
        nImported: h.nImported,
        progN: h.progN,
        /** Faza liczona z n i progu, nie zapisana: zbieranie (n < prog) albo do oceny. */
        phase: n >= h.progN ? ("do_oceny" as const) : ("zbieranie" as const),
        thresholds: h.thresholds,
        declaredAt: h.declaredAt.toISOString(),
        decidedAt: h.decidedAt?.toISOString() ?? null,
      };
    }),
  };
}

export type WynikHipotezy =
  | { ok: true; utworzona: boolean; id: number; code: string; noteId: number }
  | { ok: false; status: 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

export async function zalozHipoteze(
  tx: Transakcja,
  api: KontekstApi,
  d: z.output<typeof HipotezaUtworzSchema>,
): Promise<WynikHipotezy> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tj.hypotheses.code'))`);

  if (d.externalRef !== undefined) {
    const [istniejaca] = await tx
      .select({ id: hypotheses.id, code: hypotheses.code, noteId: hypotheses.noteId })
      .from(hypotheses)
      .innerJoin(notes, eq(hypotheses.noteId, notes.id))
      .where(eq(notes.externalRef, d.externalRef))
      .limit(1);
    if (istniejaca) return { ok: true, utworzona: false, ...istniejaca };
  }

  const nota = await utworzNotatke(tx, api, {
    kind: "hypothesis",
    title: d.title,
    bodyMd: d.bodyMd,
    meta: {},
    origin: originEfektywny(d.origin, d.externalRef),
    ...(d.externalRef !== undefined ? { externalRef: d.externalRef } : {}),
  });
  if (!nota.ok) return { ok: false, status: nota.status === 422 ? 422 : 409, kod: nota.kod, komunikat: nota.komunikat, dodatkowe: nota.dodatkowe };

  const kody = await tx.select({ code: hypotheses.code }).from(hypotheses);
  const kod = nastepnyKodHipotezy(kody.map((k) => k.code));
  const [h] = await tx
    .insert(hypotheses)
    .values({ code: kod, noteId: nota.notatka.id, progN: d.progN, thresholds: d.thresholds, nImported: d.nImported })
    .returning({ id: hypotheses.id });
  return { ok: true, utworzona: true, id: h.id, code: kod, noteId: nota.notatka.id };
}
