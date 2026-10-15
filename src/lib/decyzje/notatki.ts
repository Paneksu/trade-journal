import "server-only";
import { eq } from "drizzle-orm";

import { userWords } from "@/lib/db/schema";
import { utworzNotatke, zmienNotatke, KINDY_ZARZADZANE } from "@/lib/api-v2/notatki";
import { zapiszKorekteInterpretacji } from "@/lib/api-v2/profil";
import type { KontekstApi } from "@/lib/api-v2/with-api";
import { zapisJakoUi } from "@/lib/api-v2/zapis";
import { sprawdzTekstBajtWBajt } from "@/lib/domain/notatki";

/**
 * Zapisy notatek i słów użytkownika z aplikacji (UI v2, Mózg). Aktor `ui` (sesja po `requireSession` w akcji).
 * Te same funkcje co API v2 (`utworzNotatke`, `zmienNotatke`, `zapiszKorekteInterpretacji`), więc obowiązują te same
 * reguły: unikalny tytuł, `If-Match` (rewizja), linki `[[...]]`, ślepa ocena. Notatek typowanych encji (reguła,
 * hipoteza, setup) nie zmienia się tu: zmieniają je wersje w „Do decyzji”.
 *
 * Słowa użytkownika są niezmienne (MUST 13): poprawka tworzy NOWY wiersz wskazujący poprzedni (`supersedes_id`),
 * a stary zostaje jako rewizja. Tylko użytkownik w aplikacji może to zrobić; API zawsze odpowiada 409.
 */

/** Autor zapisu z aplikacji: bez tokenu urządzenia. */
const AUTOR_UI = { token: { id: null } };

export type WynikZapisu = { ok: true; id: number; rev?: number } | { ok: false; komunikat: string };

export const KINDY_DO_EDYCJI = ["concept", "system", "strategy", "decision_proc", "mistake", "strength", "learning", "brain_decision", "session", "trade_note"] as const;

export async function utworzNotatkeUi(kind: string, tytul: string, tresc: string): Promise<WynikZapisu> {
  if (!(KINDY_DO_EDYCJI as readonly string[]).includes(kind)) return { ok: false, komunikat: `Rodzaj »${kind}« nie powstaje w edytorze notatek.` };
  if (tytul.trim().length === 0) return { ok: false, komunikat: "Podaj tytuł notatki." };
  return zapisJakoUi(async (tx) => {
    // Pochodzenie »user« jest zarezerwowane dla aplikacji (OriginApiSchema go nie przyjmuje), stąd rzutowanie.
    const w = await utworzNotatke(tx, AUTOR_UI, { kind: kind as never, title: tytul.trim(), bodyMd: tresc, meta: {}, origin: "user" as never });
    return w.ok ? { ok: true as const, id: w.notatka.id, rev: w.notatka.rev } : { ok: false as const, komunikat: w.komunikat };
  });
}

export async function zmienNotatkeUi(id: number, rev: number, tytul: string, tresc: string): Promise<WynikZapisu> {
  return zapisJakoUi(async (tx) => {
    const w = await zmienNotatke(tx, id, rev, { title: tytul.trim(), bodyMd: tresc });
    if (!w.ok) {
      const komunikat =
        w.kod === "rev_mismatch"
          ? "Notatka zmieniła się w międzyczasie (inne urządzenie albo AI). Skopiuj swoją wersję, odśwież stronę i scal zmiany."
          : w.kod === "managed_note"
            ? "To notatka reguły, hipotezy albo setupu: jej treść zmienia nowa wersja w „Do decyzji”, nie edytor."
            : w.komunikat;
      return { ok: false as const, komunikat };
    }
    return { ok: true as const, id: w.notatka.id, rev: w.notatka.rev };
  });
}

export function czyZarzadzana(kind: string): boolean {
  return (KINDY_ZARZADZANE as readonly string[]).includes(kind);
}

