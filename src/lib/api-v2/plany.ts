import "server-only";
import { and, asc, desc, eq, gt, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import {
  accounts,
  aiSuggestions,
  backtestSessions,
  instruments,
  setups,
  setupVersions,
  tradePlanAddenda,
  tradePlans,
  trades,
  userWords,
} from "@/lib/db/schema";
import { computeTrade } from "@/lib/domain/calc";
import { mapujSymbol } from "@/lib/domain/tradingview";
import { instrumentSpec } from "@/lib/queries/dictionaries";

import { czyWynikUkryty, wejscieTradu } from "./ukrycie-wyniku";
import { wersjaSetupuNaChwile } from "./wersje-setupu";
import type { PlanDopisekSchema, PlanUtworzSchema, PlanyListaQuery } from "./contract/funkcje";
import { numerZestawu } from "./reguly";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Plan zamrozony przed wejsciem (ADR-033, MUST 1; metodyka R1). Po zapisie plan jest tylko
 * do odczytu: baza odrzuca kazdy UPDATE poza przypieciem trade'u (trigger `tj_plan_guard`,
 * TJ409), a zmiany ida jako dopiski z czasem i z SLOWAMI UZYTKOWNIKA (`trade_plan_addenda`).
 *
 * Ryzyko planu (`risk_cents`) to MIGAWKA z `computeTrade` z chwili zamrozenia - nigdy
 * ticki x wartosc ticku liczone tutaj (tick jest w tysiecznych USD, ADR-002).
 */

type Db = Transakcja | typeof import("@/lib/db").db;
export type Plan = typeof tradePlans.$inferSelect;

export function zPlanu(p: Plan) {
  return {
    id: p.id,
    tradeId: p.tradeId,
    accountId: p.accountId,
    instrumentId: p.instrumentId,
    sessionId: p.backtestSessionId,
    day: p.day,
    setupId: p.setupId,
    setupVersionId: p.setupVersionId,
    rulesetVersion: p.rulesetVersion,
    direction: p.direction,
    bias: p.bias,
    entryPrice: Number(p.entryPrice),
    stopLoss: Number(p.stopLoss),
    takeProfit: p.takeProfit === null ? null : Number(p.takeProfit),
    contracts: Number(p.contracts),
    riskCents: p.riskCents,
    thesisWordsId: p.thesisWordsId,
    invalidationWordsId: p.invalidationWordsId,
    origin: p.origin,
    frozenAt: p.frozenAt.toISOString(),
  };
}

export type WynikPlanu =
  | { ok: true; plan: Plan; utworzony: boolean; ostrzezenia: string[] }
  | { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };

const odrzuc = (status: 404 | 409 | 422, kod: string, komunikat: string, dodatkowe?: Record<string, unknown>) =>
  ({ ok: false, status, kod, komunikat, ...(dodatkowe ? { dodatkowe } : {}) }) as const;

async function istnieja(tx: Db, ids: (number | undefined)[]): Promise<number | null> {
  const wartosci = ids.filter((x): x is number => x !== undefined);
  for (const wid of wartosci) {
    const [w] = await tx.select({ id: userWords.id }).from(userWords).where(eq(userWords.id, wid)).limit(1);
    if (!w) return wid;
  }
  return null;
}

