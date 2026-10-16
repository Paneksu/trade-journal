"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Checkbox, ErrorMessage, Input, Label, Select, SuccessMessage, Textarea } from "@/components/ui/base";
import { klasaPigulki } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { dodajWpisKsiegi, przypnijPreset, zatwierdzPrzeglad, type Etap3State } from "@/lib/actions/etap3";

/* Formularze etapu 3 (przegląd tygodnia, przypięcie presetu prop, księga). Zapis jako aktor `ui` w lib/decyzje;
   walidacja po stronie serwera. Pigułki ze wzoru: akcent tylko na głównej akcji. */

function Wyslij({ etykieta, glowna = true }: { etykieta: string; glowna?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(klasaPigulki(glowna), "disabled:opacity-60")}>
      {pending ? "Chwila…" : etykieta}
    </button>
  );
}

function Wynik({ stan }: { stan: Etap3State }) {
  return (
    <>
      {stan.error && <ErrorMessage>{stan.error}</ErrorMessage>}
      {stan.ok && stan.komunikat && <SuccessMessage>{stan.komunikat}</SuccessMessage>}
    </>
  );
}

const ROZLICZENIA = [
  { v: "kept", e: "Dotrzymane" },
  { v: "partial", e: "Częściowo" },
  { v: "broken", e: "Złamane" },
] as const;

export function FormularzPrzegladu({ weekStart, poprzednie }: { weekStart: string; poprzednie: string | null }) {
  const [stan, akcja] = useActionState<Etap3State, FormData>(zatwierdzPrzeglad, {});
  return (
    <form action={akcja} className="space-y-5" data-formularz="przeglad">
      <input type="hidden" name="weekStart" value={weekStart} />
      {poprzednie && (
        <fieldset className="space-y-2.5">
          <legend className="etykieta mb-1.5 block">Rozliczenie zobowiązania z poprzedniego tygodnia</legend>
          <blockquote className="border-l-2 border-line-strong pl-3 text-karta text-text">{poprzednie}</blockquote>
          <div className="flex flex-wrap gap-2">
            {ROZLICZENIA.map((r) => (
              <label key={r.v} className="przejscie inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3.5 text-karta text-text has-[:checked]:border-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
                <input type="radio" name="rozliczenie" value={r.v} className="sr-only" />
                {r.e}
              </label>
            ))}
          </div>
          <Label htmlFor="slowaRozliczenia">Co się stało (Twoimi słowami)</Label>
          <Input id="slowaRozliczenia" name="slowaRozliczenia" maxLength={500} />
        </fieldset>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="wnioski" required hint="Zapisujemy dosłownie. Szkic AI wyżej to tylko podpowiedź.">
          Wnioski z tygodnia
        </Label>
        <Textarea id="wnioski" name="wnioski" rows={4} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zobowiazanie" required hint="Jedno. Rozliczysz je na następnym przeglądzie.">
          Zobowiązanie na następny tydzień
        </Label>
        <Input id="zobowiazanie" name="zobowiazanie" maxLength={300} required />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Wyslij etykieta="Zatwierdź przegląd" />
        <span className="text-meta text-faint">Zatwierdzasz Ty; AI tylko przygotowuje szkic.</span>
      </div>
      <Wynik stan={stan} />
    </form>
  );
}

export type PresetOpcja = {
  id: number;
  etykieta: string;
  firm: string;
  doWeryfikacji: boolean;
  wiekDni: number;
  /** Stawka opłat round turn za kontrakt (centy) i źródło z presetu (ADR-034 pkt 5). */
  feeMiniCents?: number | null;
  feeMicroCents?: number | null;
  feeSourceUrl?: string | null;
};

const naUsd = (c: number | null | undefined): string => (c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(".", ","));

const TYPY_DD = [
  { v: "", e: "z presetu" },
  { v: "eod", e: "EOD (koniec dnia)" },
  { v: "intraday", e: "Intraday (trailing w trakcie dnia)" },
  { v: "static", e: "Statyczny" },
  { v: "trailing_to_static", e: "Trailing do progu, potem statyczny" },
];

function Pole({ id, etykieta, nazwa, hint, typ = "text", inputMode }: { id: string; etykieta: string; nazwa: string; hint?: string; typ?: string; inputMode?: "decimal" | "numeric" }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} hint={hint}>
        {etykieta}
      </Label>
      <Input id={id} name={nazwa} type={typ} inputMode={inputMode} autoComplete="off" />
    </div>
  );
}

