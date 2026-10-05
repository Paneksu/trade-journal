/**
 * Ocena AI trade'a (ADR-028) - czyste funkcje do panelu na karcie trade'a:
 * nazwy werdyktow, przelaczanie zdania uzytkownika i porownanie planu mozgu
 * z tym, co uzytkownik faktycznie zrobil.
 */

import type { Werdykt, WerdyktUzytkownika } from "./zgodnosc";

export type WerdyktMozgu = "wejdz" | "czekaj" | "odpusc";
export type PodstawaOceny = "chart" | "history";

export const WERDYKT_MOZGU_NAZWY: Record<WerdyktMozgu, string> = {
  wejdz: "Wejdź",
  czekaj: "Czekaj",
  odpusc: "Odpuść",
};

export const WERDYKT_REGULY_NAZWY: Record<Werdykt, string> = {
  pass: "zgodna",
  fail: "złamana",
  na: "nie dotyczy",
  unclear: "niejasne",
};

export const PODSTAWA_NAZWY: Record<PodstawaOceny, string> = {
  chart: "Z wykresu, przed wynikiem",
  history: "Po fakcie",
};

export const PODSTAWA_OPISY: Record<PodstawaOceny, string> = {
  chart: "Ocena z chwili decyzji, bez wiedzy o wyniku.",
  history: "Ocena po zamknięciu trade'a, może być pod wpływem wyniku.",
};

/**
 * Zdanie uzytkownika z formularza albo wywolania akcji.
 * `undefined` = wartosc niedozwolona (akcja ma ja odrzucic);
 * `null` = wyczyszczenie zdania.
 */
export function normalizujWerdyktUzytkownika(w: unknown): WerdyktUzytkownika | null | undefined {
  if (w === null || w === "" || w === "clear") return null;
  return w === "agree" || w === "disagree" ? w : undefined;
}

/** Klik w ten sam przycisk drugi raz cofa zdanie; klik w drugi przycisk je zmienia. */
export function nastepnyWerdykt(
  obecny: WerdyktUzytkownika | null,
  kliknieto: WerdyktUzytkownika,
): WerdyktUzytkownika | null {
  return obecny === kliknieto ? null : kliknieto;
}

export type WierszPlanu = {
  klucz: "entry" | "stopLoss" | "takeProfit";
  etykieta: string;
  mozg: number | null;
  uzytkownik: number | null;
  /** Roznica uzytkownik minus mozg w tickach; `null`, gdy brak ktorejs strony albo ticku. */
  roznicaTickow: number | null;
};

/**
 * Plan mozgu obok ceny uzytkownika. Plan to jsonb z kluczami wolnymi, wiec
 * bierzemy tylko liczby skonczone - reszta wiersza zostaje "brak".
 */
export function porownajPlan(
  plan: { entry?: unknown; stopLoss?: unknown; takeProfit?: unknown } | null | undefined,
  uzytkownik: { entry: number | null; stopLoss: number | null; takeProfit: number | null },
  tickSize: number | null,
): WierszPlanu[] {
  const liczba = (w: unknown): number | null =>
    typeof w === "number" && Number.isFinite(w) ? w : null;
  const wiersze: [WierszPlanu["klucz"], string][] = [
    ["entry", "Wejście"],
    ["stopLoss", "Stop loss"],
    ["takeProfit", "Take profit"],
  ];
  return wiersze.map(([klucz, etykieta]) => {
    const mozg = liczba(plan?.[klucz]);
    const ty = uzytkownik[klucz];
    const ticki =
      mozg !== null && ty !== null && tickSize !== null && tickSize > 0
        ? Math.round(((ty - mozg) / tickSize) * 100) / 100
        : null;
    return { klucz, etykieta, mozg, uzytkownik: ty, roznicaTickow: ticki };
  });
}

export type DecyzjaWzgledemMozgu = {
  /** "zgodna" - zrobil to, co mozg; "odstepstwo" - inaczej; "brak" - nie ma czego porownac. */
  wynik: "zgodna" | "odstepstwo" | "brak";
  opis: string;
};

/** Czy to, co uzytkownik zrobil (wzial albo pominal trade), pokrywa sie z werdyktem mozgu. */
export function decyzjaWzgledemMozgu(
  werdykt: WerdyktMozgu | null,
  status: string,
): DecyzjaWzgledemMozgu {
  if (werdykt === null) return { wynik: "brak", opis: "Mózg nie wydał werdyktu." };
  const wzial = status !== "missed" && status !== "cancelled" && status !== "planned";
  const pominal = status === "missed";
  if (!wzial && !pominal) return { wynik: "brak", opis: "Trade jeszcze nie wzięty." };
  if (werdykt === "wejdz") {
    return wzial
      ? { wynik: "zgodna", opis: "Mózg radził wejść, wszedłeś." }
      : { wynik: "odstepstwo", opis: "Mózg radził wejść, pominąłeś ten setup." };
  }
  const slowo = werdykt === "czekaj" ? "czekać" : "odpuścić";
  return wzial
    ? { wynik: "odstepstwo", opis: `Mózg radził ${slowo}, wszedłeś.` }
    : { wynik: "zgodna", opis: `Mózg radził ${slowo}, pominąłeś setup.` };
}
