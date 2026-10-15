"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Inbox, ListOrdered, LogOut, MoreHorizontal, Plus, Search, Sun, X } from "lucide-react";

import { cx } from "@/lib/classes";

import { czyAktywna, NAWIGACJA, USTAWIENIA, type PozycjaNawigacji } from "./nawigacja";
import { ZDARZENIE_PALETY } from "./paleta";
import { Znak } from "./znak";

/**
 * Szkielet aplikacji UI v2. Wzór: Mercury dashboard (kierunek.md, szkielet A): pasek boczny 220 px
 * o stopień ciemniejszy od tła, pozycja 30 px z tekstem 15/24, etykieta grupy 12/20, licznik jak
 * „Tasks 10”. Na telefonie dolny pasek 5 pozycji ze wzoru 14a (Revolut), bo plan fazy 5 wymaga
 * dolnej nawigacji w PWA (słowa planu > wzór Mercury z hamburgerem; ledger #6).
 */

export type LicznikiNav = { decyzje: number; rozstrzygniecia: number };

function otworzPalete() {
  window.dispatchEvent(new Event(ZDARZENIE_PALETY));
}

function aktywna(pathname: string, p: PozycjaNawigacji): boolean {
  // Galeria to widok listy trade'ów (przełącznik Lista / Galeria), więc podświetla „Trade'y”.
  if (p.href === "/trades" && pathname.startsWith("/galeria")) return true;
  return czyAktywna(pathname, p.href);
}

function Pozycja({
  p,
  pathname,
  liczba,
  onNavigate,
}: {
  p: PozycjaNawigacji;
  pathname: string;
  liczba: number;
  onNavigate?: () => void;
}) {
  const Icon = p.icon;
  const tresc = (
    <>
      <Icon size={16} aria-hidden className="shrink-0" />
      <span className="truncate">{p.label}</span>
      {p.licznik && liczba > 0 && (
        <span className="num ml-auto rounded-[5px] bg-surface-3 px-1.5 text-grupa text-text">
          <span className="sr-only">oczekuje: </span>
          {liczba}
        </span>
      )}
      {!p.href && <span className="ml-auto text-grupa text-faint">wkrótce</span>}
    </>
  );

  if (!p.href) {
    return (
      <span
        aria-disabled="true"
        title="Ekran powstaje w kolejnym etapie przebudowy"
        className="flex h-[30px] cursor-default items-center gap-2.5 rounded-[var(--radius-tab)] px-2.5 text-karta text-faint"
      >
        {tresc}
      </span>
    );
  }

  const jest = aktywna(pathname, p);
  return (
    <Link
      href={p.href}
      onClick={onNavigate}
      aria-current={jest ? "page" : undefined}
      className={cx(
        "przejscie flex h-[30px] items-center gap-2.5 rounded-[var(--radius-tab)] px-2.5 text-karta",
        jest
          ? "bg-surface-3 text-text [&>svg]:text-accent"
          : "text-muted hover:bg-surface-2 hover:text-text active:bg-surface-3",
      )}
    >
      {tresc}
    </Link>
  );
}

