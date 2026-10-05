import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accounts,
  backtestSessions,
  ingestSkips,
  instruments,
  tagCategories,
  tags,
  trades,
} from "@/lib/db/schema";
import type { TradeDraft } from "@/lib/domain/trade-draft";
import { mapujSymbol } from "@/lib/domain/tradingview";
import { persistTrade, type PodgladZapisu } from "@/lib/trades/persist";

import { KopertaTradowSchema, opiszBledyZod, TradeSchema, zrodloZRef, type IngestTrade } from "./schema";
import type { z } from "zod";

/**
 * Zapis tradow z API (ADR-026). Kazda pozycja paczki jest niezalezna: jedna
 * zla nie blokuje reszty, a wynik wraca per pozycja.
 *
 * Wynik pozycji:
 *   created    - nowy wiersz
 *   updated    - istniejacy podmieniony (tylko mode=update)
 *   unchanged  - nic do zrobienia (ta sama tresc, albo mode=create na istniejacym)
 *   conflict   - uzytkownik edytowal wpis w aplikacji po ostatnim zapisie API; nie nadpisujemy
 *   skipped    - klient albo uzytkownik kazal tego nie wysylac (ingest_skips)
 *   error      - walidacja albo zapis nie przeszly; `error` mowi dlaczego i jak poprawic
 */

export type StatusPozycji = "created" | "updated" | "unchanged" | "conflict" | "skipped" | "error";

export type WynikPozycji = {
  index: number;
  externalRef: string | null;
  status: StatusPozycji;
  id?: number;
  note?: string;
  error?: string;
  errors?: string[];
  fieldErrors?: Record<string, string>;
  preview?: PodgladZapisu;
};

export type Kontekst = {
  konta: Map<number, { id: number; name: string; type: string; archived: boolean }>;
  instrumenty: Map<string, { id: number; symbol: string }>;
  tagi: { id: number; name: string; categoryKey: string }[];
};

export async function wczytajKontekst(): Promise<Kontekst> {
  const [kontaRows, instrRows, tagRows] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name, type: accounts.type, archived: accounts.archived })
      .from(accounts),
    db
      .select({ id: instruments.id, symbol: instruments.symbol })
      .from(instruments)
      .where(eq(instruments.active, true)),
    db
      .select({ id: tags.id, name: tags.name, categoryKey: tagCategories.key })
      .from(tags)
      .innerJoin(tagCategories, eq(tags.categoryId, tagCategories.id))
      .where(eq(tags.archived, false)),
  ]);
  return {
    konta: new Map(kontaRows.map((k) => [k.id, k])),
    instrumenty: new Map(instrRows.map((i) => [i.symbol, i])),
    tagi: tagRows,
  };
}

