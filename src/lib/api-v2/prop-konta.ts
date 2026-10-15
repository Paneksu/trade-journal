import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, max, min, ne, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { accounts, instruments, propFirmPresets, propLedger, propRules, settings, tradePlans, trades } from "@/lib/db/schema";
import { tradingDay } from "@/lib/domain/calc";
import {
  lacznaEkspozycjaNq,
  ostrzejszeZasady,
  ostrzezenieKontraktow,
  stanKonta,
  type EkspozycjaNq,
  type TransakcjaKonta,
  type ZasadyKonta,
} from "@/lib/domain/prop";

import type {
  PropKsiegaWpisSchema,
  PropPresetyQuery,
  PropRegulyUtworzSchema,
  PropStatusQuery,
} from "./contract/funkcje";
import { bezOk } from "./http";
import { ekspozycjaDoApi, stanKontaDoApi } from "./mapowanie";
import type { Transakcja } from "./with-api";

/**
 * Modul prop (ADR-033, MUST 7; metodyka R29): presety jako dane, reguly per konto
 * z data obowiazywania (kazda wartosc nadpisywalna), bufory, ksiega kosztow i
 * wyplat. Tylko ostrzezenia - zadnych blokad (AI nie sklada zlecen).
 */

type Db = Transakcja | typeof import("@/lib/db").db;
type Preset = typeof propFirmPresets.$inferSelect;
type Regula = typeof propRules.$inferSelect;

const DZIEN_MS = 86_400_000;

export function zPresetu(p: Preset, teraz: Date = new Date()) {
  const odczyt = new Date(`${p.readOn}T00:00:00Z`).getTime();
  return {
    id: p.id,
    firm: p.firm,
    program: p.program,
    phase: p.phase,
    accountSizeCents: p.accountSizeCents,
    ddType: p.ddType,
    maxDdCents: p.maxDdCents,
    ddLockCents: p.ddLockCents,
    dailyLossCents: p.dailyLossCents,
    profitTargetCents: p.profitTargetCents,
    consistencyPct: p.consistencyPct === null ? null : Number(p.consistencyPct),
    minDays: p.minDays,
    maxContractsMini: p.maxContractsMini,
    maxContractsMicro: p.maxContractsMicro,
    sourceUrl: p.sourceUrl,
    readOn: p.readOn,
    /** Wiek presetu w dniach: regulaminy zmieniaja sie co kilka miesiecy, wiec UI pokazuje go przy kazdym presecie. */
    ageDays: Math.max(0, Math.floor((teraz.getTime() - odczyt) / DZIEN_MS)),
    effectiveFrom: p.effectiveFrom,
    needsVerification: p.needsVerification,
    extra: p.extra,
    notes: p.notes,
  };
}

export async function listaPresetow(tx: Db, q: z.output<typeof PropPresetyQuery>) {
  const warunki: SQL[] = [];
  if (q.firm) warunki.push(sql`lower(${propFirmPresets.firm}) = lower(${q.firm})`);
  if (q.phase) warunki.push(eq(propFirmPresets.phase, q.phase));
  if (q.accountSizeCents) warunki.push(eq(propFirmPresets.accountSizeCents, q.accountSizeCents));
  const wiersze = await tx
    .select()
    .from(propFirmPresets)
    .where(warunki.length ? and(...warunki) : undefined)
    .orderBy(asc(propFirmPresets.firm), asc(propFirmPresets.program), asc(propFirmPresets.phase), asc(propFirmPresets.accountSizeCents), desc(propFirmPresets.readOn));
  const teraz = new Date();
  return { presets: wiersze.map((p) => zPresetu(p, teraz)), count: wiersze.length };
}