export async function utworzPlan(tx: Transakcja, api: KontekstApi, d: z.output<typeof PlanUtworzSchema>): Promise<WynikPlanu> {
  const [konto] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, d.accountId)).limit(1);
  if (!konto) return odrzuc(422, "unknown_reference", `pole accountId: »${d.accountId}« - nie ma takiego konta (lista: GET /api/v2/meta).`);

  const wszystkie = await tx.select().from(instruments).where(eq(instruments.active, true));
  const mapa = mapujSymbol(d.symbol, wszystkie.map((i) => i.symbol));
  if (!mapa.ok) return odrzuc(422, "unknown_symbol", `pole symbol: ${mapa.error}`);
  const instrument = wszystkie.find((i) => i.symbol === mapa.symbol)!;

  // Poziomy: ta sama regula co CHECK w bazie, ale z komunikatem z wartosciami.
  const dluga = d.direction === "long";
  if (dluga ? d.stopLoss >= d.entryPrice : d.stopLoss <= d.entryPrice) {
    return odrzuc(422, "invalid_levels", `pole stopLoss: ${d.stopLoss} przy wejściu ${d.entryPrice} (${d.direction}). Stop ${dluga ? "long musi być poniżej" : "short musi być powyżej"} ceny wejścia, inaczej plan nie ma zdefiniowanego ryzyka.`);
  }
  if (d.takeProfit != null && (dluga ? d.takeProfit <= d.entryPrice : d.takeProfit >= d.entryPrice)) {
    return odrzuc(422, "invalid_levels", `pole takeProfit: ${d.takeProfit} przy wejściu ${d.entryPrice} (${d.direction}). Cel ${dluga ? "long musi być powyżej" : "short musi być poniżej"} ceny wejścia.`);
  }

  // Ryzyko z computeTrade (jedyny liczacy, ADR-003).
  const wynik = computeTrade({
    instrument: instrumentSpec(instrument),
    direction: d.direction,
    contracts: d.contracts,
    entryPrice: d.entryPrice,
    exits: [],
    stopLoss: d.stopLoss,
    takeProfit: d.takeProfit ?? null,
    mae: null,
    mfe: null,
    entryTime: new Date(),
  });
  if (wynik.riskAmount === null || wynik.riskAmount <= 0) {
    return odrzuc(422, "no_risk", `Plan nie ma policzalnego ryzyka: stop ${d.stopLoss} jest mniej niż jeden tick (${instrument.tickSize}) od wejścia ${d.entryPrice}.`);
  }

  const ostrzezenia: string[] = [];
  let setupId: number | null = null;
  let setupVersionId: number | null = null;
  if (d.setupSlug !== undefined) {
    const [s] = await tx.select().from(setups).where(eq(setups.slug, d.setupSlug)).limit(1);
    if (!s) return odrzuc(422, "unknown_reference", `pole setupSlug: »${d.setupSlug}« - nie ma takiego setupu (lista: GET /api/v2/setups).`);
    if (s.retiredAt) return odrzuc(409, "setup_retired", `Setup »${s.slug}« jest wycofany (${s.retiredAt.toISOString()}), więc nie przyjmuje nowych planów.`);
    setupId = s.id;
    const [obowiazujaca] = await tx.select({ id: setupVersions.id }).from(setupVersions).where(and(eq(setupVersions.setupId, s.id), eq(setupVersions.status, "approved"))).limit(1);
    setupVersionId = obowiazujaca?.id ?? null;
    if (!obowiazujaca) {
      ostrzezenia.push(`Setup »${s.slug}« nie ma jeszcze zatwierdzonej wersji (czeka na decyzję użytkownika), więc plan nie wskazuje wersji setupu.`);
    }
  }

  const brakSlow = await istnieja(tx, [d.thesisWordsId, d.invalidationWordsId]);
  if (brakSlow !== null) return odrzuc(422, "unknown_reference", `Słowa użytkownika #${brakSlow} nie istnieją (zapisz je najpierw przez POST /api/v2/user-words).`);

  if (d.sessionId !== undefined) {
    const [s] = await tx.select({ id: backtestSessions.id }).from(backtestSessions).where(eq(backtestSessions.id, d.sessionId)).limit(1);
    if (!s) return odrzuc(422, "unknown_reference", `pole sessionId: »${d.sessionId}« - nie ma takiej sesji.`);
  }

  let wejscieTradu: Date | null = null;
  if (d.tradeId !== undefined) {
    const spr = await sprawdzTrade(tx, d.tradeId, {
      accountId: d.accountId,
      instrumentId: instrument.id,
      direction: d.direction,
      day: d.day,
    });
    if (!spr.ok) return spr;
    wejscieTradu = spr.entryTime;
  }

  // Idempotencja: ten sam plan wyslany ponownie (retry) to ten sam wiersz. Plan niezmienny nie ma
  // unikatu na tresci, wiec rownolegle ponowienia serializuje blokada doradcza po kluczu tresci.
  const klucz = [d.accountId, instrument.id, d.day, d.direction, d.entryPrice, d.stopLoss, d.takeProfit ?? "", d.contracts, setupId ?? "", d.thesisWordsId ?? "", d.invalidationWordsId ?? "", d.tradeId ?? "", d.sessionId ?? "", d.bias ?? ""].join("|");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.plan:${klucz}`}, 0))`);
  const [istniejacy] = await tx
    .select()
    .from(tradePlans)
    .where(
      and(
        eq(tradePlans.accountId, d.accountId),
        eq(tradePlans.instrumentId, instrument.id),
        eq(tradePlans.day, d.day),
        eq(tradePlans.direction, d.direction),
        sql`${tradePlans.entryPrice} = ${d.entryPrice}::numeric`,
        sql`${tradePlans.stopLoss} = ${d.stopLoss}::numeric`,
        sql`${tradePlans.takeProfit} is not distinct from ${d.takeProfit ?? null}::numeric`,
        sql`${tradePlans.contracts} = ${d.contracts}::numeric`,
        sql`${tradePlans.setupId} is not distinct from ${setupId}`,
        sql`${tradePlans.thesisWordsId} is not distinct from ${d.thesisWordsId ?? null}`,
        sql`${tradePlans.invalidationWordsId} is not distinct from ${d.invalidationWordsId ?? null}`,
        sql`${tradePlans.backtestSessionId} is not distinct from ${d.sessionId ?? null}`,
        sql`${tradePlans.bias} is not distinct from ${d.bias ?? null}`,
        sql`${tradePlans.tradeId} is not distinct from ${d.tradeId ?? null}`,
      ),
    )
    .orderBy(asc(tradePlans.id))
    .limit(1);
  if (istniejacy) return { ok: true, plan: istniejacy, utworzony: false, ostrzezenia };

  const [plan] = await tx
    .insert(tradePlans)
    .values({
      tradeId: d.tradeId ?? null,
      accountId: d.accountId,
      instrumentId: instrument.id,
      backtestSessionId: d.sessionId ?? null,
      day: d.day,
      setupId,
      setupVersionId,
      rulesetVersion: await numerZestawu(tx),
      direction: d.direction,
      bias: d.bias ?? null,
      entryPrice: String(d.entryPrice),
      stopLoss: String(d.stopLoss),
      takeProfit: d.takeProfit == null ? null : String(d.takeProfit),
      contracts: String(d.contracts),
      riskCents: wynik.riskAmount,
      thesisWordsId: d.thesisWordsId ?? null,
      invalidationWordsId: d.invalidationWordsId ?? null,
      // Przez API plan zawsze "przepisalo AI ze slow uzytkownika"; origin `user` jest zarezerwowane dla UI.
      origin: "ai",
      createdByTokenId: api.token.id,
      entryTimeAtAttach: wejscieTradu,
    })
    .returning();

  if (d.tradeId !== undefined) await przepiszNaTrade(tx, plan);
  return { ok: true, plan, utworzony: true, ostrzezenia };
}