/** JSON z posortowanymi kluczami: ta sama tresc daje ten sam skrot niezaleznie od kolejnosci pol. */
export function stabilnyJson(w: unknown): string {
  if (w instanceof Date) return JSON.stringify(w.toISOString());
  if (w === null || typeof w !== "object") return JSON.stringify(w) ?? "null";
  if (Array.isArray(w)) return `[${w.map(stabilnyJson).join(",")}]`;
  const obj = w as Record<string, unknown>;
  const klucze = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${klucze.map((k) => `${JSON.stringify(k)}:${stabilnyJson(obj[k])}`).join(",")}}`;
}

/** Skrot tresci trade'a (bez `snapshot`, ktory jest tylko diagnostyka klienta). */
export function skrotTrade(t: IngestTrade): string {
  const { snapshot: _pomijamy, ...reszta } = t;
  void _pomijamy;
  return createHash("sha256").update(stabilnyJson(reszta)).digest("hex");
}

function kodBleduBazy(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code ?? x?.cause?.code;
}

function centy(kwota: number | null | undefined): number | null {
  return kwota === null || kwota === undefined ? null : Math.round(kwota * 100);
}

type Rozwiazane = { ok: true; szkic: TradeDraft } | { ok: false; errors: string[] };

async function rozwiaz(t: IngestTrade, ctx: Kontekst, idIstniejacego: number | null): Promise<Rozwiazane> {
  const bledy: string[] = [];

  const konto = ctx.konta.get(t.accountId);
  if (!konto) {
    const lista = [...ctx.konta.values()].map((k) => `#${k.id} „${k.name}” (${k.type})`).join(", ");
    bledy.push(`pole accountId: »${t.accountId}« - nie ma takiego konta. Dostępne: ${lista || "brak kont"}.`);
  }

  const symbol = mapujSymbol(t.symbol, [...ctx.instrumenty.keys()]);
  let instrumentId: number | null = null;
  if (!symbol.ok) bledy.push(`pole symbol: ${symbol.error}`);
  else instrumentId = ctx.instrumenty.get(symbol.symbol)?.id ?? null;

  let sesjaId: number | null = null;
  if (t.sessionId !== undefined) {
    const [s] = await db
      .select({ id: backtestSessions.id })
      .from(backtestSessions)
      .where(eq(backtestSessions.id, t.sessionId))
      .limit(1);
    if (!s) bledy.push(`pole sessionId: »${t.sessionId}« - nie ma takiej sesji. Utwórz ją przez POST /api/ingest/backtest-sessions.`);
    else sesjaId = s.id;
  } else if (t.sessionRef !== undefined) {
    const [s] = await db
      .select({ id: backtestSessions.id })
      .from(backtestSessions)
      .where(eq(backtestSessions.externalRef, t.sessionRef))
      .limit(1);
    if (!s) bledy.push(`pole sessionRef: »${t.sessionRef}« - nie ma takiej sesji. Najpierw POST /api/ingest/backtest-sessions z tym externalRef.`);
    else sesjaId = s.id;
  }

  let tagi: { tagId: number; interval: string | null }[] | undefined;
  if (t.tags !== undefined) {
    tagi = [];
    t.tags.forEach((ref, i) => {
      let tagId: number | undefined = ref.tagId;
      if (tagId !== undefined) {
        if (!ctx.tagi.some((x) => x.id === tagId)) {
          bledy.push(`pole tags.${i}.tagId: »${tagId}« - nie ma takiego (aktywnego) tagu. Lista w GET /api/ingest/meta.`);
          tagId = undefined;
        }
      } else {
        const znaleziony = ctx.tagi.find(
          (x) => x.categoryKey === ref.category && x.name.toLowerCase() === (ref.name ?? "").toLowerCase(),
        );
        if (!znaleziony) {
          bledy.push(
            `pole tags.${i}: »${ref.category}/${ref.name}« - nie ma takiego tagu. Tagi nie są zakładane automatycznie; dodaj go w aplikacji (Ustawienia) albo wybierz z GET /api/ingest/meta.`,
          );
        } else tagId = znaleziony.id;
      }
      if (tagId !== undefined) tagi!.push({ tagId, interval: ref.interval ?? null });
    });
  }

  if (bledy.length > 0 || instrumentId === null) return { ok: false, errors: bledy };

  return {
    ok: true,
    szkic: {
      id: idIstniejacego,
      accountId: t.accountId,
      instrumentId,
      backtestSessionId: sesjaId,
      direction: t.direction,
      status: t.status,
      entryTime: t.entryTime,
      entryPrice: t.entryPrice,
      contracts: t.contracts,
      wyjscia: t.exits.map((w, i) => ({
        numer: i + 1,
        czas: w.time ?? null,
        cena: w.price,
        kontrakty: w.contracts ?? null,
        kwotaBrokera: centy(w.brokerAmount),
        notatka: w.note ?? null,
      })),
      stopLoss: t.stopLoss ?? null,
      takeProfit: t.takeProfit ?? null,
      mae: t.mae ?? null,
      mfe: t.mfe ?? null,
      brokerAmount: centy(t.brokerAmount),
      // `undefined` = "nie ruszaj" (przy aktualizacji); `null` z API = "wyczysc".
      note: t.note,
      moodNote: t.moodNote,
      readiness: t.readiness,
      custom: t.custom,
      tags: tagi,
    },
  };
}

