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

export const FAZY_PROP = ["eval", "funded"] as const;
export type FazaProp = (typeof FAZY_PROP)[number];

export const FAZA_PROP_NAZWY: Record<FazaProp, string> = {
  eval: "ocena (challenge)",
  funded: "funded",
};

export type WynikFazyProp = { ok: true; faza: FazaProp | null } | { ok: false; error: string };

/**
 * Faza z formularza konta. Baza (CHECK) trzyma faze wylacznie przy koncie typu
 * `prop`, wiec dla innych typow zawsze `null` - nawet gdy ukryte pole wciaz
 * niesie starą wartosc po zmianie typu. Konto prop bez fazy jest dozwolone
 * (stare konta), ale nie nalezy do zadnej kategorii.
 */
export function walidujFazeProp(typ: string, surowa: string | null): WynikFazyProp {
  if (typ !== "prop") return { ok: true, faza: null };
  if (surowa === null || surowa === "") return { ok: true, faza: null };
  if ((FAZY_PROP as readonly string[]).includes(surowa)) return { ok: true, faza: surowa as FazaProp };
  return { ok: false, error: "Nieznana faza konta prop. Wybierz „ocena” albo „funded”." };
}
