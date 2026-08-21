"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, ErrorMessage, Label, Select, SuccessMessage, Textarea } from "@/components/ui/base";
import { saveDayNote } from "@/lib/actions/journal";
import type { ActionState } from "@/lib/actions/settings";

/** Dziennik dnia: co planowałeś przed sesją i co z tego wyszło. */
export function DayNoteForm({
  day,
  accountId,
  values,
}: {
  day: string;
  accountId: number | null;
  values: {
    preSession?: string | null;
    postSession?: string | null;
    mood?: number | null;
    energy?: number | null;
    dayRating?: number | null;
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveDayNote, {});

  return (
    <form action={formAction} className="space-y-3 p-4">
      <input type="hidden" name="day" value={day} />
      {accountId && <input type="hidden" name="accountId" value={accountId} />}

      <div className="space-y-1.5">
        <Label htmlFor="preSession">Przed sesją</Label>
        <Textarea
          id="preSession"
          name="preSession"
          rows={3}
          defaultValue={values.preSession ?? ""}
          placeholder="Plan na dziś: co gram, czego nie ruszam, jakie dane wychodzą."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="postSession">Po sesji</Label>
        <Textarea
          id="postSession"
          name="postSession"
          rows={3}
          defaultValue={values.postSession ?? ""}
          placeholder="Co się wydarzyło, co powtórzyć, czego nie robić jutro."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { name: "mood", label: "Nastrój", value: values.mood },
          { name: "energy", label: "Energia", value: values.energy },
          { name: "dayRating", label: "Ocena dnia", value: values.dayRating },
        ].map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={f.name}>{f.label}</Label>
            <Select id={f.name} name={f.name} defaultValue={f.value ?? ""}>
              <option value="">—</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}/5
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {state.ok && <SuccessMessage>Zapisano notatkę dnia.</SuccessMessage>}
      <SaveButton />
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="s" disabled={pending}>
      {pending ? "Zapisuję…" : "Zapisz notatkę"}
    </Button>
  );
}
