import Link from "next/link";
import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { czyPominiety, type StatusTrade } from "@/lib/domain/status";
import type { TradeRecord } from "@/lib/queries/trades";
import { longDate, rValue, WYNIK_SKROT } from "@/lib/format";

/** Kolor i etykieta wyniku na kaflu - "nie wziety" dostaje `accent`, bo zielen
 * i czerwien sa zajete przez zysk/strate (globals.css:25-34). */
const PASEK_KOLOR: Record<"zysk" | "strata" | "be" | "missed", string> = {
  zysk: "bg-profit",
  strata: "bg-loss",
  be: "bg-flat",
  missed: "bg-accent",
};

const TEKST_KOLOR: Record<"zysk" | "strata" | "be" | "missed", string> = {
  zysk: "text-profit",
  strata: "text-loss",
  be: "text-flat",
  missed: "text-accent",
};

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
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-3">
      {trades.map((t) => {
        const pominiety = czyPominiety(t.status as StatusTrade);
        const klucz = pominiety ? "missed" : t.wynik;
        // Przy 375px "NIE WZIĘTY" zostawia zero znakow na symbol instrumentu
        // obok (recenzja 2026-08-30, znalezisko 3) - ponizej `sm:` skrot na
        // dwie litery, pelna forma wraca od `sm:` w gore.
        const skrotKrotki = pominiety ? "NW" : WYNIK_SKROT[t.wynik];
        const skrotPelny = pominiety ? "NIE WZIĘTY" : WYNIK_SKROT[t.wynik];
        const pelnaNazwa = pominiety
          ? "setup nie wzięty do handlu"
          : t.wynik === "zysk"
            ? "wygrany trade"
            : t.wynik === "strata"
              ? "przegrany trade"
              : "trade zamknięty na zero";

        return (
          <li key={t.id}>
            <Link
              href={`/trades/${t.id}`}
              className={cx(
                "group flex h-full overflow-hidden rounded-[var(--radius-panel)]",
                "border bg-surface transition-colors duration-150",
                pominiety
                  ? "border-dashed border-accent/40 hover:border-accent/70"
                  : "border-line hover:border-faint",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              )}
            >
              {/* Pasek koloru wyniku na lewej krawedzi, nie na gorze - czytelny
                  z odleglosci, pierwszy z trzech niezaleznych nosnikow
                  informacji (WCAG 1.4.1, obok slowa i ksztaltu ramki). Na
                  gorze (przed recenzja 2026-08-30) rozmyty pasek czytal sie
                  jako podkreslenie wyniku z kafla POWYZEJ; na lewej krawedzi
                  obejmuje caly kafel i nie miesza sie z sasiadem. */}
              <div className={cx("w-1.5 shrink-0", PASEK_KOLOR[klucz])} aria-hidden />

              <div className="flex min-w-0 flex-1 flex-col">
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
                      className={cx("h-full w-full object-contain", pominiety && "opacity-70")}
                    />
                  ) : (
                    <ImageOff className="h-6 w-6 text-faint" aria-hidden />
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-baseline gap-1.5 truncate">
                      <span
                        className={cx(
                          "shrink-0 text-sm font-semibold uppercase tracking-wide",
                          TEKST_KOLOR[klucz],
                        )}
                      >
                        <span className="sm:hidden">{skrotKrotki}</span>
                        <span className="hidden sm:inline">{skrotPelny}</span>
                        <span className="sr-only"> — {pelnaNazwa}</span>
                      </span>
                      <span className="truncate text-sm font-semibold text-text">
                        {t.instrumentSymbol}
                      </span>
                    </span>
                    <span className={cx("liczba shrink-0 text-sm", TEKST_KOLOR[klucz])}>
                      {pominiety ? "~" : ""}
                      {rValue(t.rMultiple)}
                    </span>
                  </div>

                  <p className="flex items-center gap-1.5 text-xs text-faint">
                    <span>{longDate(t.tradingDay)}</span>
                    {t.backtestSessionId !== null && <span className="etykieta">backtest</span>}
                  </p>

                  {t.tags.length > 0 && (
                    <p className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                      {/* `assignmentId`, nie `id`: ta sama konfluencja bywa tu
                          kilka razy, raz na kazdym interwale (ADR-017), wiec
                          niczego nie deduplikujemy. Maks. dwa chipy + "+N" -
                          ten sam wzorzec co `trade-list.tsx` - zeby liczba
                          tagow nie rozsadzala rytmu siatki (recenzja
                          2026-08-30, znalezisko 8). Bez propa `color`: kolor
                          kategorii konkuruje z kolorem wyniku przy skanowaniu
                          siatki (znalezisko 5) - tutaj chip jest neutralny,
                          kolor tagu zostaje na karcie trade'a. */}
                      {t.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag.assignmentId} title={tag.category}>
                          {tag.name}
                          {/* `opacity-60` dawal 3,35:1 na tle kafla (axe,
                              dostepnosc.spec.ts "galeria", 7 el.) - text-muted
                              sam w sobie ma 7,07:1 na --color-surface, ale
                              przezroczystosc zbija go ponizej progu 4,5:1.
                              `opacity-80` trzyma 4,96:1 (zmierzone na
                              pikselach) i nadal odroznia interwal od nazwy
                              tagu jasnoscia, bez przywracania koloru
                              kategorii. */}
                          {tag.interval && <span className="opacity-80"> {tag.interval}</span>}
                        </Badge>
                      ))}
                      {t.tags.length > 2 && (
                        <span className="text-xs text-faint">+{t.tags.length - 2}</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
