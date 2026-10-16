import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { utworzNotatke } from "@/lib/api-v2/notatki";
import { odepnijDopasowanie, zastosujDopasowanie } from "@/lib/brokerzy/dopasowania";
import { domenaTraduBrokera, utworzTradeZDanychBrokera } from "@/lib/brokerzy/import";
import { wersjaSetupuNaChwile } from "@/lib/api-v2/wersje-setupu";
import { zapisJakoUi, type Transakcja } from "@/lib/api-v2/zapis";
import {
  aiSuggestions,
  brokerAccounts,
  brokerTrades,
  interpretationCorrections,
  noteAdditions,
  notes,
  profileTermSources,
  profileTerms,
  setupExamples,
  setupVersions,
  tradeNoteLinks,
  tradeTags,
  trades,
} from "@/lib/db/schema";

/**
 * Decyzje uzytkownika o kolejce potwierdzen AI (ADR-033, MUST 10). Wszystko w transakcji z aktorem
 * `ui` - tylko wtedy trigger `tj_require_ui_actor` pozwala przejsc sugestii w stan zatwierdzony,
 * odrzucony albo cofniety (API agenta dostaje TJ403). Zatwierdzenie WSTAWIA wiersz do tabeli
 * docelowej z pochodzeniem `ai`; cofniecie go kasuje (albo przywraca poprzednia ocene procesu).
 * Dzieki temu niezatwierdzona sugestia nie istnieje nigdzie poza kolejka, a statystyki, grupowanie
 * i Edge Finder licza tylko to, co uzytkownik zatwierdzil.
 */

export type WynikDecyzji = { ok: true; komunikat: string } | { ok: false; komunikat: string };

const blad = (komunikat: string): WynikDecyzji => ({ ok: false, komunikat });

type Sugestia = typeof aiSuggestions.$inferSelect;

async function pobierz(tx: Transakcja, id: number): Promise<Sugestia | null> {
  const [s] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, id)).for("update").limit(1);
  return s ?? null;
}

const AUTOR_UI = { token: { id: null } } as const;

