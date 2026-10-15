import "server-only";

import { db } from "@/lib/db";
import { odczytajDzien } from "@/lib/api-v2/dni";
import { dzienHandlowyTeraz, przegladProp } from "@/lib/api-v2/prop-konta";
import { listaRegul } from "@/lib/api-v2/reguly";
import { ukryteTrady } from "@/lib/api-v2/ukrycie-wyniku";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { closedOnly, getTrades, type TradeRecord } from "@/lib/queries/trades";

import { propozycjeRegul, propozycjeSetupow, regulyKontDoPotwierdzenia, sugestieDoDecyzji } from "./decyzje";

/**
 * Dane ekranu „Dziś” (UI v2, wzór 1: pulpit Mercury). Tylko odczyt przez istniejące moduły
 * (api-v2 i queries): rytuał dnia = `odczytajDzien` (ten sam zakres co `GET /days/:date` bez konta,
 * czyli tam, gdzie pisze AI w rytuale), bufory prop = `przegladProp`, reguły = `listaRegul`.
 * Ślepa ocena obowiązuje i tu: trade z werdyktem i bez zamknięcia nie pokazuje wyniku.
 */

export type DzienWykresu = { dzien: string; r: number; suma: number };

function dniWstecz(dzien: string, ile: number): string {
  const d = new Date(`${dzien}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ile);
  return d.toISOString().slice(0, 10);
}

/** Skumulowane R dzień po dniu (tylko zamknięte trade'y dziennika, bez backtestu). */
function krzywaR(trades: TradeRecord[]): DzienWykresu[] {
  const poDniu = new Map<string, number>();
  for (const t of closedOnly(trades)) {
    if (t.rMultiple === null || !t.tradingDay) continue;
    poDniu.set(t.tradingDay, (poDniu.get(t.tradingDay) ?? 0) + t.rMultiple);
  }
  let suma = 0;
  return [...poDniu.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dzien, r]) => {
      suma += r;
      return { dzien, r, suma };
    });
}

export async function daneDzis() {
  const dzis = dzienHandlowyTeraz();
  const od30 = dniWstecz(dzis, 30);

  const [dzien, prop, reguly, ostatnie, rp, sp, sug, kp] = await Promise.all([
    odczytajDzien(dzis, {}),
    przegladProp(db, dzis),
    listaRegul(db, "active"),
    getTrades({ ...EMPTY_FILTERS, from: od30, to: dzis }),
    propozycjeRegul(),
    propozycjeSetupow(),
    sugestieDoDecyzji(),
    regulyKontDoPotwierdzenia(dzis),
  ]);

  const tradeyDnia = ostatnie.filter((t) => t.tradingDay === dzis).sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime());
  const ukryte = await ukryteTrady(db, tradeyDnia.map((t) => t.id));

  const krzywa = krzywaR(ostatnie);
  const zamknieteDnia = closedOnly(tradeyDnia).filter((t) => !ukryte.has(t.id));
  const rDnia = zamknieteDnia.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
  const pnlDnia = zamknieteDnia.reduce((s, t) => s + (t.pnl ?? 0), 0);

  const niewazny = dzien.userWords
    .filter((w) => w.role === "day.invalidation")
    .sort((a, b) => a.id - b.id)
    .at(-1) ?? null;

  return {
    dzis,
    dzien,
    uniewaznienie: niewazny,
    prop,
    reguly: reguly.rules.filter((r) => r.current !== null),
    rulesVersion: reguly.rulesVersion,
    tradeyDnia,
    ukryte,
    rDnia,
    pnlDnia,
    zamknieteDnia: zamknieteDnia.length,
    krzywa,
    sumaR30: krzywa.at(-1)?.suma ?? 0,
    zyskR30: krzywa.filter((d) => d.r > 0).reduce((s, d) => s + d.r, 0),
    stratyR30: krzywa.filter((d) => d.r < 0).reduce((s, d) => s + d.r, 0),
    od30,
    doDecyzji: {
      reguly: rp.length,
      setupy: sp.length,
      sugestie: sug.oczekujace.length,
      prop: kp.length,
    },
  };
}

export type DaneDzis = Awaited<ReturnType<typeof daneDzis>>;
