/**
 * Kategoria trade'a (ADR-027): rozroznienie, ktore ma sens dla statystyk, bo
 * wynik na koncie prop w fazie oceny (challenge) nie znaczy tego samego co
 * wynik na koncie z prawdziwymi pieniedzmi.
 *
 * Kategoria WYNIKA z konta (`accounts.type` + `accounts.prop_phase`), nie jest
 * kolumna trade'a - przeniesienie konta z "eval" na "funded" przesuwa wiec
 * cala jego historie, tak jak powinno. Konto prop bez podanej fazy nie nalezy
 * do zadnej kategorii (jego faza jest nieznana, a zgadywanie falszowaloby obie
 * grupy) - interfejs ma o te faze prosic.
 *
 * Backtest i forward test NIE sa kategoriami: to rodzaj SESJI
 * (`backtest_sessions.kind`) i maja wlasne zrodlo w filtrze (`zrodlo=`).
 */

export const KATEGORIE = ["realne", "prop_eval", "prop_funded", "demo"] as const;
export type Kategoria = (typeof KATEGORIE)[number];

export const KATEGORIA_NAZWY: Record<Kategoria, string> = {
  realne: "Realne",
  prop_eval: "Prop: ocena",
  prop_funded: "Prop: funded",
  demo: "Demo",
};

export function czyKategoria(w: string | null | undefined): w is Kategoria {
  return typeof w === "string" && (KATEGORIE as readonly string[]).includes(w);
}

export type KontoDoKategorii = {
  type: "live" | "demo" | "prop" | "paper";
  propPhase: "eval" | "funded" | null;
};

/** Kategoria konta albo `null` (prop bez fazy). */
export function kategoriaKonta(konto: KontoDoKategorii): Kategoria | null {
  switch (konto.type) {
    case "live":
      return "realne";
    case "demo":
    case "paper":
      return "demo";
    case "prop":
      return konto.propPhase === "eval" ? "prop_eval" : konto.propPhase === "funded" ? "prop_funded" : null;
  }
}
