"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { Button, ErrorMessage, Input, Label, SuccessMessage } from "@/components/ui/base";
import {
  confirmTotpSetup,
  disableTotp,
  enterSudo,
  leaveSudo,
  logoutEverywhere,
  regenerateBackupCodes,
  startTotpSetup,
  type DisableState,
  type SetupConfirmState,
  type SetupStartState,
  type SudoState,
} from "@/lib/actions/security";

/* Formularze Ustawienia -> Bezpieczenstwo (ADR-031). */

function Submit({ label, pendingLabel = "Sprawdzam…" }: { label: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="s" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ListaKodow({ kody }: { kody: string[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-text">
        Zapisz te kody w bezpiecznym miejscu (menedżer haseł, wydruk). Każdy działa raz i
        <strong> nie zobaczysz ich ponownie</strong>.
      </p>
      <ul
        aria-label="Kody zapasowe"
        className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-[var(--radius-control)] border border-line-strong bg-surface-2 p-3 font-mono text-sm tracking-wider text-text sm:max-w-sm"
      >
        {kody.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
    </div>
  );
}

/* --- tryb sudo ----------------------------------------------------------------- */

export function SudoForm() {
  const [state, formAction] = useActionState<SudoState, FormData>(enterSudo, {});
  return (
    <form action={formAction} className="space-y-3 p-4">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="sudo-kod" hint="6 cyfr z aplikacji albo kod zapasowy">
          Kod
        </Label>
        <Input
          id="sudo-kod"
          name="kod"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          className="font-mono tracking-widest"
          aria-invalid={state.error ? true : undefined}
        />
      </div>
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      <Submit label="Włącz tryb sudo na 10 minut" />
    </form>
  );
}

export function LeaveSudoButton() {
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" size="s" disabled={pending} onClick={() => start(() => leaveSudo())}>
      Zakończ tryb sudo
    </Button>
  );
}

/* --- wlaczanie 2FA ----------------------------------------------------------------- */

/**
 * Po potwierdzeniu kodem serwer podbija wersje sesji i odswieza strone, a ta od razu
 * pokazuje juz wlaczone 2FA. Kody zapasowe widac tylko raz, wiec trzyma je
 * `TotpSection` (zostaje na miejscu), a nie ten formularz (znika razem ze stanem).
 */
function EnableTotpFlow({
  kluczOk,
  onEnabled,
}: {
  kluczOk: boolean;
  onEnabled: (kody: string[]) => void;
}) {
  const [start, startAction] = useActionState<SetupStartState, FormData>(startTotpSetup, {});
  const [potwierdzenie, potwierdzAction] = useActionState<SetupConfirmState, FormData>(
    async (poprzedni, dane) => {
      const wynik = await confirmTotpSetup(poprzedni, dane);
      if (wynik.kody) onEnabled(wynik.kody);
      return wynik;
    },
    {},
  );

  if (start.qr && !potwierdzenie.wygaslo) {
    return (
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Zeskanuj kod aplikacją uwierzytelniającą (Google Authenticator, Authy, 1Password…).</li>
          <li>Wpisz 6-cyfrowy kod, który aplikacja pokazuje teraz.</li>
        </ol>
        <div className="flex flex-wrap items-start gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL z wlasnego serwera */}
          <img
            src={start.qr}
            width={200}
            height={200}
            alt="Kod QR do aplikacji uwierzytelniającej"
            className="rounded-[var(--radius-control)] bg-white"
          />
          <div className="min-w-0 space-y-1">
            <p className="etykieta">Albo wpisz ręcznie</p>
            <p className="break-all font-mono text-sm tracking-wider text-text" data-testid="totp-sekret">
              {start.sekret}
            </p>
            <p className="text-xs text-faint">Typ: czasowy (TOTP), 6 cyfr, 30 sekund.</p>
          </div>
        </div>
        <form action={potwierdzAction} className="space-y-3">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="setup-kod" required>
              Kod z aplikacji
            </Label>
            <Input
              id="setup-kod"
              name="kod"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              required
              className="font-mono tracking-widest"
              aria-invalid={potwierdzenie.error ? true : undefined}
            />
          </div>
          {potwierdzenie.error && <ErrorMessage>{potwierdzenie.error}</ErrorMessage>}
          <Submit label="Potwierdź i włącz 2FA" />
        </form>
      </div>
    );
  }

  return (
    <form action={startAction} className="space-y-3">
      {!kluczOk && (
        <ErrorMessage>
          Serwer nie ma poprawnego TOTP_ENC_KEY, więc 2FA nie da się teraz włączyć. Ustaw zmienną
          w panelu wdrożeniowym (docs/wdrozenie-coolify.md, sekcja 9).
        </ErrorMessage>
      )}
      {potwierdzenie.wygaslo && <ErrorMessage>{potwierdzenie.error}</ErrorMessage>}
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="setup-haslo" required hint="Hasło potwierdza, że to Ty włączasz 2FA">
          Hasło
        </Label>
        <Input
          id="setup-haslo"
          name="haslo"
          type="password"
          autoComplete="current-password"
          required
          disabled={!kluczOk}
          aria-invalid={start.error ? true : undefined}
        />
      </div>
      {start.error && <ErrorMessage>{start.error}</ErrorMessage>}
      <Submit label="Pokaż kod QR" pendingLabel="Przygotowuję…" />
    </form>
  );
}

/* --- zarzadzanie wlaczonym 2FA ----------------------------------------------------------- */

export function RegenerateBackupCodes({ sudoAktywne }: { sudoAktywne: boolean }) {
  const [pending, start] = useTransition();
  const [wynik, setWynik] = useState<{ error?: string; kody?: string[] }>({});

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        size="s"
        disabled={pending || !sudoAktywne}
        onClick={() => start(async () => setWynik(await regenerateBackupCodes()))}
      >
        {pending ? "Generuję…" : "Wygeneruj nowe kody zapasowe"}
      </Button>
      {!sudoAktywne && <p className="text-xs text-faint">Wymaga trybu sudo. Stare kody przestaną działać.</p>}
      {wynik.error && <ErrorMessage>{wynik.error}</ErrorMessage>}
      {wynik.kody && <ListaKodow kody={wynik.kody} />}
    </div>
  );
}

export function DisableTotpForm({ sudoAktywne }: { sudoAktywne: boolean }) {
  const [state, formAction] = useActionState<DisableState, FormData>(disableTotp, {});
  return (
    <form action={formAction} className="space-y-3">
      {!sudoAktywne && <p className="text-xs text-faint">Wymaga trybu sudo.</p>}
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      <Button type="submit" variant="danger" size="s" disabled={!sudoAktywne}>
        Wyłącz 2FA
      </Button>
    </form>
  );
}

export function LogoutEverywhereButton() {
  const [pending, start] = useTransition();
  return (
    <Button variant="danger" size="s" disabled={pending} onClick={() => start(() => logoutEverywhere())}>
      {pending ? "Wylogowuję…" : "Wyloguj wszystkie urządzenia"}
    </Button>
  );
}

/* --- calosc panelu 2FA ---------------------------------------------------------------------- */

export function TotpSection({
  wlaczone,
  wlaczoneOd,
  kluczOk,
  sudoAktywne,
  wolneKody,
}: {
  wlaczone: boolean;
  wlaczoneOd: string | null;
  kluczOk: boolean;
  sudoAktywne: boolean;
  wolneKody: number;
}) {
  const [noweKody, setNoweKody] = useState<string[] | null>(null);

  return (
    <div className="space-y-4 p-4">
      {noweKody && (
        <div className="space-y-3">
          <SuccessMessage>2FA jest włączone. Wszystkie inne urządzenia zostały wylogowane.</SuccessMessage>
          <ListaKodow kody={noweKody} />
        </div>
      )}
      {!wlaczone && <EnableTotpFlow kluczOk={kluczOk} onEnabled={setNoweKody} />}
      {wlaczone && (
        <div className="space-y-4">
          <p className="text-sm text-text">
            Logowanie wymaga hasła i kodu z aplikacji.
            {wlaczoneOd && <span className="text-muted"> Włączone: {wlaczoneOd}.</span>}
          </p>
          <p className="text-sm text-muted" data-testid="wolne-kody">
            Nieużytych kodów zapasowych: <strong className="text-text">{wolneKody}</strong>
            {wolneKody <= 2 && <span className="text-loss"> — wygeneruj nowe, zanim się skończą.</span>}
          </p>
          <RegenerateBackupCodes sudoAktywne={sudoAktywne} />
          <DisableTotpForm sudoAktywne={sudoAktywne} />
        </div>
      )}
    </div>
  );
}
