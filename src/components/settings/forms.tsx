"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";

import {
  Button,
  ErrorMessage,
  Input,
  Label,
  Select,
  SuccessMessage,
  Textarea,
} from "@/components/ui/base";
import type { ActionState } from "@/lib/actions/settings";
import { deleteAccount, deleteInstrument, saveAccount, saveInstrument, saveSettings } from "@/lib/actions/settings";
import { archiveField, deleteField, deleteTag, deleteTagCategory, saveField, saveTag, saveTagCategory } from "@/lib/actions/taxonomy";
import { changePassword, type PasswordState } from "@/lib/actions/auth";
import { TYPE_HINTS, TYPE_NAMES, TYPES_WITH_OPTIONS, type FieldDef, type FieldType } from "@/lib/fields/fields";

/* Formularze ustawien. Kazdy zapisuje przez wlasna akcje serwerowa
   i pokazuje wynik na miejscu - bez przeladowania calego ekranu. */

function SaveButton({ label = "Zapisz" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="s" disabled={pending}>
      {pending ? "Zapisuję…" : label}
    </Button>
  );
}

function DeleteButton({
  onDelete,
  question,
  label = "Usuń",
}: {
  onDelete: () => Promise<unknown>;
  question: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size="s"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(question)) return;
          startTransition(async () => {
            const result = (await onDelete()) as ActionState | void;
            if (result && "error" in result && result.error) setError(result.error);
          });
        }}
      >
        <Trash2 size={13} aria-hidden />
        {label}
      </Button>
      {error && <span className="text-xs text-loss">{error}</span>}
    </>
  );
}

function Collapsible({
  buttonLabel,
  children,
}: {
  buttonLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="p-4">
        <Button variant="primary" onClick={() => setOpen(true)}>
          {buttonLabel}
        </Button>
      </div>
    );
  }
  return <>{children(() => setOpen(false))}</>;
}

/* --- Konto ---------------------------------------------------------------- */

export type AccountValues = {
  id?: number;
  name?: string;
  currency?: string;
  startingBalance?: number;
  type?: string;
  defaultRiskAmount?: number | null;
  description?: string | null;
  archived?: boolean;
  sortOrder?: number;
};

export function AccountForm({ values = {}, onDone }: { values?: AccountValues; onDone?: () => void }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveAccount, {});
  const key = values.id ?? "new";

  return (
    <form action={formAction} className="space-y-3 p-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`acc-name-${key}`} required>
            Nazwa
          </Label>
          <Input id={`acc-name-${key}`} name="name" required defaultValue={values.name ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`acc-currency-${key}`}>Waluta</Label>
          <Input
            id={`acc-currency-${key}`}
            name="currency"
            defaultValue={values.currency ?? "USD"}
            maxLength={3}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`acc-balance-${key}`}>Saldo startowe</Label>
          <Input
            id={`acc-balance-${key}`}
            name="startingBalance"
            inputMode="decimal"
            defaultValue={values.startingBalance ? values.startingBalance / 100 : ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`acc-type-${key}`}>Typ</Label>
          <Select id={`acc-type-${key}`} name="type" defaultValue={values.type ?? "live"}>
            <option value="live">realne</option>
            <option value="demo">demo</option>
            <option value="prop">prop firm</option>
            <option value="paper">papierowe</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`acc-risk-${key}`} hint="Podpowiada wielkość pozycji w formularzu">
            Domyślne ryzyko na trade
          </Label>
          <Input
            id={`acc-risk-${key}`}
            name="defaultRiskAmount"
            inputMode="decimal"
            defaultValue={values.defaultRiskAmount ? values.defaultRiskAmount / 100 : ""}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`acc-desc-${key}`}>Opis</Label>
          <Input id={`acc-desc-${key}`} name="description" defaultValue={values.description ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`acc-order-${key}`}>Kolejność</Label>
          <Input
            id={`acc-order-${key}`}
            name="sortOrder"
            type="number"
            defaultValue={values.sortOrder ?? 0}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          name="archived"
          defaultChecked={values.archived}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        konto zarchiwizowane
      </label>

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {state.ok && <SuccessMessage>Zapisano konto.</SuccessMessage>}

      <div className="flex flex-wrap items-center gap-2">
        <SaveButton />
        {onDone && (
          <Button type="button" variant="quiet" size="s" onClick={onDone}>
            Anuluj
          </Button>
        )}
        {values.id && (
          <DeleteButton
            onDelete={() => deleteAccount(values.id as number)}
            question="Usunąć konto? Jeśli ma trade'y, usunięcie się nie powiedzie."
          />
        )}
      </div>
    </form>
  );
}

