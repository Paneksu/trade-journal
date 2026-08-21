"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";

import { Button, ErrorMessage, Input, Label, Select, SuccessMessage, Textarea } from "@/components/ui/base";
import { deleteStrategy, saveStrategy } from "@/lib/actions/strategies";
import type { ActionState } from "@/lib/actions/settings";

export type StrategyValues = {
  id?: number;
  name?: string;
  description?: string | null;
  rules?: { id: string; text: string }[];
  instrumentId?: number | null;
  active?: boolean;
  color?: string;
};

export function StrategyForm({
  instruments,
  values = {},
  compact = false,
}: {
  instruments: { id: number; symbol: string }[];
  values?: StrategyValues;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveStrategy, {});
  const [open, setOpen] = useState(!compact);
  const [pending, startTransition] = useTransition();

  if (compact && !open) {
    return (
      <div className="p-4">
        <Button variant="primary" onClick={() => setOpen(true)}>
          Nowa strategia
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3 p-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`name-${values.id ?? "new"}`} required>
            Nazwa
          </Label>
          <Input
            id={`name-${values.id ?? "new"}`}
            name="name"
            required
            defaultValue={values.name ?? ""}
            placeholder="np. Wybicie otwarcia"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`instrument-${values.id ?? "new"}`}>Instrument domyślny</Label>
          <Select
            id={`instrument-${values.id ?? "new"}`}
            name="instrumentId"
            defaultValue={values.instrumentId ?? 0}
          >
            <option value={0}>— dowolny —</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`description-${values.id ?? "new"}`}>Opis</Label>
        <Textarea
          id={`description-${values.id ?? "new"}`}
          name="description"
          rows={2}
          defaultValue={values.description ?? ""}
        />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor={`rules-${values.id ?? "new"}`}
          hint="Jedna zasada w linii. Przy każdym trade'zie odhaczasz, które były spełnione."
        >
          Checklista wejścia
        </Label>
        <Textarea
          id={`rules-${values.id ?? "new"}`}
          name="rules"
          rows={5}
          defaultValue={(values.rules ?? []).map((r) => r.text).join("\n")}
          placeholder={"Trend zgodny z kierunkiem\nWolumen powyżej średniej\nBrak danych makro w ciągu 15 minut"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            name="archived"
            defaultChecked={values.active === false}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          strategia nieaktywna
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          kolor
          <input
            type="color"
            name="color"
            defaultValue={values.color ?? "#e8a44c"}
            className="h-7 w-10 cursor-pointer rounded border border-line-strong bg-surface-2"
          />
        </label>
      </div>

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {state.ok && <SuccessMessage>Zapisano strategię.</SuccessMessage>}

      <div className="flex items-center gap-2">
        <SubmitButton isEdit={Boolean(values.id)} />
        {compact && (
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
            Anuluj
          </Button>
        )}
        {values.id && (
          <Button
            type="button"
            variant="danger"
            size="s"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  "Usunąć strategię? Trade'y zostaną, ale stracą przypisanie do niej.",
                )
              ) {
                return;
              }
              startTransition(async () => {
                await deleteStrategy(values.id as number);
              });
            }}
          >
            <Trash2 size={13} aria-hidden />
            Usuń
          </Button>
        )}
      </div>
    </form>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Zapisuję…" : isEdit ? "Zapisz zmiany" : "Utwórz strategię"}
    </Button>
  );
}
