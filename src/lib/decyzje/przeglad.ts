import "server-only";
import { eq } from "drizzle-orm";

import { userWords, weeklyReviews } from "@/lib/db/schema";
import { czyPoniedzialek, zapiszPrzeglad } from "@/lib/api-v2/przeglady";
import { zapisJakoUi } from "@/lib/api-v2/zapis";
import { sprawdzTekstBajtWBajt } from "@/lib/domain/notatki";

import type { WynikDecyzji } from "./sugestie";

/**
 * Zatwierdzenie przeglądu tygodnia (MUST 9, UI v2 etap 3). AI przygotowuje szkic przez API
 * (`PUT /api/v2/reviews/weekly/:weekStart`); wnioski, JEDNO zobowiązanie i rozliczenie poprzedniego
 * pisze użytkownik (słowa dosłownie), a status `approved` ustawia tylko aktor `ui` (trigger
 * `weekly_reviews_ui_actor`). Ta sama walidacja co w API (`zapiszPrzeglad`): jedno zobowiązanie,
 * rozliczenie tylko gdy poprzedni tydzień miał zobowiązanie.
 */
export async function zatwierdzPrzegladUi(
  weekStart: string,
  d: { wnioski: string; zobowiazanie: string; rozliczenie: "kept" | "partial" | "broken" | null; slowaRozliczenia: string },
): Promise<WynikDecyzji> {
  if (!czyPoniedzialek(weekStart)) return { ok: false, komunikat: `${weekStart} nie jest poniedziałkiem.` };
  for (const [nazwa, tekst] of [["Wnioski", d.wnioski], ["Zobowiązanie", d.zobowiazanie]] as const) {
    if (tekst.trim().length === 0) return { ok: false, komunikat: `${nazwa}: wpisz swoimi słowami (jedno zdanie wystarczy).` };
    const b = sprawdzTekstBajtWBajt(tekst);
    if (!b.ok) return { ok: false, komunikat: `${nazwa}: ${b.powod}.` };
  }
  return zapisJakoUi(async (tx) => {
    const slowa = async (tekst: string, role: string) => {
      const [w] = await tx.insert(userWords).values({ text: tekst, source: "ui", role, day: weekStart, capturedAt: new Date() }).returning({ id: userWords.id });
      return w.id;
    };
    const wnioski = await slowa(d.wnioski, "weekly.conclusions");
    const zobowiazanie = await slowa(d.zobowiazanie, "weekly.commitment");
    const rozliczenie = d.rozliczenie && d.slowaRozliczenia.trim() ? await slowa(d.slowaRozliczenia, "weekly.prev_result") : undefined;
    const w = await zapiszPrzeglad(tx, weekStart, {
      conclusionsWordsId: wnioski,
      commitmentWordsId: zobowiazanie,
      ...(d.rozliczenie ? { prevCommitmentResult: d.rozliczenie } : {}),
      ...(rozliczenie ? { prevResultWordsId: rozliczenie } : {}),
    });
    if (!w.ok) throw new BladPrzegladu(w.komunikat);
    await tx.update(weeklyReviews).set({ status: "approved", approvedAt: new Date() }).where(eq(weeklyReviews.id, w.przeglad.id));
    return { ok: true, komunikat: "Przegląd zatwierdzony. Zobowiązanie rozliczysz w przyszłym tygodniu." };
  }).catch((e: unknown) => {
    if (e instanceof BladPrzegladu) return { ok: false, komunikat: e.message };
    throw e;
  });
}

/** Odmowa po wstawieniu słów: wyjątek wycofuje transakcję, żeby słowa nie zostały bez przeglądu. */
class BladPrzegladu extends Error {}
