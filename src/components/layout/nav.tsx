"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  FlaskConical,
  LayoutDashboard,
  Images,
  ListOrdered,
  LogOut,
  Menu,
  Plus,
  Settings,
  Target,
  X,
} from "lucide-react";

import { cx } from "@/lib/classes";

const LINKS = [
  { href: "/", label: "Pulpit", icon: LayoutDashboard },
  { href: "/trades", label: "Trade'y", icon: ListOrdered },
  { href: "/galeria", label: "Galeria", icon: Images },
  { href: "/stats", label: "Statystyki", icon: BarChart3 },
  { href: "/calendar", label: "Kalendarz", icon: CalendarDays },
  { href: "/backtest", label: "Backtesting", icon: FlaskConical },
  { href: "/strategies", label: "Strategie", icon: Target },
  { href: "/settings", label: "Ustawienia", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Links({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-sm",
              "transition-colors duration-150",
              active
                ? "bg-surface-3 font-medium text-text"
                : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <Icon size={16} className={active ? "text-accent" : "text-faint"} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Footer({ signOutAction }: { signOutAction: () => Promise<void> }) {
  return (
    <form action={signOutAction} className="mt-auto pt-4">
      <button
        type="submit"
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-sm text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text"
      >
        <LogOut size={16} aria-hidden />
        Wyloguj
      </button>
    </form>
  );
}

export function Sidebar({ signOutAction }: { signOutAction: () => Promise<void> }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
      <Link href="/" className="mb-6 block px-2.5">
        <span className="etykieta">Dziennik</span>
        <span className="block text-base font-semibold tracking-tight text-text">
          Trading Journal
        </span>
      </Link>

      <Link
        href="/trades/new"
        className="mb-4 flex h-9 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent px-3 text-sm font-semibold text-bg transition-colors duration-150 hover:bg-accent-strong"
      >
        <Plus size={16} aria-hidden />
        Nowy trade
      </Link>

      <Links />
      <Footer signOutAction={signOutAction} />
    </aside>
  );
}

export function MobileBar({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Otwórz menu"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-surface-2 hover:text-text"
        >
          <Menu size={18} aria-hidden />
        </button>
        <Link href="/" className="text-sm font-semibold text-text">
          Trading Journal
        </Link>
        <Link
          href="/trades/new"
          aria-label="Nowy trade"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] bg-accent text-bg"
        >
          <Plus size={18} aria-hidden />
        </Link>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Zamknij menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex h-full w-64 flex-col border-r border-line bg-surface px-3 py-4">
            <div className="mb-6 flex items-center justify-between px-2.5">
              <span className="text-base font-semibold text-text">Trading Journal</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Zamknij menu"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-surface-2"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <Links onNavigate={() => setOpen(false)} />
            <Footer signOutAction={signOutAction} />
          </div>
        </div>
      )}
    </>
  );
}
