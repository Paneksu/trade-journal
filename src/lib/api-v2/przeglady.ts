import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { backtestSessions, dayNotes, settings, tradePlans, trades, userWords, weeklyReviews } from "@/lib/db/schema";
import { timeParts } from "@/lib/domain/calc";
import { oknoHandluZUstawien, wskaznikDyscypliny, type TradeDlaDyscypliny } from "@/lib/domain/discipline";
import { wynikTrade } from "@/lib/domain/outcome";
import { najlepszeINajgorsze, siatkaProcesu, type TradeDoSiatki } from "@/lib/domain/process-grid";
import { getProgi } from "@/lib/queries/dictionaries";

import type { PrzegladTygodniaZapisSchema } from "./contract/funkcje";
import { dyscyplinaDoApi, siatkaDoApi } from "./mapowanie";
import type { Transakcja } from "./with-api";

/**
 * Przeglad tygodnia procesowy (ADR-033, MUST 9; metodyka R8): 3 najlepsze i 3 najgorsze
 * trade'y wg PROCESU, rozklad A/B/C i koszt gry C w R, siatka 2x2, koszt lamania regul
 * w R i $, jedno zobowiazanie z rozliczeniem poprzedniego. AI przygotowuje szkic
 * (`draft_md` + migawka liczb), ZATWIERDZA tylko uzytkownik w UI (trigger, TJ403).
 *
 * Zakres: trade'y zamkniete z dniem handlowym w tygodniu, bez sesji `backtest`: dni replayu
 * sa historyczne, wiec nie leza w tygodniu, w ktorym je rozegrano.
 */

type Db = Transakcja | typeof import("@/lib/db").db;
export type Przeglad = typeof weeklyReviews.$inferSelect;

const DZIEN_MS = 86_400_000;

export function dodajDni(data: string, dni: number): string {
  return new Date(new Date(`${data}T00:00:00Z`).getTime() + dni * DZIEN_MS).toISOString().slice(0, 10);
}

/** Poniedzialek ISO? (1 = poniedzialek). */
export function czyPoniedzialek(data: string): boolean {
  return new Date(`${data}T00:00:00Z`).getUTCDay() === 1;
}

export async function metrykiTygodnia(tx: Db, weekStart: string) {
  const weekEnd = dodajDni(weekStart, 6);
  const progi = await getProgi();
  const [ust] = await tx.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const strefa = ust?.timezone ?? "Europe/Warsaw";

  const wiersze = await tx
    .select({
      id: trades.id,
      tradingDay: trades.tradingDay,
      entryTime: trades.entryTime,
      createdAt: trades.createdAt,
      processGrade: trades.processGrade,
      stopLoss: trades.stopLoss,
      pnl: trades.pnl,
      riskAmount: trades.riskAmount,
      contracts: trades.contracts,
      r: trades.rMultiple,
      planId: tradePlans.id,
      planFrozenAt: tradePlans.frozenAt,
      planStopLoss: tradePlans.stopLoss,
    })
    .from(trades)
    .leftJoin(backtestSessions, eq(trades.backtestSessionId, backtestSessions.id))
    .leftJoin(tradePlans, eq(tradePlans.tradeId, trades.id))
    .where(
      and(
        eq(trades.status, "closed"),
        gte(trades.tradingDay, weekStart),
        lte(trades.tradingDay, weekEnd),
        or(isNull(trades.backtestSessionId), sql`${backtestSessions.kind} <> 'backtest'`),
      ),
    )
    .orderBy(asc(trades.entryTime), asc(trades.id));

  const doSiatki: TradeDoSiatki[] = [];
  const doDyscypliny: TradeDlaDyscypliny[] = [];
  for (const w of wiersze) {
    const pnl = Number(w.pnl ?? 0);
    const r = w.r === null ? null : Number(w.r);
    doSiatki.push({
      id: w.id,
      entryTime: w.entryTime,
      processGrade: w.processGrade,
      wynik: wynikTrade({ pnl, riskAmount: w.riskAmount === null ? null : Number(w.riskAmount), contracts: Number(w.contracts) }, progi),
      rMultiple: r,
      pnlCents: pnl,
    });
    const cz = timeParts(w.entryTime, strefa);
    doDyscypliny.push({
      id: w.id,
      tradingDay: w.tradingDay ?? weekStart,
      entryTime: w.entryTime,
      momentDecyzji: w.entryTime,
      processGrade: w.processGrade,
      stopLoss: w.stopLoss === null ? null : Number(w.stopLoss),
      plan: w.planId !== null && w.planFrozenAt !== null && w.planStopLoss !== null ? { frozenAt: w.planFrozenAt, stopLoss: Number(w.planStopLoss) } : null,
      minutaWejscia: cz.hour * 60 + cz.minute,
      pnlCents: pnl,
      rMultiple: r,
    });
  }

  const dniNotatki = await tx
    .select({ day: dayNotes.day, maxTrades: dayNotes.maxTrades, postSession: dayNotes.postSession })
    .from(dayNotes)
    .where(and(gte(dayNotes.day, weekStart), lte(dayNotes.day, weekEnd), isNull(dayNotes.backtestSessionId)));

  const [biezacy] = await tx.select({ status: weeklyReviews.status }).from(weeklyReviews).where(eq(weeklyReviews.weekStart, weekStart)).limit(1);
  const dyscyplina = wskaznikDyscypliny({
    trades: doDyscypliny,
    dni: dniNotatki.map((d) => ({ day: d.day, maxTrades: d.maxTrades, przegladWypelniony: (d.postSession ?? "").trim().length > 0 })),
    okno: oknoHandluZUstawien(ust?.tradingHoursFrom, ust?.tradingHoursTo),
    tygodnieWymagane: 1,
    tygodnieZatwierdzone: biezacy?.status === "approved" ? 1 : 0,
  });

  return {
    weekStart,
    weekEnd,
    scope: "trade'y zamknięte z dniem handlowym w tygodniu; sesje backtestu pominięte (dni replayu są historyczne)",
    trades: wiersze.length,
    grid: siatkaDoApi(siatkaProcesu(doSiatki)),
    bestAndWorst: (({ najlepsze, najgorsze }) => ({ best: najlepsze, worst: najgorsze }))(najlepszeINajgorsze(doSiatki, 3)),
    discipline: dyscyplinaDoApi(dyscyplina),
    timezone: strefa,
  };
}

