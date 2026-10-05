"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { screenshots, tradeTags } from "@/lib/db/schema";
import { czyInterwal, sparujZInterwalami, type Interwal } from "@/lib/domain/interwaly";
import type { TagSzkicu, TradeDraft, WyjscieSzkicu } from "@/lib/domain/trade-draft";
import { fieldsForScope, readFromForm } from "@/lib/fields/fields";
import { getFields } from "@/lib/queries/dictionaries";
import { deleteScreenshot, deleteTradeDir } from "@/lib/screenshots";
import { bladLimitu } from "@/lib/screenshots-limit";
import { persistTrade } from "@/lib/trades/persist";
import { policzZrzuty, wgrajZrzuty, type ZrzutZInterwalem } from "@/lib/trades/screenshots-db";
import { usunTradeZNagrobkami } from "@/lib/trades/tombstones";

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

/**
 * Czyta wiersze czesciowych wyjsc z FormData - wzorzec `getAll(...)` + parowanie
 * po indeksie, jak przy zrzutach i interwalach (`sparujZInterwalami`). Wiersz
 * calkiem pusty jest pomijany, nie blokuje zapisu, ale jego numer zostaje
 * zajety (komunikat "Wyjscie #3" ma wskazywac wiersz, ktory widac na ekranie).
 *
 * To tylko PARSER: sprawdzanie, sortowanie i reguly ("jedno wyjscie bez
 * kontraktow = cala pozycja") siedza w `validujSzkic` (domain/trade-draft.ts).
 */
function czytajWyjscia(data: FormData): WyjscieSzkicu[] {
  const czasy = data.getAll("wy_czas").map(String);
  const ceny = data.getAll("wy_cena").map(String);
  const kontrakty = data.getAll("wy_kontrakty").map(String);
  const kwoty = data.getAll("wy_kwota").map(String);
  const notatki = data.getAll("wy_notatka").map(String);

  const n = Math.max(czasy.length, ceny.length, kontrakty.length, kwoty.length, notatki.length);
  const wiersze: WyjscieSzkicu[] = [];

  for (let i = 0; i < n; i += 1) {
    const czasRaw = (czasy[i] ?? "").trim();
    const cenaRaw = (ceny[i] ?? "").trim();
    const kontraktyRaw = (kontrakty[i] ?? "").trim();
    const kwotaRaw = (kwoty[i] ?? "").trim();
    const notatkaRaw = (notatki[i] ?? "").trim();

    if (!czasRaw && !cenaRaw && !kontraktyRaw && !kwotaRaw && !notatkaRaw) continue;

    const kwota = kwotaRaw === "" ? null : parseNumber(kwotaRaw);
    wiersze.push({
      numer: i + 1,
      czas: czasRaw ? { lokalny: czasRaw } : null,
      cena: cenaRaw === "" ? null : parseNumber(cenaRaw),
      kontrakty: kontraktyRaw === "" ? null : parseNumber(kontraktyRaw),
      kwotaBrokera: kwota === null ? null : Math.round(kwota * 100),
      notatka: notatkaRaw === "" ? null : notatkaRaw,
    });
  }
  return wiersze;
}

/**
 * Tagi z formularza. Interwaly siedza w osobnych polach "tagint:<id>" obok
 * checkboxa "tag" - nie w jednej zakodowanej wartosci ("12:5m"), bo nazwa "tag"
 * jest wspoldzielona z filter-bar.tsx i z tagMany, ktore o interwale nic nie wiedza.
 *
 * Od ADR-017 jeden tag moze miec KILKA interwalow naraz - kazdy to osobny
 * wiersz w trade_tags. Iterujemy po ZAZNACZONYCH TAGACH, nie po kluczach
 * "tagint:*": checkbox ukryty CSS-em nadal jedzie w FormData, wiec odznaczenie
 * tagu przy zaznaczonych chipach interwalu zostawiloby tu osierocone wiersze.
 */
