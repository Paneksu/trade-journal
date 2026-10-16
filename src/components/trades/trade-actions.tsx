"use client";

import { useTransition } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { cx } from "@/lib/classes";
import { deleteTrade } from "@/lib/actions/trades";

/*
 * Akcje karty trade'a. UI v2 (bramka etapu 1, runda 2): usuwanie w stylu neutralnym, bo zieleń i czerwień
 * nigdy nie trafiają na przyciski (kierunek.md, Role rules). Na telefonie obie akcje w menu „…”, żeby nie
 * rozbijały nagłówka. Usuwanie wymaga potwierdzenia - kasuje także zrzuty z dysku.
 */

const NEUTRALNY =
  "przejscie inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-3 px-3.5 text-meta text-text hover:bg-line-strong active:bg-surface-2 disabled:opacity-60";

function useUsun(id: number) {
  const [pending, startTransition] = useTransition();
  const usun = () => {
    if (!window.confirm("Usunąć ten trade razem ze zrzutami? Tego nie da się cofnąć.")) return;
    startTransition(() => deleteTrade(id));
  };
  return { pending, usun };
}

export function DeleteTradeButton({ id }: { id: number }) {
  const { pending, usun } = useUsun(id);
  return (
    <button type="button" disabled={pending} onClick={usun} className={NEUTRALNY}>
      <Trash2 size={13} aria-hidden />
      {pending ? "Usuwam…" : "Usuń trade"}
    </button>
  );
}

/** Akcje w nagłówku karty: przyciski od `sm`, menu „…” na telefonie. */
/** `edycja = false` przy ukrytym wyniku (ślepa ocena, review 16.10.2026): bez linku „Edytuj”. */
export function AkcjeTradu({ id, edycja = true }: { id: number; edycja?: boolean }) {
  const { pending, usun } = useUsun(id);
  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        {edycja && (
          <Link href={`/trades/${id}/edit`} className={NEUTRALNY}>
            Edytuj
          </Link>
        )}
        <DeleteTradeButton id={id} />
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label="Akcje trade'a"
          className="przejscie flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-text hover:bg-line-strong sm:hidden"
        >
          <MoreHorizontal size={18} aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="karta z-[var(--z-dropdown)] min-w-44 p-1 shadow-[var(--shadow-pop)]"
          >
            {edycja && (
            <DropdownMenu.Item asChild>
              <Link href={`/trades/${id}/edit`} className={cx("flex h-10 items-center gap-2 rounded-[6px] px-3 text-karta text-text outline-none data-[highlighted]:bg-surface-2")}>
                <Pencil size={15} aria-hidden /> Edytuj
              </Link>
            </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              disabled={pending}
              onSelect={usun}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-[6px] px-3 text-karta text-text outline-none data-[highlighted]:bg-surface-2"
            >
              <Trash2 size={15} aria-hidden /> {pending ? "Usuwam…" : "Usuń trade"}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
