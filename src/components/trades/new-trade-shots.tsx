"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Trash2 } from "lucide-react";

import { ErrorMessage } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import {
  BAZA_WYSOKOSCI_WIERSZA,
  PROPORCJA_DOMYSLNA,
  bazaKafla,
  proporcja,
  wzrostKafla,
} from "@/lib/domain/galeria";
import { INTERWALY } from "@/lib/domain/interwaly";
import { bladLimitu, MAX_ZRZUTOW } from "@/lib/screenshots-limit";

/**
 * Zrzuty przy nowym trade'cie. Wpis nie ma jeszcze identyfikatora, wiec pliki
 * musza polecic tym samym multipartem co reszta formularza - trzymamy je w
 * stanie i przepisujemy do ukrytego pola przez `DataTransfer`.
 *
 * Podglad idzie z `URL.createObjectURL`, bo na dysku serwera tych plikow
 * jeszcze nie ma. Tu, w przeciwienstwie do juz zapisanych zrzutow, wymiary
 * obrazu nie sa jeszcze znane w momencie renderu (plik lokalny, przed
 * uploadem) - proporcja startuje z `PROPORCJA_DOMYSLNA` i doklada sie w
 * `onLoad` obrazu z `img.naturalWidth/naturalHeight`, jedno przerysowanie po
 * zaladowaniu kazdego pliku.
 *
 * Interwal (ADR-015) jest tu wybierany per plik, nie jedna wartoscia dla
 * calej paczki jak w `ScreenshotUploader` - w podgladzie widac wszystkie
 * miniatury naraz, wiec tutaj (w przeciwienstwie do dogrywania do istniejacego
 * wpisu) uzytkownik moze naraz wgrywac zrzuty z roznych interwalow. Wartosci
 * ida w polu rownoleglym "shotint" (jeden `<select name="shotint">` na kazda
 * pozycje, w tej samej kolejnosci co pliki) - serwer paruje je po indeksie
 * funkcja `sparujZInterwalami`.
 */

type Pozycja = { file: File; podglad: string; proporcja: number; interval: string };

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
    setPliki((p) => [
      ...p,
      ...obrazy.map((f) => ({
        file: f,
        podglad: URL.createObjectURL(f),
        proporcja: PROPORCJA_DOMYSLNA,
        interval: "",
      })),
    ]);
  }

  function usun(i: number) {
    setPliki((p) => {
      URL.revokeObjectURL(p[i].podglad);
      return p.filter((_, j) => j !== i);
    });
  }

  // Dopasowanie po referencji obiektu (nie po indeksie): indeks przesuwa sie
  // przy kasowaniu, a referencja pozycji zostaje stabilna przez caly czas
  // zycia pliku w stanie.
  function naZaladowane(pozycja: Pozycja, szer: number, wys: number) {
    setPliki((p) =>
      p.map((x) => (x === pozycja ? { ...x, proporcja: proporcja(szer, wys) } : x)),
    );
  }

  function zmienInterval(pozycja: Pozycja, interval: string) {
    setPliki((p) => p.map((x) => (x === pozycja ? { ...x, interval } : x)));
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
        <NowaGaleria
          pliki={pliki}
          onUsun={usun}
          onZaladowane={naZaladowane}
          onZmienInterval={zmienInterval}
        />
      )}
    </div>
  );
}

/**
 * Jedno drzewo DOM (`flex flex-wrap`) - patrz komentarz w `ScreenshotGrid`,
 * ten sam uklad justowany. Zawijanie do kolejnych wierszy na waskim ekranie
 * robi CSS na podstawie szerokosci kontenera, bez osobnego wariantu ukladu w
 * JS/DOM.
 */
const LICZBA_WYPELNIACZY = 6;

function NowaGaleria({
  pliki,
  onUsun,
  onZaladowane,
  onZmienInterval,
}: {
  pliki: Pozycja[];
  onUsun: (i: number) => void;
  onZaladowane: (pozycja: Pozycja, szer: number, wys: number) => void;
  onZmienInterval: (pozycja: Pozycja, interval: string) => void;
}) {
  const proporcje = pliki.map((p) => p.proporcja);

  return (
    <div className="flex flex-wrap gap-2">
      {pliki.map((p, i) => (
        <figure
          key={`${p.file.name}-${p.file.lastModified}-${i}`}
          style={{
            flexGrow: wzrostKafla(i, proporcje),
            flexBasis: `${bazaKafla(i, proporcje, BAZA_WYSOKOSCI_WIERSZA)}rem`,
            aspectRatio: proporcje[i],
          }}
          className="relative min-w-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.podglad}
            alt={`Zrzut ${i + 1} do wgrania`}
            onLoad={(e) => {
              const img = e.currentTarget;
              onZaladowane(p, img.naturalWidth, img.naturalHeight);
            }}
            className="block h-full w-full object-contain rounded-[var(--radius-control)] border border-line"
          />
          {/* Interwal per plik, nie jedna wartosc dla calej paczki - ADR-015.
              Tlo w pelni kryjace (bez kanalu alfa), zeby etykieta zostala
              czytelna na kazdym, nawet jasnym fragmencie zrzutu. */}
          <select
            name="shotint"
            value={p.interval}
            onChange={(e) => onZmienInterval(p, e.target.value)}
            aria-label={`Interwał zrzutu ${i + 1}`}
            className="absolute bottom-2 left-2 cursor-pointer rounded-[var(--radius-control)] border border-line-strong bg-bg px-1.5 py-0.5 text-xs font-medium text-text"
          >
            <option value="">interwał —</option>
            {INTERWALY.map((iw) => (
              <option key={iw} value={iw}>
                {iw}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onUsun(i)}
            aria-label={`Usuń zrzut ${i + 1} z listy`}
            className="absolute top-2 right-2 rounded-[var(--radius-control)] border border-line-strong bg-bg/80 p-1.5 text-faint transition-colors duration-150 hover:text-loss"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </figure>
      ))}
      {Array.from({ length: LICZBA_WYPELNIACZY }, (_, i) => (
        <span
          key={i}
          aria-hidden
          style={{ flexGrow: 999, flexBasis: `${BAZA_WYSOKOSCI_WIERSZA}rem`, height: 0 }}
        />
      ))}
    </div>
  );
}
