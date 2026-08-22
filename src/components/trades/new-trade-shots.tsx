"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Trash2 } from "lucide-react";

import { ErrorMessage } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { klasaKafla, ukladSiatki } from "@/lib/domain/galeria";
import { bladLimitu, MAX_ZRZUTOW } from "@/lib/screenshots-limit";

/**
 * Zrzuty przy nowym trade'cie. Wpis nie ma jeszcze identyfikatora, wiec pliki
 * musza polecic tym samym multipartem co reszta formularza - trzymamy je w
 * stanie i przepisujemy do ukrytego pola przez `DataTransfer`.
 *
 * Podglad idzie z `URL.createObjectURL`, bo na dysku serwera tych plikow
 * jeszcze nie ma.
 */

type Pozycja = { file: File; podglad: string };

export function NewTradeShots() {
  // Adres podgladu powstaje razem z pozycja, nie w efekcie - inaczej kazde
  // dodanie zdjecia goni sie z renderem i mnozy obiekty w pamieci.
  const [pliki, setPliki] = useState<Pozycja[]>([]);
  const [blad, setBlad] = useState<string | null>(null);
  const wejscie = useRef<HTMLInputElement>(null);
  const strefa = useRef<HTMLDivElement>(null);

  // Ustawienie `.files` z kodu nie wywoluje zdarzenia `change`, wiec nie ma
  // petli - synchronizacja jest jednokierunkowa: stan -> pole formularza.
  useEffect(() => {
    if (!wejscie.current) return;
    const dt = new DataTransfer();
    for (const p of pliki) dt.items.add(p.file);
    wejscie.current.files = dt.files;
  }, [pliki]);

  // Sprzatanie po opuszczeniu formularza; pojedyncze usuniecie zwalnia adres
  // od razu, w `usun`.
  const zywe = useRef<Pozycja[]>([]);
  useEffect(() => {
    zywe.current = pliki;
  }, [pliki]);
  useEffect(() => () => zywe.current.forEach((p) => URL.revokeObjectURL(p.podglad)), []);

  function dodaj(nowe: File[]) {
    const obrazy = nowe.filter((f) => f.type.startsWith("image/"));
    if (obrazy.length === 0) return;
    const limit = bladLimitu(pliki.length, obrazy.length);
    if (limit) {
      setBlad(limit);
      return;
    }
    setBlad(null);
    setPliki((p) => [...p, ...obrazy.map((f) => ({ file: f, podglad: URL.createObjectURL(f) }))]);
  }

  function usun(i: number) {
    setPliki((p) => {
      URL.revokeObjectURL(p[i].podglad);
      return p.filter((_, j) => j !== i);
    });
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      dodaj(files);
    }
    document.addEventListener("paste", onPaste);
    const wezel = strefa.current;
    if (wezel) wezel.dataset.wklejanie = "gotowe";
    return () => {
      document.removeEventListener("paste", onPaste);
      if (wezel) wezel.dataset.wklejanie = "czekam";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pliki.length]);

  const komplet = pliki.length >= MAX_ZRZUTOW;

  return (
    <div className="space-y-3 p-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dodaj(Array.from(e.dataTransfer.files));
        }}
        ref={strefa}
        data-wklejanie="czekam"
        className="rounded-[var(--radius-control)] border border-dashed border-line-strong bg-surface-2 px-4 py-5 text-center"
      >
        <ClipboardPaste
          size={18}
          className="mx-auto mb-1.5 text-faint"
          aria-hidden
        />
        <p className="text-sm text-muted" aria-live="polite">
          {komplet
            ? `Limit ${MAX_ZRZUTOW} zrzutów — usuń któryś, żeby dodać nowy.`
            : "Wklej zrzut (Ctrl+V) albo przeciągnij plik"}
        </p>
        <p className="mt-0.5 text-xs text-faint">
          PNG, JPEG, WEBP lub AVIF, do 10 MB. {pliki.length}/{MAX_ZRZUTOW}
        </p>

        <label className={cx("mt-3 inline-block", komplet && "hidden")}>
          <span className="sr-only">Wybierz pliki ze zrzutami</span>
          <input
            ref={wejscie}
            id="shot"
            name="shot"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            multiple
            onChange={(e) => {
              // Pole jest zrodlem prawdy dla formularza, ale nie dla widoku:
              // przejmujemy pliki do stanu, a efekt zaraz je tam odlozy.
              dodaj(Array.from(e.target.files ?? []));
            }}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text hover:file:border-faint"
          />
        </label>
      </div>

      {blad && <ErrorMessage>{blad}</ErrorMessage>}

      {pliki.length > 0 && (
        <div className={cx("grid gap-2", ukladSiatki(pliki.length))}>
          {pliki.map((f, i) => (
            <figure
              key={`${f.file.name}-${f.file.lastModified}-${i}`}
              className={cx(
                "relative h-full",
                klasaKafla(i, pliki.length, false),
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.podglad}
                alt={`Zrzut ${i + 1} do wgrania`}
                className={cx(
                  "w-full rounded-[var(--radius-control)] border border-line",
                  pliki.length === 1
                    ? "max-h-[70vh] object-contain"
                    : "h-full object-cover",
                )}
              />
              <button
                type="button"
                onClick={() => usun(i)}
                aria-label={`Usuń zrzut ${i + 1} z listy`}
                className="absolute top-2 right-2 rounded-[var(--radius-control)] border border-line-strong bg-bg/80 p-1.5 text-faint transition-colors duration-150 hover:text-loss"
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
