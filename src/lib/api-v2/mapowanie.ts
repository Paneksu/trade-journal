import type { WskaznikDyscypliny } from "@/lib/domain/discipline";
import type { SiatkaProcesu, Komorka } from "@/lib/domain/process-grid";
import type { EkspozycjaNq, StanKonta } from "@/lib/domain/prop";
import type { OstrzezenieWariantow } from "@/lib/domain/stats-ci";

/**
 * Domena (`lib/domain`) nazywa pola po polsku (to jej wewnetrzny jezyk, jak reszta modulu), a
 * kontrakt API v2 ma jeden jezyk kluczy: angielski camelCase, jak `aiInterpretation` czy
 * `tradeId`. Te funkcje tlumacza wyniki domeny na ksztalt z kontraktu; wartosci zostaja bez zmian.
 */

export function komorkaDoApi(k: Komorka) {
  return { count: k.count, sumR: k.sumR, countR: k.countR, avgR: k.avgR, sumPnlCents: k.sumPnlCents, tradeIds: k.tradeIds };
}

export function siatkaDoApi(s: SiatkaProcesu) {
  const rozklad = (o: "A" | "B" | "C") => ({ ...komorkaDoApi(s.rozklad[o]), share: s.rozklad[o].udzial });
  return {
    goodProcessWin: komorkaDoApi(s.zasluzonyZysk),
    /** »Dobra strata«: proces w porzadku, wynik zly - nic do naprawiania. */
    goodProcessLoss: komorkaDoApi(s.dobraStrata),
    /** »Szczescie«: zly proces, dobry wynik - najgrozniejsza komorka. */
    badProcessWin: komorkaDoApi(s.szczescie),
    badProcessLoss: komorkaDoApi(s.zasluzonaStrata),
    breakEvenGoodProcess: komorkaDoApi(s.beDobryProces),
    breakEvenBadProcess: komorkaDoApi(s.beZlyProces),
    ungraded: komorkaDoApi(s.nieocenione),
    graded: s.ocenione,
    distribution: { A: rozklad("A"), B: rozklad("B"), C: rozklad("C") },
    costOfC: { count: s.kosztGryC.count, sumR: s.kosztGryC.sumR, sumPnlCents: s.kosztGryC.sumPnlCents },
  };
}

export function dyscyplinaDoApi(d: WskaznikDyscypliny) {
  return {
    trades: d.trades,
    graded: d.ocenione,
    a: d.a,
    b: d.b,
    c: d.c,
    shareA: d.udzialA,
    violations: d.naruszenia.map((n) => ({ code: n.kod, title: n.tytul, description: n.opis, count: n.count, tradeIds: n.tradeIds })),
    tradeIdsWithViolation: d.tradeIdsZNaruszeniem,
    violationCost: { count: d.kosztNaruszen.count, sumR: d.kosztNaruszen.sumR, sumPnlCents: d.kosztNaruszen.sumPnlCents },
    reviews: {
      daysRequired: d.przeglady.dniWymagane,
      daysCompleted: d.przeglady.dniWypelnione,
      weeksRequired: d.przeglady.tygodnieWymagane,
      weeksApproved: d.przeglady.tygodnieZatwierdzone,
    },
    perDay: d.perDzien.map((p) => ({ day: p.day, trades: p.trades, graded: p.ocenione, a: p.a, shareA: p.udzialA, violations: p.naruszenia })),
  };
}

export function stanKontaDoApi(s: StanKonta) {
  const c = s.consistency;
  const p = s.poSl;
  return {
    startBalanceCents: s.saldoStartCents,
    balanceCents: s.saldoCents,
    profitCents: s.zyskCents,
    trailingBasis: s.podstawaTrailingu,
    trailingBasisCertain: s.podstawaPewna,
    peakCents: s.szczytCents,
    lockProfitCents: s.zyskBlokadyCents,
    lockReached: s.progZablokowany,
    drawdownFloorCents: s.progDdCents,
    drawdownBufferCents: s.buforDdCents,
    drawdownUsed: s.zuzycieDd,
    todayPnlCents: s.dzisPnlCents,
    dailyLossBufferCents: s.buforDllCents,
    dailyLossUsed: s.zuzycieDll,
    nearestLimit: s.najblizszyLimit,
    bufferCents: s.buforCents,
    ifStopHit: p
      ? {
          riskCents: p.ryzykoCents,
          drawdownBufferAfterCents: p.buforDdPoSlCents,
          dailyLossBufferAfterCents: p.buforDllPoSlCents,
          bufferAfterCents: p.buforPoSlCents,
          drawdownUsedAfter: p.zuzycieDdPoSl,
          dailyLossUsedAfter: p.zuzycieDllPoSl,
          bufferInR: p.buforWR,
          drawdownBufferInR: p.buforDdWR,
          dailyLossBufferInR: p.buforDllWR,
          exceedsLimit: p.przekroczy,
        }
      : null,
    warnings: s.ostrzezenia.map((o) => ({ code: o.kod, level: o.poziom, text: o.tekst })),
    consistency: c
      ? {
          pct: c.pct,
          basis: c.podstawa,
          effect: c.skutek,
          certain: c.pewne,
          bestDayCents: c.najlepszyDzienCents,
          denominatorCents: c.mianownikCents,
          share: c.udzial,
          violated: c.naruszona,
          nearLimit: c.naGranicy,
          requiredTargetCents: c.wymaganyCelCents,
          remainingTodayCents: c.zostaloDzisCents,
        }
      : null,
    target: s.cel ? { profitCents: s.cel.zyskCents, targetCents: s.cel.celCents, remainingCents: s.cel.brakCents, reached: s.cel.osiagniety } : null,
    tradingDays: s.dniHandlowe,
    minDays: s.minDni ? { required: s.minDni.wymagane, have: s.minDni.mamy, met: s.minDni.spelnione } : null,
    notes: s.uwagi,
  };
}

export function ekspozycjaDoApi(e: EkspozycjaNq) {
  return {
    total: e.lacznie,
    perAccount: e.perKonto.map((k) => ({ accountId: k.accountId, nqEquivalent: k.ekwiwalentNq, nqContracts: k.kontraktyNq, mnqContracts: k.kontraktyMnq })),
    skippedSymbols: e.pominiete,
  };
}

export function ostrzezenieWariantowDoApi(o: OstrzezenieWariantow) {
  return { count: o.k, n: o.n, inflated: o.zawyzony, inflationSigma: o.zawyzenieSigma, text: o.tekst };
}
