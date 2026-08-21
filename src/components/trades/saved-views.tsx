"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bookmark, Trash2 } from "lucide-react";

import { Button, ErrorMessage, Input } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { deleteView, saveView } from "@/lib/actions/journal";
import type { ActionState } from "@/lib/actions/settings";

/**
 * Zapisane widoki tabeli. Widok to po prostu zapamietane parametry adresu,
 * wiec zapis i przywrocenie nie wymagaja zadnej dodatkowej logiki.
 */
export function SavedViews({
  views,
}: {
  views: { id: number; name: string; filters: Record<string, string> }[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [state, formAction] = useActionState<ActionState, FormData>(saveView, {});
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentQuery = params.toString();

  const linkFor = (filters: Record<string, string>) => {
    const next = new URLSearchParams(filters);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const isActive = (filters: Record<string, string>) =>
    new URLSearchParams(filters).toString() === currentQuery;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
      <span className="etykieta">Widoki</span>

      {views.length === 0 && (
        <span className="text-xs text-faint">
          Ustaw filtry i zapisz je jako widok, żeby wracać do nich jednym kliknięciem.
        </span>
      )}

      {views.map((v) => (
        <span key={v.id} className="inline-flex items-center">
          <Link
            href={linkFor(v.filters)}
            className={cx(
              "rounded-l-[var(--radius-control)] border py-1 pl-2 pr-1.5 text-xs transition-colors duration-150",
              isActive(v.filters)
                ? "border-accent bg-accent-dim text-accent"
                : "border-line-strong bg-surface-2 text-muted hover:border-faint hover:text-text",
            )}
          >
            {v.name}
          </Link>
          <button
            type="button"
            disabled={pending}
            aria-label={`Usuń widok ${v.name}`}
            onClick={() => {
              if (!window.confirm(`Usunąć widok „${v.name}"?`)) return;
              startTransition(async () => {
                await deleteView(v.id);
              });
            }}
            className="rounded-r-[var(--radius-control)] border border-l-0 border-line-strong bg-surface-2 px-1.5 py-1 text-faint transition-colors duration-150 hover:text-loss"
          >
            <Trash2 size={11} aria-hidden />
          </button>
        </span>
      ))}

      {open ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="query" value={currentQuery} />
          <Input
            name="name"
            required
            autoFocus
            placeholder="nazwa widoku"
            aria-label="Nazwa widoku"
            className="h-7 w-40 py-1 text-xs"
          />
          <Button type="submit" size="s" variant="primary">
            Zapisz
          </Button>
          <Button type="button" size="s" variant="quiet" onClick={() => setOpen(false)}>
            Anuluj
          </Button>
          {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
        </form>
      ) : (
        <Button size="s" variant="quiet" onClick={() => setOpen(true)} disabled={!currentQuery}>
          <Bookmark size={12} aria-hidden />
          Zapisz obecny widok
        </Button>
      )}
    </div>
  );
}
