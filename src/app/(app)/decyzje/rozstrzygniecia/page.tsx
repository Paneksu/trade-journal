import Link from "next/link";

import { DecyzjaSprzecznosci } from "@/components/decyzje/formularze";
import { Badge, EmptyState, Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { dateTime } from "@/lib/format";
import { sprzecznosciDoRozstrzygniecia } from "@/lib/queries/decyzje";

export const metadata = { title: "Do rozstrzygnięcia — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

function czasZnacznika(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sek = s % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(sek).padStart(2, "0")}`;
}

export default async function DoRozstrzygnieciaPage() {
  await requireSession();
  const lista = await sprzecznosciDoRozstrzygniecia();
  const s = lista[0];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text">Do rozstrzygnięcia</h1>
        <p className="text-sm text-muted">
          Sprzeczności między tym, co mówi mentor, a Twoją praktyką. AI ich nie rozstrzyga: decydujesz Ty, po jednej.{" "}
          <Link href="/decyzje" className="text-accent underline">
            Wróć do decyzji
          </Link>
        </p>
      </header>

      <Panel title="Sprzeczność mentor kontra praktyka" description="Jedna naraz.">
        {!s ? (
          <EmptyState
            title="Nic do rozstrzygnięcia"
            description="Gdy AI znajdzie sprzeczność między mentorem a Twoimi słowami albo trade'ami, pojawi się tutaj."
          />
        ) : (
          <div>
            <div className="space-y-3 border-b border-line px-4 py-3">
              <p className="text-xs text-faint">
                Sprzeczność 1 z {lista.length} · zgłoszona {dateTime(s.createdAt)}
                {s.setup ? ` · setup: ${s.setup.name}` : ""}
              </p>
              <h2 className="text-base font-semibold text-text">{s.question}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <section aria-labelledby="mentor-cytat" className="rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
                  <h3 id="mentor-cytat" className="etykieta">
                    Mentor mówi <Badge>wg mentora, n = 0</Badge>
                  </h3>
                  <blockquote className="mt-2 whitespace-pre-wrap text-sm text-text">{s.mentor.quote}</blockquote>
                  <p className="mt-2 text-xs text-muted">
                    <a href={s.mentor.link} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                      {s.mentor.videoTitle} od {czasZnacznika(s.mentor.tStartS)} (t={s.mentor.tStartS})
                    </a>
                  </p>
                </section>
                <section aria-labelledby="twoje-slowa" className="rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
                  <h3 id="twoje-slowa" className="etykieta">
                    Twoje słowa
                  </h3>
                  {s.slowaUzytkownika.length === 0 ? (
                    <p className="mt-2 text-sm text-faint">Do tej sprzeczności nie jest przypięty żaden Twój wpis.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {s.slowaUzytkownika.map((w) => (
                        <li key={w.id} className="whitespace-pre-wrap text-sm text-text">
                          {w.text}
                          <span className="block text-xs text-faint">{dateTime(w.capturedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.tradeId !== null && (
                    <p className="mt-2 text-xs">
                      <Link href={`/trades/${s.tradeId}`} className="text-accent underline">
                        Trade #{s.tradeId}
                      </Link>
                    </p>
                  )}
                </section>
              </div>
            </div>
            <DecyzjaSprzecznosci key={s.id} id={s.id} />
          </div>
        )}
      </Panel>
    </div>
  );
}
