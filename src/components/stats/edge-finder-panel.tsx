import { Panel } from "@/components/ui/base";
import type { EdgeFinderResult, Finding } from "@/lib/domain/edge-finder";
import { cx } from "@/lib/classes";
import { money, percent, rValue, tradesCount } from "@/lib/format";

/**
 * Edge Finder w interfejsie. Kazde znalezisko pokazuje wielkosc probki obok
 * liczby - bez tego "setup X ma 3R" znaczy tyle co nic.
 */
function FindingRow({
  finding,
  currency,
  kind,
}: {
  finding: Finding;
  currency: string;
  kind: "edge" | "leak";
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span
        className={cx(
          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
          kind === "edge" ? "bg-profit" : "bg-loss",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text">
          {finding.conditions.map((c, i) => (
            <span key={c.dimension}>
              {i > 0 && <span className="text-faint"> + </span>}
              <span className="text-faint">{c.dimension}: </span>
              {c.value}
            </span>
          ))}
        </p>
        <p className="liczba mt-0.5 text-xs text-faint">
          {tradesCount(finding.count)} · {percent(finding.share, 0)} wszystkich · skuteczność{" "}
          {percent(finding.winRate)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cx("liczba text-sm", kind === "edge" ? "text-profit" : "text-loss")}>
          {finding.deltaR === null
            ? money(finding.deltaCash, { currency, sign: true })
            : rValue(finding.deltaR)}
        </p>
        <p className="liczba text-xs text-faint">
          {finding.expectancyR === null
            ? money(finding.expectancyCash, { currency })
            : `${rValue(finding.expectancyR, false)} na trade`}
        </p>
      </div>
    </li>
  );
}

export function EdgeFinderPanel({
  result,
  currency,
  minSample,
}: {
  result: EdgeFinderResult;
  currency: string;
  minSample: number;
}) {
  const nothing = result.edges.length === 0 && result.leaks.length === 0;

  return (
    <Panel
      title="Edge Finder"
      description={`Konteksty odstające od średniej. Próg istotności: ${minSample} trade'ów, sprawdzono ${result.contextsChecked} kombinacji.`}
    >
      {nothing ? (
        <p className="px-4 py-6 text-sm text-faint">
          Żaden kontekst nie przekroczył progu {minSample} trade&apos;ów. Pomięto{" "}
          {result.skippedTooSmall} kombinacji jako zbyt małe próbki — zbierz więcej danych.
        </p>
      ) : (
        <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-line">
          <div>
            <p className="etykieta border-b border-line px-4 py-2">Tu masz przewagę</p>
            {result.edges.length === 0 ? (
              <p className="px-4 py-4 text-sm text-faint">Nic nie odstaje w górę.</p>
            ) : (
              <ul className="divide-y divide-line">
                {result.edges.map((z) => (
                  <FindingRow key={z.key} finding={z} currency={currency} kind="edge" />
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="etykieta border-b border-line px-4 py-2">Tu tracisz</p>
            {result.leaks.length === 0 ? (
              <p className="px-4 py-4 text-sm text-faint">Nic nie odstaje w dół.</p>
            ) : (
              <ul className="divide-y divide-line">
                {result.leaks.map((z) => (
                  <FindingRow key={z.key} finding={z} currency={currency} kind="leak" />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
