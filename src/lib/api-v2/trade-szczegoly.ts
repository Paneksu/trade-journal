import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  accounts,
  backtestSessions,
  chartAnnotations,
  instruments,
  notes,
  screenshots,
  tagCategories,
  tags,
  tradeExits,
  tradeNoteLinks,
  tradeReviews,
  tradeRuleChecks,
  tradeTags,
  trades,
  userWords,
} from "@/lib/db/schema";
import { moglZnacDzien } from "@/lib/domain/lookahead";
import { zrodloDanych } from "@/lib/domain/zrodla";

import { planTradu } from "./plany";
import { zSlow } from "./slowa";
import { czyWynikUkryty, sqlNotatkaPoWejsciuUkrytego, wejscieTradu } from "./ukrycie-wyniku";
import type { Transakcja } from "./with-api";

/**
 * `GET /trades/:id` (backlog z lacznika): trade z zrzutami, ocenami, planem, slowami
 * uzytkownika, adnotacjami wykresu i powiazaniami. Wynik jest UKRYTY (`resultHidden`),
 * dopoki trade nie jest zamkniety, a ma juz werdykt AI: ocena powstaje przed wynikiem
 * (MUST 2) i nikt - ani AI czytajace trade'a, ani widok - nie moze go podejrzec. Ukrycie
 * to logika API (tu), nie widoku; widok dostaje flage.
 */

type Db = Transakcja | typeof import("@/lib/db").db;

const liczba = (w: string | null) => (w === null ? null : Number(w));

