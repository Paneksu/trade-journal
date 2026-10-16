import Link from "next/link";

import { Strona } from "@/components/ui/v2";
import { PolaczUrzadzenie } from "@/components/settings/devices";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";

export const metadata = { title: "Połącz urządzenie — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

export default async function PolaczUrzadzeniePage() {
  await requireSession();

  return (
    <Strona className="styl-v2 space-y-4">
      <header>
        <p className="etykieta">Urządzenia</p>
        <h1 className="text-tytul font-medium tracking-tight text-text">Połącz urządzenie</h1>
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
    </Strona>
  );
}
