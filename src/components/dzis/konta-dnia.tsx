"use client";

import { useState, useTransition } from "react";

import { ustawKontaDniaAkcja } from "@/lib/actions/broker";
import { cx } from "@/lib/classes";
import type { KontoDnia } from "@/lib/queries/broker";
import { klasaPrzycisku, Zywy } from "@/components/polaczenia/wspolne";

/*
 * Aktywne konta dnia (wielokrotne, Słowa użytkownika 16.10.2026: «Kilka naraz»). AI bierze z tego konto, firmę, fazę i stawkę
 * dla trade'ów z notatki. Zapis od razu po kliknięciu; „Jak wczoraj” ustawia konta z ostatniego dnia z wyborem.
 */
export function KontaDnia({ dzien, konta, wczoraj }: { dzien: string; konta: KontoDnia[]; wczoraj: number[] }) {
  const [wybrane, setWybrane] = useState<number[]>(konta.filter((k) => k.wybrane).map((k) => k.id));
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);

  const zapisz = (nowe: number[], poprzednie: number[]) => {
    setWybrane(nowe);
    start(async () => {
      const r = await ustawKontaDniaAkcja(dzien, nowe);
      if (r.error) {
        setWybrane(poprzednie);
        setInfo({ tekst: r.error, blad: true });
      } else setInfo({ tekst: r.komunikat ?? "Zapisano.", blad: false });
    });
  };
  const przelacz = (id: number) => {
    if (trwa) return;
    zapisz(wybrane.includes(id) ? wybrane.filter((x) => x !== id) : [...wybrane, id], wybrane);
  };

  return (
    <div className="mb-5 space-y-2" data-testid="konta-dnia">
      <p className="text-karta text-text" id="konta-dnia-etykieta">Konta dnia</p>
      <p className="text-meta text-muted">Zaznacz konta, na których dziś handlujesz. AI weźmie z tego konto, firmę, fazę i stawkę opłat dla trade&apos;ów z notatki.</p>
      {konta.length === 0 ? (
        <p className="text-meta text-muted">Brak aktywnych kont. Dodaj konto w ustawieniach.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="konta-dnia-etykieta">
          {konta.map((k) => {
            const jest = wybrane.includes(k.id);
            return (
              <button
                key={k.id}
                type="button"
                aria-pressed={jest}
                data-testid={`konta-dnia-chip-${k.id}`}
                onClick={() => przelacz(k.id)}
                className={cx(
                  "przejscie inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-karta focus-visible:outline-2 focus-visible:outline-offset-2 sm:min-h-8",
                  jest ? "border-accent bg-accent-dim text-accent-strong" : "border-line-strong text-muted hover:text-text",
                )}
              >
                {k.name}
              </button>
            );
          })}
          <button type="button" data-testid="konta-dnia-jak-wczoraj" className={klasaPrzycisku(false)} disabled={trwa || wczoraj.length === 0} onClick={() => zapisz(wczoraj, wybrane)}>
            Jak wczoraj
          </button>
        </div>
      )}
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
    </div>
  );
}
