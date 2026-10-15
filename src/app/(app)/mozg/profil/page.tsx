import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Chip, Karta, NaglowekStrony } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { dateTime } from "@/lib/format";
import { profilMozgu } from "@/lib/queries/mozg";

export const metadata = { title: "Profil tradera — Mózg" };

/*
 * Profil i słownik tradera (MUST 14). Forma: wzór 4 (profil Linear) i karty Mercury: miara u góry jako liczba
 * z historią, słownik jako lista z cytatami-źródłami, rejestr poprawek jako para „interpretacja → poprawka”.
 */
export default async function ProfilPage() {
  await requireSession();
  const p = await profilMozgu();
  const ostatni = p.correctionRate.at(-1) ?? null;
  const maks = Math.max(1, ...p.correctionRate.map((m) => m.interpreted));

  return (
    <div className="mx-auto w-full max-w-tresc space-y-6">
      <NaglowekStrony
        tytul="Profil tradera"
        nad={
          <Link href="/mozg" className="przejscie inline-flex items-center gap-0.5 hover:text-text">
            Mózg <ChevronRight size={13} aria-hidden />
          </Link>
        }
        podtytul="Twoje określenia, przypisane pojęcia i każda Twoja poprawka interpretacji AI. AI czyta to przed każdą interpretacją."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Karta tytul="Poprawione interpretacje">
          <p className="num text-liczba font-medium text-text">{ostatni?.rate == null ? "—" : `${Math.round(ostatni.rate * 100)}%`}</p>
          <p className="num text-meta text-muted">{ostatni ? `${ostatni.corrected} poprawek na ${ostatni.interpreted} interpretacji (${ostatni.month})` : "Brak interpretacji AI."} Powinno spadać.</p>
          <ol className="mt-4 space-y-2">
            {p.correctionRate.map((m) => (
              <li key={m.month} className="grid grid-cols-[64px_minmax(0,1fr)_52px] items-center gap-3 text-meta">
                <span className="num text-muted">{m.month}</span>
                <span className="relative h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                  <span className="absolute inset-y-0 left-0 bg-text/30" style={{ width: `${(m.interpreted / maks) * 100}%` }} />
                  <span className="absolute inset-y-0 left-0 bg-text/80" style={{ width: `${(m.corrected / maks) * 100}%` }} />
                </span>
                <span className="num text-right text-text">{m.rate == null ? "—" : `${Math.round(m.rate * 100)}%`}</span>
              </li>
            ))}
          </ol>
        </Karta>
        <Karta tytul="Werdykty AI zmienione przez Ciebie">
          <p className="num text-liczba font-medium text-text">{p.verdicts.changedByUser}</p>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-meta">
            <div>
              <dt className="text-muted">Werdykty</dt>
              <dd className="num text-karta text-text">{p.verdicts.aiVerdicts}</dd>
            </div>
            <div>
              <dt className="text-muted">Korekty</dt>
              <dd className="num text-karta text-text">{p.verdicts.overrides}</dd>
            </div>
            <div>
              <dt className="text-muted">Niezgody</dt>
              <dd className="num text-karta text-text">{p.verdicts.ruleDisagreements}</dd>
            </div>
          </dl>
        </Karta>
      </div>

      <section aria-labelledby="slownik" className="space-y-3">
        <h2 id="slownik" className="text-sekcja text-text">
          Słownik tradera <span className="num text-meta text-muted">{p.terms.length}</span>
        </h2>
        <ul>
          {p.terms.map((t) => (
            <li key={t.id} className="border-b border-line py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-karta font-medium text-text">{t.term}</span>
                <span className="text-meta text-muted">→ {t.meaning}</span>
                {t.status === "proposed" && <Chip className="h-6">propozycja AI · w „Do decyzji”</Chip>}
                {t.conceptNoteId && (
                  <Link href={`/mozg/notatki/${t.conceptNoteId}`} className="przejscie text-meta text-muted underline underline-offset-2 hover:text-text">
                    pojęcie
                  </Link>
                )}
              </div>
              {t.sources.map((s) => (
                <blockquote key={s.wordsId} className="mt-2 border-l-2 border-accent pl-3 text-meta whitespace-pre-wrap text-text">
                  {s.text}
                </blockquote>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="poprawki" className="space-y-3">
        <h2 id="poprawki" className="text-sekcja text-text">
          Rejestr poprawek <span className="num text-meta text-muted">{p.corrections.length}</span>
        </h2>
        <ol className="space-y-4">
          {p.corrections.map((c) => (
            <li key={c.id} className="karta space-y-3 p-5">
              <p className="num text-meta text-muted">{dateTime(c.createdAt)}</p>
              <blockquote className="border-l-2 border-accent pl-3 text-meta whitespace-pre-wrap text-text">{c.words}</blockquote>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[var(--radius-tab)] border border-dashed border-line-strong px-3 py-2">
                  <p className="mb-1 text-grupa text-muted">interpretacja AI przed</p>
                  <p className="text-meta text-muted line-through decoration-line-strong">{c.beforeInterpretation}</p>
                </div>
                <div className="rounded-[var(--radius-tab)] border border-dashed border-line-strong px-3 py-2">
                  <p className="mb-1 text-grupa text-muted">interpretacja AI po poprawce</p>
                  <p className="text-meta text-text">{c.afterInterpretation}</p>
                </div>
              </div>
              {c.correction && (
                <div>
                  <p className="mb-1 text-grupa text-muted">Twoja poprawka (dosłownie)</p>
                  <blockquote className="border-l-2 border-accent pl-3 text-meta whitespace-pre-wrap text-text">{c.correction}</blockquote>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
