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

/* ---------------------------------------------------------------------------
   Wskaznik dyscypliny z regul (ADR-033, MUST 8; metodyka R19)
   ---------------------------------------------------------------------------
   STOI OBOK `scoreDiscipline`, nie zastepuje go: tamten liczy sygnaly zachowania
   z samych trade'ow (ADR-011/018) i daje jedna skale 0-100, ten liczy zgodnosc z
   TWARDYMI regulami i oceną procesu, a wyniku nie zamienia na jedna liczbe
   (nie robimy "edge score"). Wyniki obu nie sa porownywalne.

   Skladniki (kazdy osobno, kazdy z licznikiem):
     - odsetek procesu A wsrod ocenionych trade'ow,
     - naruszenia twardych regul wyliczane z DANYCH, bez nowej tabeli:
         limit_tradeow   trade ponad `day_notes.max_trades` w danym dniu,
         poza_oknem      wejscie poza godzinami handlu z ustawien,
         ruszony_sl      SL trade'u rozni sie od SL zamrozonego planu,
         brak_planu      nie ma planu zamrozonego przed wejsciem,
     - wypelnione przeglady (dzienne i tygodniowe).
   "Przed wejsciem" dla sesji backtestu znaczy czas ZEGAROWY: `momentDecyzji`
   to `trades.created_at`, bo `entry_time` jest historyczny (model-danych 5.3).
*/

export const NARUSZENIA_REGUL = ["limit_tradeow", "poza_oknem", "ruszony_sl", "brak_planu"] as const;
export type NaruszenieRegul = (typeof NARUSZENIA_REGUL)[number];

export const NARUSZENIA_OPISY: Record<NaruszenieRegul, { tytul: string; opis: string }> = {
  limit_tradeow: { tytul: "Ponad limit trade'ów dnia", opis: "Trade wzięty po przekroczeniu dziennego limitu z notatki dnia." },
  poza_oknem: { tytul: "Handel poza oknem", opis: "Wejście poza własnymi godzinami handlu z ustawień." },
  ruszony_sl: { tytul: "Ruszony SL", opis: "Stop trade'u różni się od stopa zamrożonego w planie." },
  brak_planu: { tytul: "Trade bez planu", opis: "Plan nie został zamrożony przed wejściem." },
};

export type TradeDlaDyscypliny = {
  id: number;
  tradingDay: string;
  entryTime: Date;
  /** Chwila, wzgledem ktorej plan musi byc wczesniejszy: `entryTime` (zywy trade) albo `createdAt` (sesja backtestu). */
  momentDecyzji: Date;
  processGrade: "A" | "B" | "C" | null;
  stopLoss: number | null;
  /** Zamrozony plan trade'a; `null` = brak planu. */
  plan: { frozenAt: Date; stopLoss: number } | null;
  /** Minuta doby (0-1439) wejscia w strefie ustawien; `null` = nieznana. */
  minutaWejscia: number | null;
  pnlCents: number;
  rMultiple: number | null;
};

export type DzienDlaDyscypliny = {
  day: string;
  /** `day_notes.max_trades`; `null` = brak limitu. */
  maxTrades: number | null;
  /** Czy dzienny przeglad (po sesji) jest wypelniony. */
  przegladWypelniony: boolean;
};

/** Okno handlu w minutach doby; `odMin > doMin` oznacza okno przechodzace przez polnoc. */
export type OknoHandlu = { odMin: number; doMin: number };