async function przetworzPozycje(
  index: number,
  surowa: unknown,
  tryb: "create" | "update",
  dryRun: boolean,
  ctx: Kontekst,
): Promise<WynikPozycji> {
  const refSurowy =
    surowa !== null && typeof surowa === "object" && typeof (surowa as { externalRef?: unknown }).externalRef === "string"
      ? ((surowa as { externalRef: string }).externalRef)
      : null;

  const parsed = TradeSchema.safeParse(surowa);
  if (!parsed.success) {
    const errors = opiszBledyZod(parsed.error, surowa);
    return { index, externalRef: refSurowy, status: "error", error: errors[0], errors };
  }
  const t = parsed.data;
  const zrodlo = t.source ?? zrodloZRef(t.externalRef);

  // Nagrobek wygrywa ze wszystkim: skasowany w aplikacji albo pominiety przez klienta.
  const [nagrobek] = await db
    .select({ reason: ingestSkips.reason })
    .from(ingestSkips)
    .where(eq(ingestSkips.externalRef, t.externalRef))
    .limit(1);
  if (nagrobek) {
    return {
      index,
      externalRef: t.externalRef,
      status: "skipped",
      note:
        nagrobek.reason === "deleted"
          ? "Trade skasowany w aplikacji - nie wysyłaj go ponownie."
          : "Klient oznaczył ten trade jako pomijany.",
    };
  }

  const [istniejacy] = await db
    .select({
      id: trades.id,
      updatedAt: trades.updatedAt,
      ingestedAt: trades.ingestedAt,
      skrot: sql<string | null>`${trades.sourceSnapshot} ->> 'hash'`,
    })
    .from(trades)
    .where(eq(trades.externalRef, t.externalRef))
    .limit(1);

  const skrot = skrotTrade(t);

  if (istniejacy) {
    if (tryb === "create") {
      return {
        index,
        externalRef: t.externalRef,
        status: "unchanged",
        id: istniejacy.id,
        note: "Trade już istnieje; mode=create niczego nie nadpisuje. Użyj mode=update, żeby go zaktualizować.",
      };
    }
    if (istniejacy.skrot === skrot) {
      return { index, externalRef: t.externalRef, status: "unchanged", id: istniejacy.id };
    }
    const edytowany =
      istniejacy.ingestedAt !== null && istniejacy.updatedAt.getTime() > istniejacy.ingestedAt.getTime();
    if (edytowany) {
      return {
        index,
        externalRef: t.externalRef,
        status: "conflict",
        id: istniejacy.id,
        note: `Trade edytowano w aplikacji (${istniejacy.updatedAt.toISOString()}) po ostatnim zapisie z API (${istniejacy.ingestedAt!.toISOString()}). Zmiany użytkownika wygrywają; nic nie zapisano.`,
      };
    }
  }

  const rozw = await rozwiaz(t, ctx, istniejacy?.id ?? null);
  if (!rozw.ok) return { index, externalRef: t.externalRef, status: "error", error: rozw.errors[0], errors: rozw.errors };

  const { snapshot, ...bezSnapshotu } = t;
  const zapis = await persistTrade(
    rozw.szkic,
    {
      source: zrodlo,
      externalRef: t.externalRef,
      sourceSnapshot: { v: 1, hash: skrot, payload: JSON.parse(JSON.stringify(bezSnapshotu)), snapshot: snapshot ?? null },
    },
    { dryRun },
  );
  if (!zapis.ok) {
    return {
      index,
      externalRef: t.externalRef,
      status: "error",
      error: zapis.error,
      errors: zapis.fieldErrors ? Object.values(zapis.fieldErrors) : [zapis.error],
      ...(zapis.fieldErrors ? { fieldErrors: zapis.fieldErrors } : {}),
    };
  }
  return {
    index,
    externalRef: t.externalRef,
    status: istniejacy ? "updated" : "created",
    ...(dryRun ? { preview: zapis.podglad, ...(istniejacy ? { id: istniejacy.id } : {}) } : { id: zapis.id }),
  };
}

