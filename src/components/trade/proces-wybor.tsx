"use client";

import { useState, useTransition } from "react";

import { cx } from "@/lib/classes";
import { ocenProces } from "@/lib/actions/proces";
import { OCENA_PROCESU_OPISY, type OcenaProcesu } from "@/lib/domain/process-grid";

/**
 * Ocena procesu A/B/C (MUST 3): osobno od wyniku, wolno ją wystawić przed zamknięciem. Wybór jak
 * segment w stylu zakładki wzoru (r=8, aktywna na tle akcentu 20%). Drugi klik w tę samą ocenę ją zdejmuje.
 */
export function ProcesWybor({ tradeId, poczatkowa }: { tradeId: number; poczatkowa: OcenaProcesu | null }) {
  const [ocena, setOcena] = useState<OcenaProcesu | null>(poczatkowa);
  const [blad, setBlad] = useState<string | null>(null);
  const [trwa, start] = useTransition();

  function wybierz(o: OcenaProcesu) {
    const poprzednia = ocena;
    const nowa = ocena === o ? null : o;
    setOcena(nowa);
    setBlad(null);
    start(async () => {
      const w = await ocenProces(tradeId, nowa);
      if (!w.ok) {
        setOcena(poprzednia);
        setBlad(w.error ?? "Nie zapisano oceny.");
      }
    });
  }

  return (
    <div>
      <div role="group" aria-label="Ocena procesu" className="grid gap-2 sm:grid-cols-3">
        {(["A", "B", "C"] as const).map((o) => (
          <button
            key={o}
            type="button"
            disabled={trwa}
            aria-pressed={ocena === o}
            onClick={() => wybierz(o)}
            className={cx(
              "przejscie flex items-center gap-3 rounded-[var(--radius-tab)] border px-3 py-3 text-left disabled:opacity-70",
              ocena === o ? "border-accent/60 bg-accent-dim" : "border-line-strong bg-surface hover:bg-surface-2 active:bg-surface-3",
            )}
          >
            <span className={cx("num text-liczba font-medium", ocena === o ? "text-accent-strong" : "text-text")}>{o}</span>
            <span className="text-meta text-muted">{OCENA_PROCESU_OPISY[o].replace(/^[ABC]: /, "")}</span>
          </button>
        ))}
      </div>
      {blad && (
        <p role="alert" className="mt-2 text-meta text-loss">
          {blad}
        </p>
      )}
    </div>
  );
}
