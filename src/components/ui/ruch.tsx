"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ZdarzeniePalca, type ReactNode } from "react";

import { cx } from "@/lib/classes";

/*
 * Ruch UI v2 (faza 2d). Wzór (Mercury, pomiar 16.10.2026) nie animuje wejścia treści, więc ruch jest tu odpowiedzią na
 * działanie człowieka: zmiana zakładki, pozycji kolejki, zakresu. Sam opacity, 160 ms (token --czas-tresc), bez przesunięć
 * i bez zmiany układu (CLS = 0).
 *
 * Zasada wyniku ukrytego do zamknięcia: ten ruch nigdy nie przechodzi „z wartości do wartości”. Nowa treść pojawia się
 * od przezroczystości, a stara znika razem z węzłem DOM, więc nic nie ma pośredniej, odsłoniętej klatki.
 */

/*
 * Next montuje stronę od nowa przy każdej zmianie parametrów adresu (klucz segmentu zawiera searchParams), więc samo
 * „komponent się zamontował” nie odróżnia przejścia na inny ekran od zmiany zakładki, zakresu albo pozycji kolejki.
 * Rozróżnia to stan modułu (żyje przez całą sesję w przeglądarce, na serwerze nie jest zapisywany):
 *  - poHydratacji: true po pierwszej hydratacji, czyli instancje tworzone później pochodzą z nawigacji w aplikacji;
 *  - ostatniaSciezka: ekran, który ostatnio pokazał treść (null po szkielecie ładowania).
 */
let poHydratacji = false;
let ostatniaSciezka: string | null = null;

/**
 * Wrapper strony: na inny ekran (albo po szkielecie ładowania) treść wchodzi od przezroczystości 160 ms; pełne ładowanie
 * strony i zmiana parametrów na tym samym ekranie bez ruchu całej strony (tam robi to `Wejscie` w miejscu zmiany).
 * `suppressHydrationWarning`: instancja z wstrzymanego (streamowanego) fragmentu może po hydratacji mieć inną klasę
 * niż HTML z serwera, a wtedy zostaje wariant serwera (bez ruchu).
 */
export function PrzejscieStrony({ className, children }: { className?: string; children: ReactNode }) {
  const sciezka = usePathname();
  const [animuj] = useState(() => poHydratacji && ostatniaSciezka !== sciezka);
  useEffect(() => {
    poHydratacji = true;
    ostatniaSciezka = sciezka;
  }, [sciezka]);
  return (
    <div className={cx(className, animuj && "tj-strona-wejscie")} suppressHydrationWarning>
      {children}
    </div>
  );
}

/** Szkielet ładowania zeruje „ostatni ekran”: treść, która go zastąpi, zawsze wejdzie od przezroczystości. */
export function ZnacznikLadowania() {
  useEffect(() => {
    ostatniaSciezka = null;
  }, []);
  return null;
}

type Znacznik = "div" | "section" | "p" | "span";

/**
 * Wejście zmienionej treści w miejscu: sam opacity 160 ms. Animuje, gdy (a) zmienił się `klucz` w żywym komponencie albo
 * (b) komponent zamontował się od nowa na tym samym ekranie (zmiana parametru adresu: zakładka, zakres, pozycja kolejki).
 * Pierwsze ładowanie i przejście na inny ekran bez ruchu tutaj (to robi `PrzejscieStrony`).
 */
export function Wejscie({
  klucz,
  children,
  className,
  as: Tag = "div",
}: {
  klucz: string | number;
  children: ReactNode;
  className?: string;
  as?: Znacznik;
}) {
  const sciezka = usePathname();
  const [naMontowaniu] = useState(() => poHydratacji && ostatniaSciezka === sciezka);
  const [poprzedni, setPoprzedni] = useState(klucz);
  const [licznik, setLicznik] = useState(0);
  if (poprzedni !== klucz) {
    setPoprzedni(klucz);
    setLicznik((l) => l + 1);
  }
  return (
    <Tag key={licznik} className={cx(className, (naMontowaniu || licznik > 0) && "tj-tresc-wejscie")}>
      {children}
    </Tag>
  );
}

/**
 * Gest zamknięcia arkusza od dołu (telefon): pociągnięcie uchwytu w dół przesuwa arkusz (`--przeciagniecie`),
 * puszczenie po ponad 96 px albo szybkim ruchem zamyka (animacja wyjścia startuje od miejsca puszczenia),
 * w przeciwnym razie arkusz wraca na miejsce (transition transform, token --czas-warstwa).
 * Uchwyt dostaje `touch-none`; treść arkusza przewija się normalnie, bo gest działa tylko na uchwycie.
 */
export function useGestArkusza(zamknij: () => void) {
  const arkusz = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; t: number } | null>(null);

  const ustaw = (px: number) => arkusz.current?.style.setProperty("--przeciagniecie", `${px}px`);
  const wroc = () => {
    arkusz.current?.setAttribute("data-wraca", "true");
    ustaw(0);
  };

  const uchwyt = {
    onPointerDown(e: ZdarzeniePalca<HTMLElement>) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      start.current = { y: e.clientY, t: performance.now() };
      arkusz.current?.removeAttribute("data-wraca");
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: ZdarzeniePalca<HTMLElement>) {
      if (start.current) ustaw(Math.max(0, e.clientY - start.current.y));
    },
    onPointerUp(e: ZdarzeniePalca<HTMLElement>) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dy = Math.max(0, e.clientY - s.y);
      const predkosc = dy / Math.max(1, performance.now() - s.t);
      if (dy > 96 || (dy > 24 && predkosc > 0.6)) zamknij();
      else wroc();
    },
    onPointerCancel() {
      start.current = null;
      wroc();
    },
  };

  return { arkusz, uchwyt };
}
