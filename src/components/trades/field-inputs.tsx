"use client";

import { Input, Label, Select, Textarea } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import type { FieldDef } from "@/lib/fields/fields";

/**
 * Pola wlasne w formularzu. Kazdy typ ma swoja kontrolke, a nazwy pol
 * ida do serwera jako `field__<klucz>`. Pole tak/nie jest lista z pusta opcja,
 * zeby "nie" dalo sie odroznic od "nie wypelniono".
 */

function Rating({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: number | null;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <label
          key={n}
          className="cursor-pointer"
          title={`${n} z 5`}
        >
          <input
            type="radio"
            name={name}
            value={n}
            defaultChecked={defaultValue === n}
            className="peer sr-only"
          />
          <span
            className={cx(
              "flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)]",
              "border border-line-strong bg-surface-2 text-sm text-muted",
              "transition-colors duration-150 hover:border-faint",
              "peer-checked:border-accent peer-checked:bg-accent-dim peer-checked:text-accent",
              "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
            )}
          >
            {n}
          </span>
        </label>
      ))}
    </div>
  );
}

export function FieldInputs({
  fields,
  values,
  errors,
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  errors?: Record<string, string>;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const name = `field__${f.key}`;
        const value = values[f.key];
        const error = errors?.[f.key];

        return (
          <div key={f.key} className={cx("space-y-1.5", f.type === "text" && "sm:col-span-2")}>
            <Label htmlFor={name} required={f.required} hint={f.hint ?? undefined}>
              {f.label}
            </Label>

            {f.type === "select" && (
              <Select id={name} name={name} defaultValue={(value as string) ?? ""}>
                <option value="">— nie wybrano —</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value}
                  </option>
                ))}
              </Select>
            )}

            {f.type === "multiselect" && (
              <div className="flex flex-wrap gap-1.5">
                {f.options.map((o) => {
                  const checked = Array.isArray(value) && value.includes(o.value);
                  return (
                    <label key={o.value} className="cursor-pointer">
                      <input
                        type="checkbox"
                        name={name}
                        value={o.value}
                        defaultChecked={checked}
                        className="peer sr-only"
                      />
                      <span
                        className={cx(
                          "inline-flex items-center rounded-[var(--radius-control)] border",
                          "border-line-strong bg-surface-2 px-2 py-1 text-xs text-muted",
                          "transition-colors duration-150 hover:border-faint",
                          "peer-checked:border-accent peer-checked:bg-accent-dim peer-checked:text-accent",
                          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
                        )}
                      >
                        {o.value}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {f.type === "bool" && (
              <Select
                id={name}
                name={name}
                defaultValue={value === true ? "true" : value === false ? "false" : ""}
              >
                <option value="">— nie wypełniono —</option>
                <option value="true">tak</option>
                <option value="false">nie</option>
              </Select>
            )}

            {f.type === "rating" && (
              <Rating name={name} defaultValue={typeof value === "number" ? value : null} />
            )}

            {f.type === "number" && (
              <Input
                id={name}
                name={name}
                type="number"
                step="any"
                min={f.min ?? undefined}
                max={f.max ?? undefined}
                defaultValue={(value as number) ?? ""}
                aria-invalid={error ? true : undefined}
              />
            )}

            {f.type === "date" && (
              <Input
                id={name}
                name={name}
                type="date"
                defaultValue={(value as string) ?? ""}
                aria-invalid={error ? true : undefined}
              />
            )}

            {f.type === "text" && (
              <Textarea
                id={name}
                name={name}
                rows={2}
                defaultValue={(value as string) ?? ""}
                aria-invalid={error ? true : undefined}
              />
            )}

            {error && <p className="text-xs text-loss">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
