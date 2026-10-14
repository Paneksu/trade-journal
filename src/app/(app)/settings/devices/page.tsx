import Link from "next/link";

import { UniewaznPrzycisk } from "@/components/settings/devices";
import { Badge, EmptyState, Panel } from "@/components/ui/base";
import { listaTokenow, oczekujaceKody, DNI_NIEAKTYWNOSCI } from "@/lib/api-v2/urzadzenia";
import { requireSession } from "@/lib/auth/guard";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Urządzenia — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

const STATUSY = { aktywny: "aktywny", uniewazniony: "unieważniony", wygasly: "wygasł" } as const;

export default async function DevicesSettingsPage() {
  await requireSession();
  const [tokeny, oczekujace] = await Promise.all([listaTokenow(), oczekujaceKody()]);

  return (
    <div className="space-y-4">
      <Panel
        title="Urządzenia z dostępem do API"
        description="Każde urządzenie (łącznik tj, asystent AI) ma własny token z zakresami. Unieważnienie działa od razu, bez restartu."
        actions={
          <Link
            href="/urzadzenia/polacz"
            className="rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-3 py-1.5 text-xs text-text hover:border-faint"
          >
            Połącz urządzenie
          </Link>
        }
      >
        {oczekujace.length > 0 && (
          <p className="border-b border-line px-4 py-2 text-xs text-muted">
            Czeka na decyzję: {oczekujace.map((k) => `${k.clientName} (${k.userCode})`).join(", ")}.{" "}
            <Link href="/urzadzenia/polacz" className="text-accent underline">
              Przepisz kod, żeby zatwierdzić
            </Link>
            .
          </p>
        )}
        {tokeny.length === 0 ? (
          <EmptyState title="Brak urządzeń" description="Uruchom `tj login` w terminalu, a potem przepisz kod tutaj." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-faint">
                  <th className="px-4 py-2 font-medium">Urządzenie</th>
                  <th className="px-4 py-2 font-medium">Zakresy</th>
                  <th className="px-4 py-2 font-medium">Ostatnie użycie</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {tokeny.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <div className="text-text">{t.name}</div>
                      <div className="font-mono text-xs text-faint">
                        tj_{t.prefix}_… · utworzony {dateTime(t.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {t.scopes.map((s) => (
                          <Badge key={s}>{s}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {t.lastUsedAt ? (
                        <>
                          {dateTime(t.lastUsedAt)}
                          {t.lastUsedIp && <div className="text-xs text-faint">{t.lastUsedIp}</div>}
                        </>
                      ) : (
                        "nigdy"
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge className={t.status === "aktywny" ? "text-profit" : "text-loss"}>{STATUSY[t.status]}</Badge>
                      {t.nieuzywany && (
                        <div className="mt-1 text-xs text-faint">
                          nieużywany od {DNI_NIEAKTYWNOSCI} dni, rozważ unieważnienie
                        </div>
                      )}
                      {t.revokedAt && <div className="mt-1 text-xs text-faint">{dateTime(t.revokedAt)}</div>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {t.status === "aktywny" && <UniewaznPrzycisk id={t.id} nazwa={t.name} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
