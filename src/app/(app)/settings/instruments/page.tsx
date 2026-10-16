import { InstrumentForm, NewInstrument } from "@/components/settings/forms";
import { KlasaInstrumentu } from "@/components/polaczenia/wynik-netto";
import { Panel } from "@/components/ui/base";
import { instrumentyZKlasa } from "@/lib/queries/broker";
import { requireSession } from "@/lib/auth/guard";
import { getInstruments } from "@/lib/queries/dictionaries";
import { money, price } from "@/lib/format";

export const metadata = { title: "Instrumenty — Dziennik tradingowy" };

export default async function InstrumentsSettingsPage() {
  await requireSession();
  const [instruments, klasy] = await Promise.all([getInstruments(), instrumentyZKlasa()]);

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
          description={`tick ${price(i.tickSize, i.tickSize)} = ${money(Math.round(i.tickValue / 10), { currency: i.currency })} · sesja ${i.rthFrom}–${i.rthTo} ${i.exchangeTimezone}${i.active ? "" : " · nieaktywny"}`}
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
              rthFrom: i.rthFrom,
              rthTo: i.rthTo,
              exchangeTimezone: i.exchangeTimezone,
              active: i.active,
              sortOrder: i.sortOrder,
            }}
          />
          {klasy.find((k) => k.id === i.id) && (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-1 text-sm font-semibold text-text">Klasa kontraktu</p>
              <p className="mb-2 text-xs text-faint">Mini albo micro: od niej zależy, którą stawkę opłat dostanie trade. Bez klasy wynik zostaje brutto.</p>
              <KlasaInstrumentu instrument={klasy.find((k) => k.id === i.id)!} />
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}
