"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { cx } from "@/lib/classes";
import { czyPion, klasaKafla, ukladSiatki } from "@/lib/domain/galeria";
import { Lightbox } from "./lightbox";
import type { Shot } from "./typy";

/**
 * Siatka zrzutow - jedna dla karty trade'a, panelu dnia i sesji backtestu.
 *
 * Na miejscu lezy wylacznie miniatura; pelny plik wchodzi dopiero w
 * powiekszeniu. Przy osmiu zdjeciach roznica to kilkanascie megabajtow na
 * jedno wejscie na strone.
 */

export function ScreenshotGrid({
  shots,
  opis,
  onUsun,
  className,
}: {
  shots: Shot[];
  opis: string;
  /** Podane tylko tam, gdzie zrzuty wolno kasowac. */
  onUsun?: (id: number) => Promise<void> | void;
  className?: string;
}) {
  const [podglad, setPodglad] = useState<number | null>(null);
  if (shots.length === 0) return null;

  const jeden = shots.length === 1;

  return (
    <>
      <div className={cx("grid gap-2", ukladSiatki(shots.length), className)}>
        {shots.map((s, i) => {
          const pion = czyPion(s.width, s.height);
          return (
            <figure
              key={s.id}
              className={cx("relative h-full", klasaKafla(i, shots.length, pion))}
            >
              <button
                type="button"
                onClick={() => setPodglad(i)}
                aria-label={`Powiększ zrzut ${i + 1} z ${shots.length}`}
                className="block h-full w-full cursor-zoom-in overflow-hidden rounded-[var(--radius-control)] border border-line transition-colors duration-150 hover:border-faint focus-visible:border-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/screenshots/${s.thumbnail ?? s.file}`}
                  alt={`Zrzut ${i + 1} z ${shots.length} — ${opis}`}
                  width={s.width ?? undefined}
                  height={s.height ?? undefined}
                  className={cx(
                    "w-full",
                    // Jedyne zdjecie pokazujemy w calosci - wykres ma byc
                    // czytelny bez klikania. Reszta wypelnia rowny kafel;
                    // pelny kadr jest o jedno klikniecie stad.
                    jeden
                      ? "max-h-[70vh] object-contain"
                      : "h-full object-cover",
                  )}
                />
              </button>
              {onUsun && <UsunZrzut id={s.id} onUsun={onUsun} />}
            </figure>
          );
        })}
      </div>

      <Lightbox
        shots={shots}
        index={podglad}
        opis={opis}
        onIndex={setPodglad}
        onClose={() => setPodglad(null)}
      />
    </>
  );
}

function UsunZrzut({
  id,
  onUsun,
}: {
  id: number;
  onUsun: (id: number) => Promise<void> | void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Usunąć ten zrzut?")) return;
        startTransition(async () => {
          await onUsun(id);
        });
      }}
      aria-label="Usuń zrzut"
      className="absolute top-2 right-2 rounded-[var(--radius-control)] border border-line-strong bg-bg/80 p-1.5 text-faint transition-colors duration-150 hover:text-loss disabled:opacity-50"
    >
      <Trash2 size={13} aria-hidden />
    </button>
  );
}
