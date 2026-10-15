import { Lock } from "lucide-react";

import { Markdown } from "@/components/trade/markdown";
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

/*
 * Werdykt reguly to zawsze tekst + znak, nigdy sam kolor. UI v2: zielen i czerwien sa tylko dla
 * wyniku (kierunek.md, „Co zostaje z marki”), wiec zlamana regula dostaje akcent (rola ostrzezenia,
 * jak progi prop), zgodna neutralny kontur.
 */
const WERDYKT_KLASY: Record<Werdykt, string> = {
  pass: "border-line-strong text-text",
  fail: "border-accent/60 bg-accent-dim text-accent-strong",
  na: "border-line text-muted",
  unclear: "border-dashed border-line-strong text-muted",
};

const WERDYKT_ZNAK: Record<Werdykt, string> = { pass: "✓", fail: "✗", na: "–", unclear: "?" };

type DaneTradu = {
  id: number;
  status: string;
  entryPrice: string | number | null;
  stopLoss: string | number | null;
  takeProfit: string | number | null;
  tickSize: string | number | null;
  exchangeTimezone: string;
};

export type MetaWerdyktu = {
  asOf: string | null;
  evidenceHash: string | null;
  rulesetVersion: number | null;
  lookAhead: boolean | null;
  model: string | null;
};

const liczbaLubNull = (w: string | number | null | undefined): number | null => {
  if (w === null || w === undefined || w === "") return null;
  const n = Number(w);
  return Number.isFinite(n) ? n : null;
};

/**
 * Panel "Ocena AI" (ADR-028; UI v2 wzór 3w: panel „Basis” z parallel.ai, Refero 1f946f8c): uzasadnienie,
 * pod nim numerowane dowody [1] [2] = warunki reguły z dowodem, `as_of`, hash, wersja reguł. Tekst z AI
 * renderuje `Markdown` (bez surowego HTML). Najnowsza ocena rozwinięta, starsze zwinięte. Wynik trade'a
 * zakryty paskiem, dopóki trade z werdyktem nie jest zamknięty (`wynikUkryty`, MUST 2).
 */
