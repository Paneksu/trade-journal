import Link from "next/link";

import { DecyzjaReguly, DecyzjaSetupu, DecyzjaSugestii, PotwierdzenieReguly } from "@/components/decyzje/formularze";
import { Badge, EmptyState, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { linkZDowodu } from "@/lib/api-v2/luki";
import { dateTime } from "@/lib/format";
import { licznikiDoDecyzji, propozycjeRegul, propozycjeSetupow, regulyKontDoPotwierdzenia, sugestieDoDecyzji } from "@/lib/queries/decyzje";

export const metadata = { title: "Do decyzji — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

const POZIOMY: Record<string, string> = { tested: "PRZETESTOWANE", partial: "CZĘŚCIOWE", inferred: "WYWNIOSKOWANE" };
const RODZAJE: Record<string, string> = {
  tag: "Tag",
  trade_link: "Powiązanie trade'u z notatką",
  setup_example: "Przykład setupu",
  process_grade: "Ocena procesu",
  trade_setup: "Setup trade'u",
  profile_term: "Hasło słownika",
  day_conclusion: "Wniosek dnia",
  weekly_conclusion: "Wniosek tygodnia",
  strategy_detail: "Dopisek do strategii",
};

function Dowod({ dane }: { dane: unknown }) {
  return (
    <pre className="max-h-48 overflow-auto rounded-[var(--radius-control)] border border-line bg-surface-2 p-2 text-xs text-muted">
      {JSON.stringify(dane, null, 2)}
    </pre>
  );
}

function opisCelu(target: Record<string, unknown>): string {
  if (target.type === "trade") return `trade #${String(target.id)}`;
  if (target.type === "note") return `notatka #${String(target.id)}`;
  if (target.type === "day") return `dzień ${String(target.date)}`;
  if (target.type === "week") return `tydzień od ${String(target.weekStart)}`;
  return "profil tradera";
}

export default async function DoDecyzjiPage() {
  await requireSession();
  const [reguly, setupy, sugestie, liczniki, regulyKont] = await Promise.all([propozycjeRegul(), propozycjeSetupow(), sugestieDoDecyzji(), licznikiDoDecyzji(), regulyKontDoPotwierdzenia()]);
  const regula = reguly[0];
  const setup = setupy[0];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text">Do decyzji</h1>
        <p className="text-sm text-muted">
          Tylko Ty zatwierdzasz reguły, wersje setupów i sugestie AI. Agent może je zgłosić, ale nie ma jak ich przyjąć.
          Oczekuje: {liczniki.decyzje}
          {liczniki.rozstrzygniecia > 0 && (
            <>
              {" "}
              ·{" "}
              <Link href="/decyzje/rozstrzygniecia" className="text-accent underline">
                do rozstrzygnięcia: {liczniki.rozstrzygniecia}
              </Link>
            </>
          )}
        </p>
      </header>

      <Panel title="Propozycje reguł" description="Jedna naraz. Przyjmij, popraw i przyjmij albo odrzuć z powodem.">
        {!regula ? (
          <EmptyState title="Brak propozycji reguł" description="Gdy AI albo import zgłosi regułę, pojawi się tutaj." />
        ) : (
          <div>
            <div className="space-y-2 border-b border-line px-4 py-3">
              <p className="text-xs text-faint">
                Propozycja 1 z {reguly.length} · zgłoszona {dateTime(regula.proposedAt)}
              </p>
              <h2 className="text-base font-semibold text-text">
                {regula.ruleCode}: {regula.title} <span className="text-sm font-normal text-muted">(wersja {regula.version})</span>
              </h2>
              <div className="flex flex-wrap gap-1">
                <Badge>{regula.podpis}</Badge>
                {regula.vaultStatus && <Badge title="Status z sejfu to informacja, nie zatwierdzenie.">w sejfie: {regula.vaultStatus}</Badge>}
              </div>
              <div>
                <p className="etykieta">Proponowana treść</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-text">{regula.textMd}</p>
              </div>
              {regula.obowiazujacyTekst && (
                <div>
                  <p className="etykieta">Obowiązująca treść</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{regula.obowiazujacyTekst}</p>
                </div>
              )}
              {regula.counterargument && (
                <div>
                  <p className="etykieta">Najsilniejszy kontrargument</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text">{regula.counterargument}</p>
                </div>
              )}
              {regula.evidence != null && (
                <div>
                  <p className="etykieta">Dowody</p>
                  {linkZDowodu(regula.evidence) && (
                    <p className="text-sm">
                      <a href={linkZDowodu(regula.evidence)!} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                        Film mentora w miejscu cytatu
                      </a>
                    </p>
                  )}
                  <Dowod dane={regula.evidence} />
                </div>
              )}
            </div>
            <DecyzjaReguly key={regula.versionId} versionId={regula.versionId} tekst={regula.textMd} />
          </div>
        )}
      </Panel>

      <Panel title="Wersje setupów" description="Jedna naraz. Zmiana progów statusu to zawsze nowa wersja.">
        {!setup ? (
          <EmptyState title="Brak propozycji setupów" />
        ) : (
          <div>
            <div className="space-y-2 border-b border-line px-4 py-3">
              <p className="text-xs text-faint">Propozycja 1 z {setupy.length}</p>
              <h2 className="text-base font-semibold text-text">
                {setup.name} <span className="text-sm font-normal text-muted">(wersja {setup.version})</span>
              </h2>
              <Badge>{setup.podpis}</Badge>
              <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
                {(
                  [
                    ["Stop", setup.wersja.stopRule],
                    ["Cel", setup.wersja.targetRule],
                    ["BE", setup.wersja.beRule],
                    ["Unieważnienie", setup.wersja.invalidation],
                    ["Czego unikać", setup.wersja.avoid],
                  ] as const
                ).map(([k, v]) =>
                  v ? (
                    <div key={k} className="contents">
                      <dt className="text-faint">{k}</dt>
                      <dd className="text-text">{v}</dd>
                    </div>
                  ) : null,
                )}
                <dt className="text-faint">Progi statusu</dt>
                <dd className="font-mono text-xs text-text">{JSON.stringify(setup.wersja.thresholds)}</dd>
              </dl>
              {setup.wersja.counterargument && <p className="text-sm text-text">Kontrargument: {setup.wersja.counterargument}</p>}
              {linkZDowodu(setup.wersja.evidence) && (
                <p className="text-sm">
                  <a href={linkZDowodu(setup.wersja.evidence)!} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                    Film mentora w miejscu cytatu
                  </a>
                </p>
              )}
              {setup.wersja.evidence != null && <Dowod dane={setup.wersja.evidence} />}
            </div>
            <DecyzjaSetupu
              key={setup.versionId}
              versionId={setup.versionId}
              wersja={{ stopRule: setup.wersja.stopRule, targetRule: setup.wersja.targetRule, beRule: setup.wersja.beRule, invalidation: setup.wersja.invalidation, avoid: setup.wersja.avoid }}
            />
          </div>
        )}
      </Panel>

      <Panel
        title="Reguły kont prop do potwierdzenia"
        description="Dopóki nie potwierdzisz, że wartości zgadzają się z regulaminem firmy, bufory liczę na ostrzejszej z dwóch reguł: ostatniej potwierdzonej i nowej."
      >
        {regulyKont.length === 0 ? (
          <EmptyState title="Wszystkie reguły kont są potwierdzone" />
        ) : (
          <ul className="divide-y divide-line">
            {regulyKont.map((r) => (
              <li key={r.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge>niepotwierdzone</Badge>
                  {r.preset && <Badge>{r.preset.firm} · {r.preset.program} · {r.preset.phase}</Badge>}
                  {r.preset?.needsVerification && <Badge>preset do weryfikacji</Badge>}
                  <span className="text-sm text-text">{r.accountName}</span>
                  <span className="text-xs text-faint">obowiązują od {r.validFrom}</span>
                </div>
                <dl className="grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
                  <dt className="text-faint">Typ DD</dt>
                  <dd className="text-text">{r.rule.ddType}</dd>
                  <dt className="text-faint">Maks. DD</dt>
                  <dd className="text-text">{(r.rule.maxDdCents / 100).toFixed(2)} USD</dd>
                  <dt className="text-faint">Dzienny limit straty</dt>
                  <dd className="text-text">{r.rule.dailyLossCents === null ? "brak" : `${(r.rule.dailyLossCents / 100).toFixed(2)} USD`}</dd>
                  <dt className="text-faint">Consistency</dt>
                  <dd className="text-text">{r.rule.consistencyPct === null ? "brak" : `${r.rule.consistencyPct}%`}</dd>
                  <dt className="text-faint">Źródło</dt>
                  <dd className="break-all text-text">{r.rule.sourceUrl ?? "brak"}{r.preset ? ` (odczytane ${r.preset.readOn})` : ""}</dd>
                </dl>
                <PotwierdzenieReguly id={r.id} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Sugestie AI"
        description="Zatwierdzenie jednym kliknięciem wstawia efekt z pochodzeniem »ai«; można je cofnąć. Do tego czasu sugestia nie wchodzi do statystyk."
      >
        {sugestie.oczekujace.length === 0 ? (
          <EmptyState title="Brak oczekujących sugestii" />
        ) : (
          <ul className="divide-y divide-line">
            {sugestie.oczekujace.map((s) => (
              <li key={s.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge>{RODZAJE[s.kind] ?? s.kind}</Badge>
                  <Badge>{POZIOMY[s.evidenceLevel]}</Badge>
                  {s.n !== null && <Badge>n = {s.n}</Badge>}
                  <Badge>propozycja AI</Badge>
                  <span className="text-xs text-faint">{opisCelu(s.target)}</span>
                </div>
                <p className="text-sm text-text">{s.claim}</p>
                <details>
                  <summary className="cursor-pointer text-xs text-muted">Dowody i treść</summary>
                  <Dowod dane={{ payload: s.payload, evidence: s.evidence }} />
                </details>
                <DecyzjaSugestii id={s.id} zatwierdzona={false} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Zatwierdzone (do cofnięcia)" description="Ostatnie 20 zatwierdzonych albo zastosowanych sugestii.">
        {sugestie.zatwierdzone.length === 0 ? (
          <EmptyState title="Nic jeszcze nie zatwierdzono" />
        ) : (
          <ul className="divide-y divide-line">
            {sugestie.zatwierdzone.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0 text-sm">
                  <Badge>{RODZAJE[s.kind] ?? s.kind}</Badge> <span className="text-text">{s.claim}</span>
                  <span className="ml-2 text-xs text-faint">{opisCelu(s.target)}</span>
                </div>
                <DecyzjaSugestii id={s.id} zatwierdzona />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