export function zRegulyKonta(r: Regula, preset: Preset | null, teraz: Date = new Date()) {
  return {
    id: r.id,
    accountId: r.accountId,
    presetId: r.presetId,
    validFrom: r.validFrom,
    ddType: r.ddType,
    maxDdCents: r.maxDdCents,
    ddLockCents: r.ddLockCents,
    dailyLossCents: r.dailyLossCents,
    profitTargetCents: r.profitTargetCents,
    consistencyPct: r.consistencyPct === null ? null : Number(r.consistencyPct),
    minDays: r.minDays,
    maxContractsMini: r.maxContractsMini,
    maxContractsMicro: r.maxContractsMicro,
    sourceUrl: r.sourceUrl,
    extra: r.extra,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    preset: preset
      ? {
          firm: preset.firm,
          program: preset.program,
          phase: preset.phase,
          readOn: preset.readOn,
          ageDays: zPresetu(preset, teraz).ageDays,
          needsVerification: preset.needsVerification,
        }
      : null,
  };
}

export function naZasady(r: Regula): ZasadyKonta {
  return {
    ddType: r.ddType,
    maxDdCents: r.maxDdCents,
    ddLockCents: r.ddLockCents,
    dailyLossCents: r.dailyLossCents,
    profitTargetCents: r.profitTargetCents,
    consistencyPct: r.consistencyPct === null ? null : Number(r.consistencyPct),
    minDays: r.minDays,
    maxContractsMini: r.maxContractsMini,
    maxContractsMicro: r.maxContractsMicro,
    extra: r.extra,
  };
}

export type BladProp = { ok: false; status: 404 | 409 | 422; kod: string; komunikat: string; dodatkowe?: Record<string, unknown> };
const odrzuc = (status: 404 | 409 | 422, kod: string, komunikat: string, dodatkowe?: Record<string, unknown>): BladProp => ({ ok: false, status, kod, komunikat, ...(dodatkowe ? { dodatkowe } : {}) });

async function kontoProp(tx: Db, accountId: number) {
  const [k] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!k) return odrzuc(404, "not_found", `Konto #${accountId} nie istnieje (lista: GET /api/v2/meta).`);
  if (k.type !== "prop") {
    return odrzuc(422, "not_prop_account", `Konto #${accountId} (${k.name}) ma typ »${k.type}«, a reguły prop przypina się tylko do kont typu »prop«. Zmień typ konta w aplikacji (Ustawienia → Konta).`);
  }
  return { ok: true as const, konto: k };
}

