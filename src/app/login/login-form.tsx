"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signIn, type SignInState } from "@/lib/actions/auth";
import { Button, ErrorMessage, Input, Label } from "@/components/ui/base";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="l" className="w-full" disabled={pending}>
      {pending ? "Sprawdzam…" : "Wejdź"}
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
      <SubmitButton />
    </form>
  );
}
