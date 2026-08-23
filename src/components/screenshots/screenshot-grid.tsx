"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import {
  BAZA_WYSOKOSCI_WIERSZA,
  bazaKafla,
  proporcja,
  wzrostKafla,
} from "@/lib/domain/galeria";
import { INTERWALY } from "@/lib/domain/interwaly";
import { Lightbox } from "./lightbox";
import type { Shot } from "./typy";

/**
 * Galeria zrzutow - jedna dla karty trade'a, panelu dnia i sesji backtestu.
 * Uklad justowany (jak Google Photos): kazdy kafel dostaje wspolna bazowa
 * wysokosc wiersza przez `flex-basis`, a `flex-grow` proporcjonalny do
 * aspect ratio dobija go do naturalnej szerokosci - zero przyciecia, zero
 * pasow. Jedno drzewo DOM (`flex flex-wrap`): zawijanie do kolejnych wierszy
 * na waskim ekranie robi sam CSS na podstawie szerokosci kontenera, bez
 * osobnego wariantu ukladu w JS/DOM.
 *
 * Na miejscu lezy wylacznie miniatura; pelny plik wchodzi dopiero w
 * powiekszeniu. Przy osmiu zdjeciach roznica to kilkanascie megabajtow na
 * jedno wejscie na strone.
 *
 * Ostatni, niepelny wiersz: bez domkniecia flex-grow rozdalby jedyny kafel w
 * wierszu na cala szerokosc kontenera (kazda linia flex-wrap rozdziela
 * naddatek osobno). Zamiast liczyc to w JS (jak poprzednio przez podzial na
 * wiersze), na koncu siedzi kilka niewidocznych wypelniaczy z duzym
 * flex-grow - one przechwytuja naddatek w ktorymkolwiek wierszu akurat jest
 * niepelny, wiec prawdziwe zdjecia zawsze zostaja przy swojej naturalnej
 * szerokosci.
 */

const LICZBA_WYPELNIACZY = 6;

export function ScreenshotGrid({
  shots,
  opis,
  onUsun,
  onZmienInterval,
  className,
}: {
  shots: Shot[];
  opis: string;
  /** Podane tylko tam, gdzie zrzuty wolno kasowac. */
  onUsun?: (id: number) => Promise<void> | void;
  /** Podane tam, gdzie wolno tez poprawic interwal - te same miejsca co `onUsun`. */
  onZmienInterval?: (id: number, interval: string) => Promise<void> | void;
  className?: string;
}) {
  const [podglad, setPodglad] = useState<number | null>(null);
  if (shots.length === 0) return null;

  const proporcje = shots.map((s) => proporcja(s.width, s.height));

  return (
    <>
      <div className={className}>
        <div className="flex flex-wrap gap-2">
          {shots.map((s, i) => (
            <figure
              key={s.id}
              style={{
                flexGrow: wzrostKafla(i, proporcje),
                flexBasis: `${bazaKafla(i, proporcje, BAZA_WYSOKOSCI_WIERSZA)}rem`,
                aspectRatio: proporcje[i],
              }}
              className="relative min-w-0"
            >
              <button
                type="button"
                onClick={() => setPodglad(i)}
                aria-label={`Powiększ zrzut ${i + 1} z ${shots.length}${s.interval ? ` — interwał ${s.interval}` : ""}`}
                className="block h-full w-full cursor-zoom-in overflow-hidden rounded-[var(--radius-control)] border border-line transition-colors duration-150 hover:border-faint focus-visible:border-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/screenshots/${s.thumbnail ?? s.file}`}
                  alt={`Zrzut ${i + 1} z ${shots.length} — ${opis}`}
                  width={s.width ?? undefined}
                  height={s.height ?? undefined}
                  /* object-contain, nie fill: kafel ma juz proporcje zdjecia, ale gdy
                     wymiarow brakuje w bazie, proporcja spada na domyslne 16/9 -
                     wtedy `fill` rozciagnalby wykres, a `contain` tylko doda pasek. */
                  className="block h-full w-full object-contain"
                />
              </button>
              {onZmienInterval ? (
                <IntervalEdit
                  id={s.id}
                  interval={s.interval}
                  numer={i + 1}
                  onZmien={onZmienInterval}
                />
              ) : (
                s.interval && <IntervalBadge interval={s.interval} />
              )}
              {onUsun && <UsunZrzut id={s.id} onUsun={onUsun} />}
            </figure>
          ))}
          <Wypelniacze />
        </div>
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

/**
 * Niewidoczne elementy domykajace ostatni wiersz - patrz komentarz przy
 * `LICZBA_WYPELNIACZY` wyzej. Wysokosc zero i `aria-hidden`, wiec nie zajmuja
 * miejsca w pionie ani nie wchodza w droge czytnikowi ekranu.
 */
function Wypelniacze() {
  return Array.from({ length: LICZBA_WYPELNIACZY }, (_, i) => (
    <span
      key={i}
      aria-hidden
      style={{ flexGrow: 999, flexBasis: `${BAZA_WYSOKOSCI_WIERSZA}rem`, height: 0 }}
    />
  ));
}

/**
 * Etykieta samego interwalu - tlo w pelni kryjace (`bg-bg`), nie `/80` jak
 * przy koszu obok. Etykieta niesie informacje (ADR-015), wiec obnizanie
 * kontrastu przez polprzezroczystosc na losowym, jasnym fragmencie wykresu
 * jest dokladnie tym, co dzis oblalo audyt dostepnosci - stad zero `opacity`
 * na tekscie i tlo bez kanalu alfa.
 */
function IntervalBadge({ interval }: { interval: string }) {
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 rounded-[var(--radius-control)] border border-line-strong bg-bg px-1.5 py-0.5 text-xs font-medium text-text">
      {interval}
    </span>
  );
}

/**
 * Interwal jako `<select>` zamiast statycznej etykiety - tam, gdzie zrzut
 * wolno tez kasowac, wolno tez poprawic, po co go wgrano (ADR-015). Zapis
 * idzie od razu przy zmianie, bez osobnego przycisku "zapisz": to jedno pole,
 * a nie formularz z wieloma polami na raz.
 */
function IntervalEdit({
  id,
  interval,
  numer,
  onZmien,
}: {
  id: number;
  interval: string | null;
  numer: number;
  onZmien: (id: number, interval: string) => Promise<void> | void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={interval ?? ""}
      disabled={pending}
      aria-label={`Interwał zrzutu ${numer}`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const w = e.target.value;
        startTransition(async () => {
          await onZmien(id, w);
        });
      }}
      className="absolute bottom-2 left-2 cursor-pointer rounded-[var(--radius-control)] border border-line-strong bg-bg px-1.5 py-0.5 text-xs font-medium text-text disabled:opacity-50"
    >
      <option value="">interwał —</option>
      {INTERWALY.map((i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </select>
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
