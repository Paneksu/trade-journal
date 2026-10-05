import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { instruments, tradeExits, tradeTags, trades } from "@/lib/db/schema";
import { computeTrade, type ExitInput } from "@/lib/domain/calc";
import { czyPowod, normalizujKierunek } from "@/lib/domain/kierunek";
import { wynikTrade } from "@/lib/domain/outcome";
import { validujSzkic, type TradeDraft } from "@/lib/domain/trade-draft";
import { cleanValues, fieldsForScope, validateValues } from "@/lib/fields/fields";
import { getFields, getProgi, instrumentSpec } from "@/lib/queries/dictionaries";

/**
 * Zapis trade'a: walidacja szkicu, `computeTrade`, jedna transakcja (ADR-026).
 * Wspolna droga formularza i API synchronizacji - zadne z nich nie liczy
 * wyniku ani nie pisze do `trades` obok niej (ADR-003).
 *
 * Nie robi: sprawdzania sesji (to robi wolajacy), zrzutow (I/O na dysku zostaje
 * poza transakcja), revalidatePath ani redirectu (to sprawa Next, nie zapisu).
 */

export type PersistMeta = {
  source: "tradingview" | "fxreplay";
  externalRef: string;
  sourceSnapshot: Record<string, unknown> | null;
};

/** Wynik policzony przez `computeTrade` - zwracany przy suchym biegu zamiast zapisu. */
export type PodgladZapisu = {
  status: string;
  pnl: number | null;
  ticks: number | null;
  rMultiple: number | null;
  riskAmount: number | null;
  durationS: number | null;
  exitCount: number;
  marketSession: string | null;
  tradingDay: string | null;
};

export type PersistResult =
  | { ok: true; id: number; podglad?: PodgladZapisu }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type PersistOpcje = {
  /** Suchy bieg: cala walidacja i liczenie, zero zapisow (ADR-026). */
  dryRun?: boolean;
};