type WymaganiaTradu = { accountId: number; instrumentId: number; direction: "long" | "short"; day: string };

async function sprawdzTrade(tx: Db, tradeId: number, w: WymaganiaTradu): Promise<{ ok: true; entryTime: Date } | Extract<WynikPlanu, { ok: false }>> {
  const [t] = await tx
    .select({ id: trades.id, accountId: trades.accountId, instrumentId: trades.instrumentId, direction: trades.direction, tradingDay: trades.tradingDay, entryTime: trades.entryTime })
    .from(trades)
    .where(eq(trades.id, tradeId))
    .limit(1);
  if (!t) return odrzuc(422, "unknown_reference", `pole tradeId: »${tradeId}« - nie ma takiego trade'a (mógł zostać skasowany w aplikacji).`);
  const roznice: string[] = [];
  if (t.accountId !== w.accountId) roznice.push(`konto: plan #${w.accountId}, trade #${t.accountId}`);
  if (t.instrumentId !== w.instrumentId) roznice.push(`instrument: plan #${w.instrumentId}, trade #${t.instrumentId}`);
  if (t.direction !== w.direction) roznice.push(`kierunek: plan ${w.direction}, trade ${t.direction}`);
  if (t.tradingDay !== w.day) roznice.push(`dzień handlowy: plan ${w.day}, trade ${t.tradingDay}`);
  if (roznice.length > 0) {
    return odrzuc(422, "plan_trade_mismatch", `Plan nie pasuje do trade'a #${tradeId} (${roznice.join("; ")}). Plan i trade opisują to samo wejście.`, { differences: roznice });
  }
  const [juz] = await tx.select({ id: tradePlans.id }).from(tradePlans).where(eq(tradePlans.tradeId, tradeId)).limit(1);
  if (juz) return odrzuc(409, "plan_exists", `Trade #${tradeId} ma już zamrożony plan (#${juz.id}). Plan zapisuje się raz, a zmiany idą jako dopiski (POST /api/v2/trade-plans/${juz.id}/addenda).`, { existingPlanId: juz.id });
  return { ok: true, entryTime: t.entryTime };
}

