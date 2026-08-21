"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button, ErrorMessage, Input, Label, Select, Textarea } from "@/components/ui/base";
import { saveBacktestSession } from "@/lib/actions/strategies";
import type { ActionState } from "@/lib/actions/settings";

type Option = { id: number; name: string; symbol?: string };

export type SessionValues = {
  id?: number;
  name?: string;
  strategyId?: number | null;
  instrumentId?: number | null;
  interval?: string | null;
  dataFrom?: string | null;
  dataTo?: string | null;
  startingBalance?: number;
  riskPerTrade?: number | null;
  targetTrades?: number;
  status?: string;
  assumptions?: string | null;
  conclusions?: string | null;
};

/** Sesja backtestu: zalozenia zapisane zanim policzysz wynik. */
export function SessionForm({
  strategies,
  instruments,
  values = {},
  compact = false,
}: {
  strategies: Option[];
  instruments: Option[];
  values?: SessionValues;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveBacktestSession, {});
  const [open, setOpen] = useState(!compact);

  if (compact && !open) {
    return (
      <div className="p-4">
        <Button variant="primary" onClick={() => setOpen(true)}>
          Nowa sesja backtestu
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3 p-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.id && <input type="hidden" name="stay" value="1" />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="name" required>
            Nazwa sesji
          </Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={values.name ?? ""}
            placeholder="np. Wybicie otwarcia na NQ, 2025"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="strategyId">Strategia</Label>
          <Select id="strategyId" name="strategyId" defaultValue={values.strategyId ?? 0}>
            <option value={0}>— bez strategii —</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="instrumentId">Instrument</Label>
          <Select id="instrumentId" name="instrumentId" defaultValue={values.instrumentId ?? 0}>
            <option value={0}>— dowolny —</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol ?? i.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="interval">Interwał</Label>
          <Input
            id="interval"
            name="interval"
            defaultValue={values.interval ?? ""}
            placeholder="np. 5 min"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dataFrom">Dane od</Label>
          <Input id="dataFrom" name="dataFrom" type="date" defaultValue={values.dataFrom ?? ""} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dataTo">Dane do</Label>
          <Input id="dataTo" name="dataTo" type="date" defaultValue={values.dataTo ?? ""} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="startingBalance">Saldo startowe</Label>
          <Input
            id="startingBalance"
            name="startingBalance"
            inputMode="decimal"
            defaultValue={values.startingBalance ? values.startingBalance / 100 : ""}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="riskPerTrade">Ryzyko na trade</Label>
          <Input
            id="riskPerTrade"
            name="riskPerTrade"
            inputMode="decimal"
            defaultValue={values.riskPerTrade ? values.riskPerTrade / 100 : ""}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="targetTrades" hint="Ile trade'ów uznasz za wiarygodną próbkę">
            Cel liczby trade&apos;ów
          </Label>
          <Input
            id="targetTrades"
            name="targetTrades"
            type="number"
            min={1}
            defaultValue={values.targetTrades ?? 100}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={values.status ?? "running"}>
            <option value="running">w toku</option>
            <option value="finished">zakończona</option>
            <option value="abandoned">porzucona</option>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assumptions" hint="Zapisz je zanim zobaczysz wynik">
          Założenia
        </Label>
        <Textarea
          id="assumptions"
          name="assumptions"
          rows={3}
          defaultValue={values.assumptions ?? ""}
          placeholder="Zasady wejścia i wyjścia, poślizg, prowizje, godziny handlu."
        />
      </div>

      {values.id && (
        <div className="space-y-1.5">
          <Label htmlFor="conclusions">Wnioski</Label>
          <Textarea
            id="conclusions"
            name="conclusions"
            rows={3}
            defaultValue={values.conclusions ?? ""}
            placeholder="Co ta sesja pokazała i co z tym robisz dalej."
          />
        </div>
      )}

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}

      <div className="flex items-center gap-2">
        <SubmitButton isEdit={Boolean(values.id)} />
        {compact && (
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
            Anuluj
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
      {pending ? "Zapisuję…" : isEdit ? "Zapisz sesję" : "Utwórz sesję"}
    </Button>
  );
}
