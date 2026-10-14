"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { Button, Checkbox, ErrorMessage, Input, Label, SuccessMessage } from "@/components/ui/base";
import { uniewaznUrzadzenie, zatwierdzUrzadzenie, znajdzKod, type PolaczState } from "@/lib/actions/devices";
import { czyInnyAdres } from "@/lib/api-v2/adres";
import { dateTime } from "@/lib/format";

/* Minimalny ekran urzadzen (faza 2); pelny interfejs przyjdzie w fazie 5. */

const OPISY_ZAKRESOW: Record<string, string> = {
  read: "odczyt: trade'y, notatki, reguły, wyszukiwanie",
  write: "zapis: trade'y, zrzuty, notatki, słowa użytkownika, dzień",
  propose: "propozycje: nowe reguły (zatwierdzasz je Ty, po jednej)",
};

function Przycisk({ etykieta, wariant = "primary" }: { etykieta: string; wariant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={wariant} size="m" disabled={pending}>
      {pending ? "Chwila…" : etykieta}
    </Button>
  );
}

export function PolaczUrzadzenie() {
  const [znaleziony, znajdz] = useActionState<PolaczState, FormData>(znajdzKod, {});
  const [decyzja, decyduj] = useActionState<PolaczState, FormData>(zatwierdzUrzadzenie, {});

  if (decyzja.ok) {
    return <SuccessMessage>{decyzja.wynik}</SuccessMessage>;
  }

  if (znaleziony.kod) {
    const k = znaleziony.kod;
    const innyAdres = czyInnyAdres(k.clientIp, znaleziony.ipPrzegladarki);
    return (
      <form action={decyduj} className="space-y-4 p-4">
        <input type="hidden" name="id" value={k.id} />
        <div className="space-y-1 text-sm">
          <p>
            Urządzenie nazwane <strong className="text-text">{k.clientName}</strong> prosi o dostęp do dziennika.
          </p>
          <p className="text-xs text-faint">Nazwę podało samo urządzenie; nie jest sprawdzona i każdy może wpisać dowolną.</p>
          <p className="text-muted">
            Kod {k.userCode} · adres, z którego przyszło żądanie: {k.clientIp ?? "nieznany"} · ważny do{" "}
            {dateTime(k.expiresAt)}
          </p>
          {innyAdres && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-loss/40 bg-loss-dim px-3 py-2 text-loss">
              Uwaga: żądanie przyszło z adresu {k.clientIp}, a Ty jesteś połączony z adresu {znaleziony.ipPrzegladarki}. Jeśli
              terminal z `tj login` nie jest na tym samym łączu, co ta przeglądarka, a nie masz VPN, odrzuć to żądanie.
            </p>
          )}
          <p className="text-faint">Zatwierdź tylko wtedy, gdy to Ty właśnie uruchomiłeś `tj login` i kod zgadza się z terminalem.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-text">Zakresy (możesz odznaczyć)</legend>
          {k.requestedScopes.map((s) => (
            <Checkbox key={s} name="scope" value={s} defaultChecked label={s} hint={OPISY_ZAKRESOW[s]} />
          ))}
        </fieldset>
        {decyzja.error && <ErrorMessage>{decyzja.error}</ErrorMessage>}
        <div className="flex gap-2">
          <Button type="submit" name="decyzja" value="zatwierdz" variant="primary" size="m">
            Zatwierdź urządzenie
          </Button>
          <Button type="submit" name="decyzja" value="odrzuc" variant="danger" size="m">
            Odrzuć
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={znajdz} className="space-y-3 p-4">
      <Label htmlFor="kod" hint="Przepisz kod z terminala. Nie ma linku z gotowym kodem: to utrudnia oszustwo.">
        Kod z terminala
      </Label>
      <Input
        id="kod"
        name="kod"
        placeholder="BCDF-GHJK"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={12}
        required
        className="max-w-xs font-mono uppercase tracking-widest"
      />
      {znaleziony.error && <ErrorMessage>{znaleziony.error}</ErrorMessage>}
      <Przycisk etykieta="Dalej" />
    </form>
  );
}

export function UniewaznPrzycisk({ id, nazwa }: { id: number; nazwa: string }) {
  const [pending, start] = useTransition();
  const [blad, ustawBlad] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="danger"
        size="s"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Unieważnić token „${nazwa}”? Urządzenie straci dostęp natychmiast.`)) return;
          start(async () => {
            const w = await uniewaznUrzadzenie(id);
            ustawBlad(w.error ?? null);
          });
        }}
      >
        Unieważnij
      </Button>
      {blad && <span className="text-xs text-loss">{blad}</span>}
    </span>
  );
}
