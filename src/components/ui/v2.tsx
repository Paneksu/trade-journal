import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

import { cx } from "@/lib/classes";

import { PrzejscieStrony, Wejscie } from "./ruch";

/*
 * Prymitywy UI v2 (faza 5). Forma ze wzoru Mercury (pomiar.json): karta r=12, ramka 1 px, padding 24,
 * pigułka akcji 32 px (główna w akcencie, reszta neutralna), nagłówek strony 28/36, nagłówek sekcji 19/28,
 * etykieta karty 15/24. Tożsamość z marki: tokeny globals.css, liczby w Plex Mono.
 */

export function Strona({ children, className }: { children: ReactNode; className?: string }) {
  return <PrzejscieStrony className={cx("mx-auto w-full max-w-tresc", className)}>{children}</PrzejscieStrony>;
}

export function NaglowekStrony({
  tytul,
  podtytul,
  akcje,
  nad,
}: {
  tytul: ReactNode;
  podtytul?: ReactNode;
  akcje?: ReactNode;
  nad?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {nad && <div className="mb-1 text-meta text-faint">{nad}</div>}
        <h1 className="text-tytul font-medium tracking-tight text-text">{tytul}</h1>
        {podtytul && <p className="mt-1 text-meta text-muted">{podtytul}</p>}
      </div>
      {akcje && <div className="flex flex-wrap items-center gap-2">{akcje}</div>}
    </header>
  );
}

export function NaglowekSekcji({ id, children, akcje }: { id?: string; children: ReactNode; akcje?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 id={id} className="scroll-mt-20 text-sekcja font-normal text-text">
        {children}
      </h2>
      {akcje}
    </div>
  );
}

export function Karta({
  tytul,
  akcje,
  children,
  className,
  id,
  as: Tag = "section",
  labelledBy,
}: {
  tytul?: ReactNode;
  akcje?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  as?: "section" | "div" | "article";
  labelledBy?: string;
}) {
  return (
    <Tag id={id} aria-labelledby={labelledBy} className={cx("karta scroll-mt-20 p-5 sm:p-6", className)}>
      {(tytul || akcje) && (
        <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
          {tytul && <div className="min-w-0 text-karta text-text">{tytul}</div>}
          {akcje && <div className="flex shrink-0 items-center gap-1.5">{akcje}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

const PIGULKA =
  "przejscie inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-karta whitespace-nowrap " +
  "focus-visible:outline-2 focus-visible:outline-offset-2";

export function klasaPigulki(glowna = false): string {
  return cx(
    PIGULKA,
    glowna
      ? "bg-accent font-medium text-bg hover:bg-accent-strong active:bg-accent"
      : "bg-surface-3 text-text hover:bg-line-strong active:bg-surface-2",
  );
}

export function Pigulka({
  href,
  glowna,
  children,
  className,
  ...rest
}: { href: string; glowna?: boolean; children: ReactNode; className?: string } & Omit<ComponentProps<typeof Link>, "href" | "className">) {
  return (
    <Link href={href} className={cx(klasaPigulki(glowna), className)} {...rest}>
      {children}
    </Link>
  );
}

/** Liczba bohater: Plex Mono, 28/36, tracking -0.03em, ułamek mniejszy jak grosze we wzorze. */
export function LiczbaBohater({ tekst, className }: { tekst: string; className?: string }) {
  const m = /^(.*?)([.,]\d+)(\D*)$/.exec(tekst);
  return (
    // Zmiana liczby (np. po zmianie zakresu): sama przezroczystość 160 ms, bez licznika od zera.
    <Wejscie as="p" klucz={tekst} className={cx("num text-liczba font-medium text-text", className)}>
      {m ? (
        <>
          {m[1]}
          <span className="text-sekcja">{m[2]}</span>
          {m[3]}
        </>
      ) : (
        tekst
      )}
    </Wejscie>
  );
}

/** Pasek zużycia limitu (wzór: pasek salda karty kredytowej). Akcent; od 90% strata. */
export function PasekZuzycia({ zuzycie, etykieta }: { zuzycie: number; etykieta: string }) {
  const proc = Math.max(0, Math.min(1, zuzycie));
  return (
    <div
      role="meter"
      aria-label={etykieta}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(proc * 100)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
    >
      <div
        className={cx("h-full rounded-full", zuzycie >= 0.9 ? "bg-loss" : "bg-accent")}
        style={{ width: `${Math.max(proc * 100, proc > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

export function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-full border border-line-strong px-2 text-meta whitespace-nowrap text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Ocena procesu A/B/C (MUST 3): osobno od wyniku, bez zieleni i czerwieni (te są dla wyniku). */
export function ChipProcesu({ ocena }: { ocena: "A" | "B" | "C" | null }) {
  if (!ocena)
    return (
      <span title="Bez oceny procesu" className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-tab)] border border-dashed border-line text-meta text-faint">
        <span className="sr-only">proces bez oceny</span>
        <span aria-hidden>–</span>
      </span>
    );
  return (
    <span
      title={`Proces ${ocena}`}
      className={cx(
        "num inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-tab)] border text-meta font-medium",
        // Neutralnie: akcent jest tylko dla akcji i stanu aktywnego (kierunek.md, Role rules).
        ocena === "A" && "border-text/50 font-semibold text-text",
        ocena === "B" && "border-line-strong text-text",
        ocena === "C" && "border-dashed border-line-strong text-muted",
      )}
    >
      <span className="sr-only">proces </span>
      {ocena}
    </span>
  );
}

/**
 * Pusty stan UI v2 (runda r2): jedno zdanie, co tu będzie, i JEDNO działanie, które to zmienia.
 * Bez ilustracji: forma wzorów (Mercury, Linear) to tekst wyśrodkowany w ramie przerywanej.
 */
export function PustyStan({
  tytul,
  opis,
  akcja,
  className,
}: {
  tytul: string;
  opis?: ReactNode;
  akcja?: { href: string; etykieta: string };
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center gap-2 rounded-[var(--radius-panel)] border border-dashed border-line-strong px-5 py-8 text-center", className)} data-pusty-stan>
      <p className="text-karta text-text">{tytul}</p>
      {opis && <p className="max-w-md text-meta text-muted">{opis}</p>}
      {akcja && (
        <Link href={akcja.href} className={cx(klasaPigulki(false), "mt-2")}>
          {akcja.etykieta}
        </Link>
      )}
    </div>
  );
}

/** Szkielet ładowania (runda r2): szare bloki w miejscu treści zamiast pustego ekranu; pulsowanie 1000 ms linear (pomiar Mercury), wyłącza je reduced-motion. */
export function Szkielet({ className }: { className?: string }) {
  return <div aria-hidden className={cx("tj-szkielet rounded-[var(--radius-tab)] bg-surface-2", className)} />;
}
