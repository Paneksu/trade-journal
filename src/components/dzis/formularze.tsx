"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";

import { cx } from "@/lib/classes";
import { zapiszPoSesji, zapiszPrzedSesja } from "@/lib/actions/rytual";
import type { ActionState } from "@/lib/actions/settings";
import { klasaPigulki } from "@/components/ui/v2";

/*
 * Formularze rytuału na ekranie „Dziś”. Pola w stylu wzoru: etykieta 13/20 nad polem, pole 40 px
 * na tle surface-2 z ramką linii; wybór 1-5 jako segment (wzór: przełącznik widoku r=8).
 */

const ZDARZENIE_CHECKLISTY = "tj:checklista";

const POLE =
  "przejscie w-full rounded-[var(--radius-tab)] border border-line-strong bg-surface-2 px-3 py-2 text-karta text-text " +
  "placeholder:text-faint hover:border-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function Etykieta({ htmlFor, children, opis }: { htmlFor?: string; children: React.ReactNode; opis?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-meta text-muted">
      {children}
      {opis && <span className="text-faint"> · {opis}</span>}
    </label>
  );
}

function Skala({ nazwa, etykieta, wartosc }: { nazwa: string; etykieta: string; wartosc: number | null }) {
  const [v, setV] = useState<number | null>(wartosc);
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-meta text-muted">{etykieta}</legend>
      <input type="hidden" name={nazwa} value={v ?? ""} />
      <div role="radiogroup" aria-label={etykieta} className="flex gap-1 rounded-[var(--radius-tab)] border border-line-strong bg-surface-2 p-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={v === n}
            aria-label={`${etykieta}: ${n} z 5`}
            onClick={() => setV(v === n ? null : n)}
            className={cx(
              "przejscie num h-8 flex-1 rounded-[6px] text-meta",
              v === n ? "bg-accent-dim text-accent-strong" : "text-muted hover:bg-surface-3 hover:text-text",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Komunikat({ stan }: { stan: ActionState }) {
  if (stan.error) return <p role="alert" className="text-meta text-loss">{stan.error}</p>;
  if (stan.ok)
    return (
      <p role="status" className="flex items-center gap-1.5 text-meta text-muted">
        <Check size={14} className="text-accent" aria-hidden /> Zapisano.
      </p>
    );
  return null;
}

export function FormularzPrzedSesja({
  dzien,
  bias,
  maxTrades,
  sleep,
  energy,
  preSession,
  uniewaznienie,
  szeroki = false,
}: {
  dzien: string;
  bias: "long" | "short" | "neutral" | null;
  maxTrades: number | null;
  sleep: number | null;
  energy: number | null;
  preSession: string | null;
  uniewaznienie: string | null;
  szeroki?: boolean;
}) {
  const [stan, akcja, trwa] = useActionState<ActionState, FormData>(zapiszPrzedSesja, {});
  const bias_ = (
    <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
      <div>
        <Etykieta htmlFor="rytual-bias">Bias dnia</Etykieta>
        <select id="rytual-bias" name="bias" defaultValue={bias ?? ""} className={cx(POLE, "h-10 cursor-pointer")}>
          <option value="">nie ustalony</option>
          <option value="long">long</option>
          <option value="short">short</option>
          <option value="neutral">neutralny</option>
        </select>
      </div>
      <div>
        <Etykieta htmlFor="rytual-max">Maks. trade&apos;ów</Etykieta>
        <input id="rytual-max" name="maxTrades" type="number" min={1} max={20} inputMode="numeric" defaultValue={maxTrades ?? ""} className={cx(POLE, "num h-10")} />
      </div>
    </div>
  );
  const skale = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Skala nazwa="sleep" etykieta="Sen" wartosc={sleep} />
      <Skala nazwa="energy" etykieta="Energia" wartosc={energy} />
    </div>
  );
  const uniew = (
    <div>
      <Etykieta htmlFor="rytual-uniewaznienie" opis="zapisane dosłownie">
        Unieważnienie
      </Etykieta>
      <textarea
        id="rytual-uniewaznienie"
        name="invalidation"
        rows={2}
        defaultValue={uniewaznienie ?? ""}
        placeholder="Co musi się stać, żeby bias przestał obowiązywać"
        className={cx(POLE, "resize-y")}
      />
    </div>
  );
  const plan = (
    <div>
      <Etykieta htmlFor="rytual-plan">Plan na sesję</Etykieta>
      <textarea id="rytual-plan" name="preSession" rows={3} defaultValue={preSession ?? ""} className={cx(POLE, "resize-y")} />
    </div>
  );
  return (
    <form action={akcja} className="space-y-4">
      <input type="hidden" name="day" value={dzien} />
      {szeroki ? (
        /* Pełna szerokość (gdy „Po sesji” jest zwinięte): dwie kolumny, bez pustej połowy karty. */
        <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
          <div className="space-y-4">
            {bias_}
            {skale}
          </div>
          <div className="space-y-4">
            {uniew}
            {plan}
          </div>
        </div>
      ) : (
        <>
          {bias_}
          {uniew}
          {skale}
          {plan}
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={trwa} className={cx(klasaPigulki(true), "disabled:opacity-60")}>
          {trwa ? "Zapisuję…" : "Zapisz rytuał"}
        </button>
        <Komunikat stan={stan} />
      </div>
    </form>
  );
}

export function FormularzPoSesji({
  dzien,
  postSession,
  dayRating,
  mood,
}: {
  dzien: string;
  postSession: string | null;
  dayRating: number | null;
  mood: number | null;
}) {
  const [stan, akcja, trwa] = useActionState<ActionState, FormData>(zapiszPoSesji, {});
  return (
    <form action={akcja} className="space-y-4">
      <input type="hidden" name="day" value={dzien} />
      <div>
        <Etykieta htmlFor="rytual-po">Jeden wniosek z sesji</Etykieta>
        <textarea id="rytual-po" name="postSession" rows={5} defaultValue={postSession ?? ""} className={cx(POLE, "resize-y")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skala nazwa="dayRating" etykieta="Ocena dnia" wartosc={dayRating} />
        <Skala nazwa="mood" etykieta="Nastrój" wartosc={mood} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={trwa} className={cx(klasaPigulki(false), "disabled:opacity-60")}>
          {trwa ? "Zapisuję…" : "Zapisz po sesji"}
        </button>
        <Komunikat stan={stan} />
      </div>
    </form>
  );
}

/** Checklista zatwierdzonych reguł. Zaznaczenia żyją na tym urządzeniu, osobno na każdy dzień. */
export function ChecklistaRegul({
  dzien,
  reguly,
}: {
  dzien: string;
  reguly: { code: string; title: string; hard: boolean }[];
}) {
  const klucz = `tj-checklista-${dzien}`;
  // Stan z localStorage przez useSyncExternalStore: bez setState w efekcie i bez rozjazdu hydratacji.
  const surowe = useSyncExternalStore(
    (powiadom) => {
      window.addEventListener("storage", powiadom);
      window.addEventListener(ZDARZENIE_CHECKLISTY, powiadom);
      return () => {
        window.removeEventListener("storage", powiadom);
        window.removeEventListener(ZDARZENIE_CHECKLISTY, powiadom);
      };
    },
    () => window.localStorage.getItem(klucz) ?? "[]",
    () => "[]",
  );
  let zaznaczone: string[] = [];
  try {
    zaznaczone = JSON.parse(surowe) as string[];
  } catch {
    zaznaczone = [];
  }

  function przelacz(code: string) {
    const nowe = zaznaczone.includes(code) ? zaznaczone.filter((c) => c !== code) : [...zaznaczone, code];
    try {
      window.localStorage.setItem(klucz, JSON.stringify(nowe));
      window.dispatchEvent(new Event(ZDARZENIE_CHECKLISTY));
    } catch {
      // Brak localStorage nie psuje listy.
    }
  }

  return (
    <ul className="-mx-2 flex flex-col">
      {reguly.map((r) => {
        const jest = zaznaczone.includes(r.code);
        return (
          <li key={r.code}>
            <label className="przejscie flex cursor-pointer items-baseline gap-3 rounded-[var(--radius-tab)] px-2 py-1.5 hover:bg-surface-2">
              <input
                type="checkbox"
                checked={jest}
                onChange={() => przelacz(r.code)}
                className="size-4 shrink-0 translate-y-0.5 cursor-pointer accent-accent"
              />
              <span className={cx("min-w-0 flex-1 text-meta", jest ? "text-faint line-through" : "text-text")}>{r.title}</span>
              <span className="num shrink-0 text-grupa text-faint" title={r.hard ? "reguła twarda" : undefined}>
                {r.code}
                {r.hard && "*"}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Na telefonie formularz rytuału jest zwinięty do pigułki i rozwija się po dotknięciu (bramka etapu 1,
 * runda 3); od `sm` zawsze rozwinięty.
 */
export function Rozwijane({ etykieta, children }: { etykieta: string; children: React.ReactNode }) {
  const [otwarte, setOtwarte] = useState(false);
  return (
    <>
      {!otwarte && (
        <button type="button" onClick={() => setOtwarte(true)} aria-expanded={false} className={cx(klasaPigulki(true), "sm:hidden")}>
          {etykieta}
        </button>
      )}
      <div className={cx(otwarte ? "block" : "hidden", "sm:block")}>{children}</div>
    </>
  );
}
