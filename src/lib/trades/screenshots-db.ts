import "server-only";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { screenshots } from "@/lib/db/schema";
import type { Zapis } from "@/lib/api-v2/zapis";
import { saveScreenshot } from "@/lib/screenshots";
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
): Promise<string | null> {
  if (items.length === 0) return null;

  const [stan] = await db
    .select({ ostatni: sql<number>`coalesce(max(${screenshots.sortOrder}), -1)::int` })
    .from(screenshots)
    .where(eq(kolumna(owner), owner.id));
  let sortOrder = (stan?.ostatni ?? -1) + 1;

  for (const { file, interval, capturedAt, chartState, caption } of items) {
    try {
      const saved = await saveScreenshot(owner, file);
      const wiersz = {
        ...(owner.kind === "trade" ? { tradeId: owner.id } : owner.kind === "day" ? { dayNoteId: owner.id } : { noteId: owner.id }),
        file: saved.file,
        thumbnail: saved.thumbnail,
        width: saved.width,
        height: saved.height,
        sortOrder: sortOrder++,
        interval,
        origin,
        sha256: saved.sha256,
        capturedAt: capturedAt ?? new Date(),
        chartState: chartState ?? null,
        caption: caption ?? null,
      };
      const [wstawiony] = zapis
        ? await zapis((tx) => tx.insert(screenshots).values(wiersz).returning({ id: screenshots.id }))
        : await db.insert(screenshots).values(wiersz).returning({ id: screenshots.id });
      if (ids && wstawiony) ids.push(wstawiony.id);
    } catch (error) {
      return `zrzut się nie wgrał: ${(error as Error).message}`;
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
): Promise<string | null> {
  return wgrajZalaczniki({ kind: "trade", id: tradeId }, items, origin, zapis, ids);
}
