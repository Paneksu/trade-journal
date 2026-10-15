"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { ErrorMessage, Input, Label, SuccessMessage, Textarea } from "@/components/ui/base";
import { klasaPigulki } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { decydujOSetupie, decydujOSprzecznosci, decydujOSugestii, decydujORegule, potwierdzReguly, type DecyzjaState } from "@/lib/actions/decyzje";
import { ROZSTRZYGNIECIE_OPISY, ROZSTRZYGNIECIA } from "@/lib/decyzje/rozstrzygniecia-opisy";

/* Formularze decyzji. UI v2 (etap 2): pigułki ze wzoru (akcent tylko na „Przyjmij/Zatwierdź”, odrzucenie neutralne,
   bo zieleń i czerwień nie trafiają na przyciski). Walidacja jest po stronie serwera. */

function Przycisk({ decyzja, etykieta, wariant = "secondary" }: { decyzja: string; etykieta: string; wariant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="decyzja" value={decyzja} disabled={pending} className={cx(klasaPigulki(wariant === "primary"), "disabled:opacity-60")}>
      {pending ? "Chwila…" : etykieta}
    </button>
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
    <form action={akcja} className="space-y-4">
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

const POLA_SETUPU: { pole: "stopRule" | "targetRule" | "beRule" | "invalidation" | "avoid"; etykieta: string }[] = [
  { pole: "stopRule", etykieta: "Stop" },
  { pole: "targetRule", etykieta: "Cel" },
  { pole: "beRule", etykieta: "BE" },
  { pole: "invalidation", etykieta: "Unieważnienie" },
  { pole: "avoid", etykieta: "Czego unikać" },
];

export function DecyzjaSetupu({ versionId, wersja }: { versionId: number; wersja: Record<"stopRule" | "targetRule" | "beRule" | "invalidation" | "avoid", string | null> }) {
  const [stan, akcja] = useActionState<DecyzjaState, FormData>(decydujOSetupie, {});
  return (
    <form action={akcja} className="space-y-4">
      <input type="hidden" name="id" value={versionId} />
      <Przycisk decyzja="przyjmij" etykieta="Przyjmij wersję setupu" wariant="primary" />
      <details className="space-y-2">
        <summary className="cursor-pointer text-sm text-muted">Popraw i przyjmij</summary>
        <p className="text-xs text-faint">Treść propozycji jest niezmienna: poprawka powstaje jako nowa wersja od Ciebie, a propozycja trafia do odrzuconych. Listę kontrolną i progi zmienia nowa wersja.</p>
        {POLA_SETUPU.map(({ pole, etykieta }) => (
          <div key={pole} className="space-y-1">
            <Label htmlFor={`${pole}-${versionId}`}>{etykieta}</Label>
            <Textarea id={`${pole}-${versionId}`} name={pole} defaultValue={wersja[pole] ?? ""} rows={2} />
          </div>
        ))}
        <Przycisk decyzja="popraw" etykieta="Popraw i przyjmij" />
      </details>
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

export function PotwierdzenieReguly({ id }: { id: number }) {
  const [stan, akcja] = useActionState<DecyzjaState, FormData>(potwierdzReguly, {});
  return (
    <form action={akcja} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Przycisk decyzja="potwierdz" etykieta="Potwierdzam zgodność z regulaminem" wariant="primary" />
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
    <button type="submit" disabled={pending} className={cx(klasaPigulki(true), "disabled:opacity-60")}>
      {pending ? "Chwila…" : etykieta}
    </button>
  );
}

export function DecyzjaSprzecznosci({ id }: { id: number }) {
  const [stan, akcja] = useActionState<DecyzjaState, FormData>(decydujOSprzecznosci, {});
  return (
    <form action={akcja} className="space-y-4">
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
