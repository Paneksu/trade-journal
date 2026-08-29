import { StrategyForm } from "@/components/strategies/strategy-form";
import { EmptyState, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { getInstruments, getStrategies } from "@/lib/queries/dictionaries";

export const metadata = { title: "Strategie — Dziennik tradingowy" };

export default async function StrategiesPage() {
  await requireSession();

  const [strategies, instruments] = await Promise.all([getStrategies(), getInstruments()]);

  return (
    <div className="space-y-4">
      <header>
        <p className="etykieta">Warsztat</p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">Strategie</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Strategia to nazwa plus checklista wejścia. Od 2026-08-29 opisuje SESJĘ BACKTESTU,
          nie pojedynczy trade — w dzienniku typ zagrania nazywa tag „Styl wejścia”.
        </p>
      </header>

      {/* Panel "Porównanie strategii" zniknal 2026-08-29. Trade'y nie dostaja
          juz przypisania strategii, wiec rozbicie zsuwaloby cala historie do
          jednej grupy i udawalo, ze cos porownuje. */}

      <Panel title="Nowa strategia">
        <StrategyForm instruments={instruments} compact />
      </Panel>

      {strategies.length === 0 ? (
        <Panel>
          <EmptyState
            title="Brak strategii"
            description="Strategie opisują sesje backtestu — bez nich sesja nie ma czego porównać z realnym handlem."
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {strategies.map((s) => (
            <Panel
              key={s.id}
              title={s.name}
              description={
                s.active
                  ? `${s.rules.length} ${s.rules.length === 1 ? "zasada" : "zasad"} w checkliście`
                  : "nieaktywna"
              }
            >
              <StrategyForm
                instruments={instruments}
                values={{
                  id: s.id,
                  name: s.name,
                  description: s.description,
                  rules: s.rules,
                  instrumentId: s.instrumentId,
                  active: s.active,
                  color: s.color,
                }}
              />
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
