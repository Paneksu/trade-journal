import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { instruments, mentorClaims, mentorSources, screenshots, trades } from "@/lib/db/schema";
import { linkMentora } from "@/lib/api-v2/luki";
import { listaSetupow, szczegolySetupu } from "@/lib/api-v2/setupy";
import { ukryteTrady } from "@/lib/api-v2/ukrycie-wyniku";

/**
 * Playbook (UI v2, etap 2, wzór 4). Karta setupu przez `szczegolySetupu` (to samo co `GET /api/v2/setups/:slug`:
 * wersje, statystyka z przedziałami według wersji, przykłady), plus trade'y setupu i cytaty mentora przypięte do
 * setupu („wg mentora” osobno od Twoich słów i od AI).
 */

export async function playbook() {
  const { setups } = await listaSetupow(db, false);
  const karty = [];
  for (const s of setups) {
    const d = await szczegolySetupu(db, s.slug);
    if (!d) continue;
    const zrodla = Object.entries(d.stats.bySource).filter(([, v]) => v !== null) as [string, NonNullable<(typeof d.stats.bySource)[keyof typeof d.stats.bySource]>][];
    const glowne = d.stats.bySource.live ?? zrodla[0]?.[1] ?? null;
    karty.push({ ...s, statystyka: glowne, zrodloStatystyki: d.stats.bySource.live ? "live" : (zrodla[0]?.[0] ?? null), tradeow: d.tradesLinked, przykladow: d.examples.length });
  }
  return karty;
}

export async function kartaSetupu(slug: string) {
  const d = await szczegolySetupu(db, slug);
  if (!d) return null;
  const [lista, cytaty] = await Promise.all([
    db
      .select({
        id: trades.id,
        dzien: trades.tradingDay,
        kierunek: trades.direction,
        status: trades.status,
        r: trades.rMultiple,
        proces: trades.processGrade,
        wersja: trades.setupVersionId,
        symbol: instruments.symbol,
      })
      .from(trades)
      .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
      .where(eq(trades.setupId, d.id))
      .orderBy(desc(trades.entryTime))
      .limit(200),
    db
      .select({ c: mentorClaims, s: mentorSources })
      .from(mentorClaims)
      .innerJoin(mentorSources, eq(mentorClaims.sourceId, mentorSources.id))
      .where(and(eq(mentorClaims.setupId, d.id)))
      .orderBy(asc(mentorClaims.tStartS)),
  ]);
  const ukryte = await ukryteTrady(db, lista.map((t) => t.id));
  const zrzutyPrzykladow = d.examples.filter((e) => e.screenshotId !== null).map((e) => e.screenshotId!);
  const pliki = zrzutyPrzykladow.length
    ? new Map(
        (await db.select({ id: screenshots.id, file: screenshots.file, interval: screenshots.interval }).from(screenshots).where(inArray(screenshots.id, zrzutyPrzykladow))).map((z) => [z.id, z]),
      )
    : new Map<number, { id: number; file: string; interval: string | null }>();

  const wersjePoId = new Map(d.versions.map((w) => [w.id, w.version]));
  return {
    ...d,
    tradey: lista.map((t) => ({
      ...t,
      r: ukryte.has(t.id) ? null : t.r === null ? null : Number(t.r),
      ukryty: ukryte.has(t.id),
      wersjaNr: t.wersja === null ? null : (wersjePoId.get(t.wersja) ?? null),
    })),
    przyklady: d.examples.map((e) => ({ ...e, plik: e.screenshotId ? (pliki.get(e.screenshotId) ?? null) : null })),
    mentor: cytaty.map(({ c, s }) => ({
      id: c.id,
      quote: c.quote,
      paraphrase: c.paraphrase,
      claimType: c.claimType,
      status: c.status,
      tStartS: c.tStartS,
      tytul: s.title,
      link: linkMentora(s.videoId, c.tStartS),
    })),
  };
}

export type KartaSetupu = NonNullable<Awaited<ReturnType<typeof kartaSetupu>>>;
