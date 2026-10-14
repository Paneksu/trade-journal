import "server-only";
import { eq } from "drizzle-orm";

import { zapisZAktorem } from "@/lib/api-v2/zapis";
import { strategyGaps, userWords } from "@/lib/db/schema";

import { czyRozstrzygniecie, ROZSTRZYGNIECIA, ROZSTRZYGNIECIE_OPISY } from "./rozstrzygniecia-opisy";
import type { WynikDecyzji } from "./sugestie";

/**
 * »Do rozstrzygniecia« (ADR-033, MUST 15 i 16): sprzecznosc miedzy tym, co mowi mentor, a Twoja
 * praktyka. AI jej NIE rozstrzyga - zapisuje ja wylacznie uzytkownik, w transakcji z aktorem `ui`
 * (trigger `tj_require_ui_actor`, TJ403 dla agenta). Odpowiedz to jedna z trzech decyzji i TWOJE
 * SLOWA (powod albo warunek), zapisane bajt w bajt jako `user_words` (skrot liczy baza):
 *   keep_mine        - zostaje moj sposob
 *   take_mentor      - biore mentora
 *   both_conditional - oba, kazdy z warunkiem (warunek w Twoich slowach)
 */

const blad = (komunikat: string): WynikDecyzji => ({ ok: false, komunikat });

export async function rozstrzygnijSprzecznosc(gapId: number, decyzja: unknown, slowaUzytkownika: string): Promise<WynikDecyzji> {
  if (!czyRozstrzygniecie(decyzja)) return blad(`Wybierz jedną z trzech odpowiedzi: ${ROZSTRZYGNIECIA.map((r) => ROZSTRZYGNIECIE_OPISY[r]).join(" / ")}.`);
  // Tekst zapisujemy dokladnie tak, jak go wpisano (bez trim); odrzucamy tylko wpis pusty lub z samych spacji.
  if (slowaUzytkownika.trim() === "") {
    return blad(decyzja === "both_conditional" ? "Wpisz warunki: kiedy działa Twój sposób, a kiedy mentora." : "Wpisz kilka słów dlaczego (Twoje słowa zostają w dzienniku dosłownie).");
  }
  if (slowaUzytkownika.includes("\u0000")) return blad("Tekst zawiera znak NUL (kod 0), którego baza nie przyjmie. Usuń go.");
  if (slowaUzytkownika.length > 20_000) return blad(`Tekst ma ${slowaUzytkownika.length} znaków, a limit to 20000.`);

  return zapisZAktorem("ui", async (tx) => {
    const [g] = await tx.select().from(strategyGaps).where(eq(strategyGaps.id, gapId)).for("update").limit(1);
    if (!g) return blad(`Pytanie #${gapId} nie istnieje.`);
    if (g.kind !== "mentor_conflict") return blad(`Pytanie #${gapId} to luka w strategii, nie sprzeczność z mentorem; odpowiada się na nie w rytuale po sesji.`);
    if (g.status !== "open" && g.status !== "asked") return blad(`Pytanie #${gapId} ma status »${g.status}«: ktoś je już rozstrzygnął. Odśwież listę.`);

    const teraz = new Date();
    const [slowa] = await tx
      .insert(userWords)
      .values({
        text: slowaUzytkownika,
        source: "ui",
        role: "conflict.answer",
        // Kotwica dniem, nie trade'em: odpowiedz ma przezyc skasowanie trade'u, na ktorego dotyczy sprzecznosc.
        day: teraz.toISOString().slice(0, 10),
        capturedAt: teraz,
      })
      .returning({ id: userWords.id });
    await tx
      .update(strategyGaps)
      .set({ status: "answered", resolution: decyzja, answerWordsId: slowa.id, answeredAt: teraz })
      .where(eq(strategyGaps.id, gapId));
    return { ok: true, komunikat: `Rozstrzygnięte: ${ROZSTRZYGNIECIE_OPISY[decyzja]}.` };
  });
}
