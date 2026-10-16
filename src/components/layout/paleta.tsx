"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { CornerDownLeft, FileText, ListOrdered, Quote, Search, X, type LucideIcon } from "lucide-react";

import { cx } from "@/lib/classes";
import { plural } from "@/lib/format";
import { szukajWPalecie, type WynikPalety } from "@/lib/actions/szukaj";

import { NAWIGACJA, USTAWIENIA } from "./nawigacja";

/**
 * Paleta Ctrl+K (wzór 13: runey.app, Refero 237a7449). Modal ok. 560 px nad przyciemnionym tłem,
 * pole szukania, grupy wyników z licznikiem, wiersz z ikoną, tytułem i ścieżką, stopka ze skrótami.
 * Marka: zaznaczony wiersz tłem surface-3, skróty w Plex Mono.
 *
 * Otwieranie: Ctrl+K / ⌘K albo zdarzenie `tj:paleta` (przyciski w nagłówku).
 */

export const ZDARZENIE_PALETY = "tj:paleta";

type Pozycja = {
  klucz: string;
  grupa: string;
  tytul: string;
  sciezka: string;
  href: string | null;
  ikona: LucideIcon;
};

const IKONY: Record<WynikPalety["typ"], LucideIcon> = {
  trade: ListOrdered,
  notatka: FileText,
  slowa: Quote,
};

const GRUPY: Record<WynikPalety["typ"], string> = {
  trade: "Trade'y",
  notatka: "Notatki",
  slowa: "Twoje słowa",
};

const EKRANY: Pozycja[] = [...NAWIGACJA.flatMap((g) => g.pozycje), USTAWIENIA]
  .filter((p) => p.href !== null)
  .map((p) => ({ klucz: `e:${p.href}`, grupa: "Ekrany", tytul: p.label, sciezka: p.href!, href: p.href, ikona: p.icon }));

function bezOgonkow(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase();
}