/**
 * Teza planu liczy sie jako »moje slowa« (a wiec zatwierdzenie setupu), tylko gdy KAZDY warunek jest spelniony
 * (audyt, 15.10.2026): rola plan.thesis, slowa o tym trade'cie albo bez trade'a, z dnia planu, zapisane
 * (captured_at) nie pozniej niz teraz i niewykorzystane w innym planie. Inaczej AI mogloby podpiac cudzy
 * lub stary tekst i tym samym obejsc kolejke potwierdzen.
 */
async function tezaToSlowaUzytkownika(tx: Transakcja, plan: Plan): Promise<boolean> {
  if (plan.thesisWordsId === null) return false;
  const [s] = await tx
    .select({ role: userWords.role, tradeId: userWords.tradeId, day: userWords.day, capturedAt: userWords.capturedAt })
    .from(userWords)
    .where(eq(userWords.id, plan.thesisWordsId))
    .limit(1);
  if (!s) return false;
  if (s.role !== "plan.thesis") return false;
  if (s.tradeId !== null && s.tradeId !== plan.tradeId) return false;
  if (s.day !== plan.day) return false;
  if (s.capturedAt.getTime() > Date.now()) return false;
  const [uzyte] = await tx.select({ id: tradePlans.id }).from(tradePlans).where(and(eq(tradePlans.thesisWordsId, plan.thesisWordsId), ne(tradePlans.id, plan.id))).limit(1);
  return !uzyte;
}

/**
 * Plan -> trade: zestaw regul zapisywany RAZ (tylko gdy pole trade'a jest puste).
 *
 * Setup trade'a (a przez niego statystyki setupu) wchodzi od razu WYLACZNIE wtedy, gdy wynika z planu
 * zamrozonego PRZED wejsciem, ktorego teza to slowa uzytkownika (Slowa uzytkownika 15.10.2026:
 * «Plan z moich slow = zatwierdzenie»). Kazde inne przypisanie przez AI idzie kolejka potwierdzen
 * (ai_suggestions, rodzaj trade_setup) i liczy sie dopiero po zatwierdzeniu w UI.
 */
async function przepiszNaTrade(tx: Transakcja, plan: Plan): Promise<void> {
  if (plan.tradeId === null) return;
  const [tr] = await tx.select({ entryTime: trades.entryTime, setupId: trades.setupId }).from(trades).where(eq(trades.id, plan.tradeId)).limit(1);
  if (!tr) return;
  // Porownujemy z czasem wejscia zapamietanym przy PRZYPIECIU (pierwszy zapis), nie z biezacym entry_time:
  // pozniejsza edycja wejscia nie przesuwa trade'a miedzy »przed planem« i »po planie« (audyt, 15.10.2026).
  const wejscie = plan.entryTimeAtAttach ?? tr.entryTime;
  const przedWejsciem = plan.frozenAt.getTime() <= wejscie.getTime();
  const zSlowUzytkownika = przedWejsciem && (await tezaToSlowaUzytkownika(tx, plan));

  await tx
    .update(trades)
    .set({
      ...(zSlowUzytkownika
        ? {
            setupId: sql`coalesce(${trades.setupId}, ${plan.setupId})`,
            setupVersionId: sql`coalesce(${trades.setupVersionId}, ${plan.setupVersionId})`,
          }
        : {}),
      rulesetVersion: sql`coalesce(${trades.rulesetVersion}, ${plan.rulesetVersion})`,
    })
    .where(eq(trades.id, plan.tradeId));

  if (!zSlowUzytkownika && plan.setupId !== null && tr.setupId === null) {
    const [setup] = await tx.select({ slug: setups.slug }).from(setups).where(eq(setups.id, plan.setupId)).limit(1);
    if (!setup) return;
    // Wersja obowiazujaca w chwili wejscia trade'a, zapisana w sugestii: zatwierdzenie dni pozniej nie podmieni jej na nowsza.
    const payload = { setupSlug: setup.slug, setupId: plan.setupId, setupVersionId: await wersjaSetupuNaChwile(tx, plan.setupId, wejscie) };
    const cel = { type: "trade", id: plan.tradeId };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.suggestion:trade_setup:${plan.tradeId}`}, 0))`);
    const [juz] = await tx
      .select({ id: aiSuggestions.id })
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.kind, "trade_setup"), sql`${aiSuggestions.target} = ${JSON.stringify(cel)}::jsonb`, sql`${aiSuggestions.payload} = ${JSON.stringify(payload)}::jsonb`))
      .limit(1);
    if (!juz) {
      await tx.insert(aiSuggestions).values({
        kind: "trade_setup",
        target: cel,
        payload,
        claim: `Plan #${plan.id} wskazuje setup »${setup.slug}« dla trade'a #${plan.tradeId}, ale ${plan.thesisWordsId === null ? "plan nie ma tezy ze słów użytkownika" : !przedWejsciem ? "plan powstał po wejściu" : "teza planu nie spełnia warunków »moich słów« (rola plan.thesis, ten trade lub brak, dzień planu, niewykorzystana w innym planie)"}, więc przypisanie czeka na Twoje zatwierdzenie.`,
        evidence: [{ type: "trade_plan", ref: plan.id, note: "przypisanie setupu z planu bez słów użytkownika przed wejściem" }],
        evidenceLevel: "inferred",
        n: null,
        createdByTokenId: plan.createdByTokenId,
        status: "pending",
      });
    }
  }
}

