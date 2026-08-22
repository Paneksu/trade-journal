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
  getStrategies,
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

  const [accounts, instruments, strategies, sessions, tags, fields, shots] = await Promise.all([
    getAccounts(),
    getInstruments(),
    getStrategies(),
    getBacktestSessions(),
    getTags(),
    getFields(),
    getScreenshots(tradeId),
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
        strategies={strategies}
        sessions={sessions}
        tags={tags}
        fields={fieldsForScope(fields, trade.backtestSessionId !== null)}
        backtestSessionId={trade.backtestSessionId}
        values={{
          id: trade.id,
          accountId: trade.accountId,
          instrumentId: trade.instrumentId,
          strategyId: trade.strategyId,
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
          mae: trade.mae ? String(Number(trade.mae)) : "",
          mfe: trade.mfe ? String(Number(trade.mfe)) : "",
          commission: String(trade.commission / 100),
          note: trade.note ?? "",
          executionRating: trade.executionRating,
          rulesMet: trade.rulesMetIds,
          tags: trade.tags.map((t) => t.id),
          custom: trade.custom,
          shots,
        }}
      />
    </div>
  );
}
