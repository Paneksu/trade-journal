"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Camera, ChevronLeft, NotebookPen, Plus, SquarePen, X } from "lucide-react";

import { ErrorMessage, Label, Select, SuccessMessage, Textarea } from "@/components/ui/base";
import { klasaPigulki } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { celeZdjecia, szybkaNotatka, szybkieZdjecie, type CelZdjecia, type SzybkiStan } from "@/lib/actions/szybkie";

/*
 * Arkusz „+” z dolnego paska (UI v2, etap 4, PWA). Trzy wejścia: Nowy trade, Notatka dnia, Zdjęcie. Notatka i zdjęcie
 * zapisują się bez opuszczania ekranu; zdjęcie z aparatu (`capture`) albo z galerii telefonu idzie istniejącym uploadem.
 */

type Widok = "menu" | "notatka" | "zdjecie";

function Wyslij({ etykieta }: { etykieta: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(klasaPigulki(true), "h-10 w-full justify-center disabled:opacity-60")}>
      {pending ? "Zapisuję…" : etykieta}
    </button>
  );
}

function Wynik({ stan }: { stan: SzybkiStan }) {
  return (
    <>
      {stan.error && <ErrorMessage>{stan.error}</ErrorMessage>}
      {stan.ok && stan.komunikat && <SuccessMessage>{stan.komunikat}</SuccessMessage>}
    </>
  );
}

function FormularzNotatki() {
  const [stan, akcja] = useActionState<SzybkiStan, FormData>(szybkaNotatka, {});
  return (
    <form action={akcja} className="space-y-3" data-szybki="notatka">
      <div className="space-y-1.5">
        <Label htmlFor="szybka-notatka" hint="Dopisze się na końcu „Po sesji” w dzisiejszej notatce dnia.">
          Notatka dnia
        </Label>
        <Textarea id="szybka-notatka" name="tekst" rows={5} autoFocus />
      </div>
      <Wyslij etykieta="Dopisz do dnia" />
      <Wynik stan={stan} />
    </form>
  );
}

function FormularzZdjecia({ cele }: { cele: CelZdjecia[] }) {
  const [stan, akcja] = useActionState<SzybkiStan, FormData>(szybkieZdjecie, {});
  return (
    <form action={akcja} className="space-y-3" data-szybki="zdjecie">
      <div className="space-y-1.5">
        <Label htmlFor="szybkie-cel">Do czego</Label>
        <Select id="szybkie-cel" name="cel" defaultValue="dzien">
          {cele.map((c) => (
            <option key={c.klucz} value={c.klucz}>
              {c.etykieta}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="szybkie-zdjecie" hint="Aparat albo galeria telefonu. Zrzuty z łącznika i od AI zostają nietknięte.">
          Zdjęcie
        </Label>
        <input
          id="szybkie-zdjecie"
          name="shot"
          type="file"
          accept="image/*"
          capture="environment"
          required
          className="block w-full text-karta text-muted file:mr-3 file:h-9 file:rounded-full file:border-0 file:bg-surface-3 file:px-3.5 file:text-karta file:text-text"
        />
      </div>
      <Wyslij etykieta="Dodaj zdjęcie" />
      <Wynik stan={stan} />
    </form>
  );
}

export function SzybkiArkusz({ klasa }: { klasa: string }) {
  const [otwarty, setOtwarty] = useState(false);
  const [widok, setWidok] = useState<Widok>("menu");
  const [cele, setCele] = useState<CelZdjecia[] | null>(null);

  const otworz = (o: boolean) => {
    setOtwarty(o);
    if (!o) setWidok("menu");
  };
  const doZdjecia = async () => {
    setWidok("zdjecie");
    if (!cele) setCele((await celeZdjecia()).cele);
  };
  const pozycja =
    "przejscie flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-tab)] px-3 text-left text-karta text-text hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <Dialog.Root open={otwarty} onOpenChange={otworz}>
      <Dialog.Trigger className={klasa} aria-label="Szybki wpis">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-bg">
          <Plus size={20} aria-hidden />
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-bg/70" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[var(--z-modal)] mx-auto flex max-h-[90vh] max-w-lg flex-col overflow-y-auto rounded-t-[var(--radius-panel)] border-t border-line-strong bg-sidebar px-3 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))]"
        >
          <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            {widok !== "menu" ? (
              <button type="button" onClick={() => setWidok("menu")} className="przejscie flex h-9 items-center gap-1 rounded-full pr-2 text-karta text-muted hover:text-text" aria-label="Wróć do wyboru">
                <ChevronLeft size={16} aria-hidden /> Wróć
              </button>
            ) : (
              <span />
            )}
            <Dialog.Title className="text-sekcja font-medium text-text">
              {widok === "menu" ? "Szybki wpis" : widok === "notatka" ? "Notatka dnia" : "Zdjęcie"}
            </Dialog.Title>
            <Dialog.Close aria-label="Zamknij" className="przejscie flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-muted hover:text-text">
              <X size={16} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="px-2 pb-1">
            {widok === "menu" && (
              <ul className="space-y-1">
                <li>
                  <Link href="/trades/new" className={pozycja} onClick={() => otworz(false)}>
                    <SquarePen size={18} aria-hidden className="text-muted" /> Nowy trade
                  </Link>
                </li>
                <li>
                  <button type="button" className={pozycja} onClick={() => setWidok("notatka")}>
                    <NotebookPen size={18} aria-hidden className="text-muted" /> Notatka dnia
                  </button>
                </li>
                <li>
                  <button type="button" className={pozycja} onClick={doZdjecia}>
                    <Camera size={18} aria-hidden className="text-muted" /> Zdjęcie
                  </button>
                </li>
              </ul>
            )}
            {widok === "notatka" && <FormularzNotatki />}
            {widok === "zdjecie" && (cele ? <FormularzZdjecia cele={cele} /> : <p className="py-4 text-karta text-muted">Wczytuję…</p>)}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