export async function persistTrade(
  szkic: TradeDraft,
  meta?: PersistMeta,
  opcje: PersistOpcje = {},
): Promise<PersistResult> {
  const instrumentRow = szkic.instrumentId
    ? ((
        await db.select().from(instruments).where(eq(instruments.id, szkic.instrumentId)).limit(1)
      )[0] ?? null)
    : null;

  const walidacja = validujSzkic(szkic, instrumentRow ? instrumentSpec(instrumentRow) : null);
  if (!walidacja.ok) return { ok: false, error: walidacja.error };
  const d = walidacja.dane;

  const exitsForCompute: ExitInput[] = d.wyjscia.map((w) => ({
    price: w.price,
    contracts: w.contracts,
    time: w.time,
    brokerAmount: w.brokerAmount,
  }));

  const result = computeTrade({
    instrument: instrumentSpec(instrumentRow!),
    direction: d.direction,
    contracts: d.contracts,
    entryPrice: d.entryPrice,
    exits: exitsForCompute,
    stopLoss: d.stopLoss,
    takeProfit: d.takeProfit,
    mae: d.mae,
    mfe: d.mfe,
    entryTime: d.entryTime,
    brokerAmount: d.brokerAmount,
  });

  // --- pola wlasne ---
  // Przy aktualizacji bez `custom` w szkicu nie ruszamy tego, co jest w bazie
  // (i nie wymagamy pol, ktorych klient nie zna); przy tworzeniu pola wymagane
  // obowiazuja zawsze.
  const aktywnePola = fieldsForScope(await getFields(), d.backtestSessionId !== null);
  let custom: Record<string, unknown> | undefined;
  if (szkic.custom !== undefined || szkic.id === null) {
    custom = cleanValues(aktywnePola, szkic.custom ?? {});
    const errors = validateValues(aktywnePola, custom);
    if (errors.length > 0) {
      return {
        ok: false,
        error: "Popraw zaznaczone pola.",
        fieldErrors: Object.fromEntries(errors.map((b) => [b.key, b.message])),
      };
    }
  }

  /* Kierunek a egzekucja (ADR-018). Normalizujemy PRZED zapisem, zeby CHECK
     `trades_kierunek` byl siatka bezpieczenstwa, a nie sciezka, ktora
     uzytkownik zobaczy - surowy komunikat Postgresa nic mu nie mowi.
     Prog BE bierzemy z ustawien tym samym wzorem, co statystyki. Brak bloku
     w szkicu (`kierunek === undefined`) znaczy "nie ruszaj". */
  let kierunek: ReturnType<typeof normalizujKierunek> | undefined;
  if (szkic.kierunek) {
    const progiBE = await getProgi();
    kierunek = normalizujKierunek(
      {
        directionCorrect: szkic.kierunek.directionCorrect,
        badExecutionReason: czyPowod(szkic.kierunek.badExecutionReason)
          ? szkic.kierunek.badExecutionReason
          : null,
        potentialR: szkic.kierunek.potentialR,
      },
      {
        // Blok kierunku (ADR-018) celowo zostaje na `=== "closed"`, NIE
        // `maWynik`. Nie wzieta pozycja nie ma egzekucji - "kierunek dobry,
        // zawiodla egzekucja" nie ma sensu dla setupu, ktorego nikt nie
        // wykonal. Pola ida na `null` i CHECK `trades_kierunek` przechodzi.
        //
        // Brak `pnl` (trade bez ceny wyjscia) nie jest wygrana - jest brakiem
        // rozstrzygniecia, a wtedy `oceniane` i tak jest falszem.
        wygrana:
          d.status === "closed" &&
          result.pnl !== null &&
          wynikTrade(
            { pnl: result.pnl, riskAmount: result.riskAmount, contracts: d.contracts },
            progiBE,
          ) === "zysk",
        // Blok renderuje sie tylko przy zamknietej stracie/BE, wiec jego brak
        // znaczy "nie pytalismy", a nie "kierunek chybiony".
        oceniane: d.status === "closed" && szkic.kierunek.kierunekOceniany,
      },
    );
  }

  /* Jedna chwila na `updatedAt` i `ingestedAt`: konflikt API to `updatedAt >
     ingestedAt`, wiec zapis przez API nie moze sam siebie zakwalifikowac jako
     edycji uzytkownika. */
  const teraz = new Date();

  const row = {
    accountId: d.accountId,
    instrumentId: d.instrumentId,
    /* Strategia i checklista zniknely z formularza 2026-08-29. Kolumny zostaja
       w bazie razem z historia, ale nowe zapisy ich nie dotykaja - w edycji
       starego trade'a przypisanie ZOSTAJE takie, jakie bylo, bo klucza tu nie
       ma. Gdyby wpisac tu `null`, edycja notatki kasowalaby strategie. */
    backtestSessionId: d.backtestSessionId ?? null,
    direction: d.direction,
    status: d.status,
    entryTime: d.entryTime,
    entryPrice: String(d.entryPrice),
    // Pola pochodne z wierszy trade_exits (2026-08-30) - zrodlem prawdy jest
    // teraz wynik computeTrade, nie to, co uzytkownik wpisal wprost w te pola.
    exitTime: result.exitTime,
    exitPrice: result.exitPrice === null ? null : String(result.exitPrice),
    contracts: String(d.contracts),
    stopLoss: d.stopLoss === null ? null : String(d.stopLoss),
    takeProfit: d.takeProfit === null ? null : String(d.takeProfit),
    mae: d.mae === null ? null : String(d.mae),
    mfe: d.mfe === null ? null : String(d.mfe),
    // Klucze `undefined` Drizzle pomija w UPDATE - to jest "nie ruszaj".
    note: szkic.note,
    moodNote: szkic.moodNote,
    readiness:
      szkic.readiness === undefined
        ? undefined
        : szkic.readiness !== null &&
            Number.isInteger(szkic.readiness) &&
            szkic.readiness >= 1 &&
            szkic.readiness <= 10
          ? szkic.readiness
          : null,
    directionCorrect: kierunek?.directionCorrect,
    badExecutionReason: kierunek?.badExecutionReason,
    potentialR:
      kierunek === undefined
        ? undefined
        : kierunek.potentialR === null
          ? null
          : kierunek.potentialR.toFixed(4),
    custom,
    ticks: result.ticks,
    riskTicks: result.riskTicks,
    pnl: result.pnl,
    riskAmount: result.riskAmount,
    rMultiple: result.rMultiple === null ? null : result.rMultiple.toFixed(4),
    maeR: result.maeR === null ? null : result.maeR.toFixed(4),
    mfeR: result.mfeR === null ? null : result.mfeR.toFixed(4),
    durationS: result.durationS,
    marketSession: result.marketSession,
    weekday: result.weekday,
    entryHour: result.entryHour,
    tradingDay: result.tradingDay,
    // Zawsze jawnie, takze jako null: pominiecie klucza zostawiloby w edycji
    // stara kwote i wynik rozjechalby sie z wyczyszczonym polem.
    brokerAmount: d.brokerAmount,
    // Wyjscia czesciowe (2026-08-30) - denormalizacja z trade_exits, patrz
    // komentarz w schema.ts. Zawsze jawnie, z tego samego powodu co brokerAmount.
    closedContracts: String(result.closedContracts),
    exitCount: result.exitCount,
    scalingR: result.scalingR === null ? null : result.scalingR.toFixed(4),
    updatedAt: teraz,
    // Synchronizacja (ADR-026): tylko gdy zapis idzie z API. Formularz tych
    // czterech kolumn nie dotyka.
    ...(meta
      ? {
          source: meta.source,
          externalRef: meta.externalRef,
          ingestedAt: teraz,
          sourceSnapshot: meta.sourceSnapshot,
        }
      : {}),
  };

  if (opcje.dryRun) {
    return {
      ok: true,
      id: szkic.id ?? 0,
      podglad: {
        status: d.status,
        pnl: result.pnl,
        ticks: result.ticks,
        rMultiple: result.rMultiple,
        riskAmount: result.riskAmount,
        durationS: result.durationS,
        exitCount: result.exitCount,
        marketSession: result.marketSession,
        tradingDay: result.tradingDay,
      },
    };
  }

  // Interwaly tagow wolajacy przefiltrowal juz przez `czyInterwal`.
  const przypisania = szkic.tags;

  /* Zapis calego trade'a - wiersz, tagi i wyjscia czastkowe - w jednej
     transakcji. `trades.pnl` i zawartosc `trade_exits` musza sie zgadzac
     zawsze; rozjazd miedzy nimi byłby cichym klamstwem w statystykach. */
  const savedId = await db.transaction(async (tx) => {
    let sid: number;
    if (szkic.id) {
      await tx.update(trades).set(row).where(eq(trades.id, szkic.id));
      sid = szkic.id;
    } else {
      const [created] = await tx.insert(trades).values(row).returning({ id: trades.id });
      sid = created.id;
    }

    if (przypisania !== undefined) {
      await tx.delete(tradeTags).where(eq(tradeTags.tradeId, sid));
      if (przypisania.length > 0) {
        await tx
          .insert(tradeTags)
          .values(przypisania.map((p) => ({ tradeId: sid, tagId: p.tagId, interval: p.interval })))
          .onConflictDoNothing();
      }
    }

    // --- wyjscia czesciowe ---
    // Wzorzec "skasuj wszystkie i wstaw od nowa", ten sam co przy tagach -
    // prostszy i bezpieczniejszy niz roznicowe UPDATE/DELETE/INSERT przy
    // liscie, ktora edycja moze dowolnie skracac, wydluzac i przestawiac.
    await tx.delete(tradeExits).where(eq(tradeExits.tradeId, sid));
    if (d.wyjscia.length > 0) {
      await tx.insert(tradeExits).values(
        d.wyjscia.map((w, idx) => ({
          tradeId: sid,
          sortOrder: idx,
          exitTime: w.time,
          exitPrice: String(w.price),
          contracts: String(w.contracts),
          brokerAmount: w.brokerAmount,
          note: w.note,
        })),
      );
    }

    return sid;
  });

  return { ok: true, id: savedId };
}