/** Poprawka słów użytkownika z rewizją: nowy wiersz z tymi samymi kotwicami, `supersedes_id` = poprzedni. */
export async function poprawSlowa(wordsId: number, nowyTekst: string): Promise<WynikZapisu> {
  const bajty = sprawdzTekstBajtWBajt(nowyTekst);
  if (!bajty.ok) return { ok: false, komunikat: `Tekst: ${bajty.powod}.` };
  if (nowyTekst.length === 0) return { ok: false, komunikat: "Poprawka nie może być pusta." };
  return zapisJakoUi(async (tx) => {
    const [stare] = await tx.select().from(userWords).where(eq(userWords.id, wordsId)).for("update").limit(1);
    if (!stare) return { ok: false as const, komunikat: `Słowa #${wordsId} nie istnieją.` };
    const [nastepca] = await tx.select({ id: userWords.id }).from(userWords).where(eq(userWords.supersedesId, wordsId)).limit(1);
    if (nastepca) return { ok: false as const, komunikat: "Te słowa mają już nowszą rewizję. Odśwież stronę i popraw najnowszą." };
    if (stare.text === nowyTekst) return { ok: false as const, komunikat: "Tekst jest taki sam jak obecny, więc to nie jest poprawka." };
    const [nowe] = await tx
      .insert(userWords)
      .values({
        text: nowyTekst,
        source: "ui",
        role: stare.role,
        tradeId: stare.tradeId,
        noteId: stare.noteId,
        backtestSessionId: stare.backtestSessionId,
        day: stare.day,
        capturedAt: new Date(),
        supersedesId: stare.id,
      })
      .returning({ id: userWords.id });
    return { ok: true as const, id: nowe.id };
  });
}

/**
 * Korekta interpretacji AI przez użytkownika („nie, chodziło mi o…”): Twoje słowa zapisane dosłownie jako osobny wpis,
 * nowa interpretacja w rejestrze poprawek (`interpretation_corrections`), opcjonalnie propozycja hasła słownika.
 */
export async function poprawInterpretacje(
  wordsId: number,
  slowaPoprawki: string,
  nowaInterpretacja: string,
  haslo?: { term: string; meaning: string },
): Promise<WynikZapisu> {
  const bajty = sprawdzTekstBajtWBajt(slowaPoprawki);
  if (!bajty.ok || slowaPoprawki.trim().length === 0) return { ok: false, komunikat: "Napisz własnymi słowami, o co Ci chodziło." };
  if (nowaInterpretacja.trim().length === 0) return { ok: false, komunikat: "Podaj poprawioną interpretację." };
  return zapisJakoUi(async (tx) => {
    const [stare] = await tx.select().from(userWords).where(eq(userWords.id, wordsId)).limit(1);
    if (!stare) return { ok: false as const, komunikat: `Słowa #${wordsId} nie istnieją.` };
    const [korekta] = await tx
      .insert(userWords)
      .values({ text: slowaPoprawki, source: "ui", role: "correction", noteId: stare.noteId, tradeId: stare.tradeId, day: stare.day, capturedAt: new Date() })
      .returning({ id: userWords.id });
    const w = await zapiszKorekteInterpretacji(tx, AUTOR_UI as unknown as KontekstApi, {
      wordsId,
      correctionWordsId: korekta.id,
      afterInterpretation: nowaInterpretacja.trim(),
      ...(haslo ? { term: haslo.term, termMeaning: haslo.meaning } : {}),
    });
    if (!w.ok) throw new BladKorekty(w.komunikat);
    return { ok: true as const, id: w.correctionId };
  }).catch((e: unknown) => {
    if (e instanceof BladKorekty) return { ok: false as const, komunikat: e.message };
    throw e;
  });
}

/** Odmowa po wstawieniu słów korekty: wyjątek wycofuje transakcję, żeby nie zostawić osieroconego wpisu. */
class BladKorekty extends Error {}
