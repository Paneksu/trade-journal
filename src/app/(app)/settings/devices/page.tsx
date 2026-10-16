import Link from "next/link";

import { OdrzucOczekujacePrzycisk, TokenBrokeraPrzycisk, TokenImportuPrzycisk, UniewaznPrzycisk } from "@/components/settings/devices";
import { Badge, EmptyState, Panel } from "@/components/ui/base";
import { listaTokenow, oczekujaceKody, DNI_NIEAKTYWNOSCI } from "@/lib/api-v2/urzadzenia";
import { requireSession } from "@/lib/auth/guard";
import { stanAutomatu } from "@/lib/queries/broker";
import { stanSudo } from "@/lib/auth/zadanie";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Urządzenia — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

const STATUSY = { aktywny: "aktywny", uniewazniony: "unieważniony", wygasly: "wygasł" } as const;

export default async function DevicesSettingsPage() {
  const sesja = await requireSession();
  const sudo = await stanSudo(sesja);
  const potwierdzenie = sudo.stan === "aktywny" ? "aktywne" : sudo.stan === "wymagany" ? "sudo" : "haslo";
  const [tokeny, oczekujace, automat] = await Promise.all([listaTokenow(), oczekujaceKody(), stanAutomatu()]);

  return (
    <div className="space-y-4">
      <div id="automat-eksportow" className="scroll-mt-20">
        <Panel
          title="Automat eksportów z rachunku"
          description="Po kliknięciu Eksport w platformie automat sam wyśle plik z folderu Pobrane do dziennika."
        >
          <div className="space-y-3 px-4 py-3">
            <p className="text-sm text-muted">
              Token służy tylko do wysyłania plików z folderu Pobrane. Niczego więcej nie otworzy: nie czyta trade&apos;ów, notatek ani ustawień. Jest ważny 90 dni i osobny od tokenu, którym pracuje AI.
            </p>
            {!automat.skonfigurowane && (
              <p role="alert" className="text-sm text-loss">Serwer nie ma klucza importu z rachunku (BROKER_ID_HMAC_KEY), więc automat nie będzie mógł niczego przyjąć.</p>
            )}
            <TokenBrokeraPrzycisk potwierdzenie={potwierdzenie} />
            <div className="space-y-1 text-xs text-faint">
              <p>Instalacja automatu na komputerze: <code className="font-mono text-muted">tj watch-exports install</code> (raz; uruchamia się przy logowaniu do Windows).</p>
              <p>Logowanie tokenem: <code className="font-mono text-muted">tj watch-exports login</code>.</p>
            </div>
          </div>
          {automat.tokeny.length === 0 ? (
            <p className="border-t border-line px-4 py-3 text-sm text-muted" data-testid="token-brokera-brak">Nie wydano jeszcze żadnego tokenu automatu.</p>
          ) : (
            <ul className="border-t border-line" data-testid="token-brokera-lista">
              {automat.tokeny.map((t) => {
                const aktywny = !t.revoked && !t.expired;
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0">
                    <div className="min-w-0 text-sm">
                      <p className="text-text">{t.name}</p>
                      <p className="font-mono text-xs text-faint">tj_{t.prefix}_… · wydany {dateTime(t.createdAt)}</p>
                      <p className="text-xs text-muted">
                        ważny do {t.expiresAt ? dateTime(t.expiresAt) : "bez terminu"} · ostatnie użycie {t.lastUsedAt ? dateTime(t.lastUsedAt) : "nigdy"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{t.revoked ? "unieważniony" : t.expired ? "wygasł" : "aktywny"}</Badge>
                      {aktywny && <UniewaznPrzycisk id={t.id} nazwa={t.name} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
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
        <div className="border-b border-line px-4 py-3">
          <TokenImportuPrzycisk potwierdzenie={potwierdzenie} />
          <p className="mt-1 text-xs text-faint">
            Token importu to jedyny sposób na zakres »import« (pochodzenie vault-import i mentor). Urządzenia go nie dostają.
          </p>
        </div>
        {oczekujace.length > 0 && (
          <p className="border-b border-line px-4 py-2 text-xs text-muted">
            Czeka na decyzję: {oczekujace.length} {oczekujace.length === 1 ? "żądanie" : "żądań"} (adresy:{" "}
            {oczekujace.map((k) => `${k.clientIp ?? "nieznany"}, ${dateTime(k.createdAt)}`).join("; ")}). Kodów tu nie pokazujemy:
            kod przepisujesz z terminala, który sam uruchomiłeś.{" "}
            <Link href="/urzadzenia/polacz" className="text-accent underline">
              Przepisz kod, żeby zatwierdzić
            </Link>
            .{" "}
            <OdrzucOczekujacePrzycisk />
          </p>
        )}
        {tokeny.length === 0 ? (
          <EmptyState title="Brak urządzeń" description="Uruchom `tj login` w terminalu, a potem przepisz kod tutaj." />
        ) : (
          <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2" tabIndex={0} role="region" aria-label="Tabela urządzeń (przewijana w bok)">
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
