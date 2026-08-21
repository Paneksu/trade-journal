"use client";

import { cx } from "@/lib/classes";
import type { TagWithCategory } from "@/lib/queries/dictionaries";

/**
 * Wybor tagow pogrupowany kategoriami. Zwykle checkboxy - dziala bez
 * JavaScriptu i obsluguje sie klawiatura tak samo jak reszta formularza.
 */
export function TagPicker({
  tags,
  selected,
  name = "tag",
}: {
  tags: TagWithCategory[];
  selected: number[];
  name?: string;
}) {
  const active = tags.filter((t) => !t.archived || selected.includes(t.id));
  if (active.length === 0) {
    return (
      <p className="text-xs text-faint">
        Nie masz jeszcze żadnych tagów. Dodaj je w ustawieniach.
      </p>
    );
  }

  const categories = [...new Set(active.map((t) => t.category))];

  return (
    <div className="space-y-3">
      {categories.map((category) => (
        <div key={category}>
          <p className="etykieta mb-1.5">{category}</p>
          <div className="flex flex-wrap gap-1.5">
            {active
              .filter((t) => t.category === category)
              .map((t) => (
                <label key={t.id} className="cursor-pointer">
                  <input
                    type="checkbox"
                    name={name}
                    value={t.id}
                    defaultChecked={selected.includes(t.id)}
                    className="peer sr-only"
                  />
                  <span
                    className={cx(
                      "inline-flex items-center rounded-[var(--radius-control)] border",
                      "border-line-strong bg-surface-2 px-2 py-1 text-xs text-muted",
                      "transition-colors duration-150 hover:border-faint",
                      "peer-checked:border-accent peer-checked:bg-surface-3 peer-checked:text-text",
                      "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
                    )}
                  >
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: t.color }}
                      aria-hidden
                    />
                    {t.name}
                  </span>
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