function czytajTagi(data: FormData): TagSzkicu[] {
  const selectedTags = data
    .getAll("tag")
    .map((w) => Number(w))
    .filter((n) => Number.isInteger(n) && n > 0);

  return selectedTags.flatMap<TagSzkicu>((tagId) => {
    const interwaly = [
      ...new Set(
        data
          .getAll(`tagint:${tagId}`)
          .filter((w): w is string => typeof w === "string" && czyInterwal(w)),
      ),
    ];
    // Brak wskazanego interwalu to jedno przypisanie bez skali czasu -
    // tak dziala Setup, Blad i konfluencja, ktorej uzytkownik nie doprecyzowal.
    if (interwaly.length === 0) return [{ tagId, interval: null }];
    return interwaly.map((interval) => ({ tagId, interval }));
  });
}

/** Cienki parser: FormData -> `TradeDraft`. Cala walidacja i zapis w `persistTrade`. */
export async function saveTrade(_previous: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const id = integer(data, "id");
  const backtestSessionId = optionalId(data, "backtestSessionId");

  // Limit sprawdzamy przed zapisem, zeby nie zostawic trade'a z polowa zdjec.
  const nowe = zrzutyNoweZInterwalami(data);
  const limit = bladLimitu(id ? await policzZrzuty(id) : 0, nowe.length);
  if (limit) return { ok: false, error: limit };

  const aktywnePola = fieldsForScope(await getFields(), backtestSessionId !== null);
  const brokerRaw = number(data, "brokerAmount");
  const entryTimeRaw = text(data, "entryTime");

  const szkic: TradeDraft = {
    id,
    accountId: integer(data, "accountId"),
    instrumentId: integer(data, "instrumentId"),
    backtestSessionId,
    direction: text(data, "direction"),
    status: text(data, "status") ?? "closed",
    entryTime: entryTimeRaw === null ? null : { lokalny: entryTimeRaw },
    entryPrice: number(data, "entryPrice"),
    contracts: number(data, "contracts"),
    wyjscia: czytajWyjscia(data),
    stopLoss: number(data, "stopLoss"),
    takeProfit: number(data, "takeProfit"),
    mae: number(data, "mae"),
    mfe: number(data, "mfe"),
    brokerAmount: brokerRaw === null ? null : Math.round(brokerRaw * 100),
    note: text(data, "note"),
    moodNote: text(data, "moodNote"),
    // Gotowosc 1-10; zero na suwaku znaczy "nie oceniam" (components/trades/
    // gotowosc.tsx), a wszystko poza skala `persistTrade` zamienia na NULL -
    // to, co przyszlo z formularza, nie moze dotrzec do CHECK-a `trades_readiness`.
    readiness: integer(data, "readiness"),
    custom: readFromForm(aktywnePola, data),
    tags: czytajTagi(data),
    kierunek: {
      directionCorrect: data.get("directionCorrect") !== null,
      kierunekOceniany: data.get("kierunek_oceniany") !== null,
      badExecutionReason: text(data, "badExecutionReason"),
      potentialR: number(data, "potentialR"),
    },
  };

  const zapis = await persistTrade(szkic);
  if (!zapis.ok) {
    return zapis.fieldErrors
      ? { ok: false, error: zapis.error, fieldErrors: zapis.fieldErrors }
      : { ok: false, error: zapis.error };
  }
  const savedId = zapis.id;

  /* `redirect()` (rzuca wyjatek sterujacy Nexta) i zapis zrzutow (I/O na
     dysku) zostaja POZA transakcja zapisu - inaczej redirect wycofalby zapis,
     a plik na dysku i wiersz w bazie moglyby sie rozjechac w inny sposob. */
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
  // Trade z API zostawia nagrobek w ingest_skips, w tej samej transakcji (ADR-026).
  await usunTradeZNagrobkami([id]);
  await deleteTradeDir(id);
  revalidatePath("/", "layout");
  redirect("/trades");
}

/* --- Zrzuty --------------------------------------------------------------- */

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
  // Nagrobki dla tradow z API w tej samej transakcji co kasowanie (ADR-026).
  await usunTradeZNagrobkami(tradeIds);
  await Promise.all(tradeIds.map(deleteTradeDir));
  revalidatePath("/", "layout");
}
