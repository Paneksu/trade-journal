"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  Button,
  Checkbox,
  ErrorMessage,
  Label,
  Select,
  SuccessMessage,
  Textarea,
} from "@/components/ui/base";
import { saveDayNote } from "@/lib/actions/journal";
import type { ActionState } from "@/lib/actions/settings";
import { NO_TRADE_REASONS } from "@/lib/domain/day-log";

/** Dziennik dnia: co planowałeś przed sesją, co z tego wyszło albo dlaczego nie grałeś. */
export function DayNoteForm({
  day,
  hasTrades = false,
  values,
  wersja,
}: {
  day: string;
  /** Pole zostaje dla zgodności wywołań; notatka dnia jest jedna i bez konta (ADR-033, «Tak, zawsze jedna»). */
  accountId?: number | null;
  hasTrades?: boolean;
  /** updatedAt notatki z chwili otwarcia ("" gdy jej nie ma): serwer odmawia zapisu, gdy ktoś zmienił ją w międzyczasie. */
  wersja: string;
  values: {
    preSession?: string | null;
    postSession?: string | null;
    mood?: number | null;
    energy?: number | null;
    dayRating?: number | null;
    noTrade?: boolean | null;
    noTradeReason?: string | null;
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveDayNote, {});

  return (
    <form action={formAction} className="space-y-3 p-4">
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="wersja" value={wersja} />

      <div className="space-y-2 rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
        <Checkbox
          name="noTrade"
          label="Dzień bez transakcji"
          hint={
            hasTrades
              ? "Tego dnia są już zapisane trade'y."
              : "Świadomie odpuszczony dzień też jest wpisem w dzienniku."
          }
          key={wersja} defaultChecked={Boolean(values.noTrade)}
          disabled={hasTrades}
        />

        <div className="space-y-1.5">
          {/* Powod zostaje wlaczony takze przy odznaczonym dniu: akcja i tak
              zapisuje go tylko z flaga, a pole gasnace pod kursorem myli. */}
          <Label htmlFor="noTradeReason">Powód</Label>
          <Select
            id="noTradeReason"
            name="noTradeReason"
            key={wersja} defaultValue={values.noTradeReason ?? ""}
            disabled={hasTrades}
          >
            <option value="">—</option>
            {NO_TRADE_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="preSession">Przed sesją</Label>
        <Textarea
          id="preSession"
          name="preSession"
          rows={3}
          key={wersja} defaultValue={values.preSession ?? ""}
          placeholder="Plan na dziś: co gram, czego nie ruszam, jakie dane wychodzą."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="postSession">Po sesji</Label>
        <Textarea
          id="postSession"
          name="postSession"
          rows={3}
          key={wersja} defaultValue={values.postSession ?? ""}
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
            <Select id={f.name} name={f.name} key={wersja} defaultValue={f.value ?? ""}>
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
