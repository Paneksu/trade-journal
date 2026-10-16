"use client";

import { useState, useTransition } from "react";

import { cx } from "@/lib/classes";
import { ustawZdanieOReguly } from "@/lib/actions/oceny";
import { nastepnyWerdykt } from "@/lib/domain/ocena-ai";
import type { WerdyktUzytkownika } from "@/lib/domain/zgodnosc";

/**
 * Zdanie uzytkownika o ocenie jednej reguly: zgadzam sie / nie zgadzam sie.
 * Drugi klik w ten sam przycisk cofa zdanie. Stan pokazujemy od razu, a przy
 * bledzie zapisu wracamy do poprzedniego i mowimy, co sie stalo.
 */
export function ZdanieORegule({
  tradeId,
  checkId,
  ruleId,
  poczatkowe,
}: {
  tradeId: number;
  checkId: number;
  ruleId: string;
  poczatkowe: WerdyktUzytkownika | null;
}) {
  const [zdanie, setZdanie] = useState<WerdyktUzytkownika | null>(poczatkowe);
  const [blad, setBlad] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function kliknij(w: WerdyktUzytkownika) {
    const poprzednie = zdanie;
    const nowe = nastepnyWerdykt(zdanie, w);
    setZdanie(nowe);
    setBlad(null);
    start(async () => {
      const wynik = await ustawZdanieOReguly(tradeId, checkId, nowe);
      if (!wynik.ok) {
        setZdanie(poprzednie);
        setBlad(wynik.error);
      }
    });
  }

  const przycisk = (w: WerdyktUzytkownika, tekst: string, zaznaczony: string) => (
    <button
      type="button"
      onClick={() => kliknij(w)}
      disabled={pending}
      aria-pressed={zdanie === w}
      aria-label={`${tekst}: reguła ${ruleId}`}
      className={cx(
        "inline-flex h-7 items-center rounded-[var(--radius-control)] border px-2 text-xs whitespace-nowrap",
        "przejscie disabled:opacity-60",
        zdanie === w
          ? zaznaczony
          : "border-line-strong bg-surface-2 text-muted hover:border-faint hover:text-text",
      )}
    >
      {tekst}
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {/* UI v2: zielen i czerwien tylko dla wyniku, nigdy na przyciskach (kierunek.md, Role rules). */}
        {przycisk("agree", "Zgadzam się", "border-accent/60 bg-accent-dim text-accent-strong")}
        {przycisk("disagree", "Nie zgadzam się", "border-text/60 bg-surface-3 text-text")}
      </div>
      {blad && (
        <p role="alert" className="mt-1 text-xs text-loss">
          {blad}
        </p>
      )}
    </div>
  );
}