export async function przypnijReguly(
  tx: Transakcja,
  accountId: number,
  d: z.output<typeof PropRegulyUtworzSchema>,
): Promise<{ ok: true; regula: ReturnType<typeof zRegulyKonta> } | BladProp> {
  const k = await kontoProp(tx, accountId);
  if (!k.ok) return k;

  let preset: Preset | null = null;
  if (d.presetId !== undefined) {
    [preset] = await tx.select().from(propFirmPresets).where(eq(propFirmPresets.id, d.presetId)).limit(1);
    if (!preset) return odrzuc(422, "unknown_reference", `pole presetId: »${d.presetId}« - nie ma takiego presetu (lista: GET /api/v2/prop/presets).`);
  }
  const wybierz = <K extends keyof Preset & keyof typeof d>(klucz: K): unknown => (d[klucz] !== undefined ? d[klucz] : preset ? preset[klucz] : null);

  const ddType = (d.ddType ?? preset?.ddType) as Regula["ddType"];
  const maxDdCents = (d.maxDdCents ?? preset?.maxDdCents) as number;
  const ddLockCents = wybierz("ddLockCents") as number | null;
  if (ddType === "trailing_to_static" && ddLockCents === null) {
    return odrzuc(422, "dd_lock_required", `Typ DD »trailing_to_static« wymaga ddLockCents (zysk w centach, przy którym próg DD przestaje rosnąć). Preset ${preset ? `#${preset.id}` : "(brak)"} go nie podaje: wpisz wartość z regulaminu.`);
  }
  const [istnieje] = await tx.select({ id: propRules.id }).from(propRules).where(and(eq(propRules.accountId, accountId), eq(propRules.validFrom, d.validFrom))).limit(1);
  if (istnieje) {
    return odrzuc(409, "rules_exist", `Konto #${accountId} ma już reguły obowiązujące od ${d.validFrom} (#${istnieje.id}). Podaj inną datę obowiązywania (np. dzień zmiany regulaminu) albo popraw istniejące w aplikacji.`, { existingId: istnieje.id });
  }
  const consistency = wybierz("consistencyPct");
  const [wiersz] = await tx
    .insert(propRules)
    .values({
      accountId,
      presetId: preset?.id ?? null,
      validFrom: d.validFrom,
      ddType,
      maxDdCents,
      ddLockCents,
      dailyLossCents: wybierz("dailyLossCents") as number | null,
      profitTargetCents: wybierz("profitTargetCents") as number | null,
      consistencyPct: consistency === null || consistency === undefined ? null : String(consistency),
      minDays: wybierz("minDays") as number | null,
      maxContractsMini: wybierz("maxContractsMini") as number | null,
      maxContractsMicro: wybierz("maxContractsMicro") as number | null,
      sourceUrl: (d.sourceUrl !== undefined ? d.sourceUrl : (preset?.sourceUrl ?? null)) as string | null,
      extra: { ...(preset?.extra ?? {}), ...(d.extra ?? {}) },
      // Potwierdzenie z regulaminem (R29) robi uzytkownik w aplikacji, nie klient API.
      confirmedAt: null,
    })
    .returning();
  return { ok: true, regula: zRegulyKonta(wiersz, preset) };
}

/** Reguly obowiazujace w danym dniu: najnowsza z validFrom <= dzien. */
export async function regulyNaDzien(tx: Db, accountId: number, dzien: string): Promise<{ regula: Regula; preset: Preset | null } | null> {
  const [r] = await tx
    .select()
    .from(propRules)
    .where(and(eq(propRules.accountId, accountId), lte(propRules.validFrom, dzien)))
    .orderBy(desc(propRules.validFrom))
    .limit(1);
  if (!r) return null;
  const [p] = r.presetId ? await tx.select().from(propFirmPresets).where(eq(propFirmPresets.id, r.presetId)).limit(1) : [];
  return { regula: r, preset: p ?? null };
}

export async function listaRegulKonta(tx: Db, accountId: number) {
  const k = await kontoProp(tx, accountId);
  if (!k.ok) return k;
  const wiersze = await tx.select().from(propRules).where(eq(propRules.accountId, accountId)).orderBy(desc(propRules.validFrom));
  const presety = new Map<number, Preset>();
  for (const w of wiersze) {
    if (w.presetId !== null && !presety.has(w.presetId)) {
      const [p] = await tx.select().from(propFirmPresets).where(eq(propFirmPresets.id, w.presetId)).limit(1);
      if (p) presety.set(p.id, p);
    }
  }
  const teraz = new Date();
  return { ok: true as const, rules: wiersze.map((w) => zRegulyKonta(w, w.presetId ? (presety.get(w.presetId) ?? null) : null, teraz)) };
}

/** Dzien handlowy »dzisiaj« wg zegara gieldy NQ (sesja CME zaczyna sie o 18:00 ET). */
export function dzienHandlowyTeraz(teraz: Date = new Date()): string {
  return tradingDay(teraz, "America/New_York");
}

async function transakcjeKonta(tx: Db, accountId: number, odDnia: string, doDnia: string): Promise<TransakcjaKonta[]> {
  const wiersze = await tx
    .select({ dzien: trades.tradingDay, exitTime: trades.exitTime, entryTime: trades.entryTime, pnl: trades.pnl })
    .from(trades)
    .where(and(eq(trades.accountId, accountId), eq(trades.status, "closed"), isNull(trades.backtestSessionId), gte(trades.tradingDay, odDnia), lte(trades.tradingDay, doDnia)))
    .orderBy(asc(trades.tradingDay), asc(trades.exitTime), asc(trades.id));
  const wynik: TransakcjaKonta[] = [];
  for (const w of wiersze) {
    if (w.pnl !== null && w.dzien !== null) wynik.push({ dzien: w.dzien, czas: w.exitTime ?? w.entryTime, pnlCents: Number(w.pnl) });
  }
  return wynik;
}

export type StatusKontaWynik = {
  ok: true;
  accountId: number;
  accountName: string;
  currency: string;
  day: string;
  rules: ReturnType<typeof zRegulyKonta>;
  rulesConfirmed: boolean;
  rulesUsed: {
    source: "confirmed" | "unconfirmed_only" | "stricter_of_confirmed_and_unconfirmed";
    confirmedRuleId: number | null;
    ddType: Regula["ddType"];
    maxDdCents: number;
    ddLockCents: number | null;
    dailyLossCents: number | null;
    profitTargetCents: number | null;
    consistencyPct: number | null;
    minDays: number | null;
    maxContractsMini: number | null;
    maxContractsMicro: number | null;
  };
  rulesNote: string | null;
  riskSource: "query" | "plan" | "default" | null;
  state: ReturnType<typeof stanKontaDoApi>;
  contractWarnings: { level: number; text: string }[];
};

export async function statusKonta(tx: Db, accountId: number, q: z.output<typeof PropStatusQuery>): Promise<StatusKontaWynik | BladProp> {
  const k = await kontoProp(tx, accountId);
  if (!k.ok) return k;
  const dzien = q.day ?? dzienHandlowyTeraz();
  const obowiazujace = await regulyNaDzien(tx, accountId, dzien);
  if (!obowiazujace) {
    return odrzuc(422, "no_rules", `Konto #${accountId} (${k.konto.name}) nie ma reguł prop obowiązujących w dniu ${dzien}. Przypnij preset: POST /api/v2/prop/accounts/${accountId}/rules (presety: GET /api/v2/prop/presets).`);
  }
  // Poczatek historii liczymy z regul POTWIERDZONYCH i tej jednej obowiazujacej (nawet niepotwierdzonej): agent nie moze
  // cofnac historii konta, dopisujac niepotwierdzona regule ze stara data validFrom.
  const [{ od: odPotwierdzonych }] = await tx.select({ od: min(propRules.validFrom) }).from(propRules).where(and(eq(propRules.accountId, accountId), isNotNull(propRules.confirmedAt)));
  const od = odPotwierdzonych !== null && odPotwierdzonych < obowiazujace.regula.validFrom ? odPotwierdzonych : obowiazujace.regula.validFrom;
  // Stan na dzien `dzien`: pozniejsze trade'y nie moga wplywac na status "z przeszlosci" (review P3).
  const transakcje = await transakcjeKonta(tx, accountId, od, dzien);
  const [wyplata] = await tx.select({ d: max(propLedger.occurredOn) }).from(propLedger).where(and(eq(propLedger.accountId, accountId), eq(propLedger.kind, "payout"), lte(propLedger.occurredOn, dzien))); // wyplata PO dniu statusu nie moze wplywac na status z przeszlosci

  let ryzyko: number | null = null;
  let zrodloRyzyka: StatusKontaWynik["riskSource"] = null;
  if (q.riskCents !== undefined) {
    ryzyko = q.riskCents;
    zrodloRyzyka = "query";
  } else if (q.planId !== undefined) {
    const [p] = await tx.select({ risk: tradePlans.riskCents, accountId: tradePlans.accountId }).from(tradePlans).where(eq(tradePlans.id, q.planId)).limit(1);
    if (!p) return odrzuc(404, "not_found", `Plan #${q.planId} nie istnieje.`);
    if (p.accountId !== accountId) return odrzuc(422, "plan_account_mismatch", `Plan #${q.planId} dotyczy konta #${p.accountId}, a pytasz o konto #${accountId}.`);
    ryzyko = p.risk;
    zrodloRyzyka = "plan";
  } else {
    const [s] = await tx.select({ r: settings.defaultRisk }).from(settings).where(eq(settings.id, 1)).limit(1);
    const domyslne = k.konto.defaultRiskAmount ?? s?.r ?? null;
    if (domyslne !== null && domyslne > 0) {
      ryzyko = domyslne;
      zrodloRyzyka = "default";
    }
  }

  // Niepotwierdzone reguly (confirmed_at null): liczymy na OSTRZEJSZEJ z dwoch, ostatniej potwierdzonej i nowej,
  // pole po polu (Slowa uzytkownika 15.10.2026: «Licz na ostrzejszej», doprecyzowane «Zawsze bezpieczniej dla mnie»: cel od WIEKSZEGO, consistency od MNIEJSZEGO). Potwierdza je uzytkownik w aplikacji.
  const rulesConfirmed = obowiazujace.regula.confirmedAt !== null;
  let zasady = naZasady(obowiazujace.regula);
  let zrodloZasad: StatusKontaWynik["rulesUsed"]["source"] = "confirmed";
  let idPotwierdzonej: number | null = rulesConfirmed ? obowiazujace.regula.id : null;
  let notatkaZasad: string | null = null;
  if (!rulesConfirmed) {
    const [potw] = await tx
      .select()
      .from(propRules)
      .where(and(eq(propRules.accountId, accountId), lte(propRules.validFrom, dzien), isNotNull(propRules.confirmedAt), ne(propRules.id, obowiazujace.regula.id)))
      .orderBy(desc(propRules.validFrom))
      .limit(1);
    if (potw) {
      zasady = ostrzejszeZasady(naZasady(potw), zasady).zasady;
      zrodloZasad = "stricter_of_confirmed_and_unconfirmed";
      idPotwierdzonej = potw.id;
      notatkaZasad = `Reguły od ${obowiazujace.regula.validFrom} (#${obowiazujace.regula.id}) nie są potwierdzone w aplikacji, więc bufory liczę na ostrzejszej z dwóch: ostatniej potwierdzonej (od ${potw.validFrom}, #${potw.id}) i nowej. Potwierdź je w »Do decyzji«, gdy sprawdzisz regulamin.`;
    } else {
      zrodloZasad = "unconfirmed_only";
      // Same niepotwierdzone reguly: bierzemy NAJOSTRZEJSZA ze wszystkich obowiazujacych do dnia statusu («Zawsze bezpieczniej dla mnie»,
      // Slowa uzytkownika 15.10.2026), nie tylko najnowsza.
      const inne = await tx
        .select()
        .from(propRules)
        .where(and(eq(propRules.accountId, accountId), lte(propRules.validFrom, dzien), isNull(propRules.confirmedAt), ne(propRules.id, obowiazujace.regula.id)))
        .orderBy(asc(propRules.validFrom));
      for (const r of inne) zasady = ostrzejszeZasady(naZasady(r), zasady).zasady;
      notatkaZasad = inne.length > 0
        ? `Reguły konta nie są potwierdzone w aplikacji (obowiązujące od ${obowiazujace.regula.validFrom}, #${obowiazujace.regula.id}, oraz wcześniejsze: ${inne.map((r) => `#${r.id}`).join(", ")}), a potwierdzonych brak, więc liczę na najostrzejszej ze wszystkich. Sprawdź regulamin i potwierdź je w »Do decyzji«.`
        : `Reguły od ${obowiazujace.regula.validFrom} (#${obowiazujace.regula.id}) nie są potwierdzone w aplikacji, a wcześniejszych potwierdzonych brak, więc liczę na nich. Sprawdź regulamin i potwierdź je w »Do decyzji«.`;
    }
  }

  const stan = stanKonta({
    zasady,
    saldoStartCents: k.konto.startingBalance,
    transakcje,
    dzis: dzien,
    ryzykoPlanuCents: ryzyko,
    ostatniaWyplata: wyplata?.d ?? null,
  });

  // Ekspozycja i limity kontraktow: otwarte pozycje tego konta.
  const otwarte = await tx
    .select({ symbol: instruments.symbol, contracts: trades.contracts })
    .from(trades)
    .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
    .where(and(eq(trades.accountId, accountId), eq(trades.status, "open")));
  const eks = lacznaEkspozycjaNq(otwarte.map((o) => ({ accountId, symbol: o.symbol, contracts: Number(o.contracts) })));
  const kont = eks.perKonto[0];
  const ostrz = ostrzezenieKontraktow(zasady, kont?.kontraktyNq ?? 0, kont?.kontraktyMnq ?? 0);

  return {
    ok: true,
    accountId,
    accountName: k.konto.name,
    currency: k.konto.currency,
    day: dzien,
    rules: zRegulyKonta(obowiazujace.regula, obowiazujace.preset),
    rulesConfirmed,
    rulesUsed: {
      source: zrodloZasad,
      confirmedRuleId: idPotwierdzonej,
      ddType: zasady.ddType,
      maxDdCents: zasady.maxDdCents,
      ddLockCents: zasady.ddLockCents,
      dailyLossCents: zasady.dailyLossCents,
      profitTargetCents: zasady.profitTargetCents,
      consistencyPct: zasady.consistencyPct,
      minDays: zasady.minDays,
      maxContractsMini: zasady.maxContractsMini,
      maxContractsMicro: zasady.maxContractsMicro,
    },
    rulesNote: notatkaZasad,
    riskSource: zrodloRyzyka,
    state: stanKontaDoApi(stan),
    contractWarnings: ostrz ? [{ level: ostrz.poziom, text: ostrz.tekst }] : [],
  };
}

/** Wszystkie konta prop z regulami: status kazdego + laczna ekspozycja NQ (otwarte pozycje i dzisiejsze plany bez trade'u). */
export async function przegladProp(tx: Db, dzien: string) {
  const konta = await tx.select().from(accounts).where(and(eq(accounts.type, "prop"), eq(accounts.archived, false))).orderBy(asc(accounts.sortOrder), asc(accounts.id));
  const statusy: (StatusKontaWynik | { accountId: number; accountName: string; error: string; code: string })[] = [];
  for (const k of konta) {
    const s = await statusKonta(tx, k.id, { day: dzien });
    statusy.push(s.ok ? s : { accountId: k.id, accountName: k.name, error: s.komunikat, code: s.kod });
  }
  const idsKont = konta.map((k) => k.id);
  const pozycje: { accountId: number; symbol: string; contracts: number }[] = [];
  if (idsKont.length > 0) {
    const otwarte = await tx
      .select({ accountId: trades.accountId, symbol: instruments.symbol, contracts: trades.contracts })
      .from(trades)
      .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
      .where(and(eq(trades.status, "open"), sql`${trades.accountId} in (${sql.join(idsKont.map((i) => sql`${i}`), sql`, `)})`));
    for (const o of otwarte) pozycje.push({ accountId: o.accountId, symbol: o.symbol, contracts: Number(o.contracts) });
    const plany = await tx
      .select({ accountId: tradePlans.accountId, symbol: instruments.symbol, contracts: tradePlans.contracts })
      .from(tradePlans)
      .innerJoin(instruments, eq(tradePlans.instrumentId, instruments.id))
      .where(and(eq(tradePlans.day, dzien), isNull(tradePlans.tradeId), sql`${tradePlans.accountId} in (${sql.join(idsKont.map((i) => sql`${i}`), sql`, `)})`));
    for (const p of plany) pozycje.push({ accountId: p.accountId, symbol: p.symbol, contracts: Number(p.contracts) });
  }
  const ekspozycja: EkspozycjaNq = lacznaEkspozycjaNq(pozycje);
  return { day: dzien, accounts: statusy.map((s) => ("ok" in s ? bezOk(s) : s)), exposureNq: ekspozycjaDoApi(ekspozycja) };
}

/* --- Ksiega kosztow i wyplat -------------------------------------------------------------- */

export function zWpisuKsiegi(w: typeof propLedger.$inferSelect) {
  return { id: w.id, accountId: w.accountId, kind: w.kind, amountCents: w.amountCents, occurredOn: w.occurredOn, note: w.note, createdAt: w.createdAt.toISOString() };
}

export async function ksiegaKonta(tx: Db, accountId: number) {
  const [k] = await tx.select({ id: accounts.id, name: accounts.name, type: accounts.type }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!k) return odrzuc(404, "not_found", `Konto #${accountId} nie istnieje.`);
  const wpisy = await tx.select().from(propLedger).where(eq(propLedger.accountId, accountId)).orderBy(desc(propLedger.occurredOn), desc(propLedger.id));
  const poRodzajach: Record<string, number> = {};
  let kosztyCents = 0;
  let wplywyCents = 0;
  for (const w of wpisy) {
    poRodzajach[w.kind] = (poRodzajach[w.kind] ?? 0) + w.amountCents;
    if (w.amountCents < 0) kosztyCents += w.amountCents;
    else wplywyCents += w.amountCents;
  }
  return {
    ok: true as const,
    accountId,
    entries: wpisy.map(zWpisuKsiegi),
    summary: {
      costsCents: kosztyCents,
      inflowsCents: wplywyCents,
      /** Realny zwrot netto: wyplaty i zwroty minus wszystkie koszty (evale, resety, aktywacje, abonamenty). */
      netCents: kosztyCents + wplywyCents,
      byKind: poRodzajach,
    },
  };
}

export async function dodajWpisKsiegi(
  tx: Transakcja,
  accountId: number,
  d: z.output<typeof PropKsiegaWpisSchema>,
): Promise<{ ok: true; wpis: ReturnType<typeof zWpisuKsiegi>; utworzony: boolean } | BladProp> {
  const [k] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!k) return odrzuc(404, "not_found", `Konto #${accountId} nie istnieje.`);
  const wplyw = d.kind === "payout" || d.kind === "refund";
  if (d.kind !== "other" && wplyw !== d.amountCents > 0) {
    return odrzuc(422, "invalid_sign", `pole amountCents: ${d.amountCents} dla rodzaju »${d.kind}«. ${wplyw ? "Wypłata i zwrot to wpływ, więc kwota jest dodatnia" : "Koszt (eval, reset, aktywacja, abonament, dane) ma kwotę ujemną"}.`);
  }
  // Zabezpieczenie przed podwojnym wyslaniem: identyczny wpis z ostatniej minuty to ten sam wpis.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.ledger:${accountId}:${d.kind}:${d.amountCents}:${d.occurredOn}`}, 0))`);
  const [duplikat] = await tx
    .select()
    .from(propLedger)
    .where(
      and(
        eq(propLedger.accountId, accountId),
        eq(propLedger.kind, d.kind),
        eq(propLedger.amountCents, d.amountCents),
        eq(propLedger.occurredOn, d.occurredOn),
        sql`${propLedger.note} is not distinct from ${d.note ?? null}`,
        sql`${propLedger.createdAt} > now() - interval '1 minute'`,
      ),
    )
    .limit(1);
  if (duplikat) return { ok: true, wpis: zWpisuKsiegi(duplikat), utworzony: false };
  const [w] = await tx.insert(propLedger).values({ accountId, kind: d.kind, amountCents: d.amountCents, occurredOn: d.occurredOn, note: d.note ?? null }).returning();
  return { ok: true, wpis: zWpisuKsiegi(w), utworzony: true };
}
