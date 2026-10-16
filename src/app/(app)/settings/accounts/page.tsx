import { AccountForm, NewAccount } from "@/components/settings/forms";
import { StawkiKonta } from "@/components/polaczenia/wynik-netto";
import { Panel } from "@/components/ui/base";
import { kontaZeStawkami } from "@/lib/queries/broker";
import { requireSession } from "@/lib/auth/guard";
import { getAccounts } from "@/lib/queries/dictionaries";
import { FAZA_PROP_NAZWY } from "@/lib/domain/kategorie";
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
  const [accounts, stawki] = await Promise.all([getAccounts(), kontaZeStawkami()]);

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
          description={`${TYPE_LABELS[a.type]}${a.type === "prop" ? ` (${a.propPhase ? FAZA_PROP_NAZWY[a.propPhase] : "faza nieznana"})` : ""} · ${a.currency} · start ${money(a.startingBalance, { currency: a.currency })}${a.archived ? " · zarchiwizowane" : ""}`}
        >
          <AccountForm
            values={{
              id: a.id,
              name: a.name,
              currency: a.currency,
              startingBalance: a.startingBalance,
              type: a.type,
              propPhase: a.propPhase,
              defaultRiskAmount: a.defaultRiskAmount,
              description: a.description,
              archived: a.archived,
              sortOrder: a.sortOrder,
            }}
          />
          {a.type === "prop" ? (
            <p className="border-t border-line px-4 py-3 text-xs text-muted">Stawka opłat tego konta prop pochodzi z reguł: ustawisz ją przy przypięciu presetu na ekranie konta w Prop.</p>
          ) : (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-sm font-semibold text-text">Stawki opłat</p>
              <p className="mb-3 text-xs text-faint">Opłata za kontrakt w obie strony (prowizja, giełda, NFA). Puste pole znaczy „brak stawki”, a wynik zostaje brutto z flagą.</p>
              {stawki.find((s) => s.id === a.id) && <StawkiKonta konto={stawki.find((s) => s.id === a.id)!} />}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}