export function OcenaAiPanel({
  trade,
  oceny,
  meta,
  wynikUkryty = false,
}: {
  trade: DaneTradu;
  oceny: OcenaZRegulami[];
  meta?: Map<number, MetaWerdyktu>;
  wynikUkryty?: boolean;
}) {
  if (oceny.length === 0) {
    return (
      <section className="panel karta p-5 sm:p-6">
        <h2 className="text-sekcja text-text">Ocena AI</h2>
        <p className="mt-1 text-meta text-muted">Mózg oceni ten trade względem reguł, zanim zobaczy wynik.</p>
        <p className="mt-6 text-meta text-faint">Ten trade nie ma jeszcze oceny.</p>
      </section>
    );
  }

  const posortowane = [...oceny].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const [najnowsza, ...starsze] = posortowane;

  return (
    <section className="panel karta overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-sekcja text-text">Ocena AI</h2>
          <p className="mt-0.5 text-meta text-muted">Interpretacja AI z chwili decyzji. Nie zmienia wyniku trade&apos;a.</p>
        </div>
        <span className="inline-flex h-6 items-center rounded-full border border-line-strong px-2 text-grupa text-muted">interpretacja AI</span>
      </header>
      {wynikUkryty && (
        <p className="flex items-center gap-2 border-b border-line bg-accent-dim px-5 py-2.5 text-meta text-accent-strong sm:px-6">
          <Lock size={14} aria-hidden /> Wynik ukryty do zamknięcia trade&apos;a: werdykt powstał przed wynikiem i ma tak zostać.
        </p>
      )}
      <OcenaTresc trade={trade} ocena={najnowsza} meta={meta?.get(najnowsza.id)} />
      {starsze.length > 0 && (
        <div className="border-t border-line">
          {starsze.map((o) => (
            <details key={o.id} className="border-b border-line last:border-b-0">
              <summary className="przejscie flex cursor-pointer flex-wrap items-center gap-x-2 px-5 py-3 text-meta text-muted hover:text-text sm:px-6">
                Starsza ocena: {PODSTAWA_NAZWY[o.basis]}
                <span className="num text-faint">{dateTime(o.createdAt, trade.exchangeTimezone)}</span>
              </summary>
              <OcenaTresc trade={trade} ocena={o} meta={meta?.get(o.id)} />
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function OcenaTresc({ trade, ocena, meta }: { trade: DaneTradu; ocena: OcenaZRegulami; meta?: MetaWerdyktu }) {
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
    <div data-ocena className="space-y-6 px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta">
        <span title={PODSTAWA_OPISY[ocena.basis]} className="inline-flex h-6 items-center rounded-full border border-line-strong px-2 text-muted">
          {PODSTAWA_NAZWY[ocena.basis]}
        </span>
        {ocena.setupType && (
          <span className="text-text">
            <span className="mr-1.5 text-muted">Setup</span>
            {ocena.setupType}
          </span>
        )}
        <span className="num text-faint">
          {dateTime(ocena.createdAt, trade.exchangeTimezone)}
          {ocena.brainVersion && <> · wersja mózgu {ocena.brainVersion.slice(0, 8)}</>}
        </span>
      </div>

      <div className="rounded-[var(--radius-tab)] border border-line bg-bg/40 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-meta text-muted">Werdykt mózgu</p>
          <p className="text-karta font-semibold text-text">{ocena.brainVerdict ? WERDYKT_MOZGU_NAZWY[ocena.brainVerdict] : "brak"}</p>
          <p className={cx("text-meta", decyzja.wynik === "odstepstwo" ? "text-accent-strong" : decyzja.wynik === "brak" ? "text-faint" : "text-muted")}>
            {decyzja.opis}
          </p>
        </div>

        {maPlan && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-meta">
              <caption className="sr-only">Plan mózgu obok tego, co zrobiłeś, z różnicą w tickach</caption>
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-1.5 pr-3 text-left font-normal">Poziom</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-normal">Plan mózgu</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-normal">Ty</th>
                  <th scope="col" className="py-1.5 pl-3 text-right font-normal">Różnica</th>
                </tr>
              </thead>
              <tbody>
                {wiersze.map((w) => (
                  <tr key={w.klucz} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted">
                      {w.etykieta}
                    </th>
                    <td className="num px-2 py-1.5 text-right">{price(w.mozg, trade.tickSize)}</td>
                    <td className="num px-2 py-1.5 text-right">{price(w.uzytkownik, trade.tickSize)}</td>
                    <td className="num py-1.5 pl-3 text-right text-muted">
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
          <p className="mt-2 text-meta text-faint">
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
          <h3 className="mb-2 text-karta text-text">Uzasadnienie</h3>
          <Markdown>{ocena.summaryMd}</Markdown>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-karta text-text">Dowody</h3>
        {ocena.reguly.length === 0 ? (
          <p className="text-meta text-faint">Ocena nie sprawdzała żadnych reguł.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {ocena.reguly.map((r, i) => (
              <li key={r.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2">
                <span className="num pt-0.5 text-meta text-faint">[{i + 1}]</span>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-meta text-accent">{r.ruleId}</span>
                    <span className="sr-only">Werdykt: </span>
                    <span className={cx("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-grupa whitespace-nowrap", WERDYKT_KLASY[r.verdict])}>
                      <span aria-hidden>{WERDYKT_ZNAK[r.verdict]}</span>
                      {WERDYKT_REGULY_NAZWY[r.verdict]}
                    </span>
                  </div>
                  <p className="text-karta whitespace-pre-wrap text-text">{r.ruleText}</p>
                  <p className="text-meta whitespace-pre-wrap text-muted">
                    <span className="mr-1.5 text-faint">Dowód</span>
                    {r.evidence ?? "—"}
                  </p>
                  <ZdanieORegule tradeId={trade.id} checkId={r.id} ruleId={r.ruleId} poczatkowe={r.userVerdict} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {ocena.lesson && (
        <div className="border-l-2 border-accent pl-3">
          <p className="text-meta text-accent-strong">Lekcja</p>
          <Markdown className="mt-0.5">{ocena.lesson}</Markdown>
        </div>
      )}

      {meta && (meta.asOf || meta.evidenceHash) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-meta sm:grid-cols-4">
          <div>
            <dt className="text-faint">as_of</dt>
            <dd className="num text-muted">{meta.asOf ? dateTime(meta.asOf, trade.exchangeTimezone) : "—"}</dd>
          </div>
          <div>
            <dt className="text-faint">Hash danych</dt>
            <dd className="num text-muted" title={meta.evidenceHash ?? undefined}>{meta.evidenceHash ? meta.evidenceHash.slice(0, 12) : "—"}</dd>
          </div>
          <div>
            <dt className="text-faint">Wersja reguł</dt>
            <dd className="num text-muted">{meta.rulesetVersion ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-faint">Model</dt>
            <dd className="num text-muted">
              {meta.model ?? "—"}
              {meta.lookAhead && <span className="block text-accent-strong">mógł znać ten dzień</span>}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
