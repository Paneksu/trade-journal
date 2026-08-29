import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { shiftMonth } from "@/lib/domain/day-log";

/**
 * Przelacznik miesiaca: poprzedni, powrot do domyslnego, nastepny.
 *
 * Jeden komponent dla kalendarza dziennika i kalendarza sesji backtestu
 * (2026-08-30). Sesja pokazywala wczesniej WSZYSTKIE miesiace naraz - przy
 * backteście na dwóch latach dawało to dwadzieścia kilka siatek pod sobą i nie
 * dało się na nie patrzeć. Jedna siatka plus nawigacja czyta się tak samo jak
 * kalendarz dziennika, więc nie ma czego uczyć się drugi raz.
 *
 * Miesiac jest parametrem adresu, nie stanem klienta: dzieki temu widok da sie
 * wyslac linkiem, a powrot z karty dnia wraca na ten sam miesiac.
 */
export function MonthNav({
  month,
  base,
  srodek = "dziś",
}: {
  month: string;
  /** Adres bez parametrow, np. `/calendar` albo `/backtest/12`. */
  base: string;
  /** Podpis srodkowego przycisku - wraca do miesiaca domyslnego. */
  srodek?: string;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-line-strong">
      <Link
        href={`${base}?miesiac=${shiftMonth(month, -1)}`}
        aria-label="Poprzedni miesiąc"
        className="flex h-8 w-8 items-center justify-center bg-surface text-muted hover:bg-surface-2 hover:text-text"
      >
        <ChevronLeft size={16} aria-hidden />
      </Link>
      <Link
        href={base}
        className="flex h-8 items-center border-x border-line-strong bg-surface px-3 text-xs text-muted hover:bg-surface-2 hover:text-text"
      >
        {srodek}
      </Link>
      <Link
        href={`${base}?miesiac=${shiftMonth(month, 1)}`}
        aria-label="Następny miesiąc"
        className="flex h-8 w-8 items-center justify-center bg-surface text-muted hover:bg-surface-2 hover:text-text"
      >
        <ChevronRight size={16} aria-hidden />
      </Link>
    </div>
  );
}
