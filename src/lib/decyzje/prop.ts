import "server-only";
import { eq } from "drizzle-orm";

import { dodajWpisKsiegi, przypnijReguly } from "@/lib/api-v2/prop-konta";
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

/**
 * UI v2, etap 3 (Prop): przypięcie presetu firmy do konta z datą zakupu i nadpisaniami (ta sama funkcja co
 * `POST /api/v2/prop/accounts/:id/rules`), z opcją potwierdzenia od razu: wartości wpisuje tu użytkownik,
 * więc może je też od razu potwierdzić z regulaminem (aktor `ui`; agentowi trigger tego nie pozwoli).
 */
export async function przypnijRegulyUi(
  accountId: number,
  d: Parameters<typeof przypnijReguly>[2],
  potwierdz: boolean,
): Promise<WynikDecyzji> {
  return zapisJakoUi(async (tx) => {
    const w = await przypnijReguly(tx, accountId, d);
    if (!w.ok) return { ok: false, komunikat: w.komunikat };
    if (potwierdz) await tx.update(propRules).set({ confirmedAt: new Date() }).where(eq(propRules.id, w.regula.id));
    return { ok: true, komunikat: potwierdz ? "Reguły przypięte i potwierdzone." : "Reguły przypięte. Potwierdź je, gdy sprawdzisz regulamin." };
  });
}

/** Wpis księgi kosztów i wypłat z aplikacji (ta sama walidacja znaku i ochrona przed duplikatem co w API). */
export async function dodajWpisKsiegiUi(accountId: number, d: Parameters<typeof dodajWpisKsiegi>[2]): Promise<WynikDecyzji> {
  return zapisJakoUi(async (tx) => {
    const w = await dodajWpisKsiegi(tx, accountId, d);
    if (!w.ok) return { ok: false, komunikat: w.komunikat };
    return { ok: true, komunikat: w.utworzony ? "Dodano wpis do księgi." : "Taki wpis już jest (sprzed chwili)." };
  });
}