/** Wstawia efekt sugestii do tabeli docelowej i zwraca, co wstawiono (do cofniecia). */
async function zastosuj(tx: Transakcja, s: Sugestia): Promise<{ ok: true; ref: Record<string, unknown> } | { ok: false; komunikat: string }> {
  const t = s.target as { type?: string; id?: number; date?: string; weekStart?: string };
  const p = s.payload as Record<string, unknown>;

  switch (s.kind) {
    case "tag": {
      const [w] = await tx
        .insert(tradeTags)
        .values({ tradeId: t.id as number, tagId: p.tagId as number, interval: (p.interval as string | null) ?? null, origin: "ai" })
        .onConflictDoNothing()
        .returning({ id: tradeTags.id });
      if (!w) return { ok: false, komunikat: `Trade #${t.id} ma już ten tag${p.interval ? ` na interwale ${String(p.interval)}` : ""}, więc nie ma czego zatwierdzać. Odrzuć sugestię.` };
      return { ok: true, ref: { tradeTagId: w.id } };
    }
    case "trade_link": {
      const [w] = await tx
        .insert(tradeNoteLinks)
        .values({ tradeId: t.id as number, noteId: p.noteId as number, role: p.role as "hypothesis" | "concept" | "mistake" | "strength" | "other", origin: "ai" })
        .onConflictDoNothing()
        .returning({ id: tradeNoteLinks.id });
      if (!w) return { ok: false, komunikat: `Trade #${t.id} jest już powiązany z tą notatką w roli »${String(p.role)}«. Odrzuć sugestię.` };
      return { ok: true, ref: { tradeNoteLinkId: w.id } };
    }
    case "setup_example": {
      const [w] = await tx
        .insert(setupExamples)
        .values({
          setupId: p.setupId as number,
          tradeId: t.id as number,
          kind: p.exampleKind as "a_plus" | "anti",
          screenshotId: (p.screenshotId as number | null) ?? null,
          captionWordsId: (p.captionWordsId as number | null) ?? null,
          origin: "ai",
        })
        .onConflictDoNothing()
        .returning({ id: setupExamples.id });
      if (!w) return { ok: false, komunikat: `Trade #${t.id} jest już przykładem tego rodzaju w tym setupie. Odrzuć sugestię.` };
      return { ok: true, ref: { setupExampleId: w.id } };
    }
    case "trade_setup": {
      const [tr] = await tx.select({ s: trades.setupId, v: trades.setupVersionId }).from(trades).where(eq(trades.id, t.id as number)).for("update").limit(1);
      if (!tr) return { ok: false, komunikat: `Trade #${t.id} nie istnieje (mógł zostać skasowany).` };
      // Wersja obowiazujaca w chwili WEJSCIA trade'a, nie w chwili zatwierdzenia (review 15.10.2026): nowsza wersja
      // przyjeta miedzy wejsciem a zatwierdzeniem nie przejmuje trade'a. Wersja z payloadu (zapisana przy tworzeniu
      // sugestii) liczy sie tylko, jesli nalezy do tego setupu.
      let wersjaId: number | null = null;
      if (typeof p.setupVersionId === "number") {
        const [zPayloadu] = await tx.select({ id: setupVersions.id }).from(setupVersions).where(and(eq(setupVersions.id, p.setupVersionId), eq(setupVersions.setupId, p.setupId as number))).limit(1);
        wersjaId = zPayloadu?.id ?? null;
      } else {
        const [wejscie] = await tx.select({ entryTime: trades.entryTime }).from(trades).where(eq(trades.id, t.id as number)).limit(1);
        if (wejscie) wersjaId = await wersjaSetupuNaChwile(tx, p.setupId as number, wejscie.entryTime);
      }
      await tx.update(trades).set({ setupId: p.setupId as number, setupVersionId: wersjaId }).where(eq(trades.id, t.id as number));
      return { ok: true, ref: { previousSetupId: tr.s, previousSetupVersionId: tr.v } };
    }
    case "process_grade": {
      const [tr] = await tx.select({ g: trades.processGrade, at: trades.processGradedAt }).from(trades).where(eq(trades.id, t.id as number)).for("update").limit(1);
      if (!tr) return { ok: false, komunikat: `Trade #${t.id} nie istnieje (mógł zostać skasowany).` };
      await tx.update(trades).set({ processGrade: p.grade as "A" | "B" | "C", processGradedAt: new Date() }).where(eq(trades.id, t.id as number));
      return { ok: true, ref: { previousGrade: tr.g, previousGradedAt: tr.at?.toISOString() ?? null } };
    }
    case "profile_term": {
      const [istnieje] = await tx.select({ id: profileTerms.id, status: profileTerms.status }).from(profileTerms).where(sql`${profileTerms.termNorm} = lower(public.f_unaccent(${String(p.term)}))`).limit(1);
      if (istnieje) return { ok: false, komunikat: `Hasło »${String(p.term)}« jest już w słowniku (#${istnieje.id}, status ${istnieje.status}). Odrzuć sugestię.` };
      const [haslo] = await tx
        .insert(profileTerms)
        .values({ term: String(p.term), meaning: String(p.meaning), status: "confirmed", origin: "ai", decidedAt: new Date() })
        .returning({ id: profileTerms.id });
      const slowa = Array.isArray(p.wordsIds) ? (p.wordsIds as number[]) : [];
      for (const wid of slowa) await tx.insert(profileTermSources).values({ termId: haslo.id, wordsId: wid }).onConflictDoNothing();
      return { ok: true, ref: { profileTermId: haslo.id } };
    }
    case "day_conclusion":
    case "weekly_conclusion": {
      const dzien = s.kind === "day_conclusion" ? t.date : t.weekStart;
      const wynik = await zapiszWniosek(tx, s.id, String(p.title), String(p.bodyMd), dzien as string);
      if (!wynik.ok) return wynik;
      return { ok: true, ref: { noteId: wynik.noteId } };
    }
    case "strategy_detail":
      return { ok: false, komunikat: "Dopisek do strategii wchodzi od razu i nie wymaga zatwierdzenia; można go tylko cofnąć." };
    case "broker_match": {
      const [bt] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, p.brokerTradeId as number)).for("update").limit(1);
      if (!bt) return { ok: false, komunikat: `Trade brokera #${String(p.brokerTradeId)} nie istnieje (import mógł zostać cofnięty). Odrzuć sugestię.` };
      const w = await zastosujDopasowanie(tx, bt, t.id as number, "ai_accepted");
      if (!w.ok) return { ok: false, komunikat: `Nie da się dopasować: ${w.komunikat}. Odrzuć sugestię.` };
      return { ok: true, ref: { brokerTradeId: bt.id, tradeId: t.id as number, pnlPrzed: w.wynik.pnlPrzed, pnlPo: w.wynik.pnlPo } };
    }
    case "broker_trade": {
      const [bt] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, t.id as number)).for("update").limit(1);
      if (!bt) return { ok: false, komunikat: `Trade brokera #${String(t.id)} nie istnieje (import mógł zostać cofnięty). Odrzuć sugestię.` };
      if (bt.tradeId !== null) return { ok: false, komunikat: `Trade brokera #${bt.id} ma już trade w dzienniku (#${bt.tradeId}). Odrzuć sugestię.` };
      const [ba] = await tx.select({ konto: brokerAccounts.accountId }).from(brokerAccounts).where(eq(brokerAccounts.id, bt.brokerAccountId)).limit(1);
      if (!ba || ba.konto === null) return { ok: false, komunikat: "Konto u brokera nie jest przypisane do konta dziennika (Prop → Połączenia)." };
      const domena = await domenaTraduBrokera(tx, bt);
      if (!domena) return { ok: false, komunikat: `Nie udało się odtworzyć wypełnień trade'a brokera #${bt.id} (dane mogły się zmienić po cofnięciu importu).` };
      const w = await utworzTradeZDanychBrokera(tx, bt, ba.konto, domena);
      if (!w.ok) return { ok: false, komunikat: `Trade nie powstał: ${w.komunikat}.` };
      const ref: Record<string, unknown> = { brokerTradeId: bt.id, tradeId: w.tradeId };
      if (typeof p.noteId === "number") {
        const [link] = await tx.insert(tradeNoteLinks).values({ tradeId: w.tradeId, noteId: p.noteId, role: "other", origin: "ai" }).onConflictDoNothing().returning({ id: tradeNoteLinks.id });
        if (link) ref.tradeNoteLinkId = link.id;
      }
      return { ok: true, ref };
    }
  }
}