function Pozycje({ liczniki, onNavigate }: { liczniki: LicznikiNav; onNavigate?: () => void }) {
  const pathname = usePathname();
  const liczba = liczniki.decyzje + liczniki.rozstrzygniecia;
  return (
    <nav aria-label="Główna" className="flex flex-col gap-5">
      {NAWIGACJA.map((g, i) => (
        <div key={g.tytul ?? i} className="flex flex-col gap-0.5">
          {g.tytul && <p className="mb-1 px-2.5 text-grupa font-medium text-faint">{g.tytul}</p>}
          {g.pozycje.map((p) => (
            <Pozycja key={p.label} p={p} pathname={pathname} liczba={liczba} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function Stopka({ signOutAction, onNavigate }: { signOutAction: () => Promise<void>; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="mt-auto flex flex-col gap-0.5 pt-4">
      <Pozycja p={USTAWIENIA} pathname={pathname} liczba={0} onNavigate={onNavigate} />
      <form action={signOutAction}>
        <button
          type="submit"
          className="przejscie flex h-[30px] w-full items-center gap-2.5 rounded-[var(--radius-tab)] px-2.5 text-karta text-muted hover:bg-surface-2 hover:text-text active:bg-surface-3"
        >
          <LogOut size={16} aria-hidden />
          Wyloguj
        </button>
      </form>
    </div>
  );
}

function Marka() {
  return (
    <Link href="/" className="przejscie flex h-9 items-center gap-2.5 rounded-[var(--radius-tab)] px-2 hover:bg-surface-2">
      <Znak size={22} />
      <span className="text-karta font-semibold tracking-tight text-text">Dziennik</span>
      <span className="num ml-auto rounded-[5px] border border-line-strong px-1.5 text-grupa text-muted">NQ</span>
    </Link>
  );
}

export function Sidebar({ signOutAction, liczniki }: { signOutAction: () => Promise<void>; liczniki: LicznikiNav }) {
  return (
    <aside className="hidden w-pasek shrink-0 border-r border-line bg-sidebar lg:block">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto px-2.5 py-3">
        <Marka />
        <div className="mt-5">
          <Pozycje liczniki={liczniki} />
        </div>
        <Stopka signOutAction={signOutAction} />
      </div>
    </aside>
  );
}

/** Górny pasek treści: szukanie (wzór: „Search for anything” z ⌘K) i główna akcja („Move money”). */
export function TopBar() {
  // Skrót zależy od systemu; na serwerze nie wiemy, więc domyślnie „Ctrl K”.
  const mac = useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
  return (
    <div className="sticky top-0 z-[var(--z-przyklejone)] flex h-14 items-center gap-3 border-b border-line bg-tresc/90 px-4 backdrop-blur lg:px-6">
      <Link href="/" className="flex items-center gap-2 lg:hidden" aria-label="Dziennik, strona Dziś">
        <Znak size={22} />
        <span className="text-karta font-semibold text-text">Dziennik</span>
      </Link>
      <button
        type="button"
        onClick={otworzPalete}
        className="przejscie hidden h-9 w-full max-w-[420px] items-center gap-2.5 rounded-[var(--radius-tab)] border border-line bg-panel px-3 text-left text-karta text-faint hover:border-line-strong hover:text-muted lg:flex"
      >
        <Search size={15} aria-hidden />
        <span className="flex-1">Szukaj w dzienniku</span>
        <kbd className="num rounded border border-line-strong px-1.5 text-grupa text-muted">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={otworzPalete}
          aria-label="Szukaj w dzienniku"
          className="przejscie flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-muted hover:text-text lg:hidden"
        >
          <Search size={16} aria-hidden />
        </button>
        <Link
          href="/trades/new"
          className="przejscie hidden h-9 items-center gap-2 rounded-full border border-line-strong bg-panel px-4 text-karta text-text hover:bg-surface-2 active:bg-surface-3 lg:inline-flex"
        >
          <Plus size={15} aria-hidden />
          Nowy trade
        </Link>
      </div>
    </div>
  );
}

/** Dolny pasek na telefonie (wzór 14a): Dziś, Trade'y, + Nowy trade, Do decyzji, Więcej. */
export function MobileBar({ signOutAction, liczniki }: { signOutAction: () => Promise<void>; liczniki: LicznikiNav }) {
  const pathname = usePathname();
  const [wiecej, setWiecej] = useState(false);
  const liczba = liczniki.decyzje + liczniki.rozstrzygniecia;

  const pozycje = [
    { label: "Dziś", href: "/", icon: Sun },
    { label: "Trade'y", href: "/trades", icon: ListOrdered },
  ];

  const klasa = (jest: boolean) =>
    cx(
      "przejscie flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] leading-4 font-medium",
      jest ? "text-accent" : "text-muted hover:text-text",
    );

  return (
    <>
      <nav
        aria-label="Dolna"
        className="sticky bottom-0 z-[var(--z-przyklejone)] flex h-16 items-stretch border-t border-line bg-sidebar/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {pozycje.map((p) => {
          const jest = czyAktywna(pathname, p.href) || (p.href === "/trades" && pathname.startsWith("/galeria"));
          const Icon = p.icon;
          return (
            <Link key={p.href} href={p.href} aria-current={jest ? "page" : undefined} className={klasa(jest)}>
              <Icon size={20} aria-hidden />
              {p.label}
            </Link>
          );
        })}
        <Link href="/trades/new" className={klasa(false)} aria-label="Nowy trade">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-bg">
            <Plus size={20} aria-hidden />
          </span>
        </Link>
        <Link href="/decyzje" aria-current={czyAktywna(pathname, "/decyzje") ? "page" : undefined} className={klasa(czyAktywna(pathname, "/decyzje"))}>
          <span className="relative">
            <Inbox size={20} aria-hidden />
            {liczba > 0 && (
              <span className="num absolute -top-1.5 -right-2.5 rounded-full bg-text px-1 text-[10px] leading-4 text-bg">
                <span className="sr-only">oczekuje: </span>
                {liczba}
              </span>
            )}
          </span>
          Decyzje
        </Link>
        <button type="button" onClick={() => setWiecej(true)} className={klasa(false)} aria-haspopup="dialog">
          <MoreHorizontal size={20} aria-hidden />
          Więcej
        </button>
      </nav>

      <Dialog.Root open={wiecej} onOpenChange={setWiecej}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-bg/70 lg:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex max-h-[85vh] flex-col overflow-y-auto rounded-t-[var(--radius-panel)] border-t border-line-strong bg-sidebar px-3 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] lg:hidden"
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <Dialog.Title className="text-sekcja font-medium text-text">Menu</Dialog.Title>
              <Dialog.Close
                aria-label="Zamknij menu"
                className="przejscie flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-muted hover:text-text"
              >
                <X size={16} aria-hidden />
              </Dialog.Close>
            </div>
            <Pozycje liczniki={liczniki} onNavigate={() => setWiecej(false)} />
            <Stopka signOutAction={signOutAction} onNavigate={() => setWiecej(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
