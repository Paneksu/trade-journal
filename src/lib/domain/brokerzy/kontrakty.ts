/**
 * Kontrakty futures: rdzen z symbolu kontraktu i klasa (mini / micro) dla stawki oplat (ADR-034 pkt 2 i 5).
 * Modul czysty: bez bazy, bez Next.
 */

/** Kody miesiecy kontraktow futures (F=sty ... Z=gru). */
const KODY_MIESIECY = "FGHJKMNQUVXZ";

const WZORZEC_KONTRAKTU = new RegExp(`^([A-Z0-9]{1,6}?)([${KODY_MIESIECY}])(\\d{1,2})$`);

/**
 * Rdzen instrumentu z symbolu kontraktu u brokera: `NQZ6` -> `NQ`, `MNQZ6` -> `MNQ`, `M2KZ6` -> `M2K`, `6EZ6` -> `6E`.
 * Symbol bez kodu miesiaca i roku (np. `MNQ`, czyli rdzen sam w sobie) wraca bez zmian. `null`, gdy to nie wyglada na symbol.
 */
export function rdzenKontraktu(kontrakt: string): string | null {
  const k = kontrakt.trim().toUpperCase();
  if (k === "" || !/^[A-Z0-9]{1,12}$/.test(k)) return null;
  const m = WZORZEC_KONTRAKTU.exec(k);
  return m ? m[1] : k;
}

/** Rdzenie micro znane z seeda i najpopularniejszych kontraktow futures (zgodne z migracja 0030). */
const MIKRO = new Set(["MES", "MNQ", "MYM", "M2K", "MCL", "MGC", "MBT", "MET", "M6E", "M6B", "M6A"]);

/** Klasa kontraktu dla stawki oplat po rdzeniu symbolu: micro dla znanych kontraktow micro, reszta mini. */
export function klasaKontraktu(rdzen: string): "mini" | "micro" {
  return MIKRO.has(rdzen.trim().toUpperCase()) ? "micro" : "mini";
}