export async function szczegolyTradu(tx: Db, id: number) {
  const [t] = await tx
    .select({
      t: trades,
      accountName: accounts.name,
      accountType: accounts.type,
      symbol: instruments.symbol,
      sessionKind: backtestSessions.kind,
      sessionName: backtestSessions.name,
    })
    .from(trades)
    .innerJoin(accounts, eq(trades.accountId, accounts.id))
    .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
    .leftJoin(backtestSessions, eq(trades.backtestSessionId, backtestSessions.id))
    .where(eq(trades.id, id))
    .limit(1);
  if (!t) return null;
  const tr = t.t;

  const [oceny, zrzuty, tagi, slowa, adnotacje, powiazania] = await Promise.all([
    tx.select().from(tradeReviews).where(eq(tradeReviews.tradeId, id)).orderBy(asc(tradeReviews.basis), asc(tradeReviews.id)),
    tx.select().from(screenshots).where(eq(screenshots.tradeId, id)).orderBy(asc(screenshots.sortOrder), asc(screenshots.id)),
    tx
      .select({ assignmentId: tradeTags.id, tagId: tags.id, name: tags.name, category: tagCategories.key, interval: tradeTags.interval, origin: tradeTags.origin })
      .from(tradeTags)
      .innerJoin(tags, eq(tradeTags.tagId, tags.id))
      .innerJoin(tagCategories, eq(tags.categoryId, tagCategories.id))
      .where(eq(tradeTags.tradeId, id))
      .orderBy(asc(tradeTags.id)),
    tx.select().from(userWords).where(eq(userWords.tradeId, id)).orderBy(asc(userWords.id)),
    tx.select().from(chartAnnotations).where(eq(chartAnnotations.tradeId, id)).orderBy(asc(chartAnnotations.id)),
    tx
      .select({ id: tradeNoteLinks.id, noteId: tradeNoteLinks.noteId, role: tradeNoteLinks.role, origin: tradeNoteLinks.origin, title: notes.title, kind: notes.kind, slug: notes.slug })
      .from(tradeNoteLinks)
      .innerJoin(notes, eq(tradeNoteLinks.noteId, notes.id))
      .where(and(eq(tradeNoteLinks.tradeId, id), sql`not ${sqlNotatkaPoWejsciuUkrytego(sql`${notes.tradeId}`, sql`${notes.createdAt}`, sql`${notes.updatedAt}`)}`))
      .orderBy(asc(tradeNoteLinks.id)),
  ]);

  const idsOcen = oceny.map((o) => o.id);
  const sprawdzenia = idsOcen.length ? await tx.select().from(tradeRuleChecks).where(inArray(tradeRuleChecks.reviewId, idsOcen)).orderBy(asc(tradeRuleChecks.ruleId)) : [];

  const ukryj = await czyWynikUkryty(tx, id);
  // Razem z wynikiem chowamy wszystko, co moze go zdradzic (review): oceny po fakcie (basis = history) i korekty do nich,
  // wnioski (lesson) oraz notatki trade'a, ktore uzytkownik mogl dopisac juz po wyniku. Slepa ocena ma byc slepa.
  const historyIds = new Set(oceny.filter((o) => o.basis === "history").map((o) => o.id));
  const widoczneOceny = ukryj ? oceny.filter((o) => !historyIds.has(o.id) && !(o.overridesReviewId !== null && historyIds.has(o.overridesReviewId))) : oceny;
  const ukryteOceny = oceny.length - widoczneOceny.length;
  const dzienOceny = tr.tradingDay ?? tr.entryTime.toISOString().slice(0, 10);

  // Co powstalo PO wejsciu, moze zdradzic wynik: przy ukryciu wychodzi tylko to, co z chwili przed wejsciem.
  const wejscie = (await wejscieTradu(tx, id)) ?? tr.entryTime;
  const poWejsciu = (t: Date | null) => t === null || t.getTime() > wejscie.getTime();
  const wyjscia = ukryj ? [] : await tx.select().from(tradeExits).where(eq(tradeExits.tradeId, id)).orderBy(asc(tradeExits.sortOrder), asc(tradeExits.id));
  const plan = await planTradu(tx, id);

  const slowaAdnotacji = adnotacje.map((a) => a.wordsId).filter((x): x is number => x !== null);
  const tekstyAdnotacji = slowaAdnotacji.length
    ? new Map((await tx.select().from(userWords).where(inArray(userWords.id, slowaAdnotacji))).map((s) => [s.id, s]))
    : new Map<number, typeof userWords.$inferSelect>();

  return {
    trade: {
      id: tr.id,
      externalRef: tr.externalRef,
      source: tr.source,
      status: tr.status,
      accountId: tr.accountId,
      accountName: t.accountName,
      accountType: t.accountType,
      symbol: t.symbol,
      sessionId: tr.backtestSessionId,
      sessionKind: t.sessionKind,
      sessionName: t.sessionName,
      /** Wyliczane (bez kolumny): backtest / forward / demo / live. */
      dataSource: zrodloDanych({ rodzajSesji: t.sessionKind, wSesji: tr.backtestSessionId !== null, typKonta: t.accountType }),
      direction: tr.direction,
      entryTime: tr.entryTime.toISOString(),
      entryPrice: Number(tr.entryPrice),
      contracts: Number(tr.contracts),
      stopLoss: liczba(tr.stopLoss),
      takeProfit: liczba(tr.takeProfit),
      tradingDay: tr.tradingDay,
      marketSession: tr.marketSession,
      note: ukryj ? null : tr.note,
      moodNote: ukryj ? null : tr.moodNote,
      readiness: tr.readiness,
      tags: tagi,
      processGrade: tr.processGrade,
      processGradedAt: tr.processGradedAt?.toISOString() ?? null,
      setupId: tr.setupId,
      setupVersionId: tr.setupVersionId,
      rulesetVersion: tr.rulesetVersion,
      dayKnown: tr.dayKnown,
      createdAt: tr.createdAt.toISOString(),
      updatedAt: tr.updatedAt.toISOString(),
    },
    resultHidden: ukryj,
    resultHiddenReason: ukryj ? "Trade nie jest zamknięty, a ma werdykt AI wydany przed wynikiem. Wynik pokaże się po zamknięciu." : null,
    hiddenFields: ukryj ? ["result", "trade.note", "trade.moodNote", "reviews.lesson", "reviews.summaryMd(user_override)", "reviews.basis=history", "userWords(po wejsciu)", "chartAnnotations.words(po wejsciu)", "screenshots.caption/capturedAt/chartState(po wejsciu)", "links(notatki po wejsciu)"] : [],
    hiddenReviews: ukryteOceny,
    result: ukryj
      ? null
      : {
          exitPrice: liczba(tr.exitPrice),
          exitTime: tr.exitTime?.toISOString() ?? null,
          pnlCents: tr.pnl,
          riskCents: tr.riskAmount,
          rMultiple: liczba(tr.rMultiple),
          mae: liczba(tr.mae),
          mfe: liczba(tr.mfe),
          exits: wyjscia.map((w) => ({
            id: w.id,
            time: w.exitTime?.toISOString() ?? null,
            price: Number(w.exitPrice),
            contracts: Number(w.contracts),
            note: w.note,
          })),
        },
    plan,
    screenshots: zrzuty.map((z) => {
      const schowaj = ukryj && poWejsciu(z.capturedAt);
      return {
        id: z.id,
        file: z.file,
        thumbnail: z.thumbnail,
        interval: z.interval,
        origin: z.origin,
        sha256: z.sha256,
        capturedAt: schowaj ? null : (z.capturedAt?.toISOString() ?? null),
        chartState: schowaj ? null : (z.chartState ?? null),
        caption: schowaj ? null : z.caption,
        width: z.width,
        height: z.height,
      };
    }),
    reviews: widoczneOceny.map((o) => {
      const reguly = sprawdzenia.filter((s) => s.reviewId === o.id);
      const korekty = oceny.filter((x) => x.overridesReviewId === o.id).map((x) => x.id);
      return {
        id: o.id,
        kind: o.kind,
        basis: o.basis,
        setupType: o.setupType,
        // Tresc korekty pisze uzytkownik po fakcie i moze opisywac wynik.
        summaryMd: ukryj && o.kind === "user_override" ? null : o.summaryMd,
        lesson: ukryj ? null : o.lesson,
        brainVerdict: o.brainVerdict,
        brainPlan: o.brainPlan ?? null,
        model: o.model,
        evidenceCutoff: o.evidenceCutoff?.toISOString() ?? null,
        asOf: o.asOf?.toISOString() ?? null,
        evidenceHash: o.evidenceHash,
        rulesetVersion: o.rulesetVersion,
        immutable: o.asOf !== null,
        overridesReviewId: o.overridesReviewId,
        overriddenBy: korekty,
        /** Ile zdan uzytkownika »nie zgadzam sie« + korekt: miara tego, ile werdyktow uzytkownik zmienil. */
        changedByUser: korekty.length + reguly.filter((r) => r.userVerdict === "disagree").length,
        lookAhead: o.kind === "ai" ? moglZnacDzien(o.model, dzienOceny) : null,
        createdAt: o.createdAt.toISOString(),
        ruleChecks: reguly.map((r) => ({
          ruleId: r.ruleId,
          ruleText: r.ruleText,
          verdict: r.verdict,
          evidence: r.evidence,
          userVerdict: r.userVerdict,
          ruleVersionId: r.ruleVersionId,
        })),
      };
    }),
    userWords: (ukryj ? slowa.filter((s) => !poWejsciu(s.capturedAt)) : slowa).map(zSlow),
    chartAnnotations: adnotacje.map((a) => ({
      id: a.id,
      platform: a.platform,
      externalId: a.externalId,
      shape: a.shape,
      interval: a.interval,
      price: liczba(a.price),
      price2: liczba(a.price2),
      timeFrom: a.timeFrom?.toISOString() ?? null,
      timeTo: a.timeTo?.toISOString() ?? null,
      capturedAt: a.capturedAt.toISOString(),
      words: a.wordsId === null ? null : (() => { const s = tekstyAdnotacji.get(a.wordsId); return s && !(ukryj && poWejsciu(s.capturedAt)) ? zSlow(s) : null; })(),
    })),
    links: powiazania,
  };
}
