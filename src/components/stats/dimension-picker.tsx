"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cx } from "@/lib/classes";

/** Wybor wymiaru rozbicia. Kazdy wybor to osobny adres, wiec da sie go zapisac. */
export function DimensionPicker({
  options,
  active,
}: {
  options: { key: string; label: string }[];
  active: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("wymiar", key);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
      {options.map((o) => (
        <Link
          key={o.key}
          href={href(o.key)}
          aria-current={o.key === active ? "true" : undefined}
          className={cx(
            "rounded-[var(--radius-control)] border px-2.5 py-1 text-xs transition-colors duration-150",
            o.key === active
              ? "border-accent bg-accent-dim text-accent"
              : "border-line-strong bg-surface-2 text-muted hover:border-faint hover:text-text",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
