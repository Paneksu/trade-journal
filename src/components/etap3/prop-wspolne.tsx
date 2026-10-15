import { PasekZuzycia } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { money } from "@/lib/format";

/* Wspólne kawałki ekranów Prop (etap 3): nazwy rodzajów księgi, komórka bufora (pasek + R + $), próg ostrzeżenia. */

export const RODZAJE_KSIEGI: Record<string, string> = {
  eval_fee: "Opłata za eval",
  reset_fee: "Reset",
  activation_fee: "Aktywacja",
  subscription: "Abonament",
  data_fee: "Dane rynkowe",
  payout: "Wypłata",
  refund: "Zwrot",
  other: "Inne",
};

export const TYPY_DD: Record<string, string> = {
  eod: "EOD",
  intraday: "intraday",
  static: "statyczny",
  trailing_to_static: "trailing → statyczny",
};

/** Bufor w R (R = ryzyko jednego trade'a): liczba główna wiersza; dolary drugorzędnie (kierunek.md: R przed $). */
export function wR(cents: number | null | undefined, ryzykoCents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !ryzykoCents || ryzykoCents <= 0) return null;
  return `${(cents / ryzykoCents).toFixed(1)}R`;
}

/** Progi 50/75/90 (MUST prop): poniżej 50 nic, potem pigułka z progiem; od 90 w kolorze straty. */
export function ProgOstrzezenia({ poziom }: { poziom: number }) {
  if (poziom < 50) return null;
  return (
    <span className={cx("num inline-flex h-5 items-center rounded-full border px-1.5 text-meta", poziom >= 90 ? "border-loss/60 text-loss" : "border-line-strong text-muted")}>
      {poziom >= 100 ? "limit" : `≥${poziom >= 90 ? 90 : poziom >= 75 ? 75 : 50}%`}
    </span>
  );
}

export function KomorkaBufora({
  etykieta,
  buforCents,
  zuzycie,
  ryzykoCents,
  waluta,
}: {
  etykieta: string;
  buforCents: number | null;
  zuzycie: number | null;
  ryzykoCents: number | null;
  waluta: string;
}) {
  if (buforCents === null || zuzycie === null) return <span className="text-meta text-faint">brak limitu</span>;
  const r = wR(buforCents, ryzykoCents);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-karta text-text">{r ?? money(buforCents, { currency: waluta, decimals: 0 })}</span>
        {r && <span className="num text-meta text-muted">{money(buforCents, { currency: waluta, decimals: 0 })}</span>}
      </div>
      <div className="mt-1.5">
        <PasekZuzycia zuzycie={zuzycie} etykieta={etykieta} />
      </div>
    </div>
  );
}
