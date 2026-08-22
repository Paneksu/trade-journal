"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { Shot } from "./typy";

/**
 * Powiekszenie zrzutu. Oparte na natywnym `<dialog>` i `showModal()`, nie na
 * bibliotece: pulapka fokusu, wygaszenie tla, Escape i powrot fokusu na kafel
 * sa wtedy za darmo, a repo trzyma sie zasady "bez biblioteki komponentow".
 */

export function Lightbox({
  shots,
  index,
  opis,
  onIndex,
  onClose,
}: {
  shots: Shot[];
  index: number | null;
  opis: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const okno = useRef<HTMLDialogElement>(null);
  const otwarty = index !== null;

  useEffect(() => {
    const w = okno.current;
    if (!w) return;
    if (otwarty && !w.open) w.showModal();
    if (!otwarty && w.open) w.close();
  }, [otwarty]);

  if (shots.length === 0) return null;

  const i = index ?? 0;
  const s = shots[Math.min(i, shots.length - 1)];
  const przesun = (o: number) => onIndex((i + o + shots.length) % shots.length);

  return (
    <dialog
      ref={okno}
      aria-label={`Zrzut ${i + 1} z ${shots.length} — ${opis}`}
      onClose={onClose}
      onClick={(e) => {
        // Klik w tlo: cel zdarzenia to samo okno, nie jego zawartosc.
        if (e.target === okno.current) onClose();
      }}
      onKeyDown={(e) => {
        if (shots.length < 2) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          przesun(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          przesun(-1);
        } else if (e.key === "Home") {
          e.preventDefault();
          onIndex(0);
        } else if (e.key === "End") {
          e.preventDefault();
          onIndex(shots.length - 1);
        }
      }}
      className="m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/90 open:flex open:flex-col open:items-center open:gap-3"
    >
      {otwarty && s && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/screenshots/${s.file}`}
            alt={`Zrzut ${i + 1} z ${shots.length} — ${opis}`}
            className="max-h-[85vh] max-w-[92vw] rounded-[var(--radius-control)] border border-line object-contain"
          />

          <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 py-1.5">
            {shots.length > 1 && (
              <button
                type="button"
                onClick={() => przesun(-1)}
                aria-label="Poprzedni zrzut"
                className="rounded-[var(--radius-control)] p-1 text-faint transition-colors duration-150 hover:text-text"
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
            )}
            <span className="liczba px-1 text-xs text-muted" aria-live="polite">
              {i + 1} / {shots.length}
            </span>
            {shots.length > 1 && (
              <button
                type="button"
                onClick={() => przesun(1)}
                aria-label="Następny zrzut"
                className="rounded-[var(--radius-control)] p-1 text-faint transition-colors duration-150 hover:text-text"
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Zamknij podgląd"
              className="ml-1 rounded-[var(--radius-control)] border-l border-line-strong pl-2 text-faint transition-colors duration-150 hover:text-text"
            >
              <X size={18} aria-hidden />
            </button>
          </div>

          {/* Sasiad wczytany po cichu - przewijanie strzalkami nie mruga. */}
          {shots.length > 1 && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/screenshots/${shots[(i + 1) % shots.length].file}`}
              alt=""
              aria-hidden
              className="hidden"
            />
          )}
        </>
      )}
    </dialog>
  );
}
