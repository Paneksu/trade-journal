"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { instruments, screenshots, tradeExits, tradeTags, trades } from "@/lib/db/schema";
import { computeTrade, fromLocalInput, type Direction, type ExitInput } from "@/lib/domain/calc";
import { czyInterwal, sparujZInterwalami, type Interwal } from "@/lib/domain/interwaly";
import { czyPowod, normalizujKierunek } from "@/lib/domain/kierunek";
import { wynikTrade } from "@/lib/domain/outcome";
import { czyStatus, maWynik } from "@/lib/domain/status";
import { cleanValues, fieldsForScope, readFromForm, validateValues } from "@/lib/fields/fields";
import { getFields, getProgi, instrumentSpec } from "@/lib/queries/dictionaries";
import { deleteScreenshot, deleteTradeDir, saveScreenshot } from "@/lib/screenshots";
import { bladLimitu } from "@/lib/screenshots-limit";

export type FormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: number;
  savedAt?: number;
};

function text(data: FormData, key: string): string | null {
  const w = data.get(key);
  if (w === null) return null;
  const s = String(w).trim();
  return s === "" ? null : s;
}

function parseNumber(s: string): number | null {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function number(data: FormData, key: string): number | null {
  const s = text(data, key);
  return s === null ? null : parseNumber(s);
}

/** Tolerancja przy porownaniach sum kontraktow - liczby przychodza z formularza
    jako stringi zamieniane na float, wiec 0.1 + 0.2 nie da w JS dokladnie 0.3. */
const EPS_KONTRAKTY = 1e-6;

type WierszWyjscia = {
  time: Date | null;
  price: number;
  contracts: number;
  brokerAmount: number | null;
  note: string | null;
};

/**
 * Czyta wiersze czesciowych wyjsc z FormData - wzorzec `getAll(...)` + parowanie
 * po indeksie, jak przy zrzutach i interwalach (`sparujZInterwalami`). Wiersz
 * calkiem pusty jest pomijany, nie blokuje zapisu.
 *
 * Sortuje wynik po czasie rosnaco - `computeTrade` NIE sortuje wyjsc samo
 * (kontrakt funkcji, patrz `domain/calc.ts`: kolejnosc odpowiada za `scalingR`),
 * wiec to jest jedyne miejsce, w ktorym kolejnosc kawalkow zostaje ustalona.
 * Wiersze bez czasu ida PO wierszach z czasem, w kolejnosci wpisania - nie da
 * sie ich uszeregowac chronologicznie, wiec nie udajemy, ze sie da.
 *
 * JEDEN wiersz z pusta liczba kontraktow znaczy "cala pozycja". Bez tej reguly
 * najczestszy przypadek - jedno wyjscie, cala pozycja - kazalby wpisywac te sama
 * liczbe dwa razy, raz przy pozycji i raz przy wyjsciu. Formularz pokazuje ta
 * wartosc w podpowiedzi pola, wiec nic sie nie dzieje po cichu. Przy dwoch i
 * wiecej wierszach pusta liczba jest bledem: tam nie ma czego domyslac.
 */
function czytajWyjscia(
  data: FormData,
  strefaGieldy: string,
  entryTime: Date,
  pozycja: number,
): { ok: true; rows: WierszWyjscia[] } | { ok: false; error: string } {
  const czasy = data.getAll("wy_czas").map(String);
  const ceny = data.getAll("wy_cena").map(String);
  const kontrakty = data.getAll("wy_kontrakty").map(String);
  const kwoty = data.getAll("wy_kwota").map(String);
  const notatki = data.getAll("wy_notatka").map(String);

  const n = Math.max(czasy.length, ceny.length, kontrakty.length, kwoty.length, notatki.length);
  /* `contracts` moze tu byc jeszcze `null` - domykamy je dopiero po petli,
     gdy wiadomo, ile wierszy w ogole przyszlo. */
  const surowe: (Omit<WierszWyjscia, "contracts"> & { idx: number; contracts: number | null })[] =
    [];

  for (let i = 0; i < n; i += 1) {
    const czasRaw = (czasy[i] ?? "").trim();
    const cenaRaw = (ceny[i] ?? "").trim();
    const kontraktyRaw = (kontrakty[i] ?? "").trim();
    const kwotaRaw = (kwoty[i] ?? "").trim();
    const notatkaRaw = (notatki[i] ?? "").trim();

    if (!czasRaw && !cenaRaw && !kontraktyRaw && !kwotaRaw && !notatkaRaw) continue;

    const price = cenaRaw === "" ? null : parseNumber(cenaRaw);
    const contracts = kontraktyRaw === "" ? null : parseNumber(kontraktyRaw);
    if (price === null) {
      return { ok: false, error: `Wyjście #${i + 1}: podaj cenę wyjścia.` };
    }
    if (contracts !== null && contracts <= 0) {
      return {
        ok: false,
        error: `Wyjście #${i + 1}: liczba kontraktów musi być większa od zera.`,
      };
    }

    let time: Date | null = null;
    if (czasRaw) {
      time = fromLocalInput(czasRaw, strefaGieldy);
      if (!time) {
        return { ok: false, error: `Wyjście #${i + 1}: nie rozpoznaję podanej daty i godziny.` };
      }
      if (time.getTime() < entryTime.getTime()) {
        return { ok: false, error: "Wyjście nie może być wcześniej niż wejście." };
      }
    }

    const kwota = kwotaRaw === "" ? null : parseNumber(kwotaRaw);
    const brokerAmount = kwota === null ? null : Math.round(kwota * 100);

    surowe.push({
      idx: i,
      time,
      price,
      contracts,
      brokerAmount,
      note: notatkaRaw === "" ? null : notatkaRaw,
    });
  }

  /* Jedno wyjscie bez podanej liczby kontraktow = cala pozycja (patrz opis
     funkcji). Przy kilku wierszach nie ma czego domyslac - wtedy blad. */
  if (surowe.length === 1 && surowe[0].contracts === null) {
    surowe[0].contracts = pozycja;
  }
  const brakujacy = surowe.find((w) => w.contracts === null);
  if (brakujacy) {
    return {
      ok: false,
      error: `Wyjście #${brakujacy.idx + 1}: podaj liczbę kontraktów. Przy kilku wyjściach trzeba ją wpisać przy każdym.`,
    };
  }

  const zCzasem = surowe
    .filter((w) => w.time !== null)
    .sort((a, b) => a.time!.getTime() - b.time!.getTime() || a.idx - b.idx);
  const bezCzasu = surowe.filter((w) => w.time === null);

  const posortowane = [...zCzasem, ...bezCzasu].map(
    (w): WierszWyjscia => ({
      time: w.time,
      price: w.price,
      contracts: w.contracts as number,
      brokerAmount: w.brokerAmount,
      note: w.note,
    }),
  );
  return { ok: true, rows: posortowane };
}

function integer(data: FormData, key: string): number | null {
  const n = number(data, key);
  return n === null ? null : Math.round(n);
}

/**
 * Gotowosc psychiczna, 1-10. Zero na suwaku znaczy "nie oceniam" (patrz
 * components/trades/gotowosc.tsx), a wszystko poza skala jest niczym: to, co
 * przyszlo z formularza, nie moze dotrzec do CHECK-a `trades_readiness` -
 * uzytkownik zobaczylby wtedy surowy blad Postgresa zamiast zapisu.
 */
function gotowosc(data: FormData): number | null {
  const n = integer(data, "readiness");
  if (n === null || n < 1 || n > 10) return null;
  return n;
}

/**
 * Identyfikator powiazania albo nic. Puste opcje list wyboru ("bez strategii",
 * "dziennik realny") maja wartosc 0 - bez tej zamiany baza dostaje zero
 * i odrzuca zapis na kluczu obcym.
 */
function optionalId(data: FormData, key: string): number | null {
  const n = integer(data, key);
  return n !== null && n > 0 ? n : null;
}

export async function saveTrade(_previous: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const id = integer(data, "id");
  const accountId = integer(data, "accountId");
  const instrumentId = integer(data, "instrumentId");
  const backtestSessionId = optionalId(data, "backtestSessionId");
  const directionRaw = text(data, "direction");
  const statusRaw = text(data, "status") ?? "closed";

  // Limit sprawdzamy przed zapisem, zeby nie zostawic trade'a z polowa zdjec.
  const nowe = zrzutyNoweZInterwalami(data);
  const limit = bladLimitu(id ? await policzZrzuty(id) : 0, nowe.length);
  if (limit) return { ok: false, error: limit };

  if (!accountId) return { ok: false, error: "Wybierz konto." };
  if (!instrumentId) return { ok: false, error: "Wybierz instrument." };
  if (directionRaw !== "long" && directionRaw !== "short") {
    return { ok: false, error: "Wybierz kierunek pozycji." };
  }
  const direction: Direction = directionRaw;

  const [instrument] = await db
    .select()
    .from(instruments)
    .where(eq(instruments.id, instrumentId))
    .limit(1);
  if (!instrument) return { ok: false, error: "Nie znam takiego instrumentu." };

  /* Godziny trade'a sa w czasie GIELDY, nie w strefie uzytkownika (ADR-022,
     2026-08-30). Wczesniej bylo tu `settings.timezone`: wpisane 09:35 z
     wykresu nowojorskiego zapisywalo sie jako 09:35 w Warszawie, czyli 03:35
     w Nowym Jorku - trade z otwarcia sesji ladowal w "premarket", a przy
     wieczornych godzinach takze w zlym dniu handlowym. */
  const strefaGieldy = instrument.exchangeTimezone;
  const entryTime = fromLocalInput(text(data, "entryTime") ?? "", strefaGieldy);
  if (!entryTime) return { ok: false, error: "Podaj datę i godzinę wejścia." };

  const entryPrice = number(data, "entryPrice");
  if (entryPrice === null) return { ok: false, error: "Podaj cenę wejścia." };

  const contracts = number(data, "contracts");
  if (contracts === null || contracts <= 0) {
    return { ok: false, error: "Podaj liczbę kontraktów większą od zera." };
  }

  // --- wyjscia czesciowe ---
  const wyjsciaResult = czytajWyjscia(data, strefaGieldy, entryTime, contracts);
  if (!wyjsciaResult.ok) return { ok: false, error: wyjsciaResult.error };
  const wszystkieWyjscia = wyjsciaResult.rows;
  const closedContracts = wszystkieWyjscia.reduce((sum, w) => sum + w.contracts, 0);

  if (closedContracts > contracts + EPS_KONTRAKTY) {
    return {
      ok: false,
      error: `Suma kontraktów w wyjściach (${closedContracts}) przekracza wielkość pozycji (${contracts}).`,
    };
  }

  // Najpierw walidacja, dopiero potem korekta. Odwrotna kolejnosc miala cicha
  // dziure: status spoza enuma omijal gałąź "closed" i ladowal na "closed"
  // Z POMINIECIEM korekty, wiec trade bez ceny wyjscia zapisywal sie jako
  // zamkniety, dostawal pnl = null, a odczyt zamienial to na zero - pozycja
  // wchodzila do statystyk jako BE, ktorego nie bylo.
  if (!czyStatus(statusRaw)) {
    return { ok: false, error: "Nieznany status trade'a." };
  }

  // Pozycja czesciowo zamknieta jest OTWARTA - nie zmuszamy uzytkownika do
  // przelaczania statusu recznie, gdy wyjscia nie pokrywaja calej wielkosci.
  const status = statusRaw === "closed" && closedContracts < contracts - EPS_KONTRAKTY ? "open" : statusRaw;

  // "closed" i "missed" wymagaja, zeby wyjscia pokrywaly CALA pozycje - bez
  // tego nie ma z czego policzyc ostatecznego R/PnL. Dla "closed" to w
  // praktyce sama siebie spelnia (niedopelniona suma juz zamienila status na
  // "open" wyzej) - realnie pilnuje "missed", ktore takiej auto-korekty nie ma.
  if ((status === "closed" || status === "missed") && Math.abs(closedContracts - contracts) > EPS_KONTRAKTY) {
    const brakuje = Math.round((contracts - closedContracts) * 10_000) / 10_000;
    return {
      ok: false,
      error: `Brakuje ${brakuje} kontraktów, żeby zamknąć całą pozycję (masz ${closedContracts} z ${contracts}).`,
    };
  }

  const stopLoss = number(data, "stopLoss");
  const takeProfit = number(data, "takeProfit");
  const mae = number(data, "mae");
  const mfe = number(data, "mfe");

  // Statusy bez policzalnego wyniku (planned, cancelled) nie maja wyjsc -
  // nawet gdyby cos zostalo wpisane w formularzu, nie zapisujemy tego ani nie
  // wliczamy do computeTrade (ADR - patrz komentarz w domain/calc.ts).
  const wyjsciaDoZapisu = status === "planned" || status === "cancelled" ? [] : wszystkieWyjscia;
  const exitsForCompute: ExitInput[] = wyjsciaDoZapisu.map((w) => ({
    price: w.price,
    contracts: w.contracts,
    time: w.time,
    brokerAmount: w.brokerAmount,
  }));

  /* Kwota z rachunku brokera - gdy podana, jest wynikiem trade'a zamiast
     kwoty z siatki tickow (ADR-016). Zamiana na centy taka sama jak w
     podgladzie formularza, inaczej panel klamalby wobec bazy. Warunek byl
     `exitPrice !== null`; po wyjsciach czastkowych to "sa jakiekolwiek
     wyjscia" (`exitsForCompute.length > 0`) - `maWynik(status)` zostaje bez
     zmian, wiec otwarta pozycja (nawet z czesciowym wyjsciem) nadal nie ma
     tu wlasnego pola: jej wynik jest tymczasowy, nie "wynik z rachunku". */
  const brokerRaw = number(data, "brokerAmount");
  const brokerAmount =
    maWynik(status) && exitsForCompute.length > 0 && brokerRaw !== null
      ? Math.round(brokerRaw * 100)
      : null;

  const result = computeTrade({
    instrument: instrumentSpec(instrument),
    direction,
    contracts,
    entryPrice,
    exits: exitsForCompute,
    stopLoss,
    takeProfit,
    mae,
    mfe,
    entryTime,
    brokerAmount,
  });

  // --- pola wlasne ---
  const allFields = await getFields();
  const activeFields = fieldsForScope(allFields, backtestSessionId !== null);
  const values = cleanValues(activeFields, readFromForm(activeFields, data));
  const errors = validateValues(activeFields, values);
  if (errors.length > 0) {
    return {
      ok: false,
      error: "Popraw zaznaczone pola.",
      fieldErrors: Object.fromEntries(errors.map((b) => [b.key, b.message])),
    };
  }

  /* Kierunek a egzekucja (ADR-018). Normalizujemy PRZED zapisem, zeby CHECK
     `trades_kierunek` byl siatka bezpieczenstwa, a nie sciezka, ktora
     uzytkownik zobaczy - surowy komunikat Postgresa nic mu nie mowi.
     Prog BE bierzemy z ustawien tym samym wzorem, co statystyki. */
  const progiBE = await getProgi();
  const surowyPowod = text(data, "badExecutionReason");
  const kierunek = normalizujKierunek(
    {
      directionCorrect: data.get("directionCorrect") !== null,
      badExecutionReason: czyPowod(surowyPowod) ? surowyPowod : null,
      potentialR: number(data, "potentialR"),
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
        status === "closed" &&
        result.pnl !== null &&
        wynikTrade(
          { pnl: result.pnl, riskAmount: result.riskAmount, contracts: contracts ?? 0 },
          progiBE,
        ) === "zysk",
      // Blok renderuje sie tylko przy zamknietej stracie/BE, wiec jego brak
      // znaczy "nie pytalismy", a nie "kierunek chybiony".
      oceniane: status === "closed" && data.get("kierunek_oceniany") !== null,
    },
  );

  const row = {
    accountId,
    instrumentId,
    /* Strategia i checklista zniknely z formularza 2026-08-29. Kolumny zostaja
       w bazie razem z historia, ale nowe zapisy ich nie dotykaja - w edycji
       starego trade'a przypisanie ZOSTAJE takie, jakie bylo, bo klucza tu nie
       ma. Gdyby wpisac tu `null`, edycja notatki kasowalaby strategie. */
    backtestSessionId: backtestSessionId ?? null,
    direction,
    status,
    entryTime,
    entryPrice: String(entryPrice),
    // Pola pochodne z wierszy trade_exits (2026-08-30) - zrodlem prawdy jest
    // teraz wynik computeTrade, nie to, co uzytkownik wpisal wprost w te pola.
    exitTime: result.exitTime,
    exitPrice: result.exitPrice === null ? null : String(result.exitPrice),
    contracts: String(contracts),
    stopLoss: stopLoss === null ? null : String(stopLoss),
    takeProfit: takeProfit === null ? null : String(takeProfit),
    mae: mae === null ? null : String(mae),
    mfe: mfe === null ? null : String(mfe),
    note: text(data, "note"),
    moodNote: text(data, "moodNote"),
    readiness: gotowosc(data),
    directionCorrect: kierunek.directionCorrect,
    badExecutionReason: kierunek.badExecutionReason,
    potentialR: kierunek.potentialR === null ? null : kierunek.potentialR.toFixed(4),
    custom: values,
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
    brokerAmount,
    // Wyjscia czesciowe (2026-08-30) - denormalizacja z trade_exits, patrz
    // komentarz w schema.ts. Zawsze jawnie, z tego samego powodu co brokerAmount.
    closedContracts: String(result.closedContracts),
    exitCount: result.exitCount,
    scalingR: result.scalingR === null ? null : result.scalingR.toFixed(4),
    updatedAt: new Date(),
  };

  // --- tagi ---
  // Interwaly siedza w osobnych polach "tagint:<id>" obok checkboxa "tag" - nie
  // w jednej zakodowanej wartosci ("12:5m"), bo nazwa "tag" jest wspoldzielona
  // z filter-bar.tsx i z tagMany, ktore o interwale nic nie wiedza.
  //
  // Od ADR-017 jeden tag moze miec KILKA interwalow naraz - kazdy to osobny
  // wiersz w trade_tags. Iterujemy po ZAZNACZONYCH TAGACH, nie po kluczach
  // "tagint:*": checkbox ukryty CSS-em nadal jedzie w FormData, wiec odznaczenie
  // tagu przy zaznaczonych chipach interwalu zostawiloby tu osierocone wiersze.
  const selectedTags = data
    .getAll("tag")
    .map((w) => Number(w))
    .filter((n) => Number.isInteger(n) && n > 0);

  /* Zapis calego trade'a - wiersz, tagi i wyjscia czastkowe - w jednej
     transakcji. `trades.pnl` i zawartosc `trade_exits` musza sie zgadzac
     zawsze; rozjazd miedzy nimi byłby cichym klamstwem w statystykach.
     `redirect()` (rzuca wyjatek sterujacy Nexta) i zapis zrzutow (I/O na
     dysku) zostaja POZA transakcja - inaczej redirect wycofalby zapis, a
     plik na dysku i wiersz w bazie moglyby sie rozjechac w inny sposob. */
  const savedId = await db.transaction(async (tx) => {
    let sid: number;
    if (id) {
      await tx.update(trades).set(row).where(eq(trades.id, id));
      sid = id;
    } else {
      const [created] = await tx.insert(trades).values(row).returning({ id: trades.id });
      sid = created.id;
    }

    await tx.delete(tradeTags).where(eq(tradeTags.tradeId, sid));
    if (selectedTags.length > 0) {
      type Przypisanie = { tradeId: number; tagId: number; interval: string | null };
      const przypisania = selectedTags.flatMap<Przypisanie>((tagId) => {
        const interwaly = [
          ...new Set(
            data
              .getAll(`tagint:${tagId}`)
              .filter((w): w is string => typeof w === "string" && czyInterwal(w)),
          ),
        ];
        // Brak wskazanego interwalu to jedno przypisanie bez skali czasu -
        // tak dziala Setup, Blad i konfluencja, ktorej uzytkownik nie doprecyzowal.
        if (interwaly.length === 0) return [{ tradeId: sid, tagId, interval: null }];
        return interwaly.map((interval) => ({ tradeId: sid, tagId, interval }));
      });
      await tx.insert(tradeTags).values(przypisania).onConflictDoNothing();
    }

    // --- wyjscia czesciowe ---
    // Wzorzec "skasuj wszystkie i wstaw od nowa", ten sam co przy tagach -
    // prostszy i bezpieczniejszy niz roznicowe UPDATE/DELETE/INSERT przy
    // liscie, ktora edycja moze dowolnie skracac, wydluzac i przestawiac.
    await tx.delete(tradeExits).where(eq(tradeExits.tradeId, sid));
    if (wyjsciaDoZapisu.length > 0) {
      await tx.insert(tradeExits).values(
        wyjsciaDoZapisu.map((w, idx) => ({
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

  // --- zrzuty ---
  // Formularz przysyla pliki tylko przy nowym trade'cie; w edycji zrzuty leca
  // osobno przez `addTradeScreenshots`, wiec licznik zaczyna od zera dopiero
  // wtedy, gdy trade faktycznie zadnych nie ma.
  const shotError = await wgrajZrzuty(savedId, nowe);
  if (shotError) return { ok: false, id: savedId, error: `Trade zapisany, ale ${shotError}` };

  revalidatePath("/", "layout");

  if (text(data, "stay") === "1") {
    return { ok: true, id: savedId, savedAt: Date.now() };
  }
  redirect(`/trades/${savedId}`);
}

export async function deleteTrade(id: number): Promise<void> {
  await requireSession();
  await db.delete(trades).where(eq(trades.id, id));
  await deleteTradeDir(id);
  revalidatePath("/", "layout");
  redirect("/trades");
}

/* --- Zrzuty --------------------------------------------------------------- */

type ZrzutZInterwalem = { file: File; interval: string | null };

/**
 * Zrzuty nowego trade'a: wpis nie ma jeszcze id, wiec pliki jada tym samym
 * multipartem co reszta formularza (ADR-009). Kazdy plik ma wlasny interwal
 * wybrany w podgladzie (`NewTradeShots`), przeslany rownolegle w "shotint" -
 * parujemy je po indeksie (`sparujZInterwalami`), nie po tresci, zeby
 * przesuniecie ktoregokolwiek pliku nigdy nie podmienilo cudzego interwalu.
 */
function zrzutyNoweZInterwalami(data: FormData): ZrzutZInterwalem[] {
  const pliki = data.getAll("shot");
  const interwaly = data.getAll("shotint").map((w) => String(w));
  return sparujZInterwalami(pliki, interwaly)
    .filter(
      (p): p is { plik: File; interval: Interwal | null } =>
        p.plik instanceof File && p.plik.size > 0,
    )
    .map((p) => ({ file: p.plik, interval: p.interval }));
}

/**
 * Jeden, wspolny interwal dla calej paczki - dogrywanie zrzutow do
 * istniejacego wpisu ma jeden select nad strefa wgrywania (ADR-015), nie
 * wybor per plik jak przy nowym trade'cie, bo tam wszystkie pliki w paczce
 * zwykle pochodza z tego samego interwalu.
 */
function interwalZFormularza(data: FormData): string | null {
  const w = text(data, "interval");
  return w !== null && czyInterwal(w) ? w : null;
}

async function policzZrzuty(tradeId: number): Promise<number> {
  const [w] = await db
    .select({ ile: sql<number>`count(*)::int` })
    .from(screenshots)
    .where(eq(screenshots.tradeId, tradeId));
  return w?.ile ?? 0;
}

/**
 * Zapisuje pliki i dopisuje je na koncu listy. Numeracja startuje od tego, co
 * juz lezy w bazie - inaczej zdjecie dograne pozniej wskakiwaloby na poczatek.
 * Zwraca komunikat bledu albo null.
 */
async function wgrajZrzuty(tradeId: number, items: ZrzutZInterwalem[]): Promise<string | null> {
  if (items.length === 0) return null;

  const [stan] = await db
    .select({ ostatni: sql<number>`coalesce(max(${screenshots.sortOrder}), -1)::int` })
    .from(screenshots)
    .where(eq(screenshots.tradeId, tradeId));
  let sortOrder = (stan?.ostatni ?? -1) + 1;

  for (const { file, interval } of items) {
    try {
      const saved = await saveScreenshot({ kind: "trade", id: tradeId }, file);
      await db.insert(screenshots).values({
        tradeId,
        file: saved.file,
        thumbnail: saved.thumbnail,
        width: saved.width,
        height: saved.height,
        sortOrder: sortOrder++,
        interval,
      });
    } catch (error) {
      return `zrzut się nie wgrał: ${(error as Error).message}`;
    }
  }
  return null;
}

/** Zrzuty dogrywane do istniejacego trade'a: z pliku, ze schowka albo przeciagniete. */
export async function addTradeScreenshots(data: FormData): Promise<FormState> {
  await requireSession();
  const tradeId = integer(data, "tradeId");
  if (!tradeId) return { ok: false, error: "Nie wiem, do którego trade'a przypiąć zrzut." };

  const files = data.getAll("shot").filter((w): w is File => w instanceof File && w.size > 0);
  if (files.length === 0) return { ok: false, error: "Nie widzę obrazu do wgrania." };

  const limit = bladLimitu(await policzZrzuty(tradeId), files.length);
  if (limit) return { ok: false, error: limit };

  const interval = interwalZFormularza(data);
  const blad = await wgrajZrzuty(
    tradeId,
    files.map((file) => ({ file, interval })),
  );
  if (blad) return { ok: false, error: blad[0].toUpperCase() + blad.slice(1) };

  revalidatePath("/", "layout");
  return { ok: true, id: tradeId };
}

export async function removeScreenshot(screenshotId: number): Promise<FormState> {
  await requireSession();
  const [s] = await db.select().from(screenshots).where(eq(screenshots.id, screenshotId)).limit(1);
  if (!s) return { ok: false, error: "Nie ma takiego zrzutu." };
  await db.delete(screenshots).where(eq(screenshots.id, screenshotId));
  await deleteScreenshot(s.file, s.thumbnail);
  // Licznik zrzutow siedzi tez w tabeli trade'ow, wiec odswiezamy caly uklad.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Poprawka interwalu po fakcie - tam, gdzie zrzut wolno tez skasowac
 * (ADR-015). Pusty string czysci interwal, wartosc spoza `INTERWALY` jest
 * cicho odrzucana (zapisuje sie `null`), zamiast oddawac blad za pomylke w
 * kliknieciu.
 */
export async function setScreenshotInterval(
  screenshotId: number,
  interval: string,
): Promise<FormState> {
  await requireSession();
  const [s] = await db.select().from(screenshots).where(eq(screenshots.id, screenshotId)).limit(1);
  if (!s) return { ok: false, error: "Nie ma takiego zrzutu." };
  const wartosc = interval !== "" && czyInterwal(interval) ? interval : null;
  await db.update(screenshots).set({ interval: wartosc }).where(eq(screenshots.id, screenshotId));
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Masowe tagowanie z tabeli - dodaje albo zdejmuje tag na wielu trade'ach naraz. */
export async function tagMany(tradeIds: number[], tagId: number, add: boolean): Promise<void> {
  await requireSession();
  if (tradeIds.length === 0) return;

  if (add) {
    // Tagowanie masowe z tabeli nie zna kontekstu pojedynczego trade'a, wiec
    // interwal przypisania zawsze zostaje pusty - uzytkownik dopowie go
    // recznie w karcie trade'a, jesli ma sens.
    //
    // Pomijamy trade'y, ktore ten tag juz maja - na DOWOLNYM interwale.
    // `onConflictDoNothing` samo tego nie zalatwi: po ADR-017 unikat obejmuje
    // takze interwal, wiec wiersz (7, FVG, null) nie koliduje z (7, FVG, '5m')
    // i tag zdublowalby sie po cichu.
    const juzMaja = await db
      .select({ tradeId: tradeTags.tradeId })
      .from(tradeTags)
      .where(and(inArray(tradeTags.tradeId, tradeIds), eq(tradeTags.tagId, tagId)));
    const pomin = new Set(juzMaja.map((w) => w.tradeId));
    const doDodania = tradeIds.filter((id) => !pomin.has(id));
    if (doDodania.length === 0) return;

    await db
      .insert(tradeTags)
      .values(doDodania.map((tradeId) => ({ tradeId, tagId, interval: null })))
      .onConflictDoNothing();
  } else {
    await db
      .delete(tradeTags)
      .where(and(inArray(tradeTags.tradeId, tradeIds), eq(tradeTags.tagId, tagId)));
  }
  revalidatePath("/", "layout");
}

export async function deleteMany(tradeIds: number[]): Promise<void> {
  await requireSession();
  if (tradeIds.length === 0) return;
  await db.delete(trades).where(inArray(trades.id, tradeIds));
  await Promise.all(tradeIds.map(deleteTradeDir));
  revalidatePath("/", "layout");
}