async function slowaPoId(tx: Db, ids: (number | null)[]) {
  const wartosci = ids.filter((x): x is number => x !== null);
  if (wartosci.length === 0) return new Map<number, { id: number; text: string; sha256: string }>();
  const wiersze = await tx
    .select({ id: userWords.id, text: userWords.text, sha256: userWords.sha256 })
    .from(userWords)
    .where(inArray(userWords.id, wartosci));
  return new Map(wiersze.map((w) => [w.id, w]));
}

export async function zPrzegladu(tx: Db, p: Przeglad) {
  const slowa = await slowaPoId(tx, [p.conclusionsWordsId, p.commitmentWordsId, p.prevResultWordsId]);
  const pobierz = (id: number | null) => (id === null ? null : (slowa.get(id) ?? null));
  return {
    id: p.id,
    weekStart: p.weekStart,
    status: p.status,
    draftMd: p.draftMd,
    draftSignature: p.draftMd ? "szkic AI" : null,
    statsSnapshot: p.statsSnapshot,
    asOf: p.asOf?.toISOString() ?? null,
    conclusions: pobierz(p.conclusionsWordsId),
    commitment: pobierz(p.commitmentWordsId),
    prevReviewId: p.prevReviewId,
    prevCommitmentResult: p.prevCommitmentResult,
    prevResult: pobierz(p.prevResultWordsId),
    approvedAt: p.approvedAt?.toISOString() ?? null,
  };
}

export async function odczytajPrzeglad(tx: Db, weekStart: string) {
  const [zapisany] = await tx.select().from(weeklyReviews).where(eq(weeklyReviews.weekStart, weekStart)).limit(1);
  const [poprzedni] = await tx.select().from(weeklyReviews).where(eq(weeklyReviews.weekStart, dodajDni(weekStart, -7))).limit(1);
  const metryki = await metrykiTygodnia(tx, weekStart);
  return {
    weekStart,
    review: zapisany ? await zPrzegladu(tx, zapisany) : null,
    previousReview: poprzedni ? await zPrzegladu(tx, poprzedni) : null,
    /** Zobowiazanie z poprzedniego tygodnia do rozliczenia na tym przegladzie. */
    commitmentToSettle:
      poprzedni?.commitmentWordsId != null && zapisany?.prevCommitmentResult == null
        ? { reviewId: poprzedni.id, weekStart: poprzedni.weekStart }
        : null,
    metrics: metryki,
  };
}

