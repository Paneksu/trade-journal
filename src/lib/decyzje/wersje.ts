import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { zapisZAktorem, type Transakcja } from "@/lib/api-v2/zapis";
import { notes, ruleVersions, rules, setupVersions, settings } from "@/lib/db/schema";

import type { WynikDecyzji } from "./sugestie";

/**
 * Decyzje uzytkownika o PROPOZYCJACH wersji regul i setupow (ADR-029, ADR-033). Jedna propozycja
 * naraz; tylko w transakcji z aktorem `ui` (trigger `tj_require_ui_actor`, TJ403 dla agenta).
 * Tresc wersji jest niezmienna (trigger), wiec »popraw i przyjmij« to: stara propozycja idzie do
 * odrzuconych z adnotacja, a poprawiona tresc wchodzi jako NOWA wersja uzytkownika, od razu zatwierdzona.
 *
 * Zatwierdzenie reguly podbija numer zestawu regul (`settings.ruleset_version`) w tej samej
 * transakcji; poprzednia obowiazujaca wersja staje sie »superseded« (najpierw ona, potem nowa, bo
 * unikat czesciowy sprawdza po kazdej instrukcji).
 */

const blad = (komunikat: string): WynikDecyzji => ({ ok: false, komunikat });

type WersjaReguly = typeof ruleVersions.$inferSelect;

async function pobierzWersjeReguly(tx: Transakcja, id: number): Promise<WersjaReguly | null> {
  const [w] = await tx.select().from(ruleVersions).where(eq(ruleVersions.id, id)).for("update").limit(1);
  return w ?? null;
}

async function nastepnyZestaw(tx: Transakcja): Promise<number> {
  const [s] = await tx
    .update(settings)
    .set({ rulesetVersion: sql`${settings.rulesetVersion} + 1`, updatedAt: new Date() })
    .where(eq(settings.id, 1))
    .returning({ v: settings.rulesetVersion });
  if (!s) throw new Error("Baza nie ma wiersza ustawień (settings), więc nie da się podbić numeru zestawu reguł. Uruchom `npm run seed`.");
  return s.v;
}

/** Zastepuje poprzednia obowiazujaca wersje reguly nowa, juz zatwierdzona. */
async function zastapObowiazujaca(tx: Transakcja, ruleId: number): Promise<void> {
  await tx
    .update(ruleVersions)
    .set({ status: "superseded", supersededAt: new Date() })
    .where(and(eq(ruleVersions.ruleId, ruleId), eq(ruleVersions.status, "approved")));
}

async function odswiezTrescNotatki(tx: Transakcja, ruleId: number, tekst: string): Promise<void> {
  const [r] = await tx.select({ noteId: rules.noteId }).from(rules).where(eq(rules.id, ruleId)).limit(1);
  if (r) await tx.update(notes).set({ bodyMd: tekst }).where(eq(notes.id, r.noteId));
}

export async function przyjmijWersjeReguly(versionId: number): Promise<WynikDecyzji> {
  return zapisZAktorem("ui", async (tx) => {
    const w = await pobierzWersjeReguly(tx, versionId);
    if (!w) return blad(`Wersja reguły #${versionId} nie istnieje.`);
    if (w.status !== "proposed") return blad(`Wersja #${versionId} ma status »${w.status}«, a przyjąć można tylko propozycję. Odśwież listę.`);
    const zestaw = await nastepnyZestaw(tx);
    await zastapObowiazujaca(tx, w.ruleId);
    await tx.update(ruleVersions).set({ status: "approved", decidedAt: new Date(), rulesetVersion: zestaw }).where(eq(ruleVersions.id, versionId));
    await odswiezTrescNotatki(tx, w.ruleId, w.textMd);
    return { ok: true, komunikat: `Reguła przyjęta. Obowiązuje zestaw reguł nr ${zestaw}.` };
  });
}