/** Wniosek dnia / tygodnia jako notatka »learning« z pochodzeniem AI, zakotwiczona w dniu. */
async function zapiszWniosek(tx: Transakcja, id: number, tytul: string, tresc: string, dzien: string): Promise<{ ok: true; noteId: number } | { ok: false; komunikat: string }> {
  for (const t of [tytul, `${tytul} (wniosek AI #${id})`]) {
    const w = await utworzNotatke(tx, AUTOR_UI, { kind: "learning", title: t, bodyMd: tresc, meta: { suggestionId: id }, origin: "ai", day: dzien });
    if (w.ok) return { ok: true, noteId: w.notatka.id };
    if (w.kod !== "title_taken") return { ok: false, komunikat: w.komunikat };
  }
  return { ok: false, komunikat: "Nie udało się nadać unikalnego tytułu wnioskowi. Zmień tytuł sugestii." };
}

export async function zatwierdzSugestie(id: number): Promise<WynikDecyzji> {
  return zapisJakoUi(async (tx) => {
    const s = await pobierz(tx, id);
    if (!s) return blad(`Sugestia #${id} nie istnieje.`);
    if (s.status !== "pending") return blad(`Sugestia #${id} ma status »${s.status}«, a zatwierdzić można tylko oczekującą. Odśwież listę.`);
    const efekt = await zastosuj(tx, s);
    if (!efekt.ok) return blad(efekt.komunikat);
    await tx.update(aiSuggestions).set({ status: "accepted", decidedAt: new Date(), appliedRef: efekt.ref }).where(eq(aiSuggestions.id, id));
    return { ok: true, komunikat: "Zatwierdzone. Można to cofnąć w każdej chwili." };
  });
}

export async function odrzucSugestie(id: number): Promise<WynikDecyzji> {
  return zapisJakoUi(async (tx) => {
    const s = await pobierz(tx, id);
    if (!s) return blad(`Sugestia #${id} nie istnieje.`);
    if (s.status !== "pending") return blad(`Sugestia #${id} ma status »${s.status}«, a odrzucić można tylko oczekującą. Odśwież listę.`);
    await tx.update(aiSuggestions).set({ status: "rejected", decidedAt: new Date() }).where(eq(aiSuggestions.id, id));
    return { ok: true, komunikat: "Odrzucone. AI nie zgłosi tej samej sugestii drugi raz." };
  });
}

