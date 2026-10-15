import "server-only";
import { eq } from "drizzle-orm";

import { zapisJakoUi } from "@/lib/api-v2/zapis";
import { propRules } from "@/lib/db/schema";

import type { WynikDecyzji } from "./sugestie";

/**
 * Potwierdzenie regul konta prop (R29, Slowa uzytkownika 15.10.2026: «Licz na ostrzejszej»): dopoki
 * uzytkownik nie potwierdzi w aplikacji, ze wartosci zgadzaja sie z regulaminem firmy, bufory sa liczone
 * na ostrzejszej z regul (ostatniej potwierdzonej i nowej). Zapis tylko jako aktor `ui` (trigger
 * `prop_rules_confirm_update`, TJ403 dla agenta).
 */
export async function potwierdzReguleKonta(ruleId: number): Promise<WynikDecyzji> {
  return zapisJakoUi(async (tx) => {
    const [r] = await tx.select().from(propRules).where(eq(propRules.id, ruleId)).for("update").limit(1);
    if (!r) return { ok: false, komunikat: `Reguły konta #${ruleId} nie istnieją.` };
    if (r.confirmedAt) return { ok: false, komunikat: `Reguły konta #${ruleId} zostały już potwierdzone (${r.confirmedAt.toISOString()}).` };
    await tx.update(propRules).set({ confirmedAt: new Date() }).where(eq(propRules.id, ruleId));
    return { ok: true, komunikat: "Reguły potwierdzone. Bufory liczę teraz na nich." };
  });
}
