import { GroupBars } from "@/components/charts/lazy";
import { StrategyForm } from "@/components/strategies/strategy-form";
import { GroupTable } from "@/components/stats/group-table";
import { EmptyState, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { dimension, groupBy } from "@/lib/domain/grouping";
import { getAccounts, getInstruments, getProgi, getStrategies } from "@/lib/queries/dictionaries";
import { EMPTY_FILTERS } from "@/lib/queries/filters";
import { closedOnly, getTrades } from "@/lib/queries/trades";

export const metadata = { title: "Strategie — Dziennik tradingowy" };

export default async function StrategiesPage() {
  const settings = await requireSession();

  const [strategies, instruments, accounts, trades] = await Promise.all([
    getStrategies(),
    getInstruments(),
    getAccounts(),
    getTrades({ ...EMPTY_FILTERS, source: "all" }),
  ]);

  const currency = accounts[0]?.currency ?? settings.baseCurrency;
  const closed = closedOnly(trades);
  const progi = await getProgi();
  const groups = groupBy(closed, dimension("strategy"), { progi });

  return (
    <div className="space-y-4">
      <header>
        <p className="etykieta">Warsztat</p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">Strategie</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Strategia to nazwa plus checklista wejścia. Checklista wraca przy każdym trade&apos;zie,
          a to, ile jej punktów odhaczasz, wchodzi do miernika dyscypliny.
        </p>
      </header>

      {groups.length > 0 && (
        <Panel title="Porównanie strategii" description="Liczone z dziennika i backtestów razem.">
          <div className="px-2 py-3">
            <GroupBars
              data={groups.map((g) => ({
                label: g.label,
                value: g.stats.pnl,
                count: g.stats.count,
              }))}
              currency={currency}
              unit="cash"
            />
          </div>
          <div className="border-t border-line">
            <GroupTable groups={groups} currency={currency} minSample={settings.minSample} />
          </div>
        </Panel>
      )}

      <Panel title="Nowa strategia">
        <StrategyForm instruments={instruments} compact />
      </Panel>

      {strategies.length === 0 ? (
        <Panel>
          <EmptyState
            title="Brak strategii"
            description="Bez strategii dziennik nadal działa, ale tracisz checklistę i rozbicie wyników na zagrania."
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
