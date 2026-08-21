import { cx } from "@/lib/classes";
import type { Group } from "@/lib/domain/grouping";
import { int, money, num, percent, pnlClass, rValue } from "@/lib/format";

/**
 * Tabela porownania grup. Kolumna "trade'y" stoi zaraz obok wyniku,
 * zeby nie dalo sie przeczytac wysokiego R bez sprawdzenia, z ilu trade'ow.
 */
export function GroupTable({
  groups,
  currency,
  minSample,
}: {
  groups: Group[];
  currency: string;
  minSample: number;
}) {
  if (groups.length === 0) {
    return <p className="px-4 py-6 text-sm text-faint">Brak danych w tym rozbiciu.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line">
            {["Wartość", "Trade'y", "Wynik netto", "Śr. R", "Skuteczność", "Profit factor", "Śr. czas"].map(
              (h, i) => (
                <th
                  key={h}
                  className={cx("etykieta px-3 py-2", i === 0 ? "text-left" : "text-right")}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const thin = g.stats.count < minSample;
            return (
              <tr key={g.key} className="border-b border-line last:border-0">
                <td className="px-3 py-2">
                  <span className="text-text">{g.label}</span>
                  {thin && (
                    <span
                      className="ml-2 text-xs text-faint"
                      title={`Poniżej progu ${minSample} trade'ów — traktuj jako ciekawostkę, nie wniosek.`}
                    >
                      mała próbka
                    </span>
                  )}
                </td>
                <td className="liczba px-3 py-2 text-right text-muted">{int(g.stats.count)}</td>
                <td className={cx("liczba px-3 py-2 text-right font-medium", pnlClass(g.stats.pnlNet))}>
                  {money(g.stats.pnlNet, { currency, sign: true })}
                </td>
                <td className={cx("liczba px-3 py-2 text-right", pnlClass(g.stats.expectancyR))}>
                  {rValue(g.stats.expectancyR)}
                </td>
                <td className="liczba px-3 py-2 text-right text-muted">
                  {percent(g.stats.winRate)}
                </td>
                <td className="liczba px-3 py-2 text-right text-muted">
                  {g.stats.profitFactor === null ? "—" : num(g.stats.profitFactor, 2)}
                </td>
                <td className="liczba px-3 py-2 text-right text-faint">
                  {g.stats.avgDurationS === null
                    ? "—"
                    : `${Math.round(g.stats.avgDurationS / 60)} min`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
