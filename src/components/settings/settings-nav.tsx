"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/classes";

const LINKS = [
  { href: "/settings", label: "Ogólne" },
  { href: "/settings/accounts", label: "Konta" },
  { href: "/settings/instruments", label: "Instrumenty" },
  { href: "/settings/tags", label: "Tagi" },
  { href: "/settings/fields", label: "Pola własne" },
  { href: "/settings/data", label: "Dane i kopia" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1.5">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-[var(--radius-control)] border px-3 py-1.5 text-sm transition-colors duration-150",
              active
                ? "border-accent bg-accent-dim text-accent"
                : "border-line-strong bg-surface-2 text-muted hover:border-faint hover:text-text",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