export function NewAccount() {
  return (
    <Collapsible buttonLabel="Nowe konto">
      {(close) => <AccountForm onDone={close} />}
    </Collapsible>
  );
}

/* --- Instrument ----------------------------------------------------------- */

export type InstrumentValues = {
  id?: number;
  symbol?: string;
  name?: string;
  exchange?: string | null;
  tickSize?: string;
  tickValue?: number;
  currency?: string;
  commissionPerContract?: number;
  rthFrom?: string;
  rthTo?: string;
  exchangeTimezone?: string;
  active?: boolean;
  sortOrder?: number;
};

export function InstrumentForm({
  values = {},
  onDone,
}: {
  values?: InstrumentValues;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveInstrument, {});
  const key = values.id ?? "new";

  return (
    <form action={formAction} className="space-y-3 p-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`ins-symbol-${key}`} required>
            Symbol
          </Label>
          <Input
            id={`ins-symbol-${key}`}
            name="symbol"
            required
            defaultValue={values.symbol ?? ""}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`ins-name-${key}`} required>
            Nazwa
          </Label>
          <Input id={`ins-name-${key}`} name="name" required defaultValue={values.name ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ins-exchange-${key}`}>Giełda</Label>
          <Input id={`ins-exchange-${key}`} name="exchange" defaultValue={values.exchange ?? ""} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`ins-ticksize-${key}`} required hint="np. 0,25 dla NQ">
            Wielkość ticku
          </Label>
          <Input
            id={`ins-ticksize-${key}`}
            name="tickSize"
            inputMode="decimal"
            required
            defaultValue={values.tickSize ? String(Number(values.tickSize)) : ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ins-tickvalue-${key}`} required hint="W walucie, np. 5 dla NQ">
            Wartość ticku
          </Label>
          <Input
            id={`ins-tickvalue-${key}`}
            name="tickValue"
            inputMode="decimal"
            required
            defaultValue={values.tickValue ? values.tickValue / 1000 : ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ins-commission-${key}`} hint="Za kontrakt, w obie strony">
            Prowizja
          </Label>
          <Input
            id={`ins-commission-${key}`}
            name="commissionPerContract"
            inputMode="decimal"
            defaultValue={values.commissionPerContract ? values.commissionPerContract / 100 : ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ins-currency-${key}`}>Waluta</Label>
          <Input
            id={`ins-currency-${key}`}
            name="currency"
            maxLength={3}
            defaultValue={values.currency ?? "USD"}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`ins-rthfrom-${key}`} hint="Czas giełdy">
            Sesja główna od
          </Label>
          <Input
            id={`ins-rthfrom-${key}`}
            name="rthFrom"
            type="time"
            defaultValue={values.rthFrom ?? "09:30"}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ins-rthto-${key}`}>Sesja główna do</Label>
          <Input
            id={`ins-rthto-${key}`}
            name="rthTo"
            type="time"
            defaultValue={values.rthTo ?? "16:00"}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ins-tz-${key}`}>Strefa giełdy</Label>
          <Input
            id={`ins-tz-${key}`}
            name="exchangeTimezone"
            defaultValue={values.exchangeTimezone ?? "America/New_York"}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ins-order-${key}`}>Kolejność</Label>
          <Input
            id={`ins-order-${key}`}
            name="sortOrder"
            type="number"
            defaultValue={values.sortOrder ?? 0}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          name="inactive"
          defaultChecked={values.active === false}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        instrument nieaktywny
      </label>

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {state.ok && <SuccessMessage>Zapisano instrument.</SuccessMessage>}

      <div className="flex flex-wrap items-center gap-2">
        <SaveButton />
        {onDone && (
          <Button type="button" variant="quiet" size="s" onClick={onDone}>
            Anuluj
          </Button>
        )}
        {values.id && (
          <DeleteButton
            onDelete={() => deleteInstrument(values.id as number)}
            question="Usunąć instrument? Jeśli ma trade'y, usunięcie się nie powiedzie."
          />
        )}
      </div>
    </form>
  );
}

export function NewInstrument() {
  return (
    <Collapsible buttonLabel="Nowy instrument">
      {(close) => <InstrumentForm onDone={close} />}
    </Collapsible>
  );
}

/* --- Kategorie tagow i tagi ----------------------------------------------- */

export function TagCategoryForm({
  values = {},
  onDone,
}: {
  values?: { id?: number; name?: string; key?: string; description?: string | null; sortOrder?: number };
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveTagCategory, {});
  const key = values.id ?? "new";

  return (
    <form action={formAction} className="space-y-3 p-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.id && <input type="hidden" name="key" value={values.key} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`cat-name-${key}`} required>
            Nazwa kategorii
          </Label>
          <Input id={`cat-name-${key}`} name="name" required defaultValue={values.name ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`cat-desc-${key}`}>Opis</Label>
          <Input id={`cat-desc-${key}`} name="description" defaultValue={values.description ?? ""} />
        </div>
      </div>

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}

      <div className="flex flex-wrap items-center gap-2">
        <SaveButton />
        {onDone && (
          <Button type="button" variant="quiet" size="s" onClick={onDone}>
            Anuluj
          </Button>
        )}
        {values.id && (
          <DeleteButton
            onDelete={() => deleteTagCategory(values.id as number)}
            question="Usunąć kategorię razem ze wszystkimi jej tagami? Tagi znikną też z trade'ów."
          />
        )}
      </div>
    </form>
  );
}

export function NewTagCategory() {
  return (
    <Collapsible buttonLabel="Nowa kategoria tagów">
      {(close) => <TagCategoryForm onDone={close} />}
    </Collapsible>
  );
}

export function TagForm({
  categories,
  values = {},
  onDone,
}: {
  categories: { id: number; name: string }[];
  values?: { id?: number; categoryId?: number; name?: string; color?: string; archived?: boolean };
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveTag, {});
  const key = values.id ?? "new";

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 px-4 py-2">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <div className="w-40 space-y-1.5">
        <Label htmlFor={`tag-name-${key}`}>Nazwa</Label>
        <Input id={`tag-name-${key}`} name="name" required defaultValue={values.name ?? ""} />
      </div>
      <div className="w-44 space-y-1.5">
        <Label htmlFor={`tag-cat-${key}`}>Kategoria</Label>
        <Select id={`tag-cat-${key}`} name="categoryId" defaultValue={values.categoryId ?? categories[0]?.id}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`tag-color-${key}`}>Kolor</Label>
        <input
          id={`tag-color-${key}`}
          type="color"
          name="color"
          defaultValue={values.color ?? "#8fa3b8"}
          className="h-9 w-12 cursor-pointer rounded border border-line-strong bg-surface-2"
        />
      </div>
      <label className="flex h-9 items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          name="archived"
          defaultChecked={values.archived}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        ukryty
      </label>

      <div className="flex items-center gap-2">
        <SaveButton label={values.id ? "Zapisz" : "Dodaj"} />
        {onDone && (
          <Button type="button" variant="quiet" size="s" onClick={onDone}>
            Anuluj
          </Button>
        )}
        {values.id && (
          <DeleteButton
            onDelete={() => deleteTag(values.id as number)}
            question="Usunąć tag? Zniknie też z trade'ów, które go mają."
            label=""
          />
        )}
      </div>

      {state.error && (
        <div className="w-full">
          <ErrorMessage>{state.error}</ErrorMessage>
        </div>
      )}
    </form>
  );
}

export function NewTag({ categories }: { categories: { id: number; name: string }[] }) {
  return (
    <Collapsible buttonLabel="Nowy tag">
      {(close) => <TagForm categories={categories} onDone={close} />}
    </Collapsible>
  );
}

/* --- Pola wlasne ---------------------------------------------------------- */

export function FieldForm({ values, onDone }: { values?: FieldDef; onDone?: () => void }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveField, {});
  const [type, setType] = useState<FieldType>(values?.type ?? "select");
  const [pending, startTransition] = useTransition();
  const key = values?.id ?? "new";

  return (
    <form action={formAction} className="space-y-3 p-4">
      {values?.id && <input type="hidden" name="id" value={values.id} />}
      {values?.id && <input type="hidden" name="key" value={values.key} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`fld-label-${key}`} required>
            Nazwa pola
          </Label>
          <Input
            id={`fld-label-${key}`}
            name="label"
            required
            defaultValue={values?.label ?? ""}
            placeholder="np. Nastrój przed wejściem"
          />
          {values?.key && <p className="text-xs text-faint">klucz: {values.key}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`fld-type-${key}`} required hint={TYPE_HINTS[type]}>
            Typ
          </Label>
          <Select
            id={`fld-type-${key}`}
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
          >
            {(Object.keys(TYPE_NAMES) as FieldType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_NAMES[t]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`fld-scope-${key}`}>Gdzie działa</Label>
          <Select id={`fld-scope-${key}`} name="scope" defaultValue={values?.scope ?? "both"}>
            <option value="both">dziennik i backtest</option>
            <option value="trade">tylko dziennik</option>
            <option value="backtest">tylko backtest</option>
          </Select>
        </div>

        {type === "number" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`fld-min-${key}`}>Minimum</Label>
              <Input id={`fld-min-${key}`} name="min" inputMode="decimal" defaultValue={values?.min ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`fld-max-${key}`}>Maksimum</Label>
              <Input id={`fld-max-${key}`} name="max" inputMode="decimal" defaultValue={values?.max ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`fld-unit-${key}`}>Jednostka</Label>
              <Input id={`fld-unit-${key}`} name="unit" defaultValue={values?.unit ?? ""} />
            </div>
          </>
        )}

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`fld-hint-${key}`}>Podpowiedź pod polem</Label>
          <Input id={`fld-hint-${key}`} name="hint" defaultValue={values?.hint ?? ""} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`fld-order-${key}`}>Kolejność</Label>
          <Input
            id={`fld-order-${key}`}
            name="sortOrder"
            type="number"
            defaultValue={values?.sortOrder ?? 0}
          />
        </div>
      </div>

      {TYPES_WITH_OPTIONS.includes(type) && (
        <div className="space-y-1.5">
          <Label
            htmlFor={`fld-options-${key}`}
            required
            hint="Jedna wartość w linii. To są stałe wartości, które będzie można wybrać."
          >
            Lista wartości
          </Label>
          <Textarea
            id={`fld-options-${key}`}
            name="options"
            rows={4}
            defaultValue={(values?.options ?? []).map((o) => o.value).join("\n")}
            placeholder={"spokój\nniecierpliwość\npresja"}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        {[
          { name: "required", label: "wymagane", checked: values?.required },
          { name: "inTable", label: "pokaż w tabeli", checked: values?.inTable },
          { name: "inStats", label: "używaj w statystykach", checked: values?.inStats ?? true },
          { name: "archived", label: "ukryte", checked: values?.archived },
        ].map((c) => (
          <label key={c.name} className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              name={c.name}
              defaultChecked={c.checked}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {c.label}
          </label>
        ))}
      </div>

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {state.ok && <SuccessMessage>Zapisano pole.</SuccessMessage>}

      <div className="flex flex-wrap items-center gap-2">
        <SaveButton />
        {onDone && (
          <Button type="button" variant="quiet" size="s" onClick={onDone}>
            Anuluj
          </Button>
        )}
        {values?.id && (
          <>
            <Button
              type="button"
              size="s"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await archiveField(values.id, !values.archived);
                })
              }
            >
              {values.archived ? "Przywróć" : "Ukryj zamiast usuwać"}
            </Button>
            <DeleteButton
              onDelete={() => deleteField(values.id)}
              question="Usunąć definicję pola? Wartości zapisane przy trade'ach zostaną w bazie, ale przestaną być widoczne."
            />
          </>
        )}
      </div>
    </form>
  );
}

export function NewField() {
  return (
    <Collapsible buttonLabel="Nowe pole własne">
      {(close) => <FieldForm onDone={close} />}
    </Collapsible>
  );
}

/* --- Ustawienia ogolne i haslo -------------------------------------------- */

export function GeneralSettingsForm({
  values,
}: {
  values: {
    baseCurrency: string;
    timezone: string;
    defaultRisk: number;
    minSample: number;
    tradingHoursFrom: string | null;
    tradingHoursTo: string | null;
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveSettings, {});

  return (
    <form action={formAction} className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="baseCurrency">Waluta bazowa</Label>
          <Input id="baseCurrency" name="baseCurrency" maxLength={3} defaultValue={values.baseCurrency} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="timezone" hint="W tej strefie wpisujesz i czytasz godziny">
            Strefa czasowa
          </Label>
          <Input id="timezone" name="timezone" defaultValue={values.timezone} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="defaultRisk" hint="Podpowiedź wielkości pozycji">
            Domyślne ryzyko na trade
          </Label>
          <Input
            id="defaultRisk"
            name="defaultRisk"
            inputMode="decimal"
            defaultValue={values.defaultRisk / 100}
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="minSample"
            hint="Poniżej tylu trade'ów statystyki są oznaczane jako niewiarygodne"
          >
            Próg istotności próbki
          </Label>
          <Input id="minSample" name="minSample" type="number" min={3} defaultValue={values.minSample} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tradingHoursFrom">Twoje godziny handlu od</Label>
          <Input
            id="tradingHoursFrom"
            name="tradingHoursFrom"
            type="time"
            defaultValue={values.tradingHoursFrom ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tradingHoursTo">do</Label>
          <Input
            id="tradingHoursTo"
            name="tradingHoursTo"
            type="time"
            defaultValue={values.tradingHoursTo ?? ""}
          />
        </div>
      </div>

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {state.ok && <SuccessMessage>Zapisano ustawienia.</SuccessMessage>}
      <SaveButton />
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState<PasswordState, FormData>(changePassword, {});

  return (
    <form action={formAction} className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="obecne" required>
            Obecne hasło
          </Label>
          <Input id="obecne" name="obecne" type="password" autoComplete="current-password" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nowe" required hint="Min. 10 znaków, małe i wielkie litery, cyfra">
            Nowe hasło
          </Label>
          <Input id="nowe" name="nowe" type="password" autoComplete="new-password" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="powtorzone" required>
            Powtórz nowe hasło
          </Label>
          <Input
            id="powtorzone"
            name="powtorzone"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
      </div>

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {state.ok && (
        <SuccessMessage>
          Hasło zmienione. Wszystkie inne urządzenia zostały wylogowane.
        </SuccessMessage>
      )}
      <SaveButton label="Zmień hasło" />
    </form>
  );
}
