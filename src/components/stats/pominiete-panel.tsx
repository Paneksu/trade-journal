import { DataPoint, Panel } from "@/components/ui/base";
import type { StatystykiPominietych } from "@/lib/domain/pominiete";
import { int, percent, rValue, tradesCount } from "@/lib/format";

/**
 * Sekcja "Pominiete" na /stats - trade'y ze statusem "missed" (setup byl,
 * uzytkownik go nie wzial). Wynik hipotetyczny, celowo POZA closedOnly, wiec
 * nie wchodzi do zadnej liczby w reszcie strony (patrz closedOnly w
 * queries/trades.ts).
 *
 * Dwie liczby R obok siebie, nie jedna - `zyskowneR` sama schlebia (pokazuje
 * tylko upuszczone zyski), `sumaR` jest netto i uwzglednia tez pominiete
 * straty, ktore uzytkownik sobie oszczedzil.
 */
export function PominietePanel({ stats }: { stats: StatystykiPominietych }) {
  if (stats.count === 0) return null;

  // Ten sam wzor co `winRate` w domain/stats.ts: BE poza mianownikiem.
  // Inaczej dwie skutecznosci na jednej stronie znaczylyby co innego.
  const rozstrzygniete = stats.wygrane + stats.przegrane;
  const skutecznosc = rozstrzygniete > 0 ? stats.wygrane / rozstrzygniete : null;

  return (
    <Panel
      title="Pominięte"
      description="Trade'y, których nie wziąłeś. Wynik hipotetyczny — nie wchodzi do żadnej liczby powyżej."
    >
      <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <DataPoint label="Pominiętych" valueClassName="text-accent">
          {tradesCount(stats.count)}
        </DataPoint>
        <DataPoint label="Wygrałoby">
          {`${int(stats.wygrane)} (${percent(skutecznosc)})`}
        </DataPoint>
        <DataPoint label="Stracone R (same wygrane)">{rValue(stats.zyskowneR)}</DataPoint>
        <DataPoint label="Wynik netto pominiętych">{rValue(stats.sumaR)}</DataPoint>
      </div>
    </Panel>
  );
}
