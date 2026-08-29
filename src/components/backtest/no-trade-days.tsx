"use client";

import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";

import { Button, ErrorMessage, Label, Select, SuccessMessage, Textarea } from "@/components/ui/base";
import { deleteDayNote, saveBacktestDayNote } from "@/lib/actions/journal";
import type { ActionState } from "@/lib/actions/settings";
import { NO_TRADE_REASONS } from "@/lib/domain/day-log";

/**
 * Dzien bez sygnalu w sesji backtestu. W symulacji latwo policzyc same wejscia
 * i uznac, ze strategia daje sygnal codziennie. Zapisany dzien bez sygnalu
 * pokazuje, ile realnie trzeba przesiedziec, zeby dojsc do tych trade'ow.
 */
export function NoTradeDayForm({
  sessionId,
  dataFrom,
  dataTo,
  domyslnyDzien,
  values,
  stalaData = false,
}: {
  sessionId: number;
  dataFrom: string | null;
  dataTo: string | null;
  /** Dzien klikniety w kalendarzu sesji - formularz otwiera sie juz na nim.
      Wymaga `key` przy uzyciu, inaczej `defaultValue` nie odswiezy sie po
      przejsciu na inny dzien (2026-08-29). */
  domyslnyDzien?: string | null;
  /** Wartosci zapisanego wpisu - ten sam formularz sluzy do edycji, bo akcja
      i tak robi upsert po (dzien, sesja). Osobny formularz edycji rozjechalby
      sie z tym przy pierwszej zmianie pola (2026-08-29). */
  values?: { noTradeReason?: string | null; postSession?: string | null };
  /** Strona jednego dnia: data jest w adresie, wiec pole tylko ja pokazuje. */
  stalaData?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveBacktestDayNote, {});

  return (
    <form action={formAction} className="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
      <input type="hidden" name="backtestSessionId" value={sessionId} />

      <div className="space-y-1.5">
        <Label htmlFor="ntd-day" required>
          Dzień
        </Label>
        <input
          id="ntd-day"
          name="day"
          type="date"
          required
          defaultValue={domyslnyDzien ?? undefined}
          min={dataFrom ?? undefined}
          max={dataTo ?? undefined}
          readOnly={stalaData}
          className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-2.5 py-2 text-sm text-text transition-colors duration-150 hover:border-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none read-only:text-muted"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ntd-reason">Powód</Label>
        <Select id="ntd-reason" name="noTradeReason" defaultValue={values?.noTradeReason ?? "no_setup"}>
          <option value="">—</option>
          {NO_TRADE_REASONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="ntd-note">Co widziałeś na wykresie</Label>
        <Textarea
          id="ntd-note"
          name="postSession"
          rows={2}
          defaultValue={values?.postSession ?? ""}
          placeholder="Którego warunku zabrakło, na co czekałeś, co byś zagrał gdyby przyszło."
        />
      </div>

      <div className="sm:col-span-2">
        {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
        {state.ok && (
          <SuccessMessage>
            {values ? "Zapisano zmiany." : "Zapisano dzień bez sygnału."}
          </SuccessMessage>
        )}
        <div className="mt-2">
          <ZapiszDzien zapisany={Boolean(values)} />
        </div>
      </div>
    </form>
  );
}

function ZapiszDzien({ zapisany }: { zapisany: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="s" disabled={pending}>
      {pending ? "Zapisuję…" : zapisany ? "Zapisz zmiany" : "Zapisz dzień bez sygnału"}
    </Button>
  );
}

export function DeleteDayNoteButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="danger"
      size="s"
      disabled={pending}
      aria-label="Usuń dzień bez sygnału"
      onClick={() => {
        if (!window.confirm("Usunąć ten dzień razem ze zrzutami? Tego nie da się cofnąć.")) return;
        startTransition(async () => {
          await deleteDayNote(id);
        });
      }}
    >
      <Trash2 size={13} aria-hidden />
      {pending ? "Usuwam…" : "Usuń dzień"}
    </Button>
  );
}
