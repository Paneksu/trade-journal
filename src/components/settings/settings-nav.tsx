"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/classes";

const LINKS = [
  { href: "/settings", label: "Ogólne" },
  { href: "/settings/security", label: "Bezpieczeństwo" },
  { href: "/settings/devices", label: "Urządzenia" },
  { href: "/settings/accounts", label: "Konta" },
  { href: "/settings/instruments", label: "Instrumenty" },
  { href: "/settings/tags", label: "Tagi" },
  { href: "/settings/fields", label: "Pola własne" },
  { href: "/settings/data", label: "Dane i kopia" },
];

/** Zakładki ustawień (wzór 12): pionowa lista jak pasek boczny, aktywna na tle o stopień jaśniejszym, bez akcentu ramki. */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sekcje ustawień">
      <ul className="flex flex-wrap gap-1 lg:flex-col lg:gap-0.5">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "przejscie flex h-8 items-center rounded-[var(--radius-tab)] px-2.5 text-karta focus-visible:outline-2 focus-visible:outline-offset-2",
                  active ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
