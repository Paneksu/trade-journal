import Link from "next/link";

import { cx } from "@/lib/classes";

/* Zakładki sekcji Prop (wzór 7a): wspólne dla /prop i /prop/polaczenia. */

const ZAKLADKI = [
  { klucz: "konta", e: "Konta", href: "/prop" },
  { klucz: "presety", e: "Presety firm", href: "/prop?widok=presety" },
  { klucz: "ksiega", e: "Księga kosztów", href: "/prop?widok=ksiega" },
  { klucz: "polaczenia", e: "Połączenia", href: "/prop/polaczenia" },
] as const;

export function ZakladkiProp({ aktywna }: { aktywna: string }) {
  return (
    <nav aria-label="Widoki prop" className="mt-5 flex gap-6 overflow-x-auto border-b border-line">
      {ZAKLADKI.map((z) => (
        <Link
          key={z.klucz}
          href={z.href}
          aria-current={aktywna === z.klucz ? "page" : undefined}
          className={cx(
            "przejscie -mb-px border-b-2 py-2.5 text-karta whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2",
            aktywna === z.klucz ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {z.e}
        </Link>
      ))}
    </nav>
  );
}
