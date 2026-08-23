/**
 * Miernik dyscypliny.
 *
 * Nie ocenia wynikow, tylko zachowanie: czy trade mial stop, czy zasady byly
 * odhaczone, czy pozycja rosla po stracie, czy wejscie padlo tuz po stracie.
 * Kazdy sygnal ma wage; wynik to sto minus suma wag przemnozonych przez udzial
 * trade'ow, ktore go wywolaly.
 *
 * UWAGA (ADR-018): dolozenie sygnalu "zla_egzekucja" przesunelo skale. Wyniki
 * sprzed tej zmiany NIE sa porownywalne z pozniejszymi - to swiadomy koszt,
 * przyjety dlatego, ze niepotrzebne BE i za wczesne wyjscie sa zachowaniem,
 * a ten miernik jest wlasnie o zachowaniu.
 */

import type { TradeForAnalysis } from "./types";

export type Signal = {
  code: string;
  title: string;
  description: string;
  count: number;
  share: number;
  weight: number;
  tradeIds: number[];
};

export type DisciplineResult = {
  score: number;
  count: number;
  signals: Signal[];
};

type Options = {
  /** Ile sekund po stracie wejscie uznajemy za odwet. */
  revengeWindowS?: number;
};

const DEFINITIONS = [
  {
    code: "no_stop",
    title: "Trade bez stopa",
    description: "Bez zdefiniowanego ryzyka nie da się policzyć R ani kontrolować straty.",
    weight: 25,
  },
  {
    code: "broken_rules",
    title: "Złamane własne zasady",
    description: "Checklista strategii nie została odhaczona w całości.",
    weight: 25,
  },
  {
    code: "size_up_after_loss",
    title: "Powiększenie pozycji po stracie",
    description: "Kolejny trade był większy od poprzedniego, który zakończył się stratą.",
    weight: 20,
  },
  {
    code: "revenge",
    title: "Wejście tuż po stracie",
    description: "Wejście w ciągu kilku minut od zamknięcia stratnego trade'a.",
    weight: 20,
  },
  {
    code: "zla_egzekucja",
    title: "Zepsuta egzekucja przy dobrym kierunku",
    description:
      "Kierunek był trafiony, ale trade skończył się niepotrzebnym BE albo za wczesnym wyjściem. " +
      "Niepotrzebny stop celowo nie liczy się tutaj — zbyt ciasny stop to błąd planu, nie dyscypliny.",
    weight: 15,
  },
  {
    code: "risk_above_norm",
    title: "Ryzyko ponad własną normę",
    description: "Ryzyko przekroczyło półtora raza medianę pozostałych trade'ów.",
    weight: 10,
  },
] as const;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function scoreDiscipline(
  trades: TradeForAnalysis[],
  options: Options = {},
): DisciplineResult {
  const revengeWindow = (options.revengeWindowS ?? 300) * 1000;
  const ordered = [...trades].sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime());

  const hits = new Map<string, number[]>(DEFINITIONS.map((d) => [d.code, []]));
  const add = (code: string, id: number) => hits.get(code)?.push(id);

  const riskMedian = median(
    ordered.map((t) => t.riskAmount).filter((r): r is number => r !== null && r > 0),
  );

  ordered.forEach((t, i) => {
    if (!t.hasStop) add("no_stop", t.id);
    if (t.hasRules && t.rulesMet < t.ruleCount) add("broken_rules", t.id);
    if (
      t.kierunekTrafiony === true &&
      (t.badExecutionReason === "unnecessary_be" || t.badExecutionReason === "early_exit")
    ) {
      add("zla_egzekucja", t.id);
    }
    if (riskMedian !== null && t.riskAmount !== null && t.riskAmount > riskMedian * 1.5) {
      add("risk_above_norm", t.id);
    }

    const previous = ordered[i - 1];
    if (!previous || previous.pnl >= 0) return;
    if (t.contracts > previous.contracts) add("size_up_after_loss", t.id);

    const previousEnd = previous.entryTime.getTime() + (previous.durationS ?? 0) * 1000;
    const gap = t.entryTime.getTime() - previousEnd;
    if (gap >= 0 && gap <= revengeWindow && t.tradingDay === previous.tradingDay) {
      add("revenge", t.id);
    }
  });

  const count = ordered.length;
  const signals: Signal[] = DEFINITIONS.map((d) => {
    const ids = hits.get(d.code) ?? [];
    return {
      code: d.code,
      title: d.title,
      description: d.description,
      count: ids.length,
      share: count > 0 ? ids.length / count : 0,
      weight: d.weight,
      tradeIds: ids,
    };
  });

  const penalty = signals.reduce((s, signal) => s + signal.share * signal.weight, 0);
  const score = count === 0 ? 100 : Math.max(0, Math.round(100 - penalty));

  return { score, count, signals: signals.filter((s) => s.count > 0) };
}
