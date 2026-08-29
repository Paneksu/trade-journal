import Link from "next/link";
import { notFound } from "next/navigation";

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
  const settings = await requireSession();
  const { id } = await params;
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId)) notFound();

  const trade = await getTrade(tradeId);
  if (!trade) notFound();

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
    <div className="space-y-4">
      <header>
        <p className="etykieta">
          <Link href={`/trades/${trade.id}`} className="hover:text-text">
            Trade #{trade.id}
          </Link>{" "}
          / edycja
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
          Edytuj trade na {trade.instrumentSymbol}
        </h1>
      </header>

      <TradeForm
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
          entryTime: toLocalInput(trade.entryTime, settings.timezone),
          entryPrice: trade.entryPrice ? String(Number(trade.entryPrice)) : "",
          exitTime: toLocalInput(trade.exitTime, settings.timezone),
          exitPrice: trade.exitPrice ? String(Number(trade.exitPrice)) : "",
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
        }}
      />
    </div>
  );
}
