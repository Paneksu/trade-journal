import Link from "next/link";
import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import type { TradeRecord } from "@/lib/queries/trades";
import { longDate, pnlClass, rValue } from "@/lib/format";

/**
 * Siatka kafli galerii - przegladanie trade'ow po zdjeciu, nie po liczbach.
 *
 * UWAGA: to NIE jest to samo co `lib/domain/galeria.ts` ani
 * `components/screenshots/*`. Tamte ukladaja zrzuty JEDNEGO trade'a w ukladzie
 * justowanym, zeby zaden nie byl przyciety (ADR-012). Tutaj kazdy kafel nalezy
 * do innego trade'a i ma pod obrazkiem wiecej metadanych niz samego obrazka -
 * nierowne wysokosci rozsypalyby rytm siatki, wiec kafle maja wspolna
 * proporcje. Zdjecie i tak nie jest przyciete: `object-contain` na tle,
 * a nie `object-cover`.
 *
 * Komponent serwerowy - zero "use client". Zrzuty leza poza `public/` i ida
 * przez trase za sesja, wiec `next/image` odpada; zwykly `<img>` z `width`,
 * `height` i `loading="lazy"` daje to samo bez przeskoku ukladu.
 */
export function GalleryGrid({ trades }: { trades: TradeRecord[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {trades.map((t) => (
        <li key={t.id}>
          <Link
            href={`/trades/${t.id}`}
            className={cx(
              "group flex h-full flex-col overflow-hidden rounded-[var(--radius-panel)]",
              "border border-line bg-surface transition-colors duration-150",
              "hover:border-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            )}
          >
            <div className="flex aspect-video items-center justify-center bg-surface-2">
              {t.firstShot ? (
                /* eslint-disable-next-line @next/next/no-img-element --
                   `next/image` nie ma jak tego obsluzyc: pliki leza poza
                   `public/`, a trasa /api/screenshots wymaga sesji. */
                <img
                  src={`/api/screenshots/${t.firstShot.file}`}
                  alt={`Zrzut trade'a ${t.instrumentSymbol} z ${t.tradingDay}`}
                  width={t.firstShot.width ?? undefined}
                  height={t.firstShot.height ?? undefined}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain"
                />
              ) : (
                <ImageOff className="h-6 w-6 text-faint" aria-hidden />
              )}
            </div>

            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold text-text">
                  {t.instrumentSymbol}
                </span>
                <span className={cx("liczba shrink-0 text-sm", pnlClass(t.pnl))}>
                  {rValue(t.rMultiple)}
                </span>
              </div>

              <p className="text-xs text-faint">{longDate(t.tradingDay)}</p>

              {t.tags.length > 0 && (
                <p className="mt-auto flex flex-wrap gap-1 pt-1">
                  {/* `assignmentId`, nie `id`: ta sama konfluencja bywa tu kilka
                      razy, raz na kazdym interwale - i to jest cala tresc
                      kafla, wiec niczego nie deduplikujemy (ADR-017). */}
                  {t.tags.map((tag) => (
                    <Badge key={tag.assignmentId} color={tag.color} title={tag.category}>
                      {tag.name}
                      {tag.interval && <span className="opacity-60"> {tag.interval}</span>}
                    </Badge>
                  ))}
                </p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