export type WynikPrzegladu =
  | { ok: true; utworzony: boolean; przeglad: Przeglad }
  | { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

const odrzuc = (status: 404 | 409 | 422, kod: string, komunikat: string, dodatkowe?: Record<string, unknown>): Extract<WynikPrzegladu, { ok: false }> => ({ ok: false, status, kod, komunikat, ...(dodatkowe ? { dodatkowe } : {}) });

export async function zapiszPrzeglad(
  tx: Transakcja,
  weekStart: string,
  d: z.output<typeof PrzegladTygodniaZapisSchema>,
): Promise<WynikPrzegladu> {
  if (!czyPoniedzialek(weekStart)) {
    return odrzuc(422, "not_monday", `Tydzień zaczyna się w poniedziałek, a ${weekStart} nim nie jest. Użyj poniedziałku (ISO), np. ${dodajDni(weekStart, -((new Date(`${weekStart}T00:00:00Z`).getUTCDay() + 6) % 7))}.`);
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.weekly:${weekStart}`}, 0))`);
  const [obecny] = await tx.select().from(weeklyReviews).where(eq(weeklyReviews.weekStart, weekStart)).for("update").limit(1);
  if (obecny?.status === "approved") {
    return odrzuc(409, "review_approved", `Przegląd tygodnia ${weekStart} jest zatwierdzony (${obecny.approvedAt?.toISOString()}) i nie zmienia się przez API. Wnioski i zobowiązanie poprawia użytkownik w aplikacji.`);
  }

  for (const [pole, wid] of [["conclusionsWordsId", d.conclusionsWordsId], ["commitmentWordsId", d.commitmentWordsId], ["prevResultWordsId", d.prevResultWordsId]] as const) {
    if (wid != null) {
      const [w] = await tx.select({ id: userWords.id, tradeId: userWords.tradeId }).from(userWords).where(eq(userWords.id, wid)).limit(1);
      if (!w) return odrzuc(422, "unknown_reference", `pole ${pole}: słowa użytkownika #${wid} nie istnieją (zapisz je najpierw przez POST /api/v2/user-words).`);
      // Przeglad tygodnia zyje dluzej niz pojedynczy trade: slowa przypiete do trade'u (CASCADE przy jego kasowaniu)
      // zablokowalyby skasowanie tego trade'u w aplikacji (klucz bez kaskady, 23503).
      if (w.tradeId !== null) {
        return odrzuc(422, "words_anchored_to_trade", `pole ${pole}: słowa #${wid} są przypięte do trade'u #${w.tradeId}, a przegląd tygodnia nie może na nich stać (skasowanie tego trade'u w aplikacji byłoby zablokowane). Zapisz te same słowa ponownie bez tradeId (np. z day = poniedziałek tygodnia, role = weekly.commitment).`, { wordsId: wid, tradeId: w.tradeId });
      }
    }
  }

  // JEDNO zobowiazanie na tydzien: po ustawieniu nie zmienia sie, tez na inne slowa.
  if (obecny?.commitmentWordsId != null && d.commitmentWordsId != null && d.commitmentWordsId !== obecny.commitmentWordsId) {
    return odrzuc(409, "commitment_set", `Przegląd ${weekStart} ma już zobowiązanie (słowa #${obecny.commitmentWordsId}). Na tydzień przypada jedno zobowiązanie; zmienić je może tylko użytkownik w aplikacji.`, { commitmentWordsId: obecny.commitmentWordsId });
  }

  // Rozliczenie zobowiazania: dotyczy przegladu poprzedniego tygodnia, ktory MUSI mieć zobowiazanie.
  let prevReviewId: number | null = obecny?.prevReviewId ?? null;
  if (d.prevCommitmentResult != null) {
    const [poprzedni] = await tx.select().from(weeklyReviews).where(eq(weeklyReviews.weekStart, dodajDni(weekStart, -7))).limit(1);
    if (!poprzedni || poprzedni.commitmentWordsId === null) {
      return odrzuc(422, "no_commitment_to_settle", `Nie ma czego rozliczyć: przegląd poprzedniego tygodnia (${dodajDni(weekStart, -7)}) ${poprzedni ? "nie ma zobowiązania" : "nie istnieje"}.`);
    }
    prevReviewId = poprzedni.id;
  }

  // Szkic idzie z migawka liczb, na ktorych stal (zgodnosc snapshot <-> as_of pilnuje CHECK).
  const nowyDraft = d.draftMd !== undefined;
  const metryki = nowyDraft ? await metrykiTygodnia(tx, weekStart) : null;

  const zmiany = {
    ...(d.draftMd !== undefined ? { draftMd: d.draftMd } : {}),
    ...(metryki ? { statsSnapshot: metryki as unknown as Record<string, unknown>, asOf: new Date() } : {}),
    ...(d.conclusionsWordsId !== undefined ? { conclusionsWordsId: d.conclusionsWordsId } : {}),
    ...(d.commitmentWordsId !== undefined ? { commitmentWordsId: d.commitmentWordsId } : {}),
    ...(d.prevCommitmentResult !== undefined ? { prevCommitmentResult: d.prevCommitmentResult } : {}),
    ...(d.prevResultWordsId !== undefined ? { prevResultWordsId: d.prevResultWordsId } : {}),
    ...(prevReviewId !== null ? { prevReviewId } : {}),
  };

  if (!obecny) {
    const [nowy] = await tx.insert(weeklyReviews).values({ weekStart, status: "draft", ...zmiany }).returning();
    return { ok: true, utworzony: true, przeglad: nowy };
  }
  if (Object.keys(zmiany).length === 0) return { ok: true, utworzony: false, przeglad: obecny };
  const [zmieniony] = await tx.update(weeklyReviews).set(zmiany).where(eq(weeklyReviews.id, obecny.id)).returning();
  return { ok: true, utworzony: false, przeglad: zmieniony };
}
