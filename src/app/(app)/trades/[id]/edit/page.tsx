import Link from "next/link";
import { PustyStan, Strona } from "@/components/ui/v2";
import { czyWynikUkryty } from "@/lib/api-v2/ukrycie-wyniku";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

import { stawkiDlaFormularza } from "@/lib/queries/broker";
import { TradeForm } from "@/components/trades/trade-form";
import { requireSession } from "@/lib/auth/guard";
import { toLocalInput } from "@/lib/domain/calc";
import { fieldsForScope } from "@/lib/fields/fields";
import {
  getAccounts,
  getBacktestSessions,
  getFields,
  getInstruments,
  getProgi,
  getTagCategories,
  getTags,
} from "@/lib/queries/dictionaries";
import { getScreenshots, getTrade } from "@/lib/queries/trades";

export const metadata = { title: "Edycja trade'a — Dziennik tradingowy" };

export default async function EditTradePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId)) notFound();

  const trade = await getTrade(tradeId);
  if (!trade) notFound();

  // Ślepa ocena (blokery review 16.10.2026): formularz edycji zawiera wyjścia i wynik, więc przy otwartym trade'ie
  // z werdyktem AI nie renderujemy go wcale (ani w HTML, ani w RSC).
  if (await czyWynikUkryty(db, tradeId)) {
    return (
      <Strona className="space-y-6">
        <h1 className="text-tytul font-medium tracking-tight text-text">Edycja zablokowana</h1>
        <PustyStan tytul="Edycja jest zablokowana, dopóki trade z werdyktem AI jest otwarty: formularz pokazałby wynik i wyjścia. Wyjście dopisze łącznik (TradingView, FX Replay); po zamknięciu edycja wróci." akcja={{ href: `/trades/${tradeId}`, etykieta: "Wróć do trade'a" }} />
      </Strona>
    );
  }

  const [accounts, instruments, sessions, tags, categories, fields, shots, progi] =
    await Promise.all([
      getAccounts(),
      getInstruments(),
      getBacktestSessions(),
      getTags(),
      getTagCategories(),
      getFields(),
      getScreenshots(tradeId),
      getProgi(),
    ]);

  return (
    <Strona className="styl-v2 space-y-4">
      <header>
        <p className="etykieta">
          <Link href={`/trades/${trade.id}`} className="hover:text-text">
            Trade #{trade.id}
          </Link>{" "}
          / edycja
        </p>
        <h1 className="text-tytul font-medium tracking-tight text-text">
          Edytuj trade na {trade.instrumentSymbol}
        </h1>
      </header>

      <TradeForm
        stawki={await stawkiDlaFormularza()}
        accounts={accounts}
        instruments={instruments}
        sessions={sessions}
        tags={tags}
        tagCategories={categories}
        fields={fieldsForScope(fields, trade.backtestSessionId !== null)}
        backtestSessionId={trade.backtestSessionId}
        progi={progi}
        values={{
          id: trade.id,
          accountId: trade.accountId,
          instrumentId: trade.instrumentId,
          backtestSessionId: trade.backtestSessionId,
          direction: trade.direction,
          status: trade.status,
          /* Strefa gieldy instrumentu (ADR-022): w niej trade zostal wpisany
             i w niej ma wrocic do edycji - inaczej samo otwarcie formularza
             i zapis przesunelyby godzine o roznice stref. */
          entryTime: toLocalInput(trade.entryTime, trade.exchangeTimezone),
          entryPrice: trade.entryPrice ? String(Number(trade.entryPrice)) : "",
          contracts: String(Number(trade.contracts)),
          stopLoss: trade.stopLoss ? String(Number(trade.stopLoss)) : "",
          takeProfit: trade.takeProfit ? String(Number(trade.takeProfit)) : "",
          // Centy z bazy z powrotem na kwote, jaka uzytkownik wpisal (ADR-016).
          brokerAmount: trade.brokerAmount === null ? "" : String(trade.brokerAmount / 100),
          mae: trade.mae ? String(Number(trade.mae)) : "",
          mfe: trade.mfe ? String(Number(trade.mfe)) : "",
          note: trade.note ?? "",
          moodNote: trade.moodNote,
          readiness: trade.readiness,
          directionCorrect: trade.directionCorrect,
          badExecutionReason: trade.badExecutionReason,
          potentialR: trade.potentialR === null ? "" : String(trade.potentialR),
          tags: trade.tags.map((t) => ({ id: t.id, interval: t.interval })),
          custom: trade.custom,
          shots,
          /* Kawalki wyjscia (ETAP 4b) - ten sam wzorzec co entryTime/exitTime
             wyzej: strefa gieldy instrumentu (ADR-022), nie strefa uzytkownika,
             i centy z powrotem na kwote w walucie konta (ADR-016). */
          exits: trade.exits.map((e) => ({
            time: toLocalInput(e.exitTime, trade.exchangeTimezone),
            price: String(e.exitPrice),
            contracts: String(e.contracts),
            brokerAmount: e.brokerAmount === null ? "" : String(e.brokerAmount / 100),
            note: e.note ?? "",
          })),
        }}
      />
    </Strona>
  );
}
