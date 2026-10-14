import Link from "next/link";

import { PolaczUrzadzenie } from "@/components/settings/devices";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";

export const metadata = { title: "Połącz urządzenie — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

export default async function PolaczUrzadzeniePage() {
  await requireSession();

  return (
    <div className="space-y-4">
      <header>
        <p className="etykieta">Urządzenia</p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">Połącz urządzenie</h1>
      </header>
      <Panel
        title="Logowanie kodem urządzenia"
        description="W terminalu uruchom `tj login`, a potem przepisz tu pokazany kod. Zobaczysz, kto prosi o dostęp i do czego."
        actions={
          <Link href="/settings/devices" className="text-xs text-accent underline">
            Lista urządzeń
          </Link>
        }
      >
        <PolaczUrzadzenie />
      </Panel>
    </div>
  );
}
