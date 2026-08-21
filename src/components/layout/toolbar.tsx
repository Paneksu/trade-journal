"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cx } from "@/lib/classes";

/**
 * Przelaczniki, ktore zmieniaja tylko jeden parametr adresu i zostawiaja
 * reszte filtrow nietknieta. Dzieki temu kazdy stan ekranu ma wlasny link.
 */

function useHrefBuilder() {
  const pathname = usePathname();
  const params = useSearchParams();

  return (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
}

function Segment({
  options,
  active,
  paramKey,
  label,
}: {
  options: { value: string; label: string }[];
  active: string;
  paramKey: string;
  label: string;
}) {
  const href = useHrefBuilder();

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-line-strong"
    >
      {options.map((o) => {
        const selected = o.value === active;
        return (
          <Link
            key={o.value}
            href={href(paramKey, o.value)}
            aria-current={selected ? "true" : undefined}
            className={cx(
              "px-2.5 py-1.5 text-xs transition-colors duration-150",
              selected
                ? "bg-surface-3 font-medium text-text"
                : "bg-surface text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

export function DateRangeSwitch({ active }: { active: string }) {
  return (
    <Segment
      label="Zakres dat"
      paramKey="zakres"
      active={active}
      options={[
        { value: "7", label: "7 dni" },
        { value: "30", label: "30 dni" },
        { value: "90", label: "90 dni" },
        { value: "365", label: "rok" },
        { value: "wszystko", label: "wszystko" },
      ]}
    />
  );
}

export function UnitSwitch({ active }: { active: string }) {
  return (
    <Segment
      label="Jednostka wyniku"
      paramKey="jednostka"
      active={active}
      options={[
        { value: "cash", label: "gotówka" },
        { value: "r", label: "R" },
      ]}
    />
  );
}

export function SourceSwitch({ active }: { active: string }) {
  return (
    <Segment
      label="Źródło danych"
      paramKey="zrodlo"
      active={active}
      options={[
        { value: "live", label: "dziennik" },
        { value: "backtest", label: "backtest" },
        { value: "wszystko", label: "razem" },
      ]}
    />
  );
}
