import { AccountForm, NewAccount } from "@/components/settings/forms";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { getAccounts } from "@/lib/queries/dictionaries";
import { money } from "@/lib/format";

export const metadata = { title: "Konta — Dziennik tradingowy" };

const TYPE_LABELS: Record<string, string> = {
  live: "realne",
  demo: "demo",
  prop: "prop firm",
  paper: "papierowe",
};

export default async function AccountsSettingsPage() {
  await requireSession();
  const accounts = await getAccounts();

  return (
    <div className="space-y-4">
      <Panel
        title="Konta"
        description="Każdy trade należy do konta. Saldo startowe jest punktem zerowym krzywej kapitału."
      >
        <NewAccount />
      </Panel>

      {accounts.map((a) => (
        <Panel
          key={a.id}
          title={a.name}
          description={`${TYPE_LABELS[a.type]} · ${a.currency} · start ${money(a.startingBalance, { currency: a.currency })}${a.archived ? " · zarchiwizowane" : ""}`}
        >
          <AccountForm
            values={{
              id: a.id,
              name: a.name,
              currency: a.currency,
              startingBalance: a.startingBalance,
              type: a.type,
              defaultRiskAmount: a.defaultRiskAmount,
              description: a.description,
              archived: a.archived,
              sortOrder: a.sortOrder,
            }}
          />
        </Panel>
      ))}
    </div>
  );
}
