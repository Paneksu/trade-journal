"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Markdown } from "@/components/trade/markdown";
import { klasaPigulki } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { zapiszNotatke, type MozgState } from "@/lib/actions/mozg";

import { linkiNaMarkdown, normalizujTytul } from "./linki";

/**
 * Edytor notatki (wzór 9, Memotron: przełącznik „Markdown / podgląd” na dole, kolumna lektury ok. 68 znaków).
 * Textarea z podglądem i podpowiadaniem `[[`: po wpisaniu `[[` lista tytułów notatek filtrowana tym, co dalej
 * piszesz; Enter albo klik wstawia `Tytuł]]`. Zapis przez akcję serwera (aktor `ui`, `If-Match` = rewizja).
 */

const RODZAJE: [string, string][] = [
  ["concept", "Pojęcie ICT"],
  ["system", "System"],
  ["strategy", "Strategia"],
  ["mistake", "Wzorzec: błąd"],
  ["strength", "Wzorzec: mocna strona"],
  ["learning", "Dziennik nauki"],
  ["brain_decision", "Decyzja mózgu"],
];

const POLE =
  "przejscie w-full rounded-[var(--radius-tab)] border border-line-strong bg-surface-2 px-3 py-2 text-karta text-text " +
  "placeholder:text-faint hover:border-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export function EdytorNotatki({
  notatka,
  tytuly,
  anuluj,
}: {
  notatka: { id: number; rev: number; title: string; bodyMd: string } | null;
  tytuly: { id: number; title: string; kind: string }[];
  anuluj: string;
}) {
  const [stan, akcja, trwa] = useActionState<MozgState, FormData>(zapiszNotatke, {});
  const [tresc, setTresc] = useState(notatka?.bodyMd ?? "");
  const [tryb, setTryb] = useState<"edycja" | "podglad">("edycja");
  const [podpowiedz, setPodpowiedz] = useState<{ fraza: string; start: number } | null>(null);
  const [wybrany, setWybrany] = useState(0);
  const pole = useRef<HTMLTextAreaElement>(null);

  const propozycje = useMemo(() => {
    if (!podpowiedz) return [];
    const f = normalizujTytul(podpowiedz.fraza);
    return tytuly.filter((t) => t.id !== notatka?.id && normalizujTytul(t.title).includes(f)).slice(0, 8);
  }, [podpowiedz, tytuly, notatka?.id]);

  function sprawdzPodpowiedz(wartosc: string, kursor: number) {
    const przed = wartosc.slice(0, kursor);
    const m = /\[\[([^\]\n]{0,60})$/.exec(przed);
    setPodpowiedz(m ? { fraza: m[1], start: kursor - m[1].length } : null);
    setWybrany(0);
  }

  function wstaw(tytul: string) {
    if (!podpowiedz || !pole.current) return;
    const kursor = pole.current.selectionStart;
    const nowa = `${tresc.slice(0, podpowiedz.start)}${tytul}]]${tresc.slice(kursor)}`;
    setTresc(nowa);
    setPodpowiedz(null);
    const pozycja = podpowiedz.start + tytul.length + 2;
    requestAnimationFrame(() => {
      pole.current?.focus();
      pole.current?.setSelectionRange(pozycja, pozycja);
    });
  }

  return (
    <form action={akcja} className="space-y-4">
      {notatka && (
        <>
          <input type="hidden" name="id" value={notatka.id} />
          <input type="hidden" name="rev" value={notatka.rev} />
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <label htmlFor="notatka-tytul" className="mb-1.5 block text-meta text-muted">
            Tytuł
          </label>
          <input id="notatka-tytul" name="tytul" required defaultValue={notatka?.title ?? ""} className={cx(POLE, "h-10 text-sekcja")} />
        </div>
        {!notatka && (
          <div>
            <label htmlFor="notatka-rodzaj" className="mb-1.5 block text-meta text-muted">
              Rodzaj
            </label>
            <select id="notatka-rodzaj" name="kind" defaultValue="concept" className={cx(POLE, "h-10 cursor-pointer")}>
              {RODZAJE.map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <input type="hidden" name="tresc" value={tresc} />
      <div className={cx(tryb === "edycja" ? "block" : "hidden", "relative")}>
        <label htmlFor="notatka-tresc" className="mb-1.5 block text-meta text-muted">
          Treść (markdown, linki do notatek przez <span className="num">[[</span>)
        </label>
        <textarea
          ref={pole}
          id="notatka-tresc"
          value={tresc}
          rows={18}
          aria-controls={propozycje.length > 0 ? "podpowiedzi-linkow" : undefined}
          aria-autocomplete="list"
          onChange={(e) => {
            setTresc(e.target.value);
            sprawdzPodpowiedz(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            if (propozycje.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setWybrany((w) => Math.min(w + 1, propozycje.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setWybrany((w) => Math.max(w - 1, 0));
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              wstaw(propozycje[wybrany].title);
            } else if (e.key === "Escape") {
              setPodpowiedz(null);
            }
          }}
          className={cx(POLE, "num min-h-[360px] resize-y leading-relaxed")}
        />
        {propozycje.length > 0 && (
          <ul id="podpowiedzi-linkow" role="listbox" aria-label="Notatki do podlinkowania" className="karta absolute right-3 bottom-3 z-[var(--z-dropdown)] w-72 p-1 shadow-[var(--shadow-pop)]">
            {propozycje.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === wybrany}
                onMouseDown={(e) => {
                  e.preventDefault();
                  wstaw(p.title);
                }}
                className={cx("cursor-pointer rounded-[6px] px-2.5 py-1.5 text-meta", i === wybrany ? "bg-surface-3 text-text" : "text-muted")}
              >
                {p.title}
              </li>
            ))}
          </ul>
        )}
      </div>
      {tryb === "podglad" && (
        <div className="karta max-w-[68ch] p-6">
          {tresc.trim() ? <Markdown>{linkiNaMarkdown(tresc, tytuly)}</Markdown> : <p className="text-meta text-muted">Pusta treść.</p>}
        </div>
      )}

      {stan.error && (
        <p role="alert" className="text-meta text-loss">
          {stan.error}
        </p>
      )}

      {/* Pasek na dole jak przełącznik widoku we wzorze. */}
      <div className="sticky bottom-20 z-[var(--z-przyklejone)] flex flex-wrap items-center justify-between gap-3 rounded-full border border-line-strong bg-panel px-2 py-2 shadow-[var(--shadow-pop)] lg:bottom-4">
        <div role="group" aria-label="Tryb edytora" className="flex gap-1">
          {(
            [
              ["edycja", "Markdown"],
              ["podglad", "Podgląd"],
            ] as const
          ).map(([t, n]) => (
            <button
              key={t}
              type="button"
              aria-pressed={tryb === t}
              onClick={() => setTryb(t)}
              className={cx("przejscie h-8 rounded-full px-3.5 text-meta", tryb === t ? "bg-accent-dim text-accent-strong" : "text-muted hover:text-text")}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href={anuluj} className="przejscie inline-flex h-8 items-center rounded-full px-3.5 text-meta text-muted hover:text-text">
            Anuluj
          </Link>
          <button type="submit" disabled={trwa} className={cx(klasaPigulki(true), "disabled:opacity-60")}>
            {trwa ? "Zapisuję…" : "Zapisz"}
          </button>
        </div>
      </div>
    </form>
  );
}
