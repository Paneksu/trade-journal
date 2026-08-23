"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";

import { Button, ErrorMessage, Input, Label, Select } from "@/components/ui/base";
import { archiveTag, deleteTag, saveTag, saveTagCategory } from "@/lib/actions/taxonomy";
import type { ActionState } from "@/lib/actions/settings";
import type { TagWithCategory } from "@/lib/queries/dictionaries";

type CategoryOption = { id: number; name: string };

/**
 * Zarzadzanie tagami bez wychodzenia z formularza trade'a (ADR-013).
 *
 * To NIE jest <form> - zagniezdzony formularz w formularzu trade'a jest
 * nielegalny w HTML (przegladarka zamyka zewnetrzny na pierwszym </form>
 * napotkanym wewnatrz). Kazde pole jest wiec kontrolowane w zwyklym <div>,
 * przyciski maja type="button", a zapis idzie przez akcje serwerowa wolana
 * recznie zbudowanym FormData wewnatrz useTransition. `saveTag` i
 * `saveTagCategory` z lib/actions/taxonomy.ts maja juz sygnature
 * (prev, FormData), wiec ida bez adaptera.
 *
 * Te akcje robia `revalidatePath("/", "layout")`, wiec `tags`/`categories`
 * ponizej odswiezaja sie same z serwera, gdy rodzic (TradeForm) dostanie
 * nowe propy. PULAPKA: to dziala tylko dopoki TagPicker obok nie dostanie
 * `key` liczonego z listy tagow (np. dlugosci albo JSON.stringify) - taki
 * klucz remontowalby cale poddrzewo przy kazdej zmianie i kasowal zarowno
 * zaznaczenia tagow, jak i wpisane juz pola reszty formularza trade'a.
 */
export function TagManager({
  tags,
  categories,
}: {
  tags: TagWithCategory[];
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="s" onClick={() => setOpen((w) => !w)} aria-expanded={open}>
          {open ? "Zwiń zarządzanie tagami" : "Zarządzaj tagami"}
        </Button>
        {/* Droga bez JS: zarzadzanie tutaj wymaga JavaScriptu (dzis nie dzialalo
            tam wcale), wiec obok zawsze stoi link do pelnych ustawien. */}
        <Link href="/settings/tags" className="text-xs text-faint hover:text-text">
          pełne ustawienia tagów
        </Link>
      </div>

      {open && (
        <div className="space-y-3 rounded-[var(--radius-panel)] border border-line-strong bg-surface-2 p-3">
          <NewCategoryRow />

          {categories.length === 0 ? (
            <p className="text-xs text-faint">Dodaj kategorię wyżej, żeby móc dodawać tagi.</p>
          ) : (
            <NewTagRow categories={categories} />
          )}

          <div className="space-y-3">
            {categories.map((c) => {
              const inCategory = tags.filter((t) => t.categoryId === c.id);
              if (inCategory.length === 0) return null;
              return (
                <div key={c.id}>
                  <p className="mb-1 text-xs font-medium text-muted">{c.name}</p>
                  <div className="space-y-1.5">
                    {inCategory.map((t) => (
                      <TagRow key={t.id} tag={t} categories={categories} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NewCategoryRow() {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    startTransition(async () => {
      const result: ActionState = await saveTagCategory({}, fd);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setName("");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-48 space-y-1">
        <Label htmlFor="tm-new-cat">Nowa kategoria tagów</Label>
        <Input
          id="tm-new-cat"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="np. Sesja"
        />
      </div>
      <Button type="button" size="s" disabled={pending || !name.trim()} onClick={submit}>
        Dodaj kategorię
      </Button>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}

function NewTagRow({ categories }: { categories: CategoryOption[] }) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 0);
  const [color, setColor] = useState("#8fa3b8");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!name.trim() || !categoryId) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("categoryId", String(categoryId));
    fd.set("color", color);
    startTransition(async () => {
      const result: ActionState = await saveTag({}, fd);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setName("");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <div className="w-40 space-y-1">
        <Label htmlFor="tm-new-tag-name">Nowy tag</Label>
        <Input id="tm-new-tag-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="w-40 space-y-1">
        <Label htmlFor="tm-new-tag-cat">Kategoria</Label>
        <Select
          id="tm-new-tag-cat"
          value={categoryId}
          onChange={(e) => setCategoryId(Number(e.target.value))}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="tm-new-tag-color">Kolor</Label>
        <input
          id="tm-new-tag-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded border border-line-strong bg-surface-2"
        />
      </div>
      <Button type="button" size="s" disabled={pending || !name.trim()} onClick={submit}>
        Dodaj tag
      </Button>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}

function TagRow({ tag, categories }: { tag: TagWithCategory; categories: CategoryOption[] }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [categoryId, setCategoryId] = useState(tag.categoryId);
  const [color, setColor] = useState(tag.color);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("id", String(tag.id));
    fd.set("name", name.trim());
    fd.set("categoryId", String(categoryId));
    fd.set("color", color);
    if (tag.archived) fd.set("archived", "on");
    startTransition(async () => {
      const result: ActionState = await saveTag({}, fd);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setEditing(false);
      }
    });
  }

  function remove() {
    if (
      !window.confirm(
        "Usunąć tag? Jeśli jest użyty w choćby jednym trade, usunięcie się nie powiedzie — zarchiwizuj go wtedy zamiast kasować.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result: ActionState = await deleteTag(tag.id);
      if (result.error) setError(result.error);
    });
  }

  function toggleArchive() {
    startTransition(async () => {
      await archiveTag(tag.id, !tag.archived);
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: tag.color }}
          aria-hidden
        />
        <span className={tag.archived ? "text-faint line-through" : "text-text"}>{tag.name}</span>
        <Button type="button" size="s" variant="quiet" disabled={pending} onClick={() => setEditing(true)}>
          Edytuj
        </Button>
        <Button type="button" size="s" variant="quiet" disabled={pending} onClick={toggleArchive}>
          {tag.archived ? "Przywróć" : "Ukryj"}
        </Button>
        <Button type="button" size="s" variant="danger" disabled={pending} onClick={remove} aria-label="Usuń tag">
          <Trash2 size={12} aria-hidden />
        </Button>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-32"
        aria-label={`Nazwa tagu ${tag.name}`}
      />
      <Select
        value={categoryId}
        onChange={(e) => setCategoryId(Number(e.target.value))}
        className="w-36"
        aria-label={`Kategoria tagu ${tag.name}`}
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <input
        type="color"
        aria-label={`Kolor tagu ${tag.name}`}
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-9 w-10 cursor-pointer rounded border border-line-strong bg-surface-2"
      />
      <Button type="button" size="s" disabled={pending} onClick={save}>
        Zapisz
      </Button>
      <Button type="button" size="s" variant="quiet" disabled={pending} onClick={() => setEditing(false)}>
        Anuluj
      </Button>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}
