import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Wynik trade'a ma trzy stany, nie dwa (ADR-011). Stop przesuniety na BE
 * rzadko wychodzi dokladnie na zero, wiec trade wyprowadzony na +7 USD nie
 * powinien liczyc sie jako wygrana - zawyzalby skutecznosc. Prog BE skaluje
 * sie wielkoscia trade'a: ulamek ryzyka gdy jest stop, zapasowy prog na
 * kontrakt gdy stopa nie ma.
 *
 * Modul czysty poza jednym swiadomym odstepstwem: `sqlProgBE`/`sqlWynik`
 * buduja fragment SQL przez `sql` z drizzle-orm (tagged template, nie klient
 * bazy), zeby ten sam warunek dalo sie policzyc w bazie i w TypeScripcie bez
 * dwoch wzorow obok siebie. Kolumny dostaje wywolujacy (np. `filters.ts`) -
 * modul nie zna schematu bazy.
 *
 * Obie postacie - `wynikTrade` i `sqlWynik` - porownuja `pnl` z progiem,
 * nigdy znak `pnl` plus osobny test "czy zero". Dzieki `prog >= 0` warunek
 * `pnl > prog` znaczy dokladnie to samo po obu stronach, bez galezi, w
 * ktorych mogloby sie to rozjechac. Granica jest domknieta: `pnl` rowne
 * progowi co do centa to "be", nie "zysk" ani "strata".
 */

export type Wynik = "zysk" | "strata" | "be";

export type Progi = { progRMille: number; progNaKontrakt: number };

/** Domyslne progi - musza sie zgadzac z wartosciami default w schema.ts. */
export const DOMYSLNE_PROGI: Progi = { progRMille: 100, progNaKontrakt: 200 };

export function progiZUstawien(s: { beProgRMille: number; beProgNaKontrakt: number }): Progi {
  return { progRMille: s.beProgRMille, progNaKontrakt: s.beProgNaKontrakt };
}

/**
 * Prog BE w centach. Gdy trade ma ryzyko (stop zdefiniowany), prog to ulamek
 * tego ryzyka w tysiecznych R. Bez stopa ryzyka nie ma z czego liczyc ulamka,
 * wiec wchodzi zapasowy prog kwotowy na kontrakt - stad `abs(contracts)`,
 * nie kierunek pozycji.
 */
export function progBE(riskAmount: number | null, contracts: number, p: Progi): number {
  if (riskAmount !== null && riskAmount > 0) {
    return Math.round((p.progRMille * riskAmount) / 1000);
  }
  return Math.round(p.progNaKontrakt * Math.abs(contracts));
}

export function wynikTrade(
  t: { pnl: number; riskAmount: number | null; contracts: number },
  p: Progi,
): Wynik {
  const prog = progBE(t.riskAmount, t.contracts, p);
  if (t.pnl > prog) return "zysk";
  if (t.pnl < -prog) return "strata";
  return "be";
}

export type KolumnyWyniku = {
  pnl: SQLWrapper;
  riskAmount: SQLWrapper;
  contracts: SQLWrapper;
};

/** Odpowiednik `progBE` jako fragment SQL - ten sam wzor, te same zaokraglenia. */
export function sqlProgBE(kolumny: KolumnyWyniku, p: Progi): SQL {
  return sql`round(
    case
      when ${kolumny.riskAmount} is not null and ${kolumny.riskAmount} > 0
        then (${p.progRMille}::numeric * ${kolumny.riskAmount}::numeric) / 1000
      else ${p.progNaKontrakt}::numeric * abs(${kolumny.contracts}::numeric)
    end
  )`;
}

/** Odpowiednik `wynikTrade` jako warunek SQL dla jednego wybranego wyniku. */
export function sqlWynik(kolumny: KolumnyWyniku, p: Progi, w: Wynik): SQL {
  const prog = sqlProgBE(kolumny, p);
  if (w === "zysk") return sql`${kolumny.pnl} > (${prog})`;
  if (w === "strata") return sql`${kolumny.pnl} < -(${prog})`;
  return sql`${kolumny.pnl} <= (${prog}) and ${kolumny.pnl} >= -(${prog})`;
}
