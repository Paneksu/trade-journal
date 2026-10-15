"use client";

import { useActionState } from "react";

import { Markdown } from "@/components/trade/markdown";
import { klasaPigulki } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { poprawInterpretacjeAkcja, poprawSlowaAkcja, type MozgState } from "@/lib/actions/mozg";

/**
 * „Słowa użytkownika” dosłownie i „interpretacja AI” osobno, z podpisem (MUST 13). Słowa poprawia tylko
 * użytkownik, z rewizją (nowy wpis, stary w historii); interpretację poprawia się przez rejestr poprawek
 * (`profile/corrections`), co uczy słownik tradera.
 */

const POLE =
  "przejscie w-full rounded-[var(--radius-tab)] border border-line-strong bg-surface-2 px-3 py-2 text-karta text-text " +
  "placeholder:text-faint hover:border-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

type Wpis = {
  id: number;
  text: string;
  source: string;
  capturedAt: string;
  aiInterpretation: string | null;
  interpretationModel: string | null;
  historia: { id: number; text: string; capturedAt: string }[];
};

function Komunikat({ stan }: { stan: MozgState }) {
  if (stan.error) return <p role="alert" className="text-meta text-loss">{stan.error}</p>;
  if (stan.ok) return <p role="status" className="text-meta text-muted">{stan.komunikat}</p>;
  return null;
}

function czas(iso: string): string {
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function SlowaUzytkownikaNotatki({ wpis, sciezka }: { wpis: Wpis; sciezka: string }) {
  const [stanS, akcjaS, trwaS] = useActionState<MozgState, FormData>(poprawSlowaAkcja, {});
  const [stanI, akcjaI, trwaI] = useActionState<MozgState, FormData>(poprawInterpretacjeAkcja, {});

  return (
    <article className="space-y-3 border-t border-line pt-5">
      <p className="num text-meta text-muted">
        Słowa użytkownika · {wpis.source} · {czas(wpis.capturedAt)}
        {wpis.historia.length > 0 && <> · rewizja {wpis.historia.length + 1}</>}
      </p>
      {/* Bajt w bajt: zwykły tekst z nowymi liniami, bez markdownu. */}
      <blockquote className="border-l-2 border-accent py-0.5 pl-3 text-karta whitespace-pre-wrap text-text">{wpis.text}</blockquote>

      {wpis.historia.length > 0 && (
        <details className="text-meta">
          <summary className="przejscie cursor-pointer text-muted hover:text-text">Poprzednie wersje ({wpis.historia.length})</summary>
          <ol className="mt-2 space-y-2">
            {wpis.historia.map((h) => (
              <li key={h.id} className="border-l border-line pl-3 whitespace-pre-wrap text-muted">
                <span className="num block text-grupa">{czas(h.capturedAt)}</span>
                {h.text}
              </li>
            ))}
          </ol>
        </details>
      )}

      {wpis.aiInterpretation && (
        <div className="rounded-[var(--radius-tab)] border border-dashed border-line-strong px-4 py-3">
          <p className="mb-1.5 text-meta text-muted">
            interpretacja AI{wpis.interpretationModel ? <span className="num"> · {wpis.interpretationModel}</span> : null}
          </p>
          <Markdown className="text-meta text-muted [&_*]:text-muted">{wpis.aiInterpretation}</Markdown>
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <details className="w-full sm:w-auto">
          <summary className="przejscie cursor-pointer text-meta text-muted hover:text-text">Popraw słowa</summary>
          <form action={akcjaS} className="mt-3 space-y-3 sm:w-[560px]">
            <input type="hidden" name="wordsId" value={wpis.id} />
            <input type="hidden" name="sciezka" value={sciezka} />
            <label htmlFor={`slowa-${wpis.id}`} className="block text-meta text-muted">
              Nowa wersja (stara zostaje w historii)
            </label>
            <textarea id={`slowa-${wpis.id}`} name="tekst" rows={3} defaultValue={wpis.text} className={cx(POLE, "resize-y")} />
            <button type="submit" disabled={trwaS} className={cx(klasaPigulki(false), "disabled:opacity-60")}>
              {trwaS ? "Zapisuję…" : "Zapisz rewizję"}
            </button>
            <Komunikat stan={stanS} />
          </form>
        </details>

        {wpis.aiInterpretation && (
          <details className="w-full sm:w-auto">
            <summary className="przejscie cursor-pointer text-meta text-muted hover:text-text">Popraw interpretację AI</summary>
            <form action={akcjaI} className="mt-3 space-y-3 sm:w-[560px]">
              <input type="hidden" name="wordsId" value={wpis.id} />
              <input type="hidden" name="sciezka" value={sciezka} />
              <div>
                <label htmlFor={`kor-${wpis.id}`} className="mb-1.5 block text-meta text-muted">
                  O co Ci chodziło (zapisane dosłownie)
                </label>
                <textarea id={`kor-${wpis.id}`} name="slowa" rows={2} placeholder="Nie, chodziło mi o…" className={cx(POLE, "resize-y")} />
              </div>
              <div>
                <label htmlFor={`int-${wpis.id}`} className="mb-1.5 block text-meta text-muted">
                  Poprawiona interpretacja
                </label>
                <textarea id={`int-${wpis.id}`} name="interpretacja" rows={3} defaultValue={wpis.aiInterpretation} className={cx(POLE, "resize-y")} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`haslo-${wpis.id}`} className="mb-1.5 block text-meta text-muted">
                    Hasło słownika (opcjonalnie)
                  </label>
                  <input id={`haslo-${wpis.id}`} name="haslo" placeholder="np. czysty FVG" className={cx(POLE, "h-10")} />
                </div>
                <div>
                  <label htmlFor={`znacz-${wpis.id}`} className="mb-1.5 block text-meta text-muted">
                    Znaczenie
                  </label>
                  <input id={`znacz-${wpis.id}`} name="znaczenie" placeholder="np. FVG@5m po sweepie" className={cx(POLE, "h-10")} />
                </div>
              </div>
              <button type="submit" disabled={trwaI} className={cx(klasaPigulki(false), "disabled:opacity-60")}>
                {trwaI ? "Zapisuję…" : "Zapisz poprawkę"}
              </button>
              <Komunikat stan={stanI} />
            </form>
          </details>
        )}
      </div>
    </article>
  );
}
