"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  cancelSecondFactor,
  signIn,
  verifySecondFactor,
  type SignInState,
} from "@/lib/actions/auth";
import { Button, ErrorMessage, Input, Label } from "@/components/ui/base";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="l" className="w-full" disabled={pending}>
      {pending ? "Sprawdzam…" : label}
    </Button>
  );
}

export function LoginForm({ back }: { back: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="wroc" value={back} />
      <div className="space-y-1.5">
        <Label htmlFor="haslo">Hasło</Label>
        <Input
          id="haslo"
          name="haslo"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={state.error ? true : undefined}
        />
      </div>
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      <SubmitButton label="Wejdź" />
    </form>
  );
}

/** Drugi krok: kod z aplikacji (6 cyfr) albo kod zapasowy (10 znaków). */
export function CodeForm({ back }: { back: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(verifySecondFactor, {});

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="wroc" value={back} />
        <div className="space-y-1.5">
          <Label htmlFor="kod" hint="6 cyfr z aplikacji uwierzytelniającej albo jeden z 10 kodów zapasowych">
            Kod
          </Label>
          <Input
            id="kod"
            name="kod"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            required
            aria-invalid={state.error ? true : undefined}
            className="font-mono tracking-widest"
          />
        </div>
        {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
        <SubmitButton label="Zaloguj" />
      </form>
      <form action={cancelSecondFactor}>
        <Button type="submit" variant="quiet" size="s">
          Wróć do hasła
        </Button>
      </form>
    </div>
  );
}
