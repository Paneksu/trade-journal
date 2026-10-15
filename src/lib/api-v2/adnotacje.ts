import "server-only";
import { and, asc, eq, gt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { backtestSessions, chartAnnotations, trades, userWords } from "@/lib/db/schema";
import { sprawdzTekstBajtWBajt } from "@/lib/domain/notatki";

import type { AdnotacjeListaQuery, AdnotacjeZapisSchema } from "./contract/funkcje";
import { skrotTekstu } from "./skrot";
import { zSlow } from "./slowa";
import { sqlSlowaPoWejsciuUkrytego } from "./ukrycie-wyniku";
import type { KontekstApi, Transakcja } from "./with-api";

/**
 * Adnotacje wykresu (ADR-032/033, MUST 12 i 13): TWOJE rysunki z wykresu, z tekstem 1:1.
 * Tekst rysunku to `user_words` (source = 'chart'): bajt w bajt, ze skrotem SHA-256 liczonym
 * przez baze i porownanym ze skrotem klienta, wiec test moze sprawdzic, ze tekst nie zmienil
 * sie w drodze wykres -> CLI -> API -> UI. Rysunki AI maja prefiks `[AI] ` i serwer ich tu
 * nie przyjmuje. Zmiana tekstu rysunku na wykresie to NOWY wiersz slow (`supersedes_id`),
 * a adnotacja zostaje przepieta; poprzednia wersja zostaje w historii.
 */

type Db = Transakcja | typeof import("@/lib/db").db;
export const PREFIKS_RYSUNKU_AI = "[AI] ";
const MAX_LANCUCH = 50;

const rownaCena = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a) === Number(b));

export type WynikAdnotacji = {
  externalId: string;
  status: "created" | "unchanged" | "updated" | "text_changed" | "refused";
  annotationId: number | null;
  wordsId: number | null;
  error?: string;
};

export type WynikZapisuAdnotacji =
  | { ok: true; results: WynikAdnotacji[]; summary: Record<WynikAdnotacji["status"], number> }
  | { ok: false; status: 422; kod: string; komunikat: string };

type Wejscie = z.output<typeof AdnotacjeZapisSchema>;

async function glowaLancucha(tx: Transakcja, startId: number): Promise<typeof userWords.$inferSelect> {
  let [obecne] = await tx.select().from(userWords).where(eq(userWords.id, startId)).limit(1);
  for (let i = 0; i < MAX_LANCUCH; i += 1) {
    const [nastepne] = await tx.select().from(userWords).where(eq(userWords.supersedesId, obecne.id)).limit(1);
    if (!nastepne) return obecne;
    obecne = nastepne;
  }
  throw new Error(`Łańcuch poprawek słów #${startId} ma więcej niż ${MAX_LANCUCH} ogniw: dane są uszkodzone.`);
}

async function wstawSlowa(
  tx: Transakcja,
  api: KontekstApi,
  b: Wejscie,
  a: Wejscie["annotations"][number],
  supersedesId: number | null,
): Promise<typeof userWords.$inferSelect> {
  const [w] = await tx
    .insert(userWords)
    .values({
      text: a.text!,
      source: "chart",
      role: "chart.annotation",
      tradeId: b.tradeId ?? null,
      backtestSessionId: b.sessionId ?? null,
      day: b.day ?? null,
      capturedAt: a.capturedAt,
      supersedesId,
      createdByTokenId: api.token.id,
    })
    .returning();
  // Pas i szelki jak w zapiszSlowa: trigger policzyl skrot z bajtow w bazie; rozjazd = tekst zmienil sie po drodze.
  if (w.sha256 !== a.sha256) {
    throw new Error(`Skrót tekstu rysunku »${a.externalId}« w bazie (${w.sha256}) różni się od skrótu klienta (${a.sha256}); tekst zmienił się w drodze do bazy. Transakcja wycofana.`);
  }
  return w;
}