export async function przyjmijWersjeRegulyZPoprawka(versionId: number, poprawionyTekst: string): Promise<WynikDecyzji> {
  const tekst = poprawionyTekst;
  if (tekst.trim() === "") return blad("Poprawiony tekst reguły jest pusty. Wpisz treść albo użyj »Przyjmij« bez poprawek.");
  return zapisZAktorem("ui", async (tx) => {
    const w = await pobierzWersjeReguly(tx, versionId);
    if (!w) return blad(`Wersja reguły #${versionId} nie istnieje.`);
    if (w.status !== "proposed") return blad(`Wersja #${versionId} ma status »${w.status}«, a poprawić i przyjąć można tylko propozycję. Odśwież listę.`);
    if (tekst === w.textMd) return blad("Tekst nie różni się od propozycji. Użyj »Przyjmij« bez poprawek.");

    const [{ maks }] = await tx
      .select({ maks: sql<number>`coalesce(max(${ruleVersions.version}), 0)::int` })
      .from(ruleVersions)
      .where(eq(ruleVersions.ruleId, w.ruleId));
    const numer = maks + 1;
    const zestaw = await nastepnyZestaw(tx);

    // Najpierw odrzucenie oryginalu (unikat czesciowy: jedna propozycja naraz), potem zastapienie obowiazujacej.
    await tx
      .update(ruleVersions)
      .set({ status: "rejected", decidedAt: new Date(), decisionReason: `Poprawiona przez użytkownika przed przyjęciem: wersja ${numer}.` })
      .where(eq(ruleVersions.id, versionId));
    await zastapObowiazujaca(tx, w.ruleId);
    await tx.insert(ruleVersions).values({
      ruleId: w.ruleId,
      version: numer,
      textMd: tekst,
      status: "approved",
      origin: "user",
      decidedAt: new Date(),
      rulesetVersion: zestaw,
      decisionReason: `Poprawka wersji ${w.version} (${w.origin}) przed przyjęciem.`,
    });
    await odswiezTrescNotatki(tx, w.ruleId, tekst);
    return { ok: true, komunikat: `Reguła poprawiona i przyjęta jako wersja ${numer}. Obowiązuje zestaw reguł nr ${zestaw}.` };
  });
}

export async function odrzucWersjeReguly(versionId: number, powod: string): Promise<WynikDecyzji> {
  if (powod.trim() === "") return blad("Podaj powód odrzucenia (kilka słów). Dzięki niemu AI nie zgłosi tego samego drugi raz bez nowego argumentu.");
  return zapisZAktorem("ui", async (tx) => {
    const w = await pobierzWersjeReguly(tx, versionId);
    if (!w) return blad(`Wersja reguły #${versionId} nie istnieje.`);
    if (w.status !== "proposed") return blad(`Wersja #${versionId} ma status »${w.status}«, a odrzucić można tylko propozycję. Odśwież listę.`);
    await tx.update(ruleVersions).set({ status: "rejected", decidedAt: new Date(), decisionReason: powod }).where(eq(ruleVersions.id, versionId));
    return { ok: true, komunikat: "Propozycja odrzucona." };
  });
}

/* --- Setupy ------------------------------------------------------------------------------------------ */

export async function przyjmijWersjeSetupu(versionId: number): Promise<WynikDecyzji> {
  return zapisZAktorem("ui", async (tx) => {
    const [w] = await tx.select().from(setupVersions).where(eq(setupVersions.id, versionId)).for("update").limit(1);
    if (!w) return blad(`Wersja setupu #${versionId} nie istnieje.`);
    if (w.status !== "proposed") return blad(`Wersja #${versionId} ma status »${w.status}«, a przyjąć można tylko propozycję. Odśwież listę.`);
    await tx
      .update(setupVersions)
      .set({ status: "superseded", supersededAt: new Date() })
      .where(and(eq(setupVersions.setupId, w.setupId), eq(setupVersions.status, "approved")));
    await tx.update(setupVersions).set({ status: "approved", decidedAt: new Date() }).where(eq(setupVersions.id, versionId));
    return { ok: true, komunikat: "Wersja setupu przyjęta. Nowe plany wskazują tę wersję." };
  });
}

export async function odrzucWersjeSetupu(versionId: number, powod: string): Promise<WynikDecyzji> {
  if (powod.trim() === "") return blad("Podaj powód odrzucenia (kilka słów).");
  return zapisZAktorem("ui", async (tx) => {
    const [w] = await tx.select().from(setupVersions).where(eq(setupVersions.id, versionId)).for("update").limit(1);
    if (!w) return blad(`Wersja setupu #${versionId} nie istnieje.`);
    if (w.status !== "proposed") return blad(`Wersja #${versionId} ma status »${w.status}«, a odrzucić można tylko propozycję. Odśwież listę.`);
    await tx.update(setupVersions).set({ status: "rejected", decidedAt: new Date(), decisionReason: powod }).where(eq(setupVersions.id, versionId));
    return { ok: true, komunikat: "Propozycja odrzucona." };
  });
}
