import { ExportButton } from "@/components/settings/export-button";
import { DataPoint, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { counts } from "@/lib/actions/data";
import { int } from "@/lib/format";

export const metadata = { title: "Dane i kopia — Dziennik tradingowy" };

export default async function DataSettingsPage() {
  await requireSession();
  const c = await counts();

  return (
    <div className="space-y-4">
      <Panel title="Co siedzi w bazie">
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <DataPoint label="Trade'y">{int(c.trades)}</DataPoint>
          <DataPoint label="Konta">{int(c.accounts)}</DataPoint>
          <DataPoint label="Instrumenty">{int(c.instruments)}</DataPoint>
          <DataPoint label="Strategie">{int(c.strategies)}</DataPoint>
          <DataPoint label="Tagi">{int(c.tags)}</DataPoint>
          <DataPoint label="Pola własne">{int(c.fields)}</DataPoint>
          <DataPoint label="Notatki dnia">{int(c.notes)}</DataPoint>
        </div>
      </Panel>

      <Panel
        title="Kopia zapasowa"
        description="Plik JSON zawiera wszystkie tabele oprócz samych obrazów. Zrzuty ekranu leżą na wolumenie serwera i trzeba je kopiować osobno."
      >
        <div className="p-4">
          <ExportButton />
        </div>
      </Panel>

      <Panel title="Kopia bazy po stronie serwera">
        <div className="space-y-3 p-4 text-sm text-muted">
          <p>
            Pełna kopia bazy to jedno polecenie na serwerze. Warto puścić je przed każdym
            wdrożeniem, które zmienia strukturę danych:
          </p>
          <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-3 py-2 text-xs text-text">
            <code>docker exec &lt;kontener-bazy&gt; pg_dump -U journal journal &gt; kopia.sql</code>
          </pre>
          <p>
            W Coolify zasób PostgreSQL ma własne kopie zapasowe w zakładce Backups — wystarczy
            ustawić harmonogram i miejsce docelowe.
          </p>
          <p>Katalog ze zrzutami ekranu jest podpięty jako wolumen i przeżywa restart kontenera.</p>
        </div>
      </Panel>
    </div>
  );
}
