import { Badge, Panel } from "@/components/ui/base";
import { ZdanieORegule } from "@/components/trades/zdanie-o-regule";
import { cx } from "@/lib/classes";
import {
  PODSTAWA_NAZWY,
  PODSTAWA_OPISY,
  WERDYKT_MOZGU_NAZWY,
  WERDYKT_REGULY_NAZWY,
  decyzjaWzgledemMozgu,
  porownajPlan,
} from "@/lib/domain/ocena-ai";
import type { Werdykt } from "@/lib/domain/zgodnosc";
import { dateTime, num, price } from "@/lib/format";
import type { OcenaZRegulami } from "@/lib/queries/oceny";

/* Werdykt reguly to zawsze tekst + kolor, nigdy sam kolor. */
const WERDYKT_KLASY: Record<Werdykt, string> = {
  pass: "border-profit/50 bg-profit-dim text-profit-bright",
  fail: "border-loss/50 bg-loss-dim text-loss-bright",
  na: "border-line-strong text-muted",
  unclear: "border-accent/50 bg-accent-dim text-accent-strong",
};

type DaneTradu = {
  id: number;
  status: string;
  entryPrice: string | number | null;
  stopLoss: string | number | null;
  takeProfit: string | number | null;
  tickSize: string | number | null;
  exchangeTimezone: string;
};

const liczbaLubNull = (w: string | number | null | undefined): number | null => {
  if (w === null || w === undefined || w === "") return null;
  const n = Number(w);
  return Number.isFinite(n) ? n : null;
};

/**
 * Panel "Ocena AI" (ADR-028). Tekst z oceny pochodzi z zewnatrz (API), wiec
 * wszedzie idzie jako zwykly tekst z `whitespace-pre-wrap`, nigdy jako HTML.
 * Najnowsza ocena rozwinieta, starsze zwiniete.
 */
