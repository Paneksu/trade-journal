"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { instruments, screenshots, tradeTags, trades } from "@/lib/db/schema";
import { computeTrade, fromLocalInput, type Direction } from "@/lib/domain/calc";
import { czyInterwal, sparujZInterwalami, type Interwal } from "@/lib/domain/interwaly";
import { czyPowod, normalizujKierunek } from "@/lib/domain/kierunek";
import { wynikTrade } from "@/lib/domain/outcome";
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

function number(data: FormData, key: string): number | null {
  const s = text(data, key);
  if (s === null) return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function integer(data: FormData, key: string): number | null {
  const n = number(data, key);
  return n === null ? null : Math.round(n);
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
  const settings = await requireSession();
  const timezone = settings.timezone;

  const id = integer(data, "id");
  const accountId = integer(data, "accountId");
  const instrumentId = integer(data, "instrumentId");
  const backtestSessionId = optionalId(data, "backtestSessionId");
  const strategyId = optionalId(data, "strategyId");
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

  const entryTime = fromLocalInput(text(data, "entryTime") ?? "", timezone);
  if (!entryTime) return { ok: false, error: "Podaj datę i godzinę wejścia." };

  const entryPrice = number(data, "entryPrice");
  if (entryPrice === null) return { ok: false, error: "Podaj cenę wejścia." };

  const contracts = number(data, "contracts");
  if (contracts === null || contracts <= 0) {
    return { ok: false, error: "Podaj liczbę kontraktów większą od zera." };
  }

  const exitTimeRaw = text(data, "exitTime");
  const exitTime = exitTimeRaw ? fromLocalInput(exitTimeRaw, timezone) : null;
  const exitPrice = number(data, "exitPrice");

  // Brak ceny wyjscia oznacza, ze pozycja jest wciaz otwarta - nie zmuszamy
  // uzytkownika do przelaczania statusu recznie.
  const status =
    statusRaw === "closed" && exitPrice === null
      ? "open"
      : (statusRaw as "planned" | "open" | "closed" | "cancelled");

  if (status === "closed" && !exitTime) {
    return { ok: false, error: "Trade zamknięty musi mieć datę wyjścia." };
  }
  if (exitTime && exitTime.getTime() < entryTime.getTime()) {
    return { ok: false, error: "Wyjście nie może być wcześniej niż wejście." };
  }

  const stopLoss = number(data, "stopLoss");
  const takeProfit = number(data, "takeProfit");
  const mae = number(data, "mae");
  const mfe = number(data, "mfe");

  /* Kwota z rachunku brokera - gdy podana, jest wynikiem trade'a zamiast
     kwoty z siatki tickow (ADR-016). Zamiana na centy taka sama jak w
     podgladzie formularza, inaczej panel klamalby wobec bazy. Otwarta
     pozycja wyniku nie ma, wiec kwota jej nie dotyczy. */
  const brokerRaw = number(data, "brokerAmount");
  const brokerAmount =
    status === "closed" && exitPrice !== null && brokerRaw !== null
      ? Math.round(brokerRaw * 100)
      : null;

  const result = computeTrade({
    instrument: instrumentSpec(instrument),
    direction,
    contracts,
    entryPrice,
    exitPrice: status === "closed" ? exitPrice : null,
    stopLoss,
    takeProfit,
    mae,
    mfe,
    entryTime,
    exitTime: status === "closed" ? exitTime : null,
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
    strategyId: strategyId ?? null,
    backtestSessionId: backtestSessionId ?? null,
    direction,
    status,
    entryTime,
    entryPrice: String(entryPrice),
    exitTime: status === "closed" ? exitTime : null,
    exitPrice: status === "closed" && exitPrice !== null ? String(exitPrice) : null,
    contracts: String(contracts),
    stopLoss: stopLoss === null ? null : String(stopLoss),
    takeProfit: takeProfit === null ? null : String(takeProfit),
    mae: mae === null ? null : String(mae),
    mfe: mfe === null ? null : String(mfe),
    note: text(data, "note"),
    executionRating: integer(data, "executionRating"),
    directionCorrect: kierunek.directionCorrect,
    badExecutionReason: kierunek.badExecutionReason,
    potentialR: kierunek.potentialR === null ? null : kierunek.potentialR.toFixed(4),
    rulesMet: data.getAll("rule").map(String),
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
    updatedAt: new Date(),
  };

  let savedId: number;
  if (id) {
    await db.update(trades).set(row).where(eq(trades.id, id));
    savedId = id;
  } else {
    const [created] = await db.insert(trades).values(row).returning({ id: trades.id });
    savedId = created.id;
  }

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
  await db.delete(tradeTags).where(eq(tradeTags.tradeId, savedId));
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
      if (interwaly.length === 0) return [{ tradeId: savedId, tagId, interval: null }];
      return interwaly.map((interval) => ({ tradeId: savedId, tagId, interval }));
    });
    await db.insert(tradeTags).values(przypisania).onConflictDoNothing();
  }

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
