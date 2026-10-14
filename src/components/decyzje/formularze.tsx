"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, ErrorMessage, Input, Label, SuccessMessage, Textarea } from "@/components/ui/base";
import { decydujOSetupie, decydujOSprzecznosci, decydujOSugestii, decydujORegule, type DecyzjaState } from "@/lib/actions/decyzje";
import { ROZSTRZYGNIECIE_OPISY, ROZSTRZYGNIECIA } from "@/lib/decyzje/rozstrzygniecia-opisy";

/* Minimalne formularze decyzji (faza 2b); wyglad przebuduje faza 5. Walidacja jest po stronie serwera. */

function Przycisk({ decyzja, etykieta, wariant = "secondary" }: { decyzja: string; etykieta: string; wariant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="decyzja" value={decyzja} variant={wariant} size="m" disabled={pending}>
      {pending ? "Chwila…" : etykieta}
    </Button>
  );
}

function Wynik({ stan }: { stan: DecyzjaState }) {
  return (
    <>
      {stan.error && <ErrorMessage>{stan.error}</ErrorMessage>}
      {stan.ok && stan.komunikat && <SuccessMessage>{stan.komunikat}</SuccessMessage>}
    </>
  );
}

export function DecyzjaReguly({ versionId, tekst }: { versionId: number; tekst: string }) {
  const [stan, akcja] = useActionState<DecyzjaState, FormData>(decydujORegule, {});
  return (
    <form action={akcja} className="space-y-4 p-4">
      <input type="hidden" name="id" value={versionId} />
      <div className="flex flex-wrap items-center gap-2">
        <Przycisk decyzja="przyjmij" etykieta="Przyjmij" wariant="primary" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`tekst-${versionId}`} hint="Treść wersji jest niezmienna: poprawka powstaje jako nowa wersja od Ciebie, a propozycja trafia do odrzuconych.">
          Popraw tekst reguły
        </Label>
        <Textarea id={`tekst-${versionId}`} name="tekst" defaultValue={tekst} rows={5} />
        <Przycisk decyzja="popraw" etykieta="Popraw i przyjmij" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`powod-${versionId}`} hint="Wymagany. AI nie zgłosi tej samej treści drugi raz bez nowego argumentu.">
          Powód odrzucenia
        </Label>
        <Input id={`powod-${versionId}`} name="powod" maxLength={500} />
        <Przycisk decyzja="odrzuc" etykieta="Odrzuć z powodem" wariant="danger" />
      </div>
      <Wynik stan={stan} />
    </form>
  );
}

export function DecyzjaSetupu({ versionId }: { versionId: number }) {
  const [stan, akcja] = useActionState<DecyzjaState, FormData>(decydujOSetupie, {});
  return (
    <form action={akcja} className="space-y-4 p-4">
      <input type="hidden" name="id" value={versionId} />
      <Przycisk decyzja="przyjmij" etykieta="Przyjmij wersję setupu" wariant="primary" />
      <div className="space-y-1.5">
        <Label htmlFor={`powod-setup-${versionId}`} hint="Wymagany przy odrzuceniu.">
          Powód odrzucenia
        </Label>
        <Input id={`powod-setup-${versionId}`} name="powod" maxLength={500} />
        <Przycisk decyzja="odrzuc" etykieta="Odrzuć z powodem" wariant="danger" />
      </div>
      <Wynik stan={stan} />
    </form>
  );
}

export function DecyzjaSugestii({ id, zatwierdzona }: { id: number; zatwierdzona: boolean }) {
  const [stan, akcja] = useActionState<DecyzjaState, FormData>(decydujOSugestii, {});
  return (
    <form action={akcja} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {zatwierdzona ? (
        <Przycisk decyzja="cofnij" etykieta="Cofnij" />
      ) : (
        <>
          <Przycisk decyzja="zatwierdz" etykieta="Zatwierdź" wariant="primary" />
          <Przycisk decyzja="odrzuc" etykieta="Odrzuć" wariant="danger" />
        </>
      )}
      <Wynik stan={stan} />
    </form>
  );
}

function Wyslij({ etykieta }: { etykieta: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="m" disabled={pending}>
      {pending ? "Chwila…" : etykieta}
    </Button>
  );
}

export function DecyzjaSprzecznosci({ id }: { id: number }) {
  const [stan, akcja] = useActionState<DecyzjaState, FormData>(decydujOSprzecznosci, {});
  return (
    <form action={akcja} className="space-y-4 p-4">
      <input type="hidden" name="id" value={id} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-text">Twoja decyzja</legend>
        {ROZSTRZYGNIECIA.map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input type="radio" name="decyzja" value={r} className="size-4 accent-accent" />
            {ROZSTRZYGNIECIE_OPISY[r]}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor={`slowa-${id}`} hint="Twoje słowa zostają w dzienniku dosłownie: powód albo warunki (kiedy działa Twój sposób, a kiedy mentora).">
          Dlaczego / pod jakim warunkiem
        </Label>
        <Textarea id={`slowa-${id}`} name="slowa" rows={4} />
      </div>
      <Wyslij etykieta="Zapisz rozstrzygnięcie" />
      <Wynik stan={stan} />
    </form>
  );
}
