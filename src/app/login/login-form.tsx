"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { cancelSecondFactor, signIn, verifySecondFactor, type SignInState } from "@/lib/actions/auth";
import { klasaPigulki } from "@/components/ui/v2";
import { cx } from "@/lib/classes";

/* Formularze logowania (UI v2). Logika bez zmian: te same akcje, pola `haslo`, `kod`, `wroc`. Pole kodu przyjmuje
   kod z aplikacji i kod zapasowy jak wcześniej; „Użyj kodu zapasowego” zmienia tylko podpis i klawiaturę. */

const POLE =
  "przejscie block h-11 w-full rounded-[var(--radius-tab)] border border-line-strong bg-surface-2 px-3.5 text-karta text-text placeholder:text-faint " +
  "hover:border-faint focus-visible:border-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text/15 aria-[invalid=true]:border-loss";

function Wyslij() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(klasaPigulki(true), "h-11 w-full justify-center text-karta disabled:opacity-60")}>
      {pending ? "Sprawdzam…" : "Zaloguj"}
    </button>
  );
}

function Blad({ tekst }: { tekst?: string }) {
  if (!tekst) return null;
  return (
    <p role="alert" className="text-meta text-loss">
      {tekst}
    </p>
  );
}

export function LoginForm({ back }: { back: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="wroc" value={back} />
      <div className="space-y-2">
        <label htmlFor="haslo" className="block text-meta text-muted">
          Hasło
        </label>
        <input
          id="haslo"
          name="haslo"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "haslo-blad" : undefined}
          className={POLE}
        />
      </div>
      <div id="haslo-blad">
        <Blad tekst={state.error} />
      </div>
      <Wyslij />
    </form>
  );
}

/** Drugi krok: kod z aplikacji (6 cyfr) albo kod zapasowy (10 znaków). */
export function CodeForm({ back }: { back: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(verifySecondFactor, {});
  const [zapasowy, setZapasowy] = useState(false);
  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="wroc" value={back} />
        <div className="space-y-2">
          <label htmlFor="kod" className="block text-meta text-muted">
            {zapasowy ? "Kod zapasowy" : "Kod z aplikacji"}
          </label>
          <input
            key={zapasowy ? "zapasowy" : "aplikacja"}
            id="kod"
            name="kod"
            type="text"
            inputMode={zapasowy ? "text" : "numeric"}
            autoComplete={zapasowy ? "off" : "one-time-code"}
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            required
            placeholder={zapasowy ? "10 znaków" : "6 cyfr"}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "kod-blad" : undefined}
            className={cx(POLE, "num text-center text-sekcja tracking-[0.3em]")}
          />
        </div>
        <div id="kod-blad">
          <Blad tekst={state.error} />
        </div>
        <Wyslij />
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setZapasowy((z) => !z)}
          className="przejscie rounded-[var(--radius-tab)] text-meta text-muted underline underline-offset-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {zapasowy ? "Użyj kodu z aplikacji" : "Użyj kodu zapasowego"}
        </button>
        <form action={cancelSecondFactor}>
          <button type="submit" className="przejscie rounded-[var(--radius-tab)] text-meta text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2">
            Wróć do hasła
          </button>
        </form>
      </div>
    </div>
  );
}