export async function zapiszAdnotacje(tx: Transakcja, api: KontekstApi, b: Wejscie): Promise<WynikZapisuAdnotacji> {
  if (b.tradeId !== undefined) {
    const [t] = await tx.select({ id: trades.id }).from(trades).where(eq(trades.id, b.tradeId)).limit(1);
    if (!t) return { ok: false, status: 422, kod: "unknown_reference", komunikat: `pole tradeId: »${b.tradeId}« - nie ma takiego trade'a (mógł zostać skasowany w aplikacji).` };
  }
  if (b.sessionId !== undefined) {
    const [s] = await tx.select({ id: backtestSessions.id }).from(backtestSessions).where(eq(backtestSessions.id, b.sessionId)).limit(1);
    if (!s) return { ok: false, status: 422, kod: "unknown_reference", komunikat: `pole sessionId: »${b.sessionId}« - nie ma takiej sesji.` };
  }

  const wyniki: WynikAdnotacji[] = [];
  for (const a of b.annotations) {
    const odrzuc = (error: string): WynikAdnotacji => ({ externalId: a.externalId, status: "refused", annotationId: null, wordsId: null, error });

    if (a.text !== undefined) {
      if (a.text.startsWith(PREFIKS_RYSUNKU_AI)) {
        wyniki.push(odrzuc(`tekst zaczyna się od »${PREFIKS_RYSUNKU_AI.trim()}«: to rysunek AI, a ta warstwa przyjmuje wyłącznie Twoje rysunki. Pomiń go w paczce.`));
        continue;
      }
      const bajty = sprawdzTekstBajtWBajt(a.text);
      if (!bajty.ok) {
        wyniki.push(odrzuc(`pole text: ${bajty.powod}.`));
        continue;
      }
      const policzony = skrotTekstu(a.text);
      if (policzony !== a.sha256) {
        wyniki.push(odrzuc(`pole sha256: »${a.sha256}« nie zgadza się ze skrótem policzonym przez serwer z bajtów UTF-8 tekstu (»${policzony}«, ${Buffer.byteLength(a.text, "utf8")} B). Tekst zmienił się w drodze (kodowanie, normalizacja, końce linii). Nic nie zapisano dla tego rysunku.`));
        continue;
      }
    }

    // Blokada po kluczu rysunku: dwa rownolegle zapisy tego samego rysunku nie rozjada lancucha poprawek.
    const klucz = [b.platform, a.externalId, b.tradeId ?? "", b.day ?? ""].join("|");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.annotation:${klucz}`}, 0))`);
    const [istniejaca] = await tx
      .select()
      .from(chartAnnotations)
      .where(
        and(
          eq(chartAnnotations.platform, b.platform),
          eq(chartAnnotations.externalId, a.externalId),
          sql`${chartAnnotations.tradeId} is not distinct from ${b.tradeId ?? null}`,
          sql`${chartAnnotations.day} is not distinct from ${b.day ?? null}`,
        ),
      )
      .limit(1);

    const geometria = {
      shape: a.shape,
      interval: a.interval ?? null,
      price: a.price == null ? null : String(a.price),
      price2: a.price2 == null ? null : String(a.price2),
      timeFrom: a.timeFrom ?? null,
      timeTo: a.timeTo ?? null,
      raw: a.raw ?? null,
      capturedAt: a.capturedAt,
    };

    if (!istniejaca) {
      const slowa = a.text !== undefined ? await wstawSlowa(tx, api, b, a, null) : null;
      const [nowa] = await tx
        .insert(chartAnnotations)
        .values({ platform: b.platform, externalId: a.externalId, tradeId: b.tradeId ?? null, backtestSessionId: b.sessionId ?? null, day: b.day ?? null, wordsId: slowa?.id ?? null, ...geometria })
        .returning({ id: chartAnnotations.id });
      wyniki.push({ externalId: a.externalId, status: "created", annotationId: nowa.id, wordsId: slowa?.id ?? null });
      continue;
    }

    // Rysunek juz jest: sprawdzamy tekst wzgledem GLOWY lancucha poprawek.
    let wordsId = istniejaca.wordsId;
    let status: WynikAdnotacji["status"] = "unchanged";
    if (a.text !== undefined) {
      const glowa = istniejaca.wordsId === null ? null : await glowaLancucha(tx, istniejaca.wordsId);
      if (glowa === null) {
        const slowa = await wstawSlowa(tx, api, b, a, null);
        wordsId = slowa.id;
        status = "text_changed";
      } else if (glowa.sha256 === a.sha256) {
        wordsId = glowa.id;
        if (istniejaca.wordsId !== glowa.id) status = "updated";
      } else {
        const slowa = await wstawSlowa(tx, api, b, a, glowa.id);
        wordsId = slowa.id;
        status = "text_changed";
      }
    } else if (istniejaca.wordsId !== null) {
      // Rysunek stracil tekst na wykresie: odpinamy go od adnotacji, ale slowa zostaja w historii.
      wordsId = null;
      status = "updated";
    }

    const zmiana =
      status !== "unchanged" ||
      istniejaca.shape !== geometria.shape ||
      istniejaca.interval !== geometria.interval ||
      !rownaCena(istniejaca.price, geometria.price) ||
      !rownaCena(istniejaca.price2, geometria.price2) ||
      (istniejaca.timeFrom?.getTime() ?? null) !== (geometria.timeFrom?.getTime() ?? null) ||
      (istniejaca.timeTo?.getTime() ?? null) !== (geometria.timeTo?.getTime() ?? null);
    if (zmiana || wordsId !== istniejaca.wordsId) {
      await tx.update(chartAnnotations).set({ ...geometria, wordsId }).where(eq(chartAnnotations.id, istniejaca.id));
      if (status === "unchanged") status = "updated";
    }
    wyniki.push({ externalId: a.externalId, status, annotationId: istniejaca.id, wordsId });
  }

  const summary = { created: 0, unchanged: 0, updated: 0, text_changed: 0, refused: 0 } satisfies Record<WynikAdnotacji["status"], number>;
  for (const w of wyniki) summary[w.status] += 1;
  return { ok: true, results: wyniki, summary };
}