/** "HH:MM" -> minuta doby albo `null` dla pustego/niepoprawnego. */
export function minutaZTekstu(tekst: string | null | undefined): number | null {
  if (!tekst) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(tekst.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function oknoHandluZUstawien(od: string | null | undefined, doo: string | null | undefined): OknoHandlu | null {
  const a = minutaZTekstu(od);
  const b = minutaZTekstu(doo);
  return a !== null && b !== null ? { odMin: a, doMin: b } : null;
}

function wOknie(minuta: number, okno: OknoHandlu): boolean {
  return okno.odMin <= okno.doMin
    ? minuta >= okno.odMin && minuta <= okno.doMin
    : minuta >= okno.odMin || minuta <= okno.doMin;
}

const rowne = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export type WskaznikDyscypliny = {
  trades: number;
  ocenione: number;
  a: number;
  b: number;
  c: number;
  /** A / ocenione; `null` gdy nic nie ocenione. */
  udzialA: number | null;
  naruszenia: { kod: NaruszenieRegul; tytul: string; opis: string; count: number; tradeIds: number[] }[];
  /** Trade'y z co najmniej jednym naruszeniem (bez powtorzen). */
  tradeIdsZNaruszeniem: number[];
  /** Suma wyniku trade'ow z naruszeniem: ujemna = koszt lamania regul. */
  kosztNaruszen: { count: number; sumR: number; sumPnlCents: number };
  przeglady: {
    dniWymagane: number;
    dniWypelnione: number;
    tygodnieWymagane: number;
    tygodnieZatwierdzone: number;
  };
  perDzien: { day: string; trades: number; ocenione: number; a: number; udzialA: number | null; naruszenia: number }[];
};

export function wskaznikDyscypliny(wejscie: {
  trades: readonly TradeDlaDyscypliny[];
  dni: readonly DzienDlaDyscypliny[];
  okno: OknoHandlu | null;
  tygodnieWymagane?: number;
  tygodnieZatwierdzone?: number;
}): WskaznikDyscypliny {
  const dniMapa = new Map(wejscie.dni.map((d) => [d.day, d]));
  const trades = [...wejscie.trades].sort(
    (x, y) => x.entryTime.getTime() - y.entryTime.getTime() || x.id - y.id,
  );
  const trafienia = new Map<NaruszenieRegul, number[]>(NARUSZENIA_REGUL.map((k) => [k, []]));
  const zNaruszeniem = new Set<number>();
  const flaguj = (kod: NaruszenieRegul, id: number) => {
    trafienia.get(kod)!.push(id);
    zNaruszeniem.add(id);
  };

  const licznikDnia = new Map<string, number>();
  for (const t of trades) {
    const nr = (licznikDnia.get(t.tradingDay) ?? 0) + 1;
    licznikDnia.set(t.tradingDay, nr);
    const limit = dniMapa.get(t.tradingDay)?.maxTrades ?? null;
    if (limit !== null && nr > limit) flaguj("limit_tradeow", t.id);
    if (wejscie.okno && t.minutaWejscia !== null && !wOknie(t.minutaWejscia, wejscie.okno)) flaguj("poza_oknem", t.id);
    if (t.plan === null || t.plan.frozenAt.getTime() > t.momentDecyzji.getTime()) flaguj("brak_planu", t.id);
    else if (t.stopLoss === null || !rowne(t.stopLoss, t.plan.stopLoss)) flaguj("ruszony_sl", t.id);
  }

  const ocenione = trades.filter((t) => t.processGrade !== null);
  const a = ocenione.filter((t) => t.processGrade === "A").length;
  const b = ocenione.filter((t) => t.processGrade === "B").length;
  const c = ocenione.filter((t) => t.processGrade === "C").length;

  const wyniki = trades.filter((t) => zNaruszeniem.has(t.id));
  const dniZTradami = [...new Set(trades.map((t) => t.tradingDay))].sort();
  const perDzien = dniZTradami.map((day) => {
    const dzien = trades.filter((t) => t.tradingDay === day);
    const oc = dzien.filter((t) => t.processGrade !== null);
    const aa = oc.filter((t) => t.processGrade === "A").length;
    return {
      day,
      trades: dzien.length,
      ocenione: oc.length,
      a: aa,
      udzialA: oc.length > 0 ? aa / oc.length : null,
      naruszenia: dzien.filter((t) => zNaruszeniem.has(t.id)).length,
    };
  });

  return {
    trades: trades.length,
    ocenione: ocenione.length,
    a,
    b,
    c,
    udzialA: ocenione.length > 0 ? a / ocenione.length : null,
    naruszenia: NARUSZENIA_REGUL.map((kod) => ({
      kod,
      ...NARUSZENIA_OPISY[kod],
      count: trafienia.get(kod)!.length,
      tradeIds: trafienia.get(kod)!,
    })),
    tradeIdsZNaruszeniem: [...zNaruszeniem].sort((x, y) => x - y),
    kosztNaruszen: {
      count: wyniki.length,
      sumR: wyniki.reduce((s, t) => s + (t.rMultiple ?? 0), 0),
      sumPnlCents: wyniki.reduce((s, t) => s + t.pnlCents, 0),
    },
    przeglady: {
      dniWymagane: dniZTradami.length,
      dniWypelnione: dniZTradami.filter((d) => dniMapa.get(d)?.przegladWypelniony === true).length,
      tygodnieWymagane: wejscie.tygodnieWymagane ?? 0,
      tygodnieZatwierdzone: wejscie.tygodnieZatwierdzone ?? 0,
    },
    perDzien,
  };
}