export function Paleta() {
  const router = useRouter();
  const [otwarta, setOtwarta] = useState(false);
  const [q, setQ] = useState("");
  const [wyniki, setWyniki] = useState<WynikPalety[]>([]);
  const [zaznaczony, setZaznaczony] = useState(0);
  const [szuka, startTransition] = useTransition();
  const lista = useRef<HTMLDivElement>(null);
  const ostatnie = useRef("");

  useEffect(() => {
    function klawisz(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOtwarta((o) => !o);
      }
    }
    function zdarzenie() {
      setOtwarta(true);
    }
    window.addEventListener("keydown", klawisz);
    window.addEventListener(ZDARZENIE_PALETY, zdarzenie);
    return () => {
      window.removeEventListener("keydown", klawisz);
      window.removeEventListener(ZDARZENIE_PALETY, zdarzenie);
    };
  }, []);

  useEffect(() => {
    const zapytanie = q.trim();
    if (zapytanie.length < 2) {
      ostatnie.current = zapytanie;
      return;
    }
    const t = window.setTimeout(() => {
      ostatnie.current = zapytanie;
      startTransition(async () => {
        const w = await szukajWPalecie(zapytanie);
        if (ostatnie.current === zapytanie) setWyniki(w);
      });
    }, 180);
    return () => window.clearTimeout(t);
  }, [q]);

  const pozycje = useMemo<Pozycja[]>(() => {
    const fraza = bezOgonkow(q.trim());
    const ekrany = EKRANY.filter((e) => !fraza || bezOgonkow(e.tytul).includes(fraza));
    const znalezione: Pozycja[] =
      q.trim().length < 2
        ? []
        : wyniki.map((w) => ({
            klucz: `${w.typ}:${w.id}`,
            grupa: GRUPY[w.typ],
            tytul: w.tytul,
            sciezka: w.sciezka,
            href: w.href,
            ikona: IKONY[w.typ],
          }));
    // Kolejność grup: wyniki z danych najpierw, ekrany na końcu (przy pustym polu tylko ekrany).
    const kolejnosc = ["Trade'y", "Twoje słowa", "Notatki"];
    znalezione.sort((a, b) => kolejnosc.indexOf(a.grupa) - kolejnosc.indexOf(b.grupa));
    return [...znalezione, ...ekrany];
  }, [q, wyniki]);

  const grupy = useMemo(() => {
    const m = new Map<string, Pozycja[]>();
    for (const p of pozycje) m.set(p.grupa, [...(m.get(p.grupa) ?? []), p]);
    return [...m.entries()];
  }, [pozycje]);

  const otworz = useCallback(
    (p: Pozycja | undefined) => {
      if (!p?.href) return;
      setOtwarta(false);
      router.push(p.href);
    },
    [router],
  );

  function zmienOtwarcie(o: boolean) {
    setOtwarta(o);
    if (!o) {
      setQ("");
      setWyniki([]);
      setZaznaczony(0);
    }
  }

  function naKlawisz(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setZaznaczony((z) => Math.min(z + 1, pozycje.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setZaznaczony((z) => Math.max(z - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      otworz(pozycje[zaznaczony]);
    }
  }

  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-indeks="${zaznaczony}"]`)?.scrollIntoView({ block: "nearest" });
  }, [zaznaczony]);

  const idAktywnej = pozycje[zaznaczony] ? `paleta-opcja-${zaznaczony}` : undefined;
  let indeks = -1;

  return (
    <Dialog.Root open={otwarta} onOpenChange={zmienOtwarcie}>
      <Dialog.Portal>
        <Dialog.Overlay className="tj-tlo fixed inset-0 z-[var(--z-modal)] bg-bg/70 backdrop-blur-[2px]" />
        <Dialog.Content
          className="tj-paleta fixed top-[12vh] left-1/2 z-[var(--z-modal)] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 karta overflow-hidden rounded-[var(--radius-panel)] border border-line-strong shadow-[var(--shadow-pop)]"
          aria-describedby={undefined}
          onKeyDown={naKlawisz}
        >
          <Dialog.Title className="sr-only">Szukaj w dzienniku</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search size={18} className="shrink-0 text-faint" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setZaznaczony(0);
              }}
              placeholder="Szukaj trade'ów, notatek i swoich słów"
              aria-label="Szukaj w dzienniku"
              role="combobox"
              aria-expanded
              aria-controls="paleta-lista"
              aria-activedescendant={idAktywnej}
              className="h-14 min-w-0 flex-1 bg-transparent text-karta text-text placeholder:text-faint focus:outline-none"
            />
            <Dialog.Close
              aria-label="Zamknij szukanie"
              className="przejscie flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-muted hover:text-text"
            >
              <X size={14} aria-hidden />
            </Dialog.Close>
          </div>

          {grupy.length === 0 && (
            <p role="status" className="px-4 py-6 text-meta text-faint">
              {szuka ? "Szukam…" : `Nic nie pasuje do „${q.trim()}”.`}
            </p>
          )}
          {/* Tytuły wyników skracane wielokropkiem celowo (pełny tekst po otwarciu). */}
          <div ref={lista} id="paleta-lista" data-przyciecie-zamierzone role="listbox" aria-label="Wyniki" hidden={grupy.length === 0} className="max-h-[min(420px,60vh)] overflow-y-auto py-2">
            {grupy.map(([grupa, elementy]) => (
              <div key={grupa} role="group" aria-label={grupa} className="pb-1">
                <p role="presentation" className="px-4 pt-2 pb-1 text-grupa font-medium tracking-[0.08em] text-faint uppercase">
                  {grupa} <span className="num ml-1">{elementy.length}</span>
                </p>
                {elementy.map((p) => {
                  indeks += 1;
                  const i = indeks;
                  const Ikona = p.ikona;
                  const aktywny = i === zaznaczony;
                  return (
                    <div
                      key={p.klucz}
                      id={`paleta-opcja-${i}`}
                      data-indeks={i}
                      role="option"
                      aria-selected={aktywny}
                      aria-disabled={p.href ? undefined : true}
                      onMouseMove={() => setZaznaczony(i)}
                      onClick={() => otworz(p)}
                      className={cx(
                        "przejscie mx-2 flex items-center gap-3 rounded-[var(--radius-tab)] px-2 py-2",
                        p.href ? "cursor-pointer" : "cursor-default",
                        aktywny && "bg-surface-3",
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-tab)] bg-surface-2 text-muted">
                        <Ikona size={15} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-karta text-text">{p.tytul}</span>
                        <span className="block truncate text-meta text-muted">{p.sciezka}</span>
                      </span>
                      {aktywny && p.href && <CornerDownLeft size={14} className="shrink-0 text-faint" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-meta text-faint">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <kbd className="num rounded border border-line-strong px-1.5 text-grupa">↑</kbd>
                <kbd className="num rounded border border-line-strong px-1.5 text-grupa">↓</kbd>
                wybierz
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="num rounded border border-line-strong px-1.5 text-grupa">↵</kbd>
                otwórz
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                <kbd className="num rounded border border-line-strong px-1.5 text-grupa">esc</kbd>
                zamknij
              </span>
            </span>
            <span className="num" aria-live="polite">
              {pozycje.length} {plural(pozycje.length, "wynik", "wyniki", "wyników")}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