export async function listaAdnotacji(tx: Db, f: z.output<typeof AdnotacjeListaQuery>) {
  const warunki: SQL[] = [gt(chartAnnotations.id, f.after)];
  if (f.tradeId) warunki.push(eq(chartAnnotations.tradeId, f.tradeId));
  if (f.sessionId) warunki.push(eq(chartAnnotations.backtestSessionId, f.sessionId));
  if (f.day) warunki.push(eq(chartAnnotations.day, f.day));
  const wiersze = await tx
    .select({ a: chartAnnotations, w: userWords, ukryte: sql<boolean>`coalesce(${sqlSlowaPoWejsciuUkrytego(sql`${userWords.tradeId}`, sql`${userWords.day}`, sql`${userWords.capturedAt}`)}, false)` })
    .from(chartAnnotations)
    .leftJoin(userWords, eq(chartAnnotations.wordsId, userWords.id))
    .where(and(...warunki))
    .orderBy(asc(chartAnnotations.id))
    .limit(f.limit + 1);
  const maWiecej = wiersze.length > f.limit;
  const strona = wiersze.slice(0, f.limit);
  return {
    annotations: strona.map(({ a, w, ukryte }) => ({
      id: a.id,
      platform: a.platform,
      externalId: a.externalId,
      tradeId: a.tradeId,
      sessionId: a.backtestSessionId,
      day: a.day,
      shape: a.shape,
      interval: a.interval,
      price: a.price === null ? null : Number(a.price),
      price2: a.price2 === null ? null : Number(a.price2),
      timeFrom: a.timeFrom?.toISOString() ?? null,
      timeTo: a.timeTo?.toISOString() ?? null,
      capturedAt: a.capturedAt.toISOString(),
      // Slowa dopisane po wejsciu trade'a z ukrytym wynikiem nie wychodza (slepa ocena); sam rysunek zostaje.
      words: w && !ukryte ? zSlow(w) : null,
    })),
    nextAfter: maWiecej ? strona[strona.length - 1].a.id : null,
  };
}
