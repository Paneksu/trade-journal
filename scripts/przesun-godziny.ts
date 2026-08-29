import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { marketHour, marketSession, timeParts, tradingDay } from "../src/lib/domain/calc";
import * as schema from "../src/lib/db/schema";

/*
 * Jednorazowa naprawa historii po ADR-022 (2026-08-30).
 *
 * Do 29.08.2026 formularz czytal godziny trade'a w strefie z USTAWIEN
 * (domyslnie Europe/Warsaw). Kto przepisywal je z wykresu nowojorskiego, ten
 * ma w bazie momenty przesuniete o roznice stref: 09:35 z otwarcia sesji lezy
 * zapisane jako 09:35 w Warszawie, czyli 03:35 w Nowym Jorku - stad zle
 * "market_session", a przy wieczornych godzinach takze zly "trading_day".
 *
 * Skrypt bierze zapisany moment, odczytuje z niego SCIANKE ZEGARA w strefie
 * zrodlowej i zapisuje ta sama scianke jako czas gieldy instrumentu. Godzina
 * na ekranie zostaje wiec ta, ktora uzytkownik wpisal - zmienia sie tylko to,
 * co ona znaczy. Kolumny pochodne (sesja, dzien handlowy, dzien tygodnia,
 * godzina wejscia) sa przeliczane tym samym kodem, co przy zapisie z
 * formularza. `duration_s` sie nie zmienia: oba konce jada o tyle samo.
 *
 * URUCHOMIENIE (domyslnie SUCHY BIEG - nic nie zapisuje):
 *   npx tsx scripts/przesun-godziny.ts
 *   npx tsx scripts/przesun-godziny.ts --z=Europe/Warsaw --do=2026-08-29
 *   npx tsx scripts/przesun-godziny.ts --zapisz          <- dopiero to pisze
 *
 * ZANIM ODPALISZ Z `--zapisz`: zrob kopie bazy. Przesuniecie w zla strone jest
 * odwracalne tylko przez ponowne uruchomienie z odwrotna strefa - o ile
 * pamietasz, ktore trade'y juz przeszly.
 */

type Args = { zrodlo: string; doDnia: string | null; zapisz: boolean };

function argumenty(): Args {
  const a = process.argv.slice(2);
  const wartosc = (nazwa: string): string | null => {
    const w = a.find((x) => x.startsWith(`--${nazwa}=`));
    return w ? w.slice(nazwa.length + 3) : null;
  };
  return {
    zrodlo: wartosc("z") ?? "Europe/Warsaw",
    doDnia: wartosc("do"),
    zapisz: a.includes("--zapisz"),
  };
}

/** Ta sama scianka zegara, przeczytana w innej strefie. */
function przesun(moment: Date, zrodlo: string, cel: string): Date {
  const c = timeParts(moment, zrodlo);
  const scianka = `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}T${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
  // Dwa przyblizenia, tak samo jak `fromLocalInput` - jedno nie wystarcza na
  // granicy zmiany czasu, gdzie przesuniecie strefy zalezy od wyniku.
  const zgadywany = Date.parse(`${scianka}:00Z`);
  const offset = (m: number): number => {
    const p = timeParts(new Date(m), cel);
    // `timeParts` nie niesie sekund - scianka zegara ma rozdzielczosc minuty,
    // a formularz i tak zapisuje rowne minuty.
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - m + (m % 60_000);
  };
  const pierwsze = zgadywany - offset(zgadywany);
  return new Date(zgadywany - offset(pierwsze));
}

async function main() {
  const { zrodlo, doDnia, zapisz } = argumenty();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Brak DATABASE_URL");

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema, casing: "snake_case" });

  const wiersze = await db
    .select({
      id: schema.trades.id,
      entryTime: schema.trades.entryTime,
      exitTime: schema.trades.exitTime,
      symbol: schema.instruments.symbol,
      strefa: schema.instruments.exchangeTimezone,
      rthFrom: schema.instruments.rthFrom,
      rthTo: schema.instruments.rthTo,
      tickSize: schema.instruments.tickSize,
      tickValue: schema.instruments.tickValue,
    })
    .from(schema.trades)
    .innerJoin(schema.instruments, eq(schema.trades.instrumentId, schema.instruments.id));

  console.log(`Adres bazy: ${url.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`Strefa źródłowa: ${zrodlo} → strefa giełdy instrumentu`);
  console.log(doDnia ? `Tylko wejścia do ${doDnia} włącznie` : "Wszystkie trade'y");
  console.log(zapisz ? "TRYB ZAPISU\n" : "SUCHY BIEG — nic nie zostanie zapisane\n");

  let zmienione = 0;
  for (const w of wiersze) {
    if (doDnia && w.entryTime.toISOString().slice(0, 10) > doDnia) continue;
    if (w.strefa === zrodlo) continue;

    const noweWejscie = przesun(w.entryTime, zrodlo, w.strefa);
    if (noweWejscie.getTime() === w.entryTime.getTime()) continue;
    const noweWyjscie = w.exitTime ? przesun(w.exitTime, zrodlo, w.strefa) : null;

    const spec = {
      tickSize: Number(w.tickSize),
      tickValue: Number(w.tickValue),
      rthFrom: w.rthFrom,
      rthTo: w.rthTo,
      exchangeTimezone: w.strefa,
    };
    const dzien = tradingDay(noweWejscie, w.strefa);
    const sesja = marketSession(noweWejscie, spec);
    const { weekday } = timeParts(noweWejscie, w.strefa);

    zmienione += 1;
    if (zmienione <= 10) {
      console.log(
        `#${w.id} ${w.symbol}: ${w.entryTime.toISOString()} → ${noweWejscie.toISOString()} (${sesja}, dzień ${dzien})`,
      );
    }

    if (!zapisz) continue;
    await db
      .update(schema.trades)
      .set({
        entryTime: noweWejscie,
        exitTime: noweWyjscie,
        tradingDay: dzien,
        marketSession: sesja,
        weekday,
        entryHour: marketHour(noweWejscie, w.strefa),
        updatedAt: new Date(),
      })
      .where(eq(schema.trades.id, w.id));
  }

  if (zmienione > 10) console.log(`… i ${zmienione - 10} dalszych`);
  console.log(`\n${zmienione} z ${wiersze.length} trade'ów ${zapisz ? "przesunięto" : "do przesunięcia"}.`);
  if (!zapisz && zmienione > 0) {
    console.log("Zrób kopię bazy, potem uruchom ponownie z --zapisz.");
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
