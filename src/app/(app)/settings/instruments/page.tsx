import { InstrumentForm, NewInstrument } from "@/components/settings/forms";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { getInstruments } from "@/lib/queries/dictionaries";
import { money, price } from "@/lib/format";

export const metadata = { title: "Instrumenty — Dziennik tradingowy" };

export default async function InstrumentsSettingsPage() {
  await requireSession();
  const instruments = await getInstruments();

  return (
    <div className="space-y-4">
      <Panel
        title="Katalog instrumentów"
        description="Wielkość i wartość ticku decydują o każdym wyniku w dzienniku. Sprawdź je, zanim wpiszesz pierwszy trade na nowym kontrakcie."
      >
        <NewInstrument />
      </Panel>

      {instruments.map((i) => (
        <Panel
          key={i.id}
          title={
            <span className="font-mono">
              {i.symbol} <span className="font-sans font-normal text-muted">— {i.name}</span>
            </span>
          }
          description={`tick ${price(i.tickSize, i.tickSize)} = ${money(Math.round(i.tickValue / 10), { currency: i.currency })} · prowizja ${money(i.commissionPerContract, { currency: i.currency })} za kontrakt · sesja ${i.rthFrom}–${i.rthTo} ${i.exchangeTimezone}${i.active ? "" : " · nieaktywny"}`}
        >
          <InstrumentForm
            values={{
              id: i.id,
              symbol: i.symbol,
              name: i.name,
              exchange: i.exchange,
              tickSize: i.tickSize,
              tickValue: i.tickValue,
              currency: i.currency,
              commissionPerContract: i.commissionPerContract,
              rthFrom: i.rthFrom,
              rthTo: i.rthTo,
              exchangeTimezone: i.exchangeTimezone,
              active: i.active,
              sortOrder: i.sortOrder,
            }}
          />
        </Panel>
      ))}
    </div>
  );
}
