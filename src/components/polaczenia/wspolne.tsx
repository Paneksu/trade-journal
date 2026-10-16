"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cx } from "@/lib/classes";
import { dateTime, money } from "@/lib/format";

/* Wspólne kawałki ekranów danych brokera (Połączenia, Dziś): przyciski z celem dotyku 44 px na telefonie, modal, kontekst
   „preferowane konto dziennika” z kreatora do ręcznego importu, formatowanie. Kolory zysk/strata tylko dla kwot wyniku. */

const BAZA =
  "przejscie inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-center text-karta sm:min-h-8 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

export function klasaPrzycisku(glowna = false): string {
  return cx(BAZA, glowna ? "bg-accent font-medium text-bg hover:bg-accent-strong active:bg-accent" : "bg-surface-3 text-text hover:bg-line-strong active:bg-surface-2");
}

export const POLE_KLASA =
  "przejscie w-full rounded-[var(--radius-tab)] border border-line-strong bg-surface-2 px-3 py-2 text-karta text-text min-h-11 sm:min-h-10 " +
  "placeholder:text-faint hover:border-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60";

export const czas = (iso: string | null | undefined, strefa = "Europe/Warsaw"): string => (iso ? dateTime(iso, strefa) : "brak");
export const kwota = (c: number | null | undefined): string => (c === null || c === undefined ? "brak" : money(c, { sign: true }));

export const NAZWY_FORMATOW: Record<string, string> = {
  tradovate_orders: "Tradovate: Orders",
  tradovate_cash_history: "Tradovate: Cash History",
};
export const nazwaFormatu = (f: string): string => NAZWY_FORMATOW[f] ?? f;

export const ZRODLO_IMPORTU: Record<string, string> = { ui: "ręcznie", tj_watch: "automat", oauth: "OAuth" };
export const RODZAJ_DOPASOWANIA: Record<string, string> = { auto: "automat", user: "ręcznie", ai_accepted: "z sugestii AI", created: "utworzony" };

/** Obszar komunikatu czytanego przez czytnik ekranu po akcji. */
export function Zywy({ children, blad = false }: { children?: ReactNode; blad?: boolean }) {
  return (
    <div role={blad ? "alert" : "status"} aria-live={blad ? "assertive" : "polite"} className={cx(children ? "text-meta" : "sr-only", blad ? "text-loss" : "text-muted")}>
      {children}
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  tytul,
  opis,
  children,
  testid,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tytul: string;
  opis?: string;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="tj-tlo fixed inset-0 z-[var(--z-modal)] bg-bg/70 backdrop-blur-[2px]" />
        <Dialog.Content
          data-testid={testid}
          aria-describedby={opis ? undefined : undefined}
          className="tj-paleta karta fixed top-[5dvh] left-1/2 z-[var(--z-modal)] flex max-h-[90dvh] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong shadow-[var(--shadow-pop)]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-sekcja font-medium text-text">{tytul}</Dialog.Title>
              {opis ? <Dialog.Description className="mt-1 text-meta text-muted">{opis}</Dialog.Description> : null}
            </div>
            <Dialog.Close aria-label="Zamknij" className="przejscie flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-3 text-muted hover:text-text sm:size-9">
              <X size={16} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* Konto dziennika wskazane w kreatorze: ręczny import podpowiada je przy nowym koncie u brokera. */
type Kontekst = { preferowane: number | null; ustaw: (id: number | null) => void };
const Ctx = createContext<Kontekst>({ preferowane: null, ustaw: () => {} });
export const usePreferowaneKonto = (): Kontekst => useContext(Ctx);

export function PolaczeniaProvider({ children }: { children: ReactNode }) {
  const [preferowane, ustaw] = useState<number | null>(null);
  return <Ctx.Provider value={{ preferowane, ustaw }}>{children}</Ctx.Provider>;
}

export type KontoDziennika = { id: number; name: string; type: string; propPhase: string | null; maReguly: boolean; brokerAccountId: number | null };
