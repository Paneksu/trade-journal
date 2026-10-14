import "server-only";
import { and, eq, isNotNull, type SQL } from "drizzle-orm";

import { accounts, backtestSessions, trades } from "@/lib/db/schema";
import { wynikTrade, type Progi } from "@/lib/domain/outcome";
import {
  DOMYSLNE_PROGI_STATUSU,
  progiStatusuZJson,
  STATUS_NAZWY,
  statusZWynikow,
  type OcenaStatusu,
  type Pomiar,
  type ProgiStatusu,
} from "@/lib/domain/stats-ci";
import { sqlZrodloDanych, ZRODLA_DANYCH, type ZrodloDanych } from "@/lib/domain/zrodla";
import { getProgi } from "@/lib/queries/dictionaries";

import type { Transakcja } from "./with-api";

type Db = Transakcja | typeof import("@/lib/db").db;

/**
 * Uczciwa statystyka (ADR-033, MUST 5 i 6) dla grupy zamknietych trade'ow: kazda liczba z `n`
 * i przedzialem, osobno dla zrodel danych (backtest / forward / demo / live), bo ich
 * lacznie nie wolno mieszac bez swiadomej decyzji. W tabelach docelowych jest tylko to,
 * co zatwierdzil uzytkownik (sugestie AI trafiaja tam dopiero po zatwierdzeniu), wiec
 * nic tu nie trzeba odfiltrowywac.
 */

export type WierszPomiaru = { id: number; pomiar: Pomiar; r: number };

export type PomiaryPoZrodlach = Record<ZrodloDanych, WierszPomiaru[]>;

/**
 * Zamkniete trade'y z policzonym R, pogrupowane wg zrodla danych. `warunek` zaweza zbior
 * (np. `trades.setup_id = 7`). Klasa wyniku (zysk / strata / BE) wynika z progu BE
 * z ustawien (ADR-011), nie ze znaku R.
 */
export async function pomiaryZamknietych(tx: Db, warunek: SQL, progi?: Progi): Promise<PomiaryPoZrodlach> {
  const p = progi ?? (await getProgi());
  const wiersze = await tx
    .select({
      id: trades.id,
      r: trades.rMultiple,
      pnl: trades.pnl,
      riskAmount: trades.riskAmount,
      contracts: trades.contracts,
      zrodlo: sqlZrodloDanych({
        backtestSessionId: trades.backtestSessionId,
        rodzajSesji: backtestSessions.kind,
        typKonta: accounts.type,
      }).as("zrodlo"),
    })
    .from(trades)
    .innerJoin(accounts, eq(trades.accountId, accounts.id))
    .leftJoin(backtestSessions, eq(trades.backtestSessionId, backtestSessions.id))
    .where(and(eq(trades.status, "closed"), isNotNull(trades.rMultiple), warunek))
    .orderBy(trades.entryTime, trades.id);

  const wynik: PomiaryPoZrodlach = { backtest: [], forward: [], demo: [], live: [] };
  for (const w of wiersze) {
    if (w.r === null || w.pnl === null) continue;
    const r = Number(w.r);
    const klasa = wynikTrade({ pnl: Number(w.pnl), riskAmount: w.riskAmount === null ? null : Number(w.riskAmount), contracts: Number(w.contracts) }, p);
    const zrodlo = (ZRODLA_DANYCH as readonly string[]).includes(String(w.zrodlo)) ? (w.zrodlo as ZrodloDanych) : "live";
    wynik[zrodlo].push({ id: w.id, r, pomiar: { r, wynik: klasa } });
  }
  return wynik;
}

export type StatystykaZrodla = {
  n: number;
  wins: number;
  losses: number;
  winRate: { p: number | null; low: number | null; high: number | null };
  breakEvenWinRate: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancyR: { mean: number | null; low: number | null; high: number | null; orientacyjnie: boolean };
  status: OcenaStatusu["status"];
  statusNazwa: string;
  statusPowod: OcenaStatusu["powod"];
  opis: string;
  progi: ProgiStatusu;
};

export function zOceny(o: OcenaStatusu): StatystykaZrodla {
  return {
    n: o.n,
    wins: o.wins,
    losses: o.losses,
    winRate: { p: o.wilson.p, low: o.wilson.low, high: o.wilson.high },
    breakEvenWinRate: o.breakEven.winRate,
    avgWinR: o.breakEven.avgWinR,
    avgLossR: o.breakEven.avgLossR,
    expectancyR: { mean: o.expectancy.mean, low: o.expectancy.low, high: o.expectancy.high, orientacyjnie: o.expectancy.orientacyjnie },
    status: o.status,
    statusNazwa: STATUS_NAZWY[o.status],
    statusPowod: o.powod,
    opis: o.opis,
    progi: o.progi,
  };
}

/** Progi z jsonb wersji setupu albo hipotezy; uszkodzone wracaja do domyslnych (z uwaga w `blad`). */
export function progiZJson(surowe: unknown): { progi: ProgiStatusu; blad: string | null } {
  const w = progiStatusuZJson(surowe);
  return w.ok ? { progi: w.progi, blad: null } : { progi: { ...DOMYSLNE_PROGI_STATUSU }, blad: w.error };
}

export type StatystykaPoZrodlach = {
  bySource: Record<ZrodloDanych, StatystykaZrodla | null>;
  /** Ile R znika miedzy backtestem a live (R6): roznica srednich R z przedzialami; `null`, gdy brak jednego ze zrodel. */
  backtestToLive: { backtestR: number; liveR: number; diffR: number; backtestN: number; liveN: number; orientacyjnie: boolean } | null;
};

export function statystykaPoZrodlach(pomiary: PomiaryPoZrodlach, progi: ProgiStatusu): StatystykaPoZrodlach {
  const bySource = {} as Record<ZrodloDanych, StatystykaZrodla | null>;
  for (const z of ZRODLA_DANYCH) {
    bySource[z] = pomiary[z].length === 0 ? null : zOceny(statusZWynikow(pomiary[z].map((w) => w.pomiar), progi));
  }
  const bt = bySource.backtest?.expectancyR.mean;
  const lv = bySource.live?.expectancyR.mean;
  const backtestToLive =
    bt != null && lv != null && bySource.backtest && bySource.live
      ? {
          backtestR: bt,
          liveR: lv,
          diffR: bt - lv,
          backtestN: bySource.backtest.n,
          liveN: bySource.live.n,
          orientacyjnie: bySource.backtest.expectancyR.orientacyjnie || bySource.live.expectancyR.orientacyjnie,
        }
      : null;
  return { bySource, backtestToLive };
}

