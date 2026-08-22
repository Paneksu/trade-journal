"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ClipboardPaste, Trash2 } from "lucide-react";

import { Button, ErrorMessage } from "@/components/ui/base";
import { addDayScreenshots, removeDayScreenshot } from "@/lib/actions/journal";

/**
 * Zrzuty przypiete do dnia, nie do trade'a. Dzien bez transakcji tez ma czego
 * dowodzic: wykres, na ktorym setupu nie bylo, jest czesto wiecej wart
 * niz zdanie o nim.
 *
 * Wklejanie ze schowka jest tu glowna droga - zrzut z platformy leci Ctrl+V,
 * bez zapisywania pliku na dysk. Pole wyboru pliku zostaje dla telefonu.
 */

export type DayShot = {
  id: number;
  file: string;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
};

export function DayScreenshots({
  day,
  accountId,
  backtestSessionId = null,
  shots,
}: {
  day: string;
  accountId: number | null;
  backtestSessionId?: number | null;
  shots: DayShot[];
}) {
  const [pending, startTransition] = useTransition();
  const [blad, setBlad] = useState<string | null>(null);
  const [wklejone, setWklejone] = useState(false);
  // Znacznik gotowosci nasluchu zapisujemy wprost w DOM, nie w stanie: reguly
  // Reacta slusznie zabraniaja setState w ciele efektu, a atrybut jest tu tylko
  // sygnalem "Ctrl+V juz dziala" - dla testu i dla podgladu w przegladarce.
  const strefa = useRef<HTMLDivElement>(null);

  function wyslij(files: File[]) {
    const obrazy = files.filter((f) => f.type.startsWith("image/"));
    if (obrazy.length === 0) return;

    const dane = new FormData();
    dane.set("day", day);
    if (accountId) dane.set("accountId", String(accountId));
    if (backtestSessionId) dane.set("backtestSessionId", String(backtestSessionId));
    for (const f of obrazy) dane.append("shot", f);

    setBlad(null);
    startTransition(async () => {
      const wynik = await addDayScreenshots(dane);
      setBlad(wynik.error ?? null);
      if (!wynik.error) {
        setWklejone(true);
        window.setTimeout(() => setWklejone(false), 2000);
      }
    });
  }

  // Ctrl+V dziala na calym panelu dnia, nie tylko po kliknieciu w ramke:
  // po zrobieniu zrzutu w platformie nikt nie szuka najpierw pola do wklejenia.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      wyslij(files);
    }
    document.addEventListener("paste", onPaste);
    const wezel = strefa.current;
    if (wezel) wezel.dataset.wklejanie = "gotowe";
    return () => {
      document.removeEventListener("paste", onPaste);
      if (wezel) wezel.dataset.wklejanie = "czekam";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, accountId, backtestSessionId]);

  return (
    <div className="space-y-3 p-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          wyslij(Array.from(e.dataTransfer.files));
        }}
        ref={strefa}
        data-wklejanie="czekam"
        className="rounded-[var(--radius-control)] border border-dashed border-line-strong bg-surface-2 px-4 py-5 text-center"
      >
        <ClipboardPaste size={18} className="mx-auto mb-1.5 text-faint" aria-hidden />
        <p className="text-sm text-muted" aria-live="polite">
          {pending ? "Wgrywam…" : wklejone ? "Wgrane." : "Wklej zrzut (Ctrl+V) albo przeciągnij plik"}
        </p>
        <p className="mt-0.5 text-xs text-faint">PNG, JPEG, WEBP lub AVIF, do 10 MB.</p>

        <label className="mt-3 inline-block">
          <span className="sr-only">Wybierz plik ze zrzutem dnia</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            multiple
            disabled={pending}
            onChange={(e) => {
              wyslij(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text hover:file:border-faint"
          />
        </label>
      </div>

      {blad && <ErrorMessage>{blad}</ErrorMessage>}

      {shots.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {shots.map((s) => (
            <figure key={s.id} className="relative">
              {/* Na miejscu miniatura, pelny obraz po klinieciu w nowej karcie. */}
              <a href={`/api/screenshots/${s.file}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/screenshots/${s.thumbnail ?? s.file}`}
                  alt={`Zrzut z dnia ${day}`}
                  width={s.width ?? undefined}
                  height={s.height ?? undefined}
                  className="w-full rounded-[var(--radius-control)] border border-line"
                />
              </a>
              <UsunZrzut id={s.id} />
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function UsunZrzut({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="quiet"
      size="s"
      disabled={pending}
      aria-label="Usuń zrzut"
      onClick={() => {
        if (!window.confirm("Usunąć ten zrzut?")) return;
        startTransition(async () => {
          await removeDayScreenshot(id);
        });
      }}
      className="absolute top-2 right-2 border-line-strong bg-bg/80 px-1.5 text-faint hover:text-loss"
    >
      <Trash2 size={13} aria-hidden />
    </Button>
  );
}
