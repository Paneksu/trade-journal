import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { computeTrade } from "../src/lib/domain/calc";
import * as schema from "../src/lib/db/schema";

/*
 * Dane demonstracyjne do pracy nad wygladem i do testow.
 * NIE uruchamiac na bazie produkcyjnej - skrypt dopisuje losowe trade'y.
 * Uruchomienie: npx tsx scripts/demo-data.ts [ile]
 */

function losowa(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function element<T>(lista: T[]): T {
  return lista[Math.floor(Math.random() * lista.length)];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Brak DATABASE_URL");
  if (url.includes("panekweb") || url.includes("coolify")) {
    throw new Error("To wyglada na baze produkcyjna. Skrypt sluzy tylko do pracy lokalnej.");
  }

  const ile = Number(process.argv[2] ?? 140);
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema, casing: "snake_case" });

  const [account] = await db.select().from(schema.accounts).limit(1);
  const instruments = await db.select().from(schema.instruments);
  const tags = await db.select().from(schema.tags);
  if (!account || instruments.length === 0) throw new Error("Najpierw uruchom `npm run seed`.");

  // Strategie z checklista
  const strategies = await db
    .insert(schema.strategies)
    .values([
      {
        name: "Wybicie otwarcia",
        description: "Wybicie zakresu pierwszych 15 minut sesji.",
        rules: [
          { id: "r1", text: "Zakres otwarcia szerszy niż 10 ticków" },
          { id: "r2", text: "Wybicie z wolumenem powyżej średniej" },
          { id: "r3", text: "Brak danych makro w ciągu 15 minut" },
        ],
        color: "#e8a44c",
      },
      {
        name: "Powrót do VWAP",
        description: "Wejście na dotknięciu VWAP w trendzie.",
        rules: [
          { id: "s1", text: "Trend zgodny z kierunkiem wejścia" },
          { id: "s2", text: "Pierwszy test VWAP w sesji" },
        ],
        color: "#5aa9e6",
      },
    ])
    .returning();

  const wybrane = instruments.filter((i) => ["NQ", "MNQ", "ES", "CL", "GC"].includes(i.symbol));
  const teraz = Date.now();
  const wstawione: number[] = [];

  for (let n = 0; n < ile; n += 1) {
    const instrument = element(wybrane);
    const strategy = Math.random() < 0.85 ? element(strategies) : null;
    const direction = Math.random() < 0.55 ? "long" : "short";
    const tickSize = Number(instrument.tickSize);

    const bazowa = instrument.symbol.includes("NQ")
      ? 20000
      : instrument.symbol === "ES"
        ? 5600
        : instrument.symbol === "CL"
          ? 74
          : 2400;

    const entryPrice = Math.round((bazowa * losowa(0.98, 1.02)) / tickSize) * tickSize;
    const riskTicks = Math.round(losowa(8, 40));
    const stopLoss =
      direction === "long" ? entryPrice - riskTicks * tickSize : entryPrice + riskTicks * tickSize;

    // Sesja glowna wypada lepiej niz nocna - zeby Edge Finder mial co znalezc.
    const dzien = new Date(teraz - Math.floor(losowa(0, 150)) * 86_400_000);
    const nocny = Math.random() < 0.3;
    dzien.setUTCHours(nocny ? Math.floor(losowa(1, 12)) : Math.floor(losowa(14, 20)));
    dzien.setUTCMinutes(Math.floor(losowa(0, 59)));

    const przewaga = nocny ? -0.35 : 0.25;
    const wygrana = Math.random() < 0.44 + przewaga * 0.25;
    const rWynik = wygrana ? losowa(0.6, 3.4) : -losowa(0.4, 1.15);

    const exitPrice =
      direction === "long"
        ? entryPrice + rWynik * riskTicks * tickSize
        : entryPrice - rWynik * riskTicks * tickSize;

    const contracts = Math.max(1, Math.round(losowa(1, 3)));
    const exitTime = new Date(dzien.getTime() + Math.floor(losowa(60, 5400)) * 1000);

    const spec = {
      tickSize,
      tickValue: Number(instrument.tickValue),
      rthFrom: instrument.rthFrom,
      rthTo: instrument.rthTo,
      exchangeTimezone: instrument.exchangeTimezone,
    };

    const mae = direction === "long"
      ? entryPrice - losowa(0.1, 0.9) * riskTicks * tickSize
      : entryPrice + losowa(0.1, 0.9) * riskTicks * tickSize;
    const mfe = direction === "long"
      ? entryPrice + Math.max(0.2, rWynik + losowa(0, 1)) * riskTicks * tickSize
      : entryPrice - Math.max(0.2, rWynik + losowa(0, 1)) * riskTicks * tickSize;

    const wynik = computeTrade({
      instrument: spec,
      direction,
      contracts,
      entryPrice,
      exitPrice,
      stopLoss: Math.random() < 0.94 ? stopLoss : null,
      takeProfit: null,
      mae,
      mfe,
      entryTime: dzien,
      exitTime,
    });

    const zasady = strategy?.rules ?? [];
    const spelnione = zasady.filter(() => Math.random() < 0.82).map((r) => r.id);

    const [nowy] = await db
      .insert(schema.trades)
      .values({
        accountId: account.id,
        instrumentId: instrument.id,
        strategyId: strategy?.id ?? null,
        direction,
        status: "closed",
        entryTime: dzien,
        entryPrice: String(entryPrice),
        exitTime,
        exitPrice: String(exitPrice),
        contracts: String(contracts),
        stopLoss: wynik.riskTicks ? String(stopLoss) : null,
        mae: String(mae),
        mfe: String(mfe),
        note: Math.random() < 0.4 ? "Wejście zgodne z planem, wyjście trochę za wcześnie." : null,
        /* Gotowosc zamiast dawnych pol wlasnych (2026-08-29). Strategie i
           checkliste dane demo nadal wypelniaja - stare trade'y w bazie tez je
           maja, wiec widok trade'a musi miec na czym pokazac, ze sobie z nimi
           radzi. */
        moodNote:
          Math.random() < 0.5
            ? element(["Wyspany, spokojna głowa.", "Krótka noc.", "Rozproszony, dużo spraw obok."])
            : null,
        readiness: Math.random() < 0.85 ? Math.ceil(losowa(1, 10)) : null,
        executionRating: Math.random() < 0.7 ? Math.ceil(losowa(1, 5)) : null,
        rulesMet: spelnione,
        custom: {},
        ticks: wynik.ticks,
        riskTicks: wynik.riskTicks,
        pnl: wynik.pnl,
        riskAmount: wynik.riskAmount,
        rMultiple: wynik.rMultiple === null ? null : wynik.rMultiple.toFixed(4),
        maeR: wynik.maeR === null ? null : wynik.maeR.toFixed(4),
        mfeR: wynik.mfeR === null ? null : wynik.mfeR.toFixed(4),
        durationS: wynik.durationS,
        marketSession: wynik.marketSession,
        weekday: wynik.weekday,
        entryHour: wynik.entryHour,
        tradingDay: wynik.tradingDay,
      })
      .returning({ id: schema.trades.id });

    wstawione.push(nowy.id);

    const wybraneTagi = tags.filter(() => Math.random() < 0.18).slice(0, 3);
    if (wybraneTagi.length > 0) {
      await db
        .insert(schema.tradeTags)
        .values(wybraneTagi.map((t) => ({ tradeId: nowy.id, tagId: t.id })))
        .onConflictDoNothing();
    }
  }

  // Dni swiadomie odpuszczone - inaczej nie widac ani kafla "bez transakcji",
  // ani pokrycia dziennika.
  const zajete = new Set(
    (await db.select({ day: schema.trades.tradingDay }).from(schema.trades))
      .map((r) => r.day)
      .filter((d): d is string => Boolean(d)),
  );

  const powody = ["no_setup", "market_conditions", "day_off", "planned_break", "personal"] as const;
  const pauzy: { day: string; noTradeReason: (typeof powody)[number] }[] = [];
  for (let i = 1; i <= 60 && pauzy.length < 12; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const dzienTygodnia = d.getUTCDay();
    if (dzienTygodnia === 0 || dzienTygodnia === 6) continue;
    if (zajete.has(day)) continue;
    if (Math.random() < 0.45) continue;
    pauzy.push({ day, noTradeReason: element([...powody]) });
  }

  if (pauzy.length > 0) {
    await db
      .insert(schema.dayNotes)
      .values(
        pauzy.map((p) => ({
          accountId: account.id,
          day: p.day,
          noTrade: true,
          noTradeReason: p.noTradeReason,
          postSession: "Warunek wejścia się nie pojawił, dzień odpuszczony świadomie.",
        })),
      )
      .onConflictDoNothing();
  }

  console.log(
    `Dodano ${wstawione.length} trade'ow demonstracyjnych i ${pauzy.length} dni bez transakcji.`,
  );
  await client.end();
}

main().catch((error) => {
  console.error("Dane demonstracyjne: blad", error);
  process.exit(1);
});
