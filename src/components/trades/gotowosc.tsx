"use client";

import { useState } from "react";

import { Label, Textarea } from "@/components/ui/base";

/**
 * Samopoczucie i gotowosc na dany dzien (2026-08-29). Zastapilo pole wlasne
 * "Nastrój przed wejściem" - liste czterech nastrojow do wyboru.
 *
 * Dwie kontrolki obok siebie, bo niosa dwie rozne rzeczy: opis wlasnymi slowami
 * (czego zadna lista nie zmiesci) i JEDNA liczbe, ktora da sie pozniej grupowac
 * i porownac z wynikiem. Sam opis nie zrobilby wymiaru w statystykach, a sama
 * liczba nie powiedzialaby, dlaczego tego dnia bylo gorzej.
 *
 * Zero na suwaku to "nie oceniam", nie "zerowa gotowosc" - `<input
 * type="range">` nie ma stanu pustego, wiec albo dodatkowy checkbox obok, albo
 * jedna wartosc z brzegu skali. Wybrane to drugie: jedna kontrolka, jeden ruch.
 * Zamiane zera na NULL robi akcja zapisu, zeby ta umowa nie zyla wylacznie
 * w przegladarce.
 */

const NIE_OCENIAM = 0;

export function Gotowosc({
  moodNote,
  readiness,
}: {
  moodNote?: string | null;
  readiness?: number | null;
}) {
  const [poziom, setPoziom] = useState(readiness ?? NIE_OCENIAM);
  const oceniony = poziom !== NIE_OCENIAM;

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <div className="space-y-1.5">
        <Label htmlFor="moodNote" hint="Sen, stres, co siedzi z tyłu głowy.">
          Samopoczucie
        </Label>
        <Textarea
          id="moodNote"
          name="moodNote"
          rows={2}
          defaultValue={moodNote ?? ""}
          placeholder="Jak wchodzisz w ten dzień."
          className="min-h-20"
        />
      </div>

      <div className="space-y-1.5 sm:w-56">
        <Label htmlFor="readiness" hint="0 zostawia dzień nieoceniony.">
          Gotowość
        </Label>
        <div className="rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-2.5 py-2">
          <div className="flex items-baseline justify-between">
            <span className="liczba text-sm font-semibold text-text">
              {oceniony ? `${poziom}/10` : "nie oceniam"}
            </span>
            <span className="text-[11px] text-faint">{opis(poziom)}</span>
          </div>
          <input
            id="readiness"
            name="readiness"
            type="range"
            min={NIE_OCENIAM}
            max={10}
            step={1}
            value={poziom}
            onChange={(e) => setPoziom(Number(e.target.value))}
            aria-valuetext={oceniony ? `${poziom} na 10` : "nie oceniam"}
            className="mt-2 w-full accent-[var(--color-accent)]"
          />
        </div>
      </div>
    </div>
  );
}

/** Podpis skali - suwak bez opisu to liczba bez jednostki. */
function opis(poziom: number): string {
  if (poziom === NIE_OCENIAM) return "—";
  if (poziom <= 3) return "słaba";
  if (poziom <= 6) return "przeciętna";
  if (poziom <= 8) return "dobra";
  return "szczyt";
}
