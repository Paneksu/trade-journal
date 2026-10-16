"use client";

import { useFormStatus } from "react-dom";

import { klasaPigulki } from "@/components/ui/v2";
import { cx } from "@/lib/classes";

/**
 * Notatka dnia zmieniła się w tle (review potwierdzające fazy 5, B1): pola formularza NIE są przemontowywane, więc
 * wpisany tekst zostaje. Dwie drogi: „Scal” wysyła ten sam formularz z `scal=1` (teksty z obu wersji zostają),
 * „Odśwież” wczytuje aktualną wersję i porzuca niezapisane zmiany (świadomie, po kliknięciu).
 */
export function KonfliktNotatki({ komunikat }: { komunikat: string }) {
  const { pending } = useFormStatus();
  return (
    <div role="alert" className="space-y-3 rounded-[var(--radius-tab)] border border-line-strong bg-surface-2 p-3" data-konflikt-notatki>
      <p className="text-meta text-text">{komunikat}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="scal" value="1" disabled={pending} className={cx(klasaPigulki(false), "disabled:opacity-60")}>
          Scal z aktualną wersją
        </button>
        <button type="button" onClick={() => window.location.reload()} className={klasaPigulki(false)}>
          Odśwież (porzuć moje zmiany)
        </button>
      </div>
    </div>
  );
}
