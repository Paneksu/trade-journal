"use client";

import { cx } from "@/lib/classes";
import { INTERWALY } from "@/lib/domain/interwaly";
import type { TagWithCategory } from "@/lib/queries/dictionaries";

/**
 * Wybor tagow pogrupowany kategoriami. Zwykle checkboxy - dziala bez
 * JavaScriptu i obsluguje sie klawiatura tak samo jak reszta formularza.
 *
 * Interwal jest atrybutem przypisania, nie tagu (ADR-013): kazdy checkbox
 * ma obok ukryty `<select name="tagint:<id>">`, ktory pokazuje sie czystym
 * CSS-em przez `peer-checked:` w momencie zaznaczenia tagu. `peer-*` dziala
 * tylko na PoZNIEJSZE rodzenstwo tego samego rodzica, wiec kolejnosc w DOM
 * (input.peer -> chip -> select) jest tu wymuszona, nie kosmetyczna.
 */
export function TagPicker({
  tags,
  selected,
  name = "tag",
}: {
  tags: TagWithCategory[];
  selected: { id: number; interval: string | null }[];
  name?: string;
}) {
  const selectedIds = selected.map((s) => s.id);
  const active = tags.filter((t) => !t.archived || selectedIds.includes(t.id));
  if (active.length === 0) {
    return (
      <p className="text-xs text-faint">
        Nie masz jeszcze żadnych tagów. Dodaj je poniżej albo w ustawieniach.
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
              .map((t) => {
                const wybor = selected.find((s) => s.id === t.id);
                return (
                  <label key={t.id} className="cursor-pointer">
                    <input
                      type="checkbox"
                      name={name}
                      value={t.id}
                      defaultChecked={selectedIds.includes(t.id)}
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
                    <select
                      name={`tagint:${t.id}`}
                      defaultValue={wybor?.interval ?? ""}
                      aria-label={`Interwał dla tagu ${t.name}`}
                      // Klik w select nie ma zaznaczac/odznaczac chipu obok -
                      // to osobna kontrolka, mimo ze siedzi w tym samym <label>.
                      onClick={(e) => e.stopPropagation()}
                      className={cx(
                        "ml-1 hidden h-6 rounded border border-line-strong bg-surface-2",
                        "px-1 text-xs text-text peer-checked:inline-block",
                      )}
                    >
                      <option value="">interwał —</option>
                      {INTERWALY.map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