export function FormularzPresetu({ accountId, presety, dzis, onZapisano }: { accountId: number; presety: PresetOpcja[]; dzis: string; onZapisano?: () => void }) {
  const [stan, akcja] = useActionState<Etap3State, FormData>(przypnijPreset, {});
  const [wybrany, setWybrany] = useState("");
  const [feeMini, setFeeMini] = useState("");
  const [feeMicro, setFeeMicro] = useState("");
  useEffect(() => {
    if (stan.ok) onZapisano?.();
  }, [stan.ok, onZapisano]);
  const preset = presety.find((p) => String(p.id) === wybrany) ?? null;
  const firmy = [...new Set(presety.map((p) => p.firm))];
  const p = (n: string) => `${n}-${accountId}`;
  return (
    <form action={akcja} className="space-y-4" data-formularz="preset">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-1">
          <Label htmlFor={p("preset")}>Preset firmy</Label>
          <Select id={p("preset")} name="presetId" value={wybrany} onChange={(e) => {
              setWybrany(e.target.value);
              const nowy = presety.find((x) => String(x.id) === e.target.value);
              setFeeMini(naUsd(nowy?.feeMiniCents));
              setFeeMicro(naUsd(nowy?.feeMicroCents));
            }}>
            <option value="">Bez presetu (wpisuję ręcznie)</option>
            {firmy.map((f) => (
              <optgroup key={f} label={f}>
                {presety
                  .filter((x) => x.firm === f)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.etykieta}
                      {x.doWeryfikacji ? " · do weryfikacji" : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
          {preset && (
            <p className="text-meta text-muted">
              Odczytany {preset.wiekDni} dni temu{preset.doWeryfikacji ? "; wartości do sprawdzenia z regulaminem" : ""}.
              {preset.feeSourceUrl && (
                <>
                  {" "}Źródło stawki opłat:{" "}
                  <a href={preset.feeSourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text">
                    strona firmy
                  </a>
                  .
                </>
              )}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor={p("od")} required hint="Data zakupu konta albo zmiany regulaminu.">
            Obowiązuje od
          </Label>
          <Input id={p("od")} name="validFrom" type="date" defaultValue={dzis} required />
        </div>
      </div>
      <fieldset className="space-y-2" data-testid="preset-oplaty">
        <legend className="etykieta mb-1 block">Opłaty transakcyjne (podpowiedziane z presetu, możesz zmienić)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={p("fee-mini")}>Opłata za kontrakt mini (USD, w obie strony)</Label>
            <Input id={p("fee-mini")} name="feeMini" inputMode="decimal" autoComplete="off" value={feeMini} onChange={(e) => setFeeMini(e.target.value)} placeholder={preset ? "brak w presecie" : "brak stawki"} className="num" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={p("fee-micro")}>Opłata za kontrakt micro (USD, w obie strony)</Label>
            <Input id={p("fee-micro")} name="feeMicro" inputMode="decimal" autoComplete="off" value={feeMicro} onChange={(e) => setFeeMicro(e.target.value)} placeholder={preset ? "brak w presecie" : "brak stawki"} className="num" />
          </div>
        </div>
        <p className="text-meta text-muted">
          Stawka liczy opłaty trade&apos;ów bez kwoty z rachunku. Puste pole znaczy „z presetu”{preset ? "" : " (bez presetu: brak stawki)"}.
          {!preset && " Źródło stawki wpisz w nadpisaniach poniżej."}
        </p>
      </fieldset>
      <details className="group">
        <summary className="przejscie cursor-pointer text-karta text-muted hover:text-text">Nadpisz wartości presetu (puste pole = wartość z presetu)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={p("dd")}>Typ DD</Label>
            <Select id={p("dd")} name="ddType" defaultValue="">
              {TYPY_DD.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.e}
                </option>
              ))}
            </Select>
          </div>
          <Pole id={p("maxdd")} nazwa="maxDd" etykieta="Maks. DD ($)" inputMode="decimal" />
          <Pole id={p("lock")} nazwa="ddLock" etykieta="Blokada DD przy zysku ($)" inputMode="decimal" />
          <Pole id={p("dll")} nazwa="dailyLoss" etykieta="Limit dzienny ($)" inputMode="decimal" />
          <Pole id={p("cel")} nazwa="profitTarget" etykieta="Cel zysku ($)" inputMode="decimal" />
          <Pole id={p("cons")} nazwa="consistency" etykieta="Consistency (%)" inputMode="decimal" />
          <Pole id={p("dni")} nazwa="minDays" etykieta="Min. dni handlowych" inputMode="numeric" />
          <Pole id={p("mini")} nazwa="maxMini" etykieta="Maks. kontraktów mini" inputMode="numeric" />
          <Pole id={p("micro")} nazwa="maxMicro" etykieta="Maks. kontraktów micro" inputMode="numeric" />
          <div className="sm:col-span-3">
            <Pole id={p("zrodlo")} nazwa="sourceUrl" etykieta="Źródło (adres regulaminu)" typ="url" />
          </div>
          <div className="sm:col-span-3">
            <Pole id={p("zrodlo-fee")} nazwa="feeSourceUrl" etykieta="Źródło stawki opłat (adres https)" typ="url" />
          </div>
        </div>
      </details>
      <Checkbox name="potwierdz" label="Sprawdziłem te wartości z regulaminem firmy" hint="Bez potwierdzenia konto ma znacznik „reguły niepotwierdzone”, a bufory liczą się z ostrożniejszej wersji." />
      <div className="flex flex-wrap items-center gap-3">
        <Wyslij etykieta="Przypnij reguły" />
      </div>
      <Wynik stan={stan} />
    </form>
  );
}

const RODZAJE = [
  { v: "eval_fee", e: "Opłata za eval" },
  { v: "reset_fee", e: "Reset" },
  { v: "activation_fee", e: "Aktywacja" },
  { v: "subscription", e: "Abonament" },
  { v: "data_fee", e: "Dane rynkowe" },
  { v: "payout", e: "Wypłata" },
  { v: "refund", e: "Zwrot" },
  { v: "other", e: "Inne (ze znakiem)" },
] as const;

export function FormularzKsiegi({ accountId, dzis }: { accountId: number; dzis: string }) {
  const [stan, akcja] = useActionState<Etap3State, FormData>(dodajWpisKsiegi, {});
  const p = (n: string) => `${n}-ks-${accountId}`;
  return (
    <form action={akcja} className="space-y-4" data-formularz="ksiega">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem_10rem]">
        <div className="space-y-1">
          <Label htmlFor={p("rodzaj")}>Rodzaj</Label>
          <Select id={p("rodzaj")} name="kind" defaultValue="eval_fee">
            {RODZAJE.map((r) => (
              <option key={r.v} value={r.v}>
                {r.e}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={p("kwota")} hint="Bez znaku; koszt odejmie się sam.">
            Kwota ($)
          </Label>
          <Input id={p("kwota")} name="kwota" inputMode="decimal" required autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={p("data")}>Data</Label>
          <Input id={p("data")} name="occurredOn" type="date" defaultValue={dzis} required />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={p("notka")}>Notatka</Label>
        <Input id={p("notka")} name="note" maxLength={300} />
      </div>
      <Wyslij etykieta="Dodaj wpis" glowna={false} />
      <Wynik stan={stan} />
    </form>
  );
}