export function OcenaAiPanel({ trade, oceny }: { trade: DaneTradu; oceny: OcenaZRegulami[] }) {
  if (oceny.length === 0) {
    return (
      <Panel title="Ocena AI" description="Mózg oceni ten trade względem reguł.">
        <p className="px-4 py-6 text-sm text-faint">Ten trade nie ma jeszcze oceny.</p>
      </Panel>
    );
  }

  const posortowane = [...oceny].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const [najnowsza, ...starsze] = posortowane;

  return (
    <Panel
      title="Ocena AI"
      description="Co powiedział mózg i jak to wyszło względem reguł. Nie zmienia wyniku trade'a."
    >
      <OcenaTresc trade={trade} ocena={najnowsza} />
      {starsze.length > 0 && (
        <div className="border-t border-line">
          {starsze.map((o) => (
            <details key={o.id} className="border-b border-line last:border-b-0">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 px-4 py-2.5 text-sm text-muted hover:text-text">
                Starsza ocena: {PODSTAWA_NAZWY[o.basis]}
                <span className="liczba text-xs text-faint">{dateTime(o.createdAt, trade.exchangeTimezone)}</span>
              </summary>
              <OcenaTresc trade={trade} ocena={o} />
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}

function OcenaTresc({ trade, ocena }: { trade: DaneTradu; ocena: OcenaZRegulami }) {
  const plan = ocena.brainPlan;
  const wiersze = porownajPlan(
    plan,
    {
      entry: liczbaLubNull(trade.entryPrice),
      stopLoss: liczbaLubNull(trade.stopLoss),
      takeProfit: liczbaLubNull(trade.takeProfit),
    },
    liczbaLubNull(trade.tickSize),
  );
  const decyzja = decyzjaWzgledemMozgu(ocena.brainVerdict, trade.status);
  const maPlan = wiersze.some((w) => w.mozg !== null);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge title={PODSTAWA_OPISY[ocena.basis]}>{PODSTAWA_NAZWY[ocena.basis]}</Badge>
        {ocena.setupType && (
          <span className="text-sm text-text">
            <span className="etykieta mr-1.5">Setup</span>
            {ocena.setupType}
          </span>
        )}
        <span className="liczba text-xs text-faint">
          {dateTime(ocena.createdAt, trade.exchangeTimezone)}
          {ocena.brainVersion && <> · wersja mózgu {ocena.brainVersion.slice(0, 8)}</>}
        </span>
      </div>

      <div className="rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="etykieta">Werdykt mózgu</p>
          <p className="text-base font-semibold text-text">
            {ocena.brainVerdict ? WERDYKT_MOZGU_NAZWY[ocena.brainVerdict] : "brak"}
          </p>
          <p
            className={cx(
              "text-sm",
              decyzja.wynik === "zgodna" && "text-profit",
              decyzja.wynik === "odstepstwo" && "text-accent",
              decyzja.wynik === "brak" && "text-faint",
            )}
          >
            {decyzja.opis}
          </p>
        </div>

        {maPlan && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Plan mózgu obok tego, co zrobiłeś, z różnicą w tickach</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="etykieta py-1.5 pr-3 text-left">Poziom</th>
                  <th scope="col" className="etykieta px-2 py-1.5 text-right">Plan mózgu</th>
                  <th scope="col" className="etykieta px-2 py-1.5 text-right">Ty</th>
                  <th scope="col" className="etykieta py-1.5 pl-3 text-right">Różnica</th>
                </tr>
              </thead>
              <tbody>
                {wiersze.map((w) => (
                  <tr key={w.klucz} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted">
                      {w.etykieta}
                    </th>
                    <td className="liczba px-2 py-1.5 text-right">{price(w.mozg, trade.tickSize)}</td>
                    <td className="liczba px-2 py-1.5 text-right">{price(w.uzytkownik, trade.tickSize)}</td>
                    <td className="liczba py-1.5 pl-3 text-right text-muted">
                      {w.roznicaTickow === null
                        ? "—"
                        : `${w.roznicaTickow > 0 ? "+" : ""}${num(w.roznicaTickow, Number.isInteger(w.roznicaTickow) ? 0 : 2)} tick.`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {typeof plan?.interwalWejscia === "string" && plan.interwalWejscia !== "" && (
          <p className="mt-2 text-xs text-faint">
            Wejście szukane na {plan.interwalWejscia}
            {/* Stare wiersze mogly zapisac plan bez walidacji typow. */}
            {Array.isArray(plan.interwalyKontekstu) && plan.interwalyKontekstu.length > 0
              ? `, kontekst z ${plan.interwalyKontekstu.filter((x) => typeof x === "string").join(", ")}`
              : ""}
            .
          </p>
        )}
      </div>

      {ocena.summaryMd && (
        <div>
          <p className="etykieta">Co było inne</p>
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-text">{ocena.summaryMd}</p>
        </div>
      )}

      <div>
        <p className="etykieta mb-1.5">Reguły</p>
        {ocena.reguly.length === 0 ? (
          <p className="text-sm text-faint">Ocena nie sprawdzała żadnych reguł.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {ocena.reguly.map((r) => (
              <li
                key={r.id}
                className="grid gap-x-4 gap-y-2 px-3 py-2.5 text-sm md:grid-cols-[minmax(0,2fr)_auto_minmax(0,2fr)_auto] md:items-start"
              >
                <div className="min-w-0">
                  <span className="liczba text-xs text-accent">{r.ruleId}</span>
                  <p className="mt-0.5 whitespace-pre-wrap text-text">{r.ruleText}</p>
                </div>
                <div>
                  <span className="sr-only">Werdykt: </span>
                  <span
                    className={cx(
                      "inline-flex rounded-[var(--radius-control)] border px-1.5 py-0.5 text-xs whitespace-nowrap",
                      WERDYKT_KLASY[r.verdict],
                    )}
                  >
                    {WERDYKT_REGULY_NAZWY[r.verdict]}
                  </span>
                </div>
                <p className="min-w-0 whitespace-pre-wrap text-muted">
                  <span className="etykieta mr-1.5 md:hidden">Dowód</span>
                  {r.evidence ?? "—"}
                </p>
                <ZdanieORegule
                  tradeId={trade.id}
                  checkId={r.id}
                  ruleId={r.ruleId}
                  poczatkowe={r.userVerdict}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {ocena.lesson && (
        <div className="border-l-2 border-accent bg-accent-dim px-3 py-2">
          <p className="etykieta text-accent-strong">Lekcja</p>
          <p className="mt-0.5 text-sm whitespace-pre-wrap text-text">{ocena.lesson}</p>
        </div>
      )}
    </div>
  );
}
