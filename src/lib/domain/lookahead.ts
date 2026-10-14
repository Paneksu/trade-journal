/**
 * Ryzyko look-ahead modelu (ADR-033; metodyka R3). Werdykt AI na dniu, ktory model mogl
 * znac z treningu (historyczny dzien NQ sprzed daty odciecia wiedzy), dostaje flage
 * »model mogl znac ten dzien«. Flaga jest WYLICZANA z modelu i dnia handlowego, nie
 * zapisywana, wiec poprawka listy odciec dziala wstecz na cala historie.
 *
 * Daty odciecia sa PRZYBLIZONE (zrodlo: deklaracje dostawcow; nie ma ich w API) i celowo
 * ostrozne: nieznany model = »mogl znac«. Dodanie modelu to dopisanie wiersza ponizej.
 */

export type OdciecieModelu = {
  wzorzec: RegExp;
  /** Ostatni dzien, o ktorym model mogl miec wiedze z treningu (YYYY-MM-DD). */
  odciecie: string;
  przyblizone: boolean;
};

export const ODCIECIA_MODELI: readonly OdciecieModelu[] = [
  { wzorzec: /claude-(?:opus|sonnet|haiku|fable)-?5/i, odciecie: "2026-06-30", przyblizone: true },
  { wzorzec: /claude-(?:opus|sonnet|haiku)-?4/i, odciecie: "2025-03-31", przyblizone: true },
  { wzorzec: /claude-3/i, odciecie: "2024-04-30", przyblizone: true },
];

export type OcenaLookAhead = {
  moglZnacDzien: boolean;
  powod: string;
};

export function moglZnacDzien(model: string | null | undefined, dzien: string): OcenaLookAhead {
  const nazwa = (model ?? "").trim();
  if (nazwa === "") {
    return { moglZnacDzien: true, powod: "model nieznany: zakładam, że mógł znać ten dzień" };
  }
  const wpis = ODCIECIA_MODELI.find((o) => o.wzorzec.test(nazwa));
  if (!wpis) {
    return { moglZnacDzien: true, powod: `model »${nazwa}« nie jest na liście odcięć wiedzy: zakładam, że mógł znać dzień ${dzien}` };
  }
  return dzien <= wpis.odciecie
    ? { moglZnacDzien: true, powod: `dzień ${dzien} jest nie późniejszy niż odcięcie wiedzy modelu (${wpis.odciecie}${wpis.przyblizone ? ", przybliżone" : ""})` }
    : { moglZnacDzien: false, powod: `dzień ${dzien} jest późniejszy niż odcięcie wiedzy modelu (${wpis.odciecie}${wpis.przyblizone ? ", przybliżone" : ""})` };
}
