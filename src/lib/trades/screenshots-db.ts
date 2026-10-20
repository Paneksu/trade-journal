import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { screenshots } from "@/lib/db/schema";
import { opiszBladBazy } from "@/lib/api-v2/bledy-bazy";
import type { Zapis } from "@/lib/api-v2/zapis";
import { deleteScreenshot, saveScreenshot, zapisBezstratny } from "@/lib/screenshots";
import { bladLimitu, MAX_ZRZUTOW } from "@/lib/screenshots-limit";
import type { ShotOwner } from "@/lib/uploads-path";

/**
 * Zapis zrzutow w bazie i na dysku. Wydzielone z akcji formularza (ADR-026), bo to samo
 * robi API synchronizacji (zrzuty trade'a) i zalaczniki notatek i dni (faza 2b) - bez
 * duplikowania numeracji kolejnosci i obslugi bledow.
 */

export type ZrzutZInterwalem = {
  file: File;
  interval: string | null;
  /** Kiedy zrzut zrobiono (zegar klienta); brak = chwila zapisu. */
  capturedAt?: Date | null;
  /** Symbol, interwal i zakres z `tj shot`. */
  chartState?: Record<string, unknown> | null;
  /** Podpis zrzutu (kolumna `caption`). */
  caption?: string | null;
};

export type OriginZrzutu = "manual" | "tradingview" | "fxreplay";

export type OpcjeWgrywania = {
  /** Identyfikator zapytania do logow (bez niego powstaje losowy identyfikator zdarzenia). */
  requestId?: string;
  /** Id zrzutow z MIGAWKI `stare` (zaraz zastapionych): tylko one nie licza sie do limitu (audyt N1, 15.10.2026). */
  zastepowaneIds?: number[];
  /** Ustawiane na true, gdy odmowa wynika z limitu (wolajacy zwraca 422, nie 500). */
  przekroczonyLimit?: { wartosc: boolean };
};

class LimitZalacznikow extends Error {}

type KolumnaWlasciciela = typeof screenshots.tradeId | typeof screenshots.dayNoteId | typeof screenshots.noteId;

function kolumna(owner: ShotOwner): KolumnaWlasciciela {
  return owner.kind === "trade" ? screenshots.tradeId : owner.kind === "day" ? screenshots.dayNoteId : screenshots.noteId;
}

export async function policzZalaczniki(owner: ShotOwner): Promise<number> {
  const [w] = await db
    .select({ ile: sql<number>`count(*)::int` })
    .from(screenshots)
    .where(eq(kolumna(owner), owner.id));
  return w?.ile ?? 0;
}

export async function policzZrzuty(tradeId: number): Promise<number> {
  return policzZalaczniki({ kind: "trade", id: tradeId });
}

/**
 * Zapisuje pliki i dopisuje je na koncu listy wlasciciela. Numeracja startuje od tego, co
 * juz lezy w bazie - inaczej zdjecie dograne pozniej wskakiwaloby na poczatek.
 * Zwraca komunikat bledu albo null; `ids` dostaje identyfikatory wstawionych wierszy.
 */
export async function wgrajZalaczniki(
  owner: ShotOwner,
  items: ZrzutZInterwalem[],
  origin: OriginZrzutu = "manual",
  /** Z bramy API: wstawienia ida w transakcji z tj.actor (ADR-030). Formularz UI nie podaje. */
  zapis?: Zapis,
  ids?: number[],
  opcje: OpcjeWgrywania = {},
): Promise<string | null> {
  if (items.length === 0) return null;
  const wstawioneTuId: number[] = ids ?? [];

  for (const { file, interval, capturedAt, chartState, caption } of items) {
    let zapisany: Awaited<ReturnType<typeof saveScreenshot>> | null = null;
    try {
      zapisany = await saveScreenshot(owner, file, { bezstratnie: zapisBezstratny(origin, file.type) });
      const saved = zapisany;
      // Limit i numeracja liczone POD BLOKADA DORADCZA wlasciciela (audyt 7): dwa rownolegle wgrania nie
      // przekrocza limitu, a kolejnosc nie dubluje numerow. Zrzuty zastepowanego pochodzenia nie licza sie.
      const wstaw = async (tx: Pick<typeof db, "execute" | "select" | "insert">) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.shots:${owner.kind}:${owner.id}`}, 0))`);
        const wlasciciel = eq(kolumna(owner), owner.id);
        const licza = opcje.zastepowaneIds && opcje.zastepowaneIds.length > 0 ? and(wlasciciel, notInArray(screenshots.id, opcje.zastepowaneIds)) : wlasciciel;
        const [{ ile }] = await tx.select({ ile: sql<number>`count(*)::int` }).from(screenshots).where(licza);
        const limit = bladLimitu(ile, 1);
        if (limit) throw new LimitZalacznikow(`${limit} (maksimum ${MAX_ZRZUTOW} łącznie)`);
        const [stan] = await tx.select({ ostatni: sql<number>`coalesce(max(${screenshots.sortOrder}), -1)::int` }).from(screenshots).where(wlasciciel);
        return tx
          .insert(screenshots)
          .values({
            ...(owner.kind === "trade" ? { tradeId: owner.id } : owner.kind === "day" ? { dayNoteId: owner.id } : { noteId: owner.id }),
            file: saved.file,
            thumbnail: saved.thumbnail,
            width: saved.width,
            height: saved.height,
            sortOrder: (stan?.ostatni ?? -1) + 1,
            interval,
            origin,
            sha256: saved.sha256,
            capturedAt: capturedAt ?? new Date(),
            chartState: chartState ?? null,
            caption: caption ?? null,
          })
          .returning({ id: screenshots.id });
      };
      const [wstawiony] = zapis ? await zapis((tx) => wstaw(tx)) : await db.transaction((tx) => wstaw(tx));
      if (wstawiony) wstawioneTuId.push(wstawiony.id);
    } catch (error) {
      if (zapisany) await deleteScreenshot(zapisany.file, zapisany.thumbnail).catch(() => {});
      if (error instanceof LimitZalacznikow) {
        if (opcje.przekroczonyLimit) opcje.przekroczonyLimit.wartosc = true;
        return error.message;
      }
      // Szczegoly (sciezki, komunikaty sterownikow) tylko do logu; klient dostaje tekst ogolny z identyfikatorem.
      const idZdarzenia = opcje.requestId ?? randomBytes(4).toString("hex");
      console.error(`[zrzuty ${idZdarzenia}] zapis ${owner.kind} #${owner.id} nie powiódł się:`, error);
      const opis = opiszBladBazy(error);
      return opis
        ? `zrzut się nie wgrał: ${opis.komunikat} (identyfikator ${idZdarzenia})`
        : `zrzut się nie wgrał z powodu błędu serwera (szczegóły w logach pod identyfikatorem ${idZdarzenia})`;
    }
  }
  return null;
}

export async function wgrajZrzuty(
  tradeId: number,
  items: ZrzutZInterwalem[],
  origin: OriginZrzutu = "manual",
  zapis?: Zapis,
  ids?: number[],
  opcje?: OpcjeWgrywania,
): Promise<string | null> {
  return wgrajZalaczniki({ kind: "trade", id: tradeId }, items, origin, zapis, ids, opcje);
}