export async function cofnijSugestie(id: number): Promise<WynikDecyzji> {
  return zapisJakoUi(async (tx) => {
    const s = await pobierz(tx, id);
    if (!s) return blad(`Sugestia #${id} nie istnieje.`);
    if (s.status !== "accepted" && s.status !== "applied") {
      return blad(`Sugestia #${id} ma status »${s.status}«, a cofnąć można tylko zatwierdzoną albo zastosowaną. Odśwież listę.`);
    }
    const ref = (s.appliedRef ?? {}) as Record<string, unknown>;

    switch (s.kind) {
      case "tag":
        if (typeof ref.tradeTagId === "number") await tx.delete(tradeTags).where(and(eq(tradeTags.id, ref.tradeTagId), eq(tradeTags.origin, "ai")));
        break;
      case "trade_link":
        if (typeof ref.tradeNoteLinkId === "number") await tx.delete(tradeNoteLinks).where(and(eq(tradeNoteLinks.id, ref.tradeNoteLinkId), eq(tradeNoteLinks.origin, "ai")));
        break;
      case "setup_example":
        if (typeof ref.setupExampleId === "number") await tx.delete(setupExamples).where(and(eq(setupExamples.id, ref.setupExampleId), eq(setupExamples.origin, "ai")));
        break;
      case "trade_setup": {
        const t = s.target as { id: number };
        const [biezacy] = await tx.select({ s: trades.setupId }).from(trades).where(eq(trades.id, t.id)).limit(1);
        if (biezacy && biezacy.s !== (s.payload as { setupId?: number }).setupId) {
          return blad(`Trade #${t.id} ma teraz inny setup niż ten z sugestii, więc cofnięcie nadpisałoby późniejszą decyzję. Zmień setup trade'a ręcznie.`);
        }
        await tx
          .update(trades)
          .set({ setupId: (ref.previousSetupId as number | null | undefined) ?? null, setupVersionId: (ref.previousSetupVersionId as number | null | undefined) ?? null })
          .where(eq(trades.id, t.id));
        break;
      }
      case "process_grade": {
        const t = s.target as { id: number };
        const [obecny] = await tx.select({ g: trades.processGrade }).from(trades).where(eq(trades.id, t.id)).limit(1);
        const zSugestii = (s.payload as { grade?: string }).grade;
        if (obecny && obecny.g !== zSugestii) {
          return blad(`Trade #${t.id} ma teraz ocenę procesu ${obecny.g ?? "(brak)"}, a sugestia ustawiła ${zSugestii}. Cofnięcie nadpisałoby Twoją późniejszą zmianę, więc go nie robię. Zmień ocenę ręcznie.`);
        }
        const poprzednia = (ref.previousGrade as "A" | "B" | "C" | null | undefined) ?? null;
        await tx
          .update(trades)
          .set({ processGrade: poprzednia, processGradedAt: poprzednia === null ? null : new Date((ref.previousGradedAt as string | null) ?? Date.now()) })
          .where(eq(trades.id, t.id));
        break;
      }
      case "profile_term":
        if (typeof ref.profileTermId === "number") {
          const [uzyte] = await tx.select({ id: interpretationCorrections.id }).from(interpretationCorrections).where(eq(interpretationCorrections.termId, ref.profileTermId)).limit(1);
          if (uzyte) await tx.update(profileTerms).set({ status: "rejected", decidedAt: new Date() }).where(eq(profileTerms.id, ref.profileTermId));
          else await tx.delete(profileTerms).where(eq(profileTerms.id, ref.profileTermId));
        }
        break;
      case "day_conclusion":
      case "weekly_conclusion":
        if (typeof ref.noteId === "number") await tx.update(notes).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(notes.id, ref.noteId));
        break;
      case "strategy_detail":
        await tx.update(noteAdditions).set({ revertedAt: new Date() }).where(eq(noteAdditions.suggestionId, id));
        break;
      case "broker_match":
      case "broker_trade": {
        const brokerTradeId = ref.brokerTradeId as number | undefined;
        if (typeof brokerTradeId !== "number") break;
        const [bt] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, brokerTradeId)).for("update").limit(1);
        if (!bt || bt.tradeId === null) break;
        if (typeof ref.tradeId === "number" && bt.tradeId !== ref.tradeId) {
          return blad(`Trade brokera #${bt.id} jest teraz dopasowany do trade'a #${bt.tradeId}, a sugestia dotyczyła #${String(ref.tradeId)}. Cofnięcie nadpisałoby późniejszą decyzję; cofnij dopasowanie w Połączeniach.`);
        }
        // Utworzony z danych brokera trade dziennika jest kasowany bez nagrobka (wraca stan sprzed zatwierdzenia).
        await odepnijDopasowanie(tx, bt, { nowyStan: "skipped", przywrocKwote: true });
        break;
      }
    }
    await tx.update(aiSuggestions).set({ status: "reverted" }).where(eq(aiSuggestions.id, id));
    return { ok: true, komunikat: "Cofnięte." };
  });
}