export async function przypnijPlan(tx: Transakcja, planId: number, tradeId: number): Promise<WynikPlanu> {
  const [plan] = await tx.select().from(tradePlans).where(eq(tradePlans.id, planId)).for("update").limit(1);
  if (!plan) return odrzuc(404, "not_found", `Plan #${planId} nie istnieje.`);
  if (plan.tradeId === tradeId) return { ok: true, plan, utworzony: false, ostrzezenia: [] };
  if (plan.tradeId !== null) {
    return odrzuc(409, "plan_attached", `Plan #${planId} jest już przypięty do trade'a #${plan.tradeId}. Przypięcie wykonuje się raz.`, { tradeId: plan.tradeId });
  }
  const spr = await sprawdzTrade(tx, tradeId, { accountId: plan.accountId, instrumentId: plan.instrumentId, direction: plan.direction, day: plan.day });
  if (!spr.ok) return spr;
  const [po] = await tx.update(tradePlans).set({ tradeId, entryTimeAtAttach: spr.entryTime }).where(and(eq(tradePlans.id, planId), isNull(tradePlans.tradeId))).returning();
  if (!po) return odrzuc(409, "plan_attached", `Plan #${planId} został przypięty równolegle. Odczytaj go ponownie.`);
  await przepiszNaTrade(tx, po);
  return { ok: true, plan: po, utworzony: false, ostrzezenia: [] };
}

export async function dopiszDoPlanu(
  tx: Transakcja,
  planId: number,
  d: z.output<typeof PlanDopisekSchema>,
): Promise<{ ok: true; dopisek: typeof tradePlanAddenda.$inferSelect; utworzony: boolean } | Extract<WynikPlanu, { ok: false }>> {
  const [plan] = await tx.select({ id: tradePlans.id }).from(tradePlans).where(eq(tradePlans.id, planId)).limit(1);
  if (!plan) return odrzuc(404, "not_found", `Plan #${planId} nie istnieje.`);
  const brak = await istnieja(tx, [d.wordsId]);
  if (brak !== null) return odrzuc(422, "unknown_reference", `pole wordsId: słowa użytkownika #${brak} nie istnieją (zapisz je najpierw przez POST /api/v2/user-words).`);
  // Idempotencja (review P5): ten sam dopisek (plan, pole, wartosc, slowa) wyslany ponownie to ten sam wiersz (200).
  const nowaWartosc = d.newValue === undefined ? null : d.newValue;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.planadd:${planId}:${d.field ?? ""}:${d.wordsId}:${JSON.stringify(nowaWartosc)}`}, 0))`);
  const [juz] = await tx
    .select()
    .from(tradePlanAddenda)
    .where(
      and(
        eq(tradePlanAddenda.planId, planId),
        sql`${tradePlanAddenda.field} is not distinct from ${d.field ?? null}`,
        eq(tradePlanAddenda.wordsId, d.wordsId),
        sql`${tradePlanAddenda.newValue} is not distinct from ${JSON.stringify(nowaWartosc)}::jsonb`,
      ),
    )
    .limit(1);
  if (juz) return { ok: true, dopisek: juz, utworzony: false };
  const [dopisek] = await tx
    .insert(tradePlanAddenda)
    .values({ planId, field: d.field ?? null, newValue: nowaWartosc, wordsId: d.wordsId })
    .returning();
  return { ok: true, dopisek, utworzony: true };
}

