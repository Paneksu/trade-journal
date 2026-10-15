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
  // UI v2 (etap 4): ta sama pigułka zakresu co w Przeglądzie (wzór 11: strzałki wokół „Today”).
  const p = "przejscie inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-line p-0.5">
      <Link href={`${base}?miesiac=${shiftMonth(month, -1)}`} aria-label="Poprzedni miesiąc" className={p}>
        <ChevronLeft size={16} aria-hidden />
      </Link>
      <Link href={base} className="przejscie inline-flex h-8 items-center rounded-full px-3 text-karta text-text hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2">
        {srodek}
      </Link>
      <Link href={`${base}?miesiac=${shiftMonth(month, 1)}`} aria-label="Następny miesiąc" className={p}>
        <ChevronRight size={16} aria-hidden />
      </Link>
    </div>
  );
}