export async function przetworzTrady(
  koperta: z.output<typeof KopertaTradowSchema>,
): Promise<{ summary: Record<StatusPozycji, number>; results: WynikPozycji[] }> {
  const ctx = await wczytajKontekst();
  const results: WynikPozycji[] = [];

  /* Ten sam externalRef dwa razy w jednej paczce to blad klienta: druga
     pozycja zobaczylaby w bazie pierwsza i wynik zalezalby od kolejnosci. */
  const widziane = new Set<string>();

  for (let i = 0; i < koperta.trades.length; i += 1) {
    const surowa = koperta.trades[i];
    const ref =
      surowa !== null && typeof surowa === "object" ? (surowa as { externalRef?: unknown }).externalRef : undefined;
    if (typeof ref === "string") {
      if (widziane.has(ref)) {
        results.push({
          index: i,
          externalRef: ref,
          status: "error",
          error: `pole externalRef: »${ref}« występuje w tej paczce drugi raz. Każdy trade ma być w paczce raz.`,
        });
        continue;
      }
      widziane.add(ref);
    }
    try {
      results.push(await przetworzPozycje(i, surowa, koperta.mode, koperta.dryRun, ctx));
    } catch (e) {
      // Wyścig dwóch zapytań o ten sam externalRef: unikat w bazie wygrał, więc trade już jest.
      if (kodBleduBazy(e) === "23505" && typeof ref === "string") {
        results.push({
          index: i,
          externalRef: ref,
          status: "unchanged",
          note: "Równoległe zapytanie zapisało ten trade chwilę wcześniej.",
        });
        continue;
      }
      console.error(`[ingest] pozycja ${i} (${typeof ref === "string" ? ref : "bez externalRef"}) - błąd zapisu:`, e);
      results.push({
        index: i,
        externalRef: typeof ref === "string" ? ref : null,
        status: "error",
        error: "Błąd zapisu po stronie serwera. Szczegóły są w logach aplikacji; ponów zapytanie (zapis jest idempotentny).",
      });
    }
  }

  const summary: Record<StatusPozycji, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    skipped: 0,
    error: 0,
  };
  for (const r of results) summary[r.status] += 1;
  return { summary, results };
}

/* --- GET: lista tradow z API do uzgodnienia ------------------------------- */

export type ParametryListy = {
  refs: string[];
  source: "tradingview" | "fxreplay" | null;
  after: number;
  limit: number;
};

export async function listaTradowZApi(p: ParametryListy) {
  const warunki = [gt(trades.id, p.after)];
  if (p.refs.length > 0) warunki.push(inArray(trades.externalRef, p.refs));
  else warunki.push(sql`${trades.externalRef} is not null`);
  if (p.source) warunki.push(eq(trades.source, p.source));

  const rows = await db
    .select({
      id: trades.id,
      externalRef: trades.externalRef,
      source: trades.source,
      status: trades.status,
      backtestSessionId: trades.backtestSessionId,
      entryTime: trades.entryTime,
      updatedAt: trades.updatedAt,
      ingestedAt: trades.ingestedAt,
      skrot: sql<string | null>`${trades.sourceSnapshot} ->> 'hash'`,
    })
    .from(trades)
    .where(and(...warunki))
    .orderBy(asc(trades.id))
    .limit(p.limit + 1);

  const maWiecej = rows.length > p.limit;
  const strona = rows.slice(0, p.limit);
  return {
    trades: strona.map((r) => ({
      id: r.id,
      externalRef: r.externalRef,
      source: r.source,
      status: r.status,
      sessionId: r.backtestSessionId,
      entryTime: r.entryTime.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      ingestedAt: r.ingestedAt?.toISOString() ?? null,
      /** true = użytkownik poprawiał wpis w aplikacji po ostatnim zapisie z API (zapis API da `conflict`). */
      editedInApp: r.ingestedAt !== null && r.updatedAt.getTime() > r.ingestedAt.getTime(),
      hash: r.skrot,
    })),
    nextAfter: maWiecej ? strona[strona.length - 1].id : null,
  };
}