export function zDopiska(a: typeof tradePlanAddenda.$inferSelect) {
  return { id: a.id, planId: a.planId, field: a.field, newValue: a.newValue ?? null, wordsId: a.wordsId, createdAt: a.createdAt.toISOString() };
}

export async function szczegolyPlanu(tx: Db, planId: number) {
  const [p] = await tx.select().from(tradePlans).where(eq(tradePlans.id, planId)).limit(1);
  if (!p) return null;
  const wszystkieDopiski = await tx.select().from(tradePlanAddenda).where(eq(tradePlanAddenda.planId, planId)).orderBy(asc(tradePlanAddenda.id));
  // Slepa ocena: dopiski powstaja po zamrozeniu planu, czesto w trakcie trade'a (»SL na BE po +1R«). Gdy wynik trade'a jest
  // ukryty, wychodza tylko dopiski sprzed wejscia (review 15.10.2026).
  let dopiski = wszystkieDopiski;
  if (p.tradeId !== null && (await czyWynikUkryty(tx, p.tradeId))) {
    const wejscie = await wejscieTradu(tx, p.tradeId);
    dopiski = wejscie === null ? [] : wszystkieDopiski.filter((a) => a.createdAt.getTime() <= wejscie.getTime());
  }
  const idsSlow = [p.thesisWordsId, p.invalidationWordsId, ...dopiski.map((a) => a.wordsId)].filter((x): x is number => x !== null);
  const slowa = idsSlow.length
    ? await tx
        .select({ id: userWords.id, text: userWords.text, sha256: userWords.sha256 })
        .from(userWords)
        .where(sql`${userWords.id} in (${sql.join(idsSlow.map((i) => sql`${i}`), sql`, `)})`)
    : [];
  const slowaPoId = new Map(slowa.map((s) => [s.id, s]));
  const [setup] = p.setupId ? await tx.select({ slug: setups.slug, name: setups.name }).from(setups).where(eq(setups.id, p.setupId)).limit(1) : [];
  const [wersja] = p.setupVersionId ? await tx.select({ version: setupVersions.version }).from(setupVersions).where(eq(setupVersions.id, p.setupVersionId)).limit(1) : [];
  return {
    ...zPlanu(p),
    setup: setup ? { slug: setup.slug, name: setup.name, version: wersja?.version ?? null } : null,
    thesis: p.thesisWordsId ? (slowaPoId.get(p.thesisWordsId) ?? null) : null,
    invalidation: p.invalidationWordsId ? (slowaPoId.get(p.invalidationWordsId) ?? null) : null,
    addenda: dopiski.map((a) => ({ ...zDopiska(a), words: slowaPoId.get(a.wordsId) ?? null })),
  };
}

export async function listaPlanow(tx: Db, f: z.output<typeof PlanyListaQuery>) {
  const warunki: SQL[] = [gt(tradePlans.id, f.after)];
  if (f.tradeId) warunki.push(eq(tradePlans.tradeId, f.tradeId));
  if (f.accountId) warunki.push(eq(tradePlans.accountId, f.accountId));
  if (f.day) warunki.push(eq(tradePlans.day, f.day));
  const wiersze = await tx.select().from(tradePlans).where(and(...warunki)).orderBy(asc(tradePlans.id)).limit(f.limit + 1);
  const maWiecej = wiersze.length > f.limit;
  const strona = wiersze.slice(0, f.limit);
  return { plans: strona.map(zPlanu), nextAfter: maWiecej ? strona[strona.length - 1].id : null };
}

/** Plan trade'a (do GET /trades/:id i dyscypliny). */
export async function planTradu(tx: Db, tradeId: number) {
  const [p] = await tx.select({ id: tradePlans.id }).from(tradePlans).where(eq(tradePlans.tradeId, tradeId)).orderBy(desc(tradePlans.id)).limit(1);
  return p ? szczegolyPlanu(tx, p.id) : null;
}
